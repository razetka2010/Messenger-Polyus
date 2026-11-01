const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const Database = require("better-sqlite3");
const express = require("express");
const webpush = require("web-push");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const DATA_DIRECTORY = path.join(__dirname, "data");
const DATABASE_FILE = path.join(DATA_DIRECTORY, "polus.sqlite");
const LEGACY_DATA_FILE = path.join(DATA_DIRECTORY, "polus-store.json");
const BUILD_DIRECTORY = path.join(__dirname, "dist");
const CLIENT_BUILD_DIRECTORY = path.join(BUILD_DIRECTORY, "client");
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ORPHAN_ATTACHMENT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;
const PRIVACY_VERSION = "2026-10-31";
const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,32}$/;
const LEGACY_CHANNEL_IDS = new Set(["general", "introductions", "off-topic"]);
const PUBLIC_FILES = new Map([
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
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
const trustedProxyAddresses = new Set((process.env.POLUS_TRUSTED_PROXIES || "")
  .split(",").map((address) => address.trim()).filter((address) => net.isIP(address)));
const MAX_LOGIN_FAILURES = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_MESSAGES_PER_MINUTE = 20;
const MESSAGE_RATE_WINDOW_MS = 60 * 1000;
const MESSAGE_EDIT_WINDOW_MS = 48 * 60 * 60 * 1000;
const MESSAGE_PAGE_SIZE = 50;
const MESSAGE_REACTIONS = new Set(["👍", "❤️", "😂", "😮", "😢", "👏"]);
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
      try {
        return decodeURIComponent(cookie.slice(separator + 1).trim());
      } catch {
        throw new HttpError(400, "Invalid cookie encoding.");
      }
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

function createSavedConversation(user) {
  return {
    id: `saved_${user.id}`,
    type: "saved",
    ownerId: user.id,
    createdBy: user.id,
    memberIds: [user.id],
    adminIds: [],
    unreadCounts: {},
    lastReadMessageIds: {},
    createdAt: user.createdAt || new Date().toISOString()
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
    channel.postAs = channel.postAs === "channel" ? "channel" : "person";
    channel.unreadCounts = channel.unreadCounts || {};
    channel.lastReadMessageIds = channel.lastReadMessageIds || {};
    channel.ownerId = channel.ownerId || channel.createdBy || null;
  }
  for (const conversation of base.conversations) {
    conversation.memberIds = Array.isArray(conversation.memberIds) ? conversation.memberIds : [];
    conversation.type ||= conversation.memberIds.length === 2
      ? "direct"
      : conversation.memberIds.length === 1 ? "saved" : "group";
    conversation.adminIds = Array.isArray(conversation.adminIds) ? conversation.adminIds : [];
    conversation.unreadCounts = conversation.unreadCounts || {};
    conversation.lastReadMessageIds = conversation.lastReadMessageIds || {};
    conversation.ownerId = conversation.ownerId || conversation.createdBy || null;
  }
  const savedChatsByUser = new Map();
  const duplicateSavedChats = new Set();
  for (const conversation of base.conversations) {
    if (conversation.type !== "saved") continue;
    const userId = conversation.ownerId || conversation.memberIds[0];
    if (!base.users.some((user) => user.id === userId)) {
      duplicateSavedChats.add(conversation);
      continue;
    }
    const canonicalId = `saved_${userId}`;
    const existing = savedChatsByUser.get(userId);
    if (!existing) {
      savedChatsByUser.set(userId, conversation);
      const previousId = conversation.id;
      conversation.id = canonicalId;
      conversation.ownerId = userId;
      conversation.createdBy = userId;
      conversation.type = "saved";
      conversation.memberIds = [userId];
      conversation.adminIds = [];
      conversation.unreadCounts = {};
      conversation.lastReadMessageIds = {};
      delete conversation.name;
      if (previousId !== canonicalId) {
        for (const message of base.messages || []) {
          if ((message.conversationId || message.room || message.chatId) === previousId) {
            message.conversationId = canonicalId;
            delete message.room;
            delete message.chatId;
          }
        }
        for (const item of [...base.attachments, ...base.links]) {
          if ((item.chatId || item.conversationId || item.room) === previousId) {
            item.chatId = canonicalId;
            delete item.conversationId;
            delete item.room;
          }
        }
      }
    } else {
      duplicateSavedChats.add(conversation);
      for (const message of base.messages || []) {
        if ((message.conversationId || message.room || message.chatId) === conversation.id) {
          message.conversationId = canonicalId;
          delete message.room;
          delete message.chatId;
        }
      }
      for (const item of [...base.attachments, ...base.links]) {
        if ((item.chatId || item.conversationId || item.room) === conversation.id) {
          item.chatId = canonicalId;
          delete item.conversationId;
          delete item.room;
        }
      }
    }
  }
  base.conversations = base.conversations.filter((conversation) =>
    !duplicateSavedChats.has(conversation)
  );
  for (const user of base.users) {
    if (savedChatsByUser.has(user.id)) continue;
    base.conversations.push(createSavedConversation(user));
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
  const messagesByChat = new Map();
  for (const message of base.messages) {
    const chatId = message.conversationId || message.room;
    if (!messagesByChat.has(chatId)) messagesByChat.set(chatId, []);
    messagesByChat.get(chatId).push(message);
  }
  for (const chat of [...base.channels, ...base.conversations]) {
    if (chat.type === "saved") {
      chat.unreadCounts = {};
      continue;
    }
    const chatMessages = messagesByChat.get(chat.id) || [];
    chatMessages.sort((left, right) => left.id - right.id);
    for (const memberId of chat.memberIds) {
      if (!Number.isSafeInteger(chat.lastReadMessageIds[memberId])
        || chat.lastReadMessageIds[memberId] < 0) {
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
      }
      chat.unreadCounts[memberId] = 0;
    }
    for (const message of chatMessages) {
      for (const memberId of chat.memberIds) {
        if (message.id > chat.lastReadMessageIds[memberId] && message.authorId !== memberId) {
          chat.unreadCounts[memberId] += 1;
        }
      }
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

function createSqliteSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS users_username ON users(username);
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT,
      created_by TEXT,
      owner_id TEXT,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS members (
      chat_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      last_read_message_id INTEGER NOT NULL,
      unread_count INTEGER NOT NULL,
      muted INTEGER NOT NULL,
      PRIMARY KEY (chat_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS members_user_id ON members(user_id);
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY,
      chat_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS messages_chat_id_id ON messages(chat_id, id DESC);
    CREATE INDEX IF NOT EXISTS messages_unread ON messages(chat_id, id, author_id);
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      message_id INTEGER,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS attachments_message_id ON attachments(message_id);
    CREATE TABLE IF NOT EXISTS links (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      message_id INTEGER NOT NULL,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT NOT NULL,
      user_id TEXT NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (user_id, endpoint)
    );
    CREATE INDEX IF NOT EXISTS push_subscriptions_user_id ON push_subscriptions(user_id);
    CREATE TABLE IF NOT EXISTS upload_usage (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS upload_usage_user_id_created_at ON upload_usage(user_id, created_at);
  `);
}

function withoutProperties(value, properties) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !properties.has(key)));
}

function serializeSqliteStore(store) {
  const rows = {};
  const setRows = (table, values) => {
    rows[table] = new Map(values.map(([key, columns]) => [String(key), columns]));
  };
  const json = (value) => JSON.stringify(value);

  setRows("users", store.users.map((user) => [
    user.id,
    [user.id, user.username, user.passwordHash || "", json(withoutProperties(user,
      new Set(["id", "username", "passwordHash"])))]
  ]));
  setRows("sessions", store.sessions.map((session) => [
    session.id,
    [session.id, session.userId, session.tokenHash, session.expiresAt]
  ]));

  const chats = [...store.channels, ...store.conversations];
  const memberRows = [];
  setRows("chats", chats.map((chat) => {
    const type = chat.type || (store.channels.includes(chat)
      ? "channel"
      : chat.memberIds?.length === 2 ? "direct" : chat.memberIds?.length === 1 ? "saved" : "group");
    const data = withoutProperties(chat, new Set([
      "id", "type", "name", "createdBy", "ownerId", "memberIds", "adminIds",
      "lastReadMessageIds", "unreadCounts", "mutedUserIds"
    ]));
    for (const userId of chat.memberIds || []) {
      const role = chat.ownerId === userId || (!chat.ownerId && chat.createdBy === userId)
        ? "owner"
        : (chat.adminIds || []).includes(userId) ? "admin" : "member";
      memberRows.push([
        `${chat.id}\u0000${userId}`,
        [chat.id, userId, role, chat.lastReadMessageIds?.[userId] || 0,
          chat.unreadCounts?.[userId] || 0, (chat.mutedUserIds || []).includes(userId) ? 1 : 0]
      ]);
    }
    return [chat.id, [chat.id, type, chat.name || null, chat.createdBy || null,
      chat.ownerId || chat.createdBy || null, json(data)]];
  }));
  setRows("members", memberRows);

  setRows("messages", store.messages.map((message) => {
    const chatId = message.conversationId || message.room;
    return [message.id, [message.id, chatId, message.authorId, message.createdAt, json(withoutProperties(
      message, new Set(["id", "conversationId", "room", "authorId", "createdAt"])
    ))]];
  }));
  setRows("attachments", store.attachments.map((attachment) => [
    attachment.id,
    [attachment.id, attachment.chatId, attachment.messageId ?? null,
      json(withoutProperties(attachment, new Set(["id", "chatId", "messageId"])))]
  ]));
  setRows("links", store.links.map((link) => [
    link.id,
    [link.id, link.chatId || link.conversationId || link.room, link.messageId,
      json(withoutProperties(link, new Set(["id", "chatId", "conversationId", "room", "messageId"])))]
  ]));
  setRows("push_subscriptions", store.pushSubscriptions.map((item) => [
    `${item.userId}\u0000${item.subscription.endpoint}`,
    [item.subscription.endpoint, item.userId, json(item.subscription)]
  ]));

  const usageCounts = new Map();
  setRows("upload_usage", store.uploadUsage.map((usage) => {
    const signature = json(usage);
    const occurrence = usageCounts.get(signature) || 0;
    usageCounts.set(signature, occurrence + 1);
    const id = crypto.createHash("sha256").update(`${signature}\u0000${occurrence}`).digest("hex");
    return [id, [id, usage.userId || "", usage.size || 0, usage.createdAt || ""]];
  }));
  setRows("app_settings", [
    ["initialized", ["initialized", "1"]],
    ["nextMessageId", ["nextMessageId", String(store.nextMessageId)]],
    ["vapidKeys", ["vapidKeys", json(store.vapidKeys)]]
  ]);
  return rows;
}

const SQLITE_TABLES = {
  users: {
    upsert: `INSERT INTO users (id, username, password_hash, data) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET username=excluded.username, password_hash=excluded.password_hash, data=excluded.data`,
    remove: "DELETE FROM users WHERE id = ?"
  },
  sessions: {
    upsert: `INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id, token_hash=excluded.token_hash, expires_at=excluded.expires_at`,
    remove: "DELETE FROM sessions WHERE id = ?"
  },
  chats: {
    upsert: `INSERT INTO chats (id, type, name, created_by, owner_id, data) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET type=excluded.type, name=excluded.name, created_by=excluded.created_by,
      owner_id=excluded.owner_id, data=excluded.data`,
    remove: "DELETE FROM chats WHERE id = ?"
  },
  members: {
    upsert: `INSERT INTO members (chat_id, user_id, role, last_read_message_id, unread_count, muted)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(chat_id, user_id) DO UPDATE SET role=excluded.role,
      last_read_message_id=excluded.last_read_message_id, unread_count=excluded.unread_count, muted=excluded.muted`,
    remove: "DELETE FROM members WHERE chat_id = ? AND user_id = ?"
  },
  messages: {
    upsert: `INSERT INTO messages (id, chat_id, author_id, created_at, data) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET chat_id=excluded.chat_id, author_id=excluded.author_id,
      created_at=excluded.created_at, data=excluded.data`,
    remove: "DELETE FROM messages WHERE id = ?"
  },
  attachments: {
    upsert: `INSERT INTO attachments (id, chat_id, message_id, data) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET chat_id=excluded.chat_id, message_id=excluded.message_id, data=excluded.data`,
    remove: "DELETE FROM attachments WHERE id = ?"
  },
  links: {
    upsert: `INSERT INTO links (id, chat_id, message_id, data) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET chat_id=excluded.chat_id, message_id=excluded.message_id, data=excluded.data`,
    remove: "DELETE FROM links WHERE id = ?"
  },
  push_subscriptions: {
    upsert: `INSERT INTO push_subscriptions (endpoint, user_id, data) VALUES (?, ?, ?)
      ON CONFLICT(user_id, endpoint) DO UPDATE SET data=excluded.data`,
    remove: "DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?"
  },
  upload_usage: {
    upsert: `INSERT INTO upload_usage (id, user_id, size, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id, size=excluded.size, created_at=excluded.created_at`,
    remove: "DELETE FROM upload_usage WHERE id = ?"
  },
  app_settings: {
    upsert: "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    remove: "DELETE FROM app_settings WHERE key = ?"
  }
};

function persistSqliteRows(database, rows, previousRows) {
  for (const [table, spec] of Object.entries(SQLITE_TABLES)) {
    const desired = rows[table];
    const previous = previousRows[table] || new Map();
    const upsert = database.prepare(spec.upsert);
    const remove = database.prepare(spec.remove);
    for (const [key, columns] of desired) {
      if (JSON.stringify(previous.get(key)) !== JSON.stringify(columns)) upsert.run(...columns);
    }
    for (const key of previous.keys()) {
      if (desired.has(key)) continue;
      remove.run(...key.split("\u0000"));
    }
  }
}

function readNormalizedSqliteStore(database) {
  const store = createEmptyStore();
  store.users = database.prepare("SELECT id, username, password_hash, data FROM users").all()
    .map((row) => ({ ...JSON.parse(row.data), id: row.id, username: row.username, passwordHash: row.password_hash }));
  store.sessions = database.prepare("SELECT id, user_id, token_hash, expires_at FROM sessions").all()
    .map((row) => ({ id: row.id, userId: row.user_id, tokenHash: row.token_hash, expiresAt: row.expires_at }));

  const membersByChat = new Map();
  for (const row of database.prepare(`SELECT chat_id, user_id, role, last_read_message_id,
    unread_count, muted FROM members ORDER BY chat_id, user_id`).all()) {
    if (!membersByChat.has(row.chat_id)) membersByChat.set(row.chat_id, []);
    membersByChat.get(row.chat_id).push(row);
  }
  for (const row of database.prepare("SELECT id, type, name, created_by, owner_id, data FROM chats").all()) {
    const chat = {
      ...JSON.parse(row.data),
      id: row.id,
      type: row.type,
      name: row.name,
      createdBy: row.created_by,
      ownerId: row.owner_id,
      memberIds: [],
      adminIds: [],
      lastReadMessageIds: {},
      unreadCounts: {},
      mutedUserIds: []
    };
    for (const member of membersByChat.get(row.id) || []) {
      chat.memberIds.push(member.user_id);
      if (member.role === "admin") chat.adminIds.push(member.user_id);
      chat.lastReadMessageIds[member.user_id] = member.last_read_message_id;
      chat.unreadCounts[member.user_id] = member.unread_count;
      if (member.muted) chat.mutedUserIds.push(member.user_id);
    }
    (row.type === "channel" ? store.channels : store.conversations).push(chat);
  }
  store.messages = database.prepare("SELECT id, chat_id, author_id, created_at, data FROM messages ORDER BY id").all()
    .map((row) => ({
      ...JSON.parse(row.data),
      id: row.id,
      conversationId: row.chat_id,
      authorId: row.author_id,
      createdAt: row.created_at
    }));
  store.attachments = database.prepare("SELECT id, chat_id, message_id, data FROM attachments").all()
    .map((row) => ({
      ...JSON.parse(row.data),
      id: row.id,
      chatId: row.chat_id,
      messageId: row.message_id
    }));
  store.links = database.prepare("SELECT id, chat_id, message_id, data FROM links").all()
    .map((row) => ({
      ...JSON.parse(row.data),
      id: row.id,
      chatId: row.chat_id,
      messageId: row.message_id
    }));
  store.pushSubscriptions = database.prepare("SELECT user_id, data FROM push_subscriptions").all()
    .map((row) => ({ userId: row.user_id, subscription: JSON.parse(row.data) }));
  store.uploadUsage = database.prepare("SELECT user_id, size, created_at FROM upload_usage ORDER BY rowid").all()
    .map((row) => ({ userId: row.user_id, size: row.size, createdAt: row.created_at }));
  const settings = new Map(database.prepare("SELECT key, value FROM app_settings").all()
    .map((row) => [row.key, row.value]));
  store.nextMessageId = Number(settings.get("nextMessageId")) || 1;
  store.vapidKeys = settings.has("vapidKeys") ? JSON.parse(settings.get("vapidKeys")) : null;
  return normalizeStore(store);
}

async function loadSqliteStore(databasePath, legacyFilePath) {
  const database = new Database(databasePath);
  database.pragma("journal_mode = WAL");
  database.pragma("synchronous = FULL");
  createSqliteSchema(database);

  const initialized = database.prepare("SELECT value FROM app_settings WHERE key = 'initialized'").get();
  const hasLegacySnapshot = database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'polus_store'"
  ).get();
  let store;
  if (initialized) {
    store = readNormalizedSqliteStore(database);
  } else {
    const saved = hasLegacySnapshot
      ? database.prepare("SELECT snapshot FROM polus_store WHERE id = 1").get()
      : null;
    if (saved) {
      const input = JSON.parse(saved.snapshot);
      await migrateLegacyChannelData(input, path.dirname(databasePath));
      store = normalizeStore(input);
    } else {
      store = await loadStore(legacyFilePath);
    }
    const rows = serializeSqliteStore(store);
    database.transaction(() => persistSqliteRows(database, rows, {}))();
  }

  if (hasLegacySnapshot) database.exec("DROP TABLE polus_store");
  return { database, store };
}

function createSqliteStoreWriter(database, initialStore = createEmptyStore()) {
  let persistedRows = serializeSqliteStore(normalizeStore(initialStore));
  let queue = Promise.resolve();
  const saveStore = (store) => {
    const rows = serializeSqliteStore(store);
    const write = queue.then(() => {
      database.transaction(() => persistSqliteRows(database, rows, persistedRows))();
      persistedRows = rows;
    });
    queue = write.catch(() => {});
    return write;
  };
  const countUnread = database.prepare(`
    SELECT COUNT(*) AS count FROM messages
    WHERE chat_id = ? AND id > ? AND author_id != ?
  `);
  const findLastMessage = database.prepare(`SELECT id, chat_id, author_id, created_at, data
    FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT 1`);
  saveStore.countUnreadMessages = (chatId, lastReadMessageId, userId) =>
    countUnread.get(chatId, lastReadMessageId, userId).count;
  saveStore.lastMessageForChat = (chatId) => {
    const row = findLastMessage.get(chatId);
    return row ? {
      ...JSON.parse(row.data),
      id: row.id,
      conversationId: row.chat_id,
      authorId: row.author_id,
      createdAt: row.created_at
    } : null;
  };
  return saveStore;
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

function getClientAddress(request) {
  const remoteAddress = request.socket.remoteAddress || "unknown";
  if (!trustedProxyAddresses.has(remoteAddress)) return remoteAddress;
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded !== "string") return remoteAddress;
  const addresses = forwarded.split(",").map((address) => address.trim()).filter((address) => net.isIP(address));
  return addresses.at(-1) || remoteAddress;
}

function decodePathComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new HttpError(400, "Invalid URL encoding.");
  }
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
    type: conversation.type || (conversation.memberIds.length === 2
      ? "direct"
      : conversation.memberIds.length === 1 ? "saved" : "group"),
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
  const removedAttachments = store.attachments.filter((attachment) =>
    attachment.chatId === chatId || messageIds.has(attachment.messageId)
  );
  const attachmentIds = new Set(removedAttachments.map((attachment) => attachment.id));

  store.messages = store.messages.filter((message) => !messageIds.has(message.id));
  store.attachments = store.attachments.filter((attachment) =>
    !attachmentIds.has(attachment.id)
  );
  store.links = store.links.filter((link) =>
    link.chatId !== chatId && !messageIds.has(link.messageId)
  );
  store.channels = store.channels.filter((chat) => chat.id !== chatId);
  store.conversations = store.conversations.filter((chat) => chat.id !== chatId);
  return { messageIds, attachmentIds, removedAttachments };
}

function attachmentAssetLocations(attachment) {
  const storageChatId = attachment.storageChatId || attachment.chatId;
  const locations = [{
    chatId: storageChatId,
    id: attachment.storageId || attachment.id
  }];
  if (attachment.thumbnailId) {
    locations.push({
      chatId: attachment.thumbnailStorageChatId || storageChatId,
      id: attachment.thumbnailStorageId || attachment.thumbnailId
    });
  }
  return locations;
}

function removeAttachmentRecords(store, removedAttachments, uploadsRoot) {
  const removedIds = new Set(removedAttachments.map((attachment) => attachment.id));
  store.attachments = store.attachments.filter((attachment) => !removedIds.has(attachment.id));
  const referenceCounts = new Map();
  for (const attachment of store.attachments) {
    for (const { chatId, id } of attachmentAssetLocations(attachment)) {
      const key = `${chatId}\u0000${id}`;
      referenceCounts.set(key, (referenceCounts.get(key) || 0) + 1);
    }
  }
  const filePaths = new Map();
  for (const attachment of removedAttachments) {
    for (const { chatId, id } of attachmentAssetLocations(attachment)) {
      if ((referenceCounts.get(`${chatId}\u0000${id}`) || 0) > 0) continue;
      const filePath = path.resolve(uploadsRoot, chatId, id);
      if (!filePath.startsWith(`${uploadsRoot}${path.sep}`)) {
        throw new Error("Unsafe attachment path.");
      }
      filePaths.set(filePath, filePath);
    }
  }
  return [...filePaths.values()];
}

async function removeUnreferencedAttachmentFiles(store, removedAttachments, uploadsRoot) {
  const filePaths = removeAttachmentRecords(store, removedAttachments, uploadsRoot);
  for (const filePath of filePaths) await fs.rm(filePath, { force: true });
}

function canReadMessage(store, message, userId) {
  const conversationId = message.conversationId || message.room;
  try {
    return Boolean(findConversation(store, conversationId, userId));
  } catch {
    return false;
  }
}

function visibleMessage(message, store, viewerId = null) {
  const author = store.users.find((user) => user.id === message.authorId);
  const conversationId = message.conversationId || message.room;
  const channel = store.channels.find((item) => item.id === conversationId);
  const conversation = channel || store.conversations.find((item) => item.id === conversationId);
  const otherMemberIds = (conversation?.memberIds || []).filter((memberId) => memberId !== message.authorId);
  const seenByRecipient = viewerId === message.authorId && otherMemberIds.some((memberId) =>
    (conversation.lastReadMessageIds?.[memberId] || 0) >= message.id
  );
  const replyToMessage = message.replyToId
    ? store.messages.find((item) => item.id === message.replyToId) || null
    : null;
  const replyAuthor = replyToMessage
    ? store.users.find((user) => user.id === replyToMessage.authorId)
    : null;
  return {
    id: message.id,
    conversationId,
    chatId: conversationId,
    authorId: message.authorId,
    ...(message.mediaType ? { mediaType: message.mediaType } : {}),
    author: author ? publicUser(author) : message.author || { id: "legacy", username: "system", fullName: "Слово" },
    ...(channel?.postAs === "channel"
      ? { displayAuthor: { id: channel.id, fullName: channel.name, avatarUrl: channel.avatarUrl || null, isChannel: true } }
      : {}),
    text: message.deleted ? "" : message.text,
    sentAt: message.createdAt || message.sentAt,
    createdAt: message.createdAt || message.sentAt,
    editedAt: message.editedAt || null,
    deleted: Boolean(message.deleted),
    seenByRecipient,
    replyTo: replyToMessage ? {
      id: replyToMessage.id,
      author: replyAuthor ? publicUser(replyAuthor) : null,
      text: replyToMessage.deleted ? "" : replyToMessage.text,
      deleted: Boolean(replyToMessage.deleted),
      attachments: replyToMessage.deleted ? [] : (replyToMessage.attachmentIds || [])
        .map((id) => store.attachments.find((attachment) => attachment.id === id))
        .filter(Boolean)
        .map((attachment) => attachment.name)
    } : null,
    forwardedFrom: message.forwardedFrom ? { ...message.forwardedFrom } : null,
    reactions: Object.entries(message.reactions || {})
      .filter(([, userIds]) => Array.isArray(userIds) && userIds.length > 0)
      .map(([emoji, userIds]) => ({
        emoji,
        count: userIds.length,
        reactedByMe: viewerId ? userIds.includes(viewerId) : false
      })),
    ...(message.savedSource ? { savedSource: { ...message.savedSource } } : {}),
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

function parseByteRange(value, size) {
  if (typeof value !== "string" || !value.startsWith("bytes=") || value.includes(",")) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return null;
  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0 || size === 0) return { unsatisfiable: true };
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) {
      return { unsatisfiable: true };
    }
    end = Math.min(end, size - 1);
  }
  return { start, end };
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

function buildConversationSummaryIndex(store, conversations, userId, queryUnreadCount = null, queryLastMessage = null) {
  const conversationsById = new Map(conversations.map((conversation) => [conversation.id, conversation]));
  const summaries = new Map(conversations.map((conversation) => [conversation.id, {
    lastMessage: queryLastMessage ? queryLastMessage(conversation.id) : null,
    unreadCount: conversation.type === "saved" ? 0 : queryUnreadCount
      ? queryUnreadCount(conversation.id, conversation.lastReadMessageIds?.[userId] || 0, userId)
      : 0
  }]));
  if (!queryUnreadCount || !queryLastMessage) {
    for (const message of store.messages) {
      const conversationId = message.conversationId || message.room;
      const conversation = conversationsById.get(conversationId);
      if (!conversation) continue;
      const summary = summaries.get(conversationId);
      if (!queryLastMessage && (!summary.lastMessage || message.id > summary.lastMessage.id)) {
        summary.lastMessage = message;
      }
      if (!queryUnreadCount) {
        const lastReadId = conversation.lastReadMessageIds?.[userId] || 0;
        if (message.id > lastReadId && message.authorId !== userId) summary.unreadCount += 1;
      }
    }
  }
  return summaries;
}

function countUnreadMessages(store, conversation, userId) {
  const lastReadId = conversation.lastReadMessageIds?.[userId] || 0;
  return store.messages.reduce((total, message) =>
    total + ((message.conversationId || message.room) === conversation.id
      && message.id > lastReadId && message.authorId !== userId ? 1 : 0), 0);
}

function conversationSummary(
  store,
  conversation,
  userId,
  summaries = null,
  queryUnreadCount = null,
  queryLastMessage = null
) {
  const indexedSummary = summaries?.get(conversation.id);
  const lastMessage = indexedSummary
    ? indexedSummary.lastMessage
    : queryLastMessage
      ? queryLastMessage(conversation.id)
      : store.messages.findLast((message) => (message.conversationId || message.room) === conversation.id);
  const otherUserId = conversation.memberIds?.find((id) => id !== userId);
  const otherUser = store.users.find((user) => user.id === otherUserId);
  const type = conversation.type || (store.channels.includes(conversation)
    ? "channel"
    : conversation.memberIds?.length === 2
      ? "direct"
      : conversation.memberIds?.length === 1 ? "saved" : "group");
  return {
    id: conversation.id,
    type,
    name: type === "saved" ? null : type === "direct"
      ? otherUser?.fullName || `@${otherUser?.username || ""}`
      : conversation.name,
    username: type === "direct" ? otherUser?.username || null : null,
    avatarUrl: type === "direct" && otherUser
      ? publicUser(otherUser).avatarUrl
      : type === "channel" ? conversation.avatarUrl || null : null,
    description: conversation.description || "",
    memberIds: conversation.memberIds || [],
    joined: conversation.memberIds?.includes(userId) || false,
    unreadCount: type === "saved" ? 0 : indexedSummary
      ? indexedSummary.unreadCount
      : queryUnreadCount
        ? queryUnreadCount(conversation.id, conversation.lastReadMessageIds?.[userId] || 0, userId)
        : countUnreadMessages(store, conversation, userId),
    lastReadMessageId: conversation.lastReadMessageIds?.[userId] || 0,
    lastMessage: lastMessage ? visibleMessage(lastMessage, store, userId) : null,
    createdBy: conversation.createdBy,
    ownerId: conversation.ownerId || conversation.createdBy || null,
    adminIds: conversation.adminIds || [],
    muted: (conversation.mutedUserIds || []).includes(userId),
    role: getChatRole(conversation, userId),
    ...(type === "channel" ? { postAs: conversation.postAs === "channel" ? "channel" : "person" } : {})
  };
}

async function cleanupExpiredData(store, dataDirectory, persist, now = Date.now()) {
  const cutoff = now - ORPHAN_ATTACHMENT_TTL_MS;
  const expiredAttachments = store.attachments.filter((attachment) => {
    const createdAt = Date.parse(attachment.createdAt);
    return !attachment.messageId && Number.isFinite(createdAt) && createdAt < cutoff;
  });
  const uploadsRoot = path.resolve(dataDirectory, "uploads");
  const previous = {
    sessions: store.sessions,
    attachments: store.attachments,
    uploadUsage: store.uploadUsage
  };
  const expiredFiles = removeAttachmentRecords(store, expiredAttachments, uploadsRoot);
  for (const filePath of expiredFiles) await fs.rm(filePath, { force: true });
  store.sessions = store.sessions.filter((session) =>
    Number.isFinite(session.expiresAt) && session.expiresAt > now);
  store.uploadUsage = store.uploadUsage.filter((usage) => {
    const createdAt = Date.parse(usage.createdAt);
    return Number.isFinite(createdAt) && createdAt >= cutoff;
  });
  const changed = store.sessions.length !== previous.sessions.length
    || store.attachments.length !== previous.attachments.length
    || store.uploadUsage.length !== previous.uploadUsage.length;
  if (!changed) return false;
  try {
    await persist(store);
  } catch (error) {
    Object.assign(store, previous);
    throw error;
  }
  return true;
}

function createMessengerServer({
  store = createEmptyStore(),
  saveStore = async () => {},
  dataDirectory = path.join(__dirname, "data"),
  pushSender = sendPushToUser,
  queryUnreadCount = null,
  queryLastMessage = null,
  maintenanceEnabled = false
} = {}) {
  const connectedUsers = new Map();
  const recentEvents = new Map();
  const eventSequences = new Map();
  const viewingClients = new Map();
  const registrationAttempts = new Map();
  let currentStore = normalizeStore(store);
  let maintenanceRunning = false;

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
  const registrationAttemptsCleanupTimer = setInterval(() => {
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const [address, attempts] of registrationAttempts) {
      const recent = attempts.filter((time) => time > cutoff);
      if (recent.length) registrationAttempts.set(address, recent);
      else registrationAttempts.delete(address);
    }
  }, 60 * 1000);
  registrationAttemptsCleanupTimer.unref();
  const maintenanceTimer = maintenanceEnabled
    ? setInterval(() => {
      if (maintenanceRunning) return;
      maintenanceRunning = true;
      void cleanupExpiredData(currentStore, dataDirectory, persist)
        .catch((error) => console.error("Expired data cleanup failed:", error))
        .finally(() => { maintenanceRunning = false; });
    }, 60 * 60 * 1000)
    : null;
  maintenanceTimer?.unref();

  function persist() {
    return saveStore(currentStore);
  }

  function chatSummary(conversation, userId, summaries = null) {
    return conversationSummary(
      currentStore,
      conversation,
      userId,
      summaries,
      queryUnreadCount,
      queryLastMessage
    );
  }

  function broadcast(userId, event, payload) {
    const sequence = (eventSequences.get(userId) || 0) + 1;
    eventSequences.set(userId, sequence);
    const item = { id: sequence, event, data: JSON.stringify(payload) };
    const history = recentEvents.get(userId) || [];
    history.push(item);
    if (history.length > 100) history.shift();
    recentEvents.set(userId, history);
    const clients = connectedUsers.get(userId);
    if (!clients) return;
    const data = `id: ${item.id}\nevent: ${item.event}\ndata: ${item.data}\n\n`;
    for (const response of clients) response.write(data);
  }

  const app = express();
  app.disable("x-powered-by");
  app.use((request, response, next) => {
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Security-Policy", "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    if (request.socket.encrypted || process.env.POLUS_COOKIE_SECURE === "true") {
      response.setHeader("Strict-Transport-Security", "max-age=31536000");
    }
    next();
  });
  app.use(express.static(CLIENT_BUILD_DIRECTORY, { index: false }));
  app.use(express.static(path.join(BUILD_DIRECTORY, "public"), { index: false }));
  app.use(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      const ip = getClientAddress(request);

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

      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/profile" || PUBLIC_FILES.has(url.pathname))) {
        const isAppPage = url.pathname === "/" || url.pathname === "/profile";
        const [fallbackFileName, contentType] = isAppPage
          ? [path.join(__dirname, "client", "index.html"), "text/html; charset=utf-8"]
          : PUBLIC_FILES.get(url.pathname);
        const builtIndex = isAppPage ? path.join(CLIENT_BUILD_DIRECTORY, "index.html") : "";
        let contents;
        if (builtIndex) {
          try {
            contents = await fs.readFile(builtIndex);
          } catch (error) {
            if (error.code !== "ENOENT") throw error;
          }
        }
        if (!contents) {
          contents = isAppPage
            ? await fs.readFile(fallbackFileName)
            : await fs.readFile(path.join(__dirname, "public", fallbackFileName));
        }
        response.writeHead(200, {
          "Content-Type": contentType,
          "Cache-Control": contentType.startsWith("text/html") ? "no-store" : "no-cache"
        });
        response.end(contents);
        return;
      }

      if (!url.pathname.startsWith("/api/")) {
        throw new HttpError(404, "Not found.");
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
          const now = Date.now();
          const registrationCutoff = now - 60 * 60 * 1000;
          const recentRegistrations = (registrationAttempts.get(ip) || [])
            .filter((time) => time > registrationCutoff);
          if (recentRegistrations.length >= 5) {
            registrationAttempts.set(ip, recentRegistrations);
            throw new HttpError(429, "Too many registration attempts. Try again later.");
          }
          registrationAttempts.set(ip, [...recentRegistrations, now]);
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
          currentStore.conversations.push(createSavedConversation(user));
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
        const chatId = decodePathComponent(uploadRoute[1]);
        const { type, conversation } = findConversation(currentStore, chatId, user.id);
        if (type === "channel" && !["owner", "admin"].includes(getChatRole(conversation, user.id))) {
          throw new HttpError(403, "Only channel owners and administrators can upload to this channel.");
        }
        const declaredSize = Number(request.headers["content-length"] || 0);
        if (declaredSize > MAX_ATTACHMENT_BYTES) throw new HttpError(413, "Files cannot exceed 100 MB.");
        const name = safeFileName(decodePathComponent(String(request.headers["x-file-name"] || "file")));
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
          mimeType: (() => {
            const detectedType = sniffMimeType(sniffBuffer);
            const declaredType = String(request.headers["x-file-mime-type"] || "")
              .toLowerCase()
              .split(";", 1)[0]
              .trim();
            return detectedType === "video/webm" && declaredType === "audio/webm"
              || detectedType === "video/mp4" && declaredType === "audio/mp4"
              ? declaredType
              : detectedType;
          })(),
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
        const chatId = decodePathComponent(thumbnailRoute[1]);
        const attachmentId = decodePathComponent(thumbnailRoute[2]);
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
        const attachment = currentStore.attachments.find((item) => item.id === decodePathComponent(attachmentRoute[1]));
        if (!attachment || attachment.authorId !== user.id || attachment.messageId) {
          throw new HttpError(404, "File not found.");
        }
        const uploadsRoot = path.resolve(dataDirectory, "uploads");
        await removeUnreferencedAttachmentFiles(currentStore, [attachment], uploadsRoot);
        await persist();
        sendJson(response, 200, { ok: true });
        return;
      }

      if (["GET", "HEAD"].includes(request.method) && attachmentRoute) {
        const attachment = currentStore.attachments.find((item) => item.id === decodePathComponent(attachmentRoute[1]));
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
        const storageChatId = isThumbnail
          ? attachment.thumbnailStorageChatId || attachment.storageChatId || attachment.chatId
          : attachment.storageChatId || attachment.chatId;
        const storageId = isThumbnail
          ? attachment.thumbnailStorageId || storedId
          : attachment.storageId || storedId;
        const filePath = path.resolve(uploadsRoot, storageChatId, storageId);
        if (!filePath.startsWith(`${uploadsRoot}${path.sep}`)) throw new Error("Unsafe attachment path.");
        let fileHandle;
        try {
          fileHandle = await fs.open(filePath, "r");
        } catch (error) {
          if (error.code === "ENOENT") throw new HttpError(404, "File not found.");
          throw error;
        }
        const fileStats = await fileHandle.stat();
        const range = url.searchParams.has("thumbnail") ? null
          : parseByteRange(request.headers.range, fileStats.size);
        if (range?.unsatisfiable) {
          await fileHandle.close();
          response.writeHead(416, {
            "Content-Range": `bytes */${fileStats.size}`,
            "Accept-Ranges": "bytes",
            "Content-Length": "0",
            "Cache-Control": "private, no-store"
          });
          response.end();
          return;
        }
        const safeInline = isThumbnail
          || /^(image\/(jpeg|png|gif|webp)|audio\/(mpeg|ogg|wav|webm|mp4)|video\/(mp4|webm))$/.test(attachment.mimeType);
        const disposition = url.searchParams.get("download") === "1" || !safeInline ? "attachment" : "inline";
        const encodedName = encodeURIComponent(attachment.name).replace(/['()*]/g, (character) =>
          `%${character.charCodeAt(0).toString(16).toUpperCase()}`
        );
        const start = range ? range.start : 0;
        const end = range ? range.end : fileStats.size - 1;
        const status = range ? 206 : 200;
        const responseHeaders = {
          "Content-Type": safeInline ? mimeType : "application/octet-stream",
          "Content-Length": range ? end - start + 1 : fileStats.size,
          "Content-Disposition": `${disposition}; filename*=UTF-8''${encodedName}`,
          "X-Content-Type-Options": "nosniff",
          "Accept-Ranges": "bytes",
          "Cache-Control": "private, no-store"
        };
        if (range) responseHeaders["Content-Range"] = `bytes ${start}-${end}/${fileStats.size}`;
        response.writeHead(status, responseHeaders);
        if (request.method === "HEAD") {
          await fileHandle.close();
          response.end();
          return;
        }
        const fileStream = fileHandle.createReadStream(range ? { start, end } : {});
        fileStream.on("close", () => { void fileHandle.close().catch((error) => console.error("Attachment close failed:", error)); });
        fileStream.pipe(response);
        return;
      }

      const avatarRoute = /^\/api\/avatars\/([^/]+)$/.exec(url.pathname);
      if (request.method === "GET" && avatarRoute) {
        const target = currentStore.users.find((candidate) => candidate.id === decodePathComponent(avatarRoute[1]));
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
        const username = decodePathComponent(profileRoute[1]).replace(/^@/, "").toLowerCase();
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
        const username = decodePathComponent(blockRoute[1]).replace(/^@/, "").toLowerCase();
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
        const chatId = decodePathComponent(muteRoute[1]);
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
        const chatId = decodePathComponent(url.pathname.split("/")[3]);
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
        const chatId = decodePathComponent(searchRoute[1]);
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
            results.push(visibleMessage(message, currentStore, user.id));
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
        const userConversations = [
          ...currentStore.channels,
          ...currentStore.conversations.filter((conversation) => conversation.memberIds.includes(user.id))
        ];
        const summaryIndex = buildConversationSummaryIndex(
          currentStore, userConversations, user.id, queryUnreadCount, queryLastMessage
        );
        const channels = currentStore.channels
          .map((channel) => chatSummary(channel, user.id, summaryIndex));
        const directs = currentStore.conversations
          .filter((conversation) => conversation.memberIds.includes(user.id))
          .map((conversation) => chatSummary(conversation, user.id, summaryIndex));
        sendJson(response, 200, {
          user: { ...publicUser(user), hideNotificationContent: user.hideNotificationContent === true },
          channels,
          directs,
          privacyVersion: PRIVACY_VERSION,
          vapidPublicKey: currentStore.vapidKeys?.publicKey || null
        });
        return;
      }

      const chatRoute = /^\/api\/chats\/([^/]+)(?:\/(members|admins|owner|leave|settings))?(?:\/([^/]+))?$/.exec(url.pathname);
      if (chatRoute) {
        const chatId = decodePathComponent(chatRoute[1]);
        const section = chatRoute[2] || "";
        const targetId = chatRoute[3] ? decodePathComponent(chatRoute[3]) : "";
        const chat = getChatRecord(currentStore, chatId);
        const role = chat ? getChatRole(chat, user.id) : null;
        if (!chat || !role) throw new HttpError(404, "Chat not found.");
        const chatType = currentStore.channels.includes(chat) ? "channel" : chat.type || "group";
        if (chatType === "saved") throw new HttpError(400, "Saved Messages cannot be managed.");
        if (chatType === "direct") throw new HttpError(400, "Direct chats cannot be managed.");

        if (request.method === "GET" && !section) {
          sendJson(response, 200, {
            chat: chatSummary(chat, user.id),
            members: chat.memberIds.map((memberId) => {
              const member = currentStore.users.find((candidate) => candidate.id === memberId);
              return member ? { ...publicUser(member), role: getChatRole(chat, memberId) } : null;
            }).filter(Boolean)
          });
          return;
        }

        if (request.method === "PUT" && section === "settings" && !targetId) {
          requireChatRole(chat, user.id, ["owner"]);
          if (chatType !== "channel") throw new HttpError(400, "Only channel settings can be changed here.");
          const input = await readJsonBody(request);
          if (input.postAs !== "channel" && input.postAs !== "person") {
            throw new HttpError(400, "Post identity must be channel or person.");
          }
          chat.postAs = input.postAs;
          await persist();
          broadcastChatMembers(chat, "chat-updated", { chatId, action: "settings-changed" }, broadcast);
          sendJson(response, 200, { chat: chatSummary(chat, user.id) });
          return;
        }

        if (request.method === "POST" && section === "members" && !targetId) {
          requireChatRole(chat, user.id, ["owner", "admin"]);
          const input = await readJsonBody(request);
          const username = cleanText(input.username, 32).replace(/^@/, "").toLowerCase();
          const invitee = currentStore.users.find((candidate) => candidate.username === username);
          if (!invitee) throw new HttpError(404, "User not found.");
          if (chat.memberIds.includes(invitee.id)) {
            sendJson(response, 200, { chat: chatSummary(chat, user.id), added: false });
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
          sendJson(response, 201, { chat: chatSummary(chat, user.id), added: true });
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
          sendJson(response, 200, { chat: chatSummary(chat, user.id) });
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
          sendJson(response, 200, { chat: chatSummary(chat, user.id) });
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
          const removed = removeChatData(currentStore, chatId);
          const uploadsRoot = path.resolve(dataDirectory, "uploads");
          await removeUnreferencedAttachmentFiles(currentStore, removed.removedAttachments, uploadsRoot);
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
          currentStore.sessions = currentStore.sessions.filter((session) =>
            session.userId !== user.id || session.id === auth.session.id
          );
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
        sendJson(response, 201, chatSummary(channel, user.id));
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
        sendJson(response, 201, chatSummary(conversation, user.id));
        return;
      }

      if (request.method === "POST" && /^\/api\/channels\/[^/]+\/join$/.test(url.pathname)) {
        const id = decodePathComponent(url.pathname.split("/")[3]);
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
        sendJson(response, 200, chatSummary(channel, user.id));
        return;
      }

      if (request.method === "POST" && /^\/api\/directs\/[^/]+$/.test(url.pathname)) {
        const input = await readJsonBody(request);
        const username = cleanText(input.username || decodePathComponent(url.pathname.split("/")[3]), 32)
          .replace(/^@/, "").toLowerCase();
        const otherUser = currentStore.users.find((candidate) => candidate.username === username);
        if (!otherUser) throw new HttpError(404, "User not found.");
        if (otherUser.id === user.id) throw new HttpError(400, "You cannot message yourself.");
        const conversation = findDirectConversation(currentStore, user.id, otherUser.id);
        if (conversation) {
          sendJson(response, 200, chatSummary(conversation, user.id));
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
        const readThrough = conversation.lastReadMessageIds[user.id];
        for (const memberId of conversation.memberIds) {
          if (memberId !== user.id) {
            broadcast(memberId, "messages-read", {
              conversationId: conversation.id,
              readerId: user.id,
              lastReadMessageId: readThrough
            });
          }
        }
        sendJson(response, 200, {
          ok: true,
          lastReadMessageId: readThrough,
          unreadCount: 0
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
          .map((message) => visibleMessage(message, currentStore, user.id));
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
        const mediaType = input.mediaType === undefined || input.mediaType === null
          ? null
          : input.mediaType;
        const attachmentIds = Array.isArray(input.attachmentIds)
          ? [...new Set(input.attachmentIds.filter((id) => typeof id === "string"))]
          : [];
        if (mediaType !== null && mediaType !== "voice") {
          throw new HttpError(400, "Invalid message media type.");
        }
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
        const replyToId = input.replyToId === undefined || input.replyToId === null
          ? null
          : Number(input.replyToId);
        if (replyToId !== null) {
          if (!Number.isSafeInteger(replyToId) || replyToId <= 0) {
            throw new HttpError(400, "Invalid reply target.");
          }
          const replyTarget = currentStore.messages.find((item) => item.id === replyToId);
          if (!replyTarget || (replyTarget.conversationId || replyTarget.room) !== chatId
            || !canReadMessage(currentStore, replyTarget, user.id)) {
            throw new HttpError(404, "Reply target not found.");
          }
        }
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
        if (mediaType === "voice" && (attachments.length !== 1
          || !attachments[0].mimeType.startsWith("audio/"))) {
          throw new HttpError(400, "A voice message must contain one audio file.");
        }
        messageAttempts.set(user.id, [...recentAttempts, now]);
        const createdAt = new Date(now).toISOString();
        const message = {
          id: currentStore.nextMessageId++,
          conversationId: chatId,
          authorId: user.id,
          text,
          ...(mediaType ? { mediaType } : {}),
          createdAt,
          sentAt: createdAt,
          deleted: false,
          attachmentIds,
          ...(replyToId ? { replyToId } : {})
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
          const previousUnreadCount = Number(conversation.unreadCounts[recipientId]) || 0;
          conversation.unreadCounts[recipientId] = previousUnreadCount
            + (recipientId !== user.id
              && message.id > (conversation.lastReadMessageIds[recipientId] || 0) ? 1 : 0);
        }
        await persist();
        const safeMessage = visibleMessage(message, currentStore, user.id);
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
          conversation: chatSummary(conversation, user.id)
        });
        return;
      }

      const saveMessageRoute = /^\/api\/messages\/([^/]+)\/save$/.exec(url.pathname);
      if (request.method === "POST" && saveMessageRoute) {
        const sourceMessage = currentStore.messages.find((item) => item.id === Number(decodePathComponent(saveMessageRoute[1])));
        if (!sourceMessage || sourceMessage.deleted) throw new HttpError(404, "Message not found.");
        const sourceChatId = sourceMessage.conversationId || sourceMessage.room;
        const { type: sourceType, conversation: sourceChat } = findConversation(currentStore, sourceChatId, user.id);
        if (sourceType === "saved") throw new HttpError(400, "Messages already in Saved Messages cannot be saved again.");

        const now = Date.now();
        const recentAttempts = (messageAttempts.get(user.id) || [])
          .filter((time) => now - time < MESSAGE_RATE_WINDOW_MS);
        if (recentAttempts.length >= MAX_MESSAGES_PER_MINUTE) {
          messageAttempts.set(user.id, recentAttempts);
          throw new HttpError(429, "You can send at most 20 messages per minute.");
        }

        const savedChat = currentStore.conversations.find((item) => item.id === `saved_${user.id}`);
        if (!savedChat || savedChat.type !== "saved" || savedChat.ownerId !== user.id) {
          throw new HttpError(404, "Chat not found.");
        }
        const sourceAttachments = (sourceMessage.attachmentIds || []).map((attachmentId) =>
          currentStore.attachments.find((attachment) => attachment.id === attachmentId
            && attachment.chatId === sourceChatId && attachment.messageId === sourceMessage.id)
        );
        if (sourceAttachments.some((attachment) => !attachment)) {
          throw new HttpError(404, "Message not found.");
        }
        messageAttempts.set(user.id, [...recentAttempts, now]);
        const createdAt = new Date(now).toISOString();
        const savedMessageId = currentStore.nextMessageId++;
        const copiedAttachmentIds = sourceAttachments.map(() => randomId());
        const copiedAttachments = sourceAttachments.map((attachment, index) => ({
          ...attachment,
          id: copiedAttachmentIds[index],
          chatId: savedChat.id,
          messageId: savedMessageId,
          authorId: user.id,
          createdAt,
          storageId: attachment.storageId || attachment.id,
          storageChatId: attachment.storageChatId || attachment.chatId,
          ...(attachment.thumbnailId ? {
            thumbnailStorageId: attachment.thumbnailStorageId || attachment.thumbnailId,
            thumbnailStorageChatId: attachment.thumbnailStorageChatId
              || attachment.storageChatId
              || attachment.chatId
          } : {})
        }));
        const sourceVisible = visibleMessage(sourceMessage, currentStore, user.id);
        const sourceAuthor = sourceVisible.displayAuthor || sourceVisible.author;
        const sourceName = chatSummary(sourceChat, user.id).name || sourceChat.name || "";
        const message = {
          id: savedMessageId,
          conversationId: savedChat.id,
          authorId: user.id,
          text: sourceMessage.text || "",
          ...(sourceMessage.mediaType ? { mediaType: sourceMessage.mediaType } : {}),
          createdAt,
          sentAt: createdAt,
          deleted: false,
          attachmentIds: copiedAttachmentIds,
          savedSource: {
            chatName: sourceName,
            authorName: sourceAuthor.fullName || sourceAuthor.username || "",
            authorUsername: sourceAuthor.username || ""
          }
        };
        currentStore.attachments.push(...copiedAttachments);
        currentStore.links.push(...currentStore.links
          .filter((link) => link.messageId === sourceMessage.id && link.chatId === sourceChatId)
          .map((link) => ({
            ...link,
            id: randomId(),
            chatId: savedChat.id,
            messageId: savedMessageId,
            authorId: user.id,
            createdAt
          })));
        currentStore.messages.push(message);
        savedChat.unreadCounts = {};
        await persist();
        const safeMessage = visibleMessage(message, currentStore, user.id);
        broadcast(user.id, "message", safeMessage);
        sendJson(response, 201, {
          ...safeMessage,
          conversation: chatSummary(savedChat, user.id)
        });
        return;
      }

      const forwardMessageRoute = /^\/api\/messages\/([^/]+)\/forward$/.exec(url.pathname);
      if (request.method === "POST" && forwardMessageRoute) {
        const sourceMessage = currentStore.messages.find((item) =>
          item.id === Number(decodePathComponent(forwardMessageRoute[1]))
        );
        if (!sourceMessage || sourceMessage.deleted || !canReadMessage(currentStore, sourceMessage, user.id)) {
          throw new HttpError(404, "Message not found.");
        }
        const input = await readJsonBody(request);
        const conversationId = cleanText(input.conversationId, 100);
        const recipientUsername = cleanText(input.recipientUsername, 32).replace(/^@/, "").toLowerCase();
        if (Boolean(conversationId) === Boolean(recipientUsername)) {
          throw new HttpError(400, "Choose one destination.");
        }
        const recentAttempts = (messageAttempts.get(user.id) || [])
          .filter((time) => Date.now() - time < MESSAGE_RATE_WINDOW_MS);
        if (recentAttempts.length >= MAX_MESSAGES_PER_MINUTE) {
          messageAttempts.set(user.id, recentAttempts);
          throw new HttpError(429, "You can send at most 20 messages per minute.");
        }
        const sourceChatId = sourceMessage.conversationId || sourceMessage.room;
        const sourceAttachments = (sourceMessage.attachmentIds || []).map((attachmentId) =>
          currentStore.attachments.find((attachment) => attachment.id === attachmentId
            && attachment.chatId === sourceChatId && attachment.messageId === sourceMessage.id)
        );
        if (sourceAttachments.some((attachment) => !attachment)) {
          throw new HttpError(404, "Message not found.");
        }
        let targetChatId = conversationId;
        if (recipientUsername) {
          const recipient = currentStore.users.find((candidate) => candidate.username === recipientUsername);
          if (!recipient) throw new HttpError(404, "User not found.");
          if (recipient.id === user.id) throw new HttpError(400, "You cannot message yourself.");
          if ((user.blockedUserIds || []).includes(recipient.id)
            || (recipient.blockedUserIds || []).includes(user.id)) {
            throw new HttpError(403, "This user cannot receive your messages.");
          }
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
          targetChatId = direct.id;
        }

        const { type: targetType, conversation: targetChat } =
          findConversation(currentStore, targetChatId, user.id);
        if (targetType === "channel" && !["owner", "admin"].includes(getChatRole(targetChat, user.id))) {
          throw new HttpError(403, "Only channel owners and administrators can post.");
        }
        if (targetType === "direct") {
          const otherUserId = targetChat.memberIds.find((memberId) => memberId !== user.id);
          const otherUser = currentStore.users.find((candidate) => candidate.id === otherUserId);
          if ((user.blockedUserIds || []).includes(otherUserId)
            || (otherUser?.blockedUserIds || []).includes(user.id)) {
            throw new HttpError(403, "This user cannot receive your messages.");
          }
        }
        messageAttempts.set(user.id, [...recentAttempts, Date.now()]);
        const createdAt = new Date().toISOString();
        const forwardedMessageId = currentStore.nextMessageId++;
        const forwardedAttachmentIds = sourceAttachments.map(() => randomId());
        const forwardedAttachments = sourceAttachments.map((attachment, index) => ({
          ...attachment,
          id: forwardedAttachmentIds[index],
          chatId: targetChatId,
          messageId: forwardedMessageId,
          authorId: user.id,
          createdAt,
          storageId: attachment.storageId || attachment.id,
          storageChatId: attachment.storageChatId || attachment.chatId,
          ...(attachment.thumbnailId ? {
            thumbnailStorageId: attachment.thumbnailStorageId || attachment.thumbnailId,
            thumbnailStorageChatId: attachment.thumbnailStorageChatId
              || attachment.storageChatId
              || attachment.chatId
          } : {})
        }));
        const sourceVisible = visibleMessage(sourceMessage, currentStore, user.id);
        const sourceAuthor = sourceVisible.displayAuthor || sourceVisible.author;
        const sourceChat = getChatRecord(currentStore, sourceChatId);
        const { type: sourceType } = findConversation(currentStore, sourceChatId, user.id);
        const sourceSummary = sourceChat ? chatSummary(sourceChat, user.id) : null;
        const message = {
          id: forwardedMessageId,
          conversationId: targetChatId,
          authorId: user.id,
          text: sourceMessage.text || "",
          ...(sourceMessage.mediaType ? { mediaType: sourceMessage.mediaType } : {}),
          createdAt,
          sentAt: createdAt,
          deleted: false,
          attachmentIds: forwardedAttachmentIds,
          forwardedFrom: {
            chatName: sourceSummary?.name || "",
            chatType: sourceType,
            authorName: sourceAuthor.fullName || sourceAuthor.username || "",
            authorUsername: sourceAuthor.username || ""
          }
        };
        currentStore.attachments.push(...forwardedAttachments);
        currentStore.links.push(...currentStore.links
          .filter((link) => link.messageId === sourceMessage.id && link.chatId === sourceChatId)
          .map((link) => ({
            ...link,
            id: randomId(),
            chatId: targetChatId,
            messageId: forwardedMessageId,
            authorId: user.id,
            createdAt
          })));
        currentStore.messages.push(message);
        for (const recipientId of targetChat.memberIds) {
          targetChat.unreadCounts = targetChat.unreadCounts || {};
          targetChat.lastReadMessageIds = targetChat.lastReadMessageIds || {};
          const previousUnreadCount = Number(targetChat.unreadCounts[recipientId]) || 0;
          targetChat.unreadCounts[recipientId] = previousUnreadCount
            + (recipientId !== user.id
              && forwardedMessageId > (targetChat.lastReadMessageIds[recipientId] || 0) ? 1 : 0);
        }
        await persist();
        const safeMessage = visibleMessage(message, currentStore, user.id);
        for (const recipientId of targetChat.memberIds) {
          broadcast(recipientId, "message", safeMessage);
          if (recipientId !== user.id
            && !(targetChat.mutedUserIds || []).includes(recipientId)
            && !isUserViewingChat(recipientId, targetChatId)) {
            const recipient = currentStore.users.find((candidate) => candidate.id === recipientId);
            pushSender(currentStore, recipientId, safeMessage, persist, {
              hideContent: recipient?.hideNotificationContent === true
            }).catch((error) => console.error("Push notification failed:", error));
          }
        }
        sendJson(response, 201, {
          ...safeMessage,
          conversation: chatSummary(targetChat, user.id)
        });
        return;
      }

      const reactToMessageRoute = /^\/api\/messages\/([^/]+)\/reactions$/.exec(url.pathname);
      if (request.method === "POST" && reactToMessageRoute) {
        const id = Number(decodePathComponent(reactToMessageRoute[1]));
        const message = currentStore.messages.find((item) => item.id === id);
        if (!message || message.deleted || !canReadMessage(currentStore, message, user.id)) {
          throw new HttpError(404, "Message not found.");
        }
        const input = await readJsonBody(request);
        if (typeof input.emoji !== "string" || !MESSAGE_REACTIONS.has(input.emoji)) {
          throw new HttpError(400, "Unsupported reaction.");
        }
        const reactions = message.reactions && typeof message.reactions === "object"
          ? message.reactions
          : {};
        const userIds = Array.isArray(reactions[input.emoji]) ? reactions[input.emoji] : [];
        message.reactions = { ...reactions };
        if (userIds.includes(user.id)) {
          message.reactions[input.emoji] = userIds.filter((userId) => userId !== user.id);
          if (message.reactions[input.emoji].length === 0) delete message.reactions[input.emoji];
        } else {
          message.reactions[input.emoji] = [...userIds, user.id];
        }
        await persist();
        const conversationId = message.conversationId || message.room;
        const { conversation } = findConversation(currentStore, conversationId, user.id);
        for (const recipientId of conversation.memberIds) {
          broadcast(recipientId, "message-updated", visibleMessage(message, currentStore, recipientId));
        }
        sendJson(response, 200, visibleMessage(message, currentStore, user.id));
        return;
      }

      if (request.method === "PATCH" && /^\/api\/messages\/[^/]+$/.test(url.pathname)) {
        const id = decodePathComponent(url.pathname.split("/")[3]);
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
        const { conversation } = findConversation(currentStore, targetMessage.conversationId, user.id);
        for (const recipientId of conversation.memberIds) {
          broadcast(recipientId, "message-updated", visibleMessage(targetMessage, currentStore, recipientId));
        }
        const safeMessage = visibleMessage(targetMessage, currentStore, user.id);
        sendJson(response, 200, safeMessage);
        return;
      }

      if (request.method === "DELETE" && /^\/api\/messages\/[^/]+$/.test(url.pathname)) {
        const id = decodePathComponent(url.pathname.split("/")[3]);
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
        message.reactions = {};
        const uploadsRoot = path.resolve(dataDirectory, "uploads");
        await removeUnreferencedAttachmentFiles(currentStore, removedAttachments, uploadsRoot);
        currentStore.links = currentStore.links.filter((link) => link.messageId !== message.id);
        await persist();
        for (const recipientId of conversation.memberIds) {
          broadcast(recipientId, "message-deleted", visibleMessage(message, currentStore, recipientId));
        }
        const payload = visibleMessage(message, currentStore, user.id);
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
        const lastEventId = /^\d+$/.test(request.headers["last-event-id"] || "")
          ? Number(request.headers["last-event-id"])
          : null;
        const sequence = eventSequences.get(user.id) || 0;
        const history = recentEvents.get(user.id) || [];
        if (lastEventId !== null) {
          const oldestId = history[0]?.id ?? sequence + 1;
          if (!Number.isSafeInteger(lastEventId) || lastEventId > sequence || lastEventId < oldestId - 1) {
            response.write(`id: ${sequence}\nevent: resync\ndata: {}\n\n`);
          } else {
            for (const item of history) {
              if (item.id > lastEventId) {
                response.write(`id: ${item.id}\nevent: ${item.event}\ndata: ${item.data}\n\n`);
              }
            }
          }
        }
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
        const trustedPushHosts = [
          "fcm.googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com"
        ];
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

  const server = http.createServer(app);
  server.on("close", () => {
    clearInterval(presenceCleanupTimer);
    clearInterval(registrationAttemptsCleanupTimer);
    if (maintenanceTimer) clearInterval(maintenanceTimer);
  });
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
  await fs.mkdir(DATA_DIRECTORY, { recursive: true });
  const { database, store } = await loadSqliteStore(DATABASE_FILE, LEGACY_DATA_FILE);
  if (!store.vapidKeys) store.vapidKeys = webpush.generateVAPIDKeys();
  const contact = process.env.POLUS_PUSH_CONTACT || "mailto:admin@example.com";
  webpush.setVapidDetails(contact, store.vapidKeys.publicKey, store.vapidKeys.privateKey);

  const saveStore = createSqliteStoreWriter(database, store);
  await cleanupExpiredData(store, DATA_DIRECTORY, saveStore);
  await saveStore(store);
  const server = createMessengerServer({
    store,
    saveStore,
    queryUnreadCount: saveStore.countUnreadMessages,
    queryLastMessage: saveStore.lastMessageForChat,
    maintenanceEnabled: true
  });
  server.on("close", () => database.close());
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
  cleanupExpiredData,
  createPushPayload,
  createSqliteStoreWriter,
  createStoreWriter,
  getLanAddresses,
  migrateLegacyChannelData,
  normalizeStore,
  loadStore,
  loadSqliteStore,
  writeStoreAtomically,
  sendPushToUser,
  PRIVACY_VERSION
};