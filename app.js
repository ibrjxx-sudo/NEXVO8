const legacyDemoConversationIds = new Set(["sara", "omar", "family", "noura", "team", "layla"]);
let conversations = loadConversations();
let activeId = null;
let currentFilter = "all";
let unreadOnly = false;
let toastTimer;
let activePage = "chats";
let currentCall = null;
let callTimer;
let stories = loadStoredArray("wesal-stories", []);
let storyReads = loadStoredArray("wesal-story-reads", []);
let activeStoryGroup = null;
let activeStoryIndex = 0;
let storyProgressTimer = null;
let storyStartedAt = 0;
let storyElapsed = 0;
let storyPaused = false;
let storyRenderToken = 0;
let blockedContacts = loadStoredArray("wesal-blocked", []);
let calls = loadStoredArray("wesal-calls", []);
let profile = loadStoredValue("wesal-profile", {
  name: "مستخدم NEXVO",
  about: "متاح للتواصل ✨",
  username: "",
  mood: "متاح",
  phone: "",
  photo: ""
});
let preferences = loadStoredValue("wesal-preferences", { dark: false, notifications: true, privacy: true, focus: false });
let phoneContacts = loadStoredArray("wesal-phone-contacts", []);
let accountPhoto = "";
let mediaDbPromise;
let activeMediaDraft = null;
let currentCallStream = null;
let ringContext = null;
let ringTimer = null;
let ringOscillators = [];
let mediaObjectUrls = new Map();
let attachmentMenuOpen = false;
let voiceRecorder = null;
let voiceStream = null;
let voiceChunks = [];
let voiceTimer = null;
let voiceStartedAt = 0;
let voiceRecording = false;
let voiceCancelled = false;

const list = document.querySelector("#conversationList");
const searchInput = document.querySelector("#searchInput");
const messages = document.querySelector("#messages");
const conversationView = document.querySelector("#conversationView");
const welcomeScreen = document.querySelector("#welcomeScreen");
const messageInput = document.querySelector("#messageInput");
const toast = document.querySelector("#toast");
const appPage = document.querySelector("#appPage");
const pageContent = document.querySelector("#pageContent");
const headerMenu = document.querySelector("#headerMenu");
const storyInput = document.querySelector("#storyInput");
const permissionDialog = document.querySelector("#permissionDialog");
const validStories = stories.filter(story => story.createdAt && Date.now() - story.createdAt < 24 * 60 * 60 * 1000);
if (validStories.length !== stories.length) {
  stories = validStories;
  persist("wesal-stories", stories, "تعذر حذف الحالات المنتهية");
}

function formatFileSize(size = 0) {
  if (size < 1024) return `${size} بايت`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} كيلوبايت`;
  return `${(size / (1024 * 1024)).toFixed(1)} ميغابايت`;
}

function openMediaDatabase() {
  if (!("indexedDB" in window)) return Promise.reject(new Error("تخزين الوسائط غير متاح في هذا المتصفح"));
  if (!mediaDbPromise) {
    mediaDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open("wesal-media", 1);
      request.addEventListener("upgradeneeded", () => request.result.createObjectStore("assets", { keyPath: "id" }));
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () => reject(request.error || new Error("تعذر فتح مخزن الوسائط")));
    });
  }
  return mediaDbPromise;
}

async function putMedia(blob, name, type) {
  const db = await openMediaDatabase();
  const id = `media-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await new Promise((resolve, reject) => {
    const request = db.transaction("assets", "readwrite").objectStore("assets").add({ id, blob, name, type });
    request.addEventListener("success", resolve);
    request.addEventListener("error", () => reject(request.error || new Error("تعذر حفظ الملف")));
  });
  return { id, name, type, size: blob.size };
}

async function getMediaUrl(id) {
  if (mediaObjectUrls.has(id)) return mediaObjectUrls.get(id);
  const db = await openMediaDatabase();
  const record = await new Promise((resolve, reject) => {
    const request = db.transaction("assets").objectStore("assets").get(id);
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error || new Error("تعذر فتح الملف")));
  });
  if (!record) throw new Error("الملف غير موجود على هذا الجهاز");
  const url = URL.createObjectURL(record.blob);
  mediaObjectUrls.set(id, url);
  return url;
}

async function deleteMedia(id) {
  if (!id) return;
  const db = await openMediaDatabase();
  await new Promise((resolve, reject) => {
    const request = db.transaction("assets", "readwrite").objectStore("assets").delete(id);
    request.addEventListener("success", resolve);
    request.addEventListener("error", () => reject(request.error || new Error("تعذر حذف الملف")));
  });
  if (mediaObjectUrls.has(id)) {
    URL.revokeObjectURL(mediaObjectUrls.get(id));
    mediaObjectUrls.delete(id);
  }
}

function loadConversations() {
  const saved = loadStoredValue("wesal-conversations", null);
  return Array.isArray(saved) ? saved.filter(chat => !legacyDemoConversationIds.has(chat.id)) : [];
}

function loadStoredValue(key, fallback) {
  try {
    const saved = localStorage.getItem(key);
    return saved === null ? fallback : JSON.parse(saved);
  } catch {
    return fallback;
  }
}

function loadStoredArray(key, fallback) {
  const value = loadStoredValue(key, fallback);
  return Array.isArray(value) ? value : fallback;
}

function loadAccounts() {
  const accounts = loadStoredValue("wesal-accounts", null);
  if (Array.isArray(accounts)) return accounts;
  const legacyAccount = loadStoredValue("wesal-account", null);
  if (!legacyAccount?.username) return [];
  persist("wesal-accounts", [legacyAccount], "تعذر تحميل الحسابات المحفوظة");
  return [legacyAccount];
}

function saveAccounts(accounts) {
  return persist("wesal-accounts", accounts, "تعذر حفظ الحسابات على هذا الجهاز");
}

function findAccount(username) {
  return loadAccounts().find(account => account.username === username) || null;
}

function persist(key, value, errorMessage) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    showToast(errorMessage);
    return false;
  }
}

function saveConversations() {
  persist("wesal-conversations", conversations, "تعذر حفظ المحادثات على هذا الجهاز");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function normalizePhone(value) {
  return String(value || "").replace(/[^\d+]/g, "");
}

function encodeBytes(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

async function derivePasswordHash(password, salt) {
  if (!crypto.subtle) throw new Error("تسجيل الحساب يتطلب متصفحًا آمنًا. افتح الموقع عبر HTTPS أو localhost.");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 150000, hash: "SHA-256" }, key, 256);
  return encodeBytes(bits);
}

async function hashPassword(password, saltValue = null) {
  const salt = saltValue ? Uint8Array.from(atob(saltValue), char => char.charCodeAt(0)) : crypto.getRandomValues(new Uint8Array(16));
  return { salt: encodeBytes(salt), hash: await derivePasswordHash(password, salt) };
}

function updateProfileShortcut() {
  const button = document.querySelector("#profileButton");
  button.innerHTML = profile.photo ? `<img src="${profile.photo}" alt="">` : escapeHtml(profile.name.slice(0, 1));
}

function setAuthMode(mode) {
  const login = mode === "login";
  document.querySelector("#loginForm").hidden = !login;
  document.querySelector("#registerForm").hidden = login;
  document.querySelector("#loginTab").classList.toggle("active", login);
  document.querySelector("#registerTab").classList.toggle("active", !login);
  document.querySelector("#authDialog").dataset.mode = mode;
}

function finishAuthentication(account) {
  if (!account || !persist("wesal-session", account.username, "تعذر حفظ جلسة الدخول على هذا الجهاز")) return;
  document.querySelector("#authDialog").close();
  if (localStorage.getItem("wesal-permissions-intro") !== "seen") {
    window.setTimeout(() => {
      if (!permissionDialog.open) permissionDialog.showModal();
    }, 350);
  }
}

function openContactsDialog() {
  renderContactsList();
  document.querySelector("#contactsDialog").showModal();
  document.querySelector("#contactsDialog input[name='name']").focus();
}

function renderContactsList() {
  const container = document.querySelector("#contactsList");
  const query = document.querySelector("#contactsDialog input[name='name']").value.trim().toLocaleLowerCase("ar");
  const contacts = conversations.filter(chat => chat.phone).filter(chat => !query || `${chat.name} ${chat.phone}`.toLocaleLowerCase("ar").includes(query));
  container.innerHTML = contacts.length ? `<h3>جهاتك على NEXVO</h3>${contacts.map(chat => `<button class="contact-result" type="button" data-open-contact="${escapeHtml(chat.id)}">${avatarMarkup(chat)}<span><strong>${escapeHtml(chat.name)}</strong><small>${escapeHtml(chat.phone)}</small></span><i>‹</i></button>`).join("")}` :
    `<p class="contacts-empty">${query ? "لا توجد جهة اتصال بهذا الاسم." : "لم تضف أرقامًا بعد. ابدأ بإضافة جهة اتصال."}</p>`;
}

function addPhoneContact(name, phone, photo = "") {
  const cleanName = String(name || "").trim();
  const cleanPhone = normalizePhone(phone);
  if (!cleanName || cleanPhone.replace(/\D/g, "").length < 7) throw new Error("أدخل اسمًا ورقم هاتف صالحًا.");
  const existing = conversations.find(chat => chat.phone && normalizePhone(chat.phone) === cleanPhone);
  if (existing) return existing;
  const id = `contact-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const chat = {
    id, name: cleanName, phone: cleanPhone, photo: photo || "", initials: cleanName.slice(0, 1),
    color: "#d8f2e9", ink: "#157963", time: "الآن", preview: "ابدأ محادثة جديدة",
    online: false, unread: 0, favorite: false, pinned: false, messages: []
  };
  conversations.unshift(chat);
  phoneContacts = [...phoneContacts.filter(contact => normalizePhone(contact.phone) !== cleanPhone), { name: cleanName, phone: cleanPhone }];
  persist("wesal-phone-contacts", phoneContacts, "تعذر حفظ جهات الاتصال");
  saveConversations();
  return chat;
}

function avatarMarkup(person, sizeClass = "") {
  const safeName = escapeHtml(person.name);
  if (person.photo) return `<span class="avatar-wrap ${sizeClass}"><img class="avatar profile-photo" src="${person.photo}" alt="${safeName}">${person.online ? '<i class="online-dot" aria-label="متصل الآن"></i>' : ""}</span>`;
  return `<span class="avatar-wrap ${sizeClass}"><span class="avatar" style="--avatar-bg:${escapeHtml(person.color || "#e6f0e8")};--avatar-ink:${escapeHtml(person.ink || "#477a61")}" aria-label="${safeName}">${escapeHtml(person.initials || person.name.slice(0, 1))}</span>${person.online ? '<i class="online-dot" aria-label="متصل الآن"></i>' : ""}</span>`;
}

function filteredConversations() {
  const query = searchInput.value.trim().toLocaleLowerCase("ar");
  return conversations.filter(chat => {
    const matchesQuery = !query || chat.name.toLocaleLowerCase("ar").includes(query) || chat.preview.toLocaleLowerCase("ar").includes(query);
    const matchesUnread = (!unreadOnly && currentFilter !== "unread") || chat.unread > 0;
    const matchesFavorite = currentFilter !== "favorites" || chat.favorite;
    return matchesQuery && matchesUnread && matchesFavorite;
  }).sort((a, b) => Number(b.pinned) - Number(a.pinned));
}

