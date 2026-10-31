// Защита форм: данные никогда не должны уходить в адресную строку.
// Выполняется первой, раньше остальной инициализации.
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
  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if ((form.getAttribute("method") || "").toLowerCase() === "dialog") return;
    // Обработчики формы уже выполнены; обычная отправка браузером никогда не нужна.
    event.preventDefault();
    if (!polusReady) {
      window.alert("Страница загрузилась не полностью. Обновите её (Ctrl+F5).");
    }
  });
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

const authView = document.querySelector("#auth-view");
const messengerView = document.querySelector("#messenger-view");
const authForm = document.querySelector("#auth-form");
const authSwitch = document.querySelector("#auth-switch");
const authSwitchCopy = document.querySelector("#auth-switch-copy");
const authTitle = document.querySelector("#auth-title");
const authSubtitle = document.querySelector("#auth-subtitle");
const authSubmit = document.querySelector("#auth-submit");
const authError = document.querySelector("#auth-error");
const registerFields = document.querySelector("#register-fields");
const registerAboutField = document.querySelector("#register-about-field");
const registerHint = document.querySelector("#register-hint");
const confirmField = document.querySelector("#confirm-field");
const privacyConsent = document.querySelector("#privacy-consent");
const usernameInput = document.querySelector("#username");
const fullNameInput = document.querySelector("#full-name");
const passwordInput = document.querySelector("#password");
const confirmPasswordInput = document.querySelector("#confirm-password");
const acceptPrivacyInput = document.querySelector("#accept-privacy");
const authLanguage = document.querySelector("#auth-language");
const appLanguage = document.querySelector("#app-language");
const chatList = document.querySelector("#chat-list");
const discoverList = document.querySelector("#discover-list");
const openChannelsSection = document.querySelector("#open-channels");
const searchPeopleRow = document.querySelector("#search-people-row");
const chatListEmpty = document.querySelector("#chat-list-empty");
const sidebarSearchInput = document.querySelector("#sidebar-search");
const sidebarMenu = document.querySelector("#sidebar-menu");
const sidebarMenuButton = document.querySelector("#sidebar-menu-button");
const messageList = document.querySelector("#message-list");
const messageInput = document.querySelector("#message-input");
const composer = document.querySelector("#composer");
const sendButton = document.querySelector("#send-button");
const conversationTitle = document.querySelector("#conversation-title");
const conversationSubtitle = document.querySelector("#conversation-subtitle");
const conversationIcon = document.querySelector("#conversation-icon");
const toast = document.querySelector("#toast");
const messageContextMenu = document.querySelector("#message-context-menu");
const directoryDialog = document.querySelector("#directory-dialog");
const channelDialog = document.querySelector("#channel-dialog");
const groupDialog = document.querySelector("#group-dialog");
const profileDialog = document.querySelector("#profile-dialog");
const notificationIndicator = document.querySelector("#notification-indicator");
const notificationButton = document.querySelector("#notifications-button");
const manageChatButton = document.querySelector("#manage-chat");
const chatManagementDialog = document.querySelector("#chat-management-dialog");
const chatManagementContent = document.querySelector("#chat-management-content");
const chatManagementTitle = document.querySelector("#chat-management-title");
const chatInfoButton = document.querySelector("#chat-info");
const chatSearchButton = document.querySelector("#chat-search");
const chatInfoDialog = document.querySelector("#chat-info-dialog");
const chatInfoTitle = document.querySelector("#chat-info-title");
const chatInfoTabs = document.querySelector("#chat-info-tabs");
const chatInfoContent = document.querySelector("#chat-info-content");
const chatSearchDialog = document.querySelector("#chat-search-dialog");
const chatSearchInput = document.querySelector("#chat-search-input");
const chatSearchResults = document.querySelector("#chat-search-results");
const profileViewDialog = document.querySelector("#profile-view-dialog");
const profileViewContent = document.querySelector("#profile-view-content");
const profileViewTitle = document.querySelector("#profile-view-title");
const attachmentInput = document.querySelector("#attachment-input");
const attachmentPreview = document.querySelector("#attachment-preview");
const uploadProgress = document.querySelector("#upload-progress");
const cancelUploadButton = document.querySelector("#cancel-upload");
let pendingAttachments = [];
let currentUpload = null;
let profilePreviewUrl = null;
let currentInfoTab = "members";
let mediaViewerItems = [];
let mediaViewerIndex = 0;
messageInput.disabled = true;
sendButton.disabled = true;

let language = localStorage.getItem("polus-language") === "en" ? "en" : "ru";
let authMode = "login";
let currentUser = null;
let currentConversation = null;
let channels = [];
let directs = [];
let messages = [];
let olderMessagesCursor = null;
let loadingOlderMessages = false;
let stream = null;
let toastTimer;
let searchTimer;
let chatSearchTimer;
let pushKey;
let privacyVersion;
let viewingHeartbeatTimer = null;
const viewingClientId = (() => {
  try {
    let clientId = sessionStorage.getItem("polus-viewing-client");
    if (!clientId) {
      clientId = crypto.randomUUID();
      sessionStorage.setItem("polus-viewing-client", clientId);
    }
    return clientId;
  } catch {
    return crypto.randomUUID();
  }
})();

function t(key) {
  return translations[language][key] || translations.en[key] || key;
}

function applyTranslations() {
  document.documentElement.lang = language;
  document.title = language === "ru" ? "Полюс — мессенджер" : "Polus — Messenger";
  for (const element of document.querySelectorAll("[data-i18n]")) {
    const key = element.dataset.i18n;
    if (translations[language][key]) element.textContent = t(key);
  }
  for (const element of document.querySelectorAll("[data-i18n-placeholder]")) {
    element.placeholder = t(element.dataset.i18nPlaceholder);
  }
  authLanguage.value = language;
  appLanguage.value = language;
  messageInput.placeholder = t("messagePlaceholder");
  document.querySelector("#user-search").placeholder = t("searchPlaceholder");
  document.querySelector("#mobile-menu").setAttribute("aria-label", t("backLabel"));
  sidebarMenuButton.setAttribute("aria-label", t("sidebarMenu"));
  document.querySelector("#new-message").setAttribute("aria-label", t("newMessage"));
  document.querySelector("#new-message").title = t("newMessage");
  document.querySelector("#mobile-backdrop").setAttribute("aria-label", language === "ru" ? "Закрыть меню" : "Close menu");
  manageChatButton.setAttribute("aria-label", t("manageChat"));
  manageChatButton.title = t("manageChat");
  chatInfoButton.setAttribute("aria-label", t("chatInfo"));
  chatInfoButton.title = t("chatInfo");
  chatSearchButton.setAttribute("aria-label", t("searchChat"));
  chatSearchButton.title = t("searchChat");
  document.querySelector("#attach-files").setAttribute("aria-label", t("attachFiles"));
  document.querySelector("#attach-files").title = t("attachFiles");
  sendButton.setAttribute("aria-label", t("send"));
  sendButton.title = t("send");
  cancelUploadButton.textContent = t("cancelUpload");
  setPushEnabled(!notificationIndicator.hidden);
  renderConversations();
  renderMessages();
}

function setLanguage(value) {
  language = value === "en" ? "en" : "ru";
  localStorage.setItem("polus-language", language);
  applyTranslations();
  setAuthMode(authMode);
}

function showError(element, message) {
  element.textContent = localizeError(message);
  element.hidden = false;
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
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3200);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  let result = {};
  try {
    result = await response.json();
  } catch {
    result = {};
  }
  if (!response.ok) {
    const error = new Error(result.error?.message || result.error || t("errGeneric"));
    error.status = response.status;
    throw error;
  }
  return result;
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

function avatarTone(id) {
  let hash = 0;
  for (const character of String(id)) hash = (hash * 31 + character.codePointAt(0)) % 7;
  return hash;
}

function formatListTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((startOfToday - startOfDate) / 86400000);
  const locale = language === "ru" ? "ru-RU" : "en-US";
  if (diffDays <= 0) return formatTime(value);
  if (diffDays < 7) return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(date);
  return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "2-digit" }).format(date);
}

