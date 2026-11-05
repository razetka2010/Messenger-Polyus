import { createRoot } from "react-dom/client";
import { Component, createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { connectEventStream, getActiveAccountKey, requestJson, setActiveAccountKey } from "./apiClient.mjs";
import { createAccountKey, getRequestedAccountUserId, getStoredAccounts, saveAccounts } from "./accounts.mjs";
import { uploadAttachment } from "./attachmentUploads.mjs";
import { formatAttachmentSize } from "./attachmentFormatting.mjs";
import { MessageAttachment, MessageText } from "./components/MessageContent.jsx";
import AuthenticatedImage, { AuthenticatedVideo } from "./components/AuthenticatedImage.jsx";
import { cropAvatar } from "./avatar.mjs";
import { getConversationHeaderControls, orderConversations } from "./conversationList.mjs";
import { clearClientDiagnostics, createClientId, getClientDiagnostics, logClientDiagnostic } from "./diagnostics.mjs";
import {
  encryptAttachment,
  encryptMessagePayload,
  ensureEncryptionIdentity,
  getConversationEncryptionKeys,
  getEncryptionPublicKey,
  getOwnEncryptionPublicKey,
  hasReadyEncryptionIdentity,
  prepareEncryptionKeyPasswordChange,
  trustChangedEncryptionKey
} from "./encryption.mjs";
import { initializeMessenger } from "./messengerController.js";

const MESSAGE_REACTION_EMOJIS = [
  "👍", "❤️", "😂", "😮", "😢", "👏", "🔥", "🎉", "😍", "🤔", "🙏", "💯",
  "✅", "👎", "😎", "🥳", "😭", "😡", "🤯", "🥰", "🤩", "🤗", "😴", "🙌",
  "💪", "👀", "🌹", "🎂", "💔", "✨", "🤝", "🫡", "😱", "😅", "😊", "😇",
  "🤮", "😷", "💩", "🐱", "🐶", "🍕", "☕", "⚡", "🚀", "🎈", "🌟", "💡"
];

const translations = {
  ru: {
    welcome: "ВАША ТОЧКА СВЯЗИ",
    signIn: "С возвращением",
    signInSubtitle: "Войдите, чтобы продолжить общение.",
    registerSubtitle: "Создай профиль, чтобы общаться с людьми на Полюсе.",
    fullName: "Имя и фамилия",
    fullNamePlaceholder: "Как тебя называть?",
    about: "О себе (необязательно)",
    username: "Имя пользователя",
    usernameHint: "Уникально: 3–32 латинских буквы, цифры или _.",
    password: "Пароль",
    confirmPassword: "Повторите пароль",
    consent: "Я прочитал(а) и принимаю",
    privacy: "политику конфиденциальности",
    signInButton: "Войти",
    createAccount: "Создать аккаунт",
    noAccount: "Впервые на Полюсе?",
    hasAccount: "Уже есть аккаунт?",
    privacyNote: "Твои разговоры — только для участников.",
    discover: "ОТКРЫТЫЕ КАНАЛЫ",
    join: "Вступить",
    openChannel: "Открыть",
    joinChannelPrompt: "Это открытый канал. Вступите, чтобы участвовать в обсуждении.",
    findPeopleFor: "Найти людей:",
    noChats: "Здесь пока пусто. Нажмите на карандаш, чтобы найти людей.",
    noMessagesYet: "Нет сообщений",
    deletedMessage: "Сообщение удалено",
    edit: "Изменить",
    remove: "Удалить",
    you: "Вы",
    photo: "Фото",
    files: "Файлы",
    loadError: "Не удалось загрузить приложение. Обновите страницу.",
    savedMessages: "Избранное",
    savedMessagesCaption: "Личные заметки и сохранённые сообщения",
    saveToSavedMessages: "Сохранить в Избранное",
    savedFrom: "Источник:",
    voiceMessage: "Голосовое сообщение",
    play: "Воспроизвести",
    pause: "Пауза",
    playbackFailed: "Не удалось воспроизвести сообщение.",
    unsupportedAudioFormat: "Этот формат голосового сообщения не поддерживается браузером. Попробуйте открыть его на другом устройстве.",
    reply: "Ответить",
    forward: "Переслать",
    forwardedFrom: "Переслано из",
    forwarding: "Пересылка сообщения",
    chooseChat: "Выберите чат",
    searchUsersToForward: "Найти пользователя по имени или @username",
    searchPromptToForward: "Введите не менее двух символов для поиска пользователя.",
    noForwardTargets: "Нет доступных чатов или пользователей.",
    replyTo: "Ответ на сообщение",
    cancelReply: "Отменить ответ",
    messageUnavailable: "Сообщение удалено",
    messageActions: "Действия с сообщением",
    pinChat: "Закрепить чат",
    unpinChat: "Открепить чат",
    pinnedChat: "Чат закреплён",
    deleteChatAction: "Удалить чат",
    deleteChatTitle: "Удаление чата",
    deleteForMe: "Удалить у меня",
    deleteForEveryone: "Удалить у всех",
    cancel: "Отмена",
    channelPrivacy: "Канал",
    publicChannel: "Публичный — отображается в списке каналов",
    privateChannel: "Частный — доступен только по ссылке",
    inviteLink: "Пригласительная ссылка",
    createInviteLink: "Создать ссылку",
    copyInviteLink: "Скопировать ссылку",
    revokeInviteLink: "Отозвать ссылку",
    linkCopied: "Ссылка скопирована",
    channelProfile: "Профиль канала",
    channelSettings: "Настройки канала",
    memberCount: "участников",
    openChat: "Открыть чат",
    joinByInvite: "Вступить по приглашению",
    inviteNotFound: "Приглашение недействительно или отозвано."
  },
  en: {
    welcome: "YOUR CONNECTION POINT",
    signIn: "Welcome back",
    signInSubtitle: "Sign in to continue the conversation.",
    registerSubtitle: "Create a profile to connect with people on Polus.",
    fullName: "Full name",
    fullNamePlaceholder: "What should we call you?",
    about: "About (optional)",
    username: "Username",
    usernameHint: "Unique: 3–32 Latin letters, numbers, or _.",
    password: "Password",
    confirmPassword: "Confirm password",
    consent: "I have read and accept the",
    privacy: "privacy policy",
    signInButton: "Sign in",
    createAccount: "Create account",
    noAccount: "New to Polus?",
    hasAccount: "Already have an account?",
    privacyNote: "Your conversations are only for participants.",
    discover: "OPEN CHANNELS",
    join: "Join",
    openChannel: "Open",
    joinChannelPrompt: "This is a public channel. Join to participate in the conversation.",
    findPeopleFor: "Find people:",
    noChats: "Nothing here yet. Click the pencil to find people.",
    noMessagesYet: "No messages yet",
    deletedMessage: "Message deleted",
    edit: "Edit",
    remove: "Delete",
    you: "You",
    photo: "Photo",
    files: "Files",
    loadError: "Unable to load the app. Refresh the page.",
    savedMessages: "Saved Messages",
    savedMessagesCaption: "Personal notes and saved messages",
    saveToSavedMessages: "Save to Saved Messages",
    savedFrom: "From:",
    voiceMessage: "Voice message",
    play: "Play",
    pause: "Pause",
    playbackFailed: "Unable to play this message.",
    unsupportedAudioFormat: "This voice message format is not supported by this browser. Try opening it on another device.",
    reply: "Reply",
    forward: "Forward",
    forwardedFrom: "Forwarded from",
    forwarding: "Forward message",
    chooseChat: "Choose a chat",
    searchUsersToForward: "Find a user by name or @username",
    searchPromptToForward: "Enter at least two characters to find a user.",
    noForwardTargets: "No available chats or users.",
    replyTo: "Replying to",
    cancelReply: "Cancel reply",
    messageUnavailable: "Message deleted",
    messageActions: "Message actions",
    pinChat: "Pin chat",
    unpinChat: "Unpin chat",
    pinnedChat: "Pinned chat",
    deleteChatAction: "Delete chat",
    deleteChatTitle: "Delete chat",
    deleteForMe: "Delete for me",
    deleteForEveryone: "Delete for everyone",
    cancel: "Cancel",
    channelPrivacy: "Channel privacy",
    publicChannel: "Public — shown in the channel list",
    privateChannel: "Private — available only by invite link",
    inviteLink: "Invite link",
    createInviteLink: "Create link",
    copyInviteLink: "Copy link",
    revokeInviteLink: "Revoke link",
    linkCopied: "Link copied",
    channelProfile: "Channel profile",
    channelSettings: "Channel settings",
    memberCount: "members",
    openChat: "Open chat",
    joinByInvite: "Join by invite",
    inviteNotFound: "This invitation is invalid or has been revoked."
  }
};

const THEME_OPTIONS = [
  { id: "light", labels: { ru: "Светлая", en: "Light" }, colors: ["#f5f8fc", "#ffffff", "#168af4"] },
  { id: "dark", labels: { ru: "Тёмная", en: "Dark" }, colors: ["#0c121c", "#182435", "#3390ec"] },
  { id: "arctic", labels: { ru: "Северное сияние", en: "Arctic" }, colors: ["#e8f7fb", "#f7fdff", "#178cae"] },
  { id: "lavender", labels: { ru: "Лавандовая", en: "Lavender" }, colors: ["#f1eefb", "#fcfaff", "#8162cb"] },
  { id: "warm", labels: { ru: "Песочная", en: "Sand" }, colors: ["#f6efe5", "#fffaf2", "#b87935"] }
];
let notificationAudioContext = null;

function prepareNotificationSound() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  notificationAudioContext ||= new AudioContext();
  if (notificationAudioContext.state === "suspended") void notificationAudioContext.resume();
}

function playNotificationSound() {
  if (localStorage.getItem("polus-message-sound") !== "true" || !notificationAudioContext
    || notificationAudioContext.state !== "running") return;
  const oscillator = notificationAudioContext.createOscillator();
  const gain = notificationAudioContext.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = 660;
  gain.gain.setValueAtTime(0.055, notificationAudioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, notificationAudioContext.currentTime + 0.12);
  oscillator.connect(gain);
  gain.connect(notificationAudioContext.destination);
  oscillator.start();
  oscillator.stop(notificationAudioContext.currentTime + 0.12);
}

const LanguageContext = createContext({
  language: "ru", setLanguage: () => {}, theme: "light", setTheme: () => {},
  messageSound: false, setMessageSound: () => {}
});

function useCurrentLanguage() {
  return useContext(LanguageContext).language;
}

function useSetLanguage() {
  return useContext(LanguageContext).setLanguage;
}

function useCurrentTheme() {
  return useContext(LanguageContext).theme;
}

function useSetTheme() {
  return useContext(LanguageContext).setTheme;
}

function useCurrentMessageSound() {
  return useContext(LanguageContext).messageSound;
}

function useSetMessageSound() {
  return useContext(LanguageContext).setMessageSound;
}

class AppErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    logClientDiagnostic("app.react-render-failed", {
      message: error.message,
      stack: error.stack || "",
      componentStack: info.componentStack || ""
    }, "error");
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <main className="auth-view">
        <section className="auth-card" role="alert">
          <div className="eyebrow">ПОЛЮС · POLUS</div>
          <h1>Не удалось открыть приложение</h1>
          <p>Ошибка записана в диагностику браузера. Обновите страницу или откройте консоль разработчика.</p>
          <button className="primary-button" type="button" onClick={() => window.location.reload()}>
            Обновить страницу
          </button>
        </section>
      </main>
    );
  }
}

function initials(name = "") {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => Array.from(part)[0] || "").join("").toLocaleUpperCase();
}

function localizeComposerError(message, language) {
  const errors = {
    "Write a message before sending.": language === "ru" ? "Сначала напиши сообщение." : message,
    "Message must contain 1–4000 characters.": language === "ru"
      ? "Сообщение должно содержать от 1 до 4000 символов."
      : message,
    "You can send at most 20 messages per minute.": language === "ru"
      ? "Можно отправлять не более 20 сообщений в минуту."
      : message,
    "You cannot message yourself.": language === "ru" ? "Нельзя написать самому себе." : message,
    "User not found.": language === "ru" ? "Пользователь не найден." : message,
    "A message can contain at most 10 files.": language === "ru"
      ? "К одному сообщению можно прикрепить не более 10 файлов."
      : message,
    "Messages can only be edited within 48 hours.": language === "ru"
      ? "Редактировать сообщение можно только в течение 48 часов."
      : message,
    "Unable to upload the file.": language === "ru" ? "Не удалось загрузить файл." : message,
    "The server returned an invalid response.": language === "ru"
      ? "Сервер вернул некорректный ответ."
      : message
  };
  return errors[message] || message;
}

function getEncryptionKeyChangeNotice(error, language) {
  const russian = language === "ru";
  const details = russian
    ? `Ключи пользователя ${error.recipientId} изменились. Ранее сохранённый отпечаток: ${error.previousFingerprint}. Новый отпечаток: ${error.newFingerprint}. Не отправляйте сообщения, пока не сверите новый отпечаток с собеседником по независимому доверенному каналу.`
    : `The keys for user ${error.recipientId} changed. Previously saved fingerprint: ${error.previousFingerprint}. New fingerprint: ${error.newFingerprint}. Do not send messages until you verify the new fingerprint with the person through an independent trusted channel.`;
  if (!window.confirm(`${details}\n\n${russian
    ? "Вы сверили новый отпечаток по независимому каналу и хотите запомнить этот ключ?"
    : "Have you verified the new fingerprint through an independent channel and want to trust this key?"}`)) {
    return Promise.resolve(details);
  }
  return trustChangedEncryptionKey(
    error.userId,
    error.recipientId,
    error.publicKey,
    error.signingPublicKey,
    error.previousFingerprint
  ).then(() => russian
    ? "Новый отпечаток сохранён. Повторите отправку после проверки ключа."
    : "The new fingerprint was saved. Retry sending after verifying the key.")
    .catch((cause) => cause.message);
}

function avatarTone(id) {
  let hash = 0;
  for (const character of String(id)) hash = (hash * 31 + character.codePointAt(0)) % 7;
  return hash;
}

function listTime(value, language) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((today - day) / 86400000);
  const locale = language === "ru" ? "ru-RU" : "en-US";
  if (days <= 0) return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(date);
  if (days < 7) return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(date);
  return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "2-digit" }).format(date);
}

function conversationPreview(conversation, userId, text) {
  const last = conversation.lastMessage;
  if (!last) return conversation.description || text.noMessagesYet;
  if (last.deleted) return text.deletedMessage;
  if (last.mediaType === "voice") return `🎙 ${text.voiceMessage}`;
  let body = last.text?.replace(/\s+/g, " ") || "";
  if (!body && last.attachments?.length) {
    body = last.attachments.every((file) => /^image\//.test(file.mimeType))
      ? `🖼 ${text.photo}`
      : `📎 ${last.attachments.length === 1 ? last.attachments[0].name : text.files}`;
  }
  if (last.authorId === userId) return `${text.you}: ${body}`;
  if (conversation.type === "group") {
    const authorName = (last.author?.fullName || last.author?.username || "").split(" ")[0];
    if (authorName) return `${authorName}: ${body}`;
  }
  return body;
}

function ReactConversationRow({ conversation, selected, discover, userId, language, onOpen }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapperRef = useRef(null);
  const text = translations[language];
  const saved = conversation.type === "saved";
  const lastTime = conversation.lastMessage?.sentAt;
  const description = discover
    ? conversation.description || String(conversation.memberIds?.length || 0)
    : saved ? text.savedMessagesCaption : conversationPreview(conversation, userId, text);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const closeOutside = (event) => {
      const target = event.target;
      if (target instanceof Element
        && (target.closest(".chat-row-menu") || target.closest(".chat-row-menu-trigger"))) return;
      setMenuOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  const fireAction = (action) => {
    setMenuOpen(false);
    document.dispatchEvent(new CustomEvent(action === "delete"
      ? "polus:chat-delete-request" : "polus:chat-row-action", {
      detail: { action, conversation }
    }));
  };

  return (
    <div ref={wrapperRef} className="conversation-row-wrapper">
    <button
      type="button"
      className="chat-row"
      data-conversation-id={conversation.id}
      aria-current={selected ? "page" : undefined}
      onContextMenu={(event) => {
        if (discover || saved) return;
        event.preventDefault();
        setMenuOpen(true);
      }}
      onClick={() => onOpen(conversation)}
    >
      <span className={`chat-avatar avatar-tone-${avatarTone(conversation.id)}${saved ? " saved-chat-avatar" : ""}`} aria-hidden="true">
        {saved
          ? <svg className="saved-bookmark-icon" viewBox="0 0 24 24"><path d="M6 3.75h12v17l-6-4-6 4z" /></svg>
          : conversation.avatarUrl
          ? <AuthenticatedImage src={conversation.avatarUrl} alt="" loading="lazy" />
          : initials(conversation.name)}
      </span>
      <span className="chat-row-body">
        <span className="chat-row-top">
          <span className="chat-row-name">
            <span className="chat-row-name-text" title={saved ? text.savedMessages : conversation.name}>
              {saved ? text.savedMessages : conversation.name}
            </span>
            {conversation.pinned && !saved && !discover && (
              <span className="chat-row-pinned" title={text.pinnedChat} aria-label={text.pinnedChat}>
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M5 2.5h6l-.8 3.2 1.8 1.8v1H8.5v4.8l-.5.9-.5-.9V8.5H4v-1l1.8-1.8L5 2.5Z" />
                </svg>
              </span>
            )}
          </span>
        </span>
        <span className="chat-row-bottom">
          <span className="chat-row-preview" title={description}>{description}</span>
        </span>
      </span>
      <span className="chat-row-meta">
        {lastTime && !discover && (
          <time className="chat-row-time" dateTime={lastTime}>{listTime(lastTime, language)}</time>
        )}
        {discover && <span className="join-channel">{text.openChannel}</span>}
        {!discover && conversation.unreadCount > 0 && (
          <span className={conversation.muted ? "unread-badge is-muted" : "unread-badge"}>
            {conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}
          </span>
        )}
      </span>
    </button>
    {!discover && !saved && (
      <>
        <button
          type="button"
          className="chat-row-menu-trigger"
          aria-label={language === "ru" ? "Действия с чатом" : "Chat actions"}
          title={language === "ru" ? "Действия с чатом" : "Chat actions"}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >⋯</button>
        {menuOpen && (
          <div className="chat-row-menu" role="menu">
            <button type="button" role="menuitem" onClick={() => fireAction("pin")}>
              {conversation.pinned ? text.unpinChat : text.pinChat}
            </button>
            <button type="button" role="menuitem" onClick={() => fireAction("delete")}>
              {text.deleteChatAction}
            </button>
          </div>
        )}
      </>
    )}
    </div>
  );
}

function SidebarSearch() {
  const [query, setQuery] = useState("");
  const searchRef = useRef(null);
  const language = useCurrentLanguage();
  useEffect(() => {
    const clear = () => {
      setQuery("");
      document.dispatchEvent(new CustomEvent("polus:sidebar-search", { detail: { query: "" } }));
    };
    const openPeopleSearch = (event) => {
      const nextQuery = event.detail?.query || "";
      setQuery(nextQuery);
      document.dispatchEvent(new CustomEvent("polus:sidebar-search", { detail: { query: nextQuery } }));
      searchRef.current?.focus();
    };
    document.addEventListener("polus:clear-sidebar-search", clear);
    document.addEventListener("polus:open-people-search", openPeopleSearch);
    document.addEventListener("polus:close-people-search", clear);
    return () => {
      document.removeEventListener("polus:clear-sidebar-search", clear);
      document.removeEventListener("polus:open-people-search", openPeopleSearch);
      document.removeEventListener("polus:close-people-search", clear);
    };
  }, []);

  return (
    <label className="sidebar-search">
      <span className="visually-hidden">{language === "ru" ? "Поиск" : "Search"}</span>
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
      <input
        id="sidebar-search"
        ref={searchRef}
        type="search"
        autoComplete="off"
        placeholder={language === "ru" ? "Поиск" : "Search"}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          document.dispatchEvent(new CustomEvent("polus:sidebar-search", {
            detail: { query: event.target.value }
          }));
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && query) {
            setQuery("");
            document.dispatchEvent(new CustomEvent("polus:sidebar-search", { detail: { query: "" } }));
          }
        }}
      />
    </label>
  );
}

function ConversationList({ userId }) {
  const [snapshot, setSnapshot] = useState({ channels: [], directs: [], currentConversationId: null });
  const [query, setQuery] = useState("");
  const language = useCurrentLanguage();
  const text = translations[language];
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visible = useMemo(() => {
    const activity = (item) => Date.parse(item.lastMessage?.sentAt || item.createdAt || 0) || 0;
    const matches = (item) => !normalizedQuery
      || `${item.type === "saved" ? text.savedMessages : item.name} ${item.username || ""}`
        .toLocaleLowerCase().includes(normalizedQuery);
    const mine = orderConversations([
      ...snapshot.channels.filter((item) => item.joined),
      ...snapshot.directs
    ], activity).filter(matches);
    return {
      mine,
      open: snapshot.channels.filter((item) => !item.joined).filter(matches)
    };
  }, [normalizedQuery, snapshot.channels, snapshot.directs, text.savedMessages]);

  useLayoutEffect(() => {
    const onConversations = (event) => setSnapshot(event.detail);
    const onSearch = (event) => setQuery(event.detail.query);

    window.addEventListener("polus:conversations-changed", onConversations);
    document.addEventListener("polus:sidebar-search", onSearch);
    return () => {
      window.removeEventListener("polus:conversations-changed", onConversations);
      document.removeEventListener("polus:sidebar-search", onSearch);
    };
  }, []);

  function openConversation(conversation) {
    document.dispatchEvent(new CustomEvent("polus:clear-sidebar-search"));
    setQuery("");
    document.dispatchEvent(new CustomEvent("polus:open-conversation", { detail: { conversation } }));
  }

  return (
    <>
      <nav className="chat-list" aria-label={language === "ru" ? "Чаты" : "Chats"}>
        {visible.mine.map((conversation) => (
          <ReactConversationRow
            key={conversation.id}
            conversation={conversation}
            selected={conversation.id === snapshot.currentConversationId}
            userId={userId}
            language={language}
            onOpen={openConversation}
          />
        ))}
      </nav>
      {!normalizedQuery && visible.open.length > 0 && (
        <section className="chat-list-section">
          <h2 className="chat-list-heading">{text.discover}</h2>
          <nav className="chat-list" aria-label={language === "ru" ? "Открытые каналы" : "Open channels"}>
            {visible.open.map((conversation) => (
              <ReactConversationRow
                key={conversation.id}
                conversation={conversation}
                selected={conversation.id === snapshot.currentConversationId}
                discover
                userId={userId}
                language={language}
                onOpen={openConversation}
              />
            ))}
          </nav>
        </section>
      )}
      {normalizedQuery.replace(/^@/, "").length >= 2 && (
        <section className="chat-list-section people-search-section">
          <h2 className="chat-list-heading">{language === "ru" ? "Люди" : "People"}</h2>
          <DiscoverySearchResults
            query={query}
            conversations={[...snapshot.channels, ...snapshot.directs]}
            onOpenConversation={openConversation}
          />
        </section>
      )}
      {!normalizedQuery && visible.mine.length === 0 && visible.open.length === 0 && (
        <p className="chat-list-empty">{text.noChats}</p>
      )}
    </>
  );
}

function formatMessageDate(value, language) {
  return new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-US", {
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(new Date(value));
}

function formatMessageTime(value, language) {
  return new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-US", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function MessageRow({ message, conversation, currentUserId, previousMessage, language }) {
  const text = translations[language];
  const author = message.author || {};
  const displayAuthor = message.displayAuthor || (
    conversation?.type === "channel" && conversation.postAs === "channel"
      ? { id: conversation.id, fullName: conversation.name, avatarUrl: conversation.avatarUrl, isChannel: true }
      : author
  );
  const isChannelAuthor = displayAuthor.isChannel === true;
  const ownMessage = !isChannelAuthor && (message.authorId === currentUserId || author.id === currentUserId);
  const previousDisplayAuthor = previousMessage?.displayAuthor || (
    conversation?.type === "channel" && conversation.postAs === "channel"
      ? { id: conversation.id }
      : previousMessage?.author
  );
  const previousTimestamp = Date.parse(previousMessage?.createdAt || previousMessage?.sentAt || "");
  const timestamp = message.createdAt || message.sentAt;
  const messageTimeGap = Date.parse(timestamp) - previousTimestamp;
  const grouped = previousDisplayAuthor?.id === displayAuthor.id
    && Number.isFinite(previousTimestamp)
    && Number.isFinite(messageTimeGap)
    && messageTimeGap >= 0
    && messageTimeGap <= 5 * 60 * 1000;
  const openProfile = () => document.dispatchEvent(new CustomEvent("polus:open-profile", {
    detail: { username: author.username }
  }));
  const showAuthor = isChannelAuthor || (!ownMessage && !grouped && conversation?.type !== "direct");
  const avatarClass = `message-avatar avatar-tone-${avatarTone(displayAuthor.id || author.id || author.username)}${ownMessage || grouped ? " is-hidden" : ""}`;

  return (
    <article
      className={`message-row${ownMessage ? " is-own" : ""}${grouped ? " is-grouped" : ""}${message.deleted ? " is-deleted" : ""}`}
      data-message-id={message.id}
    >
      {isChannelAuthor
        ? (
          <span className={avatarClass} aria-label={displayAuthor.fullName}>
            {displayAuthor.avatarUrl
              ? <AuthenticatedImage src={displayAuthor.avatarUrl} alt="" />
              : initials(displayAuthor.fullName)}
          </span>
        )
        : (
          <button type="button" className={avatarClass} aria-label={author.fullName || author.username || ""} onClick={openProfile}>
            {author.avatarUrl ? <AuthenticatedImage src={author.avatarUrl} alt="" /> : initials(author.fullName || author.username)}
          </button>
        )}
      <div className="message-content">
        {!message.deleted && (
          <button
            type="button"
            className="message-actions-trigger"
            aria-label={text.messageActions}
            title={text.messageActions}
            onClick={(event) => document.dispatchEvent(new CustomEvent("polus:message-context-menu-request", {
              detail: { event }
            }))}
          >···</button>
        )}
        {showAuthor && (
          <div className="message-author">
            {isChannelAuthor
              ? <span className="message-name">{displayAuthor.fullName}</span>
              : (
                <>
                  <button type="button" className="message-name profile-inline-button" onClick={openProfile}>
                    {author.fullName}
                  </button>
                  {author.username && <span className="message-handle">@{author.username}</span>}
                </>
              )}
          </div>
        )}
        <p className="message-text">
          {message.deleted ? text.deletedMessage : <MessageText value={message.text || ""} />}
          {!message.deleted && message.editedAt && <span className="visually-hidden"> ({language === "ru" ? "изменено" : "edited"})</span>}
        </p>
        {!message.deleted && message.encrypted && message.signatureVerified === false && (
          <div className="message-security-warning" role="note">
            {language === "ru"
              ? "Старое сообщение: подпись отправителя не проверена."
              : "Legacy message: sender signature was not verified."}
          </div>
        )}
        {message.savedSource && !message.deleted && (
          <div className="saved-message-source">
            <span>{text.savedFrom}</span>
            <strong>{message.savedSource.chatName}</strong>
            <span>· {message.savedSource.authorName}</span>
          </div>
        )}
        {message.forwardedFrom && !message.deleted && (
          <div className="saved-message-source forwarded-message-source">
            <span>{text.forwardedFrom}</span>
            <strong>{message.forwardedFrom.authorName}</strong>
            {(message.forwardedFrom.chatName || message.forwardedFrom.chatType === "saved") && (
              <span>· {message.forwardedFrom.chatType === "saved" ? text.savedMessages : message.forwardedFrom.chatName}</span>
            )}
          </div>
        )}
        {message.replyTo && (
          <button
            type="button"
            className="message-reply-preview"
            onClick={() => document.dispatchEvent(new CustomEvent("polus:open-replied-message", {
              detail: { messageId: message.replyTo.id }
            }))}
          >
            <strong>{message.replyTo.author?.fullName || message.replyTo.author?.username || text.replyTo}</strong>
            <span>{message.replyTo.deleted
              ? text.messageUnavailable
              : message.replyTo.text || message.replyTo.attachments?.join(", ") || ""}</span>
          </button>
        )}
        {!message.deleted && message.attachments?.length > 0 && (
          <div className="message-attachments">
            {message.attachments.map((attachment) => (
              <MessageAttachment key={attachment.id} attachment={attachment} text={text} mediaType={message.mediaType} />
            ))}
          </div>
        )}
        {!message.deleted && message.reactions?.length > 0 && (
          <div className="message-reactions" aria-label={language === "ru" ? "Реакции" : "Reactions"}>
            {message.reactions.map((reaction) => (
              <button
                key={reaction.emoji}
                type="button"
                className={`message-reaction${reaction.reactedByMe ? " is-selected" : ""}`}
                aria-pressed={reaction.reactedByMe}
                disabled={conversation?.joined === false}
                onClick={() => document.dispatchEvent(new CustomEvent("polus:message-react", {
                  detail: { messageId: message.id, emoji: reaction.emoji }
                }))}
              >
                <span>{reaction.emoji}</span><small>{reaction.count}</small>
              </button>
            ))}
          </div>
        )}
        <div className="message-bubble-footer">
          <time className="message-time" dateTime={timestamp} title={new Date(timestamp).toLocaleString()}>
            {formatMessageTime(timestamp, language)}
          </time>
          {message.editedAt && !message.deleted && (
            <span className="message-edited">{language === "ru" ? "изм." : "edited"}</span>
          )}
          {ownMessage && (
            <svg
              className={`message-read-status${message.seenByRecipient ? " is-read" : ""}`}
              viewBox="0 0 16 12"
              aria-label={message.seenByRecipient
                ? language === "ru" ? "Просмотрено" : "Read"
                : language === "ru" ? "Отправлено" : "Sent"}
              title={message.seenByRecipient
                ? language === "ru" ? "Просмотрено" : "Read"
                : language === "ru" ? "Отправлено" : "Sent"}
            >
              <path d="m1 6 3.2 3.2L10 3.4" />
              {message.seenByRecipient && <path d="m6.5 8.2 1 1L15 2" />}
            </svg>
          )}
        </div>
      </div>
    </article>
  );
}

function ConversationHeader() {
  const [conversation, setConversation] = useState(null);
  const currentLanguage = useCurrentLanguage();

  useLayoutEffect(() => {
    const onHeaderChange = (event) => setConversation(event.detail.conversation);
    window.addEventListener("polus:conversation-header-changed", onHeaderChange);
    return () => {
      window.removeEventListener("polus:conversation-header-changed", onHeaderChange);
    };
  }, []);

  const backButton = (
    <button
      id="mobile-menu"
      className="icon-button mobile-menu"
      type="button"
      aria-label={currentLanguage === "ru" ? "Назад" : "Back"}
      onClick={() => document.getElementById("messenger-view")?.classList.remove("chat-open")}
    >←</button>
  );

  if (!conversation) {
    return (
      <>
        {backButton}
        <span className="conversation-icon" aria-hidden="true">#</span>
        <div className="chat-title-copy">
          <h1>{currentLanguage === "ru" ? "Общий" : "Select a conversation"}</h1>
          <span className="conversation-subtitle" />
        </div>
      </>
    );
  }
  const isDirect = conversation.type !== "channel";
  const canOpenHeaderDetails = conversation.type === "channel"
    || conversation.type === "group"
    || (conversation.type === "direct" && Boolean(conversation.username));
  const openHeaderDetails = () => {
    if (conversation.type === "direct" && conversation.username) {
      document.dispatchEvent(new CustomEvent("polus:open-profile", {
        detail: { username: conversation.username }
      }));
    } else if (conversation.type === "channel") {
      if (conversation.joined !== false) {
        document.dispatchEvent(new CustomEvent("polus:chat-info"));
      } else {
        document.dispatchEvent(new CustomEvent("polus:open-channel-profile", {
          detail: { channelId: conversation.id }
        }));
      }
    } else if (conversation.type === "group") {
      document.dispatchEvent(new CustomEvent("polus:chat-info"));
    }
  };
  const subtitle = conversation.type === "saved"
    ? ""
    : conversation.type === "channel"
    ? conversation.description || `${conversation.memberIds?.length || 0} ${currentLanguage === "ru" ? "участников" : "members"}`
    : conversation.type === "group"
      ? `${conversation.memberIds?.length || 0} ${currentLanguage === "ru" ? "участников" : "members"}`
      : `@${conversation.username || ""}`;
  return (
    <>
      {backButton}
      {canOpenHeaderDetails
        ? (
          <button
            type="button"
            className="chat-header-identity"
            aria-label={currentLanguage === "ru"
              ? conversation.type === "direct" ? `Открыть профиль ${conversation.name}` : `Информация о чате ${conversation.name}`
              : conversation.type === "direct" ? `Open ${conversation.name}'s profile` : `Chat information for ${conversation.name}`}
            onClick={openHeaderDetails}
          >
            <span className={`conversation-icon${isDirect ? " is-direct" : ""}${conversation.avatarUrl ? " has-avatar" : ""}`} aria-hidden="true">
              {conversation.avatarUrl
                ? <AuthenticatedImage src={conversation.avatarUrl} alt="" />
                : conversation.type === "channel" ? "#" : initials(conversation.name)}
            </span>
            <span className="chat-title-copy">
              <span className="chat-header-name">{conversation.name}</span>
              {subtitle && <span className="conversation-subtitle">{subtitle}</span>}
            </span>
          </button>
        )
        : (
          <>
            <span className={`conversation-icon${isDirect ? " is-direct" : ""}`} aria-hidden="true">
              {conversation.type === "saved"
                ? <svg className="saved-bookmark-icon" viewBox="0 0 24 24"><path d="M6 3.75h12v17l-6-4-6 4z" /></svg>
                : conversation.avatarUrl
                  ? <AuthenticatedImage src={conversation.avatarUrl} alt="" />
                  : conversation.type === "channel" ? "#" : initials(conversation.name)}
            </span>
            <div className="chat-title-copy">
              <h1>{conversation.type === "saved"
                ? translations[currentLanguage].savedMessages
                : conversation.name}</h1>
              {subtitle && <span className="conversation-subtitle">{subtitle}</span>}
            </div>
          </>
        )}
    </>
  );
}