function renderConversations() {
  const shown = filteredConversations();
  list.innerHTML = shown.map(chat => `
    <button class="conversation ${chat.id === activeId ? "selected" : ""}" type="button" data-id="${escapeHtml(chat.id)}" aria-label="محادثة ${escapeHtml(chat.name)}">
      ${avatarMarkup(chat)}
      <span class="conversation-details">
        <span class="conversation-top">
          <span class="conversation-name">${escapeHtml(chat.name)}</span>
          <span class="conversation-time">${escapeHtml(chat.time)}</span>
        </span>
        <span class="conversation-bottom">
          <span class="conversation-preview ${chat.unread ? "unread" : ""}">${escapeHtml(chat.preview)}</span>
          ${chat.unread ? `<span class="unread-badge">${chat.unread}</span>` : chat.pinned ? '<svg class="pin-icon" viewBox="0 0 24 24" aria-label="مثبتة"><path d="m16 3 5 5-3 1-4 4v4l-2 2-2-5-5-5 2-2h4l4-4Z"/></svg>' : ""}
        </span>
      </span>
    </button>`).join("");
  document.querySelector("#emptyState").hidden = shown.length > 0;
  document.querySelector("#chatCount").textContent = conversations.length;
  document.querySelector("#unreadCount").textContent = conversations.reduce((sum, chat) => sum + (chat.unread ? 1 : 0), 0);
}

function renderActiveConversation() {
  const chat = conversations.find(item => item.id === activeId);
  if (!chat) return;
  appPage.hidden = true;
  welcomeScreen.hidden = true;
  conversationView.hidden = false;
  document.querySelector("#chatPerson").innerHTML = `${avatarMarkup(chat)}<span class="person-text"><strong>${escapeHtml(chat.name)}</strong><span>${chat.online ? "متصل الآن" : "آخر ظهور مؤخرًا"}</span></span>`;
  const messageMarkup = chat.messages.map(message => `
    <div class="message-row ${message.from === "sent" ? "sent" : "received"}">
      <div class="message-bubble">${message.attachment ? mediaMessageMarkup(message.attachment) : ""}${message.text ? `<span class="message-text">${escapeHtml(message.text)}</span>` : ""}<span class="message-meta">${escapeHtml(message.time)}${message.from === "sent" ? '<span class="checks" aria-label="تم الإرسال">✓✓</span>' : ""}</span></div>
    </div>`).join("");
  messages.innerHTML = `<div class="day-divider">اليوم</div>${messageMarkup}`;
  hydrateMediaElements(messages);
  const blocked = blockedContacts.includes(chat.id);
  document.querySelector("#blockedBanner").hidden = !blocked;
  document.querySelector("#messageInput").disabled = blocked;
  document.querySelector("#sendButton").disabled = blocked;
  document.querySelector("#attachButton").disabled = blocked;
  document.querySelector("#voiceButton").disabled = blocked || voiceRecording;
  updateComposerMode();
  messages.scrollTop = messages.scrollHeight;
  renderConversations();
}

function mediaMessageMarkup(attachment) {
  const safeName = escapeHtml(attachment.name);
  const isVideo = attachment.type.startsWith("video/");
  const isAudio = attachment.type.startsWith("audio/");
  const isImage = attachment.type.startsWith("image/");
  if (isAudio) return `<div class="audio-message"><span class="audio-message-icon">♫</span><audio controls preload="metadata" data-audio-src="${escapeHtml(attachment.id)}" aria-label="رسالة صوتية"></audio><span class="media-file-name">${safeName}</span></div>`;
  if (!isVideo && !isImage) return `<a class="document-message" data-document-href="${escapeHtml(attachment.id)}" data-document-name="${safeName}" href="#" download="${safeName}"><span class="document-message-icon">▤</span><span><strong>${safeName}</strong><small>${formatFileSize(attachment.size)}</small></span><span class="document-download-icon">↓</span></a>`;
  return `<button class="message-media-button" type="button" data-media-id="${escapeHtml(attachment.id)}" data-media-type="${isVideo ? "video" : "image"}" data-media-name="${safeName}" aria-label="عرض ${isVideo ? "الفيديو" : "الصورة"}: ${safeName}">${isVideo ? `<span class="video-thumbnail" data-video-thumb="${escapeHtml(attachment.id)}">▶</span>` : `<img class="message-media-image" data-media-src="${escapeHtml(attachment.id)}" alt="${safeName}" loading="lazy">`}<span class="media-file-name">${safeName}</span></button>`;
}

async function hydrateMediaElements(container) {
  const elements = [...container.querySelectorAll("[data-media-src], [data-video-thumb], [data-audio-src], [data-document-href]")];
  await Promise.all(elements.map(async element => {
    const id = element.dataset.mediaSrc || element.dataset.videoThumb || element.dataset.audioSrc || element.dataset.documentHref;
    try {
      const url = await getMediaUrl(id);
      if (!element.isConnected) return;
      if (element.tagName === "IMG" || element.tagName === "AUDIO") element.src = url;
      else if (element.tagName === "A") element.href = url;
      else element.style.backgroundImage = `linear-gradient(#0005,#0005),url("${url}")`;
    } catch (error) {
      if (element.isConnected) element.textContent = "تعذر تحميل الوسيط";
    }
  }));
}

function openConversation(id) {
  const chat = conversations.find(item => item.id === id);
  if (!chat) return;
  if (voiceRecording) cancelVoiceRecording();
  activePage = "chats";
  activeId = id;
  chat.unread = 0;
  saveConversations();
  renderActiveConversation();
  document.body.classList.add("panel-open", "chat-open");
  document.body.classList.remove("page-open");
  messageInput.focus({ preventScroll: true });
}

function showToast(text, duration = 2400) {
  toast.textContent = text;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), duration);
}

function sendMessage(text, attachment = null) {
  const cleanText = text.trim();
  const chat = conversations.find(item => item.id === activeId);
  if ((!cleanText && !attachment) || !chat) return;
  if (blockedContacts.includes(chat.id)) {
    showToast("ألغِ حظر جهة الاتصال أولاً لإرسال رسالة");
    return;
  }
  const time = new Intl.DateTimeFormat("ar", { hour: "numeric", minute: "2-digit" }).format(new Date());
  chat.messages.push({ text: cleanText, attachment, time, from: "sent" });
  chat.preview = attachment
    ? `${attachment.type.startsWith("video/") ? "فيديو" : attachment.type.startsWith("audio/") ? "رسالة صوتية" : attachment.type.startsWith("image/") ? "صورة" : "مستند"} · ${attachment.name}`
    : cleanText;
  chat.time = "الآن";
  conversations = [chat, ...conversations.filter(item => item.id !== chat.id)];
  saveConversations();
  renderActiveConversation();
  messageInput.value = "";
  messageInput.style.height = "auto";
  updateComposerMode();
  messageInput.focus();
}

async function prepareMediaDraft(file) {
  if (blockedContacts.includes(activeId)) return showToast("ألغِ حظر جهة الاتصال أولاً لإرسال ملف");
  if (!file) return;
  showToast("جارٍ تجهيز الوسائط...", 240000);
  try {
    const kind = mediaKind(file);
    if (!kind) throw new Error("نوع الملف غير مدعوم");
    const blob = kind === "image" || kind === "video" ? await prepareMediaFile(file) : file;
    if (activeMediaDraft?.previewUrl) URL.revokeObjectURL(activeMediaDraft.previewUrl);
    const name = blob.name || (blob.type === "image/webp" && file.type !== "image/webp"
      ? file.name.replace(/\.[^.]+$/, ".webp")
      : file.name);
    activeMediaDraft = { blob, name, type: blob.type || file.type, previewUrl: URL.createObjectURL(blob) };
    renderMediaDraft();
    const percent = file.size ? Math.round((1 - blob.size / file.size) * 100) : 0;
    showToast(blob.size < file.size
      ? `تم ضغط الملف مع الحفاظ على أبعاده (${percent}% أصغر)`
      : "لم ينتج الضغط حجمًا أصغر؛ احتفظنا بالملف الأصلي دون تغيير");
  } catch (error) {
    showToast(error.message || "تعذر تجهيز الملف");
  }
}

function renderMediaDraft() {
  const container = document.querySelector("#mediaDraft");
  if (!activeMediaDraft) {
    container.hidden = true;
    container.replaceChildren();
    return;
  }
  const preview = activeMediaDraft.type.startsWith("video/")
    ? `<video src="${activeMediaDraft.previewUrl}" controls muted playsinline></video>`
    : activeMediaDraft.type.startsWith("image/")
      ? `<img src="${activeMediaDraft.previewUrl}" alt="${escapeHtml(activeMediaDraft.name)}">`
      : activeMediaDraft.type.startsWith("audio/")
        ? `<audio src="${activeMediaDraft.previewUrl}" controls></audio>`
        : `<span class="draft-document-icon">▤</span>`;
  container.innerHTML = `<div class="draft-preview">${preview}<span>${escapeHtml(activeMediaDraft.name)}</span></div><button class="draft-remove" id="removeMediaDraft" type="button" aria-label="إزالة المرفق">×</button><span class="draft-ready">جاهز للإرسال</span>`;
  container.hidden = false;
  document.querySelector("#removeMediaDraft").addEventListener("click", clearMediaDraft);
  updateComposerMode();
}

function clearMediaDraft() {
  if (activeMediaDraft?.previewUrl) URL.revokeObjectURL(activeMediaDraft.previewUrl);
  activeMediaDraft = null;
  renderMediaDraft();
  updateComposerMode();
}

async function sendMediaDraft() {
  if (!activeMediaDraft || !activeId) return;
  if (blockedContacts.includes(activeId)) return showToast("ألغِ حظر جهة الاتصال أولاً لإرسال ملف");
  const draft = activeMediaDraft;
  const attachment = await putMedia(draft.blob, draft.name, draft.type);
  clearMediaDraft();
  sendMessage("", attachment);
}

function updateComposerMode() {
  const hasText = Boolean(messageInput.value.trim());
  const showSend = hasText || Boolean(activeMediaDraft);
  const recording = voiceRecording;
  document.querySelector("#sendButton").hidden = recording || !showSend;
  document.querySelector("#voiceButton").hidden = recording || showSend;
  document.querySelector("#recordingIndicator").hidden = !recording;
  document.querySelector("#recordCancelButton").hidden = !recording;
  document.querySelector("#recordStopButton").hidden = !recording;
  document.querySelector("#attachButton").hidden = recording;
  document.querySelector("#emojiButton").hidden = recording;
  messageInput.hidden = recording;
  document.querySelector("#messageForm").classList.toggle("is-recording", recording);
}

