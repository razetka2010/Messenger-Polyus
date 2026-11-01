import { requestJson as api } from "./apiClient.mjs";
import { cropAvatar } from "./avatar.mjs";

let polusReady = false;
(function protectFormsFromNativeSubmit() {
  const sensitiveParams = ["password", "confirmPassword", "currentPassword", "newPassword", "username", "fullName", "about"];
  try {
    const url = new URL(window.location.href);
    let changed = false;
    for (const name of sensitiveParams) {
      if (url.searchParams.has(name)) {
        url.searchParams.delete(name);
        changed = true;
      }
    }
    if (changed) window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // Адрес остаётся как есть, если его не удалось разобрать.
  }
})();

const translations = {
  ru: {
    language: "Язык", welcomeEyebrow: "ВАША ТОЧКА СВЯЗИ", signIn: "С возвращением",
    signInSubtitle: "Войдите, чтобы продолжить общение.", registerSubtitle: "Создай профиль, чтобы общаться с людьми на Полюсе.",
    signInButton: "Войти", fullName: "Имя и фамилия",
    fullNamePlaceholder: "Как тебя называть?", aboutOptional: "О себе (необязательно)",
    username: "Имя пользователя", usernameHint: "Уникально: 3–32 латинских буквы, цифры или _.",
    password: "Пароль", confirmPassword: "Повторите пароль", consent: "Я прочитал(а) и принимаю",
    privacyLink: "политику конфиденциальности", noAccount: "Впервые на Полюсе?", hasAccount: "Уже есть аккаунт?",
    createAccount: "Создать аккаунт", privateByDesign: "Твои разговоры — только для участников.",
    newMessage: "Новое сообщение", channels: "КАНАЛЫ", discover: "ОТКРЫТЫЕ КАНАЛЫ",
    savedMessages: "Избранное", savedMessagesCaption: "Личные заметки и сохранённые сообщения",
    savedMessageSaved: "Сообщение сохранено в Избранном.", savedFrom: "Источник:",
    messageForwarded: "Сообщение переслано.",
    directMessages: "ЛИЧНЫЕ СООБЩЕНИЯ", findPeople: "НАЙТИ ЛЮДЕЙ", searchPeople: "Искать по имени или @username",
    community: "СООБЩЕСТВО", createChannel: "Создать канал", channelName: "Название канала",
    channelDescription: "Описание", create: "Создать", createGroup: "Новая группа", groupName: "Название группы",
    groupMembers: "Участники (@имена через запятую)", yourAccount: "ТВОЙ АККАУНТ", account: "Аккаунт",
    currentPassword: "Текущий пароль (для смены пароля)", newPasswordOptional: "Новый пароль (необязательно)",
    saveChanges: "Сохранить", signOut: "Выйти", writeMessage: "Написать сообщение",
    send: "Отправить",
    messagePlaceholder: "Напиши сообщение…", join: "Вступить", joined: "Участник",
    loadOlderMessages: "Загрузить предыдущие сообщения", deletedMessage: "Сообщение удалено",
    emptyTitle: "Пока здесь тихо", emptyChannel: "Напиши первое сообщение — и разговор начнётся.",
    emptyDirect: "Напиши привет — начните личный разговор.", emptyGroup: "Напиши первое сообщение для группы.",
    noChannels: "Пока нет открытых каналов.", noDirects: "Личные беседы появятся здесь.",
    searchChats: "Поиск", sidebarMenu: "Меню", newGroup: "Новая группа", newChannel: "Новый канал",
    findPeopleItem: "Найти людей", findPeopleFor: "Найти людей:", noChats: "Здесь пока пусто. Нажмите на карандаш, чтобы найти людей.",
    you: "Вы", noMessagesYet: "Нет сообщений", photoLabel: "Фото", fileLabel: "Файлы", backLabel: "Назад",
    searchPlaceholder: "Имя или @username", searchPrompt: "Введи не меньше двух символов, чтобы найти людей.",
    noUsers: "Никого не нашли. Проверь имя пользователя.", edit: "Изменить", remove: "Удалить",
    edited: "изменено", messageSent: "Сообщение отправлено.", editPrompt: "Изменить сообщение",
    messageEditExpired: "Редактировать сообщение можно только в течение 48 часов.",
    errMessageLength: "Сообщение должно содержать от 1 до 4000 символов.",
    errMessageRate: "Можно отправлять не более 20 сообщений в минуту.",
    deleteConfirm: "Удалить это сообщение?", unavailablePush: "Push-уведомления требуют HTTPS и поддержки браузера.",
    permissionDenied: "Разреши уведомления в настройках браузера.", pushEnabled: "Уведомления включены.",
    pushDisabled: "Push-уведомления выключены.", notificationPrompt: "Разрешить браузерные push-уведомления?",
    secureRequired: "Push доступен только на защищённом сайте (HTTPS или localhost).",
    enableNotifications: "Включить push-уведомления", disableNotifications: "Выключить push-уведомления",
    messageArrived: "Новое сообщение от", channelLabel: "канал", groupLabel: "группа",
    online: "В сети", members: "участников", privacyVersion: "Версия политики",
    loginSuccess: "Рады снова видеть тебя.", registerSuccess: "Аккаунт создан. Добро пожаловать на Полюс!",
    errUsername: "Имя пользователя должно содержать 3–32 латинских буквы, цифры или _.",
    errName: "Отображаемое имя должно содержать от 1 до 50 символов.",
    errAbout: "Поле «О себе» не должно превышать 200 символов.",
    errPassword: "Пароль должен содержать 8–128 символов.",
    errPasswordMatch: "Пароли не совпадают.", errPrivacy: "Прочитай и прими политику конфиденциальности.",
    errTaken: "Это имя пользователя уже занято.", errLogin: "Неверное имя пользователя или пароль.",
    errRateLimit: "Слишком много неудачных попыток входа. Попробуй снова через 15 минут.", errCurrentPassword: "Неверный текущий пароль.",
    errNotFound: "Пользователь не найден.", errSelf: "Нельзя написать самому себе.",
    errChannelName: "Название канала слишком короткое.", errGroupName: "Название группы слишком короткое.",
    errGroupUsers: "Добавь от одного до 199 участников.", errGroupMembers: "В группе должен быть хотя бы один участник кроме тебя.",
    errUsernames: "Не удалось найти одно или несколько имён пользователей.",
    errEmptyMessage: "Сначала напиши сообщение.", errGeneric: "Не удалось выполнить запрос. Попробуй ещё раз.",
    joinChannel: "Вступить в канал", directTitle: "Личная переписка", leaveChannel: "Канал",
    groupParticipants: "участников", accountUpdated: "Настройки аккаунта сохранены.",
    channelCreated: "Канал создан.", groupCreated: "Группа создана.",
    manageChat: "Управление чатом", chatMembers: "Участники чата", inviteMember: "Добавить участника",
    channelPostIdentity: "Публиковать сообщения от имени",
    postAsChannel: "Канала", postAsPerson: "Автора", postIdentitySaved: "Режим публикации обновлён.",
    usernamePlaceholder: "@username", makeAdmin: "Назначить администратором", removeAdmin: "Снять администратора",
    transferOwnership: "Передать владение", leaveChat: "Покинуть чат", deleteChat: "Удалить чат",
    roleOwner: "Владелец", roleAdmin: "Администратор", roleMember: "Участник",
    ownershipTransferred: "Владение передано.", chatDeleted: "Чат удалён.",
    chatInfo: "Информация о чате", searchChat: "Поиск по чату", profile: "ПРОФИЛЬ",
    invalidMaterialsResponse: "Сервер вернул некорректный список материалов. Обновите страницу и попробуйте снова.",
    profileAvatar: "Изображение должно быть не больше 5 МБ.",
    avatarPickerTitle: "Фото профиля", avatarPickerHint: "Выберите изображение до 5 МБ",
    chooseAvatar: "Выбрать фото", showOnline: "Показывать статус «в сети»",
    hideNotificationContent: "Скрывать текст сообщений в уведомлениях",
    noAbout: "Пользователь пока ничего не рассказал о себе.",
    noSharedChats: "Общих групп и каналов пока нет.", noSharedMedia: "Общих медиа пока нет.",
    attachFiles: "Прикрепить файлы", uploadFailed: "Не удалось загрузить файл.",
    thumbnailFailed: "Не удалось создать миниатюру; оригинал сохранён.",
    maxAttachments: "К одному сообщению можно прикрепить не более 10 файлов.",
    maxFileSize: "Размер файла не должен превышать 100 МБ.", muted: "Уведомления отключены",
    unmuted: "Уведомления включены", blockUser: "Заблокировать", unblockUser: "Разблокировать",
    writeToUser: "Написать", muteChat: "Отключить уведомления", unmuteChat: "Включить уведомления",
    sharedChats: "Общие группы и каналы", sharedMedia: "Общие медиа",
    tabMembers: "Участники", tabMedia: "Медиа", tabFiles: "Файлы", tabLinks: "Ссылки", preview: "Миниатюра",
    openMessage: "Перейти к сообщению", searchPromptChat: "Введите текст для поиска",
    noResults: "Ничего не найдено", download: "Скачать", cancelUpload: "Отменить загрузку",
    onlineStatus: "В сети", lastSeen: "Был(а) в сети", registered: "Дата регистрации",
    offlineStatus: "Не в сети", blockedInfo: "Пользователь заблокирован.", profileSettingsSaved: "Профиль обновлён."
  },
  en: {
    language: "Language", welcomeEyebrow: "YOUR PLACE TO CONNECT", signIn: "Welcome back",
    signInSubtitle: "Sign in to pick up the conversation.", registerSubtitle: "Create a profile and start connecting on Polus.",
    signInButton: "Sign in", fullName: "Full name",
    fullNamePlaceholder: "What should we call you?", aboutOptional: "About (optional)",
    username: "Username", usernameHint: "Unique: 3–32 Latin letters, numbers, or _.",
    password: "Password", confirmPassword: "Confirm password", consent: "I have read and agree to the",
    privacyLink: "privacy policy", noAccount: "New to Polus?", hasAccount: "Already have an account?", createAccount: "Create an account",
    privateByDesign: "Your conversations are only for their members.", newMessage: "New message",
    channels: "CHANNELS", discover: "DISCOVER CHANNELS", directMessages: "DIRECT MESSAGES",
    savedMessages: "Saved Messages", savedMessagesCaption: "Personal notes and saved messages",
    savedMessageSaved: "Message saved to Saved Messages.", savedFrom: "From:",
    messageForwarded: "Message forwarded.",
    findPeople: "FIND PEOPLE", searchPeople: "Search by name or @username", community: "COMMUNITY",
    createChannel: "Create a channel", channelName: "Channel name", channelDescription: "Description",
    create: "Create", createGroup: "New group", groupName: "Group name",
    groupMembers: "Members (@usernames separated by commas)", yourAccount: "YOUR ACCOUNT", account: "Account",
    currentPassword: "Current password (to change password)", newPasswordOptional: "New password (optional)",
    saveChanges: "Save changes", signOut: "Sign out", writeMessage: "Write a message",
    send: "Send", messagePlaceholder: "Write a message…",
    join: "Join", joined: "Member", emptyTitle: "It's quiet in here",
    loadOlderMessages: "Load earlier messages", deletedMessage: "Message deleted",
    emptyChannel: "Send the first message and get the conversation started.",
    emptyDirect: "Say hello to start a private conversation.", emptyGroup: "Send the first message to your group.",
    noChannels: "There are no public channels yet.", noDirects: "Your direct messages will show up here.",
    searchChats: "Search", sidebarMenu: "Menu", newGroup: "New group", newChannel: "New channel",
    findPeopleItem: "Find people", findPeopleFor: "Find people:", noChats: "Nothing here yet. Tap the pencil to find people.",
    you: "You", noMessagesYet: "No messages yet", photoLabel: "Photo", fileLabel: "Files", backLabel: "Back",
    searchPlaceholder: "Name or @username", searchPrompt: "Type at least two characters to find people.",
    noUsers: "No matches. Check the username and try again.", edit: "Edit", remove: "Delete",
    edited: "edited", messageSent: "Message sent.", editPrompt: "Edit message",
    messageEditExpired: "Messages can only be edited within 48 hours.",
    errMessageLength: "A message must contain 1–4000 characters.",
    errMessageRate: "You can send at most 20 messages per minute.",
    deleteConfirm: "Delete this message?", unavailablePush: "Push notifications require HTTPS and browser support.",
    permissionDenied: "Allow notifications in your browser settings.", pushEnabled: "Notifications enabled.",
    pushDisabled: "Push notifications turned off.", notificationPrompt: "Allow browser push notifications?",
    secureRequired: "Push is available only on a secure site (HTTPS or localhost).",
    enableNotifications: "Enable push notifications", disableNotifications: "Disable push notifications",
    messageArrived: "New message from", channelLabel: "channel", groupLabel: "group",
    online: "Online", members: "members", privacyVersion: "Policy version",
    loginSuccess: "Welcome back.", registerSuccess: "Account created. Welcome to Polus!",
    errUsername: "Username must be 3–32 Latin letters, numbers, or underscores.",
    errName: "Display name must be 1–50 characters.", errAbout: "About must be at most 200 characters.",
    errPassword: "Password must be 8–128 characters.",
    errPasswordMatch: "Passwords do not match.", errPrivacy: "Please read and accept the privacy policy.",
    errTaken: "That username is already taken.", errLogin: "Incorrect username or password.",
    errRateLimit: "Too many failed sign-in attempts. Try again in 15 minutes.", errCurrentPassword: "Current password is incorrect.",
    errNotFound: "User not found.", errSelf: "You cannot message yourself.",
    errChannelName: "Channel name is too short.", errGroupName: "Group name is too short.",
    errGroupUsers: "Add between 1 and 199 participants.", errGroupMembers: "A group must have at least one other member.",
    errUsernames: "One or more usernames could not be found.",
    errEmptyMessage: "Write a message before sending.", errGeneric: "Request failed. Please try again.",
    joinChannel: "Join channel", directTitle: "Direct message", leaveChannel: "Channel",
    groupParticipants: "members", accountUpdated: "Account settings saved.",
    channelCreated: "Channel created.", groupCreated: "Group created.",
    manageChat: "Manage chat", chatMembers: "Chat members", inviteMember: "Add member",
    channelPostIdentity: "Post messages as",
    postAsChannel: "Channel", postAsPerson: "Author", postIdentitySaved: "Posting identity updated.",
    usernamePlaceholder: "@username", makeAdmin: "Make administrator", removeAdmin: "Remove administrator",
    transferOwnership: "Transfer ownership", leaveChat: "Leave chat", deleteChat: "Delete chat",
    roleOwner: "Owner", roleAdmin: "Administrator", roleMember: "Member",
    ownershipTransferred: "Ownership transferred.", chatDeleted: "Chat deleted.",
    chatInfo: "Chat information", searchChat: "Search chat", profile: "PROFILE",
    invalidMaterialsResponse: "The server returned an invalid materials list. Refresh the page and try again.",
    profileAvatar: "Image must be no larger than 5 MB.",
    avatarPickerTitle: "Profile photo", avatarPickerHint: "Choose an image up to 5 MB",
    chooseAvatar: "Choose photo", showOnline: "Show online status",
    hideNotificationContent: "Hide message text in notifications",
    noAbout: "This user hasn't added an about section yet.",
    noSharedChats: "No shared groups or channels yet.", noSharedMedia: "No shared media yet.",
    attachFiles: "Attach files", uploadFailed: "Unable to upload the file.",
    thumbnailFailed: "Unable to create a preview; the original was kept.",
    maxAttachments: "A message can have up to 10 attachments.",
    maxFileSize: "Files cannot exceed 100 MB.", muted: "Notifications muted",
    unmuted: "Notifications enabled", blockUser: "Block", unblockUser: "Unblock",
    writeToUser: "Message", muteChat: "Mute notifications", unmuteChat: "Unmute notifications",
    sharedChats: "Shared groups and channels", sharedMedia: "Shared media",
    tabMembers: "Members", tabMedia: "Media", tabFiles: "Files", tabLinks: "Links", preview: "Preview",
    openMessage: "Go to message", searchPromptChat: "Enter text to search",
    noResults: "No results found", download: "Download", cancelUpload: "Cancel upload",
    onlineStatus: "Online", lastSeen: "Last seen", registered: "Joined",
    offlineStatus: "Offline", blockedInfo: "This user is blocked.", profileSettingsSaved: "Profile updated."
  }
};

