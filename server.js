const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const webpush = require("web-push");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const DATA_FILE = path.join(__dirname, "data", "polus-store.json");
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;
const PRIVACY_VERSION = "2026-10-31";
const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,32}$/;
const LEGACY_CHANNEL_IDS = new Set(["general", "introductions", "off-topic"]);
const PUBLIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/privacy.js", ["privacy.js", "text/javascript; charset=utf-8"]],
  ["/sw.js", ["sw.js", "text/javascript; charset=utf-8"]],
  ["/logo.svg", ["logo.svg", "image/svg+xml"]],
  ["/manifest.webmanifest", ["manifest.webmanifest", "application/manifest+json; charset=utf-8"]],
  ["/privacy", ["privacy.html", "text/html; charset=utf-8"]]
]);
const FORMS_DISABLED_PATH = "/api/forms-disabled";
const SENSITIVE_QUERY_PARAMS = ["password", "confirmPassword", "currentPassword", "newPassword"];
const FORM_QUERY_PARAMS = ["username", "fullName", "about"];
const loginAttempts = new Map();
const loginAttemptsCleanup = setInterval(() => {
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [key, attempts] of loginAttempts) {
    const recent = attempts.filter((time) => time > cutoff);
    if (recent.length) loginAttempts.set(key, recent);
    else loginAttempts.delete(key);
  }
}, 60 * 1000);
loginAttemptsCleanup.unref();
const MAX_LOGIN_FAILURES = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_MESSAGES_PER_MINUTE = 20;
const MESSAGE_RATE_WINDOW_MS = 60 * 1000;
const MESSAGE_EDIT_WINDOW_MS = 48 * 60 * 60 * 1000;
const MESSAGE_PAGE_SIZE = 50;
const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
const MAX_ATTACHMENTS_PER_MESSAGE = 10;
const DAILY_UPLOAD_LIMIT = process.env.POLUS_DAILY_UPLOAD_LIMIT
  ? Number(process.env.POLUS_DAILY_UPLOAD_LIMIT)
  : 1024 * 1024 * 1024;
if (!Number.isSafeInteger(DAILY_UPLOAD_LIMIT) || DAILY_UPLOAD_LIMIT <= 0) {
  throw new Error("POLUS_DAILY_UPLOAD_LIMIT must be a positive safe integer.");
}
const messageAttempts = new Map();
const messageAttemptsCleanup = setInterval(() => {
  const cutoff = Date.now() - MESSAGE_RATE_WINDOW_MS;
  for (const [userId, attempts] of messageAttempts) {
    const recent = attempts.filter((time) => time > cutoff);
    if (recent.length) messageAttempts.set(userId, recent);
    else messageAttempts.delete(userId);
  }
}, 60 * 1000);
messageAttemptsCleanup.unref();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function randomId() {
  return crypto.randomUUID();
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function cleanText(value, maxLength, allowNewlines = false) {
  if (typeof value !== "string") {
    return "";
  }
  const controlCharacters = allowNewlines
    ? /[\u0000-\u0008\u000b-\u001f\u007f]/g
    : /[\u0000-\u001f\u007f]/g;
  return value.replace(/\r\n?/g, "\n").replace(controlCharacters, "").trim().slice(0, maxLength);
}

function cleanMessageText(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .trim();
}

function sendJson(response, status, value, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers
  });
  response.end(JSON.stringify(value));
}

function apiErrorCode(status) {
  return ({
    400: "BAD_REQUEST",
    401: "UNAUTHORIZED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    409: "CONFLICT",
    413: "PAYLOAD_TOO_LARGE",
    429: "TOO_MANY_REQUESTS"
  })[status] || "INTERNAL_SERVER_ERROR";
}

function cookieValue(request, name) {
  const cookies = request.headers.cookie || "";
  for (const cookie of cookies.split(";")) {
    const separator = cookie.indexOf("=");
    if (separator < 0) continue;
    if (cookie.slice(0, separator).trim() === name) {
      return decodeURIComponent(cookie.slice(separator + 1).trim());
    }
  }
  return "";
}

async function readJsonBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
      throw new HttpError(413, "Request body is too large.");
    }
  }
  try {
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new HttpError(400, "JSON request body must be an object.");
    }
    return parsed;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Invalid JSON request.");
  }
}

function passwordHash(password, salt = crypto.randomBytes(16).toString("hex")) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, derivedKey) => {
      if (error) return reject(error);
      resolve(`${salt}:${derivedKey.toString("hex")}`);
    });
  });
}

async function verifyPassword(password, savedHash) {
  const [salt, savedKey] = savedHash.split(":");
  if (!salt || !savedKey) return false;
  const actualHash = await passwordHash(password, salt);
  const actualKey = Buffer.from(actualHash.split(":")[1], "hex");
  const expectedKey = Buffer.from(savedKey, "hex");
  return actualKey.length === expectedKey.length && crypto.timingSafeEqual(actualKey, expectedKey);
}

function createEmptyStore() {
  return {
    version: 1,
    users: [],
    sessions: [],
    channels: [],
    messages: [],
    conversations: [],
    attachments: [],
    links: [],
    pushSubscriptions: [],
    vapidKeys: null,
    nextMessageId: 1,
    uploadUsage: []
  };
}

function getLanAddresses(networkInterfaces = os.networkInterfaces()) {
  const addresses = [];
  for (const entries of Object.values(networkInterfaces)) {
    for (const entry of entries || []) {
      if (entry.internal || (entry.family !== "IPv4" && entry.family !== 4)) continue;
      if (entry.address.startsWith("169.254.")) continue;
      addresses.push(entry.address);
    }
  }
  return [...new Set(addresses)].sort();
}

function normalizeStore(input) {
  const store = input && typeof input === "object" ? input : {};
  const base = createEmptyStore();
  for (const key of ["users", "sessions", "channels", "messages", "conversations",
    "attachments", "links", "pushSubscriptions"]) {
    base[key] = Array.isArray(store[key]) ? store[key] : base[key];
  }
  base.uploadUsage = Array.isArray(store.uploadUsage) ? store.uploadUsage : [];
  base.vapidKeys = store.vapidKeys && typeof store.vapidKeys.publicKey === "string"
    ? store.vapidKeys
    : null;
  base.channels = base.channels.filter((channel) => !LEGACY_CHANNEL_IDS.has(channel.id));
  base.messages = base.messages.filter((message) =>
    !LEGACY_CHANNEL_IDS.has(message.chatId || message.conversationId || message.room)
  );
  base.attachments = base.attachments.filter((attachment) =>
    !LEGACY_CHANNEL_IDS.has(attachment.chatId || attachment.conversationId || attachment.room)
  );
  base.links = base.links.filter((link) =>
    !LEGACY_CHANNEL_IDS.has(link.chatId || link.conversationId || link.room)
  );
  base.conversations = base.conversations.filter((conversation) =>
    !LEGACY_CHANNEL_IDS.has(conversation.id)
  );
  for (const channel of base.channels) {
    channel.type = "channel";
    channel.memberIds = Array.isArray(channel.memberIds) ? channel.memberIds : [];
    channel.adminIds = Array.isArray(channel.adminIds) ? channel.adminIds : [];
    channel.unreadCounts = channel.unreadCounts || {};
    channel.lastReadMessageIds = channel.lastReadMessageIds || {};
    channel.ownerId = channel.ownerId || channel.createdBy || null;
  }
  for (const conversation of base.conversations) {
    conversation.type ||= conversation.memberIds?.length === 2 ? "direct" : "group";
    conversation.memberIds = Array.isArray(conversation.memberIds) ? conversation.memberIds : [];
    conversation.adminIds = Array.isArray(conversation.adminIds) ? conversation.adminIds : [];
    conversation.unreadCounts = conversation.unreadCounts || {};
    conversation.lastReadMessageIds = conversation.lastReadMessageIds || {};
    conversation.ownerId = conversation.ownerId || conversation.createdBy || null;
  }
  if (base.messages.some((message) => !Number.isSafeInteger(Number(message.id)) || Number(message.id) < 1)) {
    const ordered = base.messages.map((message, index) => ({ message, index }))
      .sort((left, right) => {
        const leftTime = Date.parse(left.message.createdAt || left.message.sentAt || "") || 0;
        const rightTime = Date.parse(right.message.createdAt || right.message.sentAt || "") || 0;
        return leftTime - rightTime || left.index - right.index;
      });
    const remappedIds = new Map();
    ordered.forEach(({ message }, index) => {
      remappedIds.set(String(message.id), index + 1);
      message.id = index + 1;
    });
    for (const item of [...base.attachments, ...base.links]) {
      if (remappedIds.has(String(item.messageId))) item.messageId = remappedIds.get(String(item.messageId));
    }
  }
  let maxMessageId = 0;
  for (const message of base.messages) {
    message.id = Number(message.id);
    message.createdAt ||= message.sentAt || new Date(0).toISOString();
    message.sentAt ||= message.createdAt;
    if (message.deleted) message.text = "";
    maxMessageId = Math.max(maxMessageId, message.id);
  }
  for (const chat of [...base.channels, ...base.conversations]) {
    const chatMessages = base.messages
      .filter((message) => (message.conversationId || message.room) === chat.id)
      .sort((left, right) => left.id - right.id);
    for (const memberId of chat.memberIds) {
      if (Number.isSafeInteger(chat.lastReadMessageIds[memberId])
        && chat.lastReadMessageIds[memberId] >= 0) continue;
      const unreadTarget = Math.max(0, Number(chat.unreadCounts[memberId]) || 0);
      let unreadFound = 0;
      let lastReadMessageId = unreadTarget ? 0 : chatMessages.at(-1)?.id || 0;
      if (unreadTarget) {
        for (let index = chatMessages.length - 1; index >= 0; index -= 1) {
          if (chatMessages[index].authorId === memberId) continue;
          unreadFound += 1;
          if (unreadFound === unreadTarget) {
            lastReadMessageId = chatMessages[index - 1]?.id || 0;
            break;
          }
        }
      }
      chat.lastReadMessageIds[memberId] = lastReadMessageId;
      chat.unreadCounts[memberId] = chatMessages.filter((message) =>
        message.id > lastReadMessageId && message.authorId !== memberId
      ).length;
    }
  }
  base.nextMessageId = Number.isSafeInteger(store.nextMessageId) && store.nextMessageId > maxMessageId
    ? store.nextMessageId
    : maxMessageId + 1;
  return base;
}