function updateRecordingTimer() {
  const seconds = Math.floor((Date.now() - voiceStartedAt) / 1000);
  document.querySelector("#recordingTimer").textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

async function startVoiceRecording() {
  if (voiceRecording) return stopVoiceRecording();
  if (!activeId) return;
  if (blockedContacts.includes(activeId)) return showToast("ألغِ الحظر أولًا لتسجيل رسالة صوتية");
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    return showToast("تسجيل الصوت غير مدعوم. استخدم HTTPS أو localhost ومتصفحًا حديثًا");
  }
  try {
    voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const supportedType = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find(type => MediaRecorder.isTypeSupported(type));
    voiceRecorder = new MediaRecorder(voiceStream, supportedType ? { mimeType: supportedType } : undefined);
    voiceChunks = [];
    voiceCancelled = false;
    const targetChatId = activeId;
    voiceRecorder.addEventListener("dataavailable", event => {
      if (event.data.size) voiceChunks.push(event.data);
    });
    voiceRecorder.addEventListener("error", () => {
      voiceCancelled = true;
      stopVoiceResources();
      voiceRecording = false;
      updateComposerMode();
      showToast("حدث خطأ أثناء تسجيل الصوت");
    }, { once: true });
    voiceRecorder.addEventListener("stop", async () => {
      const blob = new Blob(voiceChunks, { type: voiceRecorder?.mimeType || voiceChunks[0]?.type || "audio/webm" });
      const cancelled = voiceCancelled || !blob.size;
      stopVoiceResources();
      voiceRecording = false;
      updateComposerMode();
      if (cancelled) return;
      if (activeId !== targetChatId || blockedContacts.includes(targetChatId)) {
        showToast("أُلغي الإرسال لأن المحادثة تغيّرت أو أصبحت محظورة");
        return;
      }
      try {
        const extension = blob.type.includes("ogg") ? "ogg" : blob.type.includes("mp4") ? "m4a" : "webm";
        const attachment = await putMedia(blob, `رسالة صوتية.${extension}`, blob.type || "audio/webm");
        sendMessage("", attachment);
        showToast("تم إرسال الرسالة الصوتية");
      } catch (error) {
        showToast(error.message || "تعذر حفظ الرسالة الصوتية");
      }
    }, { once: true });
    voiceRecorder.start(250);
    voiceRecording = true;
    voiceStartedAt = Date.now();
    document.querySelector("#recordingTimer").textContent = "00:00";
    updateComposerMode();
    voiceTimer = window.setInterval(updateRecordingTimer, 250);
  } catch (error) {
    stopVoiceResources();
    showToast(error.name === "NotAllowedError" ? "لم تسمح باستخدام الميكروفون" : error.message || "تعذر بدء تسجيل الصوت");
  }
}

function stopVoiceRecording() {
  if (!voiceRecording || !voiceRecorder || voiceRecorder.state === "inactive") return;
  voiceRecorder.stop();
}

function cancelVoiceRecording() {
  if (!voiceRecording) return;
  voiceCancelled = true;
  if (voiceRecorder && voiceRecorder.state !== "inactive") voiceRecorder.stop();
  else {
    stopVoiceResources();
    voiceRecording = false;
    updateComposerMode();
  }
  showToast("تم إلغاء التسجيل");
}

function stopVoiceResources() {
  clearInterval(voiceTimer);
  voiceTimer = null;
  voiceStream?.getTracks().forEach(track => track.stop());
  voiceStream = null;
  voiceRecorder = null;
  voiceChunks = [];
}

async function showMedia(id, type, name) {
  const viewer = document.querySelector("#mediaViewer");
  try {
    const url = await getMediaUrl(id);
    viewer.innerHTML = `${type === "video" ? `<video src="${url}" controls autoplay playsinline></video>` : `<img src="${url}" alt="${escapeHtml(name)}">`}<a class="media-download" href="${url}" download="${escapeHtml(name)}">تنزيل الملف</a>`;
    document.querySelector("#mediaDialog").showModal();
  } catch (error) {
    showToast(error.message || "تعذر عرض الملف");
  }
}

function startRingTone() {
  stopRingTone();
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    ringContext = new AudioContextClass();
    ringContext.resume();
    const playPulse = () => {
      if (!ringContext || !currentCall) return;
      const start = ringContext.currentTime;
      [0, 0.22, 0.62, 0.84].forEach(offset => {
        const oscillator = ringContext.createOscillator();
        const gain = ringContext.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = 440;
        gain.gain.setValueAtTime(0.0001, start + offset);
        gain.gain.exponentialRampToValueAtTime(0.08, start + offset + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.18);
        oscillator.connect(gain).connect(ringContext.destination);
        oscillator.start(start + offset);
        oscillator.stop(start + offset + 0.2);
        ringOscillators.push(oscillator);
        oscillator.addEventListener("ended", () => {
          ringOscillators = ringOscillators.filter(item => item !== oscillator);
          oscillator.disconnect();
          gain.disconnect();
        }, { once: true });
      });
    };
    playPulse();
    ringTimer = setInterval(playPulse, 2600);
  } catch {
    showToast("تعذر تشغيل صوت الرنين في هذا المتصفح");
  }
}

function stopRingTone() {
  clearInterval(ringTimer);
  ringTimer = null;
  ringOscillators.forEach(oscillator => {
    try { oscillator.stop(); } catch { /* already stopped */ }
  });
  ringOscillators = [];
  if (ringContext) {
    ringContext.close();
    ringContext = null;
  }
}

function stopCallResources() {
  stopRingTone();
  if (currentCallStream) currentCallStream.getTracks().forEach(track => track.stop());
  currentCallStream = null;
  const preview = document.querySelector("#callVideoPreview");
  preview.pause();
  preview.srcObject = null;
  preview.hidden = true;
  document.querySelector("#callAvatar").hidden = false;
}

function showPage(page) {
  if (voiceRecording) cancelVoiceRecording();
  activePage = page;
  const names = { updates: "التحديثات", calls: "المكالمات", settings: "الإعدادات", profile: "الملف الشخصي", contact: "معلومات جهة الاتصال" };
  document.querySelector("#pageTitle").textContent = names[page] || "NEXVO";
  welcomeScreen.hidden = true;
  conversationView.hidden = true;
  appPage.hidden = false;
  document.body.classList.add("panel-open", "page-open");
  document.body.classList.remove("chat-open");
  document.querySelectorAll(".nav-item").forEach(button => button.classList.toggle("active", button.dataset.view === page));
  if (page === "updates") renderUpdatesPage();
  else if (page === "calls") renderCallsPage();
  else if (page === "settings") renderSettingsPage();
  else if (page === "profile") renderProfilePage();
  else if (page === "contact") renderContactPage();
}

function showChats() {
  if (voiceRecording) cancelVoiceRecording();
  activePage = "chats";
  document.body.classList.remove("panel-open", "page-open", "chat-open");
  appPage.hidden = true;
  conversationView.hidden = true;
  welcomeScreen.hidden = false;
  document.querySelectorAll(".nav-item").forEach(button => button.classList.toggle("active", button.dataset.view === "chats"));
  renderConversations();
}

function statusCircleMarkup(person, { own = false, viewed = false, count = 1 } = {}) {
  const initials = escapeHtml(person.initials || person.name.slice(0, 1));
  const avatar = person.photo
    ? `<img src="${person.photo}" alt="">`
    : `<span style="--avatar-bg:${escapeHtml(person.color || "#e8f5ed")};--avatar-ink:${escapeHtml(person.ink || "#16875d")}">${initials}</span>`;
  return `<span class="status-circle ${viewed ? "viewed" : "unviewed"} ${own ? "own-status-circle" : ""}">${avatar}${own ? '<i class="status-add-badge">+</i>' : ""}${count > 1 ? `<i class="status-count">${count}</i>` : ""}</span>`;
}

function renderUpdatesPage() {
  const contacts = [];
  const own = { id: "own", name: profile.name, initials: profile.name.slice(0, 1), photo: profile.photo };
  const ownStories = [...stories].sort((a, b) => a.createdAt - b.createdAt);
  const statusRow = person => {
    const viewed = person.stories.every(story => storyReads.includes(story.id));
    const newest = person.stories[person.stories.length - 1];
    return `<button class="status-row" type="button" data-friend-story="${person.id}">
      ${statusCircleMarkup(person, { viewed, count: person.stories.length })}
      <span class="status-copy"><strong>${escapeHtml(person.name)}</strong><span>${escapeHtml(newest.time)} · ${person.stories.length} حالة</span></span>
    </button>`;
  };
  const ownStoryCards = ownStories.map((story, index) => `<button class="own-story-card" type="button" data-own-story="${index}" data-story-id="${escapeHtml(story.id)}" aria-label="عرض ${story.type === "video" ? "فيديو" : "حالة"} رقم ${index + 1}">
    <span class="own-story-thumbnail ${story.type === "video" ? "video-story-thumbnail" : ""}" id="ownStoryThumb-${escapeHtml(story.id)}">${story.type === "video" ? "▶" : "حالة نصية"}</span>
    <span>${story.type === "video" ? "فيديو" : story.type === "image" ? "صورة" : escapeHtml(story.text || "حالة نصية")}</span>
  </button>`).join("");
  const freshContacts = contacts.filter(person => !person.stories.every(story => storyReads.includes(story.id)));
  const viewedContacts = contacts.filter(person => person.stories.every(story => storyReads.includes(story.id)));
  pageContent.innerHTML = `
    <div class="updates-intro"><p class="eyebrow">شارك لحظاتك مع من تحب</p><h3>الحالة</h3><p>الصور والفيديوهات تختفي بعد ٢٤ ساعة.</p></div>
    <section class="status-section" aria-label="حالتي">
      <div class="status-row own-status-row">
        <button class="own-status-open" id="openOwnStoriesButton" type="button" aria-label="${ownStories.length ? "عرض حالتي" : "أضف أول حالة"}">
          ${statusCircleMarkup(own, { own: true, viewed: ownStories.length === 0, count: ownStories.length })}
        </button>
        <button class="status-copy own-status-copy" id="openOwnStoriesTextButton" type="button"><strong>حالتي</strong><span>${ownStories.length ? `${ownStories.length} تحديث · اضغط للعرض` : "أضف تحديثًا عن يومك"}</span></button>
        <button class="status-upload-button" id="addStoryButton" type="button" aria-label="إضافة صور أو فيديو للحالة" title="إضافة صور أو فيديو">+</button>
      </div>
    </section>
    ${ownStories.length ? `<section class="own-stories-section" aria-label="حالاتي"><h3 class="page-section-title">حالاتي المنشورة</h3><div class="my-stories">${ownStoryCards}</div></section>` : ""}
    <h3 class="page-section-title">آخر التحديثات</h3>
    <div class="status-list">${freshContacts.map(statusRow).join("") || '<p class="status-empty">لا توجد تحديثات جديدة</p>'}</div>
    ${viewedContacts.length ? `<div class="status-muted-title">الحالات التي شاهدتها</div><div class="status-list viewed-status-list">${viewedContacts.map(statusRow).join("")}</div>` : ""}
    <p class="privacy-hint">حالاتك المنشورة محفوظة على هذا الجهاز فقط.</p>`;
  const openOwnStories = () => {
    if (ownStories.length) openStoryGroup(ownStories, profile.name, true, 0);
    else storyInput.click();
  };
  document.querySelector("#openOwnStoriesButton").addEventListener("click", openOwnStories);
  document.querySelector("#openOwnStoriesTextButton").addEventListener("click", openOwnStories);
  document.querySelector("#addStoryButton").addEventListener("click", () => storyInput.click());
  pageContent.querySelectorAll("[data-own-story]").forEach(button => button.addEventListener("click", () => openOwnStory(Number(button.dataset.ownStory))));
  ownStories.forEach(story => {
    if (!story.mediaId || !["image", "video"].includes(story.type)) return;
    getMediaUrl(story.mediaId).then(url => {
      const thumb = document.getElementById(`ownStoryThumb-${story.id}`);
      if (!thumb) return;
      if (story.type === "video") {
        thumb.innerHTML = `<video src="${url}" muted playsinline autoplay loop preload="metadata"></video><i>▶</i>`;
        thumb.querySelector("video").addEventListener("error", () => {
          thumb.replaceChildren(document.createTextNode("▶ فيديو"));
          thumb.classList.add("media-preview-fallback");
        }, { once: true });
      } else {
        thumb.innerHTML = `<img src="${url}" alt="معاينة الحالة">`;
        thumb.querySelector("img").addEventListener("error", () => {
          thumb.textContent = "صورة";
          thumb.classList.add("media-preview-fallback");
        }, { once: true });
      }
    }).catch(() => {
      const thumb = document.getElementById(`ownStoryThumb-${story.id}`);
      if (thumb) {
        thumb.textContent = story.type === "video" ? "▶ فيديو" : "صورة";
        thumb.classList.add("media-preview-fallback");
      }
    });
  });
  pageContent.querySelectorAll("[data-friend-story]").forEach(button => button.addEventListener("click", () => {
    const person = contacts.find(item => item.id === button.dataset.friendStory);
    if (person) openStoryGroup(person.stories, person.name, false, 0, person.id);
  }));
}