function HeaderActions() {
  const [conversation, setConversation] = useState(null);
  const language = useCurrentLanguage();
  const [pushEnabled, setPushEnabled] = useState(false);

  useLayoutEffect(() => {
    const onConversation = (event) => setConversation(event.detail.conversation);
    const onPush = (event) => setPushEnabled(event.detail.enabled);
    window.addEventListener("polus:conversation-header-changed", onConversation);
    document.addEventListener("polus:push-state-changed", onPush);
    return () => {
      window.removeEventListener("polus:conversation-header-changed", onConversation);
      document.removeEventListener("polus:push-state-changed", onPush);
    };
  }, []);

  const russian = language === "ru";
  const controls = getConversationHeaderControls(conversation);
  const labels = russian
    ? { search: "Поиск по чату", enable: "Включить уведомления", disable: "Отключить уведомления" }
    : { search: "Search chat", enable: "Enable notifications", disable: "Disable notifications" };
  const fire = (name) => document.dispatchEvent(new CustomEvent(`polus:${name}`));

  return (
    <div className="header-actions">
      {controls.search && <button id="chat-search" className="icon-button" type="button" aria-label={labels.search} title={labels.search} onClick={() => fire("chat-search")}>⌕</button>}
      {controls.push && <button
        id="notifications-button"
        className="icon-button notification-button"
        type="button"
        aria-label={pushEnabled ? labels.disable : labels.enable}
        title={pushEnabled ? labels.disable : labels.enable}
        onClick={() => fire("toggle-push")}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
        <span id="notification-indicator" hidden={!pushEnabled} />
      </button>}
    </div>
  );
}

function PushOnboardingDialog({ user }) {
  const dialogRef = useRef(null);
  const language = useCurrentLanguage();
  const key = `polus-push-onboarding-dismissed:${user.id}`;

  useEffect(() => {
    let active = true;
    const markDismissedForSession = () => {
      try {
        sessionStorage.setItem(key, "done");
      } catch {
        // Continue showing the prompt when browser storage is unavailable.
      }
    };
    const showIfNeeded = async () => {
      if (!window.isSecureContext || !("serviceWorker" in navigator)
        || !("PushManager" in window) || !("Notification" in window)) return;
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (!active) return;
        document.dispatchEvent(new CustomEvent("polus:push-state-changed", {
          detail: { enabled: Boolean(subscription) }
        }));
        if (subscription || Notification.permission === "denied") return;
        let dismissed = false;
        try {
          dismissed = sessionStorage.getItem(key) === "done";
        } catch {
          // Show the prompt if browser storage is unavailable.
        }
        if (!dismissed && !dialogRef.current?.open) dialogRef.current?.showModal();
      } catch (error) {
        console.error("Unable to check push notification setup:", error);
      }
    };
    void showIfNeeded();
    dialogRef.current?.addEventListener("close", markDismissedForSession);
    return () => {
      active = false;
      dialogRef.current?.removeEventListener("close", markDismissedForSession);
    };
  }, [key, user.id]);

  const enable = () => {
    try {
      sessionStorage.setItem(key, "done");
    } catch {
      // The subscription action should still work without browser storage.
    }
    document.dispatchEvent(new CustomEvent("polus:toggle-push"));
    dialogRef.current?.close();
  };

  const russian = language === "ru";
  return (
    <dialog ref={dialogRef} id="push-onboarding-dialog" className="dialog push-onboarding-dialog">
      <div className="push-onboarding-content">
        <svg className="push-onboarding-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
        </svg>
        <h2>{russian ? "Не пропускай сообщения" : "Stay up to date"}</h2>
        <p>{russian
          ? "Разреши уведомления, чтобы получать новые сообщения, даже когда Полюс закрыт."
          : "Allow notifications to receive new messages when Polus is closed."}</p>
        <div className="push-onboarding-actions">
          <button className="text-button" type="button" onClick={() => dialogRef.current?.close()}>
            {russian ? "Не сейчас" : "Not now"}
          </button>
          <button className="primary-button" type="button" onClick={enable}>
            {russian ? "Включить уведомления" : "Enable notifications"}
          </button>
        </div>
      </div>
    </dialog>
  );
}

function MessagesView() {
  const [snapshot, setSnapshot] = useState({
    conversation: null,
    messages: [],
    currentUserId: null,
    olderMessagesCursor: null,
    loadingOlderMessages: false,
    scroll: { mode: "bottom" }
  });
  const containerRef = useRef(null);
  const language = useCurrentLanguage();
  const text = translations[language];

  useLayoutEffect(() => {
    const onMessages = (event) => setSnapshot({
      ...event.detail,
      messages: [...event.detail.messages]
    });
    window.addEventListener("polus:messages-changed", onMessages);
    return () => {
      window.removeEventListener("polus:messages-changed", onMessages);
    };
  }, []);

  useLayoutEffect(() => {
    const container = containerRef.current?.parentElement;
    if (!container) return;
    if (snapshot.scroll.mode === "top") {
      container.scrollTop = snapshot.scroll.previousTop;
    } else if (snapshot.scroll.mode === "preserve") {
      container.scrollTop = snapshot.scroll.previousTop + container.scrollHeight - snapshot.scroll.previousHeight;
    } else {
      container.scrollTop = container.scrollHeight;
    }
  }, [snapshot]);

  const { conversation, messages, currentUserId, olderMessagesCursor, loadingOlderMessages } = snapshot;
  if (!conversation) return null;
  if (!messages.length) {
    const emptyDescription = conversation.type === "channel"
      ? (language === "ru" ? "Напиши первое сообщение — и разговор начнётся." : "Send the first message to get things started.")
      : conversation.type === "group"
        ? (language === "ru" ? "Напиши первое сообщение для группы." : "Send the first message to the group.")
        : conversation.type === "saved"
          ? translations[language].savedMessagesCaption
        : (language === "ru" ? "Напиши привет — начните личный разговор." : "Say hello to start a conversation.");
    return (
      <div className="empty-state">
        <span className="empty-state-icon" aria-hidden="true">{conversation.type === "channel" ? "#" : "✳"}</span>
        <strong>{language === "ru" ? "Пока здесь тихо" : "It’s quiet here for now"}</strong>
        <span>{emptyDescription}</span>
      </div>
    );
  }

  let previousDay = "";
  const rows = [];
  messages.forEach((message, index) => {
    const date = new Date(message.createdAt || message.sentAt);
    const day = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    if (day !== previousDay) {
      rows.push(
        <div className="day-separator" key={`day-${day}`}>
          <span>{formatMessageDate(message.createdAt || message.sentAt, language)}</span>
        </div>
      );
      previousDay = day;
    }
    rows.push(
      <MessageRow
        key={message.id}
        message={message}
        previousMessage={index > 0 ? messages[index - 1] : null}
        conversation={conversation}
        currentUserId={currentUserId}
        language={language}
      />
    );
  });

  return (
    <div ref={containerRef} style={{ display: "contents" }}>
      {olderMessagesCursor !== null && (
        <button
          type="button"
          className="load-older-messages"
          disabled={loadingOlderMessages}
          onClick={() => document.dispatchEvent(new CustomEvent("polus:load-older-messages"))}
        >
          {language === "ru" ? "Загрузить предыдущие сообщения" : "Load older messages"}
        </button>
      )}
      {rows}
    </div>
  );
}