const messengerView = document.querySelector("#messenger-view");
const messageList = document.querySelector("#message-list");
const openDialogIds = new Set();
const controllerListeners = [];
let controllerInitialized = false;
let controllerSession = 0;
function listen(target, type, handler) {
  target.addEventListener(type, handler);
  controllerListeners.push(() => target.removeEventListener(type, handler));
}
function openDialog(id) {
  document.dispatchEvent(new CustomEvent("polus:open-dialog", { detail: { id } }));
}
function closeDialog(id) {
  document.dispatchEvent(new CustomEvent("polus:close-dialog", { detail: { id } }));
}
function isDialogOpen(id) {
  return openDialogIds.has(id);
}
let profilePreviewUrl = null;
let currentInfoTab = "members";
let chatInfoRequestId = 0;
let chatInfoState = null;
let sidebarSearchQuery = "";

let language = localStorage.getItem("polus-language") === "en" ? "en" : "ru";
let currentUser = null;
let currentConversation = null;
let channels = [];
let directs = [];
let messages = [];
let olderMessagesCursor = null;
let loadingOlderMessages = false;
let chatSearchTimer;
let chatSearchRequestId = 0;
let pushKey;

function t(key) {
  return translations[language][key] || translations.en[key] || key;
}

function setLanguage(value) {
  language = value === "en" ? "en" : "ru";
  localStorage.setItem("polus-language", language);
  window.dispatchEvent(new CustomEvent("polus:language-changed", { detail: { language } }));
}