function renderCallsPage() {
  pageContent.innerHTML = `<div class="updates-intro"><p class="eyebrow">ابقَ على تواصل</p><h3>سجل المكالمات</h3><p>مكالماتك الأخيرة تظهر هنا على هذا الجهاز.</p></div>
    <div class="call-history">${calls.length ? calls.map(call => {
      const person = conversations.find(item => item.id === call.id);
      if (!person) return "";
      const missed = call.type === "missed";
      return `<div class="call-row">${avatarMarkup(person)}<span class="status-copy"><strong>${escapeHtml(person.name)}</strong><span class="${missed ? "missed-call" : ""}">${missed ? "مكالمة فائتة" : call.type === "incoming" ? "مكالمة واردة" : "مكالمة صادرة"} · ${escapeHtml(call.time)}</span></span><button class="icon-button call-again" type="button" data-call-id="${escapeHtml(person.id)}" aria-label="اتصال بـ ${escapeHtml(person.name)}"><svg viewBox="0 0 24 24"><path d="M7 3.5 10 7l-2 2a14 14 0 0 0 7 7l2-2 3.5 3-.8 3c-.2.7-.9 1.1-1.6 1A17.5 17.5 0 0 1 3 5.9c-.1-.7.3-1.4 1-1.6Z"/></svg></button></div>`;
    }).join("") : '<p class="empty-page-copy">لا توجد مكالمات بعد. ابدأ مكالمة من إحدى محادثاتك.</p>'}</div>`;
  pageContent.querySelectorAll("[data-call-id]").forEach(button => button.addEventListener("click", () => startCall(button.dataset.callId, "voice")));
}

function renderProfilePage() {
  pageContent.innerHTML = `<div class="profile-card">
      <button class="profile-photo-button" id="changeProfilePhoto" type="button" aria-label="تغيير الصورة">${profile.photo ? `<img src="${profile.photo}" alt="">` : `<span>${escapeHtml(profile.name.slice(0, 1))}</span>`}<i>✎</i></button>
      <p class="eyebrow">ملفي على NEXVO</p>
      <h3>${escapeHtml(profile.name)}</h3>
      <p>${escapeHtml(profile.about)}</p>
      <span class="profile-handle">@${escapeHtml(profile.username || "ضيف")}</span>
      <span class="profile-mood">${escapeHtml(profile.mood || "متاح")} <i>●</i></span>
    </div>
    <form class="profile-form" id="profileForm">
      <label class="form-field">الاسم<input name="name" maxlength="40" required value="${escapeHtml(profile.name)}"></label>
      <label class="form-field">اسم المستخدم<input name="username" maxlength="24" required pattern="[A-Za-z0-9_.]+" value="${escapeHtml(profile.username || "")}" placeholder="username"></label>
      <label class="form-field">النبذة<input name="about" maxlength="80" value="${escapeHtml(profile.about)}"></label>
      <label class="form-field">حالتي الآن<select name="mood"><option ${profile.mood === "متاح" ? "selected" : ""}>متاح</option><option ${profile.mood === "أركز" ? "selected" : ""}>أركز</option><option ${profile.mood === "في استراحة" ? "selected" : ""}>في استراحة</option><option ${profile.mood === "أستكشف" ? "selected" : ""}>أستكشف</option></select></label>
      <label class="form-field">رقم الهاتف<input name="phone" maxlength="24" value="${escapeHtml(profile.phone)}" inputmode="tel"></label>
      <label class="form-field">تغيير كلمة المرور <small>اختياري</small><input name="password" type="password" minlength="8" autocomplete="new-password" placeholder="اتركها فارغة للإبقاء عليها"></label>
      <button class="primary-button" type="submit">حفظ التغييرات</button>
    </form>
    <div class="profile-info"><span>بطاقتي الرقمية</span><strong>@${escapeHtml(profile.username || "ضيف")} · ${escapeHtml(profile.mood || "متاح")}</strong><button class="secondary-button" id="copyProfileCard" type="button">نسخ معرّفي</button></div>
    <div class="profile-info"><span>خصوصيتك</span><strong>صورتك وبياناتك محفوظة على هذا الجهاز فقط</strong></div>`;
  document.querySelector("#changeProfilePhoto").addEventListener("click", () => document.querySelector("#profilePhotoInput").click());
  document.querySelector("#profileForm").addEventListener("submit", event => {
    event.preventDefault();
    (async () => {
      const values = new FormData(event.currentTarget);
      profile.name = String(values.get("name")).trim();
      profile.username = String(values.get("username")).trim().toLowerCase();
      profile.about = String(values.get("about")).trim();
      profile.mood = String(values.get("mood"));
      profile.phone = String(values.get("phone")).trim();
      const newPassword = String(values.get("password"));
      const activeUsername = loadStoredValue("wesal-session", null);
      const accounts = loadAccounts();
      const accountIndex = accounts.findIndex(item => item.username === activeUsername);
      if (newPassword) {
        if (accountIndex < 0) throw new Error("لا يوجد حساب لتغيير كلمة مروره.");
      }
      if (accountIndex >= 0) {
        const account = accounts[accountIndex];
        account.username = profile.username;
        account.displayName = profile.name;
        account.phone = profile.phone;
        account.photo = profile.photo;
        if (newPassword) {
          const result = await hashPassword(newPassword);
          account.salt = result.salt;
          account.passwordHash = result.hash;
        }
        accounts[accountIndex] = account;
        if (!saveAccounts(accounts) || !persist("wesal-session", account.username, "تعذر تحديث جلسة الدخول")) return;
      }
      const saved = persist("wesal-profile", profile, "تعذر حفظ الملف الشخصي");
      updateProfileShortcut();
      if (saved) showToast("تم تحديث بطاقتك الرقمية");
      renderProfilePage();
    })().catch(error => showToast(error.message || "تعذر تحديث الملف الشخصي"));
  });
  document.querySelector("#copyProfileCard").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(`@${profile.username || "ضيف"} · ${profile.name}`);
      showToast("تم نسخ معرّفك");
    } catch {
      showToast("تعذر النسخ؛ اسم المستخدم هو @" + (profile.username || "ضيف"));
    }
  });
}

function renderSettingsPage() {
  pageContent.innerHTML = `<div class="updates-intro"><p class="eyebrow">مساحتك، بطريقتك</p><h3>إعدادات NEXVO</h3><p>أدوات ذكية لتجربة أكثر هدوءًا وخصوصية.</p></div>
    <div class="settings-list">
      <button class="settings-row" id="notificationsSetting" type="button"><span class="settings-icon">♧</span><span class="status-copy"><strong>الإشعارات</strong><span>إظهار تنبيهات الرسائل</span></span><span class="toggle ${preferences.notifications ? "on" : ""}"></span></button>
      <button class="settings-row" id="privacySetting" type="button"><span class="settings-icon">⌑</span><span class="status-copy"><strong>خصوصية الحالة</strong><span>مشاركة الحالة مع جهات الاتصال</span></span><span class="toggle ${preferences.privacy ? "on" : ""}"></span></button>
      <button class="settings-row" id="themeSetting" type="button"><span class="settings-icon">◐</span><span class="status-copy"><strong>المظهر</strong><span>${preferences.dark ? "الوضع الداكن" : "الوضع الفاتح"}</span></span><span class="toggle ${preferences.dark ? "on" : ""}"></span></button>
      <button class="settings-row" id="focusSetting" type="button"><span class="settings-icon">✧</span><span class="status-copy"><strong>مساحة التركيز</strong><span>أخفِ التشتيت وخذ وقتك لنفسك</span></span><span class="toggle ${preferences.focus ? "on" : ""}"></span></button>
      <button class="settings-row" id="openProfileSetting" type="button"><span class="settings-icon">☺</span><span class="status-copy"><strong>الملف الشخصي</strong><span>تعديل الاسم والصورة والنبذة</span></span><span class="settings-arrow">‹</span></button>
      <button class="settings-row" id="openContactsSetting" type="button"><span class="settings-icon">＋</span><span class="status-copy"><strong>دفتر NEXVO</strong><span>إضافة أرقام من الهاتف أو يدويًا</span></span><span class="settings-arrow">‹</span></button>
      <button class="settings-row" id="openPermissionsSetting" type="button"><span class="settings-icon">⌑</span><span class="status-copy"><strong>أذونات الجهاز</strong><span>الكاميرا والميكروفون والموقع</span></span><span class="settings-arrow">‹</span></button>
      <button class="settings-row" id="logoutSetting" type="button"><span class="settings-icon">↪</span><span class="status-copy"><strong>تسجيل الخروج</strong><span>قفل التطبيق على هذا الجهاز</span></span><span class="settings-arrow">‹</span></button>
    </div>`;
  document.querySelector("#notificationsSetting").addEventListener("click", toggleNotifications);
  document.querySelector("#privacySetting").addEventListener("click", () => updatePreference("privacy"));
  document.querySelector("#themeSetting").addEventListener("click", () => updatePreference("dark"));
  document.querySelector("#focusSetting").addEventListener("click", () => {
    preferences.focus = !preferences.focus;
    persist("wesal-preferences", preferences, "تعذر حفظ إعداد مساحة التركيز");
    document.body.classList.toggle("focus-mode", preferences.focus);
    renderSettingsPage();
    showToast(preferences.focus ? "تم تفعيل مساحة التركيز" : "تم إيقاف مساحة التركيز");
  });
  document.querySelector("#openProfileSetting").addEventListener("click", () => showPage("profile"));
  document.querySelector("#openContactsSetting").addEventListener("click", openContactsDialog);
  document.querySelector("#openPermissionsSetting").addEventListener("click", () => permissionDialog.showModal());
  document.querySelector("#logoutSetting").addEventListener("click", () => {
    if (!window.confirm("سيُقفل التطبيق. ستبقى بياناتك محفوظة على هذا الجهاز. هل تريد المتابعة؟")) return;
    try {
      localStorage.removeItem("wesal-session");
    } catch {
      showToast("تعذر تسجيل الخروج من هذا الجهاز");
      return;
    }
    activeId = null;
    showChats();
    setAuthMode("login");
    document.querySelector("#authDialog").showModal();
  });
}