function conversationPreview(conversation) {
  const last = conversation.lastMessage;
  if (!last) return conversation.description || t("noMessagesYet");
  if (last.deleted) return t("deletedMessage");
  let body = "";
  if (last.text) {
    body = last.text.replace(/\s+/g, " ");
  } else if (last.attachments?.length) {
    body = last.attachments.every((item) => /^image\//.test(item.mimeType))
      ? `🖼 ${t("photoLabel")}`
      : `📎 ${last.attachments.length === 1 ? last.attachments[0].name : t("fileLabel")}`;
  }
  let prefix = "";
  if (last.authorId === currentUser?.id) {
    prefix = `${t("you")}: `;
  } else if (conversation.type === "group") {
    const authorName = (last.author?.fullName || last.author?.username || "").split(" ")[0];
    if (authorName) prefix = `${authorName}: `;
  }
  return prefix + body;
}

function createChatAvatar(conversation) {
  const avatar = document.createElement("span");
  avatar.className = `chat-avatar avatar-tone-${avatarTone(conversation.id)}`;
  avatar.setAttribute("aria-hidden", "true");
  if (conversation.avatarUrl) {
    const image = document.createElement("img");
    image.src = conversation.avatarUrl;
    image.alt = "";
    image.loading = "lazy";
    avatar.append(image);
  } else {
    avatar.textContent = initials(getTranslatedConversationName(conversation));
  }
  return avatar;
}

function createChatRow(conversation, { discover = false } = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "chat-row";
  button.dataset.conversationId = conversation.id;
  if (conversation.id === currentConversation?.id) button.setAttribute("aria-current", "page");

  const body = document.createElement("span");
  body.className = "chat-row-body";
  const top = document.createElement("span");
  top.className = "chat-row-top";
  const name = document.createElement("span");
  name.className = "chat-row-name";
  name.textContent = getTranslatedConversationName(conversation);
  top.append(name);
  const lastTime = conversation.lastMessage?.sentAt;
  if (lastTime && !discover) {
    const time = document.createElement("span");
    time.className = "chat-row-time";
    time.textContent = formatListTime(lastTime);
    top.append(time);
  }
  const bottom = document.createElement("span");
  bottom.className = "chat-row-bottom";
  const preview = document.createElement("span");
  preview.className = "chat-row-preview";
  preview.textContent = discover
    ? conversation.description || `${conversation.memberIds?.length || 0}`
    : conversationPreview(conversation);
  bottom.append(preview);
  if (conversation.unreadCount > 0 && !discover) {
    const badge = document.createElement("span");
    badge.className = conversation.muted ? "unread-badge is-muted" : "unread-badge";
    badge.textContent = conversation.unreadCount > 99 ? "99+" : String(conversation.unreadCount);
    bottom.append(badge);
  }
  if (discover) {
    const join = document.createElement("span");
    join.className = "join-channel";
    join.textContent = t("join");
    bottom.append(join);
  }
  body.append(top, bottom);
  button.append(createChatAvatar(conversation), body);
  button.addEventListener("click", () => {
    sidebarSearchInput.value = "";
    void openConversation(conversation);
  });
  return button;
}

function getTranslatedConversationName(conversation) {
  return conversation.name;
}

function renderConversations() {
  const query = sidebarSearchInput.value.trim().toLocaleLowerCase();
  const activity = (conversation) => Date.parse(conversation.lastMessage?.sentAt || conversation.createdAt || 0) || 0;
  const matches = (conversation) => !query
    || `${getTranslatedConversationName(conversation)} ${conversation.username || ""}`.toLocaleLowerCase().includes(query);
  const mine = [...channels.filter((item) => item.joined), ...directs]
    .sort((left, right) => activity(right) - activity(left))
    .filter(matches);
  const open = channels.filter((item) => !item.joined).filter(matches);

  chatList.replaceChildren(...mine.map((conversation) => createChatRow(conversation)));
  discoverList.replaceChildren(...open.map((conversation) => createChatRow(conversation, { discover: true })));
  openChannelsSection.hidden = open.length === 0;

  searchPeopleRow.hidden = !query;
  if (query) {
    searchPeopleRow.replaceChildren();
    const avatar = document.createElement("span");
    avatar.className = "chat-avatar avatar-tone-5";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = "⌕";
    const label = document.createElement("span");
    label.className = "chat-row-body";
    const title = document.createElement("span");
    title.className = "chat-row-name";
    title.textContent = `${t("findPeopleFor")} ${sidebarSearchInput.value.trim()}`;
    label.append(title);
    searchPeopleRow.append(avatar, label);
  }

  const nothing = !query && mine.length === 0 && open.length === 0;
  chatListEmpty.hidden = !nothing;
  if (nothing) chatListEmpty.textContent = t("noChats");
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function emptyMessageState() {
  const wrapper = document.createElement("div");
  wrapper.className = "empty-state";
  const icon = document.createElement("span");
  icon.className = "empty-state-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = currentConversation?.type === "channel" ? "#" : "✳";
  const title = document.createElement("strong");
  title.textContent = t("emptyTitle");
  const description = document.createElement("span");
  description.textContent = currentConversation?.type === "channel"
    ? t("emptyChannel")
    : currentConversation?.type === "group" ? t("emptyGroup") : t("emptyDirect");
  wrapper.append(icon, title, description);
  messageList.append(wrapper);
}

function renderMessages({
  preserveScroll = false,
  keepScrollTop = false,
  previousHeight = 0,
  previousTop = 0
} = {}) {
  closeMessageContextMenu();
  messageList.replaceChildren();
  if (!currentConversation || messages.length === 0) {
    if (currentConversation) emptyMessageState();
    return;
  }

  if (olderMessagesCursor !== null) {
    const olderButton = document.createElement("button");
    olderButton.type = "button";
    olderButton.className = "load-older-messages";
    olderButton.textContent = t("loadOlderMessages");
    olderButton.disabled = loadingOlderMessages;
    olderButton.addEventListener("click", () => void loadOlderMessages());
    messageList.append(olderButton);
  }

  let previousDay = "";
  let previousAuthorId = "";
  for (const message of messages) {
    const day = messageDayKey(message);
    if (day !== previousDay) {
      const separator = document.createElement("div");
      separator.className = "day-separator";
      const label = document.createElement("span");
      label.textContent = formatDay(message.createdAt || message.sentAt);
      separator.append(label);
      messageList.append(separator);
      previousDay = day;
      previousAuthorId = "";
    }
    const row = document.createElement("article");
    const ownMessage = message.authorId === currentUser.id || message.author.id === currentUser.id;
    const grouped = message.author.id === previousAuthorId;
    row.className = `message-row${ownMessage ? " is-own" : ""}${grouped ? " is-grouped" : ""}${message.deleted ? " is-deleted" : ""}`;
    row.dataset.messageId = message.id;
    row.addEventListener("contextmenu", (event) => {
      if (message.deleted) return;
      const canModerate = ["channel", "group"].includes(currentConversation.type)
        && ["owner", "admin"].includes(currentConversation.role);
      const canEdit = ownMessage && !message.deleted
        && Date.now() - Date.parse(message.createdAt || message.sentAt) <= 48 * 60 * 60 * 1000;
      const canDelete = ownMessage || canModerate;
      if (!canEdit && !canDelete) return;
      event.preventDefault();
      openMessageContextMenu(event.clientX, event.clientY, message, { canEdit, canDelete });
    });
    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.textContent = initials(message.author.fullName);
    if (message.author.avatarUrl) {
      const avatarImage = document.createElement("img");
      avatarImage.src = message.author.avatarUrl;
      avatarImage.alt = "";
      avatarImage.addEventListener("error", () => avatarImage.remove(), { once: true });
      avatar.replaceChildren(avatarImage);
    }
    avatar.setAttribute("role", "button");
    avatar.tabIndex = 0;
    avatar.setAttribute("aria-label", message.author.fullName);
    avatar.addEventListener("click", () => void openUserProfile(message.author.username));
    avatar.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        void openUserProfile(message.author.username);
      }
    });
    if (ownMessage || grouped) avatar.classList.add("is-hidden");
    const content = document.createElement("div");
    content.className = "message-content";
    const meta = document.createElement("div");
    meta.className = "message-meta";
    if (!ownMessage && !grouped && currentConversation.type !== "direct") {
      const name = document.createElement("button");
      name.className = "message-name profile-inline-button";
      name.type = "button";
      name.textContent = message.author.fullName;
      name.addEventListener("click", () => void openUserProfile(message.author.username));
      const handle = document.createElement("button");
      handle.className = "message-handle profile-inline-button";
      handle.type = "button";
      handle.textContent = `@${message.author.username}`;
      handle.addEventListener("click", () => void openUserProfile(message.author.username));
      meta.append(name, handle);
    }
    const time = document.createElement("time");
    time.className = "message-time";
    time.dateTime = message.createdAt || message.sentAt;
    time.textContent = formatTime(message.createdAt || message.sentAt);
    meta.append(time);

    const text = document.createElement("p");
    text.className = "message-text";
    if (message.deleted) text.textContent = t("deletedMessage");
    else renderMessageText(text, message.text);
    if (!message.deleted && message.editedAt) {
      const edited = document.createElement("span");
      edited.className = "message-edited";
      edited.textContent = `(${t("edited")})`;
      text.append(edited);
    }
    content.append(meta, text);
    if (!message.deleted && message.attachments?.length) {
      const attachments = document.createElement("div");
      attachments.className = "message-attachments";
      for (const attachment of message.attachments) attachments.append(renderAttachment(attachment));
      content.append(attachments);
    }

    row.append(avatar, content);
    messageList.append(row);
    previousAuthorId = message.author.id;
  }
  if (keepScrollTop) {
    messageList.scrollTop = previousTop;
  } else if (preserveScroll) {
    messageList.scrollTop = previousTop + messageList.scrollHeight - previousHeight;
  } else {
    messageList.scrollTop = messageList.scrollHeight;
  }
}

function closeMessageContextMenu() {
  messageContextMenu.hidden = true;
  messageContextMenu.replaceChildren();
}

function openMessageContextMenu(x, y, message, permissions) {
  messageContextMenu.replaceChildren();
  const actions = [];
  if (permissions.canEdit) actions.push([t("edit"), () => editMessage(message)]);
  if (permissions.canDelete) actions.push([t("remove"), () => deleteMessage(message)]);
  for (const [label, action] of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.textContent = label;
    button.addEventListener("click", () => {
      closeMessageContextMenu();
      void action();
    });
    messageContextMenu.append(button);
  }
  messageContextMenu.hidden = false;
  const bounds = messageContextMenu.getBoundingClientRect();
  messageContextMenu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8))}px`;
  messageContextMenu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8))}px`;
  messageContextMenu.querySelector("button")?.focus();
}