function showError(element, message) {
  document.dispatchEvent(new CustomEvent("polus:form-error", {
    detail: { id: element.id, message: localizeError(message) }
  }));
}

function clearError(id) {
  document.dispatchEvent(new CustomEvent("polus:form-error-clear", { detail: { id } }));
}

function localizeError(message) {
  const knownErrors = {
    "Username must be 3–32 letters, numbers, or underscores.": "errUsername",
    "Username must be 3–32 Latin letters, numbers, or underscores.": "errUsername",
    "Display name must be 1–50 characters.": "errName",
    "About must be at most 200 characters.": "errAbout",
    "Password must be 8–128 characters.": "errPassword",
    "Passwords do not match.": "errPasswordMatch",
    "Please read and accept the privacy policy.": "errPrivacy",
    "That username is already taken.": "errTaken",
    "Incorrect username or password.": "errLogin",
    "Too many failed sign-in attempts. Try again in 15 minutes.": "errRateLimit",
    "Current password is incorrect.": "errCurrentPassword",
    "User not found.": "errNotFound",
    "You cannot message yourself.": "errSelf",
    "Channel name is too short.": "errChannelName",
    "Group name is too short.": "errGroupName",
    "Add between 2 and 199 other participants.": "errGroupUsers",
    "A group must have at least two other members.": "errGroupMembers",
    "One or more usernames were not found.": "errUsernames",
    "Write a message before sending.": "errEmptyMessage",
    "Message must contain 1–4000 characters.": "errMessageLength",
    "You can send at most 20 messages per minute.": "errMessageRate",
    "Messages can only be edited within 48 hours.": "messageEditExpired"
  };
  return knownErrors[message] ? t(knownErrors[message]) : message || t("errGeneric");
}

function notify(message) {
  document.dispatchEvent(new CustomEvent("polus:notify", { detail: message }));
}

function validateMaterialsResponse(response) {
  if (!response || !Array.isArray(response.items)
    || !Number.isSafeInteger(response.total) || response.total < 0
    || typeof response.hasMore !== "boolean"
    || (response.nextCursor !== null && typeof response.nextCursor !== "string"
      && typeof response.nextCursor !== "number")) {
    throw new Error(t("invalidMaterialsResponse"));
  }
  return response;
}

function jsonOptions(method, body) {
  return { method, body: JSON.stringify(body) };
}

function requestFromReact(eventName, detail) {
  return new Promise((resolve, reject) => {
    document.dispatchEvent(new CustomEvent(eventName, {
      detail: { ...detail, resolve, reject }
    }));
  });
}

function validateMessageHistory(history) {
  if (!history || !Array.isArray(history.messages)
    || typeof history.hasMore !== "boolean"
    || (history.nextCursor !== null && typeof history.nextCursor !== "string"
      && typeof history.nextCursor !== "number")) {
    throw new Error(t("errGeneric"));
  }
  return history;
}

function initials(name) {
  return Array.from(name.trim())[0]?.toLocaleUpperCase(language === "ru" ? "ru-RU" : "en-US") || "?";
}

function formatTime(value) {
  return new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-US", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatDay(value) {
  return new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-US", {
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(new Date(value));
}

function presenceLabel(user) {
  if (user.showOnlineStatus === false) return "";
  if (user.online) return t("onlineStatus");
  if (user.lastSeenAt) return `${t("lastSeen")}: ${formatDay(user.lastSeenAt)} ${formatTime(user.lastSeenAt)}`;
  return t("offlineStatus");
}