async function migrateLegacyChannelData(input, dataDirectory) {
  const removedMessageIds = new Set();
  const belongsToLegacyChannel = (item) =>
    LEGACY_CHANNEL_IDS.has(item.chatId || item.conversationId || item.room);

  for (const message of input.messages || []) {
    if (belongsToLegacyChannel(message)) removedMessageIds.add(message.id);
  }
  const removedAttachmentIds = new Set(
    (input.attachments || [])
      .filter((attachment) => belongsToLegacyChannel(attachment) || removedMessageIds.has(attachment.messageId))
      .map((attachment) => attachment.id)
  );
  for (const message of input.messages || []) {
    if (!removedMessageIds.has(message.id)) continue;
    for (const attachment of message.attachments || []) {
      removedAttachmentIds.add(typeof attachment === "string" ? attachment : attachment.id);
    }
  }

  input.channels = (input.channels || []).filter((channel) => !LEGACY_CHANNEL_IDS.has(channel.id));
  input.conversations = (input.conversations || []).filter((conversation) =>
    !LEGACY_CHANNEL_IDS.has(conversation.id)
  );
  input.messages = (input.messages || []).filter((message) => !removedMessageIds.has(message.id));
  input.attachments = (input.attachments || []).filter((attachment) =>
    !removedAttachmentIds.has(attachment.id) && !belongsToLegacyChannel(attachment)
  );
  input.links = (input.links || []).filter((link) =>
    !LEGACY_CHANNEL_IDS.has(link.chatId || link.conversationId || link.room)
    && !removedMessageIds.has(link.messageId)
  );

  const uploadsRoot = path.resolve(dataDirectory, "uploads");
  for (const channelId of LEGACY_CHANNEL_IDS) {
    const uploadDirectory = path.resolve(uploadsRoot, channelId);
    if (!uploadDirectory.startsWith(`${uploadsRoot}${path.sep}`)) {
      throw new Error("Unsafe legacy upload directory.");
    }
    await fs.rm(uploadDirectory, { recursive: true, force: true });
  }

  const legacyMessageFile = path.join(dataDirectory, "messages.jsonl");
  try {
    const content = await fs.readFile(legacyMessageFile, "utf8");
    const remaining = content.split(/\r?\n/).filter((line) => {
      if (!line) return false;
      try {
        return !LEGACY_CHANNEL_IDS.has(JSON.parse(line).room);
      } catch {
        return true;
      }
    });
    await fs.writeFile(legacyMessageFile, remaining.length ? `${remaining.join("\n")}\n` : "", "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function loadStore(filePath) {
  let input;
  try {
    const content = await fs.readFile(filePath, "utf8");
    input = JSON.parse(content);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    input = createEmptyStore();
  }
  await migrateLegacyChannelData(input, path.dirname(filePath));
  return normalizeStore(input);
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    about: user.about || "",
    avatarUrl: user.avatarId
      ? `/api/avatars/${encodeURIComponent(user.id)}?v=${encodeURIComponent(user.avatarId)}`
      : null,
    showOnlineStatus: user.showOnlineStatus !== false
  };
}

function getSession(request, store) {
  const token = cookieValue(request, "polus_session");
  if (!token) return null;
  const hash = tokenHash(token);
  const session = store.sessions.find((item) => item.tokenHash === hash && item.expiresAt > Date.now());
  if (!session) return null;
  const user = store.users.find((item) => item.id === session.userId);
  return user ? { session, user } : null;
}

function requireAuth(request, store) {
  const auth = getSession(request, store);
  if (!auth) throw new HttpError(401, "Please sign in again.");
  return auth;
}

function cookieOptions(request) {
  const secure = request.socket.encrypted || process.env.POLUS_COOKIE_SECURE === "true";
  return `Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure ? "; Secure" : ""}`;
}

function makeSession(request, store, user) {
  const token = crypto.randomBytes(32).toString("base64url");
  const session = {
    id: randomId(),
    tokenHash: tokenHash(token),
    userId: user.id,
    expiresAt: Date.now() + SESSION_TTL_MS
  };
  store.sessions.push(session);
  return { session, cookie: `polus_session=${encodeURIComponent(token)}; ${cookieOptions(request)}` };
}

function findConversation(store, id, userId) {
  const channel = store.channels.find((item) => item.id === id);
  if (channel) {
    if (!channel.memberIds.includes(userId)) throw new HttpError(404, "Chat not found.");
    return { type: "channel", conversation: channel };
  }
  const conversation = store.conversations.find((item) => item.id === id && item.memberIds.includes(userId));
  if (!conversation) throw new HttpError(404, "Chat not found.");
  return {
    type: conversation.type || (conversation.memberIds.length === 2 ? "direct" : "group"),
    conversation
  };
}

function getChatRecord(store, id) {
  return store.channels.find((item) => item.id === id)
    || store.conversations.find((item) => item.id === id)
    || null;
}

function getChatRole(chat, userId) {
  if (chat.ownerId === userId || (!chat.ownerId && chat.createdBy === userId)) return "owner";
  if ((chat.adminIds || []).includes(userId)) return "admin";
  return chat.memberIds.includes(userId) ? "member" : null;
}

function requireChatRole(chat, userId, allowedRoles) {
  const role = getChatRole(chat, userId);
  if (!role) throw new HttpError(404, "Chat not found.");
  if (!allowedRoles.includes(role)) throw new HttpError(403, "You do not have permission to manage this chat.");
  return role;
}

function findDirectConversation(store, firstUserId, secondUserId) {
  const memberIds = [firstUserId, secondUserId].sort();
  return store.conversations.find((conversation) =>
    (conversation.type === "direct" || (!conversation.type && conversation.memberIds.length === 2))
    && conversation.memberIds.length === 2
    && conversation.memberIds.every((memberId, index) => memberId === memberIds[index])
  ) || null;
}

function broadcastChatMembers(chat, event, payload, broadcast) {
  for (const memberId of chat.memberIds) broadcast(memberId, event, payload);
}

function removeChatData(store, chatId) {
  const messageIds = new Set(store.messages
    .filter((message) => (message.chatId || message.conversationId || message.room) === chatId)
    .map((message) => message.id));
  const attachmentIds = new Set(store.attachments
    .filter((attachment) => attachment.chatId === chatId || messageIds.has(attachment.messageId))
    .map((attachment) => attachment.id));

  store.messages = store.messages.filter((message) => !messageIds.has(message.id));
  store.attachments = store.attachments.filter((attachment) =>
    !attachmentIds.has(attachment.id) && attachment.chatId !== chatId
  );
  store.links = store.links.filter((link) =>
    link.chatId !== chatId && !messageIds.has(link.messageId)
  );
  store.channels = store.channels.filter((chat) => chat.id !== chatId);
  store.conversations = store.conversations.filter((chat) => chat.id !== chatId);
  return { messageIds, attachmentIds };
}

function canReadMessage(store, message, userId) {
  const conversationId = message.conversationId || message.room;
  try {
    return Boolean(findConversation(store, conversationId, userId));
  } catch {
    return false;
  }
}

function visibleMessage(message, store) {
  const author = store.users.find((user) => user.id === message.authorId);
  return {
    id: message.id,
    conversationId: message.conversationId || message.room,
    chatId: message.conversationId || message.room,
    authorId: message.authorId,
    author: author ? publicUser(author) : message.author || { id: "legacy", username: "system", fullName: "Слово" },
    text: message.deleted ? "" : message.text,
    sentAt: message.createdAt || message.sentAt,
    createdAt: message.createdAt || message.sentAt,
    editedAt: message.editedAt || null,
    deleted: Boolean(message.deleted),
    attachments: message.deleted ? [] : (message.attachmentIds || [])
      .map((id) => store.attachments.find((attachment) => attachment.id === id))
      .filter(Boolean)
      .map(publicAttachment)
  };
}

function publicAttachment(attachment) {
  return {
    id: attachment.id,
    messageId: attachment.messageId || null,
    name: attachment.name,
    mimeType: attachment.mimeType,
    size: attachment.size,
    authorId: attachment.authorId,
    chatId: attachment.chatId,
    createdAt: attachment.createdAt,
    thumbnailUrl: attachment.thumbnailId
      ? `/api/attachments/${encodeURIComponent(attachment.id)}?thumbnail=1`
      : null
  };
}

function safeFileName(value) {
  const basename = path.basename(String(value || "").replace(/\\/g, "/"));
  const safe = basename
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 180);
  return safe && safe !== "." ? safe : "file";
}

function sniffMimeType(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.toString("ascii", 0, 6))) return "image/gif";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buffer.length >= 5 && buffer.toString("ascii", 0, 5) === "%PDF-") return "application/pdf";
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b
    && [0x03, 0x05, 0x07].includes(buffer[2])) return "application/zip";
  if (buffer.length >= 12 && buffer.toString("ascii", 4, 8) === "ftyp") return "video/mp4";
  if (buffer.length >= 4 && buffer.toString("ascii", 0, 4) === "OggS") return "audio/ogg";
  if (buffer.length >= 4 && buffer.toString("ascii", 0, 4) === "RIFF"
    && buffer.toString("ascii", 8, 12) === "WAVE") return "audio/wav";
  if (buffer.length >= 4 && buffer[0] === 0x1a && buffer[1] === 0x45
    && buffer[2] === 0xdf && buffer[3] === 0xa3) return "video/webm";
  if (buffer.length >= 3 && buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) return "audio/mpeg";
  return "application/octet-stream";
}

function extractLinks(text) {
  const found = new Map();
  for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/giu)) {
    const raw = match[0].replace(/[),.!?;:]+$/g, "");
    try {
      const url = new URL(raw);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      found.set(url.href, { url: url.href, domain: url.hostname });
    } catch {
      continue;
    }
  }
  return [...found.values()];
}

function latestMessageId(store, chatId) {
  let latest = 0;
  for (const message of store.messages) {
    if ((message.conversationId || message.room) === chatId) latest = Math.max(latest, Number(message.id) || 0);
  }
  return latest;
}

function countUnreadMessages(store, conversation, userId) {
  const lastReadId = conversation.lastReadMessageIds?.[userId] || 0;
  return store.messages.reduce((total, message) =>
    total + ((message.conversationId || message.room) === conversation.id
      && message.id > lastReadId && message.authorId !== userId ? 1 : 0), 0);
}