function renderMessageText(element, value) {
  const pattern = /https?:\/\/[^\s<>"']+/giu;
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const raw = match[0];
    const href = raw.replace(/[),.!?;:]+$/g, "");
    const trailing = raw.slice(href.length);
    if (match.index > cursor) element.append(document.createTextNode(value.slice(cursor, match.index)));
    try {
      const url = new URL(href);
      if (url.protocol === "http:" || url.protocol === "https:") {
        const anchor = document.createElement("a");
        anchor.href = url.href;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        anchor.textContent = href;
        element.append(anchor, document.createTextNode(trailing));
      } else {
        element.append(document.createTextNode(raw));
      }
    } catch {
      element.append(document.createTextNode(raw));
    }
    cursor = match.index + raw.length;
  }
  if (cursor < value.length) element.append(document.createTextNode(value.slice(cursor)));
}

function renderAttachment(attachment) {
  const wrapper = document.createElement("div");
  wrapper.className = "message-attachment";
  const url = `/api/attachments/${encodeURIComponent(attachment.id)}`;
  if (/^image\//.test(attachment.mimeType)) {
    const image = document.createElement("img");
    image.className = "message-attachment-image";
    image.src = attachment.thumbnailUrl || url;
    image.alt = attachment.name;
    image.loading = "lazy";
    image.addEventListener("click", () => void openMediaViewer(attachment.id));
    wrapper.append(image);
  } else if (/^(audio|video)\//.test(attachment.mimeType)) {
    const player = document.createElement(attachment.mimeType.startsWith("audio/") ? "audio" : "video");
    player.controls = true;
    player.preload = "metadata";
    player.src = url;
    wrapper.append(player);
  }
  const card = document.createElement("a");
  card.className = "file-card";
  card.href = `${url}?download=1`;
  card.download = attachment.name;
  const icon = document.createElement("span");
  icon.className = "file-card-icon";
  icon.textContent = attachment.mimeType.startsWith("image/") ? "▧" : "↧";
  const details = document.createElement("span");
  details.className = "file-card-details";
  const name = document.createElement("strong");
  name.textContent = attachment.name;
  const size = document.createElement("small");
  size.textContent = formatFileSize(attachment.size);
  details.append(name, size);
  const download = document.createElement("span");
  download.className = "file-card-download";
  download.textContent = t("download");
  card.append(icon, details, download);
  wrapper.append(card);
  return wrapper;
}

async function openMediaViewer(attachmentId) {
  const mediaResponse = await api(`/api/chats/${encodeURIComponent(currentConversation.id)}/materials?kind=media`);
  mediaViewerItems = mediaResponse.items;
  mediaViewerIndex = Math.max(0, mediaViewerItems.findIndex((item) => item.id === attachmentId));
  if (mediaViewerIndex < 0) return;
  updateMediaViewer();
  document.querySelector("#media-viewer").showModal();
}

function updateMediaViewer() {
  const image = document.querySelector("#media-viewer-image");
  const attachment = mediaViewerItems[mediaViewerIndex];
  image.src = `/api/attachments/${encodeURIComponent(attachment.id)}`;
  image.alt = attachment.name;
}

function navigateMediaViewer(direction) {
  if (!mediaViewerItems.length) return;
  mediaViewerIndex = (mediaViewerIndex + direction + mediaViewerItems.length) % mediaViewerItems.length;
  updateMediaViewer();
}

function renderPendingAttachments() {
  attachmentPreview.replaceChildren();
  for (const [index, item] of pendingAttachments.entries()) {
    const row = document.createElement("div");
    row.className = "pending-attachment";
    if (item.previewUrl) {
      const image = document.createElement("img");
      image.src = item.previewUrl;
      image.alt = "";
      row.append(image);
    }
    const name = document.createElement("span");
    name.textContent = item.file.name;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "text-button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", t("remove"));
    remove.addEventListener("click", () => void removePendingAttachment(index));
    row.append(name, remove);
    attachmentPreview.append(row);
  }
  attachmentPreview.hidden = pendingAttachments.length === 0;
}

async function removePendingAttachment(index) {
  const [item] = pendingAttachments.splice(index, 1);
  if (!item) return;
  if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  if (item.uploaded) {
    try {
      await api(`/api/attachments/${encodeURIComponent(item.uploaded.id)}`, { method: "DELETE" });
    } catch (error) {
      notify(localizeError(error.message));
    }
  }
  renderPendingAttachments();
}

function uploadFile(file, signal, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `/api/chats/${encodeURIComponent(currentConversation.id)}/attachments`);
    request.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    request.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100));
    });
    request.addEventListener("load", () => {
      let payload;
      try {
        payload = JSON.parse(request.responseText);
      } catch {
        reject(new Error(t("uploadFailed")));
        return;
      }
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(payload.error?.message || t("uploadFailed")));
        return;
      }
      resolve(payload);
    });
    request.addEventListener("error", () => reject(new Error(t("uploadFailed"))));
    request.addEventListener("abort", () => reject(new DOMException("Upload cancelled.", "AbortError")));
    signal.addEventListener("abort", () => request.abort(), { once: true });
    request.send(file);
  });
}

function uploadThumbnail(attachment, blob, signal, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST",
      `/api/chats/${encodeURIComponent(currentConversation.id)}/attachments/${encodeURIComponent(attachment.id)}/thumbnail`);
    request.setRequestHeader("Content-Type", blob.type || "image/webp");
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100));
    });
    request.addEventListener("load", () => {
      let payload;
      try {
        payload = JSON.parse(request.responseText);
      } catch {
        reject(new Error(t("uploadFailed")));
        return;
      }
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(payload.error?.message || t("uploadFailed")));
        return;
      }
      resolve(payload);
    });
    request.addEventListener("error", () => reject(new Error(t("uploadFailed"))));
    request.addEventListener("abort", () => reject(new DOMException("Upload cancelled.", "AbortError")));
    signal.addEventListener("abort", () => request.abort(), { once: true });
    request.send(blob);
  });
}

async function createImageThumbnail(file) {
  if (!file.type.startsWith("image/") || typeof createImageBitmap !== "function") return null;
  const image = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 480 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error(t("thumbnailFailed"));
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error(t("thumbnailFailed"))), "image/webp", 0.78);
    });
  } finally {
    image.close();
  }
}

async function uploadSelectedFiles(files) {
  if (!currentConversation || !canSendToCurrentConversation()) return;
  const selected = [...files];
  if (pendingAttachments.length + selected.length > 10) {
    notify(t("maxAttachments"));
    return;
  }
  for (const file of selected) {
    if (file.size > 100 * 1024 * 1024) {
      notify(`${file.name}: ${t("maxFileSize")}`);
      return;
    }
  }
  for (const file of selected) {
    const item = {
      file,
      uploaded: null,
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null
    };
    pendingAttachments.push(item);
  }
  renderPendingAttachments();
  attachmentInput.value = "";
  const controller = new AbortController();
  currentUpload = controller;
  cancelUploadButton.hidden = false;
  uploadProgress.hidden = false;
  try {
    for (const item of pendingAttachments.filter((candidate) => selected.includes(candidate.file))) {
      uploadProgress.textContent = `0% · ${item.file.name}`;
      item.uploaded = await uploadFile(item.file, controller.signal, (percent) => {
        uploadProgress.textContent = `${percent}% · ${item.file.name}`;
      });
      if (item.file.type.startsWith("image/")) {
        try {
          const thumbnail = await createImageThumbnail(item.file);
          if (thumbnail) {
            uploadProgress.textContent = `${t("preview")} · ${item.file.name}`;
            const result = await uploadThumbnail(item.uploaded, thumbnail, controller.signal, (percent) => {
              uploadProgress.textContent = `${t("preview")} ${percent}% · ${item.file.name}`;
            });
            item.uploaded.thumbnailUrl = result.thumbnailUrl;
          }
        } catch (error) {
          if (error.name === "AbortError") throw error;
          notify(`${item.file.name}: ${t("thumbnailFailed")}`);
        }
      }
    }
  } catch (error) {
    if (error.name !== "AbortError") notify(localizeError(error.message));
  } finally {
    currentUpload = null;
    cancelUploadButton.hidden = true;
    uploadProgress.hidden = true;
    uploadProgress.textContent = "";
    if (controller.signal.aborted) await clearPendingAttachments();
    renderPendingAttachments();
  }
}