function MessageContextMenu() {
  const [menu, setMenu] = useState(null);
  const language = useCurrentLanguage();
  const menuRef = useRef(null);
  const text = translations[language];

  useLayoutEffect(() => {
    const open = (event) => setMenu(event.detail);
    const close = () => setMenu(null);
    const onScroll = (event) => {
      if (menuRef.current?.contains(event.target)) return;
      close();
    };
    const messageList = document.getElementById("message-list");
    const onContextMenu = (event) => document.dispatchEvent(new CustomEvent("polus:message-context-menu-request", {
      detail: { event }
    }));
    const onPointerDown = (event) => {
      if (!menuRef.current?.contains(event.target)) close();
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("polus:message-context-menu-open", open);
    document.addEventListener("polus:message-context-menu-close", close);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    messageList?.addEventListener("contextmenu", onContextMenu);
    return () => {
      document.removeEventListener("polus:message-context-menu-open", open);
      document.removeEventListener("polus:message-context-menu-close", close);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
      messageList?.removeEventListener("contextmenu", onContextMenu);
    };
  }, []);

  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return;
    const bounds = menuRef.current.getBoundingClientRect();
    menuRef.current.style.left = `${Math.max(8, Math.min(menu.x, window.innerWidth - bounds.width - 8))}px`;
    menuRef.current.style.top = `${Math.max(8, Math.min(menu.y, window.innerHeight - bounds.height - 8))}px`;
    menuRef.current.querySelector("button")?.focus();
  }, [menu]);

  const actions = [
    ...(menu?.canReply ? [["reply", text.reply]] : []),
    ...(menu?.canForward ? [["forward", text.forward]] : []),
    ...(menu?.canSave ? [["save", text.saveToSavedMessages]] : []),
    ...(menu?.canEdit ? [["edit", text.edit]] : []),
    ...(menu?.canDelete ? [["delete", text.remove]] : [])
  ];

  return (
    <div ref={menuRef} id="message-context-menu" className="message-context-menu" role="menu" hidden={!menu}>
      {menu?.canReact && (
        <div className="context-reaction-picker" role="group" aria-label={language === "ru" ? "Добавить реакцию" : "Add reaction"}>
          {MESSAGE_REACTION_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              role="menuitem"
              aria-label={emoji}
              onClick={() => {
                const messageId = menu.message.id;
                setMenu(null);
                document.dispatchEvent(new CustomEvent("polus:message-react", {
                  detail: { messageId, emoji }
                }));
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
      {actions.map(([action, label]) => (
        <button
          key={action}
          type="button"
          role="menuitem"
          onClick={() => {
            const message = menu.message;
            setMenu(null);
            document.dispatchEvent(new CustomEvent(`polus:${action}-message`, { detail: { message } }));
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function ToastNotice() {
  const [notice, setNotice] = useState(null);

  useLayoutEffect(() => {
    const show = (event) => setNotice({ message: event.detail, id: {} });
    const dismiss = () => setNotice(null);
    document.addEventListener("polus:notify", show);
    document.addEventListener("polus:dismiss-notice", dismiss);
    return () => {
      document.removeEventListener("polus:notify", show);
      document.removeEventListener("polus:dismiss-notice", dismiss);
    };
  }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  return <div id="toast" className="toast" role="status" hidden={!notice}>{notice?.message}</div>;
}

function AttachmentPreview({ attachments, language, onRemove, disabled }) {
  return (
    <div id="attachment-preview" className="attachment-preview" hidden={attachments.length === 0}>
      {attachments.map((attachment, index) => (
        <div className="pending-attachment" key={`${attachment.file.name}-${index}`}>
          {attachment.previewUrl && <img src={attachment.previewUrl} alt="" />}
          <span>{attachment.file.name}</span>
          <button
            type="button"
            className="text-button"
            aria-label={language === "ru" ? "Удалить" : "Remove"}
            disabled={disabled}
            onClick={() => onRemove(index)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

function UploadStatus({ upload, language, onCancel }) {
  return (
    <>
      <span id="upload-progress" className="upload-progress" hidden={!upload.active}>{upload.text}</span>
      <button
        id="cancel-upload"
        className="text-button"
        type="button"
        hidden={!upload.active}
        onClick={onCancel}
      >
        {language === "ru" ? "Отменить загрузку" : "Cancel upload"}
      </button>
    </>
  );
}

function DiscoverySearchResults({ query, conversations, onOpenConversation }) {
  const [results, setResults] = useState({ users: [], channels: [], groups: [] });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState("");
  const language = useCurrentLanguage();
  const normalizedQuery = query.trim().replace(/^@/, "");

  useEffect(() => {
    let active = true;
    setError("");
    if (normalizedQuery.length < 2) {
      setResults({ users: [], channels: [], groups: [] });
      setLoading(false);
      return () => { active = false; };
    }

    setResults({ users: [], channels: [], groups: [] });
    setLoading(true);
    const timer = setTimeout(() => {
      requestJson(`/api/discover?q=${encodeURIComponent(query)}`)
        .then((result) => {
          if (active) setResults(result);
        })
        .catch((cause) => {
          if (active) {
            setResults({ users: [], channels: [], groups: [] });
            setError(cause.message);
          }
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [normalizedQuery, query]);

  const joinOrOpen = async (item) => {
    setBusyId(item.id);
    try {
      if (item.joined) {
        const existing = conversations.find((conversation) => conversation.id === item.id);
        const { chat } = existing
          ? { chat: existing }
          : await requestJson(`/api/chats/${encodeURIComponent(item.id)}`);
        onOpenConversation(chat);
      } else {
        const chat = await requestJson(`/api/${item.type === "channel" ? "channels" : "groups"}/${encodeURIComponent(item.id)}/join`, {
          method: "POST"
        });
        onOpenConversation(chat);
      }
    } catch (cause) {
      document.dispatchEvent(new CustomEvent("polus:notify", { detail: cause.message }));
    } finally {
      setBusyId("");
    }
  };

  const renderCommunityResults = (items) => items.map((item) => (
    <div className="user-result discovery-result" key={item.id}>
      <span className={`result-avatar discovery-avatar avatar-tone-${avatarTone(item.id)}`} aria-hidden="true">
        {initials(item.name)}
      </span>
      <span className="result-copy">
        <strong>{item.name}</strong>
        <small>{item.description || (language === "ru" ? "Участников" : "Members")} · {item.memberCount}</small>
      </span>
      <button
        className="discovery-action"
        type="button"
        disabled={busyId === item.id}
        onClick={() => void joinOrOpen(item)}
      >
        {busyId === item.id ? "…" : item.joined
          ? (language === "ru" ? "Открыть" : "Open")
          : (language === "ru" ? "Вступить" : "Join")}
      </button>
    </div>
  ));
  const isAlreadyJoined = (item) => conversations.some((conversation) =>
    conversation.id === item.id && conversation.joined !== false);
  const channels = results.channels.filter((item) => !isAlreadyJoined(item));
  const groups = results.groups.filter((item) => !isAlreadyJoined(item));
  const hasResults = results.users.length + channels.length + groups.length > 0;

  return (
    <div className="user-results discovery-results" aria-live="polite">
      {loading && <div className="no-results">{language === "ru" ? "Ищем…" : "Searching…"}</div>}
      {error && <div className="no-results" role="alert">{error}</div>}
      {!loading && !error && !hasResults && (
        <div className="no-results">{language === "ru" ? "Ничего не найдено." : "No results found."}</div>
      )}
      {!loading && results.users.length > 0 && (
        <section>
          <h3 className="discovery-heading">{language === "ru" ? "Люди" : "People"}</h3>
          {results.users.map((user) => (
          <button
            key={user.id}
            className="user-result"
            type="button"
            onClick={() => document.dispatchEvent(new CustomEvent("polus:request-direct-message", {
              detail: { username: user.username }
            }))}
          >
            <span className={`result-avatar avatar-tone-${avatarTone(user.id)}`}>
              {user.avatarUrl ? <AuthenticatedImage src={user.avatarUrl} alt="" /> : initials(user.fullName)}
            </span>
            <span className="result-copy">
              <strong>{user.fullName}</strong>
              <small>@{user.username}</small>
            </span>
          </button>
          ))}
        </section>
      )}
      {!loading && channels.length > 0 && (
        <section>
          <h3 className="discovery-heading">{language === "ru" ? "Публичные каналы" : "Public channels"}</h3>
          {renderCommunityResults(channels)}
        </section>
      )}
      {!loading && groups.length > 0 && (
        <section>
          <h3 className="discovery-heading">{language === "ru" ? "Публичные группы" : "Public groups"}</h3>
          {renderCommunityResults(groups)}
        </section>
      )}
    </div>
  );
}

function ContactsPage({ onBack }) {
  const language = useCurrentLanguage();
  const russian = language === "ru";
  const [contacts, setContacts] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [menuId, setMenuId] = useState("");

  const loadContacts = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setContacts(await requestJson("/api/contacts"));
    } catch (cause) {
      showError(cause);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadContacts();
    const refresh = () => void loadContacts();
    document.addEventListener("polus:contacts-changed", refresh);
    return () => document.removeEventListener("polus:contacts-changed", refresh);
  }, [loadContacts]);

  const visibleContacts = contacts.filter((contact) =>
    `${contact.fullName} ${contact.username}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const openChat = (contact) => document.dispatchEvent(new CustomEvent("polus:request-direct-message", {
    detail: { username: contact.username }
  }));
  const removeContact = async (contact) => {
    try {
      await requestJson(`/api/contacts/${encodeURIComponent(contact.username)}`, { method: "DELETE" });
      setContacts((current) => current.filter((item) => item.id !== contact.id));
      document.dispatchEvent(new CustomEvent("polus:contacts-changed"));
      document.dispatchEvent(new CustomEvent("polus:notify", {
        detail: russian ? "Контакт удалён." : "Contact removed."
      }));
    } catch (cause) {
      showError(cause);
    }
  };
  const activity = (contact) => {
    if (contact.online) return russian ? "В сети" : "Online";
    if (!contact.lastSeenAt) return "";
    return `${russian ? "Был(а)" : "Last seen"} ${new Intl.DateTimeFormat(
      russian ? "ru-RU" : "en-US",
      { dateStyle: "short", timeStyle: "short" }
    ).format(new Date(contact.lastSeenAt))}`;
  };

  return (
    <main className="contacts-page">
      <header className="contacts-page-header">
        <button className="icon-button profile-page-back" type="button" onClick={onBack}>
          <span aria-hidden="true">←</span>{russian ? "Назад" : "Back"}
        </button>
        <h1>{russian ? "Контакты" : "Contacts"}</h1>
      </header>
      <section className="contacts-content">
        <div className="contacts-toolbar">
          <label className="contacts-search">
            <span className="visually-hidden">{russian ? "Поиск по контактам" : "Search contacts"}</span>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="10.8" cy="10.8" r="6.3" /><path d="m15.4 15.4 4.1 4.1" />
            </svg>
            <input
              type="search"
              value={query}
              placeholder={russian ? "Поиск по контактам" : "Search contacts"}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <span className="contacts-count">{contacts.length} {russian ? "контактов" : "contacts"}</span>
          <button className="primary-button" type="button" onClick={() =>
            document.dispatchEvent(new CustomEvent("polus:open-user-picker", { detail: { mode: "add-contact" } }))}>
            {russian ? "Добавить контакт" : "Add contact"}
          </button>
        </div>
        {loading ? (
          <p className="contacts-empty">{russian ? "Загрузка контактов…" : "Loading contacts…"}</p>
        ) : error && contacts.length === 0 ? (
          <div className="contacts-load-error" role="alert">
            <p>{error}</p>
            <button className="text-button" type="button" onClick={() => void loadContacts()}>
              {russian ? "Повторить" : "Retry"}
            </button>
          </div>
        ) : contacts.length === 0 ? (
          <section className="contacts-empty-state">
            <span className="contacts-empty-icon" aria-hidden="true">◎</span>
            <h2>{russian ? "Контактов пока нет" : "No contacts yet"}</h2>
            <p>{russian ? "Найдите человека и добавьте его в контакты." : "Find someone and add them to your contacts."}</p>
            <button className="primary-button" type="button" onClick={() =>
              document.dispatchEvent(new CustomEvent("polus:open-user-picker", { detail: { mode: "add-contact" } }))}>
              {russian ? "Найти человека" : "Find someone"}
            </button>
          </section>
        ) : visibleContacts.length === 0 ? (
          <p className="contacts-empty">{russian ? "Контакты не найдены." : "No contacts found."}</p>
        ) : (
          <div className="contacts-list">
            {visibleContacts.map((contact) => (
              <article className="contact-row" key={contact.id}>
                <button className="contact-identity" type="button" onClick={() =>
                  document.dispatchEvent(new CustomEvent("polus:open-profile", { detail: { username: contact.username } }))}>
                  <span className={`contact-avatar avatar-tone-${avatarTone(contact.id)}`}>
                    {contact.avatarUrl
                      ? <AuthenticatedImage src={contact.avatarUrl} alt="" />
                      : initials(contact.fullName)}
                    {contact.online && <i className="contact-online-dot" aria-label={russian ? "В сети" : "Online"} />}
                  </span>
                  <span className="contact-copy">
                    <strong>{contact.fullName}</strong>
                    <small>@{contact.username}{activity(contact) ? ` · ${activity(contact)}` : ""}</small>
                  </span>
                </button>
                <button className="text-button contact-message-action" type="button" disabled={contact.blocked} onClick={() => openChat(contact)}>
                  {russian ? "Написать" : "Message"}
                </button>
                <div className="contact-more">
                  <button className="contact-more-trigger" type="button" aria-label={russian ? "Действия с контактом" : "Contact actions"}
                    aria-expanded={menuId === contact.id} onClick={() => setMenuId((current) => current === contact.id ? "" : contact.id)}>
                    ···
                  </button>
                  {menuId === contact.id && (
                    <div className="contact-context-menu" role="menu">
                      <button type="button" role="menuitem" onClick={() => {
                        setMenuId("");
                        document.dispatchEvent(new CustomEvent("polus:open-profile", { detail: { username: contact.username } }));
                      }}>{russian ? "Открыть профиль" : "Open profile"}</button>
                      <button type="button" role="menuitem" onClick={() => {
                        setMenuId("");
                        document.dispatchEvent(new CustomEvent("polus:open-contact-share", { detail: { username: contact.username, type: "group" } }));
                      }} disabled={contact.blocked}>{russian ? "Добавить в группу" : "Add to group"}</button>
                      <button type="button" role="menuitem" onClick={() => {
                        setMenuId("");
                        document.dispatchEvent(new CustomEvent("polus:open-contact-share", { detail: { username: contact.username, type: "channel" } }));
                      }} disabled={contact.blocked}>{russian ? "Пригласить в канал" : "Invite to channel"}</button>
                      <button type="button" role="menuitem" onClick={() => {
                        setMenuId("");
                        void removeContact(contact);
                      }}>{russian ? "Удалить из контактов" : "Remove contact"}</button>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
        {error && contacts.length > 0 && <div className="form-error" role="alert">{error}</div>}
      </section>
    </main>
  );
}

function UserPicker() {
  const dialogRef = useRef(null);
  const searchRef = useRef(null);
  const configRef = useRef(null);
  const openRequestRef = useRef(0);
  const [config, setConfig] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [users, setUsers] = useState([]);
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const language = useCurrentLanguage();
  const russian = language === "ru";
  configRef.current = config;
  const excludedIds = new Set(config?.excludeUserIds || []);
  const eligibleContacts = contacts.filter((contact) => !contact.blocked && !excludedIds.has(contact.id)
    && `${contact.fullName} ${contact.username}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  useEffect(() => {
    const open = async (event) => {
      const next = event.detail || {};
      const requestId = ++openRequestRef.current;
      setConfig(next);
      setQuery("");
      setSelectedIds([]);
      setError("");
      setInviteUrl("");
      setUsers([]);
      if (!dialogRef.current?.open) dialogRef.current?.showModal();
      document.dispatchEvent(new CustomEvent("polus:dialog-open-state", { detail: { id: "user-picker-dialog", open: true } }));
      if (next.mode !== "add-contact") {
        try {
          const nextContacts = await requestJson("/api/contacts");
          if (openRequestRef.current === requestId) setContacts(nextContacts);
        } catch (cause) {
          if (openRequestRef.current === requestId) setError(cause.message);
        }
      }
      window.setTimeout(() => searchRef.current?.focus(), 0);
    };
    const close = () => {
      openRequestRef.current += 1;
      dialogRef.current?.close();
    };
    const contactsChanged = () => {
      if (dialogRef.current?.open && configRef.current?.mode !== "add-contact") {
        void requestJson("/api/contacts").then((nextContacts) => {
          setContacts(nextContacts);
          const availableIds = new Set(nextContacts.map((contact) => contact.id));
          setSelectedIds((current) => current.filter((id) => availableIds.has(id)));
        }).catch((cause) => setError(cause.message));
      }
    };
    document.addEventListener("polus:open-user-picker", open);
    document.addEventListener("polus:contacts-changed", contactsChanged);
    document.addEventListener("polus:close-user-picker", close);
    return () => {
      openRequestRef.current += 1;
      document.removeEventListener("polus:open-user-picker", open);
      document.removeEventListener("polus:contacts-changed", contactsChanged);
      document.removeEventListener("polus:close-user-picker", close);
    };
  }, []);

  useEffect(() => {
    if (!config || config.mode !== "add-contact") return undefined;
    const normalized = query.trim().replace(/^@/, "");
    if (normalized.length < 2) {
      setUsers([]);
      return undefined;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      requestJson(`/api/users?q=${encodeURIComponent(query)}`)
        .then((result) => { if (active) setUsers(result); })
        .catch((cause) => { if (active) setError(cause.message); });
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [config, query]);

  const close = () => {
    openRequestRef.current += 1;
    dialogRef.current?.close();
    document.dispatchEvent(new CustomEvent("polus:dialog-open-state", { detail: { id: "user-picker-dialog", open: false } }));
  };
  const toggle = (id) => setSelectedIds((current) =>
    current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const selectedContacts = contacts.filter((contact) => selectedIds.includes(contact.id));
  const confirm = async () => {
    if (!config || !selectedIds.length) return;
    setBusy(true);
    setError("");
    try {
      if (config.mode === "add-contact") {
        const selected = users.find((item) => item.id === selectedIds[0]);
        if (!selected) return;
        await requestJson(`/api/contacts/${encodeURIComponent(selected.username)}`, { method: "PUT" });
        document.dispatchEvent(new CustomEvent("polus:contacts-changed"));
        document.dispatchEvent(new CustomEvent("polus:notify", { detail: russian ? "Контакт добавлен." : "Contact added." }));
        close();
      } else if (config.mode === "public-channel") {
        const result = await requestJson(`/api/chats/${encodeURIComponent(config.chatId)}/invite`, { method: "POST" });
        const url = `${window.location.origin}${result.inviteUrl}`;
        setInviteUrl(url);
        try {
          await navigator.clipboard.writeText(url);
          document.dispatchEvent(new CustomEvent("polus:notify", {
            detail: russian ? "Ссылка-приглашение скопирована. Отправьте её выбранным контактам." : "Invite link copied. Share it with the selected contacts."
          }));
          close();
        } catch {
          setError(russian ? "Скопируйте ссылку и отправьте её выбранным контактам." : "Copy this link and share it with the selected contacts.");
        }
      } else {
        await requestJson(`/api/chats/${encodeURIComponent(config.chatId)}/members`, {
          method: "POST",
          body: JSON.stringify({ usernames: selectedContacts.map((contact) => contact.username) })
        });
        document.dispatchEvent(new CustomEvent("polus:notify", {
          detail: russian ? `Добавлено участников: ${selectedContacts.length}.` : `Added ${selectedContacts.length} member(s).`
        }));
        close();
      }
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  };

  const mode = config?.mode;
  const multiSelect = mode !== "add-contact";
  const title = mode === "add-contact"
    ? (russian ? "Добавить контакт" : "Add contact")
    : (russian ? "Выберите контакты" : "Select contacts");
  const usersToShow = users.filter((item) => !excludedIds.has(item.id));

  return (
    <dialog
      id="user-picker-dialog"
      className="dialog user-picker-dialog"
      ref={dialogRef}
      onClose={() => {
        openRequestRef.current += 1;
        document.dispatchEvent(new CustomEvent("polus:dialog-open-state", {
          detail: { id: "user-picker-dialog", open: false }
        }));
      }}
    >
      <div className="dialog-top">
        <div><div className="eyebrow">{russian ? "КОНТАКТЫ" : "CONTACTS"}</div><h2>{title}</h2></div>
        <button className="icon-button dialog-close" type="button" aria-label={russian ? "Закрыть" : "Close"} onClick={close}>×</button>
      </div>
      <label className="visually-hidden" htmlFor="user-picker-search">{russian ? "Поиск" : "Search"}</label>
      <input
        id="user-picker-search"
        ref={searchRef}
        className="text-field"
        type="search"
        autoComplete="off"
        placeholder={mode === "add-contact"
          ? (russian ? "Имя или @username" : "Name or @username")
          : (russian ? "Поиск по контактам" : "Search contacts")}
        value={query}
        onChange={(event) => {
          setError("");
          if (mode === "add-contact") {
            setUsers([]);
            setSelectedIds([]);
          }
          setQuery(event.target.value);
        }}
      />
      {mode === "public-channel" && (
        <p className="user-picker-hint">{russian
          ? "Публичный канал принимает подписчиков по ссылке. Выберите контакты, чтобы подготовить приглашение."
          : "Public channels use invite links. Select contacts to prepare an invitation."}</p>
      )}
      {mode === "add-contact" ? (
        <div className="user-picker-list">
          {query.trim().replace(/^@/, "").length < 2
            ? <p className="contacts-empty">{russian ? "Введите не менее двух символов." : "Enter at least two characters."}</p>
            : usersToShow.length === 0
              ? <p className="contacts-empty">{russian ? "Пользователи не найдены." : "No users found."}</p>
              : usersToShow.map((user) => (
                <div className="user-picker-row" key={user.id}>
                  <input type="radio" name="user-picker-selection" checked={!user.isContact && selectedIds[0] === user.id}
                    disabled={user.isContact}
                    aria-label={`${user.fullName} @${user.username}`}
                    onChange={() => setSelectedIds([user.id])} />
                  <span className={`result-avatar avatar-tone-${avatarTone(user.id)}`}>
                    {user.avatarUrl ? <AuthenticatedImage src={user.avatarUrl} alt="" /> : initials(user.fullName)}
                  </span>
                  <span className="result-copy"><strong>{user.fullName}</strong><small>@{user.username}</small></span>
                  {user.isContact && <small>{russian ? "Уже в контактах" : "Already a contact"}</small>}
                  <button className="text-button" type="button" onClick={() => {
                    close();
                    window.setTimeout(() => document.dispatchEvent(new CustomEvent("polus:open-profile", {
                      detail: { username: user.username }
                    })), 0);
                  }}>{russian ? "Профиль" : "Profile"}</button>
                </div>
              ))}
        </div>
      ) : (
        <div className="user-picker-list">
          {eligibleContacts.length === 0
            ? <div className="contacts-picker-empty">
              <p>{contacts.length === 0
                ? (error
                  ? (russian ? "Не удалось загрузить контакты." : "Unable to load contacts.")
                  : (russian ? "Сначала добавьте пользователей в контакты." : "Add people to your contacts first."))
                : (russian ? "Подходящих контактов нет." : "No eligible contacts found.")}</p>
              <button className="text-button" type="button" onClick={() => {
                close();
                document.dispatchEvent(new CustomEvent("polus:open-user-picker", { detail: { mode: "add-contact" } }));
              }}>{russian ? "Добавить контакт" : "Add contact"}</button>
            </div>
            : eligibleContacts.map((contact) => (
              <label className="user-picker-row" key={contact.id}>
                <input type="checkbox" checked={selectedIds.includes(contact.id)} onChange={() => toggle(contact.id)} />
                <span className={`result-avatar avatar-tone-${avatarTone(contact.id)}`}>
                  {contact.avatarUrl ? <AuthenticatedImage src={contact.avatarUrl} alt="" /> : initials(contact.fullName)}
                </span>
                <span className="result-copy"><strong>{contact.fullName}</strong><small>@{contact.username}</small></span>
              </label>
            ))}
        </div>
      )}
      {inviteUrl && <input className="text-field" readOnly value={inviteUrl} onFocus={(event) => event.currentTarget.select()} />}
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="user-picker-footer">
        {multiSelect && <span>{russian ? `Выбрано: ${selectedIds.length}` : `Selected: ${selectedIds.length}`}</span>}
        <button className="primary-button" type="button" disabled={busy || selectedIds.length === 0} onClick={() => void confirm()}>
          {busy ? "…" : mode === "add-contact"
            ? (russian ? "Добавить в контакты" : "Add to contacts")
            : mode === "public-channel"
              ? (russian ? "Создать ссылку" : "Create invite link")
              : config?.chatType === "channel"
                ? (russian ? "Пригласить в канал" : "Invite to channel")
                : (russian ? "Добавить в группу" : "Add to group")}
        </button>
      </div>
    </dialog>
  );
}

function ContactShareDialog() {
  const dialogRef = useRef(null);
  const requestIdRef = useRef(0);
  const [target, setTarget] = useState(null);
  const [chats, setChats] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const language = useCurrentLanguage();
  const russian = language === "ru";

  useEffect(() => {
    const open = async (event) => {
      const next = event.detail || {};
      const requestId = ++requestIdRef.current;
      setTarget(next);
      setSelectedId("");
      setError("");
      setInviteUrl("");
      if (!dialogRef.current?.open) dialogRef.current?.showModal();
      document.dispatchEvent(new CustomEvent("polus:dialog-open-state", { detail: { id: "contact-share-dialog", open: true } }));
      try {
        const [profile, bootstrap] = await Promise.all([
          requestJson(`/api/users/${encodeURIComponent(next.username)}/profile`),
          requestJson("/api/bootstrap")
        ]);
        if (requestIdRef.current !== requestId) return;
        if (profile.user.blocked || !profile.canMessage) {
          setError(russian ? "Это действие недоступно для этого пользователя." : "This action is unavailable for this user.");
          setChats([]);
          return;
        }
        const source = next.type === "group" ? bootstrap.directs : bootstrap.channels;
        setChats(source.filter((chat) => (next.type === "group" ? chat.type === "group" : chat.type === "channel")
          && chat.joined !== false && ["owner", "admin"].includes(chat.role)
          && !chat.memberIds.includes(profile.user.id)));
      } catch (cause) {
        if (requestIdRef.current === requestId) setError(cause.message);
      }
    };
    const close = () => {
      requestIdRef.current += 1;
      dialogRef.current?.close();
    };
    document.addEventListener("polus:open-contact-share", open);
    document.addEventListener("polus:close-contact-share", close);
    return () => {
      requestIdRef.current += 1;
      document.removeEventListener("polus:open-contact-share", open);
      document.removeEventListener("polus:close-contact-share", close);
    };
  }, [language, russian]);

  const close = () => {
    requestIdRef.current += 1;
    dialogRef.current?.close();
    document.dispatchEvent(new CustomEvent("polus:dialog-open-state", { detail: { id: "contact-share-dialog", open: false } }));
  };
  const confirm = async () => {
    const chat = chats.find((item) => item.id === selectedId);
    if (!chat || !target) return;
    setBusy(true);
    setError("");
    try {
      if (target.type === "channel" && !chat.isPrivate) {
        const result = await requestJson(`/api/chats/${encodeURIComponent(chat.id)}/invite`, { method: "POST" });
        const url = `${window.location.origin}${result.inviteUrl}`;
        setInviteUrl(url);
        try {
          await navigator.clipboard.writeText(url);
          document.dispatchEvent(new CustomEvent("polus:notify", {
            detail: russian ? "Ссылка скопирована. Отправьте её контакту." : "Invite link copied. Share it with the contact."
          }));
          close();
        } catch {
          setError(russian ? "Скопируйте ссылку и отправьте её контакту." : "Copy this link and share it with the contact.");
        }
      } else {
        await requestJson(`/api/chats/${encodeURIComponent(chat.id)}/members`, {
          method: "POST",
          body: JSON.stringify({ usernames: [target.username] })
        });
        document.dispatchEvent(new CustomEvent("polus:notify", {
          detail: target.type === "group"
            ? (russian ? "Контакт добавлен в группу." : "Contact added to the group.")
            : (russian ? "Контакт приглашён в канал." : "Contact invited to the channel.")
        }));
        close();
      }
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog id="contact-share-dialog" className="dialog user-picker-dialog" ref={dialogRef}
      onClose={() => {
        requestIdRef.current += 1;
        document.dispatchEvent(new CustomEvent("polus:dialog-open-state", {
          detail: { id: "contact-share-dialog", open: false }
        }));
      }}>
      <div className="dialog-top">
        <div><div className="eyebrow">{russian ? "КОНТАКТЫ" : "CONTACTS"}</div>
          <h2>{target?.type === "group" ? (russian ? "Добавить в группу" : "Add to group") : (russian ? "Пригласить в канал" : "Invite to channel")}</h2>
          {target && <p className="user-picker-hint">{target.username}</p>}
        </div>
        <button className="icon-button dialog-close" type="button" aria-label={russian ? "Закрыть" : "Close"} onClick={close}>×</button>
      </div>
      {inviteUrl && <input className="text-field" readOnly value={inviteUrl} onFocus={(event) => event.currentTarget.select()} />}
      <div className="user-picker-list">
        {chats.length === 0
          ? <p className="contacts-empty">{error || (russian ? "Нет доступных чатов для этого действия." : "No chats are available for this action.")}</p>
          : chats.map((chat) => (
            <label className="user-picker-row" key={chat.id}>
              <input type="radio" name="contact-share-chat" checked={selectedId === chat.id}
                onChange={() => setSelectedId(chat.id)} />
              <span className="discovery-avatar avatar-tone-5">{initials(chat.name)}</span>
              <span className="result-copy"><strong>{chat.name}</strong>
                <small>{chat.type === "channel" && !chat.isPrivate
                  ? (russian ? "Публичный канал · приглашение по ссылке" : "Public channel · invite by link")
                  : chat.type === "channel" ? (russian ? "Канал" : "Channel") : (russian ? "Группа" : "Group")}</small>
              </span>
            </label>
          ))}
      </div>
      {error && chats.length > 0 && <div className="form-error" role="alert">{error}</div>}
      <div className="user-picker-footer">
        <button className="primary-button" type="button" disabled={busy || !selectedId} onClick={() => void confirm()}>
          {busy ? "…" : russian ? "Продолжить" : "Continue"}
        </button>
      </div>
    </dialog>
  );
}

function UserProfileContent({ username, currentUserId, currentUsername, onBack }) {
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState("");
  const [showAllSharedChats, setShowAllSharedChats] = useState(false);
  const [showAllSharedMedia, setShowAllSharedMedia] = useState(false);
  const profilePageRef = useRef(null);
  const language = useCurrentLanguage();
  const russian = language === "ru";

  useEffect(() => {
    const onProfile = (event) => {
      if (event.detail.user?.username?.toLowerCase() !== username.toLowerCase()) return;
      setProfile(event.detail);
      setError("");
      setShowAllSharedChats(false);
      setShowAllSharedMedia(false);
    };
    const onProfileError = (event) => {
      if (event.detail.username?.toLowerCase() === username.toLowerCase()) {
        setProfile(null);
        setError(event.detail.message);
      }
    };
    document.addEventListener("polus:user-profile-changed", onProfile);
    document.addEventListener("polus:user-profile-error", onProfileError);
    const timer = window.setTimeout(() => {
      document.dispatchEvent(new CustomEvent("polus:load-user-profile", { detail: { username } }));
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("polus:user-profile-changed", onProfile);
      document.removeEventListener("polus:user-profile-error", onProfileError);
    };
  }, [username]);

  useEffect(() => {
    const page = profilePageRef.current;
    if (!page || !profile?.user.profileDesign?.coverParallax || !profile.user.profileDesign.motionEnabled
      || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
    let frame = 0;
    const updateParallax = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        page.style.setProperty("--profile-parallax-offset", `${Math.min(page.scrollTop, 320) * 0.14}px`);
      });
    };
    page.addEventListener("scroll", updateParallax, { passive: true });
    return () => {
      page.removeEventListener("scroll", updateParallax);
      if (frame) window.cancelAnimationFrame(frame);
      page.style.removeProperty("--profile-parallax-offset");
    };
  }, [profile?.user.profileDesign?.coverParallax, profile?.user.profileDesign?.motionEnabled]);

  const backButton = (
    <button className="icon-button profile-page-back" type="button" onClick={onBack}>
      <span aria-hidden="true">←</span>{russian ? "Назад" : "Back"}
    </button>
  );
  if (!profile) {
    return (
      <main className="public-profile-page">
        <header className="public-profile-toolbar">{backButton}<span>ПОЛЮС</span></header>
        <div className="public-profile-state" role={error ? "alert" : "status"}>
          {error || (russian ? "Загрузка профиля…" : "Loading profile…")}
        </div>
      </main>
    );
  }
  const { user, sharedChats, sharedMedia, canMessage, labels, status, registered, muted } = profile;
  const design = { ...DEFAULT_PROFILE_DESIGN, ...(user.profileDesign || {}) };
  const ownProfile = user.id === currentUserId
    || user.username?.toLocaleLowerCase() === currentUsername?.toLocaleLowerCase();
  const visibleSharedChats = showAllSharedChats ? sharedChats : sharedChats.slice(0, 4);
  const visibleSharedMedia = showAllSharedMedia ? sharedMedia : sharedMedia.slice(0, 8);
  const trigger = (action) => document.dispatchEvent(new CustomEvent("polus:user-profile-action", {
    detail: { action, username: user.username }
  }));
  const shareProfile = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: user.fullName, url });
      else {
        await navigator.clipboard.writeText(url);
        document.dispatchEvent(new CustomEvent("polus:notify", {
          detail: russian ? "Ссылка на профиль скопирована." : "Profile link copied."
        }));
      }
    } catch (cause) {
      if (cause.name !== "AbortError") {
        document.dispatchEvent(new CustomEvent("polus:notify", {
          detail: russian ? "Не удалось поделиться профилем." : "Unable to share this profile."
        }));
      }
    }
  };
  const confirmBlock = () => {
    if (window.confirm(russian
      ? `Заблокировать пользователя @${user.username}?`
      : `Block @${user.username}?`)) {
      trigger("toggle-block");
    }
  };
  return (
    <main
      ref={profilePageRef}
      className={`public-profile-page profile-theme-${design.theme} profile-font-${design.font} profile-effects-${design.effects} profile-animation-${design.animation}${design.motionEnabled ? "" : " reduce-profile-motion"}`}
      style={{
        "--profile-accent": design.accentColor,
        "--profile-gradient-start": design.gradientStart,
        "--profile-gradient-end": design.gradientEnd,
        "--profile-gradient-angle": design.gradientDirection === "horizontal" ? "90deg" : design.gradientDirection === "vertical" ? "180deg" : "145deg"
      }}
    >
      {design.backgroundImageEnabled && user.profileCoverUrl && (
        <AuthenticatedImage className="public-profile-backdrop" src={user.profileCoverUrl} alt="" aria-hidden="true" />
      )}
      <header className="public-profile-toolbar">{backButton}<span>ПОЛЮС</span></header>
      <div className="public-profile-content">
        <section className="public-profile-card">
          <div className="public-profile-cover">
            {user.profileCoverUrl && user.profileCoverMimeType?.startsWith("video/")
              ? <AuthenticatedVideo src={user.profileCoverUrl} aria-hidden="true" autoPlay muted loop playsInline />
              : user.profileCoverUrl
                ? <AuthenticatedImage src={user.profileCoverUrl} alt="" aria-hidden="true" />
                : <div className="public-profile-cover-art" aria-hidden="true" />}
            <div className="public-profile-cover-glow" aria-hidden="true" />
            {design.effects === "particles" && <div className="public-profile-particles" aria-hidden="true" />}
          </div>
          <div className="public-profile-main">
            <div className={`public-profile-avatar profile-avatar-frame-${design.avatarFrame}`}>
              {user.avatarUrl ? <AuthenticatedImage src={user.avatarUrl} alt="" /> : initials(user.fullName)}
            </div>
            <div className="public-profile-identity">
              <div>
                <h1>{user.fullName}</h1>
                <span className="user-profile-handle">@{user.username}</span>
              </div>
              {status && <span className={`user-profile-status${user.online ? " is-online" : ""}`}>{status}</span>}
              {registered && <span className="user-profile-joined">{labels.registered}: {registered}</span>}
            </div>
            <div className="public-profile-actions">
              {ownProfile
                ? <button className="primary-button" type="button" onClick={() => document.dispatchEvent(new CustomEvent("polus:open-own-profile", { detail: { section: "appearance" } }))}>
                  {russian ? "Настроить профиль" : "Customize profile"}
                </button>
                : canMessage && <button className="primary-button" type="button" onClick={() => trigger("message")}>
                  {labels.writeToUser}
                </button>}
              <button className="secondary-button" type="button" onClick={() => void shareProfile()}>
                {russian ? "Поделиться" : "Share"}
              </button>
              {!ownProfile && canMessage && <button className="secondary-button" type="button" onClick={() => trigger("toggle-contact")}>
                {user.isContact ? labels.removeContact : labels.addContact}
              </button>}
              {!ownProfile && !user.blocked && (
                <details className="profile-more-actions">
                  <summary>{russian ? "Дополнительно" : "More"}</summary>
                  <div className="profile-more-menu">
                    <button className="danger-button" type="button" onClick={confirmBlock}>{labels.blockUser}</button>
                    {muted !== null && <button className="text-button" type="button" onClick={() => trigger("toggle-mute")}>
                      {muted ? labels.unmuteChat : labels.muteChat}
                    </button>}
                  </div>
                </details>
              )}
            </div>
          </div>
          {user.blocked && (
            <div className="user-profile-blocked" role="status">
              <span>{labels.blockedInfo}</span>
              <button className="text-button" type="button" onClick={() => trigger("toggle-block")}>{labels.unblockUser}</button>
            </div>
          )}
          {user.about && (
            <section className="public-profile-section">
              <h2>{labels.about}</h2>
              <p className="profile-about-copy">{user.about}</p>
            </section>
          )}
          {sharedChats.length > 0 && (
            <section className="public-profile-section">
              <div className="profile-shared-heading">
                <h2>{labels.sharedChats}</h2>
                {sharedChats.length > 4 && (
                  <button className="text-button" type="button" onClick={() => setShowAllSharedChats((value) => !value)}>
                    {showAllSharedChats ? labels.showLess : `${labels.showAll} (${sharedChats.length})`}
                  </button>
                )}
              </div>
              <div className="profile-shared-chats">
                {visibleSharedChats.map((chat) => (
                  <button
                    className="profile-shared-chat"
                    key={chat.id}
                    type="button"
                    onClick={() => document.dispatchEvent(new CustomEvent("polus:open-profile-community", {
                      detail: { id: chat.id, type: chat.type }
                    }))}
                  >
                    <span className={`profile-shared-chat-icon${chat.type === "channel" ? " is-channel" : ""}`}>
                      {chat.type === "channel" ? "#" : initials(chat.name)}
                    </span>
                    <span className="profile-shared-chat-copy">
                      <strong>{chat.name}</strong>
                      <small>{chat.type === "channel" ? labels.sharedChannel : labels.sharedGroup}</small>
                    </span>
                    <span className="profile-shared-chat-arrow" aria-hidden="true">›</span>
                  </button>
                ))}
              </div>
            </section>
          )}
          {sharedMedia.length > 0 && (
            <section className="public-profile-section">
              <div className="profile-shared-heading">
                <h2>{labels.sharedMedia}</h2>
                {sharedMedia.length > 8 && (
                  <button className="text-button" type="button" onClick={() => setShowAllSharedMedia((value) => !value)}>
                    {showAllSharedMedia ? labels.showLess : `${labels.showAll} (${sharedMedia.length})`}
                  </button>
                )}
              </div>
              <div className="media-grid profile-media-grid">
                {(showAllSharedMedia ? sharedMedia : sharedMedia.slice(0, 8)).map((attachment) => (
                  <AuthenticatedImage
                    key={attachment.id}
                    src={attachment.thumbnailUrl || `/api/attachments/${encodeURIComponent(attachment.id)}`}
                    alt={attachment.name}
                  />
                ))}
              </div>
            </section>
          )}
        </section>
      </div>
    </main>
  );
}

function ChatSearchResults() {
  const [snapshot, setSnapshot] = useState({ results: [], message: "" });

  useLayoutEffect(() => {
    const onResults = (event) => setSnapshot(event.detail);
    document.addEventListener("polus:chat-search-results", onResults);
    return () => document.removeEventListener("polus:chat-search-results", onResults);
  }, []);

  return (
    <div id="chat-search-results" className="user-results">
      {snapshot.results.length === 0
        ? <div className="no-results">{snapshot.message}</div>
        : snapshot.results.map((message) => (
          <button
            key={message.id}
            type="button"
            className="user-result"
            onClick={() => document.dispatchEvent(new CustomEvent("polus:open-searched-message", {
              detail: { messageId: message.id }
            }))}
          >
            <strong>{message.author.fullName}</strong>
            <span>{message.text}</span>
          </button>
        ))}
    </div>
  );
}

function ChatSearchDialog() {
  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const [query, setQuery] = useState("");
  const language = useCurrentLanguage();

  useLayoutEffect(() => {
    const open = () => {
      setQuery("");
      if (!dialogRef.current?.open) dialogRef.current?.showModal();
      inputRef.current?.focus();
      document.dispatchEvent(new CustomEvent("polus:search-chat", { detail: { query: "" } }));
    };
    const close = () => dialogRef.current?.close();
    document.addEventListener("polus:chat-search", open);
    document.addEventListener("polus:close-chat-search", close);
    return () => {
      document.removeEventListener("polus:chat-search", open);
      document.removeEventListener("polus:close-chat-search", close);
    };
  }, []);

  return (
    <dialog id="chat-search-dialog" className="dialog" ref={dialogRef}>
      <form method="dialog" className="dialog-top">
        <div>
          <div className="eyebrow">{language === "ru" ? "ПОИСК" : "SEARCH"}</div>
          <h2>{language === "ru" ? "Поиск по чату" : "Search in chat"}</h2>
        </div>
        <button className="icon-button dialog-close" value="cancel" aria-label="Close">×</button>
      </form>
      <input
        id="chat-search-input"
        ref={inputRef}
        className="text-field dialog-search"
        type="search"
        autoComplete="off"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          document.dispatchEvent(new CustomEvent("polus:search-chat", {
            detail: { query: event.target.value }
          }));
        }}
      />
      <ChatSearchResults />
    </dialog>
  );
}

function ForwardMessageDialog() {
  const [snapshot, setSnapshot] = useState(null);
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const language = useCurrentLanguage();
  const dialogRef = useRef(null);
  const searchRequestRef = useRef(0);
  const text = translations[language];

  useLayoutEffect(() => {
    const open = (event) => {
      setSnapshot(event.detail);
      setQuery("");
      setUsers([]);
      setUsersLoading(false);
      setBusy(false);
      if (!dialogRef.current?.open) dialogRef.current?.showModal();
      document.dispatchEvent(new CustomEvent("polus:dialog-open-state", {
        detail: { id: "forward-message-dialog", open: true }
      }));
    };
    document.addEventListener("polus:forward-dialog-open", open);
    return () => document.removeEventListener("polus:forward-dialog-open", open);
  }, []);

  useEffect(() => {
    const normalized = query.trim().replace(/^@/, "");
    const requestId = ++searchRequestRef.current;
    if (normalized.length < 2) {
      setUsers([]);
      setUsersLoading(false);
      return undefined;
    }
    setUsersLoading(true);
    const timer = window.setTimeout(() => {
      requestJson(`/api/users?q=${encodeURIComponent(normalized)}`)
        .then((results) => {
          if (searchRequestRef.current === requestId) {
            setUsers(results);
            setUsersLoading(false);
          }
        })
        .catch((error) => {
          if (searchRequestRef.current === requestId) {
            setUsersLoading(false);
            document.dispatchEvent(new CustomEvent("polus:notify", { detail: error.message }));
          }
        });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query]);

  async function forwardTo(destination) {
    if (!snapshot || busy) return;
    setBusy(true);
    try {
      await new Promise((resolve, reject) => {
        document.dispatchEvent(new CustomEvent("polus:forward-message-to-chat", {
          detail: { message: snapshot.message, messageId: snapshot.message.id, ...destination, resolve, reject }
        }));
      });
      dialogRef.current?.close();
    } catch (error) {
      document.dispatchEvent(new CustomEvent("polus:notify", { detail: error.message }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog id="forward-message-dialog" className="dialog forward-message-dialog" ref={dialogRef}>
      <form method="dialog" className="dialog-top">
        <div>
          <div className="eyebrow">{language === "ru" ? "СООБЩЕНИЕ" : "MESSAGE"}</div>
          <h2>{text.forwarding}</h2>
        </div>
        <button className="icon-button dialog-close" value="cancel" aria-label={language === "ru" ? "Закрыть" : "Close"}>×</button>
      </form>
      <div className="forward-source-preview">
        <strong>{snapshot?.message?.author?.fullName || snapshot?.message?.forwardedFrom?.authorName || ""}</strong>
        <span>{snapshot?.message?.text || snapshot?.message?.attachments?.map((attachment) => attachment.name).join(", ")}</span>
      </div>
      <label className="visually-hidden" htmlFor="forward-user-search">{text.searchUsersToForward}</label>
      <input
        id="forward-user-search"
        className="text-field dialog-search"
        type="search"
        autoComplete="off"
        placeholder={text.searchUsersToForward}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {users.length > 0 && (
        <section className="forward-target-section">
          <h3>{language === "ru" ? "Пользователи" : "Users"}</h3>
          <div className="forward-target-list">
            {users.map((user) => (
              <button
                type="button"
                className="forward-target"
                key={user.id}
                disabled={busy}
                onClick={() => void forwardTo({ recipientUsername: user.username })}
              >
                <span className="forward-target-avatar">
                  {user.avatarUrl ? <AuthenticatedImage src={user.avatarUrl} alt="" /> : initials(user.fullName)}
                </span>
                <span><strong>{user.fullName}</strong><small>@{user.username}</small></span>
              </button>
            ))}
          </div>
        </section>
      )}
      <section className="forward-target-section">
        <h3>{text.chooseChat}</h3>
        <div className="forward-target-list">
          {(snapshot?.chats || []).length === 0 && query.trim().length < 2
            ? <div className="no-results">{text.noForwardTargets}</div>
            : (snapshot?.chats || []).map((chat) => (
              <button
                type="button"
                className="forward-target"
                key={chat.id}
                disabled={busy}
                onClick={() => void forwardTo({ conversationId: chat.id })}
              >
                <span className={`forward-target-avatar${chat.type === "channel" ? " is-channel" : ""}`}>
                  {chat.avatarUrl
                    ? <AuthenticatedImage src={chat.avatarUrl} alt="" />
                    : chat.type === "saved"
                      ? <svg className="saved-bookmark-icon" viewBox="0 0 24 24"><path d="M6 3.75h12v17l-6-4-6 4z" /></svg>
                      : chat.type === "channel" ? "#" : initials(chat.name || "")}
                </span>
                <span><strong>{chat.type === "saved" ? text.savedMessages : chat.name}</strong><small>
                  {chat.type === "channel" ? (language === "ru" ? "Канал" : "Channel")
                    : chat.type === "group" ? (language === "ru" ? "Группа" : "Group")
                      : chat.type === "saved" ? text.savedMessagesCaption : (language === "ru" ? "Личный чат" : "Direct chat")}
                </small></span>
              </button>
            ))}
        </div>
      </section>
      {usersLoading && <div className="no-results">{language === "ru" ? "Поиск…" : "Searching…"}</div>}
      {query.trim().length >= 2 && !usersLoading && users.length === 0 && (
        <div className="no-results">{language === "ru" ? "Пользователи не найдены." : "No users found."}</div>
      )}
    </dialog>
  );
}

function ChatInfoDialogContent() {
  const [snapshot, setSnapshot] = useState(null);
  const language = useCurrentLanguage();

  useLayoutEffect(() => {
    const onInfo = (event) => setSnapshot(event.detail);
    document.addEventListener("polus:chat-info-changed", onInfo);
    return () => document.removeEventListener("polus:chat-info-changed", onInfo);
  }, []);
  const act = (action, detail = {}) => document.dispatchEvent(new CustomEvent("polus:chat-info-action", {
    detail: { action, conversationId: snapshot?.conversationId, ...detail }
  }));
  const response = snapshot?.response;
  const tab = snapshot?.selectedTab;
  const kindLabel = snapshot?.labels?.[tab] || "";

  return (
    <>
      <form method="dialog" className="dialog-top">
        <div>
          <div className="eyebrow">{snapshot?.chatType === "saved"
            ? translations[language].savedMessages
            : language === "ru" ? "СООБЩЕСТВО" : "COMMUNITY"}</div>
          <h2 id="chat-info-title">{snapshot?.chatType === "saved"
            ? language === "ru" ? "Информация о чате" : "Chat information"
            : language === "ru" ? "Профиль сообщества" : "Community profile"}</h2>
        </div>
        <button className="icon-button dialog-close" value="cancel" aria-label="Close">×</button>
      </form>
      <section className="chat-info-identity" aria-label={language === "ru" ? "Информация о чате" : "Chat information"}>
        <span className={`chat-info-avatar${snapshot?.chatType === "channel" ? " is-channel" : ""}`} aria-hidden="true">
          {snapshot?.avatarUrl
            ? <AuthenticatedImage src={snapshot.avatarUrl} alt="" />
            : snapshot?.chatType === "saved"
              ? <svg className="saved-bookmark-icon" viewBox="0 0 24 24"><path d="M6 3.75h12v17l-6-4-6 4z" /></svg>
              : snapshot?.chatType === "channel" ? "#" : initials(snapshot?.chatName || "")}
        </span>
        <div className="chat-info-identity-copy">
          <strong>{snapshot?.chatName || ""}</strong>
          {snapshot?.description && <span>{snapshot.description}</span>}
          {snapshot?.chatType === "channel" && (
            <small>{snapshot.memberCount} {snapshot.labels.memberCountUnit}</small>
          )}
        </div>
      </section>
      {snapshot?.canManageChannel && (
        <button
          className="primary-button channel-settings-link"
          type="button"
          onClick={() => document.dispatchEvent(new CustomEvent("polus:open-channel-settings", {
            detail: { channelId: snapshot.conversationId }
          }))}
        >
          {snapshot.labels.channelSettings}
        </button>
      )}
      {snapshot?.chatType === "group" && (
        <button
          className="primary-button channel-settings-link"
          type="button"
          onClick={() => document.dispatchEvent(new CustomEvent("polus:open-group-settings", {
            detail: { groupId: snapshot.conversationId }
          }))}
        >
          {snapshot.labels.groupSettings}
        </button>
      )}
      <>
          <nav id="chat-info-tabs" className="chat-info-tabs">
            {snapshot?.tabs.map((item) => (
              <button
                key={item.kind}
                className={`chat-info-tab${item.kind === tab ? " is-active" : ""}`}
                type="button"
                onClick={() => act("select-tab", { tab: item.kind })}
              >
                {item.label} ({item.total})
              </button>
            ))}
          </nav>
          <div id="chat-info-content" className="chat-info-content">
        {response && (
          <>
            <div className="chat-info-count">{kindLabel} ({response.total})</div>
            {tab === "media"
              ? <div className="media-grid">
                {response.items.map((item) => (
                  <div className="media-tile" key={item.id}>
                    {item.mimeType.startsWith("image/")
                      ? <AuthenticatedImage
                        src={item.thumbnailUrl || `/api/attachments/${encodeURIComponent(item.id)}`}
                        alt={item.name}
                        loading="lazy"
                        title={item.name}
                        onClick={() => act("open-media", { attachmentId: item.id, canView: snapshot.canView })}
                      />
                      : <AuthenticatedVideo src={`/api/attachments/${encodeURIComponent(item.id)}`} controls preload="metadata" />}
                    {item.messageId && snapshot.canView && (
                      <button className="text-button" type="button" onClick={() => act("open-message", { messageId: item.messageId })}>
                        {snapshot.labels.openMessage}
                      </button>
                    )}
                  </div>
                ))}
              </div>
              : <div className={tab === "members" ? "info-member-list" : "info-item-list"}>
                {response.items.map((item) => tab === "members"
                  ? <article className="info-item info-member" key={item.id}>
                    <span className="info-member-avatar" aria-hidden="true">
                      {item.avatarUrl ? <AuthenticatedImage src={item.avatarUrl} alt="" loading="lazy" /> : initials(item.fullName)}
                    </span>
                    <div className="info-member-identity">
                      <button
                        className="profile-inline-button info-member-name"
                        type="button"
                        onClick={() => document.dispatchEvent(new CustomEvent("polus:open-profile", {
                          detail: { username: item.username }
                        }))}
                      >
                        {item.fullName}
                      </button>
                      <span className="info-member-handle">@{item.username}</span>
                    </div>
                    <div className="info-member-meta">
                      <span className={`info-member-role is-${item.role}`}>{item.roleLabel}</span>
                      {item.presence && <span className={`info-member-presence${item.online ? " is-online" : ""}`}>{item.presence}</span>}
                    </div>
                  </article>
                  : <article className="info-item" key={item.id}>
                    {tab === "links"
                      ? <a href={item.url} target="_blank" rel="noopener noreferrer">{item.title || item.domain}</a>
                      : <strong>{item.name}</strong>}
                    <small>{item.displayDetail || itemDetail(item)}</small>
                    {item.messageId && (
                      <button className="text-button" type="button" onClick={() => act("open-message", { messageId: item.messageId })}>
                        {snapshot.labels.openMessage}
                      </button>
                    )}
                    {tab === "files" && (
                      <a
                        className="text-button"
                        href={`/api/attachments/${encodeURIComponent(item.id)}?download=1`}
                        download={item.name}
                      >
                        {snapshot.labels.download}
                      </a>
                    )}
                  </article>)}
              </div>}
            {response.items.length === 0 && <div className="no-results">{snapshot.labels.noResults}</div>}
            {response.hasMore && response.nextCursor && (
              <button
                className="load-older-messages"
                type="button"
                disabled={snapshot.loadingMore}
                onClick={() => act("load-more", { tab, cursor: response.nextCursor })}
              >
                {snapshot.loadingMore ? snapshot.labels.loading : snapshot.labels.loadOlderMessages}
              </button>
            )}
            {snapshot.canMute && (
              <button className="text-button chat-info-mute" type="button" onClick={() => act("toggle-mute")}>
                {snapshot.muted ? snapshot.labels.unmuteChat : snapshot.labels.muteChat}
              </button>
            )}
        </>
        )}
          </div>
        </>
    </>
  );
}

const ChatManagementViewContext = createContext({});

function ChatManagementContent() {
  const { activeSection, onDirtyChange } = useContext(ChatManagementViewContext);
  const [snapshot, setSnapshot] = useState(null);
  const [username, setUsername] = useState("");
  const [ownerUsername, setOwnerUsername] = useState("");
  const [channelName, setChannelName] = useState("");
  const [channelDescription, setChannelDescription] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [busy, setBusy] = useState(false);

  useLayoutEffect(() => {
    const onManagement = (event) => {
      if (!event.detail) {
        setSnapshot(null);
        setUsername("");
        setOwnerUsername("");
        setChannelName("");
        setChannelDescription("");
        setMemberSearch("");
        setBusy(false);
        return;
      }
      setSnapshot(event.detail);
      setUsername("");
      setOwnerUsername(event.detail.members.find((member) => member.id !== event.detail.chat.ownerId)?.username || "");
      setChannelName(event.detail.chat.name || "");
      setChannelDescription(event.detail.chat.description || "");
      setMemberSearch("");
      setBusy(false);
    };
    document.addEventListener("polus:chat-management-changed", onManagement);
    return () => document.removeEventListener("polus:chat-management-changed", onManagement);
  }, []);

  useEffect(() => {
    if (!snapshot) return;
    setChannelName(snapshot.chat.name || "");
    setChannelDescription(snapshot.chat.description || "");
  }, [activeSection, snapshot]);

  const hasUnsavedChanges = Boolean(snapshot
    && ["channel", "group"].includes(snapshot.chat.type)
    && snapshot.members.find((member) => member.id === snapshot.currentUserId)?.role === "owner"
    && (channelName !== snapshot.chat.name || channelDescription !== (snapshot.chat.description || "")));
  useEffect(() => {
    if (!onDirtyChange) return undefined;
    onDirtyChange(hasUnsavedChanges);
    return () => onDirtyChange(false);
  }, [hasUnsavedChanges, onDirtyChange]);

  const act = (action, detail = {}) => {
    setBusy(true);
    document.dispatchEvent(new CustomEvent("polus:chat-management-action", {
      detail: { action, chatId: chat.id, ...detail }
    }));
  };
  if (!snapshot) return null;
  const { chat, members, labels } = snapshot;
  const currentRole = members.find((member) => member.id === snapshot.currentUserId)?.role || "member";
  const isChannel = chat.type === "channel";
  const canManage = ["owner", "admin"].includes(currentRole);
  const matchingMembers = members.filter((member) => {
    const query = memberSearch.trim().toLocaleLowerCase();
    return !query || member.fullName.toLocaleLowerCase().includes(query)
      || member.username.toLocaleLowerCase().includes(query);
  });
  const unavailable = (title, description) => (
    <section className="channel-settings-section">
      <h2 className="channel-settings-section-title">{title}</h2>
      <p className="channel-settings-help">{description}</p>
      <p className="channel-settings-unavailable">
        {snapshot.labels.notAvailable}
      </p>
    </section>
  );

  return (
    <section id="chat-management-content" className="chat-profile-management">
      {isChannel && (!activeSection || activeSection === "info") && (
        <section className="channel-settings-section">
          <h2 className="channel-settings-section-title">{labels.channelDetails}</h2>
          <form
            method="post"
            className="channel-details-form"
            onSubmit={(event) => {
              event.preventDefault();
              void act("save-channel-details", {
                name: channelName.trim(),
                description: channelDescription.trim()
              });
            }}
          >
            <label className="field-label" htmlFor="channel-settings-name">{labels.channelName}</label>
            <input
              id="channel-settings-name"
              className="text-field"
              value={channelName}
              maxLength={50}
              minLength={2}
              required
              disabled={currentRole !== "owner" || busy}
              onChange={(event) => setChannelName(event.target.value)}
            />
            <label className="field-label" htmlFor="channel-settings-description">{labels.channelDescription}</label>
            <textarea
              id="channel-settings-description"
              className="text-field channel-description-field"
              value={channelDescription}
              maxLength={160}
              disabled={currentRole !== "owner" || busy}
              onChange={(event) => setChannelDescription(event.target.value)}
            />
            <label className="field-label" htmlFor="group-privacy">{labels.groupPrivacy}</label>
            <select
              id="group-privacy"
              className="text-field"
              value={chat.isPublic ? "public" : "private"}
              disabled={currentRole !== "owner" || busy || hasUnsavedChanges}
              onChange={(event) => void act("set-group-privacy", { isPublic: event.target.value === "public" })}
            >
              <option value="public">{labels.publicGroup}</option>
              <option value="private">{labels.privateGroup}</option>
            </select>
            {currentRole === "owner" && (
              <button className="primary-button" type="submit" disabled={busy}>
                {busy ? labels.saving : labels.saveChannelDetails}
              </button>
            )}
          </form>
          <label className="field-label" htmlFor="channel-privacy">{labels.channelPrivacy}</label>
          <select
            id="channel-privacy"
            className="text-field"
            value={chat.isPrivate ? "private" : "public"}
            disabled={currentRole !== "owner" || busy}
            onChange={(event) => void act("set-channel-privacy", { isPrivate: event.target.value === "private" })}
          >
            <option value="public">{labels.publicChannel}</option>
            <option value="private">{labels.privateChannel}</option>
          </select>
        </section>
      )}
      {isChannel && (!activeSection || activeSection === "publishing") && (
        <section className="channel-settings-section">
          <h2 className="channel-settings-section-title">{labels.publishing}</h2>
          <p className="channel-settings-help">{labels.postIdentityHelp}</p>
          <label className="field-label" htmlFor="channel-post-identity">{labels.channelPostIdentity}</label>
          <select
            id="channel-post-identity"
            className="text-field"
            value={chat.postAs === "channel" ? "channel" : "person"}
            disabled={!canManage || busy}
            onChange={(event) => void act("set-post-identity", { postAs: event.target.value })}
          >
            <option value="person">{labels.postAsPerson}</option>
            <option value="channel">{labels.postAsChannel}</option>
          </select>
          {!canManage && <p className="channel-settings-help">{labels.managersOnly}</p>}
        </section>
      )}
      {isChannel && (!activeSection || activeSection === "subscribers") && (
        <section className="channel-settings-section">
          <h2 className="channel-settings-section-title">{labels.subscribers} ({members.length})</h2>
          <input
            className="text-field"
            type="search"
            aria-label={labels.searchSubscribers}
            placeholder={labels.searchSubscribers}
            value={memberSearch}
            onChange={(event) => setMemberSearch(event.target.value)}
          />
          <div className="management-members">
            {matchingMembers.filter((member) => member.role !== "admin" && member.role !== "owner").map((member) => (
              <div className="management-member" key={member.id}>
                <span className="management-member-copy">
                  <button
                    className="profile-inline-button management-member-name"
                    type="button"
                    onClick={() => document.dispatchEvent(new CustomEvent("polus:open-profile", {
                      detail: { username: member.username }
                    }))}
                  >{member.fullName}</button>
                  <small>@{member.username} · {member.roleLabel}</small>
                </span>
                {canManage && member.id !== snapshot.currentUserId && (
                  <button
                    className="text-button"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(labels.confirmRemoveMember)) {
                        void act("remove-member", { memberId: member.id });
                      }
                    }}
                  >{labels.remove}</button>
                )}
              </div>
            ))}
            {matchingMembers.every((member) => member.role !== "member") && (
              <p className="channel-settings-help">{labels.noMatchingSubscribers}</p>
            )}
          </div>
        </section>
      )}
      {isChannel && (!activeSection || activeSection === "administrators") && (
        <section className="channel-settings-section">
          <h2 className="channel-settings-section-title">{labels.administrators}</h2>
          <div className="management-members">
            {members.filter((member) => member.role === "owner" || member.role === "admin").map((member) => (
              <div className="management-member" key={member.id}>
                <span className="management-member-copy">
                  <button
                    className="profile-inline-button management-member-name"
                    type="button"
                    onClick={() => document.dispatchEvent(new CustomEvent("polus:open-profile", {
                      detail: { username: member.username }
                    }))}
                  >{member.fullName}</button>
                  <small>@{member.username} · {member.roleLabel}</small>
                </span>
                {currentRole === "owner" && member.role === "admin" && (
                  <button className="text-button" type="button" disabled={busy}
                    onClick={() => void act("toggle-admin", { memberId: member.id, makeAdmin: false })}>
                    {labels.removeAdmin}
                  </button>
                )}
              </div>
            ))}
          </div>
          {currentRole === "owner" && (
            <form
              className="management-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (username.trim()) {
                  void act("toggle-admin", { memberId: members.find((member) => member.username === username)?.id, makeAdmin: true });
                }
              }}
            >
              <select className="text-field" value={username} disabled={busy}
                onChange={(event) => setUsername(event.target.value)} required>
                <option value="">{labels.selectSubscriber}</option>
                {members.filter((member) => member.role === "member").map((member) => (
                  <option value={member.username} key={member.id}>{member.fullName} (@{member.username})</option>
                ))}
              </select>
              <button className="primary-button" type="submit" disabled={busy || !username}>{labels.makeAdmin}</button>
            </form>
          )}
          {currentRole !== "owner" && <p className="channel-settings-help">{labels.ownerOnly}</p>}
        </section>
      )}
      {isChannel && (!activeSection || activeSection === "invites") && (
        <section className="channel-settings-section">
          <h2 className="channel-settings-section-title">{labels.invitationSettings}</h2>
          <p className="channel-settings-help">{labels.invitationHelp}</p>
        {canManage && (
          <div className="invite-link-management">
            {chat.inviteUrl
              ? <input
                className="text-field"
                aria-label={labels.inviteLink}
                readOnly
                value={`${window.location.origin}${chat.inviteUrl}`}
                onFocus={(event) => event.currentTarget.select()}
              />
              : <span className="management-hint">{labels.noInviteLink}</span>}
            <div className="invite-link-actions">
              {chat.inviteUrl && (
                <button
                  className="text-button"
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(`${window.location.origin}${chat.inviteUrl}`);
                      document.dispatchEvent(new CustomEvent("polus:notify", { detail: labels.linkCopied }));
                    } catch (error) {
                      document.dispatchEvent(new CustomEvent("polus:notify", { detail: error.message }));
                    }
                  }}
                >{labels.copyInviteLink}</button>
              )}
              <button
                className="text-button"
                type="button"
                disabled={busy}
                onClick={() => void act("create-invite-link")}
              >{chat.inviteUrl ? labels.rotateInviteLink : labels.createInviteLink}</button>
              {chat.inviteUrl && (
                <button
                  className="text-button"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(labels.confirmRevokeInvite)) void act("revoke-invite-link");
                  }}
                >{labels.revokeInviteLink}</button>
              )}
            </div>
          </div>
        )}
        {canManage && (
          <button
            className="primary-button"
            type="button"
            disabled={busy}
            onClick={() => document.dispatchEvent(new CustomEvent("polus:open-user-picker", {
              detail: {
                mode: isChannel && !chat.isPrivate ? "public-channel" : "add-chat-members",
                chatId: chat.id,
                chatType: chat.type,
                excludeUserIds: members.map((member) => member.id)
              }
            }))}
          >{labels.inviteMember}</button>
        )}
        </section>
      )}
      {isChannel && activeSection === "appearance" && unavailable(labels.appearance, labels.appearanceUnavailable)}
      {isChannel && activeSection === "permissions" && (
        <section className="channel-settings-section">
          <h2 className="channel-settings-section-title">{labels.permissions}</h2>
          <p className="channel-settings-help">{labels.pinPostsUnavailable}</p>
          {currentRole === "owner" ? (
            <div className="channel-admin-permission-list">
              {members.filter((member) => member.role === "admin").map((member) => {
                const permissions = snapshot.adminPermissions?.[member.id] || {
                  publish: true,
                  editMessages: true,
                  deleteMessages: true
                };
                return (
                  <section className="channel-admin-permission" key={member.id}>
                    <h3>{member.fullName}</h3>
                    <p>@{member.username}</p>
                    {labels.adminPermissionOptions.map((option) => (
                      <label className="channel-settings-toggle-row" key={option.id}>
                        <span>
                          <strong>{option.label}</strong>
                          <small>{option.description}</small>
                        </span>
                        <input
                          type="checkbox"
                          role="switch"
                          checked={permissions[option.id]}
                          disabled={busy}
                          onChange={(event) => void act("set-admin-permissions", {
                            memberId: member.id,
                            permissions: { ...permissions, [option.id]: event.target.checked }
                          })}
                        />
                      </label>
                    ))}
                  </section>
                );
              })}
              {members.every((member) => member.role !== "admin") && (
                <p className="channel-settings-help">{labels.noAdministrators}</p>
              )}
            </div>
          ) : currentRole === "admin" ? (
            <div className="channel-admin-permission">
              <p className="channel-settings-help">{labels.yourAdminPermissions}</p>
              {labels.adminPermissionOptions.map((option) => (
                <label className="channel-settings-toggle-row" key={option.id}>
                  <span>
                    <strong>{option.label}</strong>
                    <small>{option.description}</small>
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={snapshot.adminPermissions?.[snapshot.currentUserId]?.[option.id] !== false}
                    disabled
                    readOnly
                  />
                </label>
              ))}
            </div>
          ) : <p className="channel-settings-help">{labels.managersOnly}</p>}
        </section>
      )}
      {isChannel && activeSection === "notifications" && (
        <section className="channel-settings-section">
          <h2 className="channel-settings-section-title">{labels.notifications}</h2>
          <label className="channel-settings-toggle-row">
            <span>
              <strong>{labels.channelNotifications}</strong>
              <small>{labels.channelNotificationsHelp}</small>
            </span>
            <input type="checkbox" role="switch" checked={!chat.muted} disabled={busy}
              onChange={(event) => void act("toggle-channel-notifications", { muted: !event.target.checked })} />
          </label>
        </section>
      )}
      {isChannel && (!activeSection || activeSection === "additional") && (
        <section className="channel-settings-section">
          <h2 className="channel-settings-section-title">{labels.administration}</h2>
          {currentRole === "owner" && (
            <>
              <p className="channel-settings-help">{labels.transferOwnershipHelp}</p>
              <form className="management-form ownership-transfer-form" onSubmit={(event) => {
                event.preventDefault();
                if (ownerUsername && window.confirm(labels.confirmTransferOwnership)) {
                  void act("transfer-ownership", { username: ownerUsername });
                }
              }}>
                <select className="text-field" value={ownerUsername}
                  disabled={busy || !members.some((member) => member.id !== chat.ownerId)}
                  onChange={(event) => setOwnerUsername(event.target.value)}>
                  {members.filter((member) => member.id !== chat.ownerId).map((member) => (
                    <option value={member.username} key={member.id}>{member.fullName} (@{member.username})</option>
                  ))}
                </select>
                <button className="text-button" type="submit" disabled={busy || !ownerUsername}>{labels.transferOwnership}</button>
              </form>
              <div className="channel-settings-danger">
                <div>
                  <strong>{labels.deleteChannelHeading}</strong>
                  <p>{labels.deleteChannelHelp}</p>
                </div>
                <button className="danger-button" type="button" disabled={busy}
                  onClick={() => void act("delete-chat")}>{labels.deleteChannel}</button>
              </div>
            </>
          )}
          {currentRole !== "owner" && (
            <button className="danger-button" type="button" disabled={busy}
              onClick={() => {
                if (window.confirm(labels.confirmLeave)) void act("leave-chat");
              }}>{labels.leaveChat}</button>
          )}
        </section>
      )}
      {!isChannel && chat.type === "group" && (
        <div className="group-management-settings">
          {activeSection === "info" && <section className="channel-settings-section">
            <h2 className="channel-settings-section-title">{labels.groupDetails}</h2>
            <form
              className="channel-details-form"
              onSubmit={(event) => {
                event.preventDefault();
                void act("save-group-details", {
                  name: channelName.trim(),
                  description: channelDescription.trim()
                });
              }}
            >
              <label className="field-label" htmlFor="group-settings-name">{labels.groupName}</label>
              <input
                id="group-settings-name"
                className="text-field"
                value={channelName}
                maxLength={50}
                minLength={2}
                required
                disabled={currentRole !== "owner" || busy}
                onChange={(event) => setChannelName(event.target.value)}
              />
              <label className="field-label" htmlFor="group-settings-description">{labels.groupDescription}</label>
              <textarea
                id="group-settings-description"
                className="text-field channel-description-field"
                value={channelDescription}
                maxLength={160}
                disabled={currentRole !== "owner" || busy}
                onChange={(event) => setChannelDescription(event.target.value)}
              />
              {currentRole === "owner" && (
                <button className="primary-button" type="submit" disabled={busy}>
                  {busy ? labels.saving : labels.saveGroupDetails}
                </button>
              )}
            </form>
          </section>}

          {activeSection === "members" && <section className="channel-settings-section">
            <h2 className="channel-settings-section-title">{labels.chatMembers} ({members.length})</h2>
            <input
              className="text-field"
              type="search"
              aria-label={labels.searchGroupMembers}
              placeholder={labels.searchGroupMembers}
              value={memberSearch}
              onChange={(event) => setMemberSearch(event.target.value)}
            />
            <div className="management-members">
              {matchingMembers.map((member) => (
                <div className="management-member" key={member.id}>
                  <span className="management-member-copy">
                    <button
                      className="profile-inline-button management-member-name"
                      type="button"
                      onClick={() => document.dispatchEvent(new CustomEvent("polus:open-profile", {
                        detail: { username: member.username }
                      }))}
                    >{member.fullName}</button>
                    <small>@{member.username} · {member.roleLabel}</small>
                  </span>
                  {canManage && member.id !== snapshot.currentUserId && member.role !== "owner"
                    && (currentRole === "owner" || member.role === "member") && (
                    <button
                      className="text-button"
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(labels.confirmRemoveGroupMember)) {
                          void act("remove-member", { memberId: member.id });
                        }
                      }}
                    >{labels.remove}</button>
                  )}
                </div>
              ))}
              {matchingMembers.length === 0 && (
                <p className="channel-settings-help">{labels.noGroupMembers}</p>
              )}
            </div>
            {canManage && (
              <button
                className="primary-button"
                type="button"
                disabled={busy}
                onClick={() => document.dispatchEvent(new CustomEvent("polus:open-user-picker", {
                  detail: {
                    mode: "add-chat-members",
                    chatId: chat.id,
                    chatType: "group",
                    excludeUserIds: members.map((member) => member.id)
                  }
                }))}
              >{labels.inviteMember}</button>
            )}
          </section>}

          {activeSection === "administrators" && <section className="channel-settings-section">
            <h2 className="channel-settings-section-title">{labels.groupAdministrators}</h2>
            <div className="management-members">
              {members.filter((member) => member.role === "owner" || member.role === "admin").map((member) => (
                <div className="management-member" key={member.id}>
                  <span className="management-member-copy">
                    <button
                      className="profile-inline-button management-member-name"
                      type="button"
                      onClick={() => document.dispatchEvent(new CustomEvent("polus:open-profile", {
                        detail: { username: member.username }
                      }))}
                    >{member.fullName}</button>
                    <small>@{member.username} · {member.roleLabel}</small>
                  </span>
                  {currentRole === "owner" && member.role === "admin" && (
                    <button className="text-button" type="button" disabled={busy}
                      onClick={() => void act("toggle-admin", { memberId: member.id, makeAdmin: false })}>
                      {labels.removeAdmin}
                    </button>
                  )}
                </div>
              ))}
              {members.every((member) => member.role !== "admin") && (
                <p className="channel-settings-help">{labels.noGroupAdmins}</p>
              )}
            </div>
            {currentRole === "owner" && (
              <form className="management-form" onSubmit={(event) => {
                event.preventDefault();
                const member = members.find((item) => item.username === username);
                if (member) void act("toggle-admin", { memberId: member.id, makeAdmin: true });
              }}>
                <select className="text-field" value={username} disabled={busy}
                  onChange={(event) => setUsername(event.target.value)} required>
                  <option value="">{labels.selectSubscriber}</option>
                  {members.filter((member) => member.role === "member").map((member) => (
                    <option value={member.username} key={member.id}>{member.fullName} (@{member.username})</option>
                  ))}
                </select>
                <button className="primary-button" type="submit" disabled={busy || !username}>
                  {labels.makeAdmin}
                </button>
              </form>
            )}
          </section>}

          {activeSection === "invites" && <section className="channel-settings-section">
            <h2 className="channel-settings-section-title">{labels.invitationSettings}</h2>
            <p className="channel-settings-help">{labels.invitationHelp}</p>
            {canManage && (
              <div className="invite-link-management">
                {chat.inviteUrl
                  ? <input
                    className="text-field"
                    aria-label={labels.inviteLink}
                    readOnly
                    value={`${window.location.origin}${chat.inviteUrl}`}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  : <span className="management-hint">{labels.noInviteLink}</span>}
                <div className="invite-link-actions">
                  {chat.inviteUrl && (
                    <button
                      className="text-button"
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(`${window.location.origin}${chat.inviteUrl}`);
                          document.dispatchEvent(new CustomEvent("polus:notify", { detail: labels.linkCopied }));
                        } catch (error) {
                          document.dispatchEvent(new CustomEvent("polus:notify", { detail: error.message }));
                        }
                      }}
                    >{labels.copyInviteLink}</button>
                  )}
                  <button className="text-button" type="button" disabled={busy}
                    onClick={() => void act("create-invite-link")}>
                    {chat.inviteUrl ? labels.rotateInviteLink : labels.createInviteLink}
                  </button>
                  {chat.inviteUrl && (
                    <button className="text-button" type="button" disabled={busy}
                      onClick={() => {
                        if (window.confirm(labels.confirmRevokeInvite)) void act("revoke-invite-link");
                      }}>{labels.revokeInviteLink}</button>
                  )}
                </div>
              </div>
            )}
          </section>}

          {activeSection === "additional" && <section className="channel-settings-section">
            <h2 className="channel-settings-section-title">{labels.administration}</h2>
            {currentRole === "owner" && (
              <>
                <p className="channel-settings-help">{labels.groupTransferOwnershipHelp}</p>
                <form className="management-form ownership-transfer-form" onSubmit={(event) => {
                  event.preventDefault();
                  if (ownerUsername && window.confirm(labels.confirmTransferGroupOwnership)) {
                    void act("transfer-ownership", { username: ownerUsername });
                  }
                }}>
                  <select className="text-field" value={ownerUsername}
                    disabled={busy || !members.some((member) => member.id !== chat.ownerId)}
                    onChange={(event) => setOwnerUsername(event.target.value)}>
                    {members.filter((member) => member.id !== chat.ownerId).map((member) => (
                      <option value={member.username} key={member.id}>{member.fullName} (@{member.username})</option>
                    ))}
                  </select>
                  <button className="text-button" type="submit" disabled={busy || !ownerUsername}>
                    {labels.transferOwnership}
                  </button>
                </form>
                <div className="channel-settings-danger">
                  <div>
                    <strong>{labels.deleteGroupHeading}</strong>
                    <p>{labels.deleteGroupHelp}</p>
                  </div>
                  <button className="danger-button" type="button" disabled={busy}
                    onClick={() => void act("delete-chat")}>{labels.deleteGroup}</button>
                </div>
              </>
            )}
            {currentRole !== "owner" && (
              <button className="danger-button" type="button" disabled={busy}
                onClick={() => {
                  if (window.confirm(labels.confirmLeaveGroup)) void act("leave-chat");
                }}>{labels.leaveChat}</button>
            )}
          </section>}
        </div>
      )}
    </section>
  );
}

function Composer({ user, accountKey }) {
  const language = useCurrentLanguage();
  const [text, setText] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [visible, setVisible] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [conversation, setConversation] = useState(null);
  const [replyTarget, setReplyTarget] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [upload, setUpload] = useState({ active: false, text: "" });
  const [attachmentInputKey, setAttachmentInputKey] = useState(0);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [pendingRecording, setPendingRecording] = useState(null);
  const attachmentInput = useRef(null);
  const voiceFileInput = useRef(null);
  const textAreaRef = useRef(null);
  const attachmentsRef = useRef([]);
  const uploadControllerRef = useRef(null);
  const conversationRef = useRef(null);
  const recordingStreamRef = useRef(null);
  const recorderRef = useRef(null);
  const recordingChunksRef = useRef([]);
  const recordingStartedAtRef = useRef(0);
  const recordingCancelledRef = useRef(false);
  const recordingTimerRef = useRef(null);
  const recordedMessageTypeRef = useRef(null);
  const previousConversationIdRef = useRef(undefined);
  const submittingRef = useRef(false);
  const labels = language === "ru"
    ? {
      write: "Написать сообщение", attach: "Прикрепить файлы", placeholder: "Напиши сообщение…",
      send: "Отправить", maxAttachments: "К одному сообщению можно прикрепить не более 10 файлов.",
      joinChannelPrompt: "Это открытый канал. Вступите, чтобы участвовать в обсуждении.",
      joinChannel: "Вступить в канал",
      maxFileSize: "Размер файла не должен превышать 100 МБ.", thumbnailFailed: "Не удалось создать миниатюру; оригинал сохранён.",
      replyTo: "Ответ на сообщение", cancelReply: "Отменить ответ", messageUnavailable: "Сообщение удалено",
      recordVoice: "Записать голосовое сообщение",
      recordingVoice: "Идёт запись голосового сообщения",
      stopRecording: "Остановить запись", cancelRecording: "Отменить запись",
      recordingReady: "Запись готова", sendRecording: "Отправить запись",
      recordingUnavailable: "Запись голоса не поддерживается этим браузером.",
      recordVoiceHttp: "Записать голосовое сообщение (системная запись или аудиофайл)",
      audioSelected: "Аудио готово к отправке",
      audioFileInvalid: "Выберите аудиофайл или запишите голосовое сообщение в диктофоне.",
      recordingPermission: "Нет доступа к микрофону. Проверьте разрешения браузера.",
      recordingEmpty: "Запись не содержит данных."
    }
    : {
      write: "Write a message", attach: "Attach files", placeholder: "Write a message…",
      send: "Send", maxAttachments: "A message can have up to 10 attachments.",
      joinChannelPrompt: "This is a public channel. Join to participate in the conversation.",
      joinChannel: "Join channel",
      maxFileSize: "Files cannot exceed 100 MB.", thumbnailFailed: "Unable to create a preview; the original was kept.",
      replyTo: "Replying to", cancelReply: "Cancel reply", messageUnavailable: "Message deleted",
      recordVoice: "Record voice message",
      recordingVoice: "Recording voice message",
      stopRecording: "Stop recording", cancelRecording: "Cancel recording",
      recordingReady: "Recording ready", sendRecording: "Send recording",
      recordingUnavailable: "Voice recording is not supported by this browser.",
      recordVoiceHttp: "Record voice message (system recorder or audio file)",
      audioSelected: "Audio ready to send",
      audioFileInvalid: "Choose an audio file or record a voice message in your device's recorder.",
      recordingPermission: "Microphone access was denied. Check your browser permissions.",
      recordingEmpty: "The recording is empty."
    };

  useLayoutEffect(() => {
    const onState = (event) => {
      const nextConversation = event.detail.conversation || null;
      conversationRef.current = nextConversation;
      setConversation(nextConversation);
      setVisible(event.detail.visible);
      setEnabled(event.detail.enabled);
      logClientDiagnostic("composer.state.changed", {
        conversationId: nextConversation?.id || null,
        conversationType: nextConversation?.type || null,
        visible: Boolean(event.detail.visible),
        enabled: Boolean(event.detail.enabled)
      });
    };
    document.addEventListener("polus:composer-state", onState);
    return () => {
      document.removeEventListener("polus:composer-state", onState);
    };
  }, []);

  useLayoutEffect(() => {
    const onReplyTarget = (event) => {
      const target = event.detail || null;
      setReplyTarget(target?.conversationId === conversationRef.current?.id ? target : null);
      if (target && !window.matchMedia("(max-width: 760px)").matches) textAreaRef.current?.focus();
    };
    document.addEventListener("polus:reply-target-changed", onReplyTarget);
    return () => document.removeEventListener("polus:reply-target-changed", onReplyTarget);
  }, []);

  useLayoutEffect(() => {
    if (!visible || !enabled || submitting || !conversation) return;
    if (window.matchMedia("(max-width: 760px)").matches) return;
    textAreaRef.current?.focus();
  }, [visible, enabled, submitting, conversation?.id]);

  function replaceAttachments(nextAttachments) {
    attachmentsRef.current = nextAttachments;
    setAttachments(nextAttachments);
  }

  async function clearPendingAttachments() {
    const pending = attachmentsRef.current;
    replaceAttachments([]);
    for (const item of pending) {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      if (!item.uploaded) continue;
      try {
        await requestJson(`/api/attachments/${encodeURIComponent(item.uploaded.id)}`, { method: "DELETE" });
      } catch (cause) {
        document.dispatchEvent(new CustomEvent("polus:notify", {
          detail: localizeComposerError(cause.message, language)
        }));
      }
    }
  }

  useEffect(() => {
    const activeConversationId = conversation?.id || null;
    const previousConversationId = previousConversationIdRef.current;
    previousConversationIdRef.current = activeConversationId;
    if (activeConversationId !== previousConversationId) {
      setReplyTarget(null);
      setPendingRecording(null);
      recordedMessageTypeRef.current = null;
      if (recorderRef.current?.state === "recording") cancelRecording();
      if (uploadControllerRef.current) {
        uploadControllerRef.current.abort();
      } else if (!submittingRef.current) {
        setUpload({ active: false, text: "" });
        void clearPendingAttachments();
      }
    }
  }, [conversation?.id]);

  useEffect(() => () => {
    uploadControllerRef.current?.abort();
    clearInterval(recordingTimerRef.current);
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    for (const item of attachmentsRef.current) {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    }
  }, []);

  useLayoutEffect(() => {
    if (!textAreaRef.current) return;
    textAreaRef.current.style.height = "auto";
    textAreaRef.current.style.height = `${Math.min(textAreaRef.current.scrollHeight, 150)}px`;
  }, [text]);

  async function removeAttachment(index) {
    const next = [...attachmentsRef.current];
    const [removed] = next.splice(index, 1);
    if (!removed) return;
    replaceAttachments(next);
    if (removed.previewUrl) URL.revokeObjectURL(removed.previewUrl);
    if (removed.uploaded) {
      try {
        await requestJson(`/api/attachments/${encodeURIComponent(removed.uploaded.id)}`, { method: "DELETE" });
      } catch (cause) {
        document.dispatchEvent(new CustomEvent("polus:notify", {
          detail: localizeComposerError(cause.message, language)
        }));
      }
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  async function sendPendingRecording() {
    if (!pendingRecording || uploadControllerRef.current) return;
    const recording = pendingRecording;
    const targetConversationId = conversationRef.current?.id;
    setPendingRecording(null);
    recordedMessageTypeRef.current = "voice";
    const uploaded = await uploadFiles([recording.file]);
    if (!uploaded) {
      recordedMessageTypeRef.current = null;
      await clearPendingAttachments();
      return;
    }
    if (conversationRef.current?.id !== targetConversationId) {
      recordedMessageTypeRef.current = null;
      return;
    }
    window.setTimeout(() => document.getElementById("composer")?.requestSubmit(), 0);
  }

  function selectVoiceAudio(file) {
    if (!file) return;
    const mimeByExtension = {
      aac: "audio/aac",
      caf: "audio/x-caf",
      m4a: "audio/mp4",
      mp3: "audio/mpeg",
      oga: "audio/ogg",
      ogg: "audio/ogg",
      opus: "audio/ogg",
      wav: "audio/wav",
      weba: "audio/webm",
      webm: "audio/webm",
      wma: "audio/x-ms-wma",
      "3gp": "audio/3gpp"
    };
    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    const mimeType = file.type.startsWith("audio/")
      ? file.type
      : mimeByExtension[extension];
    if (!mimeType) {
      document.dispatchEvent(new CustomEvent("polus:notify", { detail: labels.audioFileInvalid }));
      return;
    }
    const audioFile = file.type === mimeType
      ? file
      : new File([file], file.name, { type: mimeType });
    setPendingRecording({ file: audioFile, duration: 0, fromFile: true });
  }

  function cancelRecording() {
    recordingCancelledRef.current = true;
    setPendingRecording(null);
    recordedMessageTypeRef.current = null;
    clearInterval(recordingTimerRef.current);
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
      return;
    }
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current = null;
    setRecording(false);
    setRecordingSeconds(0);
  }

  async function startRecording() {
    if (!enabled || submitting || upload.active || recording
      || pendingRecording || attachmentsRef.current.length > 0) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      voiceFileInput.current?.click();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingStreamRef.current = stream;
      if (conversationRef.current?.id !== conversation?.id || !enabled) {
        stream.getTracks().forEach((track) => track.stop());
        recordingStreamRef.current = null;
        return;
      }
      const candidates = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"];
      const mimeType = candidates.find((candidate) => MediaRecorder.isTypeSupported?.(candidate));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      recordingChunksRef.current = [];
      recordingCancelledRef.current = false;
      recordingStartedAtRef.current = Date.now();
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size) recordingChunksRef.current.push(event.data);
      });
      recorder.addEventListener("error", (event) => {
        console.error("Media recording failed:", event.error || event);
        document.dispatchEvent(new CustomEvent("polus:notify", { detail: labels.recordingUnavailable }));
        recordingCancelledRef.current = true;
        if (recorder.state === "recording") recorder.stop();
      }, { once: true });
      recorder.addEventListener("stop", async () => {
        clearInterval(recordingTimerRef.current);
        stream.getTracks().forEach((track) => track.stop());
        recordingStreamRef.current = null;
        recorderRef.current = null;
        setRecording(false);
        setRecordingSeconds(0);
        if (recordingCancelledRef.current) {
          recordingChunksRef.current = [];
          return;
        }
        const type = recorder.mimeType || recordingChunksRef.current[0]?.type || "audio/webm";
        const extension = type.includes("mp4") ? "mp4" : "webm";
        const blob = new Blob(recordingChunksRef.current, { type });
        recordingChunksRef.current = [];
        if (!blob.size) {
          document.dispatchEvent(new CustomEvent("polus:notify", { detail: labels.recordingEmpty }));
          return;
        }
        const fileName = `voice-message-${Date.now()}.${extension}`;
        const file = new File([blob], fileName, { type });
        const duration = Math.floor((Date.now() - recordingStartedAtRef.current) / 1000);
        setPendingRecording({ file, duration });
      }, { once: true });
      recorder.start(250);
      setRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - recordingStartedAtRef.current) / 1000);
        setRecordingSeconds(elapsed);
      }, 250);
    } catch (error) {
      console.error("Unable to start media recording:", error);
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
      recordingStreamRef.current = null;
      setRecording(false);
      if (!window.isSecureContext) voiceFileInput.current?.click();
      else document.dispatchEvent(new CustomEvent("polus:notify", { detail: labels.recordingPermission }));
    }
  }

  async function uploadFiles(files) {
    if (!conversation || !enabled || uploadControllerRef.current) {
      logClientDiagnostic("composer.upload.blocked", {
        hasConversation: Boolean(conversation),
        enabled,
        uploadInProgress: Boolean(uploadControllerRef.current)
      }, "warn");
      return false;
    }
    const selected = [...files];
    logClientDiagnostic("composer.upload.started", {
      conversationId: conversation.id,
      fileCount: selected.length,
      totalBytes: selected.reduce((total, file) => total + file.size, 0),
      mimeTypes: [...new Set(selected.map((file) => file.type || "unknown"))]
    });
    if (attachmentsRef.current.length + selected.length > 10) {
      document.dispatchEvent(new CustomEvent("polus:notify", { detail: labels.maxAttachments }));
      return false;
    }
    const oversized = selected.find((file) => file.size > 100 * 1024 * 1024);
    if (oversized) {
      document.dispatchEvent(new CustomEvent("polus:notify", {
        detail: `${oversized.name}: ${labels.maxFileSize}`
      }));
      return false;
    }

    const newAttachments = selected.map((file) => ({
      file,
      uploaded: null,
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null
    }));
    replaceAttachments([...attachmentsRef.current, ...newAttachments]);
    setAttachmentInputKey((key) => key + 1);
    const controller = new AbortController();
    const conversationId = conversation.id;
    uploadControllerRef.current = controller;
    setUpload({ active: true, text: "" });
    let uploadSucceeded = false;
    try {
      for (const item of newAttachments) {
        const uploadStartedAt = performance.now();
        setUpload({ active: true, text: `0% · ${item.file.name}` });
        const encrypted = await encryptAttachment(item.file);
        item.encryptionMetadata = encrypted.metadata;
        const encryptedFile = new File([encrypted.blob], "encrypted.bin", {
          type: "application/octet-stream"
        });
        item.uploaded = await uploadAttachment(
          conversationId,
          encryptedFile,
          controller.signal,
          (percent) => setUpload({ active: true, text: `${percent}% · ${item.file.name}` }),
          { encrypted: true }
        );
        logClientDiagnostic("composer.upload.file-succeeded", {
          conversationId,
          size: item.file.size,
          mimeType: item.file.type || "unknown",
          durationMs: Math.round(performance.now() - uploadStartedAt)
        });
        replaceAttachments([...attachmentsRef.current]);
      }
      uploadSucceeded = true;
    } catch (cause) {
      if (cause.name !== "AbortError") {
        logClientDiagnostic("composer.upload.failed", {
          conversationId,
          errorName: cause.name,
          error: cause.message
        }, "error");
        document.dispatchEvent(new CustomEvent("polus:notify", {
          detail: localizeComposerError(cause.message, language)
        }));
      }
    } finally {
      if (uploadControllerRef.current === controller) {
        if (controller.signal.aborted) await clearPendingAttachments();
        uploadControllerRef.current = null;
        setUpload({ active: false, text: "" });
      }
    }
    return uploadSucceeded;
  }

  async function submit(event) {
    event.preventDefault();
    if (!enabled || submitting || !conversation || upload.active
      || recording || pendingRecording || attachments.some((item) => !item.uploaded)) {
      logClientDiagnostic("composer.submit.blocked", {
        enabled,
        submitting,
        hasConversation: Boolean(conversation),
        uploadInProgress: upload.active,
        pendingAttachments: attachments.filter((item) => !item.uploaded).length
      }, "warn");
      return;
    }
    const messageText = text.trim();
    if (!messageText && attachments.length === 0) {
      logClientDiagnostic("composer.submit.empty", {
        conversationId: conversation.id
      }, "warn");
      return;
    }
    const submittedConversation = conversation;
    const requestId = createClientId();
    const startedAt = performance.now();
    logClientDiagnostic("composer.submit.started", {
      requestId,
      conversationId: submittedConversation.id,
      conversationType: submittedConversation.type,
      textLength: Array.from(messageText).length,
      attachmentCount: attachments.length,
      attachmentBytes: attachments.reduce((total, item) => total + item.file.size, 0)
    });
    setSubmitting(true);
    submittingRef.current = true;
    try {
      const recipients = submittedConversation.pending
        ? [
          await getOwnEncryptionPublicKey(accountKey),
          await getEncryptionPublicKey(submittedConversation.username, accountKey)
        ]
        : await getConversationEncryptionKeys(submittedConversation.id, accountKey);
      const cryptographicConversationId = submittedConversation.pending
        ? `dm_${[user.id, recipients.find((item) => item.id !== user.id)?.id].sort().join("_")}`
        : submittedConversation.id;
      const encryptedText = await encryptMessagePayload(user.id, recipients, cryptographicConversationId, {
        text: messageText,
        mediaType: recordedMessageTypeRef.current || null,
        attachments: attachments.map((item) => ({
          id: item.uploaded.id,
          ...item.encryptionMetadata
        }))
      });
      const payload = submittedConversation.pending
        ? {
          recipientUsername: submittedConversation.username,
          text: encryptedText,
          encrypted: true,
          attachmentIds: attachments.map((item) => item.uploaded.id),
        }
        : {
          conversationId: submittedConversation.id,
          text: encryptedText,
          encrypted: true,
          attachmentIds: attachments.map((item) => item.uploaded.id),
          ...(replyTarget?.conversationId === submittedConversation.id
            ? { replyToId: replyTarget.message.id }
            : {})
        };
      const sent = await requestJson("/api/messages", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      logClientDiagnostic("composer.submit.succeeded", {
        requestId,
        conversationId: submittedConversation.id,
        messageId: sent.id,
        durationMs: Math.round(performance.now() - startedAt),
        attachmentCount: attachments.length
      }, "info");
      document.dispatchEvent(new CustomEvent("polus:message-sent", {
        detail: { sent, conversation: submittedConversation }
      }));
      setText("");
      setReplyTarget(null);
      recordedMessageTypeRef.current = null;
      const sentAttachments = attachmentsRef.current;
      replaceAttachments([]);
      for (const item of sentAttachments) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
    } catch (cause) {
      logClientDiagnostic("composer.submit.failed", {
        requestId,
        conversationId: submittedConversation.id,
        durationMs: Math.round(performance.now() - startedAt),
        errorName: cause.name,
        status: cause.status || null,
        error: cause.message
      }, "error");
      const notice = cause.code === "ENCRYPTION_KEY_CHANGED"
        ? await getEncryptionKeyChangeNotice(cause, language)
        : localizeComposerError(cause.message, language);
      document.dispatchEvent(new CustomEvent("polus:notify", {
        detail: notice
      }));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
      if (conversationRef.current?.id !== submittedConversation.id) void clearPendingAttachments();
    }
  }

  function cancelUpload() {
    uploadControllerRef.current?.abort();
  }

  return (
    <form
      id="composer"
      method="post"
      action="/api/forms-disabled"
      className="composer"
      hidden={!visible}
      onSubmit={(event) => void submit(event)}
    >
      {conversation?.type === "channel" && conversation.joined === false && (
        <div className="channel-preview-join">
          <p>{labels.joinChannelPrompt}</p>
          <button
            type="button"
            className="primary-button"
            onClick={() => document.dispatchEvent(new CustomEvent("polus:join-channel", {
              detail: { channelId: conversation.id }
            }))}
          >{labels.joinChannel}</button>
        </div>
      )}
      <div hidden={conversation?.type === "channel" && conversation.joined === false}>
      <AttachmentPreview
        attachments={attachments}
        language={language}
        onRemove={(index) => void removeAttachment(index)}
        disabled={upload.active || submitting}
      />
      {(recording || pendingRecording) && (
        <div className={`recording-dock${pendingRecording ? " recording-dock-ready" : ""}`} aria-live="polite">
          <div className={`recording-wave${pendingRecording ? " recording-wave-ready" : ""}`} aria-hidden="true">
            {Array.from({ length: 18 }, (_, index) => (
              <span key={index} style={{ "--wave-delay": `${index * -0.07}s` }} />
            ))}
          </div>
          <div className="recording-copy">
            <strong>{pendingRecording
              ? pendingRecording.fromFile ? labels.audioSelected : labels.recordingReady
              : labels.recordingVoice}</strong>
            {!pendingRecording?.fromFile && <span className="recording-timer">
              {formatMediaTime(pendingRecording ? pendingRecording.duration : recordingSeconds)}
            </span>}
          </div>
          <button type="button" className="recording-cancel" onClick={cancelRecording}>
            {labels.cancelRecording}
          </button>
          {pendingRecording
            ? <button type="button" className="recording-send" disabled={upload.active} onClick={() => void sendPendingRecording()}>
              {labels.sendRecording}
            </button>
            : <button type="button" className="recording-stop" aria-label={labels.stopRecording} title={labels.stopRecording} onClick={stopRecording}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
            </button>}
        </div>
      )}
      {replyTarget && (
        <div className="composer-reply-preview">
          <div>
            <strong>{labels.replyTo} · {replyTarget.message.author?.fullName || replyTarget.message.author?.username}</strong>
            <span>{replyTarget.message.deleted
              ? labels.messageUnavailable
              : replyTarget.message.text || replyTarget.message.attachments?.map((item) => item.name).join(", ") || ""}</span>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label={labels.cancelReply}
            title={labels.cancelReply}
            onClick={() => {
              setReplyTarget(null);
              document.dispatchEvent(new CustomEvent("polus:reply-target-changed", { detail: null }));
            }}
          >×</button>
        </div>
      )}
      <label className="visually-hidden" htmlFor="message-input">{labels.write}</label>
      <div className="composer-entry">
        <div className="composer-tools">
          <button
            id="attach-files"
            className="icon-button attachment-button"
            type="button"
            aria-label={labels.attach}
            title={labels.attach}
            disabled={!enabled || submitting || upload.active || recording || Boolean(pendingRecording)}
            onClick={() => attachmentInput.current?.click()}
          >＋</button>
          <input
            id="attachment-input"
            key={attachmentInputKey}
            ref={attachmentInput}
            type="file"
            multiple
            hidden
            disabled={!enabled || submitting || upload.active || recording || Boolean(pendingRecording)}
            onChange={(event) => void uploadFiles([...(event.currentTarget.files || [])])}
          />
          <input
            ref={voiceFileInput}
            type="file"
            accept="audio/*"
            capture="user"
            hidden
            disabled={!enabled || submitting || upload.active || recording || Boolean(pendingRecording)}
            onChange={(event) => {
              selectVoiceAudio(event.currentTarget.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
          <button
            type="button"
            className="icon-button record-message-button"
            aria-label={labels.recordVoice}
            title={window.isSecureContext ? labels.recordVoice : labels.recordVoiceHttp}
            disabled={!enabled || submitting || upload.active || recording || Boolean(pendingRecording) || attachments.length > 0}
            onClick={() => void startRecording()}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3m-4 0h8" /></svg>
          </button>
        </div>
        <textarea
          id="message-input"
          ref={textAreaRef}
          rows={1}
          maxLength={4000}
          placeholder={labels.placeholder}
          value={text}
          disabled={!enabled || submitting || recording || Boolean(pendingRecording)}
          onChange={(event) => {
            setText(event.target.value);
            logClientDiagnostic("composer.input.changed", {
              conversationId: conversationRef.current?.id || null,
              characterCount: Array.from(event.target.value).length
            });
            event.currentTarget.style.height = "auto";
            event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 150)}px`;
          }}
          onFocus={() => logClientDiagnostic("composer.input.focused", {
            conversationId: conversationRef.current?.id || null
          })}
          onBlur={() => logClientDiagnostic("composer.input.blurred", {
            conversationId: conversationRef.current?.id || null
          })}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="composer-upload-status">
          <UploadStatus upload={upload} language={language} onCancel={cancelUpload} />
        </div>
        <button
          id="send-button"
          className="send-button"
          type="submit"
          aria-label={labels.send}
          title={labels.send}
          disabled={!enabled || submitting || upload.active || recording || Boolean(pendingRecording) || attachments.some((item) => !item.uploaded)}
        >
          <svg className="send-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3.2 11.6 20.7 3.7 14 21l-3.4-7.2-7.4-2.2Z" />
            <path d="m10.6 13.8 4.1-4.1" />
          </svg>
          <span className="visually-hidden">{labels.send}</span>
        </button>
      </div>
      </div>
    </form>
  );
}

function SidebarMenu({
  open,
  onClose,
  accounts,
  activeAccountKey,
  onSwitchAccount,
  onAddAccount,
  onManageAccounts,
  onOpenContacts
}) {
  const [user, setUser] = useState(null);
  const language = useCurrentLanguage();
  const menuRef = useRef(null);
  useEffect(() => {
    const onUser = (event) => setUser(event.detail);
    const closeOutside = (event) => {
      if (!menuRef.current?.contains(event.target)
        && !document.getElementById("sidebar-menu-button")?.contains(event.target)) onClose();
    };
    const closeOnEscape = (event) => {
      if (event.key !== "Escape" || !open) return;
      onClose();
      document.getElementById("sidebar-menu-button")?.focus();
    };
    if (open) {
      document.addEventListener("pointerdown", closeOutside);
      document.addEventListener("keydown", closeOnEscape);
    }
    document.addEventListener("polus:current-user-changed", onUser);
    return () => {
      document.removeEventListener("polus:current-user-changed", onUser);
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, onClose]);

  return (
    <div ref={menuRef} id="sidebar-menu" className="sidebar-menu" role="menu" hidden={!open}>
      <button
        id="profile-button"
        className="profile-button"
        type="button"
        role="menuitem"
        onClick={() => {
          onClose();
          document.dispatchEvent(new CustomEvent("polus:open-profile-settings"));
        }}
      >
        <span id="profile-avatar" className="profile-avatar">
          {user?.avatarUrl
            ? <AuthenticatedImage src={user.avatarUrl} accountKey={activeAccountKey} alt="" />
            : initials(user?.fullName || (language === "ru" ? "Пользователь" : "User"))}
        </span>
        <span className="profile-copy">
          <strong id="profile-name">{user?.fullName || (language === "ru" ? "Пользователь" : "User")}</strong>
          <small id="profile-handle">@{user?.username || "username"}</small>
        </span>
        <span className="profile-menu-mark" aria-hidden="true">···</span>
      </button>
      <div className="sidebar-menu-divider" role="separator" />
      <div className="account-switcher-list" aria-label={language === "ru" ? "Аккаунты" : "Accounts"}>
        {accounts.map((account) => (
          <button
            key={account.key}
            className={`sidebar-menu-item account-switcher-item${account.key === activeAccountKey ? " is-active" : ""}`}
            type="button"
            role="menuitemradio"
            aria-checked={account.key === activeAccountKey}
            onClick={() => {
              onClose();
              if (account.key !== activeAccountKey) onSwitchAccount(account.key);
            }}
          >
            <span className="account-switcher-avatar">
              {account.user.avatarUrl
                ? <AuthenticatedImage src={account.user.avatarUrl} accountKey={account.key} alt="" />
                : initials(account.user.fullName || account.user.username)}
            </span>
            <span className="profile-copy">
              <strong>{account.user.fullName || account.user.username}</strong>
              <small>@{account.user.username}</small>
            </span>
            {account.unreadCount > 0 && <span className="account-unread-count">{account.unreadCount}</span>}
            {account.key === activeAccountKey && <span className="account-active-mark" aria-label={language === "ru" ? "Активен" : "Active"}>✓</span>}
          </button>
        ))}
        <button
          className="sidebar-menu-item account-add-item"
          type="button"
          role="menuitem"
          onClick={() => { onClose(); onAddAccount(); }}
        >
          <span className="account-add-mark" aria-hidden="true">+</span>
          <span>{language === "ru" ? "Добавить аккаунт" : "Add account"}</span>
        </button>
        <button
          className="sidebar-menu-item"
          type="button"
          role="menuitem"
          onClick={() => { onClose(); onManageAccounts(); }}
        >
          <span aria-hidden="true">☷</span>
          <span>{language === "ru" ? "Управление аккаунтами" : "Manage accounts"}</span>
        </button>
      </div>
      <div className="sidebar-menu-divider" role="separator" />
      <button
        className="sidebar-menu-item"
        type="button"
        role="menuitem"
        onClick={() => { onClose(); onOpenContacts(); }}
      >
        <span aria-hidden="true">♙</span>
        <span>{language === "ru" ? "Контакты" : "Contacts"}</span>
      </button>
      <div className="sidebar-menu-divider" role="separator" />
      <button
        id="open-settings"
        className="sidebar-menu-item"
        type="button"
        role="menuitem"
        onClick={() => {
          onClose();
          document.dispatchEvent(new CustomEvent("polus:open-dialog", { detail: { id: "settings-dialog" } }));
        }}
      >
        <span className="settings-gear-icon" aria-hidden="true">⚙</span>
        <span>{language === "ru" ? "Настройки" : "Settings"}</span>
      </button>
      <div className="sidebar-menu-divider" role="separator" />
      <button
        id="create-group"
        className="sidebar-menu-item"
        type="button"
        role="menuitem"
        onClick={() => {
          onClose();
          document.dispatchEvent(new CustomEvent("polus:open-dialog", { detail: { id: "group-dialog" } }));
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="9" cy="8" r="3.2" />
          <path d="M3 19c0-3.2 2.7-5 6-5s6 1.8 6 5" />
          <path d="M16 5.2a3 3 0 0 1 0 5.6M18 14.3c1.9.6 3 2 3 4.7" />
        </svg>
        <span>{language === "ru" ? "Новая группа" : "New group"}</span>
      </button>
      <button
        id="create-channel"
        className="sidebar-menu-item"
        type="button"
        role="menuitem"
        onClick={() => {
          onClose();
          document.dispatchEvent(new CustomEvent("polus:open-dialog", { detail: { id: "channel-dialog" } }));
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 10v4l9 4V6L4 10Z" />
          <path d="M17 9.5a4 4 0 0 1 0 5M7 15l1.2 4.5h2.6L9.8 16" />
        </svg>
        <span>{language === "ru" ? "Новый канал" : "New channel"}</span>
      </button>
      <button
        id="find-people"
        className="sidebar-menu-item"
        type="button"
        role="menuitem"
        onClick={() => {
          onClose();
          document.dispatchEvent(new CustomEvent("polus:find-people"));
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4.5 4.5" />
        </svg>
        <span>{language === "ru" ? "Найти людей" : "Find people"}</span>
      </button>
    </div>
  );
}

function SettingsDialog() {
  const language = useCurrentLanguage();
  const setLanguage = useSetLanguage();
  const russian = language === "ru";

  return (
    <dialog id="settings-dialog" className="dialog settings-dialog">
      <form method="dialog" className="dialog-top">
        <div>
          <div className="eyebrow">{russian ? "ПРИЛОЖЕНИЕ" : "APP"}</div>
          <h2 id="settings-title">{russian ? "Настройки" : "Settings"}</h2>
        </div>
        <button className="icon-button dialog-close" value="cancel" aria-label={russian ? "Закрыть" : "Close"}>×</button>
      </form>
      <label className="settings-row" htmlFor="settings-language">
        <span className="settings-row-copy">
          <strong>{russian ? "Язык приложения" : "App language"}</strong>
          <small>{russian ? "Выберите язык интерфейса" : "Choose the interface language"}</small>
        </span>
        <select
          id="settings-language"
          className="language-select settings-language-select"
          value={language}
          onChange={(event) => setLanguage(event.target.value)}
        >
          <option value="ru">Русский</option>
          <option value="en">English</option>
        </select>
      </label>
      <AppearanceSettings />
    </dialog>
  );
}

function AppearanceSettings() {
  const language = useCurrentLanguage();
  const theme = useCurrentTheme();
  const setTheme = useSetTheme();
  const messageSound = useCurrentMessageSound();
  const setMessageSound = useSetMessageSound();
  const russian = language === "ru";

  return (
    <section className="appearance-settings">
      <div className="settings-section-heading">
        <h3>{russian ? "Оформление" : "Appearance"}</h3>
        <p>{russian ? "Выберите цветовую тему приложения" : "Choose the app color theme"}</p>
      </div>
      <div className="theme-picker" role="group" aria-label={russian ? "Темы оформления" : "App themes"}>
        {THEME_OPTIONS.map((option) => (
          <button
            type="button"
            className={`theme-option${theme === option.id ? " is-selected" : ""}`}
            key={option.id}
            aria-pressed={theme === option.id}
            onClick={() => setTheme(option.id)}
          >
            <span className="theme-preview" aria-hidden="true">
              {option.colors.map((color) => <i key={color} style={{ backgroundColor: color }} />)}
            </span>
            <span>{option.labels[language]}</span>
            {theme === option.id && <span className="theme-check" aria-hidden="true">✓</span>}
          </button>
        ))}
      </div>
      <label className="settings-row" htmlFor="settings-message-sound">
        <span className="settings-row-copy">
          <strong>{russian ? "Звук новых сообщений" : "New message sound"}</strong>
          <small>{russian ? "Короткий сигнал при получении сообщения" : "Play a short sound when a message arrives"}</small>
        </span>
        <input
          id="settings-message-sound"
          className="settings-theme-toggle"
          type="checkbox"
          checked={messageSound}
          onChange={(event) => {
            if (event.target.checked) prepareNotificationSound();
            setMessageSound(event.target.checked);
          }}
        />
      </label>
    </section>
  );
}

function ProfileAvatarEditor({ inputRef }) {
  const [snapshot, setSnapshot] = useState({ user: null, previewUrl: "", fileName: "" });
  const language = useCurrentLanguage();
  const [inputKey, setInputKey] = useState(0);
  useLayoutEffect(() => {
    const onPreview = (event) => setSnapshot(event.detail);
    const onClear = () => setInputKey((key) => key + 1);
    document.addEventListener("polus:profile-avatar-preview-changed", onPreview);
    document.addEventListener("polus:profile-avatar-clear", onClear);
    return () => {
      document.removeEventListener("polus:profile-avatar-preview-changed", onPreview);
      document.removeEventListener("polus:profile-avatar-clear", onClear);
    };
  }, []);
  const hint = language === "ru" ? "Выберите изображение до 5 МБ" : "Choose an image up to 5 MB";
  const avatarTitle = language === "ru" ? "Фото профиля" : "Profile photo";
  const chooseAvatar = language === "ru" ? "Выбрать фото" : "Choose photo";
  const user = snapshot.user;

  return (
    <div className="profile-avatar-editor">
      <div id="profile-avatar-preview" className="profile-avatar-preview" aria-hidden="true">
        {snapshot.previewUrl
          ? <img src={snapshot.previewUrl} alt="" />
          : user?.avatarUrl ? <AuthenticatedImage src={user.avatarUrl} alt="" /> : initials(user?.fullName || "")}
      </div>
      <div className="profile-avatar-picker-copy">
        <strong>{avatarTitle}</strong>
        <small id="profile-avatar-filename">{snapshot.fileName || hint}</small>
      </div>
      <input
        id="profile-avatar-input"
        key={inputKey}
        ref={inputRef}
        className="visually-hidden"
        type="file"
        accept="image/*"
        onChange={(event) => document.dispatchEvent(new CustomEvent("polus:profile-avatar-selected", {
          detail: { file: event.currentTarget.files?.[0] || null }
        }))}
      />
      <label className="profile-avatar-picker" htmlFor="profile-avatar-input">
        <span>{chooseAvatar}</span>
      </label>
    </div>
  );
}

function ProfileAccountForm({ initialUser }) {
  const avatarInput = useRef(null);
  const language = useCurrentLanguage();
  const [user, setUser] = useState(initialUser || null);
  const [values, setValues] = useState({
    fullName: initialUser?.fullName || "", about: initialUser?.about || "",
    showOnlineStatus: initialUser?.showOnlineStatus !== false,
    hideNotificationContent: initialUser?.hideNotificationContent === true,
    currentPassword: "", newPassword: "", keyUnlockPassword: ""
  });
  const [sessions, setSessions] = useState([]);
  const [sessionsError, setSessionsError] = useState("");
  const [revokingSessions, setRevokingSessions] = useState(false);
  const request = useFormRequest("polus:save-profile", "profile-error");

  useEffect(() => {
    let active = true;
    requestJson("/api/account/sessions").then(({ sessions: activeSessions }) => {
      if (active) setSessions(activeSessions);
    }).catch((cause) => {
      if (active) setSessionsError(cause.message);
    });
    return () => { active = false; };
  }, []);

  useLayoutEffect(() => {
    const onUser = (event) => {
      const current = event.detail;
      setUser(current);
      if (current) {
        setValues({
          fullName: current.fullName,
          about: current.about || "",
          showOnlineStatus: current.showOnlineStatus !== false,
          hideNotificationContent: current.hideNotificationContent === true,
          currentPassword: "",
          newPassword: "",
          keyUnlockPassword: "",
        });
      }
    };
    const onPrepare = () => {
      if (!user) return;
      setValues({
        fullName: user.fullName,
        about: user.about || "",
        showOnlineStatus: user.showOnlineStatus !== false,
        hideNotificationContent: user.hideNotificationContent === true,
        currentPassword: "",
        newPassword: "",
        keyUnlockPassword: "",
      });
      document.dispatchEvent(new CustomEvent("polus:profile-avatar-preview-changed", {
        detail: { user, previewUrl: "", fileName: "" }
      }));
      document.dispatchEvent(new CustomEvent("polus:profile-avatar-clear"));
      document.dispatchEvent(new CustomEvent("polus:form-error-clear", { detail: { id: "profile-error" } }));
    };
    const onProfileSaved = (event) => {
      const current = event.detail.user;
      setUser(current);
      setValues({
        fullName: current.fullName,
        about: current.about || "",
        showOnlineStatus: current.showOnlineStatus !== false,
        hideNotificationContent: current.hideNotificationContent === true,
        currentPassword: "",
        newPassword: "",
        keyUnlockPassword: "",
      });
    };
    document.addEventListener("polus:current-user-changed", onUser);
    document.addEventListener("polus:prepare-profile", onPrepare);
    document.addEventListener("polus:profile-saved", onProfileSaved);
    return () => {
      document.removeEventListener("polus:current-user-changed", onUser);
      document.removeEventListener("polus:prepare-profile", onPrepare);
      document.removeEventListener("polus:profile-saved", onProfileSaved);
    };
  }, [user]);

  const update = (key) => (event) => setValues((current) => ({
    ...current,
    [key]: event.target.type === "checkbox" ? event.target.checked : event.target.value
  }));
  const field = (key) => ({
    value: values[key],
    onChange: update(key),
    disabled: request.submitting
  });
  const revokeAllSessions = async () => {
    const russian = language === "ru";
    if (!values.currentPassword) {
      setSessionsError(russian ? "Введите текущий пароль для подтверждения." : "Enter your current password to confirm.");
      return;
    }
    if (!window.confirm(russian
      ? "Отозвать все активные сессии, включая эту? Потребуется войти снова."
      : "Revoke every active session, including this one? You will need to sign in again.")) return;
    setSessionsError("");
    setRevokingSessions(true);
    try {
      await requestJson("/api/account/sessions/revoke-all", {
        method: "POST",
        body: JSON.stringify({ currentPassword: values.currentPassword })
      });
      document.dispatchEvent(new CustomEvent("polus:account-session-invalid", {
        detail: { accountKey: getActiveAccountKey() }
      }));
    } catch (cause) {
      setSessionsError(cause.message === "Current password is incorrect." && russian
        ? "Неверный текущий пароль."
        : cause.message);
    } finally {
      setRevokingSessions(false);
    }
  };

  return (
    <form
      id="profile-form"
      method="post"
      action="/api/forms-disabled"
      className="dialog-form"
      onSubmit={(event) => {
        const avatarFile = avatarInput.current?.files?.[0] || null;
        void request.submit(event, { ...values, avatarFile });
      }}
    >
      <div className="profile-form-fields">
        <ProfileAvatarEditor inputRef={avatarInput} />
        <div className="profile-form-field">
          <label className="field-label" htmlFor="profile-full-name">{language === "ru" ? "Имя и фамилия" : "Full name"}</label>
          <input id="profile-full-name" className="text-field" maxLength={50} required {...field("fullName")} />
        </div>
        <div className="profile-form-field">
          <label className="field-label" htmlFor="profile-about">{language === "ru" ? "О себе (необязательно)" : "About (optional)"}</label>
          <textarea id="profile-about" className="text-field about-field" maxLength={200} rows={3} {...field("about")} />
        </div>
      </div>
      <section id="profile-privacy" className="profile-form-section">
        <h3>{language === "ru" ? "Приватность" : "Privacy"}</h3>
        <p>{language === "ru" ? "Настройте видимость статуса и текста уведомлений." : "Control your online visibility and notification previews."}</p>
        <label className="profile-toggle">
          <input id="profile-show-online" type="checkbox" checked={values.showOnlineStatus} onChange={update("showOnlineStatus")} disabled={request.submitting} />
          <span>{language === "ru" ? "Показывать статус «в сети»" : "Show online status"}</span>
        </label>
        <label className="profile-toggle">
          <input id="profile-hide-notification-content" type="checkbox" checked={values.hideNotificationContent} onChange={update("hideNotificationContent")} disabled={request.submitting} />
          <span>{language === "ru" ? "Скрывать текст сообщений в уведомлениях" : "Hide message text in notifications"}</span>
        </label>
      </section>
      <section id="profile-security" className="profile-form-section">
        <h3>{language === "ru" ? "Безопасность" : "Security"}</h3>
        <p>{language === "ru" ? "Ключ шифрования общий для этого сервера и настраивается администратором в .env. Для старого ключа укажите пароль или фразу, которыми он был запечатан." : "The encryption key is shared by this server and configured by the administrator in .env. For an older key, provide the password or phrase that sealed it."}</p>
        <div className="profile-form-fields">
          <div className="profile-form-field">
            <label className="field-label" htmlFor="profile-current-password">
              {language === "ru" ? "Текущий пароль" : "Current password"}
            </label>
            <input id="profile-current-password" className="text-field" type="password" autoComplete="current-password" {...field("currentPassword")} />
          </div>
          <div className="profile-form-field">
            <label className="field-label" htmlFor="profile-new-password">
              {language === "ru" ? "Новый пароль" : "New password"}
            </label>
            <input id="profile-new-password" className="text-field" type="password" minLength={8} maxLength={128} autoComplete="new-password" {...field("newPassword")} />
          </div>
          <div className="profile-form-field">
            <label className="field-label" htmlFor="profile-key-unlock-password">
              {language === "ru" ? "Старый пароль или фраза, которыми запечатан ключ (если отличаются)" : "Previous password or phrase that sealed the key (if different)"}
            </label>
            <input id="profile-key-unlock-password" className="text-field" type="password" autoComplete="current-password" {...field("keyUnlockPassword")} />
          </div>
        </div>
        <div className="profile-active-sessions">
          <h4>{language === "ru" ? "Активные сессии" : "Active sessions"}</h4>
          {sessions.length
            ? <ul>
              {sessions.map((session) => (
                <li key={session.id}>
                  <strong>{session.isCurrent
                    ? (language === "ru" ? "Это устройство" : "This device")
                    : (language === "ru" ? "Другое устройство" : "Other device")}</strong>
                  <span>{language === "ru" ? "Вход: " : "Signed in: "}
                    {new Date(session.createdAt).toLocaleString(language === "ru" ? "ru-RU" : "en-US")}</span>
                  <span>{language === "ru" ? "Срок действия до: " : "Expires: "}
                    {new Date(session.expiresAt).toLocaleString(language === "ru" ? "ru-RU" : "en-US")}</span>
                </li>
              ))}
            </ul>
            : <p>{language === "ru" ? "Нет других активных сессий." : "No active sessions."}</p>}
          {sessionsError && <div className="form-error" role="alert">{sessionsError}</div>}
          <button
            className="secondary-button"
            type="button"
            disabled={revokingSessions || sessions.length === 0}
            onClick={() => void revokeAllSessions()}
          >
            {revokingSessions
              ? "…"
              : language === "ru" ? "Отозвать все сессии" : "Revoke all sessions"}
          </button>
        </div>
      </section>
      <FormError id="profile-error" />
      <button className="primary-button" type="submit" disabled={request.submitting}>
        {language === "ru" ? "Сохранить" : "Save"}
      </button>
    </form>
  );
}

const DEFAULT_PROFILE_DESIGN = {
  theme: "aurora",
  accentColor: "#4d83d1",
  font: "system",
  motionEnabled: true,
  gradientStart: "#101927",
  gradientEnd: "#344f82",
  gradientDirection: "diagonal",
  effects: "glow",
  avatarFrame: "gradient",
  animation: "subtle",
  backgroundImageEnabled: false,
  coverParallax: false
};

function ProfileDesignEditor({ user }) {
  const language = useCurrentLanguage();
  const russian = language === "ru";
  const [design, setDesign] = useState(() => ({ ...DEFAULT_PROFILE_DESIGN, ...(user.profileDesign || {}) }));
  const [coverFile, setCoverFile] = useState(null);
  const [coverPreview, setCoverPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const isVideoCover = coverFile?.type.startsWith("video/");

  const updateDesign = (changes) => {
    setDesign((current) => ({ ...current, ...changes }));
    setSaved(false);
  };

  useEffect(() => {
    if (!coverFile) {
      setCoverPreview("");
      return undefined;
    }
    const preview = URL.createObjectURL(coverFile);
    setCoverPreview(preview);
    return () => URL.revokeObjectURL(preview);
  }, [coverFile]);

  const save = async () => {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      if (coverFile) {
        await requestJson("/api/account/profile-cover", {
          method: "POST",
          headers: { "Content-Type": coverFile.type || "application/octet-stream" },
          body: coverFile
        });
      }
      const { user: updatedUser } = await requestJson("/api/account/profile-design", {
        method: "PATCH",
        body: JSON.stringify(design)
      });
      setCoverFile(null);
      setDesign(updatedUser.profileDesign || DEFAULT_PROFILE_DESIGN);
      document.dispatchEvent(new CustomEvent("polus:profile-saved", { detail: { user: updatedUser } }));
      setSaved(true);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  };

  const removeCover = async () => {
    setBusy(true);
    setError("");
    try {
      const { user: updatedUser } = await requestJson("/api/account/profile-cover", { method: "DELETE" });
      setCoverFile(null);
      setDesign((current) => ({ ...current, backgroundImageEnabled: false }));
      document.dispatchEvent(new CustomEvent("polus:profile-saved", { detail: { user: updatedUser } }));
      setSaved(true);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  };

  const resetDesign = () => {
    setDesign({ ...DEFAULT_PROFILE_DESIGN });
    setCoverFile(null);
    setSaved(false);
  };
  const showError = (cause) => setError(cause.status === 404
    ? russian
      ? "Сервер не поддерживает настройки оформления профиля. Обновите приложение на сервере и перезапустите его."
      : "This server does not support profile design settings yet. Update and restart the server."
    : cause.message);

  return (
    <div className="profile-design-editor">
      <div className="profile-form-fields">
        <div className="profile-form-field">
          <label className="field-label" htmlFor="public-profile-theme">{russian ? "Тема страницы" : "Profile theme"}</label>
          <select
            id="public-profile-theme"
            className="text-field"
            value={design.theme}
            disabled={busy}
            onChange={(event) => updateDesign({
              theme: event.target.value,
              ...(event.target.value === "ocean" ? { gradientStart: "#dff7f8", gradientEnd: "#b9dbe8" }
                : event.target.value === "sunset" ? { gradientStart: "#fff0df", gradientEnd: "#e9c2c9" }
                  : { gradientStart: "#101927", gradientEnd: "#344f82" })
            })}
          >
            <option value="aurora">{russian ? "Северное сияние" : "Northern lights"}</option>
            <option value="ocean">{russian ? "Океан" : "Ocean"}</option>
            <option value="sunset">{russian ? "Закат" : "Sunset"}</option>
          </select>
        </div>
        <div className="profile-form-field">
          <label className="field-label" htmlFor="public-profile-accent">{russian ? "Акцентный цвет" : "Accent color"}</label>
          <input
            id="public-profile-accent"
            className="text-field profile-design-color"
            type="color"
            value={design.accentColor}
            disabled={busy}
            onChange={(event) => updateDesign({ accentColor: event.target.value })}
          />
        </div>
        <div className="profile-form-field">
          <label className="field-label" htmlFor="public-profile-font">{russian ? "Шрифт" : "Font"}</label>
          <select
            id="public-profile-font"
            className="text-field"
            value={design.font}
            disabled={busy}
            onChange={(event) => updateDesign({ font: event.target.value })}
          >
            <option value="system">{russian ? "Системный" : "System"}</option>
            <option value="rounded">{russian ? "Округлый" : "Rounded"}</option>
            <option value="serif">{russian ? "С засечками" : "Serif"}</option>
          </select>
        </div>
      </div>
      <label className="profile-toggle">
        <input
          type="checkbox"
          checked={design.motionEnabled}
          disabled={busy}
          onChange={(event) => updateDesign({ motionEnabled: event.target.checked })}
        />
        <span>{russian ? "Ненавязчивые анимации" : "Subtle animations"}</span>
      </label>
      <div className="profile-form-fields profile-design-custom-fields">
        <div className="profile-form-field">
          <label className="field-label" htmlFor="public-profile-gradient-start">{russian ? "Цвет начала градиента" : "Gradient start"}</label>
          <input id="public-profile-gradient-start" className="text-field profile-design-color" type="color" value={design.gradientStart} disabled={busy} onChange={(event) => updateDesign({ gradientStart: event.target.value })} />
        </div>
        <div className="profile-form-field">
          <label className="field-label" htmlFor="public-profile-gradient-end">{russian ? "Цвет конца градиента" : "Gradient end"}</label>
          <input id="public-profile-gradient-end" className="text-field profile-design-color" type="color" value={design.gradientEnd} disabled={busy} onChange={(event) => updateDesign({ gradientEnd: event.target.value })} />
        </div>
        <div className="profile-form-field">
          <label className="field-label" htmlFor="public-profile-gradient-direction">{russian ? "Направление градиента" : "Gradient direction"}</label>
          <select id="public-profile-gradient-direction" className="text-field" value={design.gradientDirection} disabled={busy} onChange={(event) => updateDesign({ gradientDirection: event.target.value })}>
            <option value="diagonal">{russian ? "Диагональ" : "Diagonal"}</option>
            <option value="horizontal">{russian ? "Горизонтально" : "Horizontal"}</option>
            <option value="vertical">{russian ? "Вертикально" : "Vertical"}</option>
          </select>
        </div>
        <div className="profile-form-field">
          <label className="field-label" htmlFor="public-profile-effects">{russian ? "Декоративный эффект" : "Decorative effect"}</label>
          <select id="public-profile-effects" className="text-field" value={design.effects} disabled={busy} onChange={(event) => updateDesign({ effects: event.target.value })}>
            <option value="none">{russian ? "Без эффектов" : "None"}</option>
            <option value="glow">{russian ? "Свечение" : "Glow"}</option>
            <option value="particles">{russian ? "Мягкие частицы" : "Soft particles"}</option>
          </select>
        </div>
        <div className="profile-form-field">
          <label className="field-label" htmlFor="public-profile-avatar-frame">{russian ? "Рамка аватара" : "Avatar frame"}</label>
          <select id="public-profile-avatar-frame" className="text-field" value={design.avatarFrame} disabled={busy} onChange={(event) => updateDesign({ avatarFrame: event.target.value })}>
            <option value="gradient">{russian ? "Градиентная" : "Gradient"}</option>
            <option value="glow">{russian ? "Сияющая" : "Glow"}</option>
            <option value="double">{russian ? "Двойная" : "Double"}</option>
            <option value="none">{russian ? "Без рамки" : "None"}</option>
          </select>
        </div>
        <div className="profile-form-field">
          <label className="field-label" htmlFor="public-profile-animation">{russian ? "Анимация" : "Animation"}</label>
          <select id="public-profile-animation" className="text-field" value={design.animation} disabled={busy} onChange={(event) => updateDesign({ animation: event.target.value })}>
            <option value="subtle">{russian ? "Плавная" : "Subtle"}</option>
            <option value="float">{russian ? "Парение" : "Float"}</option>
            <option value="gradient">{russian ? "Живой градиент" : "Animated gradient"}</option>
            <option value="none">{russian ? "Без анимации" : "None"}</option>
          </select>
        </div>
      </div>
      <label className="profile-cover-picker">
        <span>{russian ? "Обложка (изображение, GIF или MP4/WebM, до 8 МБ)" : "Cover (image, GIF or MP4/WebM, up to 8 MB)"}</span>
        <input
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm"
          disabled={busy}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0] || null;
            if (file && file.size > 8 * 1024 * 1024) {
              setError(russian ? "Файл обложки должен быть не больше 8 МБ." : "Cover files must not exceed 8 MB.");
              setCoverFile(null);
              return;
            }
            setError("");
            setCoverFile(file);
            if (file?.type.startsWith("video/")) updateDesign({ backgroundImageEnabled: false });
            setSaved(false);
          }}
        />
      </label>
      <label className="profile-toggle">
        <input type="checkbox" checked={design.backgroundImageEnabled} disabled={busy || isVideoCover || (!coverFile && !user.profileCoverUrl) || (!coverFile && user.profileCoverMimeType?.startsWith("video/"))} onChange={(event) => updateDesign({ backgroundImageEnabled: event.target.checked })} />
        <span>{russian ? "Использовать обложку как фон страницы" : "Use cover as page background"}</span>
      </label>
      <label className="profile-toggle">
        <input type="checkbox" checked={design.coverParallax} disabled={busy || !design.motionEnabled} onChange={(event) => updateDesign({ coverParallax: event.target.checked })} />
        <span>{russian ? "Параллакс обложки" : "Cover parallax"}</span>
      </label>
      <div
        className={`profile-design-preview profile-theme-${design.theme} profile-font-${design.font} profile-effects-${design.effects} profile-animation-${design.animation}${design.motionEnabled ? "" : " reduce-profile-motion"}`}
        style={{
          "--profile-accent": design.accentColor,
          "--profile-gradient-start": design.gradientStart,
          "--profile-gradient-end": design.gradientEnd,
          "--profile-gradient-angle": design.gradientDirection === "horizontal" ? "90deg" : design.gradientDirection === "vertical" ? "180deg" : "145deg"
        }}
      >
        {coverPreview
          ? isVideoCover
            ? <video src={coverPreview} muted autoPlay loop playsInline aria-hidden="true" />
            : <img src={coverPreview} alt="" />
          : user.profileCoverUrl && (user.profileCoverMimeType?.startsWith("video/")
            ? <AuthenticatedVideo src={user.profileCoverUrl} muted autoPlay loop playsInline aria-hidden="true" />
            : <AuthenticatedImage src={user.profileCoverUrl} alt="" />)}
        <span className={`profile-design-preview-avatar profile-avatar-frame-${design.avatarFrame}`} aria-hidden="true">
          {user.avatarUrl ? <AuthenticatedImage src={user.avatarUrl} alt="" /> : initials(user.fullName)}
        </span>
        {design.effects === "particles" && <span className="profile-design-preview-particles" aria-hidden="true" />}
        <div className="profile-design-preview-copy">
          <span>{russian ? "Предпросмотр" : "Preview"}</span>
          <strong>{user.fullName}</strong>
          <small>@{user.username}</small>
        </div>
      </div>
      {user.profileCoverUrl && !coverFile && (
        <button className="text-button profile-cover-remove" type="button" disabled={busy} onClick={() => void removeCover()}>
          {russian ? "Удалить обложку" : "Remove cover"}
        </button>
      )}
      {error && <div className="form-error" role="alert">{error}</div>}
      {saved && <p className="profile-design-saved" role="status">{russian ? "Оформление сохранено." : "Profile design saved."}</p>}
      <div className="profile-design-actions">
        <button className="secondary-button" type="button" disabled={busy} onClick={resetDesign}>
          {russian ? "Сбросить оформление" : "Reset design"}
        </button>
        <button className="primary-button" type="button" disabled={busy} onClick={() => void save()}>
          {busy ? "…" : russian ? "Сохранить оформление" : "Save design"}
        </button>
      </div>
    </div>
  );
}

function ProfileSettingsPage({ user, onBack, onUserUpdate }) {
  const language = useCurrentLanguage();
  const setLanguage = useSetLanguage();
  const russian = language === "ru";
  const [profile, setProfile] = useState(user);
  const [activeSection, setActiveSection] = useState(() => window.location.hash.slice(1) || "profile-account");

  useLayoutEffect(() => {
    const onSaved = (event) => {
      setProfile(event.detail.user);
      onUserUpdate(event.detail.user);
    };
    document.addEventListener("polus:profile-saved", onSaved);
    return () => document.removeEventListener("polus:profile-saved", onSaved);
  }, [onUserUpdate]);

  useEffect(() => {
    const updateActiveSection = () => {
      setActiveSection(window.location.hash.slice(1) || "profile-account");
    };
    window.addEventListener("hashchange", updateActiveSection);
    return () => window.removeEventListener("hashchange", updateActiveSection);
  }, []);

  return (
    <main className="profile-page">
      <header className="profile-page-header">
        <button className="icon-button profile-page-back" type="button" onClick={onBack}>
          <span aria-hidden="true">←</span>
          {russian ? "К чатам" : "Back to chats"}
        </button>
        <div className="profile-page-title">
          <h1>{russian ? "Профиль и настройки" : "Profile & settings"}</h1>
        </div>
      </header>
      <div className="profile-page-layout">
        <aside className="profile-page-sidebar">
          <div className="profile-page-user">
            <div className="profile-page-avatar">
              {profile?.avatarUrl ? <AuthenticatedImage src={profile.avatarUrl} alt="" /> : initials(profile?.fullName || "")}
            </div>
            <div className="profile-page-user-copy">
              <strong>{profile?.fullName || ""}</strong>
              <span>@{profile?.username || ""}</span>
            </div>
          </div>
          <nav className="profile-page-nav" aria-label={russian ? "Разделы настроек" : "Settings sections"}>
            <a href="#profile-account" aria-current={activeSection === "profile-account" ? "page" : undefined}>{russian ? "Профиль" : "Profile"}</a>
            <a href="#profile-privacy" aria-current={activeSection === "profile-privacy" ? "page" : undefined}>{russian ? "Приватность" : "Privacy"}</a>
            <a href="#profile-security" aria-current={activeSection === "profile-security" ? "page" : undefined}>{russian ? "Безопасность" : "Security"}</a>
            <a href="#profile-appearance" aria-current={activeSection === "profile-appearance" ? "page" : undefined}>{russian ? "Оформление" : "Appearance"}</a>
          </nav>
          <div className="profile-page-sidebar-footer">
            <a href="/privacy" target="_blank" rel="noopener">
              {russian ? "Политика конфиденциальности" : "Privacy policy"}
            </a>
            <button
              id="profile-page-logout"
              className="profile-page-signout"
              type="button"
              onClick={() => document.dispatchEvent(new CustomEvent("polus:sign-out"))}
            >{russian ? "Выйти из аккаунта" : "Sign out"}</button>
          </div>
        </aside>
        <div className="profile-page-content">
          <section id="profile-account" className="profile-page-section">
            <div className="profile-page-section-title">
              <h2>{russian ? "Профиль" : "Profile"}</h2>
              <p>{russian ? "Личные данные и пароль аккаунта." : "Your personal details and account password."}</p>
            </div>
            <ProfileAccountForm initialUser={profile} />
          </section>
          <section id="profile-appearance" className="profile-page-section">
            <div className="profile-page-section-title">
              <h2>{russian ? "Оформление" : "Appearance"}</h2>
              <p>{russian ? "Язык и тема интерфейса сохраняются на этом устройстве. Оформление публичной страницы видно другим пользователям." : "Interface settings are saved on this device. Your public profile design is visible to other users."}</p>
            </div>
            <ProfileDesignEditor user={profile || user} />
            <label className="settings-row profile-language-row" htmlFor="profile-settings-language">
              <span className="settings-row-copy">
                <strong>{russian ? "Язык приложения" : "App language"}</strong>
                <small>{russian ? "Язык интерфейса" : "Interface language"}</small>
              </span>
              <select
                id="profile-settings-language"
                className="language-select settings-language-select"
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
              >
                <option value="ru">Русский</option>
                <option value="en">English</option>
              </select>
            </label>
            <AppearanceSettings />
          </section>
        </div>
      </div>
    </main>
  );
}

function ChannelProfilePage({ channelId, onBack, onOpenChat }) {
  const language = useCurrentLanguage();
  const russian = language === "ru";
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    requestJson(`/api/channels/${encodeURIComponent(channelId)}/profile`)
      .then((response) => {
        if (!active) return;
        if (response.chat.joined) {
          onOpenChat(response.chat, { replaceHistory: true });
          return;
        }
        setProfile(response);
      })
      .catch((cause) => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, [channelId, onOpenChat]);

  const openOrJoin = async () => {
    setBusy(true);
    setError("");
    try {
      const conversation = await requestJson(`/api/channels/${encodeURIComponent(channelId)}/join`, {
        method: "POST"
      });
      onOpenChat(conversation);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="community-page">
      <header className="community-page-header">
        <button className="icon-button profile-page-back" type="button" onClick={onBack}>
          <span aria-hidden="true">←</span>{russian ? "Назад" : "Back"}
        </button>
        <h1>{russian ? "Профиль канала" : "Channel profile"}</h1>
      </header>
      {error && <div className="form-error" role="alert">{error}</div>}
      {!profile && !error && <p className="community-page-loading">{russian ? "Загрузка…" : "Loading…"}</p>}
      {profile && (
        <section className="community-profile-card">
          <span className="community-profile-icon" aria-hidden="true">#</span>
          <h2>{profile.chat.name}</h2>
          <p className="community-member-count">
            {profile.memberCount} {russian ? "участников" : "members"}
          </p>
          {profile.chat.description && <p className="community-description">{profile.chat.description}</p>}
          <button className="primary-button" type="button" disabled={busy} onClick={() => void openOrJoin()}>
            {russian ? "Вступить в канал" : "Join channel"}
          </button>
        </section>
      )}
    </main>
  );
}

function ChannelSettingsPage({ channelId, onBack, onProfile }) {
  const language = useCurrentLanguage();
  const russian = language === "ru";
  const [chat, setChat] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [activeSection, setActiveSection] = useState("info");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const onDirtyChange = useCallback((dirty) => setHasUnsavedChanges(dirty), []);
  const confirmDiscard = useCallback(() => !hasUnsavedChanges || window.confirm(
    russian
      ? "Есть несохранённые изменения. Покинуть раздел и потерять их?"
      : "You have unsaved changes. Leave this section and discard them?"
  ), [hasUnsavedChanges, russian]);
  const goBack = useCallback(() => {
    if (confirmDiscard()) onBack();
  }, [confirmDiscard, onBack]);
  const openProfile = useCallback(() => {
    if (confirmDiscard()) onProfile();
  }, [confirmDiscard, onProfile]);

  useEffect(() => {
    const onManagement = (event) => {
      const detail = event.detail;
      const currentRole = detail?.members?.find((member) => member.id === detail.currentUserId)?.role;
      setChat(detail?.chat ? { ...detail.chat, role: currentRole || "member" } : null);
    };
    setLoadError("");
    document.addEventListener("polus:chat-management-changed", onManagement);
    let active = true;
    Promise.all([
      requestJson(`/api/chats/${encodeURIComponent(channelId)}`),
      requestJson("/api/auth/me")
    ]).then(([management, { user: currentUser }]) => {
      if (!active) return;
      const roleLabels = {
        owner: russian ? "Владелец" : "Owner",
        admin: russian ? "Администратор" : "Administrator",
        member: russian ? "Участник" : "Member"
      };
      const currentRole = management.members.find((member) => member.id === currentUser.id)?.role || "member";
      document.dispatchEvent(new CustomEvent("polus:chat-management-changed", {
        detail: {
          ...management,
          chat: { ...management.chat, role: currentRole, inviteUrl: management.inviteUrl },
          members: management.members.map((member) => ({
            ...member,
            roleLabel: roleLabels[member.role] || member.role
          })),
          currentUserId: currentUser.id,
          labels: {
            chatMembers: russian ? "Участники чата" : "Chat members",
            makeAdmin: russian ? "Назначить администратором" : "Make administrator",
            removeAdmin: russian ? "Снять администратора" : "Remove administrator",
            remove: russian ? "Удалить" : "Remove",
            channelPostIdentity: russian ? "Публиковать сообщения от имени" : "Post messages as",
            channelPrivacy: russian ? "Приватность канала" : "Channel privacy",
            groupPrivacy: russian ? "Доступ к группе" : "Group access",
            publicGroup: russian ? "Публичная — видна в поиске, вступить может любой" : "Public — discoverable and open to join",
            privateGroup: russian ? "Приватная — только по приглашению" : "Private — invite only",
            channelDetails: russian ? "Основная информация" : "Channel details",
            channelName: russian ? "Название канала" : "Channel name",
            channelDescription: russian ? "Описание канала" : "Channel description",
            saveChannelDetails: russian ? "Сохранить изменения" : "Save changes",
            saving: russian ? "Сохранение…" : "Saving…",
            invitationSettings: russian ? "Приглашения" : "Invitations",
            invitationHelp: russian
              ? "Создайте ссылку или добавьте участника по имени пользователя."
              : "Create an invite link or add a member by username.",
            linkCopied: russian ? "Ссылка скопирована" : "Link copied",
            noInviteLink: russian ? "Пригласительная ссылка ещё не создана." : "No invite link has been created yet.",
            rotateInviteLink: russian ? "Обновить ссылку" : "Refresh link",
            administration: russian ? "Управление каналом" : "Channel administration",
            publicChannel: russian ? "Публичный — отображается в списке каналов" : "Public — shown in the channel list",
            privateChannel: russian ? "Частный — доступен только по ссылке" : "Private — available only by invite link",
            inviteLink: russian ? "Пригласительная ссылка" : "Invite link",
            createInviteLink: russian ? "Создать ссылку" : "Create link",
            copyInviteLink: russian ? "Скопировать ссылку" : "Copy link",
            revokeInviteLink: russian ? "Отозвать ссылку" : "Revoke link",
            postAsPerson: russian ? "Автора" : "Author",
            postAsChannel: russian ? "Канала" : "Channel",
            usernamePlaceholder: "@username",
            inviteMember: russian ? "Добавить участника" : "Add member",
            subscribers: russian ? "Подписчики" : "Subscribers",
            administrators: russian ? "Администраторы" : "Administrators",
            appearance: russian ? "Внешний вид" : "Appearance",
            appearanceUnavailable: russian ? "Настройки изображения и оформления канала пока не поддерживаются." : "Channel image and appearance settings are not supported yet.",
            publishing: russian ? "Управление публикациями" : "Publishing",
            postIdentityHelp: russian ? "Выберите, от чьего имени будут публиковаться сообщения администраторов." : "Choose whose identity administrators use when publishing messages.",
            permissions: russian ? "Права доступа" : "Permissions",
            pinPostsUnavailable: russian ? "Закрепление публикаций в канале пока не поддерживается." : "Pinning channel posts is not supported yet.",
            notifications: russian ? "Уведомления" : "Notifications",
            channelNotifications: russian ? "Уведомления об активности канала" : "Channel activity notifications",
            channelNotificationsHelp: russian ? "Настройка действует только для вашего аккаунта." : "This setting applies only to your account.",
            notAvailable: russian ? "Эта возможность пока не поддерживается." : "This feature is not available yet.",
            ownerOnly: russian ? "Изменять эту настройку может только владелец канала." : "Only the channel owner can change this setting.",
            managersOnly: russian ? "Изменять эту настройку могут только владелец и администраторы канала." : "Only the owner and channel administrators can change this setting.",
            noAdministrators: russian ? "В канале пока нет администраторов." : "There are no channel administrators yet.",
            yourAdminPermissions: russian ? "Разрешения, назначенные вам владельцем канала." : "Permissions assigned to you by the channel owner.",
            adminPermissionOptions: russian ? [
              { id: "publish", label: "Публиковать сообщения", description: "Разрешить отправлять сообщения и файлы в канал." },
              { id: "editMessages", label: "Редактировать сообщения", description: "Разрешить редактировать сообщения канала, в том числе опубликованные другими." },
              { id: "deleteMessages", label: "Удалять сообщения", description: "Разрешить удалять сообщения канала, в том числе опубликованные другими." }
            ] : [
              { id: "publish", label: "Publish messages", description: "Allow sending messages and files to the channel." },
              { id: "editMessages", label: "Edit messages", description: "Allow editing channel messages, including those published by others." },
              { id: "deleteMessages", label: "Delete messages", description: "Allow deleting channel messages, including those published by others." }
            ],
            searchSubscribers: russian ? "Поиск по подписчикам" : "Search subscribers",
            noMatchingSubscribers: russian ? "Подписчики не найдены." : "No subscribers found.",
            selectSubscriber: russian ? "Выберите подписчика" : "Select a subscriber",
            confirmRemoveMember: russian ? "Удалить этого подписчика из канала?" : "Remove this subscriber from the channel?",
            confirmRevokeInvite: russian ? "Отозвать ссылку? Все, у кого она есть, потеряют возможность вступить по ней." : "Revoke this link? Anyone who has it will no longer be able to join with it.",
            transferOwnershipHelp: russian ? "Передача владельца предоставит выбранному участнику полный контроль над каналом." : "Transferring ownership gives the selected member full control of the channel.",
            confirmTransferOwnership: russian ? "Передать владение выбранному участнику?" : "Transfer ownership to the selected member?",
            confirmLeave: russian ? "Покинуть канал?" : "Leave this channel?",
            deleteChannelHeading: russian ? "Удалить канал" : "Delete channel",
            deleteChannelHelp: russian ? "Канал и его история будут удалены для всех участников. Это действие нельзя отменить." : "The channel and its history will be deleted for everyone. This cannot be undone.",
            deleteChannel: russian ? "Удалить канал" : "Delete channel",
            confirmDeleteChannel: russian ? "Удалить канал и всю его историю для всех участников? Это действие нельзя отменить." : "Delete this channel and its entire history for everyone? This cannot be undone.",
            transferOwnership: russian ? "Передать владение" : "Transfer ownership",
            deleteChat: russian ? "Удалить чат" : "Delete chat",
            leaveChat: russian ? "Покинуть чат" : "Leave chat"
          }
        }
      }));
    }).catch((error) => {
      if (active) setLoadError(error.message);
    });
    return () => {
      active = false;
      document.removeEventListener("polus:chat-management-changed", onManagement);
    };
  }, [channelId, russian]);

  useEffect(() => {
    if (!hasUnsavedChanges) return undefined;
    const warnBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [hasUnsavedChanges]);

  const sections = [
    { id: "info", label: russian ? "Основная информация" : "Basic information" },
    { id: "appearance", label: russian ? "Внешний вид" : "Appearance" },
    { id: "publishing", label: russian ? "Управление публикациями" : "Publishing" },
    { id: "subscribers", label: russian ? "Подписчики" : "Subscribers" },
    { id: "administrators", label: russian ? "Администраторы" : "Administrators" },
    { id: "invites", label: russian ? "Пригласительные ссылки" : "Invite links" },
    { id: "permissions", label: russian ? "Права доступа" : "Permissions" },
    { id: "notifications", label: russian ? "Уведомления" : "Notifications" },
    { id: "additional", label: russian ? "Дополнительно" : "Additional" }
  ];

  return (
    <main className="community-page channel-settings-page">
      <header className="community-page-header">
        <button className="icon-button profile-page-back" type="button" onClick={goBack}>
          <span aria-hidden="true">←</span>{russian ? "Назад" : "Back"}
        </button>
        <h1>{russian ? "Настройки канала" : "Channel settings"}</h1>
        <button className="text-button" type="button" onClick={openProfile}>
          {russian ? "Профиль канала" : "Channel profile"}
        </button>
      </header>
      <div className="channel-settings-content">
        <div className="channel-settings-heading">
          <h2>{chat?.name || (russian ? "Канал" : "Channel")}</h2>
          <p>{russian
            ? "Управляйте информацией, участниками и возможностями вашего канала"
            : "Manage your channel information, members, and features"}</p>
          {chat && !["owner", "admin"].includes(chat.role) && (
            <p className="channel-settings-permission-note">
              {russian
                ? "Изменять настройки могут только владелец и администраторы канала."
                : "Only the channel owner and administrators can change settings."}
            </p>
          )}
        </div>
        {loadError && <div className="form-error" role="alert">{loadError}</div>}
        <div className="channel-settings-layout">
          <nav className="channel-settings-nav" aria-label={russian ? "Разделы настроек канала" : "Channel settings sections"}>
            {sections.map((section) => (
              <button
                className="channel-settings-nav-item"
                type="button"
                key={section.id}
                aria-current={activeSection === section.id ? "page" : undefined}
                onClick={() => {
                  if (section.id !== activeSection && confirmDiscard()) setActiveSection(section.id);
                }}
              >{section.label}</button>
            ))}
          </nav>
          <div className="channel-settings-panel" aria-live="polite">
            <ChatManagementViewContext.Provider value={{ activeSection, onDirtyChange }}>
              <ChatManagementContent />
            </ChatManagementViewContext.Provider>
          </div>
        </div>
      </div>
    </main>
  );
}

function GroupSettingsPage({ groupId, onBack }) {
  const language = useCurrentLanguage();
  const russian = language === "ru";
  const [activeSection, setActiveSection] = useState("info");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const onDirtyChange = useCallback((dirty) => setHasUnsavedChanges(dirty), []);
  const confirmDiscard = useCallback(() => !hasUnsavedChanges || window.confirm(
    russian
      ? "Есть несохранённые изменения. Покинуть раздел и потерять их?"
      : "You have unsaved changes. Leave this page and discard them?"
  ), [hasUnsavedChanges, russian]);
  const goBack = useCallback(() => {
    if (confirmDiscard()) onBack();
  }, [confirmDiscard, onBack]);

  useEffect(() => {
    const requestId = window.setTimeout(() => {
      document.dispatchEvent(new CustomEvent("polus:request-chat-management", {
        detail: { chatId: groupId }
      }));
    }, 0);
    return () => {
      window.clearTimeout(requestId);
      document.dispatchEvent(new CustomEvent("polus:chat-management-changed", { detail: null }));
    };
  }, [groupId]);

  useEffect(() => {
    if (!hasUnsavedChanges) return undefined;
    const warnBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [hasUnsavedChanges]);

  const sections = [
    { id: "info", label: russian ? "Основная информация" : "Basic information" },
    { id: "members", label: russian ? "Участники" : "Members" },
    { id: "administrators", label: russian ? "Администраторы" : "Administrators" },
    { id: "invites", label: russian ? "Пригласительные ссылки" : "Invite links" },
    { id: "additional", label: russian ? "Дополнительно" : "Additional" }
  ];

  return (
    <main className="community-page channel-settings-page group-settings-page">
      <header className="community-page-header">
        <button className="icon-button profile-page-back" type="button" onClick={goBack}>
          <span aria-hidden="true">←</span>{russian ? "Назад к группе" : "Back to group"}
        </button>
        <h1>{russian ? "Настройки группы" : "Group settings"}</h1>
      </header>
      <div className="channel-settings-content">
        <div className="channel-settings-heading">
          <h2>{russian ? "Управление группой" : "Manage group"}</h2>
          <p>{russian
            ? "Изменяйте информацию, участников и приглашения группы."
            : "Update your group information, members, and invitations."}</p>
        </div>
        <div className="channel-settings-layout">
          <nav className="channel-settings-nav" aria-label={russian ? "Разделы настроек группы" : "Group settings sections"}>
            {sections.map((section) => (
              <button
                className="channel-settings-nav-item"
                type="button"
                key={section.id}
                aria-current={activeSection === section.id ? "page" : undefined}
                onClick={() => {
                  if (section.id !== activeSection && confirmDiscard()) setActiveSection(section.id);
                }}
              >{section.label}</button>
            ))}
          </nav>
          <div className="channel-settings-panel">
            <ChatManagementViewContext.Provider value={{ activeSection, onDirtyChange }}>
              <ChatManagementContent />
            </ChatManagementViewContext.Provider>
          </div>
        </div>
      </div>
    </main>
  );
}

function InviteLandingPage({ token, onBack, onOpenChat }) {
  const language = useCurrentLanguage();
  const russian = language === "ru";
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const join = async () => {
    setBusy(true);
    setError("");
    try {
      const conversation = await requestJson(`/api/invites/${encodeURIComponent(token)}/join`, { method: "POST" });
      onOpenChat(conversation);
    } catch (cause) {
      setError(cause.status === 404
        ? translations[language].inviteNotFound
        : cause.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="community-page">
      <header className="community-page-header">
        <button className="icon-button profile-page-back" type="button" onClick={onBack}>
          <span aria-hidden="true">←</span>{russian ? "Назад" : "Back"}
        </button>
        <h1>{russian ? "Приглашение в Полюс" : "Polus invitation"}</h1>
      </header>
      <section className="community-profile-card invite-landing-card">
        <span className="community-profile-icon" aria-hidden="true">↗</span>
        <h2>{russian ? "Вас пригласили в чат" : "You’ve been invited to a chat"}</h2>
        <p className="community-description">
          {russian ? "Присоединитесь, чтобы открыть переписку." : "Join to open the conversation."}
        </p>
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="primary-button" type="button" disabled={busy} onClick={() => void join()}>
          {russian ? "Присоединиться" : "Join"}
        </button>
      </section>
    </main>
  );
}

function MediaViewer() {
  const [snapshot, setSnapshot] = useState({ items: [], index: 0 });
  const language = useCurrentLanguage();
  const item = snapshot.items[snapshot.index] || null;
  const navigate = (direction) => setSnapshot((current) => ({
    ...current,
    index: (current.index + direction + current.items.length) % current.items.length
  }));
  useLayoutEffect(() => {
    const onMediaOpen = (event) => setSnapshot(event.detail);
    document.addEventListener("polus:media-viewer-open", onMediaOpen);
    return () => document.removeEventListener("polus:media-viewer-open", onMediaOpen);
  }, []);

  return (
    <dialog id="media-viewer" className="media-viewer">
      <button
        id="media-viewer-close"
        className="icon-button media-viewer-close"
        type="button"
        aria-label={language === "ru" ? "Закрыть" : "Close"}
        onClick={() => document.getElementById("media-viewer")?.close()}
      >×</button>
      <button
        id="media-viewer-previous"
        className="icon-button media-viewer-previous"
        type="button"
        aria-label={language === "ru" ? "Предыдущее" : "Previous"}
        disabled={snapshot.items.length < 2}
        onClick={() => navigate(-1)}
      >‹</button>
      {item && (
        <AuthenticatedImage
          src={item.decryptedUrl || `/api/attachments/${encodeURIComponent(item.id)}`}
          alt={item.name || ""}
        />
      )}
      <button
        id="media-viewer-next"
        className="icon-button media-viewer-next"
        type="button"
        aria-label={language === "ru" ? "Следующее" : "Next"}
        disabled={snapshot.items.length < 2}
        onClick={() => navigate(1)}
      >›</button>
    </dialog>
  );
}

function FormError({ id }) {
  const [message, setMessage] = useState("");
  useLayoutEffect(() => {
    const onError = (event) => {
      if (event.detail.id === id) setMessage(event.detail.message);
    };
    const onClear = (event) => {
      if (event.detail.id === id) setMessage("");
    };
    document.addEventListener("polus:form-error", onError);
    document.addEventListener("polus:form-error-clear", onClear);
    return () => {
      document.removeEventListener("polus:form-error", onError);
      document.removeEventListener("polus:form-error-clear", onClear);
    };
  }, [id]);
  return <div id={id} className="form-error" role="alert" hidden={!message}>{message}</div>;
}

function useFormRequest(action, errorId) {
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event, values) => {
    event.preventDefault();
    const form = event.currentTarget;
    document.dispatchEvent(new CustomEvent("polus:form-error-clear", { detail: { id: errorId } }));
    setSubmitting(true);
    try {
      await new Promise((resolve, reject) => {
        document.dispatchEvent(new CustomEvent(action, { detail: { values, resolve, reject } }));
      });
      form.reset();
      form.closest("dialog")?.close();
    } catch (error) {
      document.dispatchEvent(new CustomEvent("polus:form-error", {
        detail: { id: errorId, message: error.message }
      }));
    } finally {
      setSubmitting(false);
    }
  };
  return { submitting, submit };
}

function CreateChannelForm() {
  const language = useCurrentLanguage();
  const request = useFormRequest("polus:create-channel", "channel-error");
  return (
    <form
      id="channel-form"
      method="post"
      action="/api/forms-disabled"
      className="dialog-form"
      onSubmit={(event) => {
        const data = new FormData(event.currentTarget);
        void request.submit(event, {
          name: String(data.get("name") || "").trim(),
          description: String(data.get("description") || "").trim(),
          isPrivate: data.get("isPrivate") === "on"
        });
      }}
    >
      <label className="field-label" htmlFor="channel-name">{language === "ru" ? "Название канала" : "Channel name"}</label>
      <input id="channel-name" name="name" className="text-field" maxLength={50} required disabled={request.submitting} />
      <label className="field-label" htmlFor="channel-description">{language === "ru" ? "Описание" : "Description"}</label>
      <input id="channel-description" name="description" className="text-field" maxLength={160} disabled={request.submitting} />
      <label className="channel-privacy-choice">
        <input type="checkbox" name="isPrivate" disabled={request.submitting} />
        <span>{language === "ru" ? "Частный канал — виден только по пригласительной ссылке" : "Private channel — visible only by invite link"}</span>
      </label>
      <FormError id="channel-error" />
      <button className="primary-button" type="submit" disabled={request.submitting}>
        {language === "ru" ? "Создать" : "Create"}
      </button>
    </form>
  );
}

function ChatDeleteDialog() {
  const [conversation, setConversation] = useState(null);
  const language = useCurrentLanguage();
  const text = translations[language];
  const dialogRef = useRef(null);

  useLayoutEffect(() => {
    const show = (event) => {
      setConversation(event.detail.conversation);
      if (!dialogRef.current?.open) dialogRef.current?.showModal();
    };
    const onClose = () => setConversation(null);
    document.addEventListener("polus:chat-delete-request", show);
    dialogRef.current?.addEventListener("close", onClose);
    return () => {
      document.removeEventListener("polus:chat-delete-request", show);
      dialogRef.current?.removeEventListener("close", onClose);
    };
  }, []);

  const confirmDelete = (scope) => {
    if (!conversation) return;
    document.dispatchEvent(new CustomEvent("polus:chat-delete", {
      detail: { conversationId: conversation.id, scope }
    }));
    dialogRef.current?.close();
  };
  const canDeleteForEveryone = conversation?.type === "direct" || conversation?.role === "owner";

  return (
    <dialog ref={dialogRef} id="chat-delete-dialog" className="dialog chat-delete-dialog">
      <form method="dialog" className="dialog-top">
        <h2>{text.deleteChatTitle}</h2>
        <button className="icon-button dialog-close" value="cancel" aria-label={text.cancel}>×</button>
      </form>
      <div className="chat-delete-actions">
        <button className="primary-button" type="button" onClick={() => confirmDelete("me")}>
          {text.deleteForMe}
        </button>
        {canDeleteForEveryone && (
          <button className="danger-button" type="button" onClick={() => confirmDelete("everyone")}>
            {text.deleteForEveryone}
          </button>
        )}
        <button className="text-button" type="button" onClick={() => dialogRef.current?.close()}>
          {text.cancel}
        </button>
      </div>
    </dialog>
  );
}

function CreateGroupForm() {
  const language = useCurrentLanguage();
  const request = useFormRequest("polus:create-group", "group-error");
  const [isPublic, setIsPublic] = useState(false);
  return (
    <form
      id="group-form"
      method="post"
      action="/api/forms-disabled"
      className="dialog-form"
      onSubmit={(event) => {
        const data = new FormData(event.currentTarget);
        void request.submit(event, {
          name: String(data.get("name") || "").trim(),
          isPublic: data.get("isPublic") === "public",
          usernames: String(data.get("usernames") || "").split(",")
            .map((item) => item.trim().replace(/^@/, "")).filter(Boolean)
        });
      }}
    >
      <label className="field-label" htmlFor="group-name">{language === "ru" ? "Название группы" : "Group name"}</label>
      <input id="group-name" name="name" className="text-field" maxLength={50} required disabled={request.submitting} />
      <label className="field-label" htmlFor="group-visibility">{language === "ru" ? "Тип группы" : "Group type"}</label>
      <select
        id="group-visibility"
        name="isPublic"
        className="text-field"
        value={isPublic ? "public" : "private"}
        disabled={request.submitting}
        onChange={(event) => setIsPublic(event.target.value === "public")}
      >
        <option value="private">{language === "ru" ? "Приватная — только по приглашению" : "Private — invite only"}</option>
        <option value="public">{language === "ru" ? "Публичная — видна в поиске, вступить может любой" : "Public — discoverable and open to join"}</option>
      </select>
      <label className="field-label" htmlFor="group-members">
        {language === "ru" ? "Участники (@имена через запятую)" : "Members (@usernames, comma-separated)"}
      </label>
      <input
        id="group-members"
        name="usernames"
        className="text-field"
        placeholder="@alex, @sam"
        required={!isPublic}
        disabled={request.submitting}
      />
      <FormError id="group-error" />
      <button className="primary-button" type="submit" disabled={request.submitting}>
        {language === "ru" ? "Создать" : "Create"}
      </button>
    </form>
  );
}

function ReactDialogs({ user }) {
  const language = useCurrentLanguage();
  useLayoutEffect(() => {
    const closeOnBackdropClick = (event) => {
      const dialog = event.target;
      if (dialog?.tagName !== "DIALOG" || !dialog.open || event.detail === 0) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right
        || event.clientY < bounds.top || event.clientY > bounds.bottom) {
        dialog.close();
      }
    };
    const show = (id) => {
      const dialog = document.getElementById(id);
      if (dialog && !dialog.open) {
        dialog.showModal();
        document.dispatchEvent(new CustomEvent("polus:dialog-open-state", { detail: { id, open: true } }));
      }
    };
    const close = (id) => {
      const dialog = document.getElementById(id);
      if (dialog?.open) dialog.close();
    };
    const openDialog = (event) => show(event.detail.id);
    const closeDialog = (event) => close(event.detail.id);
    const ids = [
      "chat-info-dialog", "chat-search-dialog", "forward-message-dialog",
      "media-viewer", "channel-dialog", "group-dialog", "settings-dialog",
      "user-picker-dialog", "contact-share-dialog"
    ];
    const onClose = (event) => {
      document.dispatchEvent(new CustomEvent("polus:dialog-open-state", {
        detail: { id: event.currentTarget.id, open: false }
      }));
    };
    ids.forEach((id) => document.getElementById(id)?.addEventListener("close", onClose));
    document.addEventListener("click", closeOnBackdropClick, true);
    document.addEventListener("polus:open-dialog", openDialog);
    document.addEventListener("polus:close-dialog", closeDialog);
    return () => {
      document.removeEventListener("click", closeOnBackdropClick, true);
      document.removeEventListener("polus:open-dialog", openDialog);
      document.removeEventListener("polus:close-dialog", closeDialog);
      ids.forEach((id) => document.getElementById(id)?.removeEventListener("close", onClose));
    };
  }, []);

  const dialogTitle = (eyebrow, title, titleId) => (
    <form method="dialog" className="dialog-top">
      <div>
        <div className="eyebrow">{language === "ru" ? eyebrow[0] : eyebrow[1]}</div>
        <h2 id={titleId}>{language === "ru" ? title[0] : title[1]}</h2>
      </div>
      <button className="icon-button dialog-close" value="cancel" aria-label={language === "ru" ? "Закрыть" : "Close"}>×</button>
    </form>
  );

  return (
    <>
      <dialog id="chat-info-dialog" className="dialog chat-info-dialog">
        <ChatInfoDialogContent />
      </dialog>

      <ChatSearchDialog />
      <ForwardMessageDialog />

      <MediaViewer />

      <dialog id="channel-dialog" className="dialog">
        {dialogTitle(["СООБЩЕСТВО", "COMMUNITY"], ["Создать канал", "Create channel"], "channel-dialog-title")}
        <CreateChannelForm />
      </dialog>

      <dialog id="group-dialog" className="dialog">
        {dialogTitle(["СООБЩЕСТВО", "COMMUNITY"], ["Новая группа", "New group"], "group-dialog-title")}
        <CreateGroupForm />
      </dialog>

      <SettingsDialog />
      <PushOnboardingDialog user={user} />
    </>
  );
}

function AccountManagementDialog({ open, onClose, accounts, activeAccountKey, onSwitchAccount, onRemoveAccount }) {
  const language = useCurrentLanguage();
  const dialogRef = useRef(null);
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState("");
  useEffect(() => {
    if (open && !dialogRef.current?.open) dialogRef.current?.showModal();
    if (!open && dialogRef.current?.open) dialogRef.current.close();
  }, [open]);
  const revokeAccount = async (account, action) => {
    const confirmed = window.confirm(language === "ru"
      ? action === "remove"
        ? `Удалить аккаунт @${account.user.username} из приложения?`
        : `Выйти из аккаунта @${account.user.username}?`
      : action === "remove"
        ? `Remove @${account.user.username} from this app?`
        : `Sign out of @${account.user.username}?`);
    if (!confirmed) return;
    setError("");
    setBusyKey(account.key);
    try {
      const registration = "serviceWorker" in navigator && window.isSecureContext
        ? await navigator.serviceWorker.ready
        : null;
      const subscription = registration ? await registration.pushManager.getSubscription() : null;
      await requestJson("/api/auth/logout", {
        method: "POST",
        body: JSON.stringify({ pushEndpoint: subscription?.endpoint || "" }),
        accountKey: account.key
      });
      onRemoveAccount(account.key);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusyKey("");
    }
  };
  return (
    <dialog
      ref={dialogRef}
      className="dialog account-management-dialog"
      onClose={onClose}
      onCancel={onClose}
    >
      <form method="dialog" className="dialog-top">
        <div>
          <div className="eyebrow">{language === "ru" ? "ПРОФИЛЬ" : "PROFILE"}</div>
          <h2>{language === "ru" ? "Управление аккаунтами" : "Manage accounts"}</h2>
        </div>
        <button className="icon-button dialog-close" value="cancel" aria-label={language === "ru" ? "Закрыть" : "Close"}>×</button>
      </form>
      <div className="account-management-list">
        {accounts.map((account) => (
          <div className="account-management-row" key={account.key}>
            <button
              className="account-management-user"
              type="button"
              onClick={() => {
                onSwitchAccount(account.key);
                onClose();
              }}
            >
              <span className="account-switcher-avatar">
                {account.user.avatarUrl
                  ? <AuthenticatedImage src={account.user.avatarUrl} accountKey={account.key} alt="" />
                  : initials(account.user.fullName || account.user.username)}
              </span>
              <span className="profile-copy">
                <strong>{account.user.fullName || account.user.username}</strong>
                <small>@{account.user.username}</small>
              </span>
              {account.key === activeAccountKey && <span className="account-active-mark">{language === "ru" ? "Активен" : "Active"}</span>}
            </button>
            <div className="account-management-actions">
              <button
                type="button"
                className="text-button"
                disabled={busyKey === account.key}
                onClick={() => void revokeAccount(account, "remove")}
              >
                {language === "ru" ? "Удалить из приложения" : "Remove"}
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busyKey === account.key}
                onClick={() => void revokeAccount(account, "sign-out")}
              >
                {busyKey === account.key ? "…" : language === "ru" ? "Выйти" : "Sign out"}
              </button>
            </div>
          </div>
        ))}
      </div>
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="account-management-footer">
        <button className="primary-button" type="button" onClick={onClose}>
          {language === "ru" ? "Готово" : "Done"}
        </button>
      </div>
    </dialog>
  );
}

function MessengerShell({
  user,
  onSignOut,
  accounts,
  activeAccountKey,
  onSwitchAccount,
  onAddAccount,
  onRemoveAccount,
  hidden = false
}) {
  const language = useCurrentLanguage();
  const userRef = useRef(user);
  const onSignOutRef = useRef(onSignOut);
  userRef.current = user;
  onSignOutRef.current = onSignOut;
  const languageRef = useRef(language);
  languageRef.current = language;
  const mobileSwipeStartRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountsDialogOpen, setAccountsDialogOpen] = useState(false);
  const [profilePage, setProfilePage] = useState(() => window.location.pathname === "/profile");
  const [contactsPage, setContactsPage] = useState(() => window.location.pathname === "/contacts");
  const [publicProfileUsername, setPublicProfileUsername] = useState(() => {
    const match = /^\/users\/([^/]+)$/.exec(window.location.pathname);
    if (!match) return null;
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return null;
    }
  });
  const [channelProfileId, setChannelProfileId] = useState(() =>
    /^\/channels\/([^/]+)$/.exec(window.location.pathname)?.[1] || null);
  const [channelSettingsId, setChannelSettingsId] = useState(() =>
    /^\/channels\/([^/]+)\/settings$/.exec(window.location.pathname)?.[1] || null);
  const [groupSettingsId, setGroupSettingsId] = useState(() =>
    /^\/groups\/([^/]+)\/settings$/.exec(window.location.pathname)?.[1] || null);
  const [inviteToken, setInviteToken] = useState(() =>
    /^\/join\/([^/]+)$/.exec(window.location.pathname)?.[1] || null);
  const [profileUser, setProfileUser] = useState(user);
  const updateProfileUser = useCallback((updatedUser) => setProfileUser(updatedUser), []);
  const closeMobileChat = () => document.getElementById("messenger-view")?.classList.remove("chat-open");
  const handleMobileTouchStart = (event) => {
    if (!window.matchMedia("(max-width: 760px)").matches
      || !document.getElementById("messenger-view")?.classList.contains("chat-open")
      || event.touches.length !== 1) {
      mobileSwipeStartRef.current = null;
      return;
    }
    const target = event.target;
    if (target instanceof Element && target.closest("input, textarea, button, a, audio, video, [role='dialog']")) {
      mobileSwipeStartRef.current = null;
      return;
    }
    const touch = event.touches[0];
    mobileSwipeStartRef.current = touch.clientX <= 32
      ? { x: touch.clientX, y: touch.clientY }
      : null;
  };
  const handleMobileTouchEnd = (event) => {
    const start = mobileSwipeStartRef.current;
    mobileSwipeStartRef.current = null;
    if (!start || !window.matchMedia("(max-width: 760px)").matches) return;
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - start.x;
    const deltaY = Math.abs(touch.clientY - start.y);
    if (deltaX >= 85 && deltaX > deltaY * 1.4) closeMobileChat();
  };
  useEffect(() => {
    let active = true;
    const accountKey = getActiveAccountKey();
    let disposeController;
    let eventStream = null;
    let hasReportedStreamError = false;
    let presenceTimer = null;
    let currentConversation = null;
    let activeChannelSettingsId = /^\/channels\/([^/]+)\/settings$/.exec(window.location.pathname)?.[1] || null;
    let activeGroupSettingsId = /^\/groups\/([^/]+)\/settings$/.exec(window.location.pathname)?.[1] || null;
    const viewingClientId = (() => {
      try {
        let clientId = sessionStorage.getItem("polus-viewing-client");
        if (!clientId) {
          clientId = createClientId();
          sessionStorage.setItem("polus-viewing-client", clientId);
        }
        return clientId;
      } catch {
        return createClientId();
      }
    })();
    const handleSignOut = () => onSignOutRef.current();
    const handleOpenContacts = () => {
      setMenuOpen(false);
      if (window.location.pathname !== "/contacts") {
        window.history.pushState({ polusPage: true, polusContactsPage: true }, "", "/contacts");
      }
      setContactsPage(true);
      setProfilePage(false);
      setPublicProfileUsername(null);
      setChannelProfileId(null);
      setChannelSettingsId(null);
      setGroupSettingsId(null);
      setInviteToken(null);
      window.setTimeout(() => void reportChatViewingState(), 0);
    };
    const reportChatViewingState = (forceHidden = false) => {
      const messengerView = document.getElementById("messenger-view");
      const visible = !forceHidden && Boolean(messengerView?.isConnected && !messengerView.hidden)
        && document.visibilityState === "visible"
        && Boolean(currentConversation && !currentConversation.pending);
      return fetch("/api/presence/chat", {
        method: "POST",
        credentials: "same-origin",
        keepalive: forceHidden,
        headers: {
          "Content-Type": "application/json",
          ...(accountKey ? { "X-Polus-Account": accountKey } : {})
        },
        body: JSON.stringify({
          clientId: viewingClientId,
          conversationId: visible ? currentConversation.id : null,
          visible
        })
      }).then((response) => {
        if (!response.ok && response.status !== 401) {
          throw new Error(`Chat presence update failed (${response.status}).`);
        }
      }).catch((cause) => {
        if (!forceHidden && cause.name !== "AbortError") console.error(cause);
      });
    };
    const handleOpenProfilePage = (event) => {
      setMenuOpen(false);
      const section = event.detail?.section;
      const profilePath = section === "appearance" ? "/profile#profile-appearance" : "/profile";
      if (`${window.location.pathname}${window.location.hash}` !== profilePath) {
        window.history.pushState({ polusPage: true, polusProfilePage: true }, "", profilePath);
      }
      setContactsPage(false);
      setProfilePage(true);
      setPublicProfileUsername(null);
      setChannelProfileId(null);
      setInviteToken(null);
      window.setTimeout(() => void reportChatViewingState(), 0);
    };
    const handleOpenChannelProfile = (event) => {
      const channelId = event.detail?.channelId;
      if (!channelId) return;
      window.history.pushState({ polusPage: true }, "", `/channels/${encodeURIComponent(channelId)}`);
      setContactsPage(false);
      setProfilePage(false);
      setPublicProfileUsername(null);
      setChannelProfileId(channelId);
      setChannelSettingsId(null);
      setInviteToken(null);
      window.setTimeout(() => void reportChatViewingState(), 0);
    };
    const handleOpenChannelSettings = (event) => {
      const channelId = event.detail?.channelId;
      if (!channelId) return;
      activeChannelSettingsId = channelId;
      document.dispatchEvent(new CustomEvent("polus:close-dialog", {
        detail: { id: "chat-info-dialog" }
      }));
      window.history.pushState({ polusPage: true }, "", `/channels/${encodeURIComponent(channelId)}/settings`);
      setContactsPage(false);
      setProfilePage(false);
      setPublicProfileUsername(null);
      setChannelProfileId(null);
      setChannelSettingsId(channelId);
      setInviteToken(null);
      window.setTimeout(() => void reportChatViewingState(), 0);
    };
    const handleOpenGroupSettings = (event) => {
      const groupId = event.detail?.groupId;
      if (!groupId || currentConversation?.id !== groupId || currentConversation.type !== "group") return;
      activeGroupSettingsId = groupId;
      document.dispatchEvent(new CustomEvent("polus:close-dialog", {
        detail: { id: "chat-info-dialog" }
      }));
      window.history.pushState({ polusPage: true }, "", `/groups/${encodeURIComponent(groupId)}/settings`);
      setContactsPage(false);
      setProfilePage(false);
      setPublicProfileUsername(null);
      setChannelProfileId(null);
      setChannelSettingsId(null);
      setGroupSettingsId(groupId);
      setInviteToken(null);
      window.setTimeout(() => void reportChatViewingState(), 0);
    };
    const handleExitGroupSettings = () => {
      activeGroupSettingsId = null;
      window.history.replaceState({}, "", "/");
      setContactsPage(false);
      setProfilePage(false);
      setPublicProfileUsername(null);
      setChannelProfileId(null);
      setChannelSettingsId(null);
      setGroupSettingsId(null);
      setInviteToken(null);
    };
    const openChannelChat = async (channelId, openInfo = false) => {
      try {
        let conversation = currentConversation?.id === channelId && currentConversation.joined !== false
          ? currentConversation
          : null;
        if (!conversation) {
          const bootstrap = await requestJson("/api/bootstrap");
          conversation = bootstrap.channels.find((channel) =>
            channel.id === channelId && channel.joined !== false
          );
        }
        if (!conversation) throw new Error("Channel not found.");
        activeChannelSettingsId = null;
        window.history.replaceState({}, "", "/");
        setContactsPage(false);
        setProfilePage(false);
        setPublicProfileUsername(null);
        setChannelProfileId(null);
        setChannelSettingsId(null);
        setInviteToken(null);
        document.dispatchEvent(new CustomEvent("polus:open-conversation", { detail: { conversation } }));
        if (openInfo) document.dispatchEvent(new CustomEvent("polus:chat-info"));
        window.setTimeout(() => void reportChatViewingState(), 0);
      } catch (cause) {
        document.dispatchEvent(new CustomEvent("polus:notify", { detail: cause.message }));
      }
    };
    const handleChannelSettingsProfile = (event) => {
      const channelId = event.detail?.channelId || activeChannelSettingsId;
      if (channelId) void openChannelChat(channelId, true);
    };
    const handleProfileBack = (event) => {
      const channelId = event.detail?.channelId || activeChannelSettingsId;
      const groupId = event.detail?.groupId || activeGroupSettingsId;
      if (channelId) {
        if (window.history.state?.polusPage
          && window.location.pathname === `/channels/${encodeURIComponent(channelId)}/settings`) {
          window.history.back();
        } else {
          void openChannelChat(channelId);
        }
        return;
      }
      if (groupId) {
        if (window.history.state?.polusPage
          && window.location.pathname === `/groups/${encodeURIComponent(groupId)}/settings`) {
          window.history.back();
        } else {
          void openGroupChat(groupId);
        }
        return;
      }
      if (/^\/users\/[^/]+$/.test(window.location.pathname)) {
        if (window.history.state?.polusPage) {
          window.history.back();
        } else {
          window.history.replaceState({}, "", "/");
          setPublicProfileUsername(null);
          setProfilePage(false);
          setContactsPage(false);
        }
        return;
      }
      if (window.history.state?.polusPage || window.history.state?.polusProfilePage) {
        window.history.back();
      } else {
        window.history.replaceState({}, "", "/");
        setContactsPage(false);
        setProfilePage(false);
        setPublicProfileUsername(null);
        setChannelProfileId(null);
        setChannelSettingsId(null);
        setGroupSettingsId(null);
        setInviteToken(null);
      }
    };
    const openGroupChat = async (groupId) => {
      try {
        let conversation = currentConversation?.id === groupId ? currentConversation : null;
        if (!conversation) {
          const bootstrap = await requestJson("/api/bootstrap");
          conversation = bootstrap.directs.find((item) => item.id === groupId && item.type === "group");
        }
        if (!conversation) throw new Error(languageRef.current === "ru" ? "Группа не найдена." : "Group not found.");
        activeGroupSettingsId = null;
        window.history.replaceState({}, "", "/");
        setProfilePage(false);
        setPublicProfileUsername(null);
        setChannelProfileId(null);
        setChannelSettingsId(null);
        setGroupSettingsId(null);
        setInviteToken(null);
        document.dispatchEvent(new CustomEvent("polus:open-conversation", { detail: { conversation } }));
        window.setTimeout(() => void reportChatViewingState(), 0);
      } catch (cause) {
        document.dispatchEvent(new CustomEvent("polus:notify", { detail: cause.message }));
      }
    };
    const handleOpenPageChat = (event) => {
      const conversation = event.detail?.conversation;
      if (!conversation) return;
      activeChannelSettingsId = null;
      if (event.detail.replaceHistory) {
        window.history.replaceState({}, "", "/");
      } else {
        window.history.pushState({}, "", "/");
      }
      setContactsPage(false);
      setProfilePage(false);
      setPublicProfileUsername(null);
      setChannelProfileId(null);
      setChannelSettingsId(null);
      setGroupSettingsId(null);
      setInviteToken(null);
      document.dispatchEvent(new CustomEvent("polus:open-conversation", { detail: { conversation } }));
    };
    const handleOpenProfileCommunity = async (event) => {
      const { id, type } = event.detail || {};
      if (typeof id !== "string" || !["group", "channel"].includes(type)) return;
      try {
        const bootstrap = await requestJson("/api/bootstrap");
        const collection = type === "channel" ? bootstrap.channels : bootstrap.directs;
        const conversation = collection.find((chat) => chat.id === id && chat.type === type
          && chat.joined !== false);
        if (!conversation) {
          throw new Error(languageRef.current === "ru"
            ? "Это сообщество больше недоступно."
            : "This community is no longer available.");
        }
        document.dispatchEvent(new CustomEvent("polus:page-open-chat", { detail: { conversation } }));
      } catch (cause) {
        document.dispatchEvent(new CustomEvent("polus:notify", { detail: cause.message }));
      }
    };
    const handlePopState = () => {
      const pathname = window.location.pathname;
      const settingsChannelId = activeChannelSettingsId;
      const settingsGroupId = activeGroupSettingsId;
      setProfilePage(pathname === "/profile");
      setContactsPage(pathname === "/contacts");
      const userProfile = /^\/users\/([^/]+)$/.exec(pathname);
      try {
        setPublicProfileUsername(userProfile ? decodeURIComponent(userProfile[1]) : null);
      } catch {
        setPublicProfileUsername(null);
      }
      setChannelProfileId(/^\/channels\/([^/]+)$/.exec(pathname)?.[1] || null);
      setChannelSettingsId(/^\/channels\/([^/]+)\/settings$/.exec(pathname)?.[1] || null);
      setGroupSettingsId(/^\/groups\/([^/]+)\/settings$/.exec(pathname)?.[1] || null);
      setInviteToken(/^\/join\/([^/]+)$/.exec(pathname)?.[1] || null);
      if (!/^\/channels\/[^/]+\/settings$/.test(pathname)) activeChannelSettingsId = null;
      if (!/^\/groups\/[^/]+\/settings$/.test(pathname)) activeGroupSettingsId = null;
      if (pathname === "/") {
        if (settingsChannelId && currentConversation?.id !== settingsChannelId) {
          void openChannelChat(settingsChannelId);
        } else if (settingsGroupId && currentConversation?.id !== settingsGroupId) {
          void openGroupChat(settingsGroupId);
        }
        window.setTimeout(() => void reportChatViewingState(), 0);
      }
    };
    const handleRealtimeMessageSound = (event) => {
      if (event.detail?.authorId !== userRef.current.id) playNotificationSound();
    };
    const dispatchRealtimeEvent = (name, event) => {
      try {
        document.dispatchEvent(new CustomEvent(name, { detail: JSON.parse(event.data) }));
      } catch (cause) {
        console.error(`Invalid ${event.type} event received:`, cause);
      }
    };
    const connectRealtime = () => {
      eventStream?.close();
      const source = connectEventStream("/api/stream", {
        accountKey,
        onEvent: (event) => {
          if (event.type === "message") dispatchRealtimeEvent("polus:realtime-message", event);
          else if (event.type === "chat-updated") dispatchRealtimeEvent("polus:realtime-chat-updated", event);
          else if (event.type === "message-updated") dispatchRealtimeEvent("polus:realtime-message-updated", event);
          else if (event.type === "message-deleted") dispatchRealtimeEvent("polus:realtime-message-deleted", event);
          else if (event.type === "messages-read") dispatchRealtimeEvent("polus:realtime-messages-read", event);
          else if (event.type === "resync") document.dispatchEvent(new CustomEvent("polus:realtime-resync"));
        },
        onOpen: ({ reconnected }) => {
          hasReportedStreamError = false;
          if (reconnected) document.dispatchEvent(new CustomEvent("polus:realtime-resync"));
        },
        onError: (cause) => {
          if (hasReportedStreamError) return;
          hasReportedStreamError = true;
          console.error("Realtime stream failed:", cause);
          document.dispatchEvent(new CustomEvent("polus:notify", {
            detail: languageRef.current === "ru"
              ? "Не удалось подключиться к обновлениям. Повторная попытка..."
              : "Unable to connect to live updates. Retrying..."
          }));
        }
      });
      eventStream = source;
    };
    const handlePresenceConversation = (event) => {
      currentConversation = event.detail.conversation || null;
      void reportChatViewingState();
    };
    const handlePresenceVisibility = () => void reportChatViewingState();
    const handlePresenceStop = () => void reportChatViewingState(true);
    const handleConnectRealtime = () => {
      connectRealtime();
      clearInterval(presenceTimer);
      void reportChatViewingState();
      presenceTimer = window.setInterval(() => void reportChatViewingState(), 15_000);
    };
    const handleLoadMessageHistory = async (event) => {
      const { conversationId, before, resolve, reject } = event.detail || {};
      if (typeof conversationId !== "string" || !conversationId || typeof resolve !== "function"
        || typeof reject !== "function") return;
      const query = new URLSearchParams({ conversationId });
      if (before !== undefined && before !== null) query.set("before", String(before));
      try {
        resolve(await requestJson(`/api/messages?${query}`));
      } catch (cause) {
        reject(cause);
      }
    };
    const handleMarkConversationRead = async (event) => {
      const { conversationId, resolve, reject } = event.detail || {};
      if (typeof conversationId !== "string" || !conversationId || typeof resolve !== "function"
        || typeof reject !== "function") return;
      try {
        resolve(await requestJson("/api/conversations/read", {
          method: "POST",
          body: JSON.stringify({ conversationId })
        }));
      } catch (cause) {
        reject(cause);
      }
    };
    const handleDirectMessageRequest = async (event) => {
      try {
        const conversation = await requestJson(
          `/api/directs/${encodeURIComponent(event.detail.username)}`,
          { method: "POST", body: JSON.stringify({}) }
        );
        window.history.replaceState({}, "", "/");
        setContactsPage(false);
        setProfilePage(false);
        setPublicProfileUsername(null);
        setChannelProfileId(null);
        setChannelSettingsId(null);
        setGroupSettingsId(null);
        setInviteToken(null);
        document.dispatchEvent(new CustomEvent("polus:close-people-search"));
        document.dispatchEvent(new CustomEvent("polus:close-user-picker"));
        document.dispatchEvent(new CustomEvent("polus:open-conversation", { detail: { conversation } }));
      } catch (cause) {
        document.dispatchEvent(new CustomEvent("polus:notify", {
          detail: cause.message
        }));
      }
    };
    const handleCreateRequest = async (event) => {
      const channel = event.type === "polus:create-channel";
      const endpoint = channel ? "/api/channels" : "/api/groups";
      try {
        const conversation = await requestJson(endpoint, {
          method: "POST",
          body: JSON.stringify(event.detail.values)
        });
        await new Promise((resolve, reject) => {
          document.dispatchEvent(new CustomEvent("polus:refresh-messenger-state", {
            detail: { resolve, reject }
          }));
        });
        document.dispatchEvent(new CustomEvent("polus:open-conversation", { detail: { conversation } }));
        document.dispatchEvent(new CustomEvent("polus:notify", {
          detail: channel
            ? (languageRef.current === "ru" ? "Канал создан." : "Channel created.")
            : (languageRef.current === "ru" ? "Группа создана." : "Group created.")
        }));
        event.detail.resolve(conversation);
      } catch (cause) {
        const currentLanguage = languageRef.current;
        const knownErrors = {
          "Channel name is too short.": currentLanguage === "ru" ? "Название канала слишком короткое." : cause.message,
          "Group name is too short.": currentLanguage === "ru" ? "Название группы слишком короткое." : cause.message,
          "Add between 2 and 199 other participants.": currentLanguage === "ru" ? "Добавь от одного до 199 участников." : cause.message,
          "A group must have at least one other member.": currentLanguage === "ru" ? "В группе должен быть хотя бы один участник кроме тебя." : cause.message,
          "One or more usernames were not found.": currentLanguage === "ru" ? "Не удалось найти одно или несколько имён пользователей." : cause.message
        };
        event.detail.reject(new Error(knownErrors[cause.message] || cause.message));
      }
    };
    const handleCreateChannel = (event) => void handleCreateRequest(event);
    const handleCreateGroup = (event) => void handleCreateRequest(event);
    const handleSaveProfile = async (event) => {
      const {
        avatarFile,
        keyUnlockPassword,
        ...profile
      } = event.detail.values;
      try {
        if (avatarFile) {
          if (avatarFile.size > 5 * 1024 * 1024) {
            throw new Error(languageRef.current === "ru"
              ? "Изображение должно быть не больше 5 МБ."
              : "Image must be no larger than 5 MB.");
          }
          const avatar = await cropAvatar(avatarFile);
          await requestJson("/api/account/avatar", {
            method: "POST",
            headers: { "Content-Type": avatar.type },
            body: avatar
          });
        }
        const encryptionKeyUpdate = profile.newPassword
          ? await prepareEncryptionKeyPasswordChange(
            profile.currentPassword,
            profile.newPassword,
            getActiveAccountKey(),
            keyUnlockPassword || profile.currentPassword
          )
          : null;
        const { user: updatedUser, sessionsRevoked } = await requestJson("/api/account", {
          method: "PATCH",
          body: JSON.stringify({
            ...profile,
            fullName: profile.fullName.trim(),
            about: profile.about.trim(),
            ...(encryptionKeyUpdate ? { encryptionKeyUpdate } : {})
          })
        });
        document.dispatchEvent(new CustomEvent("polus:profile-saved", {
          detail: { user: updatedUser }
        }));
        document.dispatchEvent(new CustomEvent("polus:notify", {
          detail: sessionsRevoked
            ? languageRef.current === "ru"
              ? "Пароль изменён. Войдите снова."
              : "Password changed. Sign in again."
            : languageRef.current === "ru" ? "Настройки аккаунта сохранены." : "Account settings saved."
        }));
        event.detail.resolve(updatedUser);
        if (sessionsRevoked) {
          document.dispatchEvent(new CustomEvent("polus:account-session-invalid", {
            detail: { accountKey: getActiveAccountKey() }
          }));
        }
      } catch (cause) {
        const currentLanguage = languageRef.current;
        const russianErrors = {
          "Current password is incorrect.": "Неверный текущий пароль.",
          "Unable to unlock the legacy encryption key. Check the password that sealed it.": "Не удалось открыть старый ключ. Проверьте пароль, которым он был запечатан.",
          "Unable to unlock the legacy signing key. Check the password that sealed it.": "Не удалось открыть старый ключ подписи. Проверьте пароль, которым он был запечатан."
        };
        const message = currentLanguage === "ru" ? (russianErrors[cause.message] || cause.message) : cause.message;
        event.detail.reject(new Error(message));
      }
    };
    const handleEditMessage = async (event) => {
      const { message } = event.detail || {};
      if (!message) return;
      const currentLanguage = languageRef.current;
      if (Date.now() - Date.parse(message.createdAt || message.sentAt) > 48 * 60 * 60 * 1000) {
        document.dispatchEvent(new CustomEvent("polus:notify", {
          detail: currentLanguage === "ru"
            ? "Редактировать сообщение можно только в течение 48 часов."
            : "Messages can only be edited within 48 hours."
        }));
        return;
      }
      const value = window.prompt(
        currentLanguage === "ru" ? "Изменить сообщение" : "Edit message",
        message.text
      );
      if (value === null || !value.trim() || value.trim() === message.text) return;
      if (Array.from(value.trim()).length > 4000) {
        document.dispatchEvent(new CustomEvent("polus:notify", {
          detail: currentLanguage === "ru"
            ? "Сообщение должно содержать от 1 до 4000 символов."
            : "Message must contain 1–4000 characters."
        }));
        return;
      }
      try {
        const recipients = await getConversationEncryptionKeys(message.conversationId, activeAccountKey);
        const encryptedText = await encryptMessagePayload(user.id, recipients, message.conversationId, {
          text: value,
          mediaType: message.mediaType || null,
          attachments: (message.attachments || []).map((attachment) => ({
            id: attachment.id,
            name: attachment.name,
            mimeType: attachment.mimeType,
            size: attachment.size,
            encrypted: attachment.encrypted === true,
            ...(attachment.encryption ? attachment.encryption : {})
          }))
        });
        const updated = await requestJson(`/api/messages/${encodeURIComponent(message.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ text: encryptedText, encrypted: true })
        });
        document.dispatchEvent(new CustomEvent("polus:message-edited", { detail: { message: updated } }));
      } catch (cause) {
        const notice = cause.code === "ENCRYPTION_KEY_CHANGED"
          ? await getEncryptionKeyChangeNotice(cause, currentLanguage)
          : localizeComposerError(cause.message, currentLanguage);
        document.dispatchEvent(new CustomEvent("polus:notify", {
          detail: notice
        }));
      }
    };
    const handleDeleteMessage = async (event) => {
      const { message } = event.detail || {};
      if (!message) return;
      if (!window.confirm(languageRef.current === "ru" ? "Удалить это сообщение?" : "Delete this message?")) return;
      try {
        const deleted = await requestJson(`/api/messages/${encodeURIComponent(message.id)}`, {
          method: "DELETE"
        });
        if (deleted.id) {
          document.dispatchEvent(new CustomEvent("polus:message-deleted", { detail: { message: deleted } }));
        }
      } catch (cause) {
        document.dispatchEvent(new CustomEvent("polus:notify", {
          detail: localizeComposerError(cause.message, languageRef.current)
        }));
      }
    };
    document.addEventListener("polus:session-signed-out", handleSignOut);
    document.addEventListener("polus:connect-realtime", handleConnectRealtime);
    document.addEventListener("polus:presence-stop", handlePresenceStop);
    document.addEventListener("polus:open-profile-settings", handleOpenProfilePage);
    document.addEventListener("polus:open-own-profile", handleOpenProfilePage);
    document.addEventListener("polus:open-contacts", handleOpenContacts);
    document.addEventListener("polus:profile-page-back", handleProfileBack);
    document.addEventListener("polus:channel-settings-profile", handleChannelSettingsProfile);
    document.addEventListener("polus:open-channel-profile", handleOpenChannelProfile);
    document.addEventListener("polus:open-channel-settings", handleOpenChannelSettings);
    document.addEventListener("polus:open-group-settings", handleOpenGroupSettings);
    document.addEventListener("polus:exit-group-settings", handleExitGroupSettings);
    document.addEventListener("polus:page-open-chat", handleOpenPageChat);
    document.addEventListener("polus:open-profile-community", handleOpenProfileCommunity);
    document.addEventListener("polus:realtime-message", handleRealtimeMessageSound);
    window.addEventListener("popstate", handlePopState);
    document.addEventListener("polus:composer-state", handlePresenceConversation);
    document.addEventListener("visibilitychange", handlePresenceVisibility);
    window.addEventListener("focus", handlePresenceVisibility);
    window.addEventListener("pagehide", handlePresenceStop);
    document.addEventListener("polus:load-message-history", handleLoadMessageHistory);
    document.addEventListener("polus:mark-conversation-read", handleMarkConversationRead);
    document.addEventListener("polus:request-direct-message", handleDirectMessageRequest);
    document.addEventListener("polus:create-channel", handleCreateChannel);
    document.addEventListener("polus:create-group", handleCreateGroup);
    document.addEventListener("polus:save-profile", handleSaveProfile);
    document.addEventListener("polus:edit-message", handleEditMessage);
    document.addEventListener("polus:delete-message", handleDeleteMessage);
    disposeController = initializeMessenger();
    return () => {
      active = false;
      clearInterval(presenceTimer);
      eventStream?.close();
      void reportChatViewingState(true);
      document.removeEventListener("polus:session-signed-out", handleSignOut);
      document.removeEventListener("polus:connect-realtime", handleConnectRealtime);
      document.removeEventListener("polus:presence-stop", handlePresenceStop);
      document.removeEventListener("polus:open-profile-settings", handleOpenProfilePage);
      document.removeEventListener("polus:open-own-profile", handleOpenProfilePage);
      document.removeEventListener("polus:open-contacts", handleOpenContacts);
      document.removeEventListener("polus:profile-page-back", handleProfileBack);
      document.removeEventListener("polus:channel-settings-profile", handleChannelSettingsProfile);
      document.removeEventListener("polus:open-channel-profile", handleOpenChannelProfile);
      document.removeEventListener("polus:open-channel-settings", handleOpenChannelSettings);
      document.removeEventListener("polus:open-group-settings", handleOpenGroupSettings);
      document.removeEventListener("polus:exit-group-settings", handleExitGroupSettings);
      document.removeEventListener("polus:page-open-chat", handleOpenPageChat);
      document.removeEventListener("polus:open-profile-community", handleOpenProfileCommunity);
      document.removeEventListener("polus:realtime-message", handleRealtimeMessageSound);
      window.removeEventListener("popstate", handlePopState);
      document.removeEventListener("polus:composer-state", handlePresenceConversation);
      document.removeEventListener("visibilitychange", handlePresenceVisibility);
      window.removeEventListener("focus", handlePresenceVisibility);
      window.removeEventListener("pagehide", handlePresenceStop);
      document.removeEventListener("polus:load-message-history", handleLoadMessageHistory);
      document.removeEventListener("polus:mark-conversation-read", handleMarkConversationRead);
      document.removeEventListener("polus:request-direct-message", handleDirectMessageRequest);
      document.removeEventListener("polus:create-channel", handleCreateChannel);
      document.removeEventListener("polus:create-group", handleCreateGroup);
      document.removeEventListener("polus:save-profile", handleSaveProfile);
      document.removeEventListener("polus:edit-message", handleEditMessage);
      document.removeEventListener("polus:delete-message", handleDeleteMessage);
      disposeController?.();
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = publicProfileUsername
      ? `${language === "ru" ? "Профиль" : "Profile"} @${publicProfileUsername} — Полюс`
      : language === "ru" ? "Полюс — мессенджер" : "Polus — Messenger";
  }, [language, publicProfileUsername]);

  return (
    <>
    <main id="messenger-view" className="messenger-shell" hidden={
      hidden || profilePage || contactsPage || Boolean(publicProfileUsername) || Boolean(channelProfileId) || Boolean(channelSettingsId)
      || Boolean(groupSettingsId) || Boolean(inviteToken)
    }>
      <aside id="chat-sidebar" className="sidebar">
        <header className="sidebar-header">
          <button
            id="sidebar-menu-button"
            className="sidebar-menu-button"
            type="button"
            aria-label={language === "ru" ? "Меню" : "Menu"}
            aria-haspopup="true"
            aria-expanded={menuOpen}
            aria-controls="sidebar-menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
          <SidebarSearch />
        </header>
        <SidebarMenu
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          accounts={accounts}
          activeAccountKey={activeAccountKey}
          onSwitchAccount={onSwitchAccount}
          onAddAccount={onAddAccount}
          onManageAccounts={() => setAccountsDialogOpen(true)}
          onOpenContacts={() => document.dispatchEvent(new CustomEvent("polus:open-contacts"))}
        />
        <div id="chat-list-scroll" className="chat-list-scroll">
          <ConversationList userId={user.id} />
        </div>
        <button
          id="new-message"
          className="new-message-fab"
          type="button"
          aria-label={language === "ru" ? "Новое сообщение" : "New message"}
          title={language === "ru" ? "Новое сообщение" : "New message"}
          onClick={() => document.dispatchEvent(new CustomEvent("polus:open-people-search", { detail: { query: "" } }))}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></svg>
        </button>
      </aside>
      <section
        id="chat-panel"
        className="chat-panel"
        aria-label={language === "ru" ? "Переписка" : "Conversation"}
        onTouchStart={handleMobileTouchStart}
        onTouchEnd={handleMobileTouchEnd}
        onTouchCancel={() => { mobileSwipeStartRef.current = null; }}
      >
        <header className="chat-header">
          <button
            id="mobile-backdrop"
            className="mobile-backdrop"
            type="button"
            aria-label={language === "ru" ? "Закрыть меню" : "Close menu"}
            onClick={closeMobileChat}
          />
          <div className="chat-title-wrap"><ConversationHeader /></div>
          <HeaderActions />
        </header>
        <div
          id="message-list"
          className="message-list"
          aria-live="polite"
          onScroll={() => document.dispatchEvent(new CustomEvent("polus:message-list-scroll"))}
        >
          <MessagesView />
        </div>
        <MessageContextMenu />
        <ToastNotice />
        <Composer user={user} accountKey={activeAccountKey} />
        <ChatDeleteDialog />
      </section>
    </main>
    <ReactDialogs user={user} />
    <UserPicker />
    <ContactShareDialog />
    <AccountManagementDialog
      open={accountsDialogOpen}
      onClose={() => setAccountsDialogOpen(false)}
      accounts={accounts}
      activeAccountKey={activeAccountKey}
      onSwitchAccount={onSwitchAccount}
      onRemoveAccount={onRemoveAccount}
    />
    {!hidden && contactsPage && (
      <ContactsPage
        onBack={() => document.dispatchEvent(new CustomEvent("polus:profile-page-back"))}
      />
    )}
    {!hidden && publicProfileUsername && (
      <UserProfileContent
        key={publicProfileUsername}
        username={publicProfileUsername}
        currentUserId={user.id}
        currentUsername={user.username}
        onBack={() => document.dispatchEvent(new CustomEvent("polus:profile-page-back"))}
      />
    )}
    {!hidden && profilePage && (
      <ProfileSettingsPage
        user={profileUser}
        onBack={() => document.dispatchEvent(new CustomEvent("polus:profile-page-back"))}
        onUserUpdate={updateProfileUser}
      />
    )}
    {!hidden && channelProfileId && (
      <ChannelProfilePage
        channelId={channelProfileId}
        onBack={() => document.dispatchEvent(new CustomEvent("polus:profile-page-back"))}
        onOpenChat={(conversation, options = {}) => document.dispatchEvent(new CustomEvent("polus:page-open-chat", {
          detail: { conversation, ...options }
        }))}
      />
    )}
    {!hidden && channelSettingsId && (
      <ChannelSettingsPage
        channelId={channelSettingsId}
        onBack={() => document.dispatchEvent(new CustomEvent("polus:profile-page-back", {
          detail: { channelId: channelSettingsId }
        }))}
        onProfile={() => document.dispatchEvent(new CustomEvent("polus:channel-settings-profile", {
          detail: { channelId: channelSettingsId }
        }))}
      />
    )}
    {!hidden && groupSettingsId && (
      <GroupSettingsPage
        groupId={groupSettingsId}
        onBack={() => document.dispatchEvent(new CustomEvent("polus:profile-page-back", {
          detail: { groupId: groupSettingsId }
        }))}
      />
    )}
    {!hidden && inviteToken && (
      <InviteLandingPage
        token={inviteToken}
        onBack={() => document.dispatchEvent(new CustomEvent("polus:profile-page-back"))}
        onOpenChat={(conversation) => document.dispatchEvent(new CustomEvent("polus:page-open-chat", {
          detail: { conversation }
        }))}
      />
    )}
    </>
  );
}