function renderContactPage() {
  const chat = conversations.find(item => item.id === activeId);
  if (!chat) return showChats();
  pageContent.innerHTML = `<div class="profile-card contact-card">${avatarMarkup(chat)}<p class="eyebrow">معلومات جهة الاتصال</p><h3>${escapeHtml(chat.name)}</h3><p>${chat.online ? "متصل الآن" : "آخر ظهور مؤخرًا"}</p><div class="contact-actions"><button class="primary-button" id="contactMessageButton" type="button">إرسال رسالة</button><button class="secondary-button" id="contactCallButton" type="button">اتصال صوتي</button></div></div>
    ${chat.phone ? `<div class="profile-info"><span>رقم الهاتف</span><strong dir="ltr">${escapeHtml(chat.phone)}</strong></div>` : ""}
    <div class="profile-info"><span>النبذة</span><strong>متاح للتواصل عبر NEXVO</strong></div>
    <button class="settings-row contact-favorite" id="contactFavoriteButton" type="button"><span class="settings-icon">☆</span><span class="status-copy"><strong>${chat.favorite ? "إزالة من المفضلة" : "إضافة إلى المفضلة"}</strong><span>إدارة جهات الاتصال المفضلة</span></span></button>
    <button class="settings-row block-contact-action" id="blockContactPageButton" type="button"><span class="settings-icon">⊘</span><span class="status-copy"><strong>${blockedContacts.includes(chat.id) ? "إلغاء حظر جهة الاتصال" : "حظر جهة الاتصال"}</strong><span>${blockedContacts.includes(chat.id) ? "السماح بالرسائل والمكالمات مجددًا" : "لن تستقبل رسائل أو مكالمات منها"}</span></span></button>
    <button class="settings-row report-contact-action" id="reportContactButton" type="button"><span class="settings-icon">⚑</span><span class="status-copy"><strong>الإبلاغ عن جهة الاتصال</strong><span>إبلاغ تجريبي على هذا الجهاز</span></span></button>`;
  document.querySelector("#contactMessageButton").addEventListener("click", () => openConversation(chat.id));
  document.querySelector("#contactCallButton").addEventListener("click", () => startCall(chat.id, "voice"));
  document.querySelector("#contactFavoriteButton").addEventListener("click", () => {
    chat.favorite = !chat.favorite;
    saveConversations();
    renderContactPage();
  });
  document.querySelector("#blockContactPageButton").addEventListener("click", () => toggleContactBlock(chat));
  document.querySelector("#reportContactButton").addEventListener("click", () => {
    if (window.confirm(`هل تريد الإبلاغ عن ${chat.name}؟`)) showToast("تم تسجيل البلاغ في هذا النموذج التجريبي");
  });
}

function toggleContactBlock(chat) {
  if (blockedContacts.includes(chat.id)) blockedContacts = blockedContacts.filter(id => id !== chat.id);
  else blockedContacts.push(chat.id);
  persist("wesal-blocked", blockedContacts, "تعذر حفظ إعداد الحظر");
  renderActiveConversation();
  if (activePage === "contact") renderContactPage();
  if (activePage === "chats") showToast(blockedContacts.includes(chat.id) ? `تم حظر ${chat.name}` : `تم إلغاء حظر ${chat.name}`);
}

function updatePreference(key) {
  preferences[key] = !preferences[key];
  persist("wesal-preferences", preferences, "تعذر حفظ الإعداد");
  applyTheme();
  renderSettingsPage();
}

async function toggleNotifications() {
  if (!preferences.notifications && "Notification" in window && Notification.permission === "default") {
    try {
      const result = await Notification.requestPermission();
      if (result !== "granted") {
        showToast("لم يتم السماح بالإشعارات من المتصفح");
        preferences.notifications = false;
        return renderSettingsPage();
      }
    } catch {
      showToast("تعذر طلب إذن الإشعارات");
      return;
    }
  }
  preferences.notifications = !preferences.notifications;
  persist("wesal-preferences", preferences, "تعذر حفظ إعداد الإشعارات");
  renderSettingsPage();
}

function applyTheme() {
  document.body.classList.toggle("dark-theme", preferences.dark);
  document.body.classList.toggle("focus-mode", Boolean(preferences.focus));
}

async function openOwnStory(index) {
  const ownStories = [...stories].sort((a, b) => a.createdAt - b.createdAt);
  if (ownStories[index]) openStoryGroup(ownStories, profile.name, true, index);
}

function openStoryGroup(items, author, own, startIndex = 0, contactId = null) {
  if (!items.length) return;
  clearInterval(storyProgressTimer);
  storyPaused = false;
  activeStoryGroup = { items, author, own, contactId };
  activeStoryIndex = Math.min(Math.max(startIndex, 0), items.length - 1);
  storyElapsed = 0;
  if (!document.querySelector("#storyDialog").open) document.querySelector("#storyDialog").showModal();
  renderStoryFrame();
}

async function renderStoryFrame() {
  const viewer = document.querySelector("#storyViewer");
  const group = activeStoryGroup;
  if (!group) return;
  clearInterval(storyProgressTimer);
  const token = ++storyRenderToken;
  const story = group.items[activeStoryIndex];
  storyElapsed = 0;
  let source = story.data;
  try {
    if (story.mediaId) source = await getMediaUrl(story.mediaId);
  } catch (error) {
    showToast(error.message || "تعذر تحميل الحالة");
    closeStoryViewer();
    return;
  }
  if (token !== storyRenderToken || !activeStoryGroup) return;
  const content = story.type === "video" ? `<video class="story-media story-video" src="${source}" autoplay playsinline preload="auto"></video>` :
    story.type === "image" ? `<img class="story-media" src="${source}" alt="حالة ${escapeHtml(group.author)}">` :
    `<div class="story-text-card" style="background:${story.background}">${escapeHtml(story.text)}</div>`;
  const progress = group.items.map((_, index) => `<span class="story-progress-segment"><i style="width:${index < activeStoryIndex ? "100%" : "0%"}"></i></span>`).join("");
  const contact = group.contactId ? conversations.find(item => item.id === group.contactId) : null;
  const avatar = contact ? avatarMarkup(contact) : statusCircleMarkup({ name: group.author, initials: group.author.slice(0, 1), photo: group.own ? profile.photo : "" });
  viewer.innerHTML = `
    <div class="story-progress">${progress}</div>
    <header class="story-viewer-top">
      <div class="story-author">${avatar}<span><strong>${escapeHtml(group.author)}</strong><small>${escapeHtml(story.time || "الآن")}</small></span></div>
      <div class="story-viewer-actions">${group.own ? '<button class="story-action" id="storyMoreButton" type="button" aria-label="خيارات الحالة">⋮</button>' : ""}<button class="story-action" id="storyCloseButton" type="button" aria-label="إغلاق الحالة">×</button></div>
    </header>
    <div class="story-stage" id="storyStage">${content}
      <button class="story-hit-zone story-hit-prev" type="button" aria-label="الحالة السابقة"></button>
      <button class="story-hit-zone story-hit-next" type="button" aria-label="الحالة التالية"></button>
      <div class="story-caption">${escapeHtml(story.caption || story.text || "")}</div>
    </div>
    ${group.own ? '<div class="story-owner-footer"><span>👁　حالاتي</span><div><button class="story-add-action" id="storyAddButton" type="button">＋ إضافة</button><button class="story-delete-action" id="deleteStoryButton" type="button">حذف الحالة</button></div></div>' : `<form class="story-reply" id="storyReplyForm"><input id="storyReplyInput" maxlength="500" placeholder="الرد على الحالة..." aria-label="الرد على الحالة"><button type="submit" aria-label="إرسال الرد">➤</button></form>`}`;
  document.querySelector("#storyCloseButton").addEventListener("click", closeStoryViewer);
  document.querySelector("#storyStage").addEventListener("click", event => {
    if (storySwiped) {
      storySwiped = false;
      return;
    }
    if (event.target.closest(".story-hit-prev")) return showPreviousStory();
    if (event.target.closest(".story-hit-next")) return showNextStory();
    if (event.target.closest("video")) {
      const video = event.target.closest("video");
      storyPaused = !video.paused;
      if (video.paused) video.play().catch(() => {});
      else video.pause();
    }
  });
  document.querySelector("#storyStage").addEventListener("pointerdown", event => {
    if (event.target.closest("video")) return;
    storyPaused = true;
    document.querySelector("#storyStage video")?.pause();
  });
  document.querySelector("#storyStage").addEventListener("pointerup", () => {
    if (!storyPaused) return;
    storyPaused = false;
    const video = document.querySelector("#storyStage video");
    if (video && video.paused) video.play().catch(() => {});
  });
  document.querySelector("#storyStage").addEventListener("pointercancel", () => {
    if (!storyPaused) return;
    storyPaused = false;
    const video = document.querySelector("#storyStage video");
    if (video?.paused) video.play().catch(() => {});
  });
  document.querySelector("#storyStage").addEventListener("touchstart", event => {
    storyTouchStart = event.changedTouches[0].clientX;
  }, { passive: true });
  document.querySelector("#storyStage").addEventListener("touchend", event => {
    const difference = event.changedTouches[0].clientX - storyTouchStart;
    if (Math.abs(difference) > 55) {
      storySwiped = true;
      storyPaused = false;
      difference > 0 ? showPreviousStory() : showNextStory();
    }
  }, { passive: true });
  const video = document.querySelector("#storyStage video");
  const image = document.querySelector("#storyStage img");
  if (image) image.addEventListener("error", () => {
    if (token !== storyRenderToken) return;
    image.replaceWith(createStoryMediaFallback("تعذر عرض الصورة في هذا المتصفح"));
    startStoryProgress(5000);
    showToast("تم نشر الصورة، لكن المتصفح لا يدعم معاينتها");
  }, { once: true });
  if (video) {
    const beginVideoProgress = () => {
      if (token === storyRenderToken && Number.isFinite(video.duration)) startStoryProgress(Math.min(video.duration * 1000, 30000), video);
    };
    if (video.readyState >= 1) beginVideoProgress();
    else video.addEventListener("loadedmetadata", beginVideoProgress, { once: true });
    video.addEventListener("ended", () => {
      if (token === storyRenderToken) showNextStory();
    }, { once: true });
    video.addEventListener("error", () => {
      if (token !== storyRenderToken) return;
      video.replaceWith(createStoryMediaFallback("تم حفظ الفيديو، لكن صيغة الترميز غير مدعومة للتشغيل"));
      showToast("تم نشر الفيديو؛ جرّب MP4 بترميز H.264 أو WebM إذا لم يعمل");
      startStoryProgress(5000);
    }, { once: true });
    video.play().catch(() => {
      if (token !== storyRenderToken) return;
      video.controls = true;
      startStoryProgress(15000);
    });
  } else {
    startStoryProgress(5000);
  }
  if (!group.own && story.id && !storyReads.includes(story.id)) {
    storyReads.push(story.id);
    persist("wesal-story-reads", storyReads, "تعذر حفظ الحالات التي شاهدتها");
  }
  const deleteButton = document.querySelector("#deleteStoryButton");
  if (deleteButton) deleteButton.addEventListener("click", () => {
    if (!window.confirm("هل تريد حذف هذه الحالة؟")) return;
    const removedStory = group.items[activeStoryIndex];
    stories = stories.filter(item => item.id !== removedStory.id);
    if (removedStory.mediaId) deleteMedia(removedStory.mediaId).catch(error => showToast(error.message));
    persist("wesal-stories", stories, "تعذر حفظ التغيير");
    const remaining = [...stories].sort((a, b) => a.createdAt - b.createdAt);
    if (!remaining.length) {
      closeStoryViewer();
      renderUpdatesPage();
    } else {
      group.items = remaining;
      activeStoryIndex = Math.min(activeStoryIndex, remaining.length - 1);
      renderStoryFrame();
    }
  });
  const moreButton = document.querySelector("#storyMoreButton");
  if (moreButton) moreButton.addEventListener("click", () => deleteButton?.click());
  const addButton = document.querySelector("#storyAddButton");
  if (addButton) addButton.addEventListener("click", () => {
    storyInput.click();
  });
  const replyForm = document.querySelector("#storyReplyForm");
  if (replyForm) replyForm.addEventListener("submit", event => {
    event.preventDefault();
    const reply = document.querySelector("#storyReplyInput").value.trim();
    if (!reply) return;
    let destination = null;
    if (group.contactId) {
      const chat = conversations.find(item => item.id === group.contactId);
      if (chat && !blockedContacts.includes(chat.id)) {
        destination = chat;
      }
    }
    closeStoryViewer();
    if (destination) {
      openConversation(destination.id);
      messageInput.value = `↩ رد على الحالة: ${reply}`;
      messageInput.focus();
    } else {
      showToast("تعذر الرد على هذه الحالة");
    }
  });
}

function createStoryMediaFallback(message) {
  const fallback = document.createElement("div");
  fallback.className = "story-media-fallback";
  fallback.setAttribute("role", "status");
  fallback.textContent = message;
  return fallback;
}