async function clearPendingAttachments() {
  const items = [...pendingAttachments];
  pendingAttachments = [];
  renderPendingAttachments();
  for (const item of items) {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    if (!item.uploaded) continue;
    try {
      await api(`/api/attachments/${encodeURIComponent(item.uploaded.id)}`, { method: "DELETE" });
    } catch (error) {
      notify(localizeError(error.message));
    }
  }
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
  conversationTitle.textContent = getTranslatedConversationName(conversation);
  const isManageable = ["channel", "group"].includes(conversation.type)
    && !conversation.pending && !["general", "introductions", "off-topic"].includes(conversation.id);
  manageChatButton.hidden = !isManageable;
  const isChat = !conversation.pending;
  chatInfoButton.hidden = !isChat;
  chatSearchButton.hidden = !isChat || conversation.joined === false;
  const canPost = conversation.type !== "channel"
    || ["owner", "admin"].includes(conversation.role);
  composer.hidden = !canPost;
  messageInput.disabled = !canPost;
  sendButton.disabled = !canPost;
  const isDirect = conversation.type !== "channel";
  conversationIcon.classList.toggle("is-direct", isDirect);
  conversationIcon.textContent = conversation.type === "channel" ? "#" : initials(conversation.name);
  conversationSubtitle.textContent = conversation.type === "channel"
    ? conversation.description || `${conversation.memberIds?.length || 0} ${t("members")}`
    : conversation.type === "group" ? `${conversation.memberIds?.length || 0} ${t("groupParticipants")}` : `@${conversation.username || ""}`;
}

function canSendToCurrentConversation() {
  return Boolean(currentConversation) && (currentConversation.type !== "channel"
    || ["owner", "admin"].includes(currentConversation.role));
}

function addButton(container, label, action, className = "text-button") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", () => void action().catch((error) => notify(localizeError(error.message))));
  container.append(button);
  return button;
}

async function openChatInfo(tab = currentInfoTab) {
  if (!currentConversation || currentConversation.pending) return;
  currentInfoTab = tab;
  chatInfoTitle.textContent = currentConversation.name;
  chatInfoTabs.replaceChildren();
  chatInfoContent.replaceChildren();
  const tabs = [
    ...(currentConversation.joined
      && (currentConversation.type === "group" || currentConversation.type === "channel")
      ? ["members"] : []),
    "media",
    ...(currentConversation.joined ? ["files"] : []),
    "links"
  ];
  const selectedTab = tabs.includes(tab) ? tab : tabs[0];
  const chatId = currentConversation.id;
  const tabResponses = {};
  try {
    await Promise.all(tabs.map(async (tabName) => {
      const tabQuery = new URLSearchParams({ kind: tabName });
      tabResponses[tabName] = validateMaterialsResponse(
        await api(`/api/chats/${encodeURIComponent(chatId)}/materials?${tabQuery}`)
      );
    }));
  } catch (error) {
    notify(localizeError(error.message));
    return;
  }
  for (const tabName of tabs) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `chat-info-tab${tabName === selectedTab ? " is-active" : ""}`;
    button.textContent = `${t(`tab${tabName[0].toUpperCase()}${tabName.slice(1)}`)} (${tabResponses[tabName].total})`;
    button.addEventListener("click", () => void openChatInfo(tabName));
    chatInfoTabs.append(button);
  }
  const canView = currentConversation.joined;
  const response = tabResponses[selectedTab];
  const heading = document.createElement("div");
  heading.className = "chat-info-count";
  heading.textContent = `${t(`tab${selectedTab[0].toUpperCase()}${selectedTab.slice(1)}`)} (${response.total})`;
  chatInfoContent.append(heading);

  if (selectedTab === "media") {
    const grid = document.createElement("div");
    grid.className = "media-grid";
    for (const attachment of response.items) {
      const tile = document.createElement("div");
      tile.className = "media-tile";
      if (attachment.mimeType.startsWith("image/")) {
        const image = document.createElement("img");
        const originalUrl = `/api/attachments/${encodeURIComponent(attachment.id)}`;
        image.src = attachment.thumbnailUrl || originalUrl;
        image.alt = attachment.name;
        image.loading = "lazy";
        image.addEventListener("click", () => {
          if (canView) void openMediaViewer(attachment.id);
          else window.open(originalUrl, "_blank", "noopener,noreferrer");
        });
        image.title = attachment.name;
        tile.append(image);
      } else {
        const video = document.createElement("video");
        video.src = `/api/attachments/${encodeURIComponent(attachment.id)}`;
        video.controls = true;
        video.preload = "metadata";
        tile.append(video);
      }
      if (attachment.messageId && canView) {
        addButton(tile, t("openMessage"), async () => {
          chatInfoDialog.close();
          await jumpToMessage(attachment.messageId);
        });
      }
      grid.append(tile);
    }
    chatInfoContent.append(grid);
  } else {
    const list = document.createElement("div");
    list.className = selectedTab === "members" ? "info-member-list" : "info-item-list";
    for (const item of response.items) {
      const row = document.createElement("article");
      row.className = "info-item";
      if (selectedTab === "members") {
        row.classList.add("info-member");
        const avatar = document.createElement("span");
        avatar.className = "info-member-avatar";
        avatar.setAttribute("aria-hidden", "true");
        if (item.avatarUrl) {
          const image = document.createElement("img");
          image.src = item.avatarUrl;
          image.alt = "";
          image.loading = "lazy";
          image.addEventListener("error", () => {
            avatar.textContent = initials(item.fullName);
          }, { once: true });
          avatar.append(image);
        } else {
          avatar.textContent = initials(item.fullName);
        }

        const identity = document.createElement("div");
        identity.className = "info-member-identity";
        const name = document.createElement("button");
        name.type = "button";
        name.className = "profile-inline-button info-member-name";
        name.textContent = item.fullName;
        name.addEventListener("click", () => void openUserProfile(item.username));
        const handle = document.createElement("span");
        handle.className = "info-member-handle";
        handle.textContent = `@${item.username}`;
        identity.append(name, handle);

        const meta = document.createElement("div");
        meta.className = "info-member-meta";
        const role = document.createElement("span");
        role.className = `info-member-role is-${item.role}`;
        role.textContent = t(`role${item.role[0].toUpperCase()}${item.role.slice(1)}`);
        meta.append(role);
        const presence = presenceLabel(item);
        if (presence) {
          const status = document.createElement("span");
          status.className = `info-member-presence${item.online ? " is-online" : ""}`;
          status.textContent = presence;
          meta.append(status);
        }
        row.append(avatar, identity, meta);
      } else {
        const title = document.createElement(selectedTab === "links" ? "a" : "strong");
        if (selectedTab === "links") {
          title.href = item.url;
          title.target = "_blank";
          title.rel = "noopener noreferrer";
        }
        title.textContent = selectedTab === "links" ? item.title || item.domain : item.name;
        const detail = document.createElement("small");
        detail.textContent = selectedTab === "links"
          ? `${item.domain} · @${item.author?.username || ""} · ${item.createdAt ? formatDay(item.createdAt) : ""}`
          : `${formatFileSize(item.size)} · @${item.author?.username || ""} · ${item.createdAt ? formatDay(item.createdAt) : ""}`;
        row.append(title, detail);
        if (item.messageId) {
          addButton(row, t("openMessage"), async () => {
            chatInfoDialog.close();
            await jumpToMessage(item.messageId);
          });
        }
        if (selectedTab === "files") {
          const download = document.createElement("a");
          download.className = "text-button";
          download.href = `/api/attachments/${encodeURIComponent(item.id)}?download=1`;
          download.download = item.name;
          download.textContent = t("download");
          row.append(download);
        }
      }
      list.append(row);
    }
    chatInfoContent.append(list);
  }
  if (response.items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "no-results";
    empty.textContent = t("noResults");
    chatInfoContent.append(empty);
  }
  if (response.hasMore && response.nextCursor) {
    const loadMore = document.createElement("button");
    loadMore.type = "button";
    loadMore.className = "load-older-messages";
    loadMore.textContent = t("loadOlderMessages");
    loadMore.addEventListener("click", () => void loadMoreChatInfo(selectedTab, response.nextCursor));
    chatInfoContent.append(loadMore);
  }
  if (currentConversation.joined && !currentConversation.muted) {
    const mute = document.createElement("button");
    mute.type = "button";
    mute.className = "text-button chat-info-mute";
    mute.textContent = t("muteChat");
    mute.addEventListener("click", () => void toggleChatMute(true));
    chatInfoContent.append(mute);
  } else if (currentConversation.joined) {
    const unmute = document.createElement("button");
    unmute.type = "button";
    unmute.className = "text-button chat-info-mute";
    unmute.textContent = t("unmuteChat");
    unmute.addEventListener("click", () => void toggleChatMute(false));
    chatInfoContent.append(unmute);
  }
  if (!chatInfoDialog.open) chatInfoDialog.showModal();
}