function AuthScreen({ language, onLanguageChange, onAuthenticated, accountKey, onCancel }) {
  const [mode, setMode] = useState("login");
  const [privacyVersion, setPrivacyVersion] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const registering = mode === "register";
  const text = translations[language];

  useEffect(() => {
    requestJson("/api/config", { accountKey: null })
      .then((config) => setPrivacyVersion(config.privacyVersion))
      .catch((cause) => setError(cause.message));
  }, []);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    const payload = {
      username: String(form.get("username") || "").trim().replace(/^@/, ""),
      password: String(form.get("password") || "")
    };
    if (registering) {
      payload.fullName = String(form.get("fullName") || "").trim();
      payload.about = String(form.get("about") || "").trim();
      payload.confirmPassword = String(form.get("confirmPassword") || "");
      payload.acceptPrivacy = form.get("acceptPrivacy") === "on";
      payload.privacyVersion = privacyVersion;
    }

    try {
      const { user } = await requestJson(`/api/auth/${registering ? "register" : "login"}`, {
        method: "POST",
        body: JSON.stringify(payload),
        accountKey
      });
      if (registering) {
        await ensureEncryptionIdentity(user.id, payload.password, "", accountKey);
      }
      await onAuthenticated(user, accountKey);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-view">
      <section className="auth-card">
        <div className="auth-brand">
          <img src="/logo.svg" alt="" className="auth-logo" />
          <span>ПОЛЮС</span>
        </div>
        <div className="auth-language">
          <label htmlFor="react-language" className="visually-hidden">Язык</label>
          <select
            id="react-language"
            className="language-select"
            aria-label="Language"
            value={language}
            onChange={(event) => onLanguageChange(event.target.value)}
          >
            <option value="ru">Русский</option>
            <option value="en">English</option>
          </select>
        </div>
        {onCancel && (
          <button className="text-button account-auth-cancel" type="button" onClick={onCancel}>
            {language === "ru" ? "Вернуться в аккаунт" : "Back to account"}
          </button>
        )}
        <div className="auth-heading">
          <div className="eyebrow">{text.welcome}</div>
          <h1>{registering ? text.createAccount : text.signIn}</h1>
          <p>{registering ? text.registerSubtitle : text.signInSubtitle}</p>
        </div>
        <form className="auth-form" onSubmit={submit}>
          {registering && (
            <>
              <label className="field-label" htmlFor="react-full-name">{text.fullName}</label>
              <input
                id="react-full-name"
                className="text-field"
                name="fullName"
                type="text"
                maxLength={50}
                autoComplete="name"
                placeholder={text.fullNamePlaceholder}
                required
              />
              <label className="field-label" htmlFor="react-about">{text.about}</label>
              <textarea id="react-about" className="text-field about-field" name="about" maxLength={200} rows={2} />
            </>
          )}
          <label className="field-label" htmlFor="react-username">{text.username}</label>
          <div className="username-field">
            <span aria-hidden="true">@</span>
            <input
              id="react-username"
              className="text-field"
              name="username"
              type="text"
              minLength={3}
              maxLength={32}
              autoComplete="username"
              required
              pattern="[A-Za-z0-9_]+"
              placeholder="polus_user"
            />
          </div>
          {registering && <div className="field-hint">{text.usernameHint}</div>}
          <label className="field-label" htmlFor="react-password">{text.password}</label>
          <input
            id="react-password"
            className="text-field"
            name="password"
            type="password"
            minLength={8}
            maxLength={128}
            autoComplete={registering ? "new-password" : "current-password"}
            required
          />
          {registering && (
            <>
              <label className="field-label" htmlFor="react-confirm-password">{text.confirmPassword}</label>
              <input
                id="react-confirm-password"
                className="text-field"
                name="confirmPassword"
                type="password"
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
                required
              />
              <label className="consent-row">
                <input name="acceptPrivacy" type="checkbox" required />
                <span>{text.consent} <a href="/privacy" target="_blank" rel="noopener">{text.privacy}</a>.</span>
              </label>
            </>
          )}
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="primary-button auth-submit" type="submit" disabled={submitting || !privacyVersion}>
            {submitting ? "…" : registering ? text.createAccount : text.signInButton}
          </button>
        </form>
        <div className="auth-switch">
          <span>{registering ? text.hasAccount : text.noAccount}</span>
          <button className="text-button" type="button" onClick={() => { setError(""); setMode(registering ? "login" : "register"); }}>
            {registering ? text.signInButton : text.createAccount}
          </button>
        </div>
        <div className="auth-privacy-note"><span aria-hidden="true">⌁</span> <span>{text.privacyNote}</span></div>
      </section>
    </main>
  );
}