function messageDayKey(message) {
  const date = new Date(message.createdAt || message.sentAt);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function getConversation(id) {
  return channels.find((item) => item.id === id) || directs.find((item) => item.id === id);
}

function getTranslatedConversationName(conversation) {
  return conversation.type === "saved" ? t("savedMessages") : conversation.name;
}

function renderConversations() {
  window.dispatchEvent(new CustomEvent("polus:conversations-changed", {
    detail: {
      channels,
      directs,
      currentConversationId: currentConversation?.id || null,
      language
    }
  }));
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function renderMessages({
  preserveScroll = false,
  keepScrollTop = false,
  previousHeight = 0,
  previousTop = 0
} = {}) {
  closeMessageContextMenu();
  window.dispatchEvent(new CustomEvent("polus:messages-changed", {
    detail: {
      conversation: currentConversation,
      messages,
      currentUserId: currentUser?.id,
      olderMessagesCursor,
      loadingOlderMessages,
      scroll: keepScrollTop
        ? { mode: "top", previousTop }
        : preserveScroll
          ? { mode: "preserve", previousHeight, previousTop }
          : { mode: "bottom" }
    }
  }));
}

function handleMessageContextMenu(event) {
  const row = event.target instanceof Element ? event.target.closest("[data-message-id]") : null;
  if (!row || !currentConversation) return;
  const message = messages.find((item) => String(item.id) === row.dataset.messageId);
  if (!message || message.deleted) return;
  const ownMessage = message.authorId === currentUser.id || message.author?.id === currentUser.id;
  const canModerate = ["channel", "group"].includes(currentConversation.type)
    && ["owner", "admin"].includes(currentConversation.role);
  const canEdit = ownMessage && Date.now() - Date.parse(message.createdAt || message.sentAt) <= 48 * 60 * 60 * 1000;
  const canDelete = ownMessage || canModerate;
  const canSave = currentConversation.type !== "saved";
  const canReply = true;
  const canForward = true;
  if (!canEdit && !canDelete && !canSave && !canReply && !canForward) return;
  event.preventDefault();
  openMessageContextMenu(event.clientX, event.clientY, message, {
    canEdit, canDelete, canSave, canReply, canForward, canReact: true
  });
}

function closeMessageContextMenu() {
  document.dispatchEvent(new CustomEvent("polus:message-context-menu-close"));
}

function openMessageContextMenu(x, y, message, permissions) {
  document.dispatchEvent(new CustomEvent("polus:message-context-menu-open", {
    detail: { x, y, message, ...permissions }
  }));
}

async function openMediaViewer(attachmentId) {
  const mediaResponse = validateMaterialsResponse(
    await api(`/api/chats/${encodeURIComponent(currentConversation.id)}/materials?kind=media`)
  );
  const index = mediaResponse.items.findIndex((item) => item.id === attachmentId);
  if (index < 0) return;
  document.dispatchEvent(new CustomEvent("polus:media-viewer-open", {
    detail: { items: mediaResponse.items, index }
  }));
  openDialog("media-viewer");
}

function formatFileSize(size) {
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB"];
  let value = size / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function updateConversationHeader(conversation) {
  window.dispatchEvent(new CustomEvent("polus:conversation-header-changed", {
    detail: { conversation, language }
  }));
  const canPost = conversation.type !== "channel"
    || ["owner", "admin"].includes(conversation.role);
  document.dispatchEvent(new CustomEvent("polus:composer-state", {
    detail: { visible: canPost, enabled: canPost, conversation }
  }));
}

async function openChatInfo(tab = currentInfoTab) {
  if (!currentConversation || currentConversation.pending) return;
  currentInfoTab = tab;
  const requestId = ++chatInfoRequestId;
  const conversation = currentConversation;
  const tabs = [
    "media",
    ...(conversation.joined ? ["files"] : []),
    "links"
  ];
  const selectedTab = tabs.includes(tab) ? tab : tabs[0];
  const tabResponses = {};
  try {
    await Promise.all(tabs.map(async (tabName) => {
      const tabQuery = new URLSearchParams({ kind: tabName });
      tabResponses[tabName] = validateMaterialsResponse(
        await api(`/api/chats/${encodeURIComponent(conversation.id)}/materials?${tabQuery}`)
      );
    }));
  } catch (error) {
    notify(localizeError(error.message));
    return;
  }
  if (requestId !== chatInfoRequestId || currentConversation?.id !== conversation.id) return;
  await openChatManagement();
  if (requestId !== chatInfoRequestId || currentConversation?.id !== conversation.id) return;
  chatInfoState = { conversation, tabs, responses: tabResponses, selectedTab, loadingMore: false };
  publishChatInfo();
  openDialog("chat-info-dialog");
}

function publishChatInfo() {
  if (!chatInfoState) return;
  const { conversation, tabs, responses, selectedTab, loadingMore } = chatInfoState;
  const roleLabel = (role) => t(`role${role[0].toUpperCase()}${role.slice(1)}`);
  const response = responses[selectedTab];
  const items = response.items.map((item) => ({
    ...item,
    roleLabel: item.role ? roleLabel(item.role) : "",
    presence: item.role ? presenceLabel(item) : "",
    createdAtLabel: item.createdAt ? formatDay(item.createdAt) : "",
    sizeLabel: item.size === undefined ? "" : formatFileSize(item.size),
    displayDetail: selectedTab === "links"
      ? `${item.domain} · @${item.author?.username || ""} · ${item.createdAt ? formatDay(item.createdAt) : ""}`
      : `${formatFileSize(item.size)} · @${item.author?.username || ""} · ${item.createdAt ? formatDay(item.createdAt) : ""}`
  }));
  document.dispatchEvent(new CustomEvent("polus:chat-info-changed", {
    detail: {
      chatName: getTranslatedConversationName(conversation),
      chatType: conversation.type,
      conversationId: conversation.id,
      avatarUrl: conversation.avatarUrl || null,
      description: conversation.description || "",
      memberCount: conversation.memberIds?.length || 0,
      selectedTab,
      tabs: tabs.map((kind) => ({
        kind,
        label: t(`tab${kind[0].toUpperCase()}${kind.slice(1)}`),
        total: responses[kind].total
      })),
      response: { ...response, items },
      canView: Boolean(conversation.joined),
      canMute: Boolean(conversation.joined) && conversation.type !== "saved",
      muted: Boolean(conversation.muted),
      loadingMore,
      labels: {
        members: t("tabMembers"),
        media: t("tabMedia"),
        files: t("tabFiles"),
        links: t("tabLinks"),
        noResults: t("noResults"),
        openMessage: t("openMessage"),
        download: t("download"),
        loadOlderMessages: t("loadOlderMessages"),
        muteChat: t("muteChat"),
        unmuteChat: t("unmuteChat"),
        loading: language === "ru" ? "Загрузка…" : "Loading…"
      }
    }
  }));
}

async function loadMoreChatInfo(kind, cursor) {
  const state = chatInfoState;
  if (!state || state.selectedTab !== kind || state.loadingMore) return;
  state.loadingMore = true;
  publishChatInfo();
  try {
    const query = new URLSearchParams({ kind, before: String(cursor) });
    const next = validateMaterialsResponse(
      await api(`/api/chats/${encodeURIComponent(state.conversation.id)}/materials?${query}`)
    );
    if (chatInfoState !== state || currentConversation?.id !== state.conversation.id) return;
    const previous = state.responses[kind];
    state.responses[kind] = {
      ...next,
      total: previous.total,
      items: [...previous.items, ...next.items]
    };
  } catch (error) {
    notify(localizeError(error.message));
  } finally {
    if (chatInfoState === state) {
      state.loadingMore = false;
      publishChatInfo();
    }
  }
}

async function toggleChatMute(mute, { conversation = currentConversation, refreshInfo = true } = {}) {
  if (!conversation) return;
  const method = mute ? "POST" : "DELETE";
  const result = await api(`/api/chats/${encodeURIComponent(conversation.id)}/mute`, { method });
  conversation.muted = result.muted;
  for (const item of [...directs, ...channels]) {
    if (item.id === conversation.id) item.muted = result.muted;
  }
  notify(t(result.muted ? "muted" : "unmuted"));
  if (refreshInfo && currentConversation?.id === conversation.id) await openChatInfo(currentInfoTab);
}

async function jumpToMessage(messageId) {
  if (!currentConversation) return;
  const conversationId = currentConversation.id;
  while (messages.length && messages[0].id > messageId) {
    const before = messages[0].id;
    const history = validateMessageHistory(await requestFromReact("polus:load-message-history", {
      conversationId,
      before
    }));
    if (currentConversation?.id !== conversationId) return;
    if (!history.messages.length) break;
    messages = [...history.messages.reverse(), ...messages];
    if (!history.hasMore) olderMessagesCursor = null;
    else olderMessagesCursor = history.nextCursor;
  }
  renderMessages();
  const row = messageList.querySelector(`[data-message-id="${CSS.escape(String(messageId))}"]`);
  if (!row) {
    notify(t("noResults"));
    return;
  }
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  row.classList.add("is-highlighted");
  setTimeout(() => row.classList.remove("is-highlighted"), 1800);
}

async function searchChat(queryValue) {
  const requestId = ++chatSearchRequestId;
  const query = queryValue.trim();
  if (query.length < 2) {
    document.dispatchEvent(new CustomEvent("polus:chat-search-results", {
      detail: { results: [], message: t("searchPromptChat") }
    }));
    return;
  }
  const search = new URLSearchParams({ q: query });
  const response = await api(`/api/chats/${encodeURIComponent(currentConversation.id)}/search?${search}`);
  if (requestId !== chatSearchRequestId) return;
  document.dispatchEvent(new CustomEvent("polus:chat-search-results", {
    detail: { results: response.results, message: response.results.length ? "" : t("noResults") }
  }));
}

async function openUserProfile(username) {
  if (username.toLowerCase() === currentUser.username.toLowerCase()) {
    document.dispatchEvent(new CustomEvent("polus:open-own-profile"));
    return;
  }
  const response = await api(`/api/users/${encodeURIComponent(username)}/profile`);
  const { user: target, sharedChats, sharedMedia, canMessage } = response;
  const targetDirect = [currentConversation, ...directs].find((chat) =>
    chat && !chat.pending && chat.type === "direct" && chat.memberIds?.includes(target.id));
  document.dispatchEvent(new CustomEvent("polus:user-profile-changed", {
    detail: {
      user: target,
      sharedChats,
      sharedMedia,
      canMessage,
      status: presenceLabel(target),
      registered: target.createdAt ? formatDay(target.createdAt) : "",
      muted: targetDirect ? targetDirect.muted : null,
      labels: {
        writeToUser: t("writeToUser"),
        blockUser: t("blockUser"),
        unblockUser: t("unblockUser"),
        muteChat: t("muteChat"),
        unmuteChat: t("unmuteChat"),
        about: t("aboutOptional"),
        noAbout: t("noAbout"),
        registered: t("registered"),
        sharedChats: t("sharedChats"),
        noSharedChats: t("noSharedChats"),
        sharedMedia: t("sharedMedia"),
        noSharedMedia: t("noSharedMedia")
      }
    }
  }));
  openDialog("profile-view-dialog");
}

async function markConversationRead(conversation) {
  if (conversation.type === "saved" || conversation.pending || document.visibilityState !== "visible"
    || currentConversation?.id !== conversation.id || !isMessageListAtBottom()) return;
  const latestDisplayedId = messages.at(-1)?.id || 0;
  if (!conversation.unreadCount && latestDisplayedId <= (conversation.lastReadMessageId || 0)) return;
  conversation.unreadCount = 0;
  renderConversations();
  try {
    const result = await requestFromReact("polus:mark-conversation-read", {
      conversationId: conversation.id
    });
    conversation.lastReadMessageId = result.lastReadMessageId;
  } catch (error) {
    if (error.status !== 401) notify(localizeError(error.message));
  }
}

function isMessageListAtBottom() {
  return messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight < 80;
}

async function openConversation(conversation) {
  messengerView.classList.add("chat-open");
  if (!conversation.joined && conversation.type === "channel") {
    try {
      conversation = await api(`/api/channels/${encodeURIComponent(conversation.id)}/join`, { method: "POST" });
      channels = channels.map((channel) => channel.id === conversation.id ? conversation : channel);
    } catch (error) {
      notify(localizeError(error.message));
      return;
    }
  }
  currentConversation = conversation;
  messages = [];
  olderMessagesCursor = null;
  loadingOlderMessages = false;
  updateConversationHeader(conversation);
  renderConversations();
  renderMessages();
  if (!conversation.pending) {
    try {
      const history = validateMessageHistory(await requestFromReact("polus:load-message-history", {
        conversationId: conversation.id
      }));
      if (currentConversation?.id !== conversation.id) return;
      messages = history.messages.reverse();
      olderMessagesCursor = history.nextCursor;
      renderMessages();
      if (document.visibilityState === "visible") await markConversationRead(conversation);
    } catch (error) {
      notify(localizeError(error.message));
    }
  }
  if (window.history?.replaceState) {
    const target = new URL(window.location.href);
    target.searchParams.set("conversation", conversation.id);
    window.history.replaceState({}, "", target);
  }
}

async function loadOlderMessages() {
  if (!currentConversation || !olderMessagesCursor || loadingOlderMessages) return;
  loadingOlderMessages = true;
  const previousHeight = messageList.scrollHeight;
  const previousTop = messageList.scrollTop;
  const conversationId = currentConversation.id;
  renderMessages();
  try {
    const history = validateMessageHistory(await requestFromReact("polus:load-message-history", {
      conversationId,
      before: olderMessagesCursor
    }));
    if (currentConversation?.id !== conversationId) return;
    if (history.messages.length === 0) {
      olderMessagesCursor = null;
      return;
    }
    messages = [...history.messages.reverse(), ...messages]
      .sort((left, right) => left.id - right.id);
    olderMessagesCursor = history.nextCursor;
  } catch (error) {
    notify(localizeError(error.message));
  } finally {
    loadingOlderMessages = false;
    if (currentConversation?.id === conversationId) {
      renderMessages({ preserveScroll: true, previousHeight, previousTop });
    }
  }
}

function setUser(user) {
  currentUser = user;
  document.dispatchEvent(new CustomEvent("polus:current-user-changed", { detail: user }));
  renderProfileAvatarPreview(user);
}

function renderProfileAvatarPreview(user, src = user.avatarUrl) {
  document.dispatchEvent(new CustomEvent("polus:profile-avatar-preview-changed", {
    detail: { user, previewUrl: src === user.avatarUrl ? "" : src, fileName: "" }
  }));
}

function prepareOwnProfile() {
  if (profilePreviewUrl) URL.revokeObjectURL(profilePreviewUrl);
  profilePreviewUrl = null;
  document.dispatchEvent(new CustomEvent("polus:prepare-profile"));
}

async function updateProfileAvatarPreview(file) {
  if (profilePreviewUrl) URL.revokeObjectURL(profilePreviewUrl);
  profilePreviewUrl = null;
  if (!file) {
    renderProfileAvatarPreview(currentUser);
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    document.dispatchEvent(new CustomEvent("polus:profile-avatar-clear"));
    renderProfileAvatarPreview(currentUser);
    notify(t("profileAvatar"));
    return;
  }
  document.dispatchEvent(new CustomEvent("polus:profile-avatar-preview-changed", {
    detail: { user: currentUser, previewUrl: "", fileName: file.name }
  }));
  try {
    const cropped = await cropAvatar(file);
    profilePreviewUrl = URL.createObjectURL(cropped);
    document.dispatchEvent(new CustomEvent("polus:profile-avatar-preview-changed", {
      detail: { user: currentUser, previewUrl: profilePreviewUrl, fileName: file.name }
    }));
  } catch (error) {
    renderProfileAvatarPreview(currentUser);
    notify(localizeError(error.message));
  }
}

async function loadMessenger(session) {
  const data = await api("/api/bootstrap");
  if (session !== controllerSession) return;
  setUser(data.user);
  channels = data.channels;
  directs = data.directs;
  pushKey = data.vapidPublicKey;
  renderConversations();
  if ("serviceWorker" in navigator && window.isSecureContext) {
    try {
      await navigator.serviceWorker.register("/sw.js");
    } catch (error) {
      console.error("Service worker registration failed:", error);
    }
  }
  if (session !== controllerSession) return;
  const requestedId = new URLSearchParams(location.search).get("conversation");
  const first = getConversation(requestedId) || channels.find((channel) => channel.joined) || directs[0];
  if (first) await openConversation(first);
  if (session !== controllerSession) return;
  if (!getConversation(requestedId)) messengerView.classList.remove("chat-open");
  document.dispatchEvent(new CustomEvent("polus:connect-realtime"));
}

async function receiveMessage(message) {
  let conversation = getConversation(message.conversationId);
  let fetchedConversation = false;
  if (!conversation) {
    await refreshMessengerState();
    conversation = getConversation(message.conversationId);
    fetchedConversation = true;
  }
  if (!conversation) return;
  if (conversation.type === "saved") conversation.unreadCount = 0;
  if (currentConversation?.pending
    && (message.author.id === currentUser.id || currentConversation.username === message.author.username)) {
    currentConversation = conversation;
    updateConversationHeader(conversation);
    messages = [];
  }
  conversation.lastMessage = message;
  if (currentConversation?.id === message.conversationId) {
    const wasAtBottom = document.visibilityState === "visible" && isMessageListAtBottom();
    const previousHeight = messageList.scrollHeight;
    const previousTop = messageList.scrollTop;
    if (!messages.some((item) => item.id === message.id)) {
      messages.push(message);
      messages.sort((left, right) => left.id - right.id);
    }
    renderMessages(wasAtBottom ? {} : { keepScrollTop: true, previousTop, previousHeight });
    if (wasAtBottom) {
      void markConversationRead(conversation);
    } else if (conversation.type !== "saved" && message.authorId !== currentUser.id) {
      conversation.unreadCount = (conversation.unreadCount || 0) + 1;
      renderConversations();
    }
  } else {
    const incoming = message.authorId !== currentUser.id;
    if (conversation.type !== "saved" && incoming && !fetchedConversation) {
      conversation.unreadCount = (conversation.unreadCount || 0) + 1;
    }
    if (conversation.type !== "saved" && incoming) {
      notify(`${t("messageArrived")} @${message.author.username}`);
    }
    renderConversations();
  }
}

async function refreshMessengerState() {
  const data = await api("/api/bootstrap");
  channels = data.channels;
  directs = data.directs;
  const updatedConversation = currentConversation && getConversation(currentConversation.id);
  if (updatedConversation) {
    currentConversation = updatedConversation;
    if (updatedConversation.type === "channel" && updatedConversation.postAs !== "channel") {
      messages = messages.map((message) => {
        if (!message.displayAuthor) return message;
        const { displayAuthor, ...personMessage } = message;
        return personMessage;
      });
    }
    updateConversationHeader(updatedConversation);
  } else if (currentConversation && !currentConversation.pending) {
    currentConversation = null;
    messengerView.classList.remove("chat-open");
    messages = [];
    document.dispatchEvent(new CustomEvent("polus:composer-state", {
      detail: { visible: true, enabled: false, conversation: null }
    }));
    closeDialog("chat-info-dialog");
    const target = new URL(window.location.href);
    target.searchParams.delete("conversation");
    window.history?.replaceState({}, "", target);
  }
  renderConversations();
  renderMessages();
}

async function resyncRealtimeState() {
  await refreshMessengerState();
  const conversation = currentConversation;
  if (!conversation || conversation.pending) return;
  const history = validateMessageHistory(await requestFromReact("polus:load-message-history", {
    conversationId: conversation.id
  }));
  if (currentConversation?.id !== conversation.id) return;
  messages = history.messages.reverse();
  olderMessagesCursor = history.nextCursor;
  loadingOlderMessages = false;
  renderMessages();
  if (document.visibilityState === "visible") await markConversationRead(conversation);
}

async function applySentMessage({ sent, conversation: submittedConversation } = {}) {
  if (!sent || !submittedConversation) return;
  const isPendingConversation = Boolean(submittedConversation.pending);
  const sentConversation = isPendingConversation ? sent.conversation : null;
  if (sentConversation) {
    const existingIndex = directs.findIndex((conversation) => conversation.id === sentConversation.id);
    if (existingIndex < 0) directs.unshift(sentConversation);
    else directs[existingIndex] = sentConversation;
    if (currentConversation?.id === submittedConversation.id) {
      currentConversation = sentConversation;
      olderMessagesCursor = null;
      updateConversationHeader(sentConversation);
      await markConversationRead(sentConversation);
      const target = new URL(window.location.href);
      target.searchParams.set("conversation", sentConversation.id);
      window.history?.replaceState({}, "", target);
    }
  } else {
    const conversation = getConversation(submittedConversation.id);
    if (conversation) conversation.lastMessage = sent;
    if (currentConversation?.id === submittedConversation.id) currentConversation.lastMessage = sent;
  }
  if (currentConversation?.id === (sentConversation?.id || submittedConversation.id)) {
    if (!messages.some((message) => message.id === sent.id)) messages.push(sent);
    messages.sort((left, right) => left.id - right.id);
    renderMessages();
  }
  renderConversations();
}

async function saveMessageToFavorites(message) {
  if (!message || currentConversation?.type === "saved") return;
  const saved = await api(`/api/messages/${encodeURIComponent(message.id)}/save`, { method: "POST" });
  let conversation = directs.find((item) => item.id === saved.conversation.id);
  if (!conversation) {
    conversation = saved.conversation;
    directs.unshift(conversation);
  }
  conversation.lastMessage = saved;
  conversation.unreadCount = 0;
  if (currentConversation?.id === conversation.id) {
    currentConversation.lastMessage = saved;
    if (!messages.some((item) => item.id === saved.id)) messages.push(saved);
    messages.sort((left, right) => left.id - right.id);
    renderMessages();
  }
  renderConversations();
  notify(t("savedMessageSaved"));
}

function applyMessageMutation(message) {
  if (!message) return;
  const index = messages.findIndex((item) => item.id === message.id);
  if (index >= 0) {
    messages = messages.map((item) => item.id === message.id ? message : item);
    renderMessages();
  }
  const conversation = getConversation(message.conversationId);
  if (conversation?.lastMessage?.id === message.id) {
    conversation.lastMessage = message;
    renderConversations();
  }
}

async function openChatManagement() {
  const selectedChat = currentConversation;
  if (!selectedChat || !["channel", "group"].includes(selectedChat.type) || selectedChat.pending) {
    document.dispatchEvent(new CustomEvent("polus:chat-management-changed", { detail: null }));
    return;
  }
  try {
    const { chat, members: chatMembers } = await api(`/api/chats/${encodeURIComponent(selectedChat.id)}`);
    if (currentConversation?.id !== selectedChat.id) return;
    document.dispatchEvent(new CustomEvent("polus:chat-management-changed", {
      detail: {
        chat,
        members: chatMembers.map((member) => ({
          ...member,
          roleLabel: t(`role${member.role[0].toUpperCase()}${member.role.slice(1)}`)
        })),
        currentUserId: currentUser.id,
        labels: {
          chatMembers: t("chatMembers"),
          makeAdmin: t("makeAdmin"),
          removeAdmin: t("removeAdmin"),
          remove: t("remove"),
          channelPostIdentity: t("channelPostIdentity"),
          postAsPerson: t("postAsPerson"),
          postAsChannel: t("postAsChannel"),
          usernamePlaceholder: t("usernamePlaceholder"),
          inviteMember: t("inviteMember"),
          transferOwnership: t("transferOwnership"),
          deleteChat: t("deleteChat"),
          leaveChat: t("leaveChat")
        }
      }
    }));
  } catch (error) {
    document.dispatchEvent(new CustomEvent("polus:chat-management-changed", { detail: null }));
    notify(localizeError(error.message));
  }
}

async function handleChatManagementAction({ action, chatId, memberId, makeAdmin, postAs, username }) {
  const selectedChat = currentConversation;
  if (!selectedChat || selectedChat.id !== chatId || !["channel", "group"].includes(selectedChat.type)) {
    closeDialog("chat-info-dialog");
    return;
  }
  const refreshDialog = async () => {
    await refreshMessengerState();
    if (currentConversation?.id === chatId) await openChatInfo(currentInfoTab);
    else closeDialog("chat-info-dialog");
  };
  try {
    if (action === "toggle-admin") {
      await api(`/api/chats/${encodeURIComponent(chatId)}/admins/${encodeURIComponent(memberId)}`,
        jsonOptions("PUT", { role: makeAdmin ? "admin" : "member" }));
      await refreshDialog();
    } else if (action === "remove-member") {
      await api(`/api/chats/${encodeURIComponent(chatId)}/members/${encodeURIComponent(memberId)}`,
        { method: "DELETE" });
      await refreshDialog();
    } else if (action === "set-post-identity") {
      await api(`/api/chats/${encodeURIComponent(chatId)}/settings`, jsonOptions("PUT", { postAs }));
      await refreshDialog();
      notify(t("postIdentitySaved"));
    } else if (action === "invite-member") {
      await api(`/api/chats/${encodeURIComponent(chatId)}/members`, jsonOptions("POST", { username }));
      await refreshDialog();
    } else if (action === "transfer-ownership") {
      await api(`/api/chats/${encodeURIComponent(chatId)}/owner`, jsonOptions("PUT", { username }));
      await refreshDialog();
      notify(t("ownershipTransferred"));
    } else if (action === "delete-chat") {
      if (!window.confirm(`${t("deleteChat")}?`)) {
        await openChatInfo(currentInfoTab);
        return;
      }
      await api(`/api/chats/${encodeURIComponent(chatId)}`, { method: "DELETE" });
      closeDialog("chat-info-dialog");
      await refreshMessengerState();
      notify(t("chatDeleted"));
    } else if (action === "leave-chat") {
      await api(`/api/chats/${encodeURIComponent(chatId)}/leave`, { method: "POST" });
      closeDialog("chat-info-dialog");
      await refreshMessengerState();
    }
  } catch (error) {
    notify(localizeError(error.message));
    if (currentConversation?.id === chatId) await openChatInfo(currentInfoTab);
  }
}

async function signOut() {
  try {
    document.dispatchEvent(new CustomEvent("polus:presence-stop"));
    const registration = "serviceWorker" in navigator && window.isSecureContext
      ? await navigator.serviceWorker.ready
      : null;
    const subscription = registration ? await registration.pushManager.getSubscription() : null;
    await api("/api/auth/logout", jsonOptions("POST", {
      pushEndpoint: subscription?.endpoint || ""
    }));
    if (subscription) await subscription.unsubscribe();
    setPushEnabled(false);
    currentUser = null;
    document.dispatchEvent(new CustomEvent("polus:current-user-changed", { detail: null }));
    currentConversation = null;
    messengerView.classList.remove("chat-open");
    channels = [];
    directs = [];
    messages = [];
    document.dispatchEvent(new CustomEvent("polus:session-signed-out"));
  } catch (error) {
    notify(localizeError(error.message));
  }
}

function decodeBase64Url(value) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const raw = atob(value.replace(/-/g, "+").replace(/_/g, "/") + padding);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

async function togglePushNotifications() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    notify(t("unavailablePush"));
    return;
  }
  if (!window.isSecureContext) {
    notify(t("secureRequired"));
    return;
  }
  try {
    const registration = await navigator.serviceWorker.ready;
    const current = await registration.pushManager.getSubscription();
    if (current) {
      await api("/api/push/subscribe", jsonOptions("DELETE", { endpoint: current.endpoint }));
      await current.unsubscribe();
      setPushEnabled(false);
      notify(t("pushDisabled"));
      return;
    }
    if (Notification.permission === "denied") {
      notify(t("permissionDenied"));
      return;
    }
    const permission = Notification.permission === "granted"
      ? "granted"
      : await Notification.requestPermission();
    if (permission !== "granted") {
      notify(t("permissionDenied"));
      return;
    }
    if (!pushKey) {
      notify(t("unavailablePush"));
      return;
    }
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeBase64Url(pushKey)
    });
    await api("/api/push/subscribe", jsonOptions("POST", { subscription: subscription.toJSON() }));
    setPushEnabled(true);
    notify(t("pushEnabled"));
  } catch (error) {
    notify(localizeError(error.message));
  }
}