function conversationSummary(store, conversation, userId) {
  const lastMessage = store.messages.findLast((message) =>
    (message.conversationId || message.room) === conversation.id
  );
  const otherUserId = conversation.memberIds?.find((id) => id !== userId);
  const otherUser = store.users.find((user) => user.id === otherUserId);
  const type = conversation.type || (store.channels.includes(conversation)
    ? "channel"
    : conversation.memberIds?.length === 2 ? "direct" : "group");
  return {
    id: conversation.id,
    type,
    name: type === "direct"
      ? otherUser?.fullName || `@${otherUser?.username || ""}`
      : conversation.name,
    username: type === "direct" ? otherUser?.username || null : null,
    avatarUrl: type === "direct" && otherUser ? publicUser(otherUser).avatarUrl : null,
    description: conversation.description || "",
    memberIds: conversation.memberIds || [],
    joined: conversation.memberIds?.includes(userId) || false,
    unreadCount: countUnreadMessages(store, conversation, userId),
    lastReadMessageId: conversation.lastReadMessageIds?.[userId] || 0,
    lastMessage: lastMessage ? visibleMessage(lastMessage, store) : null,
    createdBy: conversation.createdBy,
    ownerId: conversation.ownerId || conversation.createdBy || null,
    adminIds: conversation.adminIds || [],
    muted: (conversation.mutedUserIds || []).includes(userId),
    role: getChatRole(conversation, userId)
  };
}