function EncryptionUnlock({ user, accountKey, language, onUnlocked }) {
  const [accountPassword, setAccountPassword] = useState("");
  const [legacyEncryptionPassphrase, setLegacyEncryptionPassphrase] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const russian = language === "ru";

  async function unlock(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await ensureEncryptionIdentity(user.id, accountPassword, legacyEncryptionPassphrase, accountKey);
      setAccountPassword("");
      setLegacyEncryptionPassphrase("");
      onUnlocked();
    } catch (cause) {
      setError(cause.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-view">
      <form className="auth-card" onSubmit={(event) => void unlock(event)}>
        <div className="auth-brand"><img src="/logo.svg" alt="" className="auth-logo" /><span>ПОЛЮС</span></div>
        <h1>{russian ? "Защищённые сообщения" : "Encrypted messages"}</h1>
        <p>{russian
          ? "Ключ шифрования автоматически передаётся сервером из его конфигурации. Для старого ключа может понадобиться прежняя фраза один раз, чтобы перенести его на общий ключ."
          : "The encryption key is supplied by the server configuration. An older key may require its previous phrase once to migrate it to the shared key."}</p>
        <label className="field-label" htmlFor="encryption-unlock-passphrase">
          {russian ? "Прежняя фраза (только для старого ключа)" : "Previous phrase (legacy keys only)"}
        </label>
        <input
          id="encryption-unlock-passphrase"
          className="text-field"
          type="password"
          autoComplete="current-password"
          maxLength={128}
          value={legacyEncryptionPassphrase}
          onChange={(event) => setLegacyEncryptionPassphrase(event.target.value)}
        />
        <label className="field-label" htmlFor="encryption-unlock-account-password">
          {russian
            ? "Пароль аккаунта (только если старый ключ был запечатан им)"
            : "Account password (only if an older key was sealed with it)"}
        </label>
        <input
          id="encryption-unlock-account-password"
          className="text-field"
          type="password"
          autoComplete="current-password"
          value={accountPassword}
          onChange={(event) => setAccountPassword(event.target.value)}
        />
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="primary-button" type="submit" disabled={submitting}>
          {submitting ? "…" : (russian ? "Разблокировать" : "Unlock")}
        </button>
      </form>
    </main>
  );
}

export default function App() {
  const [language, setLanguage] = useState(() => localStorage.getItem("polus-language") === "en" ? "en" : "ru");
  const [theme, setTheme] = useState(() => {
    const savedTheme = localStorage.getItem("polus-theme");
    return THEME_OPTIONS.some((option) => option.id === savedTheme) ? savedTheme : "light";
  });
  const [messageSound, setMessageSound] = useState(() => localStorage.getItem("polus-message-sound") === "true");
  const [user, setUser] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [activeAccountKey, setActiveAccountKeyState] = useState(null);
  const [pendingAccountKey, setPendingAccountKey] = useState(() => createAccountKey());
  const [addingAccount, setAddingAccount] = useState(false);
  const [loading, setLoading] = useState(true);
  const [encryptionReady, setEncryptionReady] = useState(false);
  const [encryptionChecking, setEncryptionChecking] = useState(false);
  const [error, setError] = useState("");
  const accountsRef = useRef(accounts);
  accountsRef.current = accounts;

  useEffect(() => {
    const onRuntimeError = (event) => {
      logClientDiagnostic("app.window-error", {
        message: event.message || "Unknown browser error",
        source: event.filename ? new URL(event.filename, window.location.href).pathname : "",
        line: event.lineno || null,
        column: event.colno || null,
        stack: event.error?.stack || ""
      }, "error");
    };
    const onUnhandledRejection = (event) => {
      const reason = event.reason;
      logClientDiagnostic("app.unhandled-rejection", {
        errorName: reason?.name || typeof reason,
        error: reason?.message || String(reason),
        stack: reason?.stack || ""
      }, "error");
    };
    window.addEventListener("error", onRuntimeError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    window.polusDiagnostics = {
      getLogs: getClientDiagnostics,
      clear: clearClientDiagnostics
    };
    logClientDiagnostic("app.started", {
      secureContext: window.isSecureContext,
      randomUUIDAvailable: typeof globalThis.crypto?.randomUUID === "function",
      path: window.location.pathname
    }, "info");
    return () => {
      window.removeEventListener("error", onRuntimeError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      delete window.polusDiagnostics;
    };
  }, []);

  useEffect(() => {
    localStorage.setItem("polus-language", language);
    document.documentElement.lang = language;
    document.title = language === "ru" ? "Полюс — мессенджер" : "Polus — Messenger";
  }, [language]);

  useLayoutEffect(() => {
    localStorage.setItem("polus-theme", theme);
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.colorTheme = theme;
    document.documentElement.style.colorScheme = theme === "dark" ? "dark" : "light";
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("polus-message-sound", String(messageSound));
  }, [messageSound]);

  useEffect(() => {
    let active = true;
    const restoreAccounts = async () => {
      try {
        const savedAccounts = getStoredAccounts();
        if (savedAccounts.length) {
          const checkedAccounts = await Promise.all(savedAccounts.map(async (account) => {
            try {
              const result = await requestJson("/api/auth/me", { accountKey: account.key });
              if (!result.user) return null;
              try {
                const bootstrap = await requestJson("/api/bootstrap", { accountKey: account.key });
                const unreadCount = [...bootstrap.channels, ...bootstrap.directs].reduce((total, chat) =>
                  total + (Number.isSafeInteger(chat.unreadCount) ? chat.unreadCount : 0), 0);
                return { ...account, user: bootstrap.user, unreadCount };
              } catch (cause) {
                if (cause.status === 401) return null;
                return { ...account, user: result.user };
              }
            } catch (cause) {
              if (cause.status === 401) return null;
              return account;
            }
          }));
          const validAccounts = checkedAccounts.filter(Boolean);
          saveAccounts(validAccounts);
          if (active) {
            setAccounts(validAccounts);
            const requestedUserId = getRequestedAccountUserId();
            const savedActiveKey = localStorage.getItem("polus-active-account");
            const selected = validAccounts.find((account) => account.user.id === requestedUserId)
              || validAccounts.find((account) => account.key === savedActiveKey)
              || validAccounts[0];
            if (selected) {
              const identityReady = await hasReadyEncryptionIdentity(selected.user.id, selected.key);
              setActiveAccountKey(selected.key);
              setActiveAccountKeyState(selected.key);
              setUser(selected.user);
              setEncryptionReady(identityReady);
              if (requestedUserId) {
                const url = new URL(window.location.href);
                url.searchParams.delete("accountUserId");
                window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
              }
            }
          }
          return;
        }
        const { user: legacyUser } = await requestJson("/api/auth/me", { accountKey: null });
        if (!legacyUser || !active) return;
        const key = createAccountKey();
        const { user: attachedUser } = await requestJson("/api/auth/accounts/attach", {
          method: "POST",
          body: JSON.stringify({ accountKey: key }),
          accountKey: null
        });
        if (!active) return;
        const migratedAccounts = [{ key, user: attachedUser }];
        saveAccounts(migratedAccounts);
        setAccounts(migratedAccounts);
        setActiveAccountKey(key);
        setActiveAccountKeyState(key);
        setUser(attachedUser);
        setEncryptionReady(await hasReadyEncryptionIdentity(attachedUser.id, key));
      } catch (cause) {
        if (active) setError(cause.message);
      } finally {
        if (active) setLoading(false);
      }
    };
    void restoreAccounts();
    return () => { active = false; };
  }, []);

  const commitAccounts = useCallback((nextAccounts) => {
    saveAccounts(nextAccounts);
    setAccounts(nextAccounts);
  }, []);
  const activateAccount = useCallback((key) => {
    const selected = accounts.find((account) => account.key === key);
    if (!selected) return;
    setActiveAccountKey(key);
    setActiveAccountKeyState(key);
    setUser(selected.user);
    setEncryptionReady(false);
    setEncryptionChecking(true);
    void hasReadyEncryptionIdentity(selected.user.id, key).then((ready) => {
      if (getActiveAccountKey() === key) {
        setEncryptionReady(ready);
        setEncryptionChecking(false);
      }
    }).catch((cause) => {
      if (getActiveAccountKey() === key) {
        setError(cause.message);
        setEncryptionChecking(false);
      }
    });
    setAddingAccount(false);
    setError("");
    setPendingAccountKey(createAccountKey());
  }, [accounts]);
  const removeAccount = useCallback((key) => {
    const nextAccounts = accounts.filter((account) => account.key !== key);
    commitAccounts(nextAccounts);
    if (key !== activeAccountKey) return;
    const next = nextAccounts[0];
    if (next) {
      setActiveAccountKey(next.key);
      setActiveAccountKeyState(next.key);
      setUser(next.user);
      setEncryptionReady(false);
      setEncryptionChecking(true);
      void hasReadyEncryptionIdentity(next.user.id, next.key).then((ready) => {
        if (getActiveAccountKey() === next.key) {
          setEncryptionReady(ready);
          setEncryptionChecking(false);
        }
      }).catch((cause) => {
        if (getActiveAccountKey() === next.key) {
          setError(cause.message);
          setEncryptionChecking(false);
        }
      });
    } else {
      setActiveAccountKey(null);
      setActiveAccountKeyState(null);
      setUser(null);
      setEncryptionReady(false);
      setEncryptionChecking(false);
      setPendingAccountKey(createAccountKey());
    }
    setAddingAccount(false);
  }, [accounts, activeAccountKey, commitAccounts]);
  const handleSignOut = useCallback(() => {
    if (activeAccountKey) removeAccount(activeAccountKey);
  }, [activeAccountKey, removeAccount]);
  useEffect(() => {
    const invalidateAccount = (event) => {
      const key = event.detail?.accountKey;
      if (key && accounts.some((account) => account.key === key)) removeAccount(key);
    };
    document.addEventListener("polus:account-session-invalid", invalidateAccount);
    return () => document.removeEventListener("polus:account-session-invalid", invalidateAccount);
  }, [accounts, removeAccount]);
  const handleAuthenticated = useCallback(async (authenticatedUser, key) => {
    const accountKey = key || createAccountKey();
    const encryptionReady = await hasReadyEncryptionIdentity(authenticatedUser.id, accountKey);
    const account = { key: accountKey, user: authenticatedUser, unreadCount: 0 };
    const nextAccounts = [...accounts.filter((item) => item.key !== account.key), account];
    commitAccounts(nextAccounts);
    setActiveAccountKey(account.key);
    setActiveAccountKeyState(account.key);
    setUser(authenticatedUser);
    setEncryptionReady(encryptionReady);
    setEncryptionChecking(false);
    setAddingAccount(false);
    setError("");
    setPendingAccountKey(createAccountKey());
  }, [accounts, commitAccounts]);
  useEffect(() => {
    const updateCurrentUser = (event) => {
      const currentUser = event.detail;
      if (!currentUser || !activeAccountKey) return;
      setUser(currentUser);
      const nextAccounts = accounts.map((account) =>
        account.key === activeAccountKey ? { ...account, user: currentUser } : account);
      if (nextAccounts.some((account, index) => account !== accounts[index])) commitAccounts(nextAccounts);
    };
    const updateUnreadCount = (event) => {
      if (!activeAccountKey || !Number.isSafeInteger(event.detail?.unreadCount)) return;
      const nextAccounts = accounts.map((account) =>
        account.key === activeAccountKey ? { ...account, unreadCount: event.detail.unreadCount } : account);
      commitAccounts(nextAccounts);
    };
    document.addEventListener("polus:current-user-changed", updateCurrentUser);
    document.addEventListener("polus:account-unread-count", updateUnreadCount);
    return () => {
      document.removeEventListener("polus:current-user-changed", updateCurrentUser);
      document.removeEventListener("polus:account-unread-count", updateUnreadCount);
    };
  }, [accounts, activeAccountKey, commitAccounts]);
  const accountKeys = accounts.map((account) => account.key).join(",");
  useEffect(() => {
    const sources = accountsRef.current
      .filter((account) => account.key !== activeAccountKey)
      .map((account) => {
        const source = connectEventStream("/api/stream", {
          accountKey: account.key,
          onEvent: (event) => {
            if (event.type !== "message") return;
            let message;
            try {
              message = JSON.parse(event.data);
            } catch (cause) {
              console.error("Invalid message received for a background account:", cause);
              return;
            }
            if (message.author?.id === account.user.id) return;
            const nextAccounts = accountsRef.current.map((item) =>
              item.key === account.key ? { ...item, unreadCount: (item.unreadCount || 0) + 1 } : item);
            accountsRef.current = nextAccounts;
            try {
              saveAccounts(nextAccounts);
              setAccounts(nextAccounts);
            } catch (cause) {
              console.error("Unable to save background account unread state:", cause);
            }
            if (typeof Notification !== "undefined" && Notification.permission === "granted"
              && "serviceWorker" in navigator) {
              void navigator.serviceWorker.ready.then((registration) =>
                registration.showNotification(`${message.author?.fullName || message.author?.username || "Полюс"}`, {
                  body: language === "ru" ? "Новое сообщение" : "New message",
                  icon: "/logo.svg",
                  badge: "/logo.svg",
                  tag: `${account.user.id}:${message.conversationId || ""}`,
                  data: {
                    conversationId: message.conversationId || "",
                    accountUserId: account.user.id
                  }
                })).catch((cause) => console.error("Unable to show a background account notification:", cause));
            }
          },
          onError: (cause) => console.error("Background account realtime stream failed:", cause)
        });
        return source;
      });
    return () => sources.forEach((source) => source.close());
  }, [activeAccountKey, accountKeys, language]);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, theme, setTheme, messageSound, setMessageSound }}>
      <AppErrorBoundary>
        {loading
          ? <main className="auth-view" aria-busy="true">Загрузка Полюса…</main>
          : user
                ? encryptionChecking
                  ? <main className="auth-view" aria-busy="true">Загрузка Полюса…</main>
                  : !encryptionReady
                  ? <EncryptionUnlock
                  user={user}
                  accountKey={activeAccountKey}
                  language={language}
                  onUnlocked={() => setEncryptionReady(true)}
                />
                : (
                <>
                  <MessengerShell
                    key={activeAccountKey}
                    user={user}
                    onSignOut={handleSignOut}
                    accounts={accounts}
                    activeAccountKey={activeAccountKey}
                    onSwitchAccount={activateAccount}
                    onAddAccount={() => {
                      setPendingAccountKey(createAccountKey());
                      setAddingAccount(true);
                    }}
                    onRemoveAccount={removeAccount}
                    hidden={addingAccount}
                  />
                  {addingAccount && (
                    <AuthScreen
                      language={language}
                      onLanguageChange={setLanguage}
                      accountKey={pendingAccountKey}
                      onAuthenticated={handleAuthenticated}
                      onCancel={() => setAddingAccount(false)}
                    />
                  )}
                </>
              )
              : (
                <>
                  {error && <div className="form-error" role="alert">{error}</div>}
                  <AuthScreen
                    language={language}
                    onLanguageChange={setLanguage}
                    accountKey={pendingAccountKey}
                    onAuthenticated={handleAuthenticated}
                  />
              </>
            )}
      </AppErrorBoundary>
    </LanguageContext.Provider>
  );
}
