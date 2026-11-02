import { createRoot } from "react-dom/client";
import { Component, createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { requestJson } from "./apiClient.mjs";
import { createImageThumbnail, uploadAttachment, uploadAttachmentThumbnail } from "./attachmentUploads.mjs";
import { cropAvatar } from "./avatar.mjs";
import { getConversationHeaderControls, orderConversations } from "./conversationList.mjs";
import { clearClientDiagnostics, createClientId, getClientDiagnostics, logClientDiagnostic } from "./diagnostics.mjs";
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
let activeVoiceMessageAudio = null;

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
          ? <img src={conversation.avatarUrl} alt="" loading="lazy" />
          : initials(conversation.name)}
      </span>
      <span className="chat-row-body">
        <span className="chat-row-top">
          <span className="chat-row-name">
            <span className="chat-row-name-text">{saved ? text.savedMessages : conversation.name}</span>
            {conversation.pinned && !saved && !discover && (
              <span className="chat-row-pinned" title={text.pinnedChat} aria-label={text.pinnedChat}>
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M5 2.5h6l-.8 3.2 1.8 1.8v1H8.5v4.8l-.5.9-.5-.9V8.5H4v-1l1.8-1.8L5 2.5Z" />
                </svg>
              </span>
            )}
          </span>
          {lastTime && !discover && <span className="chat-row-time">{listTime(lastTime, language)}</span>}
        </span>
        <span className="chat-row-bottom">
          <span className="chat-row-preview">{description}</span>
          {!discover && conversation.unreadCount > 0 && (
            <span className={conversation.muted ? "unread-badge is-muted" : "unread-badge"}>
              {conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}
            </span>
          )}
          {discover && <span className="join-channel">{text.openChannel}</span>}
        </span>
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
  const language = useCurrentLanguage();
  useLayoutEffect(() => {
    const clear = () => setQuery("");
    document.addEventListener("polus:clear-sidebar-search", clear);
    return () => {
      document.removeEventListener("polus:clear-sidebar-search", clear);
    };
  }, []);

  return (
    <label className="sidebar-search">
      <span className="visually-hidden">{language === "ru" ? "Поиск" : "Search"}</span>
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
      <input
        id="sidebar-search"
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
      {visible.open.length > 0 && (
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
      {normalizedQuery && (
        <button
          type="button"
          className="chat-row people-row"
          onClick={() => document.dispatchEvent(new CustomEvent("polus:find-people"))}
        >
          <span className="chat-avatar avatar-tone-5" aria-hidden="true">⌕</span>
          <span className="chat-row-body">
            <span className="chat-row-name">{text.findPeopleFor} {query.trim()}</span>
          </span>
        </button>
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

function MessageText({ value }) {
  const pattern = /https?:\/\/[^\s<>"']+/giu;
  const parts = [];
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const raw = match[0];
    const href = raw.replace(/[),.!?;:]+$/g, "");
    if (match.index > cursor) parts.push(value.slice(cursor, match.index));
    parts.push(
      <a key={`${match.index}-${href}`} href={href} target="_blank" rel="noopener noreferrer">{href}</a>,
      raw.slice(href.length)
    );
    cursor = match.index + raw.length;
  }
  if (cursor < value.length) parts.push(value.slice(cursor));
  return parts.map((part, index) => (
    typeof part === "string" ? part.split("\n").flatMap((line, lineIndex) => (
      lineIndex === 0 ? [line] : [<br key={`${index}-${lineIndex}`} />, line]
    )) : part
  ));
}

function formatMediaTime(seconds) {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, "0")}`;
}

function VoiceMessagePlayer({ attachment, text }) {
  const audioRef = useRef(null);
  const playbackRequestedRef = useRef(false);
  const [playback, setPlayback] = useState({ playing: false, current: 0, duration: 0 });
  const bars = Array.from({ length: 36 }, (_, index) => 8 + ((index * 17 + index * index * 3) % 25));
  const progress = playback.duration ? playback.current / playback.duration : 0;
  useEffect(() => () => {
    const audio = audioRef.current;
    audio?.pause();
    if (activeVoiceMessageAudio === audio) activeVoiceMessageAudio = null;
  }, []);

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      if (attachment.mimeType && audio.canPlayType(attachment.mimeType) === "") {
        document.dispatchEvent(new CustomEvent("polus:notify", {
          detail: text.unsupportedAudioFormat
        }));
        return;
      }
      if (activeVoiceMessageAudio && activeVoiceMessageAudio !== audio) {
        activeVoiceMessageAudio.pause();
      }
      activeVoiceMessageAudio = audio;
      playbackRequestedRef.current = true;
      try {
        await audio.play();
      } catch (error) {
        playbackRequestedRef.current = false;
        if (activeVoiceMessageAudio === audio) activeVoiceMessageAudio = null;
        console.error("Voice message playback failed:", error);
        document.dispatchEvent(new CustomEvent("polus:notify", {
          detail: text.playbackFailed
        }));
      }
    } else {
      audio.pause();
    }
  };

  return (
    <div className="voice-message-player">
      <audio
        ref={audioRef}
        src={`/api/attachments/${encodeURIComponent(attachment.id)}`}
        preload="auto"
        onLoadedMetadata={(event) => {
          const duration = event.currentTarget.duration;
          setPlayback((current) => ({ ...current, duration }));
        }}
        onTimeUpdate={(event) => {
          const current = event.currentTarget.currentTime;
          setPlayback((playback) => ({ ...playback, current }));
        }}
        onPlaying={(event) => {
          const audio = event.currentTarget;
          playbackRequestedRef.current = false;
          if (activeVoiceMessageAudio && activeVoiceMessageAudio !== audio) {
            audio.pause();
            return;
          }
          activeVoiceMessageAudio = audio;
          setPlayback((current) => ({ ...current, playing: true }));
        }}
        onPause={(event) => {
          playbackRequestedRef.current = false;
          if (activeVoiceMessageAudio === event.currentTarget) activeVoiceMessageAudio = null;
          setPlayback((current) => ({ ...current, playing: false }));
        }}
        onEnded={(event) => {
          playbackRequestedRef.current = false;
          if (activeVoiceMessageAudio === event.currentTarget) activeVoiceMessageAudio = null;
          setPlayback((current) => ({ ...current, playing: false, current: 0 }));
        }}
        onError={() => {
          if (!playbackRequestedRef.current) return;
          playbackRequestedRef.current = false;
          if (activeVoiceMessageAudio === audioRef.current) activeVoiceMessageAudio = null;
          setPlayback((current) => ({ ...current, playing: false }));
          document.dispatchEvent(new CustomEvent("polus:notify", {
            detail: text.unsupportedAudioFormat
          }));
        }}
      />
      <button
        type="button"
        className="voice-message-play"
        aria-label={playback.playing ? text.pause : text.play}
        title={playback.playing ? text.pause : text.play}
        onClick={() => void togglePlayback()}
      >
        {playback.playing
          ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h3v14H8zM15 5h3v14h-3z" /></svg>
          : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z" /></svg>}
      </button>
      <div className={`voice-message-wave${playback.playing ? " is-playing" : ""}`} aria-hidden="true">
        {bars.map((height, index) => (
          <span
            key={index}
            className={index / bars.length <= progress ? "is-played" : ""}
            style={{ "--wave-height": `${height}%`, "--wave-delay": `${(index % 9) * -0.11}s` }}
          />
        ))}
      </div>
      <span className="voice-message-time">{formatMediaTime(playback.playing ? playback.current : playback.duration)}</span>
    </div>
  );
}

function MessageAttachment({ attachment, text, mediaType }) {
  const url = `/api/attachments/${encodeURIComponent(attachment.id)}`;
  const image = attachment.mimeType?.startsWith("image/");
  const media = image || /^(audio|video)\//.test(attachment.mimeType || "");
  if (mediaType === "voice") return <VoiceMessagePlayer attachment={attachment} text={text} />;

  return (
    <div className="message-attachment">
      {image && (
        <img
          className="message-attachment-image"
          src={attachment.thumbnailUrl || url}
          alt={attachment.name}
          loading="lazy"
          onClick={() => document.dispatchEvent(new CustomEvent("polus:open-media", { detail: { attachmentId: attachment.id } }))}
        />
      )}
      {!image && /^(audio|video)\//.test(attachment.mimeType || "") && (
        attachment.mimeType.startsWith("audio/")
          ? <audio controls preload="metadata" src={url} />
          : <video controls preload="metadata" src={url} />
      )}
      <a className="file-card" href={`${url}?download=1`} download={attachment.name}>
        <span className="file-card-icon">{media ? "▧" : "↧"}</span>
        <span className="file-card-details">
          <strong>{attachment.name}</strong>
          <small>{formatAttachmentSize(attachment.size)}</small>
        </span>
        <span className="file-card-download">{text.download}</span>
      </a>
    </div>
  );
}

function formatAttachmentSize(size) {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
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
              ? <img src={displayAuthor.avatarUrl} alt="" />
              : initials(displayAuthor.fullName)}
          </span>
        )
        : (
          <button type="button" className={avatarClass} aria-label={author.fullName || author.username || ""} onClick={openProfile}>
            {author.avatarUrl ? <img src={author.avatarUrl} alt="" /> : initials(author.fullName || author.username)}
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
                ? <img src={conversation.avatarUrl} alt="" />
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
                  ? <img src={conversation.avatarUrl} alt="" />
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

function UserSearchResults({ query }) {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const language = useCurrentLanguage();
  const normalizedQuery = query.trim().replace(/^@/, "");

  useEffect(() => {
    let active = true;
    setError("");
    if (normalizedQuery.length < 2) {
      setUsers([]);
      setLoading(false);
      return () => { active = false; };
    }

    setUsers([]);
    setLoading(true);
    const timer = setTimeout(() => {
      requestJson(`/api/users?q=${encodeURIComponent(query)}`)
        .then((result) => {
          if (active) setUsers(result);
        })
        .catch((cause) => {
          if (active) {
            setUsers([]);
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

  const message = normalizedQuery.length < 2
    ? (language === "ru" ? "Введи не меньше двух символов, чтобы найти людей." : "Type at least two characters to find people.")
    : loading
      ? (language === "ru" ? "Ищем людей…" : "Searching…")
      : error || (language === "ru" ? "Никого не нашли. Проверь имя пользователя." : "No matches. Check the username and try again.");

  return (
    <div id="user-results" className="user-results">
      {users.length === 0
        ? <div className="no-results">{message}</div>
        : users.map((user) => (
          <button
            key={user.id}
            className="user-result"
            type="button"
            onClick={() => document.dispatchEvent(new CustomEvent("polus:request-direct-message", {
              detail: { username: user.username }
            }))}
          >
            <span className={`result-avatar avatar-tone-${avatarTone(user.id)}`}>
              {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials(user.fullName)}
            </span>
            <span className="result-copy">
              <strong>{user.fullName}</strong>
              <small>@{user.username}</small>
            </span>
          </button>
        ))}
    </div>
  );
}

function PeopleDirectoryDialog() {
  const dialogRef = useRef(null);
  const searchRef = useRef(null);
  const [query, setQuery] = useState("");
  const language = useCurrentLanguage();

  useLayoutEffect(() => {
    const open = (event) => {
      const nextQuery = event.detail?.query || "";
      setQuery(nextQuery);
      if (!dialogRef.current?.open) dialogRef.current?.showModal();
      searchRef.current?.focus();
    };
    const close = () => dialogRef.current?.close();
    document.addEventListener("polus:open-people-search", open);
    document.addEventListener("polus:close-people-search", close);
    return () => {
      document.removeEventListener("polus:open-people-search", open);
      document.removeEventListener("polus:close-people-search", close);
    };
  }, []);

  return (
    <dialog id="directory-dialog" className="dialog" ref={dialogRef}>
      <form method="dialog" className="dialog-top">
        <div>
          <div className="eyebrow">{language === "ru" ? "НАЙТИ ЛЮДЕЙ" : "FIND PEOPLE"}</div>
          <h2>{language === "ru" ? "Новое сообщение" : "New message"}</h2>
        </div>
        <button className="icon-button dialog-close" value="cancel" aria-label="Close">×</button>
      </form>
      <label className="visually-hidden" htmlFor="user-search">
        {language === "ru" ? "Искать по имени или @username" : "Search by name or @username"}
      </label>
      <input
        id="user-search"
        ref={searchRef}
        className="text-field dialog-search"
        type="search"
        autoComplete="off"
        placeholder={language === "ru" ? "Имя или @username" : "Name or @username"}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
        }}
      />
      <UserSearchResults query={query} />
    </dialog>
  );
}

function UserProfileContent() {
  const [profile, setProfile] = useState(null);

  useLayoutEffect(() => {
    const onProfile = (event) => setProfile(event.detail);
    document.addEventListener("polus:user-profile-changed", onProfile);
    return () => {
      document.removeEventListener("polus:user-profile-changed", onProfile);
    };
  }, []);

  if (!profile) return <div id="profile-view-content" />;
  const { user, sharedChats, sharedMedia, canMessage, labels, status, registered, muted } = profile;
  const trigger = (action) => document.dispatchEvent(new CustomEvent("polus:user-profile-action", {
    detail: { action, username: user.username }
  }));
  return (
    <div id="profile-view-content">
      <section className="user-profile-hero">
        <div className="user-profile-avatar">
          {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials(user.fullName)}
        </div>
        <div className="user-profile-identity">
          <h3>{user.fullName}</h3>
          <span className="user-profile-handle">@{user.username}</span>
          {status && <span className={`user-profile-status${user.online ? " is-online" : ""}`}>{status}</span>}
        </div>
      </section>
      <div className="profile-actions">
        {canMessage && <button className="primary-button" type="button" onClick={() => trigger("message")}>{labels.writeToUser}</button>}
        <button className="danger-button" type="button" onClick={() => trigger("toggle-block")}>
          {user.blocked ? labels.unblockUser : labels.blockUser}
        </button>
        {muted !== null && (
          <button className="text-button" type="button" onClick={() => trigger("toggle-mute")}>
            {muted ? labels.unmuteChat : labels.muteChat}
          </button>
        )}
      </div>
      <section className="profile-detail-section">
        <h3>{labels.about}</h3>
        <p className="profile-about-copy">{user.about || labels.noAbout}</p>
      </section>
      {registered && <div className="profile-registered">{labels.registered}: {registered}</div>}
      <h3 className="profile-section-heading">{labels.sharedChats}</h3>
      <div className="profile-shared-chats">
        {sharedChats.length === 0
          ? <p className="profile-section-empty">{labels.noSharedChats}</p>
          : sharedChats.map((chat) => (
            <div className="profile-shared-chat" key={chat.id}>
              <span className="profile-shared-chat-icon">{chat.type === "channel" ? "#" : initials(chat.name)}</span>
              <span>{chat.name}</span>
            </div>
          ))}
      </div>
      <h3 className="profile-section-heading">{labels.sharedMedia}</h3>
      <div className="media-grid profile-media-grid">
        {sharedMedia.map((attachment) => (
          <img
            key={attachment.id}
            src={attachment.thumbnailUrl || `/api/attachments/${encodeURIComponent(attachment.id)}`}
            alt={attachment.name}
          />
        ))}
      </div>
      {sharedMedia.length === 0 && <p className="profile-section-empty">{labels.noSharedMedia}</p>}
    </div>
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
          detail: { messageId: snapshot.message.id, ...destination, resolve, reject }
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
                  {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials(user.fullName)}
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
                    ? <img src={chat.avatarUrl} alt="" />
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
            ? <img src={snapshot.avatarUrl} alt="" />
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
                      ? <img
                        src={item.thumbnailUrl || `/api/attachments/${encodeURIComponent(item.id)}`}
                        alt={item.name}
                        loading="lazy"
                        title={item.name}
                        onClick={() => act("open-media", { attachmentId: item.id, canView: snapshot.canView })}
                      />
                      : <video src={`/api/attachments/${encodeURIComponent(item.id)}`} controls preload="metadata" />}
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
                      {item.avatarUrl ? <img src={item.avatarUrl} alt="" loading="lazy" /> : initials(item.fullName)}
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
  );
}

function ChatManagementContent() {
  const [snapshot, setSnapshot] = useState(null);
  const [username, setUsername] = useState("");
  const [ownerUsername, setOwnerUsername] = useState("");
  const [channelName, setChannelName] = useState("");
  const [channelDescription, setChannelDescription] = useState("");
  const [busy, setBusy] = useState(false);

  useLayoutEffect(() => {
    const onManagement = (event) => {
      if (!event.detail) {
        setSnapshot(null);
        setUsername("");
        setOwnerUsername("");
        setChannelName("");
        setChannelDescription("");
        setBusy(false);
        return;
      }
      setSnapshot(event.detail);
      setUsername("");
      setOwnerUsername(event.detail.members.find((member) => member.id !== event.detail.chat.ownerId)?.username || "");
      setChannelName(event.detail.chat.name || "");
      setChannelDescription(event.detail.chat.description || "");
      setBusy(false);
    };
    document.addEventListener("polus:chat-management-changed", onManagement);
    return () => document.removeEventListener("polus:chat-management-changed", onManagement);
  }, []);

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

  return (
    <section id="chat-management-content" className="chat-profile-management">
      {isChannel && (
        <section className="channel-settings-section">
          <h3 className="management-heading">{labels.channelDetails}</h3>
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
            {currentRole === "owner" && <button className="primary-button" type="submit" disabled={busy}>{labels.saveChannelDetails}</button>}
          </form>
          {currentRole === "owner" && (
            <div className="channel-settings-options">
              <label className="field-label" htmlFor="channel-post-identity">{labels.channelPostIdentity}</label>
              <select
                id="channel-post-identity"
                className="text-field"
                value={chat.postAs === "channel" ? "channel" : "person"}
                disabled={busy}
                onChange={(event) => void act("set-post-identity", { postAs: event.target.value })}
              >
                <option value="person">{labels.postAsPerson}</option>
                <option value="channel">{labels.postAsChannel}</option>
              </select>
              <label className="field-label" htmlFor="channel-privacy">{labels.channelPrivacy}</label>
              <select
                id="channel-privacy"
                className="text-field"
                value={chat.isPrivate ? "private" : "public"}
                disabled={busy}
                onChange={(event) => void act("set-channel-privacy", { isPrivate: event.target.value === "private" })}
              >
                <option value="public">{labels.publicChannel}</option>
                <option value="private">{labels.privateChannel}</option>
              </select>
            </div>
          )}
        </section>
      )}
      <section className="channel-settings-section">
        <h3 className="management-heading">{labels.invitationSettings}</h3>
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
                  onClick={() => void act("revoke-invite-link")}
                >{labels.revokeInviteLink}</button>
              )}
            </div>
          </div>
        )}
        {canManage && (
          <form
            method="post"
            className="management-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (username.trim()) void act("invite-member", { username: username.trim().replace(/^@/, "") });
            }}
          >
            <input
              className="text-field"
              placeholder={labels.usernamePlaceholder}
              maxLength={33}
              required
              value={username}
              disabled={busy}
              onChange={(event) => setUsername(event.target.value)}
            />
            <button className="primary-button" type="submit" disabled={busy}>{labels.inviteMember}</button>
          </form>
        )}
      </section>
      <section className="channel-settings-section">
        <h3 className="management-heading">{labels.chatMembers} ({members.length})</h3>
        <div className="management-members">
          {members.map((member) => (
            <div className="management-member" key={member.id}>
              <span className="management-member-copy">
                <button
                  className="profile-inline-button management-member-name"
                  type="button"
                  onClick={() => document.dispatchEvent(new CustomEvent("polus:open-profile", {
                    detail: { username: member.username }
                  }))}
                >
                  {member.fullName}
                </button>
                <small>@{member.username} · {member.roleLabel}</small>
              </span>
              {currentRole === "owner" && member.id !== chat.ownerId && (
                <button
                  className="text-button"
                  type="button"
                  disabled={busy}
                  onClick={() => void act("toggle-admin", { memberId: member.id, makeAdmin: member.role !== "admin" })}
                >
                  {member.role === "admin" ? labels.removeAdmin : labels.makeAdmin}
                </button>
              )}
              {canManage && member.id !== snapshot.currentUserId && member.role === "member" && (
                <button
                  className="text-button"
                  type="button"
                  disabled={busy}
                  onClick={() => void act("remove-member", { memberId: member.id })}
                >
                  {labels.remove}
                </button>
              )}
            </div>
          ))}
        </div>
      </section>
      <section className="channel-settings-section channel-settings-danger">
        <h3 className="management-heading">{labels.administration}</h3>
        {currentRole === "owner" && (
          <>
            <form
              method="post"
              className="management-form ownership-transfer-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (ownerUsername) void act("transfer-ownership", { username: ownerUsername });
              }}
            >
              <select
                className="text-field"
                value={ownerUsername}
                disabled={busy || !members.some((member) => member.id !== chat.ownerId)}
                onChange={(event) => setOwnerUsername(event.target.value)}
              >
                {members.filter((member) => member.id !== chat.ownerId).map((member) => (
                  <option value={member.username} key={member.id}>{member.fullName} (@{member.username})</option>
                ))}
              </select>
              <button className="text-button" type="submit" disabled={busy || !ownerUsername}>{labels.transferOwnership}</button>
            </form>
            <button className="danger-button" type="button" disabled={busy} onClick={() => void act("delete-chat")}>
              {labels.deleteChat}
            </button>
          </>
        )}
        {currentRole !== "owner" && (
          <button className="danger-button" type="button" disabled={busy} onClick={() => void act("leave-chat")}>
            {labels.leaveChat}
          </button>
        )}
      </section>
    </section>
  );
}

function Composer() {
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
        item.uploaded = await uploadAttachment(conversationId, item.file, controller.signal, (percent) => {
          setUpload({ active: true, text: `${percent}% · ${item.file.name}` });
        });
        logClientDiagnostic("composer.upload.file-succeeded", {
          conversationId,
          size: item.file.size,
          mimeType: item.file.type || "unknown",
          durationMs: Math.round(performance.now() - uploadStartedAt)
        });
        replaceAttachments([...attachmentsRef.current]);
        if (item.file.type.startsWith("image/")) {
          try {
            const thumbnail = await createImageThumbnail(item.file);
            if (thumbnail) {
              setUpload({ active: true, text: `${language === "ru" ? "Миниатюра" : "Preview"} · ${item.file.name}` });
              const result = await uploadAttachmentThumbnail(
                conversationId,
                item.uploaded.id,
                thumbnail,
                controller.signal,
                (percent) => setUpload({
                  active: true,
                  text: `${language === "ru" ? "Миниатюра" : "Preview"} ${percent}% · ${item.file.name}`
                })
              );
              item.uploaded.thumbnailUrl = result.thumbnailUrl;
            }
          } catch (cause) {
            if (cause.name === "AbortError") throw cause;
            document.dispatchEvent(new CustomEvent("polus:notify", {
              detail: `${item.file.name}: ${labels.thumbnailFailed}`
            }));
          }
        }
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
      const payload = submittedConversation.pending
        ? {
          recipientUsername: submittedConversation.username,
          text: messageText,
          attachmentIds: attachments.map((item) => item.uploaded.id),
          ...(recordedMessageTypeRef.current ? { mediaType: recordedMessageTypeRef.current } : {})
        }
        : {
          conversationId: submittedConversation.id,
          text: messageText,
          attachmentIds: attachments.map((item) => item.uploaded.id),
          ...(recordedMessageTypeRef.current ? { mediaType: recordedMessageTypeRef.current } : {}),
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
      document.dispatchEvent(new CustomEvent("polus:notify", {
        detail: localizeComposerError(cause.message, language)
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

function SidebarMenu({ open, onClose }) {
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
            ? <img src={user.avatarUrl} alt="" />
            : initials(user?.fullName || (language === "ru" ? "Пользователь" : "User"))}
        </span>
        <span className="profile-copy">
          <strong id="profile-name">{user?.fullName || (language === "ru" ? "Пользователь" : "User")}</strong>
          <small id="profile-handle">@{user?.username || "username"}</small>
        </span>
        <span className="profile-menu-mark" aria-hidden="true">···</span>
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
          : user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials(user?.fullName || "")}
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
    currentPassword: "", newPassword: ""
  });
  const request = useFormRequest("polus:save-profile", "profile-error");

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
          newPassword: ""
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
        newPassword: ""
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
        newPassword: ""
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
        <p>{language === "ru" ? "Оставьте поля пустыми, если не хотите менять пароль." : "Leave these fields empty if you do not want to change your password."}</p>
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
        </div>
      </section>
      <FormError id="profile-error" />
      <button className="primary-button" type="submit" disabled={request.submitting}>
        {language === "ru" ? "Сохранить" : "Save"}
      </button>
    </form>
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
              {profile?.avatarUrl ? <img src={profile.avatarUrl} alt="" /> : initials(profile?.fullName || "")}
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
              <p>{russian ? "Язык, цветовая тема и звук сохраняются на этом устройстве." : "Language, theme, and sound settings are saved on this device."}</p>
            </div>
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
            channelDetails: russian ? "Основная информация" : "Channel details",
            channelName: russian ? "Название канала" : "Channel name",
            channelDescription: russian ? "Описание канала" : "Channel description",
            saveChannelDetails: russian ? "Сохранить изменения" : "Save changes",
            invitationSettings: russian ? "Приглашения" : "Invitations",
            invitationHelp: russian
              ? "Создайте ссылку или добавьте участника по имени пользователя."
              : "Create an invite link or add a member by username.",
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

  return (
    <main className="community-page channel-settings-page">
      <header className="community-page-header">
        <button className="icon-button profile-page-back" type="button" onClick={onBack}>
          <span aria-hidden="true">←</span>{russian ? "Назад" : "Back"}
        </button>
        <h1>{russian ? "Настройки канала" : "Channel settings"}</h1>
        <button className="text-button" type="button" onClick={onProfile}>
          {russian ? "Профиль канала" : "Channel profile"}
        </button>
      </header>
      <div className="channel-settings-content">
        {loadError && <div className="form-error" role="alert">{loadError}</div>}
        {chat && (
          <div className="channel-settings-identity">
            <span className="community-profile-icon" aria-hidden="true">#</span>
            <div>
              <h2>{chat.name}</h2>
              <p>{chat.description || (russian ? "Управление каналом и участниками." : "Manage your channel and members.")}</p>
              {!["owner", "admin"].includes(chat.role) && (
                <p className="channel-settings-permission-note">
                  {russian
                    ? "Изменять настройки могут только владелец и администраторы канала."
                    : "Only the channel owner and administrators can change settings."}
                </p>
              )}
            </div>
          </div>
        )}
        <ChatManagementContent />
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
        <img src={`/api/attachments/${encodeURIComponent(item.id)}`} alt={item.name || ""} />
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
          usernames: String(data.get("usernames") || "").split(",")
            .map((item) => item.trim().replace(/^@/, "")).filter(Boolean)
        });
      }}
    >
      <label className="field-label" htmlFor="group-name">{language === "ru" ? "Название группы" : "Group name"}</label>
      <input id="group-name" name="name" className="text-field" maxLength={50} required disabled={request.submitting} />
      <label className="field-label" htmlFor="group-members">
        {language === "ru" ? "Участники (@имена через запятую)" : "Members (@usernames, comma-separated)"}
      </label>
      <input id="group-members" name="usernames" className="text-field" placeholder="@alex, @sam" required disabled={request.submitting} />
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
      "chat-info-dialog", "chat-search-dialog", "forward-message-dialog", "profile-view-dialog",
      "media-viewer", "directory-dialog", "channel-dialog", "group-dialog", "settings-dialog"
    ];
    const onClose = (event) => {
      document.dispatchEvent(new CustomEvent("polus:dialog-open-state", {
        detail: { id: event.currentTarget.id, open: false }
      }));
    };
    ids.forEach((id) => document.getElementById(id)?.addEventListener("close", onClose));
    document.addEventListener("polus:open-dialog", openDialog);
    document.addEventListener("polus:close-dialog", closeDialog);
    return () => {
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
        <ChatManagementContent />
      </dialog>

      <ChatSearchDialog />
      <ForwardMessageDialog />

      <dialog id="profile-view-dialog" className="dialog profile-view-dialog">
        {dialogTitle(["ПРОФИЛЬ", "PROFILE"], ["Профиль", "Profile"], "profile-view-title")}
        <UserProfileContent />
      </dialog>

      <MediaViewer />

      <PeopleDirectoryDialog />

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

function MessengerShell({ user, onSignOut }) {
  const language = useCurrentLanguage();
  const languageRef = useRef(language);
  languageRef.current = language;
  const mobileSwipeStartRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profilePage, setProfilePage] = useState(() => window.location.pathname === "/profile");
  const [channelProfileId, setChannelProfileId] = useState(() =>
    /^\/channels\/([^/]+)$/.exec(window.location.pathname)?.[1] || null);
  const [channelSettingsId, setChannelSettingsId] = useState(() =>
    /^\/channels\/([^/]+)\/settings$/.exec(window.location.pathname)?.[1] || null);
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
    let disposeController;
    let eventStream = null;
    let presenceTimer = null;
    let currentConversation = null;
    let activeChannelSettingsId = /^\/channels\/([^/]+)\/settings$/.exec(window.location.pathname)?.[1] || null;
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
    const handleSignOut = () => onSignOut();
    const reportChatViewingState = (forceHidden = false) => {
      const messengerView = document.getElementById("messenger-view");
      const visible = !forceHidden && Boolean(messengerView?.isConnected && !messengerView.hidden)
        && document.visibilityState === "visible"
        && Boolean(currentConversation && !currentConversation.pending);
      return fetch("/api/presence/chat", {
        method: "POST",
        credentials: "same-origin",
        keepalive: forceHidden,
        headers: { "Content-Type": "application/json" },
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
    const handleOpenProfilePage = () => {
      setMenuOpen(false);
      if (window.location.pathname !== "/profile") {
        window.history.pushState({ polusPage: true, polusProfilePage: true }, "", "/profile");
      }
      setProfilePage(true);
      setChannelProfileId(null);
      setInviteToken(null);
      window.setTimeout(() => void reportChatViewingState(), 0);
    };
    const handleOpenChannelProfile = (event) => {
      const channelId = event.detail?.channelId;
      if (!channelId) return;
      window.history.pushState({ polusPage: true }, "", `/channels/${encodeURIComponent(channelId)}`);
      setProfilePage(false);
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
      setProfilePage(false);
      setChannelProfileId(null);
      setChannelSettingsId(channelId);
      setInviteToken(null);
      window.setTimeout(() => void reportChatViewingState(), 0);
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
        setProfilePage(false);
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
      if (channelId) {
        if (window.history.state?.polusPage
          && window.location.pathname === `/channels/${encodeURIComponent(channelId)}/settings`) {
          window.history.back();
        } else {
          void openChannelChat(channelId);
        }
        return;
      }
      if (window.history.state?.polusPage || window.history.state?.polusProfilePage) {
        window.history.back();
      } else {
        window.history.replaceState({}, "", "/");
        setProfilePage(false);
        setChannelProfileId(null);
        setChannelSettingsId(null);
        setInviteToken(null);
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
      setProfilePage(false);
      setChannelProfileId(null);
      setChannelSettingsId(null);
      setInviteToken(null);
      document.dispatchEvent(new CustomEvent("polus:open-conversation", { detail: { conversation } }));
    };
    const handlePopState = () => {
      const pathname = window.location.pathname;
      const settingsChannelId = activeChannelSettingsId;
      setProfilePage(pathname === "/profile");
      setChannelProfileId(/^\/channels\/([^/]+)$/.exec(pathname)?.[1] || null);
      setChannelSettingsId(/^\/channels\/([^/]+)\/settings$/.exec(pathname)?.[1] || null);
      setInviteToken(/^\/join\/([^/]+)$/.exec(pathname)?.[1] || null);
      if (!/^\/channels\/[^/]+\/settings$/.test(pathname)) activeChannelSettingsId = null;
      if (pathname === "/") {
        if (settingsChannelId && currentConversation?.id !== settingsChannelId) {
          void openChannelChat(settingsChannelId);
        }
        window.setTimeout(() => void reportChatViewingState(), 0);
      }
    };
    const handleRealtimeMessageSound = (event) => {
      if (event.detail?.authorId !== user.id) playNotificationSound();
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
      const source = new EventSource("/api/stream");
      eventStream = source;
      let hasOpened = false;
      source.addEventListener("open", () => {
        if (hasOpened) document.dispatchEvent(new CustomEvent("polus:realtime-resync"));
        hasOpened = true;
      });
      source.addEventListener("message", (event) => dispatchRealtimeEvent("polus:realtime-message", event));
      source.addEventListener("chat-updated", (event) =>
        dispatchRealtimeEvent("polus:realtime-chat-updated", event));
      source.addEventListener("message-updated", (event) =>
        dispatchRealtimeEvent("polus:realtime-message-updated", event));
      source.addEventListener("message-deleted", (event) =>
        dispatchRealtimeEvent("polus:realtime-message-deleted", event));
      source.addEventListener("messages-read", (event) =>
        dispatchRealtimeEvent("polus:realtime-messages-read", event));
      source.addEventListener("resync", () => {
        document.dispatchEvent(new CustomEvent("polus:realtime-resync"));
      });
      source.addEventListener("error", () => {
        if (eventStream === source && source.readyState === EventSource.CLOSED) {
          document.dispatchEvent(new CustomEvent("polus:notify", {
            detail: languageRef.current === "ru"
              ? "Не удалось подключиться к обновлениям. Проверьте соединение."
              : "Unable to connect to live updates. Check your connection."
          }));
        }
      });
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
        document.dispatchEvent(new CustomEvent("polus:close-people-search"));
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
      const { avatarFile, ...profile } = event.detail.values;
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
        const { user: updatedUser } = await requestJson("/api/account", {
          method: "PATCH",
          body: JSON.stringify({
            ...profile,
            fullName: profile.fullName.trim(),
            about: profile.about.trim()
          })
        });
        document.dispatchEvent(new CustomEvent("polus:profile-saved", {
          detail: { user: updatedUser }
        }));
        document.dispatchEvent(new CustomEvent("polus:notify", {
          detail: languageRef.current === "ru" ? "Настройки аккаунта сохранены." : "Account settings saved."
        }));
        event.detail.resolve(updatedUser);
      } catch (cause) {
        const currentLanguage = languageRef.current;
        const message = cause.message === "Current password is incorrect."
          ? (currentLanguage === "ru" ? "Неверный текущий пароль." : cause.message)
          : cause.message;
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
      try {
        const updated = await requestJson(`/api/messages/${encodeURIComponent(message.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ text: value })
        });
        document.dispatchEvent(new CustomEvent("polus:message-edited", { detail: { message: updated } }));
      } catch (cause) {
        document.dispatchEvent(new CustomEvent("polus:notify", {
          detail: localizeComposerError(cause.message, currentLanguage)
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
    document.addEventListener("polus:profile-page-back", handleProfileBack);
    document.addEventListener("polus:channel-settings-profile", handleChannelSettingsProfile);
    document.addEventListener("polus:open-channel-profile", handleOpenChannelProfile);
    document.addEventListener("polus:open-channel-settings", handleOpenChannelSettings);
    document.addEventListener("polus:page-open-chat", handleOpenPageChat);
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
      document.removeEventListener("polus:profile-page-back", handleProfileBack);
      document.removeEventListener("polus:channel-settings-profile", handleChannelSettingsProfile);
      document.removeEventListener("polus:open-channel-profile", handleOpenChannelProfile);
      document.removeEventListener("polus:open-channel-settings", handleOpenChannelSettings);
      document.removeEventListener("polus:page-open-chat", handleOpenPageChat);
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
  }, [onSignOut]);

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = language === "ru" ? "Полюс — мессенджер" : "Polus — Messenger";
  }, [language]);

  return (
    <>
    <main id="messenger-view" className="messenger-shell" hidden={
      profilePage || Boolean(channelProfileId) || Boolean(channelSettingsId) || Boolean(inviteToken)
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
        <SidebarMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
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
        <Composer />
        <ReactDialogs user={user} />
        <ChatDeleteDialog />
      </section>
    </main>
    {profilePage && (
      <ProfileSettingsPage
        user={profileUser}
        onBack={() => document.dispatchEvent(new CustomEvent("polus:profile-page-back"))}
        onUserUpdate={updateProfileUser}
      />
    )}
    {channelProfileId && (
      <ChannelProfilePage
        channelId={channelProfileId}
        onBack={() => document.dispatchEvent(new CustomEvent("polus:profile-page-back"))}
        onOpenChat={(conversation, options = {}) => document.dispatchEvent(new CustomEvent("polus:page-open-chat", {
          detail: { conversation, ...options }
        }))}
      />
    )}
    {channelSettingsId && (
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
    {inviteToken && (
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

function AuthScreen({ language, onLanguageChange, onAuthenticated }) {
  const [mode, setMode] = useState("login");
  const [privacyVersion, setPrivacyVersion] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const registering = mode === "register";
  const text = translations[language];

  useEffect(() => {
    requestJson("/api/config")
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
        body: JSON.stringify(payload)
      });
      onAuthenticated(user);
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

export default function App() {
  const [language, setLanguage] = useState(() => localStorage.getItem("polus-language") === "en" ? "en" : "ru");
  const [theme, setTheme] = useState(() => {
    const savedTheme = localStorage.getItem("polus-theme");
    return THEME_OPTIONS.some((option) => option.id === savedTheme) ? savedTheme : "light";
  });
  const [messageSound, setMessageSound] = useState(() => localStorage.getItem("polus-message-sound") === "true");
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
    requestJson("/api/auth/me")
      .then(({ user: currentUser }) => {
        if (active) setUser(currentUser);
      })
      .catch((cause) => {
        if (active) setError(cause.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const handleSignOut = useCallback((message = "") => {
    if (message) {
      setError(message);
      setUser(null);
      return;
    }
    window.location.reload();
  }, []);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, theme, setTheme, messageSound, setMessageSound }}>
      <AppErrorBoundary>
        {loading
          ? <main className="auth-view" aria-busy="true">Загрузка Полюса…</main>
          : user
            ? <MessengerShell user={user} onSignOut={handleSignOut} />
            : (
              <>
                {error && <div className="form-error" role="alert">{error}</div>}
                <AuthScreen
                  language={language}
                  onLanguageChange={setLanguage}
                  onAuthenticated={(authenticatedUser) => { setError(""); setUser(authenticatedUser); }}
                />
              </>
            )}
      </AppErrorBoundary>
    </LanguageContext.Provider>
  );
}