async function loadMoreChatInfo(kind, cursor) {
  let response;
  try {
    const query = new URLSearchParams({ kind, before: String(cursor) });
    response = validateMaterialsResponse(
      await api(`/api/chats/${encodeURIComponent(currentConversation.id)}/materials?${query}`)
    );
  } catch (error) {
    notify(localizeError(error.message));
    return;
  }
  const list = chatInfoContent.querySelector(kind === "media"
    ? ".media-grid"
    : kind === "members" ? ".info-member-list" : ".info-item-list");
  for (const item of response.items) {
    if (kind === "media") {
      const tile = document.createElement("div");
      tile.className = "media-tile";
      if (item.mimeType.startsWith("image/")) {
        const image = document.createElement("img");
        image.src = item.thumbnailUrl || `/api/attachments/${encodeURIComponent(item.id)}`;
        image.alt = item.name;
        image.loading = "lazy";
        image.addEventListener("click", () => void openMediaViewer(item.id));
        tile.append(image);
      } else {
        const video = document.createElement("video");
        video.src = `/api/attachments/${encodeURIComponent(item.id)}`;
        video.controls = true;
        video.preload = "metadata";
        tile.append(video);
      }
      if (item.messageId) {
        addButton(tile, t("openMessage"), async () => {
          chatInfoDialog.close();
          await jumpToMessage(item.messageId);
        });
      }
      list?.append(tile);
      continue;
    }
    const row = document.createElement("article");
    row.className = "info-item";
    if (kind === "members") {
      const title = document.createElement("button");
      title.type = "button";
      title.className = "profile-inline-button";
      title.textContent = item.fullName;
      title.addEventListener("click", () => void openUserProfile(item.username));
      const detail = document.createElement("small");
      const presence = presenceLabel(item);
      detail.textContent = `@${item.username} · ${t(`role${item.role[0].toUpperCase()}${item.role.slice(1)}`)}`
        + (presence ? ` · ${presence}` : "");
      row.append(title, detail);
    } else {
      const title = document.createElement(kind === "links" ? "a" : "strong");
      title.textContent = kind === "links" ? item.title || item.domain : item.name;
      if (kind === "links") {
        title.href = item.url;
        title.target = "_blank";
        title.rel = "noopener noreferrer";
      }
      const detail = document.createElement("small");
      detail.textContent = kind === "links"
        ? `${item.domain} · @${item.author?.username || ""} · ${item.createdAt ? formatDay(item.createdAt) : ""}`
        : `${formatFileSize(item.size)} · @${item.author?.username || ""} · ${item.createdAt ? formatDay(item.createdAt) : ""}`;
      row.append(title, detail);
    }
    if (item.messageId) {
      addButton(row, t("openMessage"), async () => {
        chatInfoDialog.close();
        await jumpToMessage(item.messageId);
      });
    }
    list?.append(row);
  }
  const oldButton = chatInfoContent.querySelector(".load-older-messages");
  oldButton?.remove();
  if (response.hasMore && response.nextCursor) {
    const next = document.createElement("button");
    next.type = "button";
    next.className = "load-older-messages";
    next.textContent = t("loadOlderMessages");
    next.addEventListener("click", () => void loadMoreChatInfo(kind, response.nextCursor));
    chatInfoContent.append(next);
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
  while (messages.length && messages[0].id > messageId) {
    const before = messages[0].id;
    const query = new URLSearchParams({ conversationId: currentConversation.id, before: String(before) });
    const history = await api(`/api/messages?${query}`);
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
  const query = queryValue.trim();
  chatSearchResults.replaceChildren();
  if (query.length < 2) {
    const prompt = document.createElement("div");
    prompt.className = "no-results";
    prompt.textContent = t("searchPromptChat");
    chatSearchResults.append(prompt);
    return;
  }
  const search = new URLSearchParams({ q: query });
  const response = await api(`/api/chats/${encodeURIComponent(currentConversation.id)}/search?${search}`);
  if (!response.results.length) {
    const empty = document.createElement("div");
    empty.className = "no-results";
    empty.textContent = t("noResults");
    chatSearchResults.append(empty);
    return;
  }
  for (const message of response.results) {
    const result = document.createElement("button");
    result.type = "button";
    result.className = "user-result";
    const author = document.createElement("strong");
    author.textContent = message.author.fullName;
    const excerpt = document.createElement("span");
    excerpt.textContent = message.text;
    result.append(author, excerpt);
    result.addEventListener("click", () => {
      chatSearchDialog.close();
      void jumpToMessage(message.id);
    });
    chatSearchResults.append(result);
  }
}

async function openUserProfile(username) {
  if (username.toLowerCase() === currentUser.username.toLowerCase()) {
    prepareOwnProfile();
    profileDialog.showModal();
    return;
  }
  const response = await api(`/api/users/${encodeURIComponent(username)}/profile`);
  const { user: target, sharedChats, sharedMedia, canMessage } = response;
  profileViewTitle.textContent = t("profile");
  profileViewContent.replaceChildren();
  const card = document.createElement("section");
  card.className = "user-profile-hero";
  const avatar = document.createElement("div");
  avatar.className = "user-profile-avatar";
  if (target.avatarUrl) {
    const image = document.createElement("img");
    image.src = target.avatarUrl;
    image.alt = "";
    avatar.append(image);
  } else {
    avatar.textContent = initials(target.fullName);
  }
  const identity = document.createElement("div");
  identity.className = "user-profile-identity";
  const fullName = document.createElement("h3");
  fullName.textContent = target.fullName;
  const handle = document.createElement("span");
  handle.className = "user-profile-handle";
  handle.textContent = `@${target.username}`;
  const status = document.createElement("span");
  const presence = presenceLabel(target);
  status.className = `user-profile-status${target.online ? " is-online" : ""}`;
  status.textContent = presence;
  status.hidden = !presence;
  identity.append(fullName, handle, status);
  card.append(avatar, identity);
  profileViewContent.append(card);

  const actions = document.createElement("div");
  actions.className = "profile-actions";
  if (canMessage) {
    addButton(actions, t("writeToUser"), async () => {
      profileViewDialog.close();
      await startDirectMessage(target.username);
    }, "primary-button");
  }
  addButton(actions, target.blocked ? t("unblockUser") : t("blockUser"), async () => {
    await api(`/api/users/${encodeURIComponent(target.username)}/block`, {
      method: target.blocked ? "DELETE" : "POST"
    });
    await openUserProfile(target.username);
  }, "danger-button");
  profileViewContent.append(actions);

  const aboutSection = document.createElement("section");
  aboutSection.className = "profile-detail-section";
  const aboutHeading = document.createElement("h3");
  aboutHeading.textContent = t("aboutOptional");
  const about = document.createElement("p");
  about.className = "profile-about-copy";
  about.textContent = target.about || t("noAbout");
  aboutSection.append(aboutHeading, about);
  profileViewContent.append(aboutSection);

  if (target.createdAt) {
    const registered = document.createElement("div");
    registered.className = "profile-registered";
    registered.textContent = `${t("registered")}: ${formatDay(target.createdAt)}`;
    profileViewContent.append(registered);
  }

  const groupsHeading = document.createElement("h3");
  groupsHeading.className = "profile-section-heading";
  groupsHeading.textContent = t("sharedChats");
  profileViewContent.append(groupsHeading);
  const sharedChatList = document.createElement("div");
  sharedChatList.className = "profile-shared-chats";
  for (const chat of sharedChats) {
    const item = document.createElement("div");
    item.className = "profile-shared-chat";
    const icon = document.createElement("span");
    icon.className = "profile-shared-chat-icon";
    icon.textContent = chat.type === "channel" ? "#" : initials(chat.name);
    const name = document.createElement("span");
    name.textContent = chat.name;
    item.replaceChildren(icon, name);
    sharedChatList.append(item);
  }
  if (sharedChats.length === 0) {
    const empty = document.createElement("p");
    empty.className = "profile-section-empty";
    empty.textContent = t("noSharedChats");
    sharedChatList.append(empty);
  }
  profileViewContent.append(sharedChatList);

  const mediaHeading = document.createElement("h3");
  mediaHeading.className = "profile-section-heading";
  mediaHeading.textContent = t("sharedMedia");
  profileViewContent.append(mediaHeading);
  const media = document.createElement("div");
  media.className = "media-grid profile-media-grid";
  for (const attachment of sharedMedia) {
    const image = document.createElement("img");
    image.src = attachment.thumbnailUrl || `/api/attachments/${encodeURIComponent(attachment.id)}`;
    image.alt = attachment.name;
    media.append(image);
  }
  profileViewContent.append(media);
  if (sharedMedia.length === 0) {
    const empty = document.createElement("p");
    empty.className = "profile-section-empty";
    empty.textContent = t("noSharedMedia");
    profileViewContent.append(empty);
  }
  const targetDirect = [currentConversation, ...directs].find((chat) =>
    chat && !chat.pending && chat.type === "direct" && chat.memberIds?.includes(target.id));
  if (targetDirect) {
    addButton(actions, targetDirect.muted ? t("unmuteChat") : t("muteChat"),
      async () => {
        await toggleChatMute(!targetDirect.muted, { conversation: targetDirect, refreshInfo: false });
        await openUserProfile(target.username);
      }, "text-button");
  }
  if (!profileViewDialog.open) profileViewDialog.showModal();
}

async function markConversationRead(conversation) {
  if (conversation.pending || document.visibilityState !== "visible"
    || currentConversation?.id !== conversation.id || !isMessageListAtBottom()) return;
  const latestDisplayedId = messages.at(-1)?.id || 0;
  if (!conversation.unreadCount && latestDisplayedId <= (conversation.lastReadMessageId || 0)) return;
  conversation.unreadCount = 0;
  renderConversations();
  try {
    const result = await api("/api/conversations/read", jsonOptions("POST", { conversationId: conversation.id }));
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
  void reportChatViewingState();
  messages = [];
  olderMessagesCursor = null;
  loadingOlderMessages = false;
  updateConversationHeader(conversation);
  renderConversations();
  renderMessages();
  if (!conversation.pending) {
    try {
      const history = await api(`/api/messages?conversationId=${encodeURIComponent(conversation.id)}`);
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
  renderMessages();
  try {
    const query = new URLSearchParams({
      conversationId: currentConversation.id,
      before: String(olderMessagesCursor)
    });
    const history = await api(`/api/messages?${query}`);
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
    renderMessages({ preserveScroll: true, previousHeight, previousTop });
  }
}

function setUser(user) {
  currentUser = user;
  document.querySelector("#profile-name").textContent = user.fullName;
  document.querySelector("#profile-handle").textContent = `@${user.username}`;
  const avatar = document.querySelector("#profile-avatar");
  avatar.replaceChildren();
  if (user.avatarUrl) {
    const image = document.createElement("img");
    image.src = user.avatarUrl;
    image.alt = "";
    avatar.append(image);
  } else {
    avatar.textContent = initials(user.fullName);
  }
  renderProfileAvatarPreview(user);
}

function renderProfileAvatarPreview(user, src = user.avatarUrl) {
  const preview = document.querySelector("#profile-avatar-preview");
  if (!preview) return;
  preview.replaceChildren();
  if (src) {
    const image = document.createElement("img");
    image.src = src;
    image.alt = "";
    preview.append(image);
  } else {
    preview.textContent = initials(user.fullName);
  }
}

function prepareOwnProfile() {
  document.querySelector("#profile-full-name").value = currentUser.fullName;
  document.querySelector("#profile-about").value = currentUser.about || "";
  document.querySelector("#profile-show-online").checked = currentUser.showOnlineStatus !== false;
  document.querySelector("#profile-hide-notification-content").checked = currentUser.hideNotificationContent === true;
  document.querySelector("#profile-avatar-input").value = "";
  document.querySelector("#profile-avatar-filename").textContent = t("avatarPickerHint");
  if (profilePreviewUrl) URL.revokeObjectURL(profilePreviewUrl);
  profilePreviewUrl = null;
  renderProfileAvatarPreview(currentUser);
}

async function updateProfileAvatarPreview(file) {
  const fileName = document.querySelector("#profile-avatar-filename");
  if (profilePreviewUrl) URL.revokeObjectURL(profilePreviewUrl);
  profilePreviewUrl = null;
  if (!file) {
    fileName.textContent = t("avatarPickerHint");
    renderProfileAvatarPreview(currentUser);
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    document.querySelector("#profile-avatar-input").value = "";
    fileName.textContent = t("avatarPickerHint");
    renderProfileAvatarPreview(currentUser);
    notify(t("profileAvatar"));
    return;
  }
  fileName.textContent = file.name;
  try {
    const cropped = await cropAvatar(file);
    profilePreviewUrl = URL.createObjectURL(cropped);
    renderProfileAvatarPreview(currentUser, profilePreviewUrl);
  } catch (error) {
    fileName.textContent = t("avatarPickerHint");
    renderProfileAvatarPreview(currentUser);
    notify(localizeError(error.message));
  }
}

function setAuthMode(mode) {
  authMode = mode;
  const registering = mode === "register";
  authTitle.textContent = t(registering ? "createAccount" : "signIn");
  authSubtitle.textContent = t(registering ? "registerSubtitle" : "signInSubtitle");
  authSubmit.textContent = t(registering ? "createAccount" : "signInButton");
  authSwitchCopy.textContent = t(registering ? "hasAccount" : "noAccount");
  authSwitch.textContent = t(registering ? "signInButton" : "createAccount");
  registerFields.hidden = !registering;
  registerAboutField.hidden = !registering;
  registerHint.hidden = !registering;
  confirmField.hidden = !registering;
  privacyConsent.hidden = !registering;
  fullNameInput.required = registering;
  confirmPasswordInput.required = registering;
  acceptPrivacyInput.required = registering;
  passwordInput.autocomplete = registering ? "new-password" : "current-password";
  authError.hidden = true;
}

function reportChatViewingState(forceHidden = false) {
  if (!currentUser) return Promise.resolve();
  const visible = !forceHidden && !messengerView.hidden && document.visibilityState === "visible"
    && Boolean(currentConversation && !currentConversation.pending);
  const body = JSON.stringify({
    clientId: viewingClientId,
    conversationId: visible ? currentConversation.id : null,
    visible
  });
  return fetch("/api/presence/chat", {
    method: "POST",
    credentials: "same-origin",
    keepalive: forceHidden,
    headers: { "Content-Type": "application/json" },
    body
  }).then((response) => {
    if (!response.ok && response.status !== 401) {
      throw new Error(`Chat presence update failed (${response.status}).`);
    }
  }).catch((error) => {
    if (!forceHidden) console.error(error);
  });
}

function startChatPresenceTracking() {
  clearInterval(viewingHeartbeatTimer);
  void reportChatViewingState();
  viewingHeartbeatTimer = setInterval(() => void reportChatViewingState(), 15_000);
}

function stopChatPresenceTracking() {
  clearInterval(viewingHeartbeatTimer);
  viewingHeartbeatTimer = null;
  void reportChatViewingState(true);
}

async function handleAuth(event) {
  event.preventDefault();
  authError.hidden = true;
  const registering = authMode === "register";
  const payload = {
    username: usernameInput.value.trim().replace(/^@/, ""),
    password: passwordInput.value
  };
  if (registering) {
    payload.fullName = fullNameInput.value.trim();
    payload.about = document.querySelector("#about").value.trim();
    payload.confirmPassword = confirmPasswordInput.value;
    payload.acceptPrivacy = acceptPrivacyInput.checked;
    payload.privacyVersion = privacyVersion;
  }
  authSubmit.disabled = true;
  try {
    const result = await api(`/api/auth/${registering ? "register" : "login"}`, jsonOptions("POST", payload));
    setUser(result.user);
    authView.hidden = true;
    messengerView.hidden = false;
    await loadMessenger();
    await checkPushSubscription();
    if (registering) notify(t("registerSuccess"));
  } catch (error) {
    showError(authError, error.message);
  } finally {
    authSubmit.disabled = false;
  }
}

async function loadMessenger() {
  const data = await api("/api/bootstrap");
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
  const requestedId = new URLSearchParams(location.search).get("conversation");
  const first = getConversation(requestedId) || channels.find((channel) => channel.joined) || directs[0];
  if (first) await openConversation(first);
  if (!getConversation(requestedId)) messengerView.classList.remove("chat-open");
  connectToEvents();
  startChatPresenceTracking();
}

function connectToEvents() {
  if (stream) stream.close();
  stream = new EventSource("/api/stream");
  stream.addEventListener("message", (event) => void receiveMessage(JSON.parse(event.data)));
  stream.addEventListener("chat-updated", (event) => {
    const update = JSON.parse(event.data);
    void refreshMessengerState().then(() => {
      if (chatManagementDialog.open && currentConversation?.id === update.chatId) {
        return openChatManagement();
      }
      return undefined;
    }).catch((error) => notify(localizeError(error.message)));
  });
  stream.addEventListener("message-updated", (event) => {
    const updated = JSON.parse(event.data);
    messages = messages.map((message) => message.id === updated.id ? updated : message);
    renderMessages();
  });
  stream.addEventListener("message-deleted", (event) => {
    const deleted = JSON.parse(event.data);
    messages = messages.map((message) => message.id === deleted.id ? deleted : message);
    renderMessages();
  });
  stream.addEventListener("error", () => {
    if (stream.readyState === EventSource.CLOSED) {
      notify(t("errGeneric"));
    }
  });
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
  if (currentConversation?.pending
    && (message.author.id === currentUser.id || currentConversation.username === message.author.username)) {
    currentConversation = conversation;
    void reportChatViewingState();
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
    } else if (message.authorId !== currentUser.id) {
      conversation.unreadCount = (conversation.unreadCount || 0) + 1;
      renderConversations();
    }
  } else {
    if (!fetchedConversation) conversation.unreadCount = (conversation.unreadCount || 0) + 1;
    notify(`${t("messageArrived")} @${message.author.username}`);
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
    updateConversationHeader(updatedConversation);
  } else if (currentConversation && !currentConversation.pending) {
    currentConversation = null;
    messengerView.classList.remove("chat-open");
    messages = [];
    manageChatButton.hidden = true;
    chatInfoButton.hidden = true;
    chatSearchButton.hidden = true;
    messageInput.disabled = true;
    sendButton.disabled = true;
    messageList.replaceChildren();
    if (chatManagementDialog.open) chatManagementDialog.close();
    const target = new URL(window.location.href);
    target.searchParams.delete("conversation");
    window.history?.replaceState({}, "", target);
  }
  renderConversations();
  renderMessages();
}

async function submitMessage(event) {
  event.preventDefault();
  const text = messageInput.value.trim();
  if ((!text && pendingAttachments.length === 0) || pendingAttachments.some((item) => !item.uploaded)
    || !canSendToCurrentConversation()) return;
  sendButton.disabled = true;
  try {
    const payload = currentConversation.pending
      ? {
        recipientUsername: currentConversation.username,
        text,
        attachmentIds: pendingAttachments.map((item) => item.uploaded.id)
      }
      : {
        conversationId: currentConversation.id,
        text,
        attachmentIds: pendingAttachments.map((item) => item.uploaded.id)
      };
    const sent = await api("/api/messages", jsonOptions("POST", payload));
    if (currentConversation.pending && sent.conversation) {
      currentConversation = sent.conversation;
      if (!directs.some((item) => item.id === currentConversation.id)) directs.unshift(currentConversation);
      olderMessagesCursor = null;
      updateConversationHeader(currentConversation);
      await markConversationRead(currentConversation);
      const target = new URL(window.location.href);
      target.searchParams.set("conversation", currentConversation.id);
      window.history?.replaceState({}, "", target);
    }
    currentConversation.lastMessage = sent;
    if (!messages.some((item) => item.id === sent.id)) messages.push(sent);
    messages.sort((left, right) => left.id - right.id);
    renderConversations();
    for (const item of pendingAttachments) {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    }
    pendingAttachments = [];
    renderPendingAttachments();
    renderMessages();
    messageInput.value = "";
    messageInput.style.height = "auto";
    messageInput.focus();
  } catch (error) {
    notify(localizeError(error.message));
  } finally {
    sendButton.disabled = !canSendToCurrentConversation();
  }
}

async function editMessage(message) {
  if (Date.now() - Date.parse(message.createdAt || message.sentAt) > 48 * 60 * 60 * 1000) {
    notify(t("messageEditExpired"));
    return;
  }
  const text = window.prompt(t("editPrompt"), message.text);
  if (text === null || !text.trim() || text.trim() === message.text) return;
  try {
    const updated = await api(`/api/messages/${encodeURIComponent(message.id)}`, jsonOptions("PATCH", { text }));
    messages = messages.map((item) => item.id === updated.id ? updated : item);
    renderMessages();
  } catch (error) {
    notify(localizeError(error.message));
  }
}

async function deleteMessage(message) {
  if (!window.confirm(t("deleteConfirm"))) return;
  try {
    const deleted = await api(`/api/messages/${encodeURIComponent(message.id)}`, { method: "DELETE" });
    messages = messages.map((item) => item.id === deleted.id ? deleted : item);
    renderMessages();
  } catch (error) {
    notify(localizeError(error.message));
  }
}

function renderUsers(users) {
  const results = document.querySelector("#user-results");
  results.replaceChildren();
  if (users.length === 0) {
    const message = document.createElement("div");
    message.className = "no-results";
    message.textContent = document.querySelector("#user-search").value.trim().length < 2
      ? t("searchPrompt") : t("noUsers");
    results.append(message);
    return;
  }
  for (const user of users) {
    const button = document.createElement("button");
    button.className = "user-result";
    button.type = "button";
    const avatar = document.createElement("span");
    avatar.className = "result-avatar";
    avatar.textContent = initials(user.fullName);
    const copy = document.createElement("span");
    copy.className = "result-copy";
    const name = document.createElement("strong");
    name.textContent = user.fullName;
    const handle = document.createElement("small");
    handle.textContent = `@${user.username}`;
    copy.append(name, handle);
    button.append(avatar, copy);
    button.addEventListener("click", () => void startDirectMessage(user.username));
    results.append(button);
  }
}

function addManagementButton(container, label, action, className = "text-button") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", () => {
    void action().catch((error) => notify(localizeError(error.message)));
  });
  container.append(button);
  return button;
}

async function openChatManagement() {
  const selectedChat = currentConversation;
  if (!selectedChat || !["channel", "group"].includes(selectedChat.type) || selectedChat.pending) return;
  try {
    const { chat, members: chatMembers } = await api(`/api/chats/${encodeURIComponent(selectedChat.id)}`);
    chatManagementTitle.textContent = chat.name;
    chatManagementContent.replaceChildren();

    const membersHeading = document.createElement("h3");
    membersHeading.className = "management-heading";
    membersHeading.textContent = `${t("chatMembers")} (${chatMembers.length})`;
    const memberList = document.createElement("div");
    memberList.className = "management-members";
    for (const member of chatMembers) {
      const row = document.createElement("div");
      row.className = "management-member";
      const copy = document.createElement("span");
      copy.className = "management-member-copy";
      const name = document.createElement("strong");
      name.textContent = member.fullName;
      const detail = document.createElement("small");
      detail.textContent = `@${member.username} · ${t(`role${member.role[0].toUpperCase()}${member.role.slice(1)}`)}`;
      copy.append(name, detail);
      row.append(copy);
      if (chat.role === "owner" && member.id !== chat.ownerId) {
        addManagementButton(row,
          member.role === "admin" ? t("removeAdmin") : t("makeAdmin"),
          async () => {
            await api(`/api/chats/${encodeURIComponent(chat.id)}/admins/${encodeURIComponent(member.id)}`,
              jsonOptions("PUT", { role: member.role === "admin" ? "member" : "admin" }));
            await refreshMessengerState();
            await openChatManagement();
          });
      }
      if (["owner", "admin"].includes(chat.role)
        && member.id !== currentUser.id && member.role === "member") {
        addManagementButton(row, t("remove"), async () => {
          await api(`/api/chats/${encodeURIComponent(chat.id)}/members/${encodeURIComponent(member.id)}`,
            { method: "DELETE" });
          await refreshMessengerState();
          await openChatManagement();
        });
      }
      memberList.append(row);
    }
    chatManagementContent.append(membersHeading, memberList);

    if (["owner", "admin"].includes(chat.role)) {
      const inviteForm = document.createElement("form");
      inviteForm.className = "management-form";
      const usernameInput = document.createElement("input");
      usernameInput.className = "text-field";
      usernameInput.placeholder = t("usernamePlaceholder");
      usernameInput.maxLength = 33;
      usernameInput.required = true;
      const inviteButton = document.createElement("button");
      inviteButton.className = "primary-button";
      inviteButton.type = "submit";
      inviteButton.textContent = t("inviteMember");
      inviteForm.append(usernameInput, inviteButton);
      inviteForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        try {
          await api(`/api/chats/${encodeURIComponent(chat.id)}/members`,
            jsonOptions("POST", { username: usernameInput.value.trim().replace(/^@/, "") }));
          await refreshMessengerState();
          await openChatManagement();
        } catch (error) {
          notify(localizeError(error.message));
        }
      });
      chatManagementContent.append(inviteForm);
    }

    const actions = document.createElement("div");
    actions.className = "management-actions";
    if (chat.role === "owner") {
      const transferForm = document.createElement("form");
      transferForm.className = "management-form";
      const ownerSelect = document.createElement("select");
      ownerSelect.className = "text-field";
      for (const member of chatMembers.filter((item) => item.id !== chat.ownerId)) {
        const option = document.createElement("option");
        option.value = member.username;
        option.textContent = `${member.fullName} (@${member.username})`;
        ownerSelect.append(option);
      }
      const transferButton = document.createElement("button");
      transferButton.className = "text-button";
      transferButton.type = "submit";
      transferButton.textContent = t("transferOwnership");
      transferButton.disabled = ownerSelect.options.length === 0;
      transferForm.append(ownerSelect, transferButton);
      transferForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!ownerSelect.value) return;
        try {
          await api(`/api/chats/${encodeURIComponent(chat.id)}/owner`,
            jsonOptions("PUT", { username: ownerSelect.value }));
          await refreshMessengerState();
          await openChatManagement();
          notify(t("ownershipTransferred"));
        } catch (error) {
          notify(localizeError(error.message));
        }
      });
      chatManagementContent.append(transferForm);
      addManagementButton(actions, t("deleteChat"), async () => {
        if (!window.confirm(`${t("deleteChat")}?`)) return;
        try {
          await api(`/api/chats/${encodeURIComponent(chat.id)}`, { method: "DELETE" });
          chatManagementDialog.close();
          await refreshMessengerState();
          notify(t("chatDeleted"));
        } catch (error) {
          notify(localizeError(error.message));
        }
      }, "danger-button");
    } else {
      addManagementButton(actions, t("leaveChat"), async () => {
        try {
          await api(`/api/chats/${encodeURIComponent(chat.id)}/leave`, { method: "POST" });
          chatManagementDialog.close();
          await refreshMessengerState();
        } catch (error) {
          notify(localizeError(error.message));
        }
      }, "danger-button");
    }
    chatManagementContent.append(actions);
    if (!chatManagementDialog.open) chatManagementDialog.showModal();
  } catch (error) {
    notify(localizeError(error.message));
  }
}