let storyTouchStart = 0;
let storySwiped = false;

function startStoryProgress(duration, video = null) {
  clearInterval(storyProgressTimer);
  storyStartedAt = performance.now();
  storyElapsed = 0;
  storyProgressTimer = setInterval(() => {
    if (!activeStoryGroup) return;
    const now = performance.now();
    if (video && Number.isFinite(video.duration) && video.duration > 0) {
      storyElapsed = video.currentTime * 1000;
      duration = video.duration * 1000;
    } else if (!storyPaused) {
      storyElapsed += now - storyStartedAt;
    }
    storyStartedAt = now;
    const fill = document.querySelectorAll(".story-progress-segment i")[activeStoryIndex];
    if (fill) fill.style.width = `${Math.min(100, storyElapsed / duration * 100)}%`;
    if (!video && !storyPaused && storyElapsed >= duration) showNextStory();
  }, 50);
}

function showNextStory() {
  if (!activeStoryGroup) return;
  clearInterval(storyProgressTimer);
  if (activeStoryIndex + 1 >= activeStoryGroup.items.length) {
    if (!activeStoryGroup.own) {
      const contacts = getContactStories();
      const nextContact = contacts[contacts.findIndex(person => person.id === activeStoryGroup.contactId) + 1];
      if (nextContact) return openStoryGroup(nextContact.stories, nextContact.name, false, 0, nextContact.id);
    }
    return closeStoryViewer();
  }
  activeStoryIndex += 1;
  storyElapsed = 0;
  storyPaused = false;
  renderStoryFrame();
}

function showPreviousStory() {
  if (!activeStoryGroup) return;
  clearInterval(storyProgressTimer);
  activeStoryIndex = Math.max(0, activeStoryIndex - 1);
  storyElapsed = 0;
  storyPaused = false;
  renderStoryFrame();
}

function closeStoryViewer() {
  clearInterval(storyProgressTimer);
  storyProgressTimer = null;
  storyRenderToken += 1;
  activeStoryGroup = null;
  storyPaused = false;
  const video = document.querySelector("#storyStage video");
  if (video) {
    video.pause();
    video.removeAttribute("src");
    video.load();
  }
  const dialog = document.querySelector("#storyDialog");
  if (dialog.open) dialog.close();
  if (activePage === "updates") renderUpdatesPage();
}

async function startCall(id, type) {
  const person = conversations.find(chat => chat.id === id);
  if (!person) return;
  if (blockedContacts.includes(id)) return showToast("لا يمكن الاتصال بجهة اتصال محظورة");
  stopCallResources();
  currentCall = { id, type, startedAt: Date.now() };
  document.querySelector("#callAvatar").innerHTML = avatarMarkup(person);
  document.querySelector("#callName").textContent = person.name;
  document.querySelector("#callType").textContent = type === "video" ? "اتصال فيديو تجريبي" : "اتصال صوتي تجريبي";
  document.querySelector("#callStatus").textContent = "جارٍ الرنين...";
  document.querySelector("#muteCallButton").textContent = "كتم الصوت";
  document.querySelector("#muteCallButton").dataset.muted = "false";
  document.querySelector("#callVideoPreview").hidden = type !== "video";
  document.querySelector("#switchCameraButton").hidden = type !== "video";
  document.querySelector("#callDialog").showModal();
  startRingTone();
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("افتح الموقع عبر HTTPS أو localhost لتفعيل الكاميرا والميكروفون");
    currentCallStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: type === "video" ? { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } } : false
    });
    if (!currentCall) {
      currentCallStream.getTracks().forEach(track => track.stop());
      currentCallStream = null;
      return;
    }
    document.querySelector("#callVideoPreview").srcObject = type === "video" ? currentCallStream : null;
    if (type === "video") document.querySelector("#callAvatar").hidden = true;
    document.querySelector("#callStatus").textContent = "يرن لدى الطرف الآخر… (مكالمة تجريبية)";
    callTimer = setTimeout(() => {
      if (!currentCall) return;
      document.querySelector("#callStatus").textContent = "لم يرد الطرف الآخر — مكالمة تجريبية";
      stopRingTone();
      currentCallStream?.getTracks().forEach(track => track.stop());
      currentCallStream = null;
    }, 30000);
  } catch (error) {
    currentCall = null;
    stopCallResources();
    document.querySelector("#callDialog").close();
    showToast(error.name === "NotAllowedError" ? "لم تسمح بالوصول إلى الميكروفون أو الكاميرا" : error.message || "تعذر بدء المكالمة");
  }
}

async function switchCallCamera() {
  if (!currentCallStream || currentCall?.type !== "video" || !navigator.mediaDevices?.getUserMedia) return;
  try {
    const facingMode = currentCallStream.getVideoTracks()[0]?.getSettings().facingMode === "environment" ? "user" : "environment";
    const replacement = await navigator.mediaDevices.getUserMedia({ video: { facingMode }, audio: false });
    const oldTracks = currentCallStream.getVideoTracks();
    oldTracks.forEach(track => currentCallStream.removeTrack(track));
    replacement.getVideoTracks().forEach(track => currentCallStream.addTrack(track));
    oldTracks.forEach(track => track.stop());
    replacement.getAudioTracks().forEach(track => track.stop());
    document.querySelector("#callVideoPreview").srcObject = currentCallStream;
    document.querySelector("#callStatus").textContent = "تم تبديل الكاميرا · ما زال الاتصال تجريبيًا";
  } catch (error) {
    showToast(error.name === "NotAllowedError" ? "لم تسمح بتبديل الكاميرا" : "تعذر تبديل الكاميرا");
  }
}

function endCall() {
  if (currentCall) {
    calls.unshift({ id: currentCall.id, type: "outgoing", time: "الآن" });
    persist("wesal-calls", calls, "تعذر حفظ سجل المكالمات");
  }
  currentCall = null;
  clearTimeout(callTimer);
  stopCallResources();
  document.querySelector("#callDialog").close();
  if (activePage === "calls") renderCallsPage();
  showToast("تم إنهاء الاتصال التجريبي");
}

function openChatOptions() {
  const chat = conversations.find(item => item.id === activeId);
  if (!chat) return;
  const blocked = blockedContacts.includes(chat.id);
  const menu = document.querySelector("#chatOptionsMenu");
  menu.innerHTML = `
    <button type="button" data-chat-action="contact">معلومات جهة الاتصال</button>
    <button type="button" data-chat-action="pin">${chat.pinned ? "إلغاء تثبيت المحادثة" : "تثبيت المحادثة"}</button>
    <button type="button" data-chat-action="mute">${chat.muted ? "إلغاء كتم المحادثة" : "كتم الإشعارات"}</button>
    <button type="button" data-chat-action="unread">تحديد كغير مقروءة</button>
    <button type="button" data-chat-action="location">مشاركة موقعي</button>
    <button type="button" data-chat-action="block" class="${blocked ? "" : "danger-menu-item"}">${blocked ? "إلغاء الحظر" : "حظر جهة الاتصال"}</button>
    <button type="button" data-chat-action="clear" class="danger-menu-item">مسح الرسائل</button>
    <button type="button" data-chat-action="delete" class="danger-menu-item">حذف المحادثة</button>`;
  menu.hidden = !menu.hidden;
}

async function runChatAction(action) {
  const chat = conversations.find(item => item.id === activeId);
  if (!chat) return;
  document.querySelector("#chatOptionsMenu").hidden = true;
  if (action === "contact") return showPage("contact");
  if (action === "pin") {
    chat.pinned = !chat.pinned;
    saveConversations();
    renderActiveConversation();
    return showToast(chat.pinned ? "تم تثبيت المحادثة" : "تم إلغاء تثبيت المحادثة");
  }
  if (action === "mute") {
    chat.muted = !chat.muted;
    saveConversations();
    renderActiveConversation();
    return showToast(chat.muted ? "تم كتم المحادثة" : "تم إلغاء كتم المحادثة");
  }
  if (action === "unread") {
    chat.unread = Math.max(1, chat.unread);
    saveConversations();
    showChats();
    return showToast("تم تحديد المحادثة كغير مقروءة");
  }
  if (action === "block") return toggleContactBlock(chat);
  if (action === "location") return shareLocation(chat.id);
  if (action === "clear") {
    if (!window.confirm(`مسح جميع الرسائل في محادثة ${chat.name}؟`)) return;
    const ids = chat.messages.map(message => message.attachment?.id).filter(Boolean);
    chat.messages = [];
    chat.preview = "لا توجد رسائل";
    saveConversations();
    await Promise.all(ids.map(deleteMedia));
    renderActiveConversation();
    return showToast("تم مسح الرسائل");
  }
  if (action === "delete") {
    if (!window.confirm(`حذف محادثة ${chat.name} نهائيًا من هذا الجهاز؟`)) return;
    const ids = chat.messages.map(message => message.attachment?.id).filter(Boolean);
    conversations = conversations.filter(item => item.id !== chat.id);
    blockedContacts = blockedContacts.filter(id => id !== chat.id);
    activeId = null;
    saveConversations();
    persist("wesal-blocked", blockedContacts, "تعذر تحديث قائمة الحظر");
    await Promise.all(ids.map(deleteMedia));
    showChats();
    return showToast("تم حذف المحادثة");
  }
}

function shareLocation(id) {
  if (blockedContacts.includes(id)) return showToast("ألغِ الحظر أولاً لمشاركة موقعك");
  if (!navigator.geolocation) return showToast("مشاركة الموقع غير مدعومة في هذا المتصفح");
  showToast("بانتظار إذن الموقع...", 15000);
  navigator.geolocation.getCurrentPosition(position => {
    const { latitude, longitude } = position.coords;
    const link = `https://maps.google.com/?q=${latitude.toFixed(6)},${longitude.toFixed(6)}`;
    sendMessage(`موقعي الحالي: ${link}`);
  }, error => {
    showToast(error.code === error.PERMISSION_DENIED ? "لم تسمح بالوصول إلى الموقع" : "تعذر تحديد موقعك");
  }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
}

async function requestDevicePermissions() {
  const button = document.querySelector("#requestPermissionsButton");
  button.disabled = true;
  button.textContent = "جارٍ طلب الأذونات...";
  showToast("جارٍ طلب الأذونات...", 30000);
  const outcomes = [];
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      outcomes.push("الكاميرا والميكروفون يحتاجان HTTPS أو localhost");
    } else {
      for (const device of ["audio", "video"]) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: device === "audio", video: device === "video" });
          stream.getTracks().forEach(track => track.stop());
          outcomes.push(device === "audio" ? "الميكروفون جاهز" : "الكاميرا جاهزة");
        } catch {
          outcomes.push(device === "audio" ? "الميكروفون يحتاج إذنًا عند الاتصال" : "الكاميرا تحتاج إذنًا عند الاتصال");
        }
      }
    }
    if (navigator.geolocation) {
      await new Promise(resolve => navigator.geolocation.getCurrentPosition(
        () => { outcomes.push("تم السماح بالموقع"); resolve(); },
        () => { outcomes.push("يمكن السماح بالموقع عند مشاركته"); resolve(); },
        { timeout: 8000, maximumAge: 60000 }
      ));
    }
    if ("Notification" in window && Notification.permission === "default") {
      try {
        const result = await Notification.requestPermission();
        outcomes.push(result === "granted" ? "تم السماح بالإشعارات" : "الإشعارات متوقفة");
      } catch {
        outcomes.push("يمكن تفعيل الإشعارات من إعدادات المتصفح");
      }
    }
    localStorage.setItem("wesal-permissions-intro", "seen");
    permissionDialog.close();
    showToast(outcomes[0] || "يمكن إدارة الأذونات من إعدادات الجهاز");
  } finally {
    button.disabled = false;
    button.textContent = "متابعة وإعداد الأذونات";
  }
}