function createMessengerServer({
  store = createEmptyStore(),
  saveStore = async () => {},
  dataDirectory = path.join(__dirname, "data"),
  pushSender = sendPushToUser
} = {}) {
  const connectedUsers = new Map();
  const viewingClients = new Map();
  let currentStore = normalizeStore(store);

  function isUserViewingChat(userId, chatId) {
    const clients = viewingClients.get(userId);
    if (!clients) return false;
    const now = Date.now();
    for (const [clientId, state] of clients) {
      if (now - state.updatedAt > 45_000) {
        clients.delete(clientId);
        continue;
      }
      if (state.visible && state.chatId === chatId) return true;
    }
    if (!clients.size) viewingClients.delete(userId);
    return false;
  }

  const presenceCleanupTimer = setInterval(() => {
    const cutoff = Date.now() - 45_000;
    for (const [userId, clients] of viewingClients) {
      for (const [clientId, state] of clients) {
        if (state.updatedAt < cutoff) clients.delete(clientId);
      }
      if (!clients.size) viewingClients.delete(userId);
    }
  }, 30_000);
  presenceCleanupTimer.unref();

  function persist() {
    return saveStore(currentStore);
  }

  function broadcast(userId, event, payload) {
    const clients = connectedUsers.get(userId);
    if (!clients) return;
    const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const response of clients) response.write(data);
  }

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      const ip = request.socket.remoteAddress || "unknown";

      if (request.method === "GET" && url.pathname === "/") {
        // Если форму когда-то отправили обычным GET-запросом, убираем личные данные из адреса.
        const stripped = SENSITIVE_QUERY_PARAMS.some((name) => url.searchParams.has(name));
        if (stripped) {
          for (const name of [...SENSITIVE_QUERY_PARAMS, ...FORM_QUERY_PARAMS]) url.searchParams.delete(name);
          response.writeHead(303, {
            Location: `/${url.search}`,
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer"
          });
          response.end();
          return;
        }
      }

      if (request.method === "POST" && url.pathname === FORMS_DISABLED_PATH) {
        // Сюда попадает только форма, отправленная браузером без JavaScript.
        // Тело запроса (в нём могут быть пароли) не читаем и не сохраняем.
        request.resume();
        throw new HttpError(400, "JavaScript is required. Reload the page and try again.");
      }

      if (request.method === "GET" && PUBLIC_FILES.has(url.pathname)) {
        const [fileName, contentType] = PUBLIC_FILES.get(url.pathname);
        const contents = await fs.readFile(path.join(__dirname, "public", fileName));
        response.writeHead(200, {
          "Content-Type": contentType,
          "Cache-Control": contentType.startsWith("text/html") ? "no-store" : "no-cache",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
        });
        response.end(contents);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/auth/me") {
        const auth = getSession(request, currentStore);
        sendJson(response, 200, { user: auth ? publicUser(auth.user) : null });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/config") {
        sendJson(response, 200, { privacyVersion: PRIVACY_VERSION });
        return;
      }

      if (request.method === "POST" && ["/api/auth/register", "/api/auth/login"].includes(url.pathname)) {
        const input = await readJsonBody(request);
        const username = cleanText(input.username, 128).replace(/^@/, "").toLowerCase();
        const password = typeof input.password === "string" ? input.password : "";

        if (url.pathname === "/api/auth/register") {
          const fullName = cleanText(input.fullName, 256);
          const about = cleanText(input.about, 1000);
          if (!USERNAME_PATTERN.test(username)) {
            throw new HttpError(400, "Username must be 3–32 letters, numbers, or underscores.");
          }
          if (Array.from(fullName).length < 1 || Array.from(fullName).length > 50) {
            throw new HttpError(400, "Display name must be 1–50 characters.");
          }
          if (Array.from(about).length > 200) {
            throw new HttpError(400, "About must be at most 200 characters.");
          }
          const passwordLength = Array.from(password).length;
          if (passwordLength < 8 || passwordLength > 128) {
            throw new HttpError(400, "Password must be 8–128 characters.");
          }
          if (input.confirmPassword !== password) throw new HttpError(400, "Passwords do not match.");
          if (input.acceptPrivacy !== true || input.privacyVersion !== PRIVACY_VERSION) {
            throw new HttpError(400, "Please read and accept the privacy policy.");
          }
          if (currentStore.users.some((user) => user.username === username)) {
            throw new HttpError(409, "That username is already taken.");
          }
          const user = {
            id: randomId(),
            username,
            fullName,
            about,
            passwordHash: await passwordHash(password),
            privacyAcceptedAt: new Date().toISOString(),
            privacyVersion: PRIVACY_VERSION,
            createdAt: new Date().toISOString()
          };
          currentStore.users.push(user);
          const { cookie } = makeSession(request, currentStore, user);
          await persist();
          sendJson(response, 201, { user: publicUser(user) }, { "Set-Cookie": cookie });
          return;
        }

        const attemptKey = `${ip}\u0000${username}`;
        const now = Date.now();
        const recentAttempts = (loginAttempts.get(attemptKey) || [])
          .filter((time) => now - time < LOGIN_WINDOW_MS);
        if (recentAttempts.length >= MAX_LOGIN_FAILURES) {
          loginAttempts.set(attemptKey, recentAttempts);
          throw new HttpError(429, "Too many failed sign-in attempts. Try again in 15 minutes.");
        }
        const user = currentStore.users.find((item) => item.username === username);
        const valid = user && Array.from(password).length > 0 && Array.from(password).length <= 128
          ? await verifyPassword(password, user.passwordHash)
          : (await passwordHash("invalid-login-attempt", "polus-dummy-salt"), false);
        if (!valid) {
          loginAttempts.set(attemptKey, [...recentAttempts, now]);
          throw new HttpError(401, "Incorrect username or password.");
        }
        loginAttempts.delete(attemptKey);
        const { cookie } = makeSession(request, currentStore, user);
        await persist();
        sendJson(response, 200, { user: publicUser(user) }, { "Set-Cookie": cookie });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/auth/logout") {
        const auth = requireAuth(request, currentStore);
        const body = Number(request.headers["content-length"] || 0) > 0
          ? await readJsonBody(request)
          : {};
        const pushEndpoint = typeof body.pushEndpoint === "string" ? body.pushEndpoint : "";
        if (pushEndpoint) {
          currentStore.pushSubscriptions = currentStore.pushSubscriptions.filter(
            (item) => !(item.userId === auth.user.id && item.subscription.endpoint === pushEndpoint)
          );
        }
        currentStore.sessions = currentStore.sessions.filter((item) => item.id !== auth.session.id);
        await persist();
        sendJson(response, 200, { ok: true }, {
          "Set-Cookie": "polus_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"
        });
        return;
      }

      const auth = requireAuth(request, currentStore);
      const user = auth.user;

      if (request.method === "POST" && url.pathname === "/api/presence/chat") {
        const input = await readJsonBody(request);
        if (typeof input.clientId !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(input.clientId)
          || typeof input.visible !== "boolean"
          || (input.conversationId !== null && typeof input.conversationId !== "string")) {
          throw new HttpError(400, "Invalid chat presence state.");
        }
        let chatId = null;
        if (input.visible && input.conversationId) {
          const { conversation } = findConversation(currentStore, input.conversationId, user.id);
          chatId = conversation.id;
        }
        if (!viewingClients.has(user.id)) viewingClients.set(user.id, new Map());
        viewingClients.get(user.id).set(input.clientId, {
          chatId,
          visible: input.visible && Boolean(chatId),
          updatedAt: Date.now()
        });
        sendJson(response, 200, { ok: true });
        return;
      }

      const uploadRoute = /^\/api\/chats\/([^/]+)\/attachments$/.exec(url.pathname);
      if (request.method === "POST" && uploadRoute) {
        const chatId = decodeURIComponent(uploadRoute[1]);
        const { type, conversation } = findConversation(currentStore, chatId, user.id);
        if (type === "channel" && !["owner", "admin"].includes(getChatRole(conversation, user.id))) {
          throw new HttpError(403, "Only channel owners and administrators can upload to this channel.");
        }
        const declaredSize = Number(request.headers["content-length"] || 0);
        if (declaredSize > MAX_ATTACHMENT_BYTES) throw new HttpError(413, "Files cannot exceed 100 MB.");
        const name = safeFileName(decodeURIComponent(String(request.headers["x-file-name"] || "file")));
        const attachmentId = randomId();
        const uploadsRoot = path.resolve(dataDirectory, "uploads");
        const chatDirectory = path.resolve(uploadsRoot, chatId);
        const filePath = path.resolve(chatDirectory, attachmentId);
        if (!chatDirectory.startsWith(`${uploadsRoot}${path.sep}`)
          || !filePath.startsWith(`${chatDirectory}${path.sep}`)) {
          throw new Error("Unsafe attachment path.");
        }
        const utcStart = new Date();
        utcStart.setUTCHours(0, 0, 0, 0);
        const bytesUploadedToday = currentStore.uploadUsage
          .filter((usage) => usage.userId === user.id && Date.parse(usage.createdAt) >= utcStart.getTime())
          .reduce((total, usage) => total + usage.size, 0);
        if (bytesUploadedToday >= DAILY_UPLOAD_LIMIT) {
          throw new HttpError(429, "Daily upload limit reached.");
        }
        await fs.mkdir(chatDirectory, { recursive: true });
        const file = await fs.open(filePath, "wx");
        let size = 0;
        let tooLarge = false;
        const signature = [];
        try {
          for await (const chunkValue of request) {
            const chunk = Buffer.from(chunkValue);
            size += chunk.length;
            if (size > MAX_ATTACHMENT_BYTES) {
              tooLarge = true;
              continue;
            }
            if (tooLarge) continue;
            const signatureLength = signature.reduce((total, part) => total + part.length, 0);
            if (signatureLength < 32) signature.push(chunk.subarray(0, 32 - signatureLength));
            await file.writeFile(chunk);
          }
          if (tooLarge) throw new HttpError(413, "Files cannot exceed 100 MB.");
          if (declaredSize && size !== declaredSize) throw new HttpError(400, "Upload size did not match Content-Length.");
          if (bytesUploadedToday + size > DAILY_UPLOAD_LIMIT) throw new HttpError(429, "Daily upload limit reached.");
        } catch (error) {
          await file.close();
          await fs.rm(filePath, { force: true });
          throw error;
        }
        await file.close();
        const sniffBuffer = Buffer.concat(signature).subarray(0, 32);
        const attachment = {
          id: attachmentId,
          name,
          mimeType: sniffMimeType(sniffBuffer),
          size,
          authorId: user.id,
          chatId,
          createdAt: new Date().toISOString(),
          messageId: null
        };
        currentStore.attachments.push(attachment);
        currentStore.uploadUsage.push({
          userId: user.id,
          size,
          createdAt: attachment.createdAt
        });
        try {
          await persist();
        } catch (error) {
          currentStore.attachments = currentStore.attachments.filter((item) => item.id !== attachmentId);
          await fs.rm(filePath, { force: true });
          throw error;
        }
        sendJson(response, 201, publicAttachment(attachment));
        return;
      }

      const thumbnailRoute = /^\/api\/chats\/([^/]+)\/attachments\/([^/]+)\/thumbnail$/.exec(url.pathname);
      if (request.method === "POST" && thumbnailRoute) {
        const chatId = decodeURIComponent(thumbnailRoute[1]);
        const attachmentId = decodeURIComponent(thumbnailRoute[2]);
        const { type, conversation } = findConversation(currentStore, chatId, user.id);
        if (type === "channel" && !["owner", "admin"].includes(getChatRole(conversation, user.id))) {
          throw new HttpError(403, "Only channel owners and administrators can upload to this channel.");
        }
        const attachment = currentStore.attachments.find((item) =>
          item.id === attachmentId && item.chatId === chatId
          && item.authorId === user.id && !item.messageId
        );
        if (!attachment || !/^image\//.test(attachment.mimeType)) {
          throw new HttpError(404, "Image attachment not found.");
        }
        if (attachment.thumbnailId) throw new HttpError(409, "A thumbnail already exists.");
        const declaredSize = Number(request.headers["content-length"] || 0);
        if (declaredSize > MAX_THUMBNAIL_BYTES) throw new HttpError(413, "Image previews cannot exceed 2 MB.");
        const uploadsRoot = path.resolve(dataDirectory, "uploads");
        const chatDirectory = path.resolve(uploadsRoot, chatId);
        const thumbnailId = randomId();
        const filePath = path.resolve(chatDirectory, thumbnailId);
        if (!chatDirectory.startsWith(`${uploadsRoot}${path.sep}`)
          || !filePath.startsWith(`${chatDirectory}${path.sep}`)) {
          throw new Error("Unsafe thumbnail path.");
        }
        const utcStart = new Date();
        utcStart.setUTCHours(0, 0, 0, 0);
        const bytesUploadedToday = currentStore.uploadUsage
          .filter((usage) => usage.userId === user.id && Date.parse(usage.createdAt) >= utcStart.getTime())
          .reduce((total, usage) => total + usage.size, 0);
        const file = await fs.open(filePath, "wx");
        let size = 0;
        let tooLarge = false;
        const signature = [];
        let usageRecord;
        try {
          for await (const chunkValue of request) {
            const chunk = Buffer.from(chunkValue);
            size += chunk.length;
            if (size > MAX_THUMBNAIL_BYTES) {
              tooLarge = true;
              continue;
            }
            if (tooLarge) continue;
            const signatureLength = signature.reduce((total, part) => total + part.length, 0);
            if (signatureLength < 32) signature.push(chunk.subarray(0, 32 - signatureLength));
            await file.writeFile(chunk);
          }
          if (tooLarge) throw new HttpError(413, "Image previews cannot exceed 2 MB.");
          if (declaredSize && size !== declaredSize) throw new HttpError(400, "Upload size did not match Content-Length.");
          if (bytesUploadedToday + size > DAILY_UPLOAD_LIMIT) throw new HttpError(429, "Daily upload limit reached.");
          const mimeType = sniffMimeType(Buffer.concat(signature).subarray(0, 32));
          if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
            throw new HttpError(400, "Image preview must be JPEG, PNG or WebP.");
          }
          attachment.thumbnailId = thumbnailId;
          attachment.thumbnailMimeType = mimeType;
          attachment.thumbnailSize = size;
          usageRecord = {
            userId: user.id,
            size,
            createdAt: new Date().toISOString()
          };
          currentStore.uploadUsage.push(usageRecord);
          await persist();
        } catch (error) {
          attachment.thumbnailId = null;
          attachment.thumbnailMimeType = null;
          attachment.thumbnailSize = null;
          if (usageRecord) currentStore.uploadUsage = currentStore.uploadUsage.filter((item) => item !== usageRecord);
          await file.close();
          await fs.rm(filePath, { force: true });
          throw error;
        }
        await file.close();
        sendJson(response, 201, { thumbnailUrl: publicAttachment(attachment).thumbnailUrl });
        return;
      }

      const attachmentRoute = /^\/api\/attachments\/([^/]+)$/.exec(url.pathname);
      if (request.method === "DELETE" && attachmentRoute) {
        const attachment = currentStore.attachments.find((item) => item.id === decodeURIComponent(attachmentRoute[1]));
        if (!attachment || attachment.authorId !== user.id || attachment.messageId) {
          throw new HttpError(404, "File not found.");
        }
        currentStore.attachments = currentStore.attachments.filter((item) => item.id !== attachment.id);
        const uploadsRoot = path.resolve(dataDirectory, "uploads");
        const filePath = path.resolve(uploadsRoot, attachment.chatId, attachment.id);
        if (!filePath.startsWith(`${uploadsRoot}${path.sep}`)) throw new Error("Unsafe attachment path.");
        await fs.rm(filePath, { force: true });
        if (attachment.thumbnailId) {
          await fs.rm(path.resolve(uploadsRoot, attachment.chatId, attachment.thumbnailId), { force: true });
        }
        await persist();
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === "GET" && attachmentRoute) {
        const attachment = currentStore.attachments.find((item) => item.id === decodeURIComponent(attachmentRoute[1]));
        const attachmentChat = attachment ? getChatRecord(currentStore, attachment.chatId) : null;
        const publicMedia = attachmentChat && currentStore.channels.includes(attachmentChat)
          && /^(image|video)\//.test(attachment?.mimeType || "");
        if (!attachment || !attachmentChat || (!getChatRole(attachmentChat, user.id) && !publicMedia)) {
          throw new HttpError(404, "File not found.");
        }
        const uploadsRoot = path.resolve(dataDirectory, "uploads");
        const isThumbnail = url.searchParams.get("thumbnail") === "1";
        const storedId = isThumbnail ? attachment.thumbnailId : attachment.id;
        const mimeType = isThumbnail ? attachment.thumbnailMimeType : attachment.mimeType;
        if (!storedId || !mimeType) throw new HttpError(404, "File not found.");
        const filePath = path.resolve(uploadsRoot, attachment.chatId, storedId);
        if (!filePath.startsWith(`${uploadsRoot}${path.sep}`)) throw new Error("Unsafe attachment path.");
        let fileHandle;
        try {
          fileHandle = await fs.open(filePath, "r");
        } catch (error) {
          if (error.code === "ENOENT") throw new HttpError(404, "File not found.");
          throw error;
        }
        const fileStats = await fileHandle.stat();
        const safeInline = isThumbnail
          || /^(image\/(jpeg|png|gif|webp)|audio\/(mpeg|ogg|wav)|video\/(mp4|webm))$/.test(attachment.mimeType);
        const disposition = url.searchParams.get("download") === "1" || !safeInline ? "attachment" : "inline";
        const encodedName = encodeURIComponent(attachment.name).replace(/['()*]/g, (character) =>
          `%${character.charCodeAt(0).toString(16).toUpperCase()}`
        );
        response.writeHead(200, {
          "Content-Type": safeInline ? mimeType : "application/octet-stream",
          "Content-Length": fileStats.size,
          "Content-Disposition": `${disposition}; filename*=UTF-8''${encodedName}`,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, no-store"
        });
        const fileStream = fileHandle.createReadStream();
        fileStream.on("close", () => { void fileHandle.close().catch((error) => console.error("Attachment close failed:", error)); });
        fileStream.pipe(response);
        return;
      }

      const avatarRoute = /^\/api\/avatars\/([^/]+)$/.exec(url.pathname);
      if (request.method === "GET" && avatarRoute) {
        const target = currentStore.users.find((candidate) => candidate.id === decodeURIComponent(avatarRoute[1]));
        if (!target?.avatarId || !target.avatarMimeType?.startsWith("image/")) {
          throw new HttpError(404, "Avatar not found.");
        }
        const filePath = path.resolve(dataDirectory, "uploads", "profiles", target.id, target.avatarId);
        const profilesRoot = path.resolve(dataDirectory, "uploads", "profiles");
        if (!filePath.startsWith(`${profilesRoot}${path.sep}`)) throw new Error("Unsafe avatar path.");
        let fileHandle;
        try {
          fileHandle = await fs.open(filePath, "r");
        } catch (error) {
          if (error.code === "ENOENT") throw new HttpError(404, "Avatar not found.");
          throw error;
        }
        const fileStats = await fileHandle.stat();
        response.writeHead(200, {
          "Content-Type": target.avatarMimeType,
          "Content-Length": fileStats.size,
          "Content-Disposition": "inline",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, max-age=86400"
        });
        const avatarStream = fileHandle.createReadStream();
        avatarStream.on("close", () => { void fileHandle.close().catch((error) => console.error("Avatar close failed:", error)); });
        avatarStream.pipe(response);
        return;
      }

      const profileRoute = /^\/api\/users\/([^/]+)\/profile$/.exec(url.pathname);
      if (request.method === "GET" && profileRoute) {
        const username = decodeURIComponent(profileRoute[1]).replace(/^@/, "").toLowerCase();
        const target = currentStore.users.find((candidate) => candidate.username === username);
        if (!target) throw new HttpError(404, "User not found.");
        const blocked = (user.blockedUserIds || []).includes(target.id);
        const sharedChats = [...currentStore.channels, ...currentStore.conversations]
          .filter((chat) => ["group", "channel"].includes(chat.type)
            && chat.memberIds.includes(user.id) && chat.memberIds.includes(target.id))
          .map((chat) => ({ id: chat.id, type: chat.type, name: chat.name }));
        const mutualChatIds = new Set([...currentStore.channels, ...currentStore.conversations]
          .filter((chat) => chat.memberIds.includes(user.id) && chat.memberIds.includes(target.id))
          .map((chat) => chat.id));
        const sharedMedia = currentStore.attachments
          .filter((attachment) => mutualChatIds.has(attachment.chatId)
            && /^(image|video)\//.test(attachment.mimeType)
            && attachment.messageId
            && currentStore.messages.some((message) => message.id === attachment.messageId && !message.deleted))
          .sort((left, right) => right.messageId - left.messageId)
          .slice(0, 50)
          .map(publicAttachment);
        sendJson(response, 200, {
          user: {
            ...publicUser(target),
            createdAt: target.createdAt,
            blocked,
            online: target.showOnlineStatus !== false
              && !(target.blockedUserIds || []).includes(user.id)
              && Boolean(connectedUsers.get(target.id)?.size),
            lastSeenAt: target.showOnlineStatus === false || (target.blockedUserIds || []).includes(user.id)
              ? null
              : target.lastSeenAt || null
          },
          sharedChats,
          sharedMedia,
          canMessage: target.id !== user.id && !blocked && !(target.blockedUserIds || []).includes(user.id)
        });
        return;
      }

      const blockRoute = /^\/api\/users\/([^/]+)\/block$/.exec(url.pathname);
      if (blockRoute && ["POST", "DELETE"].includes(request.method)) {
        const username = decodeURIComponent(blockRoute[1]).replace(/^@/, "").toLowerCase();
        const target = currentStore.users.find((candidate) => candidate.username === username);
        if (!target) throw new HttpError(404, "User not found.");
        if (target.id === user.id) throw new HttpError(400, "You cannot block yourself.");
        user.blockedUserIds = user.blockedUserIds || [];
        if (request.method === "POST" && !user.blockedUserIds.includes(target.id)) {
          user.blockedUserIds.push(target.id);
        } else if (request.method === "DELETE") {
          user.blockedUserIds = user.blockedUserIds.filter((id) => id !== target.id);
        }
        await persist();
        sendJson(response, 200, { blocked: user.blockedUserIds.includes(target.id) });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/account/avatar") {
        const declaredSize = Number(request.headers["content-length"] || 0);
        const maxAvatarBytes = 5 * 1024 * 1024;
        if (declaredSize > maxAvatarBytes) throw new HttpError(413, "Avatars cannot exceed 5 MB.");
        const avatarId = randomId();
        const profilesRoot = path.resolve(dataDirectory, "uploads", "profiles");
        const userDirectory = path.resolve(profilesRoot, user.id);
        const filePath = path.resolve(userDirectory, avatarId);
        if (!userDirectory.startsWith(`${profilesRoot}${path.sep}`)
          || !filePath.startsWith(`${userDirectory}${path.sep}`)) throw new Error("Unsafe avatar path.");
        await fs.mkdir(userDirectory, { recursive: true });
        const file = await fs.open(filePath, "wx");
        let size = 0;
        let tooLarge = false;
        const signature = [];
        const previousAvatar = {
          id: user.avatarId,
          mimeType: user.avatarMimeType,
          size: user.avatarSize
        };
        try {
          for await (const chunkValue of request) {
            const chunk = Buffer.from(chunkValue);
            size += chunk.length;
            if (size > maxAvatarBytes) {
              tooLarge = true;
              continue;
            }
            if (tooLarge) continue;
            const signatureLength = signature.reduce((total, part) => total + part.length, 0);
            if (signatureLength < 32) signature.push(chunk.subarray(0, 32 - signatureLength));
            await file.writeFile(chunk);
          }
          if (tooLarge) throw new HttpError(413, "Avatars cannot exceed 5 MB.");
          const mimeType = sniffMimeType(Buffer.concat(signature).subarray(0, 32));
          if (!mimeType.startsWith("image/")) throw new HttpError(400, "Avatar must be a supported image.");
          if (declaredSize && size !== declaredSize) throw new HttpError(400, "Upload size did not match Content-Length.");
          user.avatarId = avatarId;
          user.avatarMimeType = mimeType;
          user.avatarSize = size;
          await persist();
        } catch (error) {
          user.avatarId = previousAvatar.id;
          user.avatarMimeType = previousAvatar.mimeType;
          user.avatarSize = previousAvatar.size;
          await file.close();
          await fs.rm(filePath, { force: true });
          throw error;
        }
        await file.close();
        if (previousAvatar.id) {
          await fs.rm(path.resolve(userDirectory, previousAvatar.id), { force: true });
        }
        sendJson(response, 201, { avatarUrl: `/api/avatars/${encodeURIComponent(user.id)}` });
        return;
      }

      const muteRoute = /^\/api\/chats\/([^/]+)\/mute$/.exec(url.pathname);
      if (muteRoute && ["POST", "DELETE"].includes(request.method)) {
        const chatId = decodeURIComponent(muteRoute[1]);
        const chat = getChatRecord(currentStore, chatId);
        if (!chat || !getChatRole(chat, user.id)) throw new HttpError(404, "Chat not found.");
        chat.mutedUserIds = Array.isArray(chat.mutedUserIds) ? chat.mutedUserIds : [];
        if (request.method === "POST" && !chat.mutedUserIds.includes(user.id)) chat.mutedUserIds.push(user.id);
        if (request.method === "DELETE") chat.mutedUserIds = chat.mutedUserIds.filter((id) => id !== user.id);
        await persist();
        sendJson(response, 200, { muted: chat.mutedUserIds.includes(user.id) });
        return;
      }

      if (request.method === "GET" && /^\/api\/chats\/[^/]+\/materials$/.test(url.pathname)) {
        const chatId = decodeURIComponent(url.pathname.split("/")[3]);
        const chat = getChatRecord(currentStore, chatId);
        const role = chat ? getChatRole(chat, user.id) : null;
        const isPublicChannel = Boolean(chat && currentStore.channels.includes(chat));
        const kind = url.searchParams.get("kind") || "";
        if (!chat || (!role && !(isPublicChannel && ["media", "links"].includes(kind)))) {
          throw new HttpError(404, "Chat not found.");
        }
        if (!["members", "media", "files", "links"].includes(kind)
          || (!role && !["media", "links"].includes(kind))) {
          throw new HttpError(404, "Chat material not found.");
        }
        const allItems = kind === "members"
          ? chat.memberIds.map((memberId) => {
            const member = currentStore.users.find((candidate) => candidate.id === memberId);
            return member ? {
              ...publicUser(member),
              role: getChatRole(chat, memberId),
              online: member.showOnlineStatus !== false && Boolean(connectedUsers.get(memberId)?.size),
              lastSeenAt: member.showOnlineStatus === false ? null : member.lastSeenAt || null
            } : null;
          }).filter(Boolean)
          : kind === "links"
            ? currentStore.links.filter((link) => link.chatId === chatId
              && currentStore.messages.some((message) => message.id === link.messageId && !message.deleted))
              .sort((left, right) => right.messageId - left.messageId || right.id.localeCompare(left.id))
              .map((link) => ({
                ...link,
                author: publicUser(currentStore.users.find((candidate) => candidate.id === link.authorId)),
                createdAt: currentStore.messages.find((message) => message.id === link.messageId)?.createdAt
              }))
            : currentStore.attachments.filter((attachment) => attachment.chatId === chatId
              && attachment.messageId
              && currentStore.messages.some((message) => message.id === attachment.messageId && !message.deleted)
              && (kind === "media"
                ? /^(image|video)\//.test(attachment.mimeType)
                : !/^(image|video)\//.test(attachment.mimeType)))
            .sort((left, right) => right.messageId - left.messageId || right.id.localeCompare(left.id))
              .map((attachment) => ({
                ...publicAttachment(attachment),
                author: publicUser(currentStore.users.find((candidate) => candidate.id === attachment.authorId))
              }));
        const cursorValue = url.searchParams.get("before");
        let cursor = kind === "members" ? 0 : null;
        if (cursorValue !== null) {
        if (!/^\d+$/.test(cursorValue) && kind === "members") {
          throw new HttpError(400, "Invalid material cursor.");
        }
        if (kind === "members") {
          cursor = Number(cursorValue);
          if (!Number.isSafeInteger(cursor)) throw new HttpError(400, "Invalid material cursor.");
        } else {
          try {
            const parsedCursor = JSON.parse(Buffer.from(cursorValue, "base64url").toString("utf8"));
            if (!Array.isArray(parsedCursor) || parsedCursor.length !== 2
              || !Number.isSafeInteger(parsedCursor[0]) || parsedCursor[0] < 1
              || typeof parsedCursor[1] !== "string") {
              throw new Error("Invalid cursor shape.");
            }
            cursor = { messageId: parsedCursor[0], id: parsedCursor[1] };
          } catch {
            throw new HttpError(400, "Invalid material cursor.");
          }
        }
        }
        const cursorItems = kind === "members"
        ? allItems.slice(cursor)
        : cursor === null
          ? allItems
          : allItems.filter((item) => item.messageId < cursor.messageId
            || (item.messageId === cursor.messageId && item.id.localeCompare(cursor.id) < 0));
        const items = cursorItems.slice(0, 50);
        const hasMore = cursorItems.length > items.length;
        const lastItem = items.at(-1);
        sendJson(response, 200, {
        items,
        total: allItems.length,
        nextCursor: hasMore
          ? kind === "members"
            ? cursor + items.length
            : Buffer.from(JSON.stringify([lastItem.messageId, lastItem.id])).toString("base64url")
          : null,
        hasMore
        });
        return;
      }

      const searchRoute = /^\/api\/chats\/([^/]+)\/search$/.exec(url.pathname);
      if (request.method === "GET" && searchRoute) {
        const chatId = decodeURIComponent(searchRoute[1]);
        const { conversation } = findConversation(currentStore, chatId, user.id);
        const query = cleanText(url.searchParams.get("q") || "", 200).toLocaleLowerCase();
        if (!query) {
          sendJson(response, 200, { results: [] });
          return;
        }
        const results = [];
        for (const message of currentStore.messages) {
          if ((message.conversationId || message.room) !== chatId || message.deleted) continue;
          const attachmentNames = (message.attachmentIds || [])
            .map((id) => currentStore.attachments.find((item) => item.id === id)?.name || "")
            .join(" ");
          const linkedText = currentStore.links
            .filter((link) => link.messageId === message.id)
            .map((link) => `${link.url} ${link.domain}`)
            .join(" ");
          if (`${message.text} ${attachmentNames} ${linkedText}`.toLocaleLowerCase().includes(query)) {
            results.push(visibleMessage(message, currentStore));
          }
        }
        results.sort((left, right) => right.id - left.id);
        sendJson(response, 200, {
          results: results.slice(0, 50),
          total: results.length,
          chatId: conversation.id
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/bootstrap") {
        const channels = currentStore.channels.map((channel) => conversationSummary(currentStore, channel, user.id));
        const directs = currentStore.conversations
          .filter((conversation) => conversation.memberIds.includes(user.id))
          .map((conversation) => conversationSummary(currentStore, conversation, user.id));
        sendJson(response, 200, {
          user: { ...publicUser(user), hideNotificationContent: user.hideNotificationContent === true },
          channels,
          directs,
          privacyVersion: PRIVACY_VERSION,
          vapidPublicKey: currentStore.vapidKeys?.publicKey || null
        });
        return;
      }

      const chatRoute = /^\/api\/chats\/([^/]+)(?:\/(members|admins|owner|leave))?(?:\/([^/]+))?$/.exec(url.pathname);
      if (chatRoute) {
        const chatId = decodeURIComponent(chatRoute[1]);
        const section = chatRoute[2] || "";
        const targetId = chatRoute[3] ? decodeURIComponent(chatRoute[3]) : "";
        const chat = getChatRecord(currentStore, chatId);
        const role = chat ? getChatRole(chat, user.id) : null;
        if (!chat || !role) throw new HttpError(404, "Chat not found.");
        const chatType = currentStore.channels.includes(chat) ? "channel" : chat.type || "group";
        if (chatType === "direct") throw new HttpError(400, "Direct chats cannot be managed.");

        if (request.method === "GET" && !section) {
          sendJson(response, 200, {
            chat: conversationSummary(currentStore, chat, user.id),
            members: chat.memberIds.map((memberId) => {
              const member = currentStore.users.find((candidate) => candidate.id === memberId);
              return member ? { ...publicUser(member), role: getChatRole(chat, memberId) } : null;
            }).filter(Boolean)
          });
          return;
        }

        if (request.method === "POST" && section === "members" && !targetId) {
          requireChatRole(chat, user.id, ["owner", "admin"]);
          const input = await readJsonBody(request);
          const username = cleanText(input.username, 32).replace(/^@/, "").toLowerCase();
          const invitee = currentStore.users.find((candidate) => candidate.username === username);
          if (!invitee) throw new HttpError(404, "User not found.");
          if (chat.memberIds.includes(invitee.id)) {
            sendJson(response, 200, { chat: conversationSummary(currentStore, chat, user.id), added: false });
            return;
          }
          if (chatType === "group" && chat.memberIds.length >= 200) {
            throw new HttpError(409, "Groups cannot have more than 200 participants.");
          }
          chat.memberIds.push(invitee.id);
          chat.unreadCounts = chat.unreadCounts || {};
          chat.unreadCounts[invitee.id] = 0;
          chat.lastReadMessageIds = chat.lastReadMessageIds || {};
          chat.lastReadMessageIds[invitee.id] = latestMessageId(currentStore, chat.id);
          await persist();
          const event = { chatId, action: "member-added", userId: invitee.id };
          broadcastChatMembers(chat, "chat-updated", event, broadcast);
          sendJson(response, 201, { chat: conversationSummary(currentStore, chat, user.id), added: true });
          return;
        }

        if (request.method === "DELETE" && section === "members" && targetId) {
          requireChatRole(chat, user.id, ["owner", "admin"]);
          const targetRole = getChatRole(chat, targetId);
          if (!targetRole) throw new HttpError(404, "Chat member not found.");
          if (targetId === user.id || targetRole === "owner") {
            throw new HttpError(400, "Use leave or ownership transfer to change your membership.");
          }
          if (role === "admin" && targetRole !== "member") {
            throw new HttpError(403, "Administrators cannot remove the owner or other administrators.");
          }
          chat.memberIds = chat.memberIds.filter((memberId) => memberId !== targetId);
          chat.adminIds = (chat.adminIds || []).filter((adminId) => adminId !== targetId);
          if (chat.unreadCounts) delete chat.unreadCounts[targetId];
          if (chat.lastReadMessageIds) delete chat.lastReadMessageIds[targetId];
          await persist();
          const event = { chatId, action: "member-removed", userId: targetId };
          broadcastChatMembers(chat, "chat-updated", event, broadcast);
          broadcast(targetId, "chat-updated", event);
          sendJson(response, 200, { ok: true });
          return;
        }

        if (request.method === "PUT" && section === "admins" && targetId && chatType !== "direct") {
          requireChatRole(chat, user.id, ["owner"]);
          if (targetId === chat.ownerId) throw new HttpError(400, "The owner cannot be an administrator.");
          if (!chat.memberIds.includes(targetId)) throw new HttpError(404, "Chat member not found.");
          const input = await readJsonBody(request);
          if (input.role === "admin") {
            if (!chat.adminIds.includes(targetId)) chat.adminIds.push(targetId);
          } else if (input.role === "member") {
            chat.adminIds = chat.adminIds.filter((adminId) => adminId !== targetId);
          } else {
            throw new HttpError(400, "Role must be admin or member.");
          }
          await persist();
          broadcastChatMembers(chat, "chat-updated", { chatId, action: "role-changed", userId: targetId }, broadcast);
          sendJson(response, 200, { chat: conversationSummary(currentStore, chat, user.id) });
          return;
        }

        if (request.method === "PUT" && section === "owner" && !targetId) {
          requireChatRole(chat, user.id, ["owner"]);
          const input = await readJsonBody(request);
          const username = cleanText(input.username, 32).replace(/^@/, "").toLowerCase();
          const newOwner = currentStore.users.find((candidate) => candidate.username === username);
          if (!newOwner || !chat.memberIds.includes(newOwner.id)) {
            throw new HttpError(404, "The new owner must already be a chat member.");
          }
          if (newOwner.id === user.id) throw new HttpError(400, "You are already the owner.");
          chat.ownerId = newOwner.id;
          chat.createdBy = newOwner.id;
          chat.adminIds = (chat.adminIds || []).filter((adminId) => adminId !== newOwner.id);
          await persist();
          broadcastChatMembers(chat, "chat-updated", { chatId, action: "owner-changed", userId: newOwner.id }, broadcast);
          sendJson(response, 200, { chat: conversationSummary(currentStore, chat, user.id) });
          return;
        }

        if (request.method === "POST" && section === "leave" && !targetId) {
          if (role === "owner") throw new HttpError(409, "Transfer ownership or delete the chat before leaving.");
          chat.memberIds = chat.memberIds.filter((memberId) => memberId !== user.id);
          chat.adminIds = (chat.adminIds || []).filter((adminId) => adminId !== user.id);
          if (chat.unreadCounts) delete chat.unreadCounts[user.id];
          if (chat.lastReadMessageIds) delete chat.lastReadMessageIds[user.id];
          await persist();
          const event = { chatId, action: "member-removed", userId: user.id };
          broadcastChatMembers(chat, "chat-updated", event, broadcast);
          broadcast(user.id, "chat-updated", event);
          sendJson(response, 200, { ok: true });
          return;
        }

        if (request.method === "DELETE" && !section) {
          requireChatRole(chat, user.id, ["owner"]);
          removeChatData(currentStore, chatId);
          const uploadsRoot = path.resolve(dataDirectory, "uploads");
          const chatUploads = path.resolve(uploadsRoot, chatId);
          if (!chatUploads.startsWith(`${uploadsRoot}${path.sep}`)) {
            throw new Error("Unsafe chat upload directory.");
          }
          await fs.rm(chatUploads, { recursive: true, force: true });
          await persist();
          broadcastChatMembers(chat, "chat-updated", { chatId, action: "chat-deleted" }, broadcast);
          sendJson(response, 200, { ok: true });
          return;
        }

        throw new HttpError(404, "Not found.");
      }

      if (request.method === "PATCH" && url.pathname === "/api/account") {
        const input = await readJsonBody(request);
        const fullName = cleanText(input.fullName, 256);
        const about = cleanText(input.about, 1000);
        if (Array.from(fullName).length < 1 || Array.from(fullName).length > 50) {
          throw new HttpError(400, "Display name must be 1–50 characters.");
        }
        if (Array.from(about).length > 200) {
          throw new HttpError(400, "About must be at most 200 characters.");
        }
        if (input.newPassword) {
          if (typeof input.newPassword !== "string"
            || Array.from(input.newPassword).length < 8 || Array.from(input.newPassword).length > 128) {
            throw new HttpError(400, "Password must be 8–128 characters.");
          }
          const currentPassword = typeof input.currentPassword === "string" ? input.currentPassword : "";
          if (!await verifyPassword(currentPassword, user.passwordHash)) {
            throw new HttpError(401, "Current password is incorrect.");
          }
          user.passwordHash = await passwordHash(input.newPassword);
        }
        user.fullName = fullName;
        user.about = about;
        if (typeof input.showOnlineStatus === "boolean") user.showOnlineStatus = input.showOnlineStatus;
        if (typeof input.hideNotificationContent === "boolean") {
          user.hideNotificationContent = input.hideNotificationContent;
        }
        await persist();
        sendJson(response, 200, {
          user: {
            ...publicUser(user),
            createdAt: user.createdAt,
            hideNotificationContent: user.hideNotificationContent === true
          }
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/users") {
        const query = cleanText(url.searchParams.get("q") || "", 25).replace(/^@/, "").toLowerCase();
        const users = query.length < 2 ? [] : currentStore.users
          .filter((candidate) => candidate.id !== user.id
            && (candidate.username.includes(query) || candidate.fullName.toLowerCase().includes(query)))
          .slice(0, 20)
          .map(publicUser);
        sendJson(response, 200, users);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/channels") {
        const input = await readJsonBody(request);
        const name = cleanText(input.name, 50);
        const description = cleanText(input.description, 160);
        if (Array.from(name).length < 2) throw new HttpError(400, "Channel name is too short.");
        const id = `channel_${randomId()}`;
        const channel = {
          id,
          type: "channel",
          name,
          description,
          createdBy: user.id,
          ownerId: user.id,
          adminIds: [],
          memberIds: [user.id],
          unreadCounts: {},
          lastReadMessageIds: {},
          createdAt: new Date().toISOString()
        };
        currentStore.channels.push(channel);
        await persist();
        sendJson(response, 201, conversationSummary(currentStore, channel, user.id));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/groups") {
        const input = await readJsonBody(request);
        const name = cleanText(input.name, 50);
        const usernames = Array.isArray(input.usernames)
          ? input.usernames.map((value) => cleanText(value, 32).replace(/^@/, "").toLowerCase()).filter(Boolean)
          : [];
        if (Array.from(name).length < 2) throw new HttpError(400, "Group name is too short.");
        if (!usernames.length || usernames.length > 199) {
          throw new HttpError(400, "Add between 2 and 199 other participants.");
        }
        const users = usernames.map((username) =>
          currentStore.users.find((candidate) => candidate.username === username)
        );
        if (users.some((participant) => !participant)) throw new HttpError(404, "One or more usernames were not found.");
        const memberIds = [...new Set([user.id, ...users.map((participant) => participant.id)])];
        if (memberIds.length < 2) throw new HttpError(400, "A group must have at least one other member.");
        const conversation = {
          id: `group_${randomId()}`,
          type: "group",
          name,
          memberIds,
          adminIds: [],
          ownerId: user.id,
          createdBy: user.id,
          createdAt: new Date().toISOString(),
          unreadCounts: {},
          lastReadMessageIds: {}
        };
        currentStore.conversations.push(conversation);
        await persist();
        sendJson(response, 201, conversationSummary(currentStore, conversation, user.id));
        return;
      }

      if (request.method === "POST" && /^\/api\/channels\/[^/]+\/join$/.test(url.pathname)) {
        const id = decodeURIComponent(url.pathname.split("/")[3]);
        const channel = currentStore.channels.find((item) => item.id === id);
        if (!channel) throw new HttpError(404, "Channel not found.");
        if (!channel.memberIds.includes(user.id)) {
          channel.memberIds.push(user.id);
          channel.unreadCounts = channel.unreadCounts || {};
          channel.unreadCounts[user.id] = 0;
          channel.lastReadMessageIds = channel.lastReadMessageIds || {};
          channel.lastReadMessageIds[user.id] = latestMessageId(currentStore, channel.id);
          await persist();
          broadcastChatMembers(channel, "chat-updated", { chatId: id, action: "member-added", userId: user.id }, broadcast);
        }
        sendJson(response, 200, conversationSummary(currentStore, channel, user.id));
        return;
      }

      if (request.method === "POST" && /^\/api\/directs\/[^/]+$/.test(url.pathname)) {
        const input = await readJsonBody(request);
        const username = cleanText(input.username || decodeURIComponent(url.pathname.split("/")[3]), 32)
          .replace(/^@/, "").toLowerCase();
        const otherUser = currentStore.users.find((candidate) => candidate.username === username);
        if (!otherUser) throw new HttpError(404, "User not found.");
        if (otherUser.id === user.id) throw new HttpError(400, "You cannot message yourself.");
        const conversation = findDirectConversation(currentStore, user.id, otherUser.id);
        if (conversation) {
          sendJson(response, 200, conversationSummary(currentStore, conversation, user.id));
          return;
        }
        const memberIds = [user.id, otherUser.id].sort();
        sendJson(response, 200, {
          id: `pending_dm_${otherUser.id}`,
          type: "direct",
          name: otherUser.fullName,
          username: otherUser.username,
          description: "",
          memberIds,
          joined: true,
          unreadCount: 0,
          createdAt: new Date().toISOString(),
          pending: true,
          role: "member"
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/conversations/read") {
        const input = await readJsonBody(request);
        const { conversation } = findConversation(currentStore, input.conversationId, user.id);
        conversation.unreadCounts = conversation.unreadCounts || {};
        conversation.lastReadMessageIds = conversation.lastReadMessageIds || {};
        conversation.lastReadMessageIds[user.id] = latestMessageId(currentStore, conversation.id);
        conversation.unreadCounts[user.id] = 0;
        await persist();
        sendJson(response, 200, {
          ok: true,
          lastReadMessageId: conversation.lastReadMessageIds[user.id],
          unreadCount: countUnreadMessages(currentStore, conversation, user.id)
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/messages") {
        const conversationId = url.searchParams.get("conversationId") || "";
        findConversation(currentStore, conversationId, user.id);
        const allMessages = currentStore.messages
          .filter((message) => (message.conversationId || message.room) === conversationId
            && canReadMessage(currentStore, message, user.id))
          .sort((left, right) => left.id - right.id);
        const beforeValue = url.searchParams.get("before");
        let eligibleMessages = allMessages;
        if (beforeValue !== null) {
          if (!/^[1-9]\d*$/.test(beforeValue) || !Number.isSafeInteger(Number(beforeValue))) {
            throw new HttpError(400, "Invalid message cursor.");
          }
          eligibleMessages = allMessages.filter((message) => message.id < Number(beforeValue));
        }
        const selectedMessages = eligibleMessages.slice(-MESSAGE_PAGE_SIZE);
        const hasMore = eligibleMessages.length > selectedMessages.length;
        const messages = [...selectedMessages].reverse()
          .map((message) => visibleMessage(message, currentStore));
        sendJson(response, 200, {
          messages,
          nextCursor: hasMore ? selectedMessages[0].id : null,
          hasMore
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/messages") {
        const input = await readJsonBody(request);
        const conversationId = cleanText(input.conversationId, 100);
        const recipientUsername = cleanText(input.recipientUsername, 32).replace(/^@/, "").toLowerCase();
        const text = cleanMessageText(input.text);
        const attachmentIds = Array.isArray(input.attachmentIds)
          ? [...new Set(input.attachmentIds.filter((id) => typeof id === "string"))]
          : [];
        if ((!text && attachmentIds.length === 0) || Array.from(text).length > 4000) {
          throw new HttpError(400, "Message must contain 1–4000 characters.");
        }
        if (attachmentIds.length > MAX_ATTACHMENTS_PER_MESSAGE) {
          throw new HttpError(400, "A message can contain at most 10 files.");
        }
        let recipient = null;
        if (recipientUsername) {
          recipient = currentStore.users.find((candidate) => candidate.username === recipientUsername);
          if (!recipient) throw new HttpError(404, "User not found.");
          if (recipient.id === user.id) throw new HttpError(400, "You cannot message yourself.");
          if ((user.blockedUserIds || []).includes(recipient.id)
            || (recipient.blockedUserIds || []).includes(user.id)) {
            throw new HttpError(403, "This user cannot receive your messages.");
          }
        }
        const now = Date.now();
        const recentAttempts = (messageAttempts.get(user.id) || [])
          .filter((time) => now - time < MESSAGE_RATE_WINDOW_MS);
        if (recentAttempts.length >= MAX_MESSAGES_PER_MINUTE) {
          messageAttempts.set(user.id, recentAttempts);
          throw new HttpError(429, "You can send at most 20 messages per minute.");
        }
        let chatId = conversationId;
        if (recipient) {
          let direct = findDirectConversation(currentStore, user.id, recipient.id);
          if (!direct) {
            const memberIds = [user.id, recipient.id].sort();
            direct = {
              id: `dm_${memberIds.join("_")}`,
              type: "direct",
              memberIds,
              ownerId: null,
              adminIds: [],
              unreadCounts: {},
              lastReadMessageIds: {},
              createdAt: new Date().toISOString()
            };
            currentStore.conversations.push(direct);
          }
          chatId = direct.id;
        }
        const { type, conversation } = findConversation(currentStore, chatId, user.id);
        if (type === "channel" && !["owner", "admin"].includes(getChatRole(conversation, user.id))) {
          throw new HttpError(403, "Only channel owners and administrators can post.");
        }
        if (type === "direct") {
          const otherUserId = conversation.memberIds.find((memberId) => memberId !== user.id);
          const otherUser = currentStore.users.find((candidate) => candidate.id === otherUserId);
          const blockedByEither = (user.blockedUserIds || []).includes(otherUserId)
            || (otherUser?.blockedUserIds || []).includes(user.id);
          if (blockedByEither) throw new HttpError(403, "This user cannot receive your messages.");
        }
        const attachments = attachmentIds.map((id) =>
          currentStore.attachments.find((item) => item.id === id)
        );
        if (attachments.some((attachment) => !attachment || attachment.authorId !== user.id
          || attachment.chatId !== chatId || attachment.messageId)) {
          throw new HttpError(400, "One or more attachments are invalid.");
        }
        messageAttempts.set(user.id, [...recentAttempts, now]);
        const createdAt = new Date(now).toISOString();
        const message = {
          id: currentStore.nextMessageId++,
          conversationId: chatId,
          authorId: user.id,
          text,
          createdAt,
          sentAt: createdAt,
          deleted: false,
          attachmentIds
        };
        for (const attachment of attachments) attachment.messageId = message.id;
        currentStore.links.push(...extractLinks(text).map((link) => ({
          id: randomId(),
          chatId,
          messageId: message.id,
          authorId: user.id,
          createdAt,
          title: "",
          ...link
        })));
        currentStore.messages.push(message);
        for (const recipientId of conversation.memberIds) {
          conversation.unreadCounts = conversation.unreadCounts || {};
          conversation.lastReadMessageIds = conversation.lastReadMessageIds || {};
          conversation.unreadCounts[recipientId] = countUnreadMessages(currentStore, conversation, recipientId);
        }
        await persist();
        const safeMessage = visibleMessage(message, currentStore);
        for (const recipientId of conversation.memberIds) {
          broadcast(recipientId, "message", safeMessage);
          if (recipientId !== user.id
            && !(conversation.mutedUserIds || []).includes(recipientId)
            && !isUserViewingChat(recipientId, conversation.id)) {
            const recipient = currentStore.users.find((candidate) => candidate.id === recipientId);
            pushSender(currentStore, recipientId, safeMessage, persist, {
              hideContent: recipient?.hideNotificationContent === true
            }).catch((error) =>
              console.error("Push notification failed:", error)
            );
          }
        }
        sendJson(response, 201, {
          ...safeMessage,
          conversation: conversationSummary(currentStore, conversation, user.id)
        });
        return;
      }

      if (request.method === "PATCH" && /^\/api\/messages\/[^/]+$/.test(url.pathname)) {
        const id = decodeURIComponent(url.pathname.split("/")[3]);
        const numericId = Number(id);
        const targetMessage = currentStore.messages.find((item) => item.id === numericId);
        if (!targetMessage || !canReadMessage(currentStore, targetMessage, user.id)) {
          throw new HttpError(404, "Message not found.");
        }
        if (targetMessage.deleted) throw new HttpError(400, "Deleted messages cannot be edited.");
        if (targetMessage.authorId !== user.id) throw new HttpError(403, "You can only edit your own messages.");
        const createdAt = Date.parse(targetMessage.createdAt || targetMessage.sentAt);
        if (!Number.isFinite(createdAt) || Date.now() - createdAt > MESSAGE_EDIT_WINDOW_MS) {
          throw new HttpError(403, "Messages can only be edited within 48 hours.");
        }
        const input = await readJsonBody(request);
        const text = cleanMessageText(input.text);
        if (!text || Array.from(text).length > 4000) {
          throw new HttpError(400, "Message must contain 1–4000 characters.");
        }
        targetMessage.text = text;
        targetMessage.editedAt = new Date().toISOString();
        currentStore.links = currentStore.links.filter((link) => link.messageId !== targetMessage.id);
        currentStore.links.push(...extractLinks(text).map((link) => ({
          id: randomId(),
          chatId: targetMessage.conversationId,
          messageId: targetMessage.id,
          authorId: user.id,
          createdAt: targetMessage.createdAt || targetMessage.sentAt,
          title: "",
          ...link
        })));
        await persist();
        const safeMessage = visibleMessage(targetMessage, currentStore);
        const { conversation } = findConversation(currentStore, targetMessage.conversationId, user.id);
        for (const recipientId of conversation.memberIds) broadcast(recipientId, "message-updated", safeMessage);
        sendJson(response, 200, safeMessage);
        return;
      }

      if (request.method === "DELETE" && /^\/api\/messages\/[^/]+$/.test(url.pathname)) {
        const id = decodeURIComponent(url.pathname.split("/")[3]);
        const message = currentStore.messages.find((item) => item.id === Number(id));
        if (!message || !canReadMessage(currentStore, message, user.id)) throw new HttpError(404, "Message not found.");
        if (message.deleted) {
          sendJson(response, 200, { ok: true });
          return;
        }
        const { type, conversation } = findConversation(
          currentStore, message.conversationId || message.room, user.id
        );
        const isModerator = ["channel", "group"].includes(type)
          && ["owner", "admin"].includes(getChatRole(conversation, user.id));
        if (message.authorId !== user.id && !isModerator) {
          throw new HttpError(403, "You can only delete your own messages.");
        }
        const removedAttachments = currentStore.attachments.filter((attachment) =>
          (message.attachmentIds || []).includes(attachment.id)
        );
        message.text = "";
        message.deleted = true;
        message.deletedAt = new Date().toISOString();
        message.attachmentIds = [];
        currentStore.attachments = currentStore.attachments.filter((attachment) =>
          !removedAttachments.some((removed) => removed.id === attachment.id)
        );
        currentStore.links = currentStore.links.filter((link) => link.messageId !== message.id);
        const uploadsRoot = path.resolve(dataDirectory, "uploads");
        for (const attachment of removedAttachments) {
          const filePath = path.resolve(uploadsRoot, attachment.chatId, attachment.id);
          if (!filePath.startsWith(`${uploadsRoot}${path.sep}`)) throw new Error("Unsafe attachment path.");
          await fs.rm(filePath, { force: true });
          if (attachment.thumbnailId) {
            await fs.rm(path.resolve(uploadsRoot, attachment.chatId, attachment.thumbnailId), { force: true });
          }
        }
        await persist();
        const payload = visibleMessage(message, currentStore);
        for (const recipientId of conversation.memberIds) broadcast(recipientId, "message-deleted", payload);
        sendJson(response, 200, payload);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/stream") {
        response.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no"
        });
        response.write("retry: 3000\n");
        if (!connectedUsers.has(user.id)) connectedUsers.set(user.id, new Set());
        connectedUsers.get(user.id).add(response);
        const heartbeat = setInterval(() => response.write(": keep-alive\n\n"), 25000);
        response.on("close", () => {
          clearInterval(heartbeat);
          connectedUsers.get(user.id)?.delete(response);
          if (connectedUsers.get(user.id)?.size === 0) {
            connectedUsers.delete(user.id);
            user.lastSeenAt = new Date().toISOString();
            persist().catch((error) => console.error("Unable to persist last-seen status:", error));
          }
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/push/subscribe") {
        const input = await readJsonBody(request);
        const subscription = input.subscription;
        if (!subscription || typeof subscription.endpoint !== "string" || !subscription.keys
          || typeof subscription.keys.p256dh !== "string" || typeof subscription.keys.auth !== "string") {
          throw new HttpError(400, "Invalid push subscription.");
        }
        let endpoint;
        try {
          endpoint = new URL(subscription.endpoint);
        } catch {
          throw new HttpError(400, "Invalid push endpoint.");
        }
        const trustedPushHosts = ["fcm.googleapis.com", "push.services.mozilla.com", "push.apple.com"];
        if (endpoint.protocol !== "https:" || !trustedPushHosts.some((host) =>
          endpoint.hostname === host || endpoint.hostname.endsWith(`.${host}`)
        )) {
          throw new HttpError(400, "This browser push service is not supported.");
        }
        currentStore.pushSubscriptions = currentStore.pushSubscriptions.filter(
          (item) => !(item.userId === user.id && item.subscription.endpoint === subscription.endpoint)
        );
        currentStore.pushSubscriptions.push({ userId: user.id, subscription });
        await persist();
        sendJson(response, 201, { ok: true });
        return;
      }

      if (request.method === "DELETE" && url.pathname === "/api/push/subscribe") {
        const input = await readJsonBody(request);
        const endpoint = typeof input.endpoint === "string" ? input.endpoint : "";
        currentStore.pushSubscriptions = currentStore.pushSubscriptions.filter(
          (item) => !(item.userId === user.id && item.subscription.endpoint === endpoint)
        );
        await persist();
        sendJson(response, 200, { ok: true });
        return;
      }

      sendJson(response, 404, {
        error: { code: "NOT_FOUND", message: "Not found." }
      });
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(response, error.status, {
          error: { code: apiErrorCode(error.status), message: error.message }
        });
        return;
      }
      console.error("Request failed:", error);
      if (!response.headersSent) {
        sendJson(response, 500, {
          error: { code: apiErrorCode(500), message: "The server could not process this request." }
        });
      }
      else response.destroy(error);
    }
  });

  server.on("close", () => clearInterval(presenceCleanupTimer));
  return server;
}

function createPushPayload(message, { hideContent = false } = {}) {
  const authorName = message.author?.fullName || `@${message.author?.username || "user"}`;
  const text = typeof message.text === "string" ? message.text.trim() : "";
  return {
    title: `${authorName} · Полюс`,
    body: hideContent ? "Новое сообщение" : Array.from(text || "Вложение").slice(0, 100).join(""),
    conversationId: String(message.conversationId || message.chatId || "")
  };
}

async function sendPushToUser(
  store,
  userId,
  message,
  persist,
  { hideContent = false, sendNotification = webpush.sendNotification } = {}
) {
  const subscriptions = store.pushSubscriptions.filter((item) => item.userId === userId);
  await Promise.all(subscriptions.map(async ({ subscription }) => {
    try {
      await sendNotification(subscription, JSON.stringify(createPushPayload(message, { hideContent })));
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        store.pushSubscriptions = store.pushSubscriptions.filter(
          (item) => !(item.userId === userId && item.subscription.endpoint === subscription.endpoint)
        );
        await persist();
        return;
      }
      if (error.statusCode === 401 || error.statusCode === 403) {
        console.error("Push authorization failed. Check POLUS_PUSH_CONTACT and VAPID keys.");
        return;
      }
      throw error;
    }
  }));
}

async function retryFileOperation(operation, retryDelay) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!["EPERM", "EACCES", "EBUSY"].includes(error.code) || attempt >= 4) throw error;
      await retryDelay(attempt);
    }
  }
}

async function writeStoreAtomically(filePath, contents, {
  renameFile = fs.rename,
  retryDelay = (attempt) => new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)))
} = {}) {
  const suffix = `${process.pid}.${crypto.randomUUID()}`;
  const temporaryPath = `${filePath}.${suffix}.tmp`;
  const backupPath = `${filePath}.bak`;
  const backupTemporaryPath = `${filePath}.${suffix}.bak.tmp`;

  try {
    await fs.copyFile(filePath, backupTemporaryPath);
    await retryFileOperation(() => renameFile(backupTemporaryPath, backupPath), retryDelay);
  } catch (error) {
    await fs.rm(backupTemporaryPath, { force: true });
    if (error.code !== "ENOENT") throw error;
  }

  try {
    await fs.writeFile(temporaryPath, contents, "utf8");
    await retryFileOperation(() => renameFile(temporaryPath, filePath), retryDelay);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}

function createStoreWriter(filePath, options) {
  let queue = Promise.resolve();
  return (store) => {
    const snapshot = JSON.stringify(store);
    const write = queue.then(() => writeStoreAtomically(filePath, snapshot, options));
    queue = write.catch(() => {});
    return write;
  };
}

async function start() {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  const store = await loadStore(DATA_FILE);
  if (!store.vapidKeys) store.vapidKeys = webpush.generateVAPIDKeys();
  const contact = process.env.POLUS_PUSH_CONTACT || "mailto:admin@example.com";
  webpush.setVapidDetails(contact, store.vapidKeys.publicKey, store.vapidKeys.privateKey);

  const saveStore = createStoreWriter(DATA_FILE);
  await saveStore(store);
  const server = createMessengerServer({ store, saveStore });
  server.listen(PORT, HOST, () => {
    const port = server.address().port;
    console.log(`Полюс запущен: http://localhost:${port}`);
    if (HOST === "0.0.0.0" || HOST === "::") {
      const addresses = getLanAddresses();
      if (addresses.length) {
        console.log("Для подключения с другого устройства в этой же сети откройте:");
        for (const address of addresses) {
          console.log(`  http://${address}:${port}`);
        }
      } else {
        console.log("Локальный IP не найден. Проверьте подключение к Wi-Fi или Ethernet.");
      }
    } else {
      console.log(`Адрес для подключения: http://${HOST}:${port}`);
      if (HOST === "127.0.0.1" || HOST === "localhost") {
        console.log("Этот адрес доступен только на этом компьютере. Для подключения по локальной сети задайте HOST=0.0.0.0.");
      }
    }
    console.log("Для push-уведомлений в production нужен HTTPS и корректный POLUS_PUSH_CONTACT.");
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error("Не удалось запустить Полюс:", error);
    process.exitCode = 1;
  });
}

module.exports = {
  createMessengerServer,
  createEmptyStore,
  createPushPayload,
  createStoreWriter,
  getLanAddresses,
  migrateLegacyChannelData,
  normalizeStore,
  loadStore,
  writeStoreAtomically,
  sendPushToUser,
  PRIVACY_VERSION
};