async function searchUsers(query) {
  if (query.trim().replace(/^@/, "").length < 2) {
    renderUsers([]);
    return;
  }
  try {
    const users = await api(`/api/users?q=${encodeURIComponent(query)}`);
    renderUsers(users);
  } catch (error) {
    notify(localizeError(error.message));
  }
}

async function startDirectMessage(username) {
  try {
    const conversation = await api(`/api/directs/${encodeURIComponent(username)}`, jsonOptions("POST", {}));
    if (!conversation.pending && !directs.some((item) => item.id === conversation.id)) directs.unshift(conversation);
    directoryDialog.close();
    renderConversations();
    await openConversation(conversation);
  } catch (error) {
    notify(localizeError(error.message));
  }
}

async function createChannel(event) {
  event.preventDefault();
  const errorBox = document.querySelector("#channel-error");
  errorBox.hidden = true;
  try {
    const channel = await api("/api/channels", jsonOptions("POST", {
      name: document.querySelector("#channel-name").value.trim(),
      description: document.querySelector("#channel-description").value.trim()
    }));
    channels.push(channel);
    channelDialog.close();
    event.target.reset();
    renderConversations();
    await openConversation(channel);
    notify(t("channelCreated"));
  } catch (error) {
    showError(errorBox, error.message);
  }
}