async function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("تعذر تجهيز الصورة")), type, quality);
  });
}

async function compressImage(file, maxDimension = Infinity) {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("تعذر معالجة الصورة");
    context.drawImage(bitmap, 0, 0);
    const compressed = await canvasToBlob(canvas, "image/webp", 0.96);
    if (compressed.type !== "image/webp") return file;
    return compressed.size < file.size
      ? new File([compressed], file.name.replace(/\.[^.]+$/, ".webp"), { type: "image/webp", lastModified: Date.now() })
      : file;
  } finally {
    bitmap.close();
  }
}

async function compressVideo(file, maxDuration = 180) {
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return file;
  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.volume = 0;
  video.playsInline = true;
  video.preload = "metadata";
  video.src = objectUrl;
  let videoStream;
  let sourceStream;
  let recorder;
  try {
    await new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("انتهت مهلة قراءة الفيديو")), 12000);
      video.addEventListener("loadedmetadata", () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });
      video.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("تعذر فتح الفيديو"));
      }, { once: true });
    });
    if (!video.videoWidth || !video.videoHeight || !Number.isFinite(video.duration)) return file;
    if (video.duration > maxDuration) return file;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    videoStream = canvas.captureStream(30);
    sourceStream = video.captureStream?.() || video.mozCaptureStream?.();
    sourceStream?.getAudioTracks().forEach(track => videoStream.addTrack(track));
    const mimeType = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find(type => MediaRecorder.isTypeSupported(type));
    recorder = new MediaRecorder(videoStream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: Math.max(900000, Math.min(8000000, canvas.width * canvas.height * 0.09)),
      audioBitsPerSecond: 128000
    });
    const chunks = [];
    const recorded = new Promise((resolve, reject) => {
      recorder.addEventListener("dataavailable", event => {
        if (event.data.size) chunks.push(event.data);
      });
      recorder.addEventListener("stop", () => resolve(new Blob(chunks, { type: recorder.mimeType || "video/webm" })), { once: true });
      recorder.addEventListener("error", () => reject(new Error("تعذر ضغط الفيديو")), { once: true });
    });
    recorder.start(500);
    const drawFrame = () => {
      if (video.paused || video.ended || recorder.state !== "recording") return;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      requestAnimationFrame(drawFrame);
    };
    video.addEventListener("play", drawFrame, { once: true });
    video.addEventListener("ended", () => {
      if (recorder.state === "recording") recorder.stop();
    }, { once: true });
    await video.play();
    const compressed = await recorded;
    if (!compressed.size || compressed.size >= file.size) return file;
    return new File([compressed], file.name.replace(/\.[^.]+$/, ".webm"), { type: compressed.type, lastModified: Date.now() });
  } finally {
    video.pause();
    video.src = "";
    if (recorder?.state === "recording") recorder.stop();
    videoStream?.getTracks().forEach(track => track.stop());
    sourceStream?.getTracks().forEach(track => track.stop());
    URL.revokeObjectURL(objectUrl);
  }
}

async function prepareMediaFile(file, maxVideoDuration = 180) {
  const kind = mediaKind(file);
  if (!kind) throw new Error("اختر ملف صورة أو فيديو");
  try {
    return kind === "image" ? await compressImage(file) : await compressVideo(file, maxVideoDuration);
  } catch {
    return file;
  }
}

function mediaKind(file) {
  const mime = String(file.type || "").toLowerCase();
  const extension = String(file.name || "").split(".").pop().toLowerCase();
  if (mime.startsWith("image/") || ["avif", "bmp", "gif", "heic", "heif", "jpeg", "jpg", "png", "tif", "tiff", "webp"].includes(extension)) return "image";
  if (mime.startsWith("video/") || ["3gp", "3g2", "avi", "m4v", "mkv", "mov", "mp4", "mpeg", "mpg", "ogv", "webm"].includes(extension)) return "video";
  if (mime.startsWith("audio/") || ["aac", "aif", "aiff", "flac", "m4a", "mp3", "oga", "ogg", "opus", "wav", "weba", "wma"].includes(extension)) return "audio";
  return "document";
}

async function dataUrlFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(new Error("تعذر قراءة الصورة")));
    reader.readAsDataURL(blob);
  });
}

list.addEventListener("click", event => {
  const button = event.target.closest(".conversation");
  if (button) openConversation(button.dataset.id);
});

searchInput.addEventListener("input", renderConversations);
document.querySelectorAll(".filter-chip").forEach(button => {
  button.addEventListener("click", () => {
    currentFilter = button.dataset.filter;
    unreadOnly = false;
    document.querySelectorAll(".filter-chip").forEach(chip => chip.classList.toggle("active", chip === button));
    document.querySelector("#filterButton").classList.remove("active");
    renderConversations();
  });
});
document.querySelector("#filterButton").addEventListener("click", event => {
  unreadOnly = !unreadOnly;
  currentFilter = "all";
  document.querySelectorAll(".filter-chip").forEach(chip => chip.classList.toggle("active", chip.dataset.filter === "all" && !unreadOnly));
  event.currentTarget.classList.toggle("active", unreadOnly);
  renderConversations();
});