async function checkPushSubscription() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    setPushEnabled(Boolean(await registration.pushManager.getSubscription()));
  } catch (error) {
    console.error("Unable to read push subscription:", error);
  }
}

function setPushEnabled(enabled) {
  document.dispatchEvent(new CustomEvent("polus:push-state-changed", { detail: { enabled } }));
}

function registerControllerListeners() {
  const onDialogOpenState = (event) => {
    if (event.detail.open) openDialogIds.add(event.detail.id);
    else openDialogIds.delete(event.detail.id);
  };
  listen(document, "polus:dialog-open-state", onDialogOpenState);
  listen(document, "polus:load-older-messages", () => void loadOlderMessages());
  listen(document, "polus:open-profile", (event) => {
    if (event.detail?.username) {
      void openUserProfile(event.detail.username).catch((error) => notify(localizeError(error.message)));
    }
  });
  listen(document, "polus:user-profile-action", (event) => {
    const { action, username } = event.detail || {};
    void (async () => {
      if (action === "message") {
        closeDialog("profile-view-dialog");
        document.dispatchEvent(new CustomEvent("polus:request-direct-message", { detail: { username } }));
        return;
      }
      if (action === "toggle-block") {
        const { user } = await api(`/api/users/${encodeURIComponent(username)}/profile`);
        await api(`/api/users/${encodeURIComponent(username)}/block`, {
          method: user.blocked ? "DELETE" : "POST"
        });
        await openUserProfile(username);
        return;
      }
      if (action === "toggle-mute") {
        const { user } = await api(`/api/users/${encodeURIComponent(username)}/profile`);
        const conversation = [currentConversation, ...directs].find((chat) =>
          chat && !chat.pending && chat.type === "direct" && chat.memberIds?.includes(user.id));
        if (!conversation) return;
        await toggleChatMute(!conversation.muted, { conversation, refreshInfo: false });
        await openUserProfile(username);
      }
    })().catch((error) => notify(localizeError(error.message)));
  });
  listen(document, "polus:chat-info-action", (event) => {
    const { action, tab, cursor, attachmentId, canView, messageId, conversationId } = event.detail || {};
    if (!conversationId || currentConversation?.id !== conversationId) return;
    void (async () => {
      if (action === "select-tab") return openChatInfo(tab);
      if (action === "load-more") return loadMoreChatInfo(tab, cursor);
      if (action === "toggle-mute") return toggleChatMute(!currentConversation?.muted);
      if (action === "open-media") {
        if (canView) await openMediaViewer(attachmentId);
        else window.open(`/api/attachments/${encodeURIComponent(attachmentId)}`, "_blank", "noopener,noreferrer");
        return;
      }
      if (action === "open-message") {
        closeDialog("chat-info-dialog");
        await jumpToMessage(messageId);
      }
    })().catch((error) => notify(localizeError(error.message)));
  });
  listen(document, "polus:chat-management-action", (event) => {
    void handleChatManagementAction(event.detail || {});
  });
  listen(document, "polus:open-searched-message", (event) => {
    document.dispatchEvent(new CustomEvent("polus:close-chat-search"));
    void jumpToMessage(event.detail.messageId).catch((error) => notify(localizeError(error.message)));
  });
  listen(document, "polus:open-media", (event) => {
    if (event.detail?.attachmentId) {
      void openMediaViewer(event.detail.attachmentId).catch((error) => notify(localizeError(error.message)));
    }
  });
  listen(document, "visibilitychange", () => {
    if (document.visibilityState === "visible" && currentConversation && isMessageListAtBottom()) {
      void markConversationRead(currentConversation);
    }
  });
  listen(document, "polus:message-context-menu-request", (event) => {
    handleMessageContextMenu(event.detail.event);
  });
  listen(document, "polus:message-list-scroll", () => {
    if (document.visibilityState === "visible" && currentConversation && isMessageListAtBottom()) {
      void markConversationRead(currentConversation);
    }
  });
  listen(document, "polus:realtime-message", (event) => {
    void receiveMessage(event.detail).catch((error) => notify(localizeError(error.message)));
  });
  listen(document, "polus:realtime-chat-updated", (event) => {
    const update = event.detail;
    void refreshMessengerState().then(() => {
      if (isDialogOpen("chat-info-dialog") && currentConversation?.id === update.chatId) {
        return openChatInfo(currentInfoTab);
      }
      return undefined;
    }).catch((error) => notify(localizeError(error.message)));
  });
  listen(document, "polus:realtime-message-updated", (event) => {
    applyMessageMutation(event.detail);
  });
  listen(document, "polus:realtime-message-deleted", (event) => {
    applyMessageMutation(event.detail);
  });
  listen(document, "polus:realtime-messages-read", (event) => {
    const { conversationId, readerId, lastReadMessageId } = event.detail || {};
    if (!conversationId || readerId === currentUser?.id || !Number.isSafeInteger(lastReadMessageId)) return;
    let changed = false;
    messages = messages.map((message) => {
      if (message.conversationId !== conversationId
        || message.authorId !== currentUser?.id
        || message.id > lastReadMessageId
        || message.seenByRecipient) return message;
      changed = true;
      return { ...message, seenByRecipient: true };
    });
    if (changed && currentConversation?.id === conversationId) renderMessages();
    const conversation = getConversation(conversationId);
    if (conversation?.lastMessage?.authorId === currentUser?.id
      && conversation.lastMessage.id <= lastReadMessageId
      && !conversation.lastMessage.seenByRecipient) {
      conversation.lastMessage = { ...conversation.lastMessage, seenByRecipient: true };
      renderConversations();
    }
  });
  listen(document, "polus:realtime-resync", () => {
    void resyncRealtimeState().catch((error) => notify(localizeError(error.message)));
  });
  listen(document, "polus:message-edited", (event) => applyMessageMutation(event.detail?.message));
  listen(document, "polus:message-deleted", (event) => applyMessageMutation(event.detail?.message));
  listen(document, "polus:message-react", (event) => {
    const { messageId, emoji } = event.detail || {};
    if (!messageId || !emoji) return;
    void api(`/api/messages/${encodeURIComponent(messageId)}/reactions`,
      jsonOptions("POST", { emoji }))
      .then(applyMessageMutation)
      .catch((error) => notify(localizeError(error.message)));
  });
  listen(document, "polus:reply-message", (event) => {
    const message = event.detail?.message;
    if (!message || message.conversationId !== currentConversation?.id) return;
    document.dispatchEvent(new CustomEvent("polus:reply-target-changed", {
      detail: { conversationId: currentConversation.id, message }
    }));
  });
  listen(document, "polus:open-replied-message", (event) => {
    const { messageId } = event.detail || {};
    if (messageId) void jumpToMessage(messageId).catch((error) => notify(localizeError(error.message)));
  });
  listen(document, "polus:forward-message", (event) => {
    const message = event.detail?.message;
    if (!message) return;
    const chats = [...channels, ...directs].filter((chat) =>
      !chat.pending
      && chat.joined !== false
      && (chat.type !== "channel" || ["owner", "admin"].includes(chat.role))
    );
    document.dispatchEvent(new CustomEvent("polus:forward-dialog-open", {
      detail: { message, chats }
    }));
  });
  listen(document, "polus:forward-message-to-chat", (event) => {
    const { messageId, conversationId, recipientUsername, resolve, reject } = event.detail || {};
    void (async () => {
      try {
        const forwarded = await api(`/api/messages/${encodeURIComponent(messageId)}/forward`,
          jsonOptions("POST", {
            ...(conversationId ? { conversationId } : {}),
            ...(recipientUsername ? { recipientUsername } : {})
          }));
        await refreshMessengerState();
        const destination = getConversation(forwarded.conversationId);
        await applySentMessage({ sent: forwarded, conversation: destination });
        notify(t("messageForwarded"));
        resolve?.();
      } catch (error) {
        reject?.(new Error(localizeError(error.message)));
      }
    })();
  });
  listen(document, "polus:save-message", (event) => {
    void saveMessageToFavorites(event.detail?.message).catch((error) => notify(localizeError(error.message)));
  });
  listen(document, "polus:set-language", (event) => setLanguage(event.detail.language));
  listen(document, "polus:message-sent", (event) => {
    void applySentMessage(event.detail).catch((error) => notify(localizeError(error.message)));
  });
  listen(document, "polus:chat-info", () => void openChatInfo());
  listen(document, "polus:search-chat", (event) => {
    clearTimeout(chatSearchTimer);
    const query = event.detail.query;
    if (!query.trim()) {
      ++chatSearchRequestId;
      document.dispatchEvent(new CustomEvent("polus:chat-search-results", {
        detail: { results: [], message: t("searchPromptChat") }
      }));
      return;
    }
    chatSearchTimer = setTimeout(() => {
      void searchChat(query).catch((error) => notify(localizeError(error.message)));
    }, 180);
  });
  listen(document, "polus:profile-dialog-open", prepareOwnProfile);
  listen(document, "polus:profile-avatar-selected", (event) => {
    void updateProfileAvatarPreview(event.detail.file);
  });
  listen(document, "polus:profile-saved", (event) => {
    if (profilePreviewUrl) URL.revokeObjectURL(profilePreviewUrl);
    profilePreviewUrl = null;
    setUser(event.detail.user);
  });
  listen(document, "polus:sign-out", () => void signOut());
  listen(document, "polus:toggle-push", () => void togglePushNotifications());
  listen(document, "polus:sidebar-search", (event) => {
    sidebarSearchQuery = event.detail.query;
    renderConversations();
  });
  listen(document, "polus:clear-sidebar-search", () => {
    sidebarSearchQuery = "";
  });
  listen(document, "polus:find-people", () => {
    const query = sidebarSearchQuery.trim();
    document.dispatchEvent(new CustomEvent("polus:open-people-search", { detail: { query } }));
  });
  listen(document, "polus:open-conversation", (event) => {
    const conversation = event.detail.conversation;
    if (!conversation.pending) {
      if (conversation.type === "channel") {
        if (!channels.some((item) => item.id === conversation.id)) channels.unshift(conversation);
      } else if (!directs.some((item) => item.id === conversation.id)) {
        directs.unshift(conversation);
      }
    }
    renderConversations();
    void openConversation(conversation);
  });
}

async function start(session) {
  setLanguage(language);
  try {
    await loadMessenger(session);
    if (session !== controllerSession) return;
    await checkPushSubscription();
  } catch (error) {
    if (session === controllerSession) notify(localizeError(error.message));
  }
}

export function initializeMessenger() {
  if (controllerInitialized) return () => {};
  controllerInitialized = true;
  const session = ++controllerSession;
  registerControllerListeners();
  listen(document, "submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if ((form.getAttribute("method") || "").toLowerCase() === "dialog") return;
    event.preventDefault();
    if (!polusReady) {
      window.alert("Страница загрузилась не полностью. Обновите её (Ctrl+F5).");
    }
  });
  polusReady = true;
  void start(session);
  return () => {
    if (session !== controllerSession) return;
    ++controllerSession;
    polusReady = false;
    for (const removeListener of controllerListeners.splice(0)) removeListener();
    controllerInitialized = false;
    clearTimeout(chatSearchTimer);
  };
}