async function createGroup(event) {
  event.preventDefault();
  const errorBox = document.querySelector("#group-error");
  errorBox.hidden = true;
  const usernames = document.querySelector("#group-members").value.split(",")
    .map((username) => username.trim().replace(/^@/, "")).filter(Boolean);
  try {
    const group = await api("/api/groups", jsonOptions("POST", {
      name: document.querySelector("#group-name").value.trim(),
      usernames
    }));
    directs.unshift(group);
    groupDialog.close();
    event.target.reset();
    renderConversations();
    await openConversation(group);
    notify(t("groupCreated"));
  } catch (error) {
    showError(errorBox, error.message);
  }
}

async function saveProfile(event) {
  event.preventDefault();
  const errorBox = document.querySelector("#profile-error");
  errorBox.hidden = true;
  const newPassword = document.querySelector("#profile-new-password").value;
  try {
    const avatarFile = document.querySelector("#profile-avatar-input").files[0];
    if (avatarFile) {
      if (avatarFile.size > 5 * 1024 * 1024) throw new Error(t("profileAvatar"));
      const avatarBlob = await cropAvatar(avatarFile);
      const avatarResult = await api("/api/account/avatar", {
        method: "POST",
        headers: { "Content-Type": avatarBlob.type },
        body: avatarBlob
      });
      currentUser.avatarUrl = avatarResult.avatarUrl;
    }
    const result = await api("/api/account", jsonOptions("PATCH", {
      fullName: document.querySelector("#profile-full-name").value.trim(),
      about: document.querySelector("#profile-about").value.trim(),
      showOnlineStatus: document.querySelector("#profile-show-online").checked,
      hideNotificationContent: document.querySelector("#profile-hide-notification-content").checked,
      currentPassword: document.querySelector("#profile-current-password").value,
      newPassword
    }));
    setUser({ ...currentUser, ...result.user });
    document.querySelector("#profile-current-password").value = "";
    document.querySelector("#profile-new-password").value = "";
    document.querySelector("#profile-avatar-input").value = "";
    document.querySelector("#profile-avatar-filename").textContent = t("avatarPickerHint");
    if (profilePreviewUrl) URL.revokeObjectURL(profilePreviewUrl);
    profilePreviewUrl = null;
    renderProfileAvatarPreview(currentUser);
    profileDialog.close();
    notify(t("accountUpdated"));
  } catch (error) {
    showError(errorBox, error.message);
  }
}