document.querySelector("#messageForm").addEventListener("submit", event => {
  event.preventDefault();
  if (activeMediaDraft) {
    sendMessage(messageInput.value);
    sendMediaDraft().catch(error => showToast(error.message || "تعذر إرسال الوسيط"));
  } else {
    sendMessage(messageInput.value);
  }
});
document.querySelector("#voiceButton").addEventListener("click", startVoiceRecording);
document.querySelector("#recordCancelButton").addEventListener("click", cancelVoiceRecording);
document.querySelector("#recordStopButton").addEventListener("click", stopVoiceRecording);
messageInput.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage(messageInput.value);
  }
});
messageInput.addEventListener("input", () => {
  messageInput.style.height = "auto";
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, 112)}px`;
  updateComposerMode();
});
document.querySelector("#backButton").addEventListener("click", showChats);
document.querySelector("#pageBackButton").addEventListener("click", showChats);
document.querySelector(".brand").addEventListener("click", event => {
  event.preventDefault();
  showChats();
});

document.querySelector("#newChatButton").addEventListener("click", openContactsDialog);
document.querySelector("#contactsDialog input[name='name']").addEventListener("input", renderContactsList);
document.querySelector("#contactsList").addEventListener("click", event => {
  const button = event.target.closest("[data-open-contact]");
  if (!button) return;
  document.querySelector("#contactsDialog").close();
  openConversation(button.dataset.openContact);
});
document.querySelector("#newContactForm").addEventListener("submit", event => {
  event.preventDefault();
  try {
    const values = new FormData(event.currentTarget);
    const chat = addPhoneContact(values.get("name"), values.get("phone"));
    event.currentTarget.reset();
    document.querySelector("#contactsDialog").close();
    renderConversations();
    openConversation(chat.id);
  } catch (error) {
    showToast(error.message || "تعذرت إضافة جهة الاتصال");
  }
});
document.querySelector("#importPhoneContacts").addEventListener("click", async () => {
  if (!navigator.contacts?.select) {
    document.querySelector("#contactsSupportNote").textContent = "هذا المتصفح لا يتيح استيراد جهات الاتصال. استخدم الإدخال اليدوي أدناه أو افتح NEXVO في متصفح هاتف يدعم هذه الميزة.";
    return showToast("الاستيراد غير مدعوم هنا؛ يمكنك إضافة الرقم يدويًا");
  }
  try {
    const selected = await navigator.contacts.select(["name", "tel"], { multiple: true });
    let added = 0;
    for (const item of selected) {
      const name = item.name?.[0];
      const phone = item.tel?.[0];
      if (!name || !phone) continue;
      addPhoneContact(name, phone);
      added += 1;
    }
    renderContactsList();
    if (added) showToast(`تم استيراد ${added} جهة اتصال`);
  } catch (error) {
    if (error.name !== "AbortError") showToast(error.message || "تعذر استيراد جهات الاتصال");
  }
});

document.querySelector("#loginTab").addEventListener("click", () => setAuthMode("login"));
document.querySelector("#registerTab").addEventListener("click", () => setAuthMode("register"));
document.querySelector("#authPhotoButton").addEventListener("click", () => document.querySelector("#authPhotoInput").click());
document.querySelector("#authPhotoInput").addEventListener("change", async event => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  try {
    accountPhoto = await dataUrlFromBlob(await compressImage(file, 600));
    document.querySelector("#authPhotoPreview").innerHTML = `<img src="${accountPhoto}" alt="معاينة الصورة الشخصية">`;
  } catch (error) {
    showToast(error.message || "تعذر تجهيز الصورة");
  }
});
document.querySelector("#registerForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector("button[type='submit']");
  submit.disabled = true;
  try {
    const values = new FormData(form);
    const name = String(values.get("displayName")).trim();
    const username = String(values.get("username")).trim().toLowerCase();
    const accounts = loadAccounts();
    if (accounts.some(account => account.username === username)) {
      setAuthMode("login");
      document.querySelector("#loginForm [name='username']").value = username;
      throw new Error("اسم المستخدم مستخدم بالفعل على هذا الجهاز. سجّل الدخول أو اختر اسمًا آخر.");
    }
    const phone = String(values.get("phone")).trim();
    const password = String(values.get("password"));
    const credentials = await hashPassword(password);
    profile = { ...profile, name, username, about: "متاح للتواصل ✨", mood: "متاح", phone, photo: accountPhoto };
    const account = { username, displayName: name, phone, photo: accountPhoto, salt: credentials.salt, passwordHash: credentials.hash };
    if (!saveAccounts([...accounts, account]) || !persist("wesal-profile", profile, "تعذر حفظ الملف الشخصي")) return;
    updateProfileShortcut();
    showToast("أهلًا بك في NEXVO");
    finishAuthentication(account);
  } catch (error) {
    showToast(error.message || "تعذر إنشاء الحساب");
  } finally {
    submit.disabled = false;
  }
});
document.querySelector("#loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector("button[type='submit']");
  submit.disabled = true;
  try {
    const values = new FormData(form);
    const username = String(values.get("username")).trim().toLowerCase();
    const account = findAccount(username);
    if (!account) throw new Error("لم يُعثر على هذا الحساب. أنشئ حسابًا جديدًا أولًا.");
    if (username !== account.username) throw new Error("اسم المستخدم أو كلمة المرور غير صحيحة.");
    const suppliedHash = await derivePasswordHash(String(values.get("password")), Uint8Array.from(atob(account.salt), char => char.charCodeAt(0)));
    if (suppliedHash !== account.passwordHash) throw new Error("اسم المستخدم أو كلمة المرور غير صحيحة.");
    profile = { ...profile, name: account.displayName, username: account.username, phone: account.phone, photo: account.photo };
    persist("wesal-profile", profile, "تعذر تحميل الملف الشخصي");
    updateProfileShortcut();
    finishAuthentication(account);
  } catch (error) {
    showToast(error.message || "تعذر تسجيل الدخول");
  } finally {
    submit.disabled = false;
  }
});
document.querySelector("#authDialog").addEventListener("cancel", event => event.preventDefault());

document.querySelector("#profileButton").addEventListener("click", () => showPage("profile"));
document.querySelector("#menuButton").addEventListener("click", event => {
  event.stopPropagation();
  if (!headerMenu.hidden) {
    headerMenu.hidden = true;
    return;
  }
  headerMenu.innerHTML = `<button type="button" data-menu-action="profile">ملفي الشخصي</button><button type="button" data-menu-action="settings">الإعدادات</button><button type="button" data-menu-action="permissions">أذونات الجهاز</button><button type="button" data-menu-action="theme">${preferences.dark ? "الوضع الفاتح" : "الوضع الداكن"}</button>`;
  headerMenu.hidden = false;
});
headerMenu.addEventListener("click", event => {
  const action = event.target.closest("[data-menu-action]")?.dataset.menuAction;
  if (!action) return;
  headerMenu.hidden = true;
  if (action === "profile" || action === "settings") showPage(action);
  if (action === "permissions") permissionDialog.showModal();
  if (action === "theme") updatePreference("dark");
});
document.addEventListener("click", event => {
  if (!headerMenu.contains(event.target) && !event.target.closest("#menuButton")) headerMenu.hidden = true;
});

document.querySelector("#chatMenuButton").addEventListener("click", openChatOptions);
document.querySelector("#chatOptionsMenu").addEventListener("click", event => {
  const action = event.target.closest("[data-chat-action]")?.dataset.chatAction;
  if (action) runChatAction(action).catch(error => showToast(error.message || "تعذر تنفيذ الإجراء"));
});
document.querySelector("#messages").addEventListener("click", event => {
  const media = event.target.closest("[data-media-id]");
  if (media) showMedia(media.dataset.mediaId, media.dataset.mediaType, media.dataset.mediaName);
});
document.querySelector("#chatPerson").addEventListener("click", () => showPage("contact"));
document.querySelector("#callButton").addEventListener("click", () => startCall(activeId, "voice"));
document.querySelector("#videoButton").addEventListener("click", () => startCall(activeId, "video"));
document.querySelector("#endCallButton").addEventListener("click", endCall);
document.querySelector("#switchCameraButton").addEventListener("click", switchCallCamera);
document.querySelector("#callVideoPreview").addEventListener("click", event => {
  const video = event.currentTarget;
  if (video.requestFullscreen) video.requestFullscreen().catch(() => {});
});
document.querySelector("#callDialog").addEventListener("close", () => {
  if (currentCall) endCall();
});
document.querySelector("#muteCallButton").addEventListener("click", event => {
  const muted = event.currentTarget.dataset.muted !== "true";
  event.currentTarget.dataset.muted = String(muted);
  event.currentTarget.textContent = muted ? "إلغاء كتم الصوت" : "كتم الصوت";
  currentCallStream?.getAudioTracks().forEach(track => { track.enabled = !muted; });
});
document.querySelectorAll("[data-close-dialog]").forEach(button => {
  button.addEventListener("click", () => document.getElementById(button.dataset.closeDialog).close());
});
document.querySelector("#attachButton").addEventListener("click", () => {
  attachmentMenuOpen = !attachmentMenuOpen;
  document.querySelector("#attachmentMenu").hidden = !attachmentMenuOpen;
});
document.querySelector("#attachmentMenu").addEventListener("click", event => {
  const action = event.target.closest("[data-attachment-action]")?.dataset.attachmentAction;
  document.querySelector("#attachmentMenu").hidden = true;
  attachmentMenuOpen = false;
  if (action === "media") document.querySelector("#fileInput").click();
  if (action === "document") document.querySelector("#documentInput").click();
  if (action === "camera") document.querySelector("#permissionCameraInput").click();
  if (action === "location") shareLocation(activeId);
});
document.querySelector("#fileInput").addEventListener("change", event => {
  const file = event.target.files[0];
  if (file && activeId) prepareMediaDraft(file);
  event.target.value = "";
});
document.querySelector("#documentInput").addEventListener("change", event => {
  const file = event.target.files[0];
  if (file && activeId) prepareMediaDraft(file);
  event.target.value = "";
});
document.querySelector("#permissionCameraInput").addEventListener("change", event => {
  const file = event.target.files[0];
  if (file && activeId) prepareMediaDraft(file);
  event.target.value = "";
});
document.querySelector("#emojiButton").addEventListener("click", () => {
  const picker = document.querySelector("#emojiPicker");
  if (picker.hidden) {
    const emoji = ["😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "😇", "🙂", "🙃", "😉", "😍", "🥰", "😘", "😋", "😎", "🤔", "🤗", "🥳", "😭", "😢", "😡", "👍", "👎", "👏", "🙏", "🤝", "❤️", "🧡", "💛", "💚", "💙", "💜", "✨", "🎉", "🔥", "🌹", "🌷", "☕", "🍰", "🎂", "⚽", "🎁", "🌙", "☀️", "✅", "💯", "👋"];
    picker.innerHTML = emoji.map(value => `<button type="button" aria-label="${value}">${value}</button>`).join("");
    picker.hidden = false;
  } else {
    picker.hidden = true;
  }
});
document.querySelector("#emojiPicker").addEventListener("click", event => {
  const button = event.target.closest("button");
  if (!button) return;
  const start = messageInput.selectionStart;
  const end = messageInput.selectionEnd;
  messageInput.value = `${messageInput.value.slice(0, start)}${button.textContent}${messageInput.value.slice(end)}`;
  messageInput.focus();
  messageInput.setSelectionRange(start + button.textContent.length, start + button.textContent.length);
  document.querySelector("#emojiPicker").hidden = true;
});
document.querySelectorAll(".nav-item").forEach(button => {
  button.addEventListener("click", () => {
    const page = button.dataset.view;
    if (page === "chats") showChats();
    else showPage(page);
  });
});

storyInput.addEventListener("change", async event => {
  const files = [...event.target.files];
  event.target.value = "";
  if (!files.length) return;
  const addedStories = [];
  try {
    for (const file of files) {
      const kind = mediaKind(file);
      const compressed = await prepareMediaFile(file, 60);
      const media = await putMedia(compressed, compressed.name || file.name, compressed.type || file.type);
      const story = { id: `story-${Date.now()}-${Math.random().toString(36).slice(2)}`, mediaId: media.id, type: kind, caption: "", time: "الآن", createdAt: Date.now() };
      stories.push(story);
      addedStories.push(story);
    }
    const saved = persist("wesal-stories", stories, "تعذر حفظ الحالة. جرّب ملفًا أصغر.");
    if (!saved) {
      stories = stories.filter(story => !addedStories.includes(story));
      await Promise.all(addedStories.map(story => deleteMedia(story.mediaId)));
      return;
    }
    const previousGroup = activeStoryGroup?.own ? activeStoryGroup : null;
    if (activePage === "updates") renderUpdatesPage();
    if (previousGroup) {
      previousGroup.items = [...stories].sort((a, b) => a.createdAt - b.createdAt);
      activeStoryGroup = previousGroup;
      activeStoryIndex = previousGroup.items.findIndex(story => addedStories.some(added => added.id === story.id));
      renderStoryFrame();
    }
    showToast(`تم نشر ${addedStories.length} ${addedStories.length === 1 ? "حالة" : "حالات"} في دائرتك`);
  } catch (error) {
    stories = stories.filter(story => !addedStories.includes(story));
    await Promise.all(addedStories.map(story => deleteMedia(story.mediaId)));
    showToast(error.message || "تعذر تحميل الحالة");
  }
});

document.querySelector("#profilePhotoInput").addEventListener("change", async event => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  try {
    profile.photo = await dataUrlFromBlob(await compressImage(file, 600));
    const saved = persist("wesal-profile", profile, "تعذر حفظ الصورة الشخصية");
    updateProfileShortcut();
    const account = findAccount(loadStoredValue("wesal-session", null));
    if (account) {
      account.photo = profile.photo;
      const accounts = loadAccounts();
      const index = accounts.findIndex(item => item.username === account.username);
      if (index >= 0) {
        accounts[index] = account;
        saveAccounts(accounts);
      }
    }
    renderProfilePage();
    if (saved) showToast("تم تحديث الصورة الشخصية");
  } catch (error) {
    showToast(error.message || "تعذر تحميل الصورة");
  }
});

document.querySelector("#requestPermissionsButton").addEventListener("click", () => {
  requestDevicePermissions().catch(error => showToast(error.message || "تعذر إعداد الأذونات"));
});
document.querySelector("#skipPermissionsButton").addEventListener("click", () => {
  localStorage.setItem("wesal-permissions-intro", "seen");
  permissionDialog.close();
});
document.querySelector("#permissionForm").addEventListener("submit", event => event.preventDefault());
document.querySelector("#mediaDialog").addEventListener("click", event => {
  if (event.target === event.currentTarget) event.currentTarget.close();
});
document.querySelector("#storyDialog").addEventListener("click", event => {
  if (event.target === event.currentTarget) event.currentTarget.close();
});
document.querySelector("#storyDialog").addEventListener("close", () => {
  if (activeStoryGroup) closeStoryViewer();
});
document.querySelector("#permissionDialog").addEventListener("click", event => {
  if (event.target === event.currentTarget) {
    localStorage.setItem("wesal-permissions-intro", "seen");
    event.currentTarget.close();
  }
});
document.querySelector("#blockedBanner").addEventListener("click", event => {
  if (event.target.id === "unblockContactButton") {
    const chat = conversations.find(item => item.id === activeId);
    if (chat) toggleContactBlock(chat);
  }
});
document.addEventListener("click", event => {
  const menu = document.querySelector("#chatOptionsMenu");
  const attachment = document.querySelector("#attachmentMenu");
  if (!menu.contains(event.target) && !event.target.closest("#chatMenuButton")) menu.hidden = true;
  if (!attachment.contains(event.target) && !event.target.closest("#attachButton")) {
    attachment.hidden = true;
    attachmentMenuOpen = false;
  }
});

document.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    searchInput.focus();
  }
  if (event.key === "Escape" && !document.querySelector("#storyDialog").open && !document.querySelector("#mediaDialog").open && !document.querySelector("#callDialog").open && !document.querySelector("#contactsDialog").open && !permissionDialog.open && !document.querySelector("#authDialog").open) {
    showChats();
  }
  if (document.querySelector("#storyDialog").open) {
    if (event.key === "ArrowRight") showNextStory();
    if (event.key === "ArrowLeft") showPreviousStory();
    if (event.key === " ") {
      event.preventDefault();
      storyPaused = !storyPaused;
      const video = document.querySelector("#storyStage video");
      if (video) storyPaused ? video.pause() : video.play().catch(() => {});
    }
  }
});

profile.mood = profile.mood || "متاح";
updateProfileShortcut();
applyTheme();
const storedConversations = loadStoredValue("wesal-conversations", null);
if (Array.isArray(storedConversations) && storedConversations.some(chat => legacyDemoConversationIds.has(chat.id))) {
  saveConversations();
}
const legacyStoryReads = storyReads.filter(id => /^(sara|omar|noura)-story-/.test(id));
if (legacyStoryReads.length) {
  storyReads = storyReads.filter(id => !legacyStoryReads.includes(id));
  persist("wesal-story-reads", storyReads, "تعذر تنظيف الحالات القديمة");
}
const storedCalls = loadStoredValue("wesal-calls", null);
if (Array.isArray(storedCalls) && storedCalls.some(call => legacyDemoConversationIds.has(call.id))) {
  calls = calls.filter(call => !legacyDemoConversationIds.has(call.id));
  persist("wesal-calls", calls, "تعذر حذف سجل المكالمات التجريبي");
}
renderConversations();
const accounts = loadAccounts();
const savedSession = loadStoredValue("wesal-session", null);
const savedAccount = accounts.find(account => account.username === savedSession);
setAuthMode(accounts.length ? "login" : "register");
if (savedAccount) {
  profile = { ...profile, name: savedAccount.displayName, username: savedAccount.username, phone: savedAccount.phone, photo: savedAccount.photo };
  updateProfileShortcut();
} else {
  document.querySelector("#authDialog").showModal();
}