async function cropAvatar(file) {
  const image = await createImageBitmap(file);
  const side = Math.min(image.width, image.height);
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) throw new Error(t("uploadFailed"));
  context.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, 512, 512);
  image.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error(t("uploadFailed"))), "image/png");
  });
}
async function signOut() {
  try {
    stopChatPresenceTracking();
    const registration = "serviceWorker" in navigator && window.isSecureContext
      ? await navigator.serviceWorker.ready
      : null;
    const subscription = registration ? await registration.pushManager.getSubscription() : null;
    await api("/api/auth/logout", jsonOptions("POST", {
      pushEndpoint: subscription?.endpoint || ""
    }));
    if (subscription) await subscription.unsubscribe();
    notificationIndicator.hidden = true;
    if (stream) stream.close();
    currentUser = null;
    currentConversation = null;
    messengerView.classList.remove("chat-open");
    channels = [];
    directs = [];
    messages = [];
    messengerView.hidden = true;
    authView.hidden = false;
    authForm.reset();
    setAuthMode("login");
    profileDialog.close();
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
  notificationIndicator.hidden = !enabled;
  const label = t(enabled ? "disableNotifications" : "enableNotifications");
  notificationButton.setAttribute("aria-label", label);
  notificationButton.title = label;
}

authSwitch.addEventListener("click", () => setAuthMode(authMode === "login" ? "register" : "login"));
document.addEventListener("visibilitychange", () => void reportChatViewingState());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && currentConversation && isMessageListAtBottom()) {
    void markConversationRead(currentConversation);
  }
});
messageList.addEventListener("scroll", () => {
  if (document.visibilityState === "visible" && currentConversation && isMessageListAtBottom()) {
    void markConversationRead(currentConversation);
  }
});
window.addEventListener("focus", () => void reportChatViewingState());
window.addEventListener("pagehide", () => void reportChatViewingState(true));
document.addEventListener("pointerdown", (event) => {
  if (!messageContextMenu.hidden && !messageContextMenu.contains(event.target)) {
    closeMessageContextMenu();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !messageContextMenu.hidden) closeMessageContextMenu();
});
document.addEventListener("scroll", closeMessageContextMenu, true);
window.addEventListener("resize", closeMessageContextMenu);
authForm.addEventListener("submit", (event) => void handleAuth(event));
authLanguage.addEventListener("change", () => setLanguage(authLanguage.value));
appLanguage.addEventListener("change", () => setLanguage(appLanguage.value));
composer.addEventListener("submit", (event) => void submitMessage(event));
messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    composer.requestSubmit();
  }
});
messageInput.addEventListener("input", () => {
  messageInput.style.height = "auto";
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, 150)}px`;
});
document.querySelector("#new-message").addEventListener("click", () => {
  directoryDialog.showModal();
  document.querySelector("#user-search").focus();
  renderUsers([]);
});
document.querySelector("#user-search").addEventListener("input", (event) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => void searchUsers(event.target.value), 180);
});
document.querySelector("#create-channel").addEventListener("click", () => channelDialog.showModal());
document.querySelector("#create-group").addEventListener("click", () => groupDialog.showModal());
manageChatButton.addEventListener("click", () => void openChatManagement());
chatInfoButton.addEventListener("click", () => void openChatInfo());
chatSearchButton.addEventListener("click", () => {
  chatSearchDialog.showModal();
  chatSearchInput.focus();
  chatSearchResults.replaceChildren();
});
chatSearchInput.addEventListener("input", () => {
  clearTimeout(chatSearchTimer);
  chatSearchTimer = setTimeout(() => {
    void searchChat(chatSearchInput.value).catch((error) => notify(localizeError(error.message)));
  }, 180);
});
document.querySelector("#attach-files").addEventListener("click", () => attachmentInput.click());
attachmentInput.addEventListener("change", () => void uploadSelectedFiles(attachmentInput.files));
cancelUploadButton.addEventListener("click", () => {
  currentUpload?.abort();
});
document.querySelector("#media-viewer-close").addEventListener("click", () => {
  document.querySelector("#media-viewer").close();
});
document.querySelector("#media-viewer-previous").addEventListener("click", () => navigateMediaViewer(-1));
document.querySelector("#media-viewer-next").addEventListener("click", () => navigateMediaViewer(1));
document.querySelector("#channel-form").addEventListener("submit", (event) => void createChannel(event));
document.querySelector("#group-form").addEventListener("submit", (event) => void createGroup(event));
document.querySelector("#profile-button").addEventListener("click", () => {
  prepareOwnProfile();
  profileDialog.showModal();
});
document.querySelector("#profile-avatar-input").addEventListener("change", (event) => {
  void updateProfileAvatarPreview(event.currentTarget.files[0]);
});
document.querySelector("#profile-form").addEventListener("submit", (event) => void saveProfile(event));
document.querySelector("#logout-button").addEventListener("click", () => void signOut());
notificationButton.addEventListener("click", () => void togglePushNotifications());
document.querySelector("#mobile-menu").addEventListener("click", () => {
  messengerView.classList.remove("chat-open");
});

function setSidebarMenu(open) {
  sidebarMenu.hidden = !open;
  sidebarMenuButton.setAttribute("aria-expanded", String(open));
}
sidebarMenuButton.addEventListener("click", (event) => {
  event.stopPropagation();
  setSidebarMenu(sidebarMenu.hidden);
});
sidebarMenu.addEventListener("click", () => setSidebarMenu(false));
document.addEventListener("click", (event) => {
  if (!sidebarMenu.hidden && !sidebarMenu.contains(event.target)) setSidebarMenu(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !sidebarMenu.hidden) {
    setSidebarMenu(false);
    sidebarMenuButton.focus();
  }
});
sidebarSearchInput.addEventListener("input", renderConversations);
sidebarSearchInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && sidebarSearchInput.value) {
    sidebarSearchInput.value = "";
    renderConversations();
  }
});
searchPeopleRow.addEventListener("click", () => {
  const query = sidebarSearchInput.value.trim();
  directoryDialog.showModal();
  const field = document.querySelector("#user-search");
  field.value = query;
  field.focus();
  void searchUsers(query);
});
document.querySelector("#find-people").addEventListener("click", () => {
  document.querySelector("#new-message").click();
});

async function start() {
  setLanguage(language);
  setAuthMode("login");
  try {
    const config = await api("/api/config");
    privacyVersion = config.privacyVersion;
    const result = await api("/api/auth/me");
    if (!result.user) return;
    authView.hidden = true;
    messengerView.hidden = false;
    await loadMessenger();
    await checkPushSubscription();
  } catch (error) {
    showError(authError, error.message);
  }
}

polusReady = true;
void start();