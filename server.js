const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const express = require("express");
const webpush = require("web-push");

try {
  process.loadEnvFile(path.join(__dirname, ".env"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

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
const loginAttemptsByUsername = new Map();
const loginAttemptsCleanup = setInterval(() => {
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const attemptsByKey of [loginAttempts, loginAttemptsByUsername]) {
    for (const [key, attempts] of attemptsByKey) {
      const recent = attempts.filter((time) => time > cutoff);
      if (recent.length) attemptsByKey.set(key, recent);
      else attemptsByKey.delete(key);
    }
  }
}, 60 * 1000);
loginAttemptsCleanup.unref();
function normalizeIpAddress(address) {
  const value = String(address || "").trim().toLowerCase();
  const mappedIpv4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value);
  if (mappedIpv4 && net.isIP(mappedIpv4[1]) === 4) return mappedIpv4[1];
  return net.isIP(value) ? value : "";
}

const trustedProxyAddresses = new Set((process.env.POLUS_TRUSTED_PROXIES || "")
  .split(",").map(normalizeIpAddress).filter(Boolean));
const MAX_LOGIN_FAILURES = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_MESSAGES_PER_MINUTE = 20;
const MESSAGE_RATE_WINDOW_MS = 60 * 1000;
const MESSAGE_EDIT_WINDOW_MS = 48 * 60 * 60 * 1000;
const MESSAGE_PAGE_SIZE = 50;
const EVENT_HISTORY_TTL_MS = 24 * 60 * 60 * 1000;
const MESSAGE_REACTIONS = new Set([
  "👍", "❤️", "😂", "😮", "😢", "👏", "🔥", "🎉", "😍", "🤔", "🙏", "💯",
  "✅", "👎", "😎", "🥳", "😭", "😡", "🤯", "🥰", "🤩", "🤗", "😴", "🙌",
  "💪", "👀", "🌹", "🎂", "💔", "✨", "🤝", "🫡", "😱", "😅", "😊", "😇",
  "🤮", "😷", "💩", "🐱", "🐶", "🍕", "☕", "⚡", "🚀", "🎈", "🌟", "💡"
]);
const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
const MAX_ENCRYPTED_ATTACHMENT_OVERHEAD_BYTES = 16 * Math.ceil(MAX_ATTACHMENT_BYTES / (1024 * 1024));
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

async function readJsonBody(request, { allowEmpty = false } = {}) {
  const parts = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new HttpError(413, "Request body is too large.");
    }
    parts.push(buffer);
  }
  const body = Buffer.concat(parts).toString("utf8");
  if (!body && allowEmpty) return {};
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

const {
  createEmptyStore,
  createSavedConversation,
  createSqliteStoreWriter,
  getLanAddresses,
  loadSqliteStore,
  loadStore,
  migrateLegacyChannelData,
  normalizeStore
} = require("./server/store");

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    about: user.about || "",
    avatarUrl: user.avatarId
      ? `/api/avatars/${encodeURIComponent(user.id)}?v=${encodeURIComponent(user.avatarId)}`
      : null,
    profileCoverUrl: user.profileCoverId
      ? `/api/profile-covers/${encodeURIComponent(user.id)}?v=${encodeURIComponent(user.profileCoverId)}`
      : null,
    profileCoverMimeType: user.profileCoverId ? user.profileCoverMimeType || null : null,
    profileDesign: normalizeProfileDesign(user.profileDesign),
    showOnlineStatus: user.showOnlineStatus !== false
  };
}

function normalizeProfileDesign(value) {
  const design = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const theme = ["aurora", "ocean", "sunset"].includes(design.theme) ? design.theme : "aurora";
  const gradientDefaults = theme === "ocean"
    ? { start: "#dff7f8", end: "#b9dbe8" }
    : theme === "sunset"
      ? { start: "#fff0df", end: "#e9c2c9" }
      : { start: "#101927", end: "#344f82" };
  return {
    theme,
    accentColor: typeof design.accentColor === "string" && /^#[\da-f]{6}$/i.test(design.accentColor)
      ? design.accentColor.toLowerCase()
      : "#4d83d1",
    font: ["system", "serif", "rounded"].includes(design.font) ? design.font : "system",
    motionEnabled: design.motionEnabled !== false,
    gradientStart: typeof design.gradientStart === "string" && /^#[\da-f]{6}$/i.test(design.gradientStart)
      ? design.gradientStart.toLowerCase()
      : gradientDefaults.start,
    gradientEnd: typeof design.gradientEnd === "string" && /^#[\da-f]{6}$/i.test(design.gradientEnd)
      ? design.gradientEnd.toLowerCase()
      : gradientDefaults.end,
    gradientDirection: ["diagonal", "horizontal", "vertical"].includes(design.gradientDirection)
      ? design.gradientDirection
      : "diagonal",
    effects: ["none", "glow", "particles"].includes(design.effects) ? design.effects : "glow",
    avatarFrame: ["gradient", "glow", "double", "none"].includes(design.avatarFrame)
      ? design.avatarFrame
      : "gradient",
    animation: ["subtle", "float", "gradient", "none"].includes(design.animation)
      ? design.animation
      : "subtle",
    backgroundImageEnabled: design.backgroundImageEnabled === true,
    coverParallax: design.coverParallax === true
  };
}

function getSession(request, store) {
  const accountKey = request.headers["x-polus-account"] || "";
  if (accountKey && !/^[a-f0-9]{32}$/.test(accountKey)) return null;
  const cookieName = accountKey ? `polus_session_${accountKey}` : "polus_session";
  const token = cookieValue(request, cookieName);
  if (!token) return null;
  const hash = tokenHash(token);
  const accountKeyHash = accountKey ? tokenHash(accountKey) : null;
  const session = store.sessions.find((item) => item.tokenHash === hash && item.expiresAt > Date.now()
    && (item.accountKeyHash || null) === accountKeyHash);
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

function expiredSessionCookie(request, accountKey) {
  const cookieName = accountKey ? `polus_session_${accountKey}` : "polus_session";
  const secure = request.socket.encrypted || process.env.POLUS_COOKIE_SECURE === "true";
  return `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? "; Secure" : ""}`;
}

async function secureDataDirectory(directoryPath) {
  await fs.mkdir(directoryPath, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") await fs.chmod(directoryPath, 0o700);
}

async function secureDataFile(filePath) {
  try {
    if (process.platform !== "win32") await fs.chmod(filePath, 0o600);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function makeSession(request, store, user, accountKey = "") {
  if (accountKey && !/^[a-f0-9]{32}$/.test(accountKey)) {
    throw new HttpError(400, "Invalid account key.");
  }
  const token = crypto.randomBytes(32).toString("base64url");
  const cookieName = accountKey ? `polus_session_${accountKey}` : "polus_session";
  const session = {
    id: randomId(),
    tokenHash: tokenHash(token),
    userId: user.id,
    ...(accountKey ? { accountKeyHash: tokenHash(accountKey) } : {}),
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS
  };
  store.sessions.push(session);
  return { session, cookie: `${cookieName}=${encodeURIComponent(token)}; ${cookieOptions(request)}` };
}

function getClientAddress(request, trustedProxies = trustedProxyAddresses) {
  const remoteAddress = normalizeIpAddress(request.socket.remoteAddress) || "unknown";
  if (!trustedProxies.has(remoteAddress)) return remoteAddress;
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded !== "string") return remoteAddress;
  const addresses = forwarded.split(",").map(normalizeIpAddress);
  if (!addresses.length || addresses.some((address) => !address)) return remoteAddress;
  let clientAddress = remoteAddress;
  for (let index = addresses.length - 1; index >= 0 && trustedProxies.has(clientAddress); index -= 1) {
    clientAddress = addresses[index];
  }
  return clientAddress;
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

function findReadableConversation(store, id, userId) {
  const channel = store.channels.find((item) => item.id === id);
  if (channel && !channel.isPrivate) return { type: "channel", conversation: channel };
  return findConversation(store, id, userId);
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

function canAccessChat(store, chatId, userId) {
  const chat = getChatRecord(store, chatId);
  return Boolean(chat && getChatRole(chat, userId));
}

function requireChatRole(chat, userId, allowedRoles) {
  const role = getChatRole(chat, userId);
  if (!role) throw new HttpError(404, "Chat not found.");
  if (!allowedRoles.includes(role)) throw new HttpError(403, "You do not have permission to manage this chat.");
  return role;
}

const CHANNEL_ADMIN_PERMISSION_KEYS = ["publish", "editMessages", "deleteMessages"];

function getChannelAdminPermissions(chat, userId) {
  const permissions = chat.adminPermissions?.[userId] || {};
  return Object.fromEntries(CHANNEL_ADMIN_PERMISSION_KEYS.map((key) => [key, permissions[key] !== false]));
}

function hasChannelPermission(chat, userId, permission) {
  const role = getChatRole(chat, userId);
  if (role === "owner") return true;
  return role === "admin" && getChannelAdminPermissions(chat, userId)[permission] === true;
}

function requireChannelPermission(chat, userId, permission, action) {
  if (!hasChannelPermission(chat, userId, permission)) {
    throw new HttpError(403, `You do not have permission to ${action} in this channel.`);
  }
}

function findDirectConversation(store, firstUserId, secondUserId) {
  const memberIds = [firstUserId, secondUserId].sort();
  return store.conversations.find((conversation) =>
    (conversation.type === "direct" || (!conversation.type && conversation.memberIds.length === 2))
    && conversation.memberIds.length === 2
    && conversation.memberIds.every((memberId, index) => memberId === memberIds[index])
  ) || null;
}

function cleanupExpiredEventHistory(recentEvents, eventSequences, connectedUsers, cutoff) {
  let removed = 0;
  for (const [userId, history] of recentEvents) {
    if (connectedUsers.has(userId) || history.at(-1)?.createdAt > cutoff) continue;
    recentEvents.delete(userId);
    eventSequences.delete(userId);
    removed += 1;
  }
  for (const userId of eventSequences.keys()) {
    if (!connectedUsers.has(userId) && !recentEvents.has(userId)) {
      eventSequences.delete(userId);
    }
  }
  return removed;
}

function closeSessionStreams(sessionStreams, sessionId) {
  const responses = sessionStreams.get(sessionId);
  if (!responses) return 0;
  sessionStreams.delete(sessionId);
  for (const response of responses) response.end();
  return responses.size;
}

function closeExpiredSessionStreams(sessionStreams, sessions, now = Date.now()) {
  const activeSessionIds = new Set(sessions
    .filter((session) => session.expiresAt > now)
    .map((session) => session.id));
  let closed = 0;
  for (const sessionId of sessionStreams.keys()) {
    if (!activeSessionIds.has(sessionId)) {
      closed += closeSessionStreams(sessionStreams, sessionId);
    }
  }
  return closed;
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

function unhideChatForMembers(store, chat) {
  for (const memberId of chat.memberIds) {
    const member = store.users.find((candidate) => candidate.id === memberId);
    if (member?.hiddenChatIds?.includes(chat.id)) {
      member.hiddenChatIds = member.hiddenChatIds.filter((id) => id !== chat.id);
    }
  }
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
    return Boolean(findReadableConversation(store, conversationId, userId));
  } catch {
    return false;
  }
}

function validEncryptedMessage(text, conversation, store, authorId) {
  const prefix = "polus-e2ee:v2:";
  if (typeof text !== "string" || text.length > 150000 || !text.startsWith(prefix)) return false;
  let packet;
  try {
    packet = JSON.parse(text.slice(prefix.length));
  } catch {
    return false;
  }
  const isBase64 = (value) => typeof value === "string" && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
  const envelopes = packet?.envelopes;
  const context = packet?.context;
  const author = store.users.find((candidate) => candidate.id === context?.senderId);
  if (packet?.version !== 2 || context?.conversationId !== conversation.id
    || context.senderId !== authorId
    || !Number.isSafeInteger(context?.counter) || context.counter <= 0
    || !author?.encryptionPublicKey || packet.senderPublicKey !== author.encryptionPublicKey
    || !author.signingPublicKey || packet.signingPublicKey !== author.signingPublicKey
    || !isBase64(packet?.iv) || Buffer.from(packet.iv, "base64").length !== 12
    || !isBase64(packet?.ciphertext) || !isBase64(packet?.signature)
    || Buffer.from(packet.signature, "base64").length !== 64
    || !envelopes || typeof envelopes !== "object"
    || Array.isArray(envelopes)) return false;
  const recipientIds = Object.keys(envelopes);
  if (recipientIds.length !== conversation.memberIds.length
    || conversation.memberIds.some((memberId) =>
      !store.users.some((candidate) => candidate.id === memberId
        && candidate.encryptionPublicKey && candidate.signingPublicKey)
      || !isBase64(envelopes[memberId])
      || Buffer.from(envelopes[memberId], "base64").length !== 384)
    || recipientIds.some((memberId) => !conversation.memberIds.includes(memberId))) return false;
  try {
    const signingKey = crypto.createPublicKey({
      key: Buffer.from(packet.signingPublicKey, "base64"),
      format: "der",
      type: "spki"
    });
    if (signingKey.asymmetricKeyType !== "ec"
      || signingKey.asymmetricKeyDetails?.namedCurve !== "prime256v1") return false;
    const signedData = JSON.stringify({
      version: packet.version,
      context: packet.context,
      iv: packet.iv,
      ciphertext: packet.ciphertext,
      envelopes: packet.envelopes,
      senderPublicKey: packet.senderPublicKey,
      signingPublicKey: packet.signingPublicKey
    });
    return crypto.verify(
      "sha256",
      Buffer.from(signedData),
      { key: signingKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(packet.signature, "base64")
    );
  } catch {
    return false;
  }
}

function getEncryptedMessageContext(text) {
  try {
    const packet = JSON.parse(text.slice("polus-e2ee:v2:".length));
    return packet.context;
  } catch {
    return null;
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
    ...(message.encrypted ? { signatureAuthorId: message.signatureAuthorId || message.authorId } : {}),
    ...(message.mediaType ? { mediaType: message.mediaType } : {}),
    ...(message.encrypted ? { encrypted: true } : {}),
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
      conversationId: replyToMessage.conversationId || replyToMessage.room,
      authorId: replyToMessage.authorId,
      ...(replyToMessage.encrypted
        ? { signatureAuthorId: replyToMessage.signatureAuthorId || replyToMessage.authorId }
        : {}),
      author: replyAuthor ? publicUser(replyAuthor) : null,
      text: replyToMessage.deleted ? "" : replyToMessage.text,
      sentAt: replyToMessage.createdAt || replyToMessage.sentAt,
      createdAt: replyToMessage.createdAt || replyToMessage.sentAt,
      ...(replyToMessage.encrypted ? { encrypted: true } : {}),
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
  const joined = conversation.memberIds?.includes(userId) || false;
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
    joined,
    unreadCount: type === "saved" || !joined ? 0 : indexedSummary
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
    pinned: (store.users.find((user) => user.id === userId)?.pinnedChatIds || []).includes(conversation.id),
    role: getChatRole(conversation, userId),
    ...(type === "channel" ? {
      postAs: conversation.postAs === "channel" ? "channel" : "person",
      isPrivate: conversation.isPrivate === true
    } : type === "group" ? { isPublic: conversation.isPublic === true } : {})
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
  allowLegacyPlaintext = false,
  maintenanceEnabled = false,
  encryptionKey = process.env.POLUS_ENCRYPTION_KEY || ""
} = {}) {
  const connectedUsers = new Map();
  const sessionStreams = new Map();
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
  const sessionStreamsCleanupTimer = setInterval(() => {
    closeExpiredSessionStreams(sessionStreams, currentStore.sessions);
  }, 15_000);
  sessionStreamsCleanupTimer.unref();
  const eventHistoryCleanupTimer = setInterval(() => {
    cleanupExpiredEventHistory(
      recentEvents,
      eventSequences,
      connectedUsers,
      Date.now() - EVENT_HISTORY_TTL_MS
    );
  }, 60 * 60 * 1000);
  eventHistoryCleanupTimer.unref();
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
    const item = { id: sequence, event, data: JSON.stringify(payload), createdAt: Date.now() };
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
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    response.setHeader("Permissions-Policy", "camera=(), microphone=(self), geolocation=()");
    response.setHeader("Content-Security-Policy", "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
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
      if (url.pathname.startsWith("/api/")
        && ["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
        const origin = request.headers.origin;
        const fetchSite = request.headers["sec-fetch-site"];
        if (typeof origin === "string") {
          let originHost = "";
          let requestHost = "";
          try {
            originHost = new URL(origin).host;
            if (typeof request.headers.host === "string") {
              requestHost = new URL(`http://${request.headers.host}`).host;
            }
          } catch {
            throw new HttpError(403, "Cross-origin request rejected.");
          }
          if (!originHost || !requestHost || originHost.toLowerCase() !== requestHost.toLowerCase()) {
            throw new HttpError(403, "Cross-origin request rejected.");
          }
        }
        if (typeof fetchSite === "string" && !["same-origin", "none"].includes(fetchSite)) {
          throw new HttpError(403, "Cross-origin request rejected.");
        }
      }

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

      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/profile" || url.pathname === "/contacts"
        || /^\/users\/[^/]+$/.test(url.pathname)
        || /^\/channels\/[^/]+(?:\/settings)?$/.test(url.pathname)
        || /^\/groups\/[^/]+\/settings$/.test(url.pathname)
        || /^\/join\/[^/]+$/.test(url.pathname)
        || PUBLIC_FILES.has(url.pathname))) {
        const isAppPage = url.pathname === "/" || url.pathname === "/profile" || url.pathname === "/contacts"
          || /^\/users\/[^/]+$/.test(url.pathname)
          || /^\/channels\/[^/]+(?:\/settings)?$/.test(url.pathname)
          || /^\/groups\/[^/]+\/settings$/.test(url.pathname)
          || /^\/join\/[^/]+$/.test(url.pathname);
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

      if (request.method === "POST" && url.pathname === "/api/auth/accounts/attach") {
        const input = await readJsonBody(request);
        const accountKey = typeof input.accountKey === "string" ? input.accountKey : "";
        if (!/^[a-f0-9]{32}$/.test(accountKey)) throw new HttpError(400, "Invalid account key.");
        const auth = requireAuth(request, currentStore);
        const { session, cookie } = makeSession(request, currentStore, auth.user, accountKey);
        currentStore.sessions = currentStore.sessions.filter((item) => item.id !== auth.session.id);
        await persist();
        closeSessionStreams(sessionStreams, auth.session.id);
        sendJson(response, 200, { user: publicUser(auth.user) }, {
          "Set-Cookie": [
            cookie,
            `polus_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${request.socket.encrypted || process.env.POLUS_COOKIE_SECURE === "true" ? "; Secure" : ""}`
          ]
        });
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
          if (Buffer.byteLength(encryptionKey, "utf8") < 32) {
            throw new HttpError(503, "The server encryption key is not configured. Set POLUS_ENCRYPTION_KEY in .env.");
          }
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
          const hashedPassword = await passwordHash(password);
          if (currentStore.users.some((existing) => existing.username === username)) {
            throw new HttpError(409, "That username is already taken.");
          }
          const user = {
            id: randomId(),
            username,
            fullName,
            about,
            passwordHash: hashedPassword,
            privacyAcceptedAt: new Date().toISOString(),
            privacyVersion: PRIVACY_VERSION,
            createdAt: new Date().toISOString()
          };
          currentStore.users.push(user);
          currentStore.conversations.push(createSavedConversation(user));
          const accountKey = request.headers["x-polus-account"] || "";
          const { cookie } = makeSession(request, currentStore, user, accountKey);
          await persist();
          sendJson(response, 201, { user: publicUser(user) }, { "Set-Cookie": cookie });
          return;
        }

        const attemptKey = `${ip}\u0000${username}`;
        const now = Date.now();
        const recentAttempts = (loginAttempts.get(attemptKey) || [])
          .filter((time) => now - time < LOGIN_WINDOW_MS);
        const recentUsernameAttempts = (loginAttemptsByUsername.get(username) || [])
          .filter((time) => now - time < LOGIN_WINDOW_MS);
        loginAttempts.set(attemptKey, recentAttempts);
        loginAttemptsByUsername.set(username, recentUsernameAttempts);
        if (recentAttempts.length >= MAX_LOGIN_FAILURES
          || recentUsernameAttempts.length >= MAX_LOGIN_FAILURES) {
          throw new HttpError(429, "Too many failed sign-in attempts. Try again in 15 minutes.");
        }
        const user = currentStore.users.find((item) => item.username === username);
        const valid = user && Array.from(password).length > 0 && Array.from(password).length <= 128
          ? await verifyPassword(password, user.passwordHash)
          : (await passwordHash("invalid-login-attempt", "polus-dummy-salt"), false);
        if (!valid) {
          loginAttempts.set(attemptKey, [...recentAttempts, now]);
          loginAttemptsByUsername.set(username, [...recentUsernameAttempts, now]);
          throw new HttpError(401, "Incorrect username or password.");
        }
        loginAttempts.delete(attemptKey);
        loginAttemptsByUsername.delete(username);
        const accountKey = request.headers["x-polus-account"] || "";
        const { cookie } = makeSession(request, currentStore, user, accountKey);
        await persist();
        sendJson(response, 200, { user: publicUser(user) }, { "Set-Cookie": cookie });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/auth/logout") {
        const auth = requireAuth(request, currentStore);
        const body = await readJsonBody(request, { allowEmpty: true });
        const pushEndpoint = typeof body.pushEndpoint === "string" ? body.pushEndpoint : "";
        if (pushEndpoint) {
          currentStore.pushSubscriptions = currentStore.pushSubscriptions.filter(
            (item) => !(item.userId === auth.user.id && item.subscription.endpoint === pushEndpoint)
          );
        }
        currentStore.sessions = currentStore.sessions.filter((item) => item.id !== auth.session.id);
        await persist();
        closeSessionStreams(sessionStreams, auth.session.id);
        const accountKey = request.headers["x-polus-account"] || "";
        sendJson(response, 200, { ok: true }, { "Set-Cookie": expiredSessionCookie(request, accountKey) });
        return;
      }

      const auth = requireAuth(request, currentStore);
      const user = auth.user;

      if (request.method === "GET" && url.pathname === "/api/account/encryption-config") {
        if (Buffer.byteLength(encryptionKey, "utf8") < 32) {
          throw new HttpError(503, "The server encryption key is not configured. Set POLUS_ENCRYPTION_KEY in .env.");
        }
        sendJson(response, 200, { wrappingKey: encryptionKey });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/account/encryption-key") {
        sendJson(response, 200, {
          userId: user.id,
          publicKey: user.encryptionPublicKey || null,
          sealedPrivateKey: user.sealedEncryptionPrivateKey || null,
          signingPublicKey: user.signingPublicKey || null,
          sealedSigningPrivateKey: user.sealedSigningPrivateKey || null
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/account/sessions") {
        const sessions = currentStore.sessions
          .filter((session) => session.userId === user.id && session.expiresAt > Date.now())
          .map((session) => ({
            id: session.id,
            createdAt: new Date(session.createdAt || session.expiresAt - SESSION_TTL_MS).toISOString(),
            expiresAt: new Date(session.expiresAt).toISOString(),
            isCurrent: session.id === auth.session.id
          }))
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
        sendJson(response, 200, { sessions });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/account/sessions/revoke-all") {
        const input = await readJsonBody(request);
        const currentPassword = typeof input.currentPassword === "string" ? input.currentPassword : "";
        if (!await verifyPassword(currentPassword, user.passwordHash)) {
          throw new HttpError(401, "Current password is incorrect.");
        }
        const accountKey = request.headers["x-polus-account"] || "";
        const revokedSessionIds = currentStore.sessions
          .filter((session) => session.userId === user.id)
          .map((session) => session.id);
        currentStore.sessions = currentStore.sessions.filter((session) => session.userId !== user.id);
        await persist();
        for (const sessionId of revokedSessionIds) closeSessionStreams(sessionStreams, sessionId);
        sendJson(response, 200, { ok: true, revokedCount: revokedSessionIds.length }, {
          "Set-Cookie": expiredSessionCookie(request, accountKey)
        });
        return;
      }

      if (request.method === "PUT" && url.pathname === "/api/account/encryption-key") {
        const input = await readJsonBody(request);
        const publicKey = input.publicKey;
        const sealed = input.sealedPrivateKey;
        const signingPublicKey = input.signingPublicKey;
        const sealedSigning = input.sealedSigningPrivateKey;
        const base64Pattern = /^[A-Za-z0-9+/]+={0,2}$/;
        const validSealedKey = (key, maxCiphertextLength) => {
          if (!key || typeof key !== "object"
            || typeof key.salt !== "string" || !base64Pattern.test(key.salt)
            || typeof key.iv !== "string" || !base64Pattern.test(key.iv)
            || typeof key.ciphertext !== "string" || key.ciphertext.length > maxCiphertextLength
            || !base64Pattern.test(key.ciphertext)) return false;
          if (key.keyVersion === undefined || key.keyVersion === 2) return key.iterations === 310000;
          if (key.keyVersion === 3) return key.iterations === 600000;
          return false;
        };
        const sealingStrength = (key) => key?.keyVersion === 3 && key.iterations === 600000
          ? 3
          : key?.keyVersion === 2 && key.iterations === 310000
            ? 2
            : key && key.keyVersion === undefined && key.iterations === 310000
              ? 1
              : 0;
        let publicKeysValid = true;
        if (signingPublicKey !== undefined) {
          try {
            const encryptionKey = crypto.createPublicKey({
              key: Buffer.from(publicKey, "base64"),
              format: "der",
              type: "spki"
            });
            const signingKey = crypto.createPublicKey({
              key: Buffer.from(signingPublicKey, "base64"),
              format: "der",
              type: "spki"
            });
            publicKeysValid = encryptionKey.asymmetricKeyType === "rsa"
              && encryptionKey.asymmetricKeyDetails?.modulusLength === 3072
              && signingKey.asymmetricKeyType === "ec"
              && signingKey.asymmetricKeyDetails?.namedCurve === "prime256v1";
          } catch {
            publicKeysValid = false;
          }
        }
        if (typeof publicKey !== "string" || publicKey.length > 2000
          || !base64Pattern.test(publicKey)
          || !validSealedKey(sealed, 4000)
          || ((signingPublicKey === undefined) !== (sealedSigning === undefined))
          || (signingPublicKey !== undefined && (typeof signingPublicKey !== "string"
            || signingPublicKey.length > 500 || !base64Pattern.test(signingPublicKey)
            || Buffer.from(signingPublicKey, "base64").length > 300
            || !validSealedKey(sealedSigning, 1000)))
          || !publicKeysValid) {
          throw new HttpError(400, "Invalid encryption key data.");
        }
        if (user.encryptionPublicKey || user.sealedEncryptionPrivateKey) {
          if (user.encryptionPublicKey !== publicKey) {
            throw new HttpError(409, "An encryption identity is already registered for this account.");
          }
          const sameEncryptionSeal = JSON.stringify(user.sealedEncryptionPrivateKey) === JSON.stringify(sealed);
          const sameSigningIdentity = user.signingPublicKey === signingPublicKey
            && JSON.stringify(user.sealedSigningPrivateKey) === JSON.stringify(sealedSigning);
          if (sameEncryptionSeal && sameSigningIdentity) {
            sendJson(response, 200, { ok: true });
            return;
          }
          if (sameEncryptionSeal && !user.signingPublicKey && signingPublicKey) {
            user.signingPublicKey = signingPublicKey;
            user.sealedSigningPrivateKey = sealedSigning;
            await persist();
            sendJson(response, 200, { ok: true });
            return;
          }
          const sameSigningPublicKey = user.signingPublicKey === signingPublicKey;
          const encryptionUpgrade = sealingStrength(sealed) > sealingStrength(user.sealedEncryptionPrivateKey);
          const signingUpgrade = Boolean(user.sealedSigningPrivateKey && sealedSigning
            && sealingStrength(sealedSigning) > sealingStrength(user.sealedSigningPrivateKey));
          const noKeyDowngrade = sealingStrength(sealed) >= sealingStrength(user.sealedEncryptionPrivateKey)
            && (!user.sealedSigningPrivateKey
              || sealingStrength(sealedSigning) >= sealingStrength(user.sealedSigningPrivateKey));
          if (sameSigningPublicKey && noKeyDowngrade && (encryptionUpgrade || signingUpgrade)) {
            user.sealedEncryptionPrivateKey = sealed;
            if (user.sealedSigningPrivateKey) user.sealedSigningPrivateKey = sealedSigning;
            await persist();
            sendJson(response, 200, { ok: true });
            return;
          }
          throw new HttpError(409, "An encryption identity is already registered for this account.");
        }
        user.encryptionPublicKey = publicKey;
        user.sealedEncryptionPrivateKey = sealed;
        if (signingPublicKey) {
          user.signingPublicKey = signingPublicKey;
          user.sealedSigningPrivateKey = sealedSigning;
        }
        await persist();
        sendJson(response, 201, { ok: true });
        return;
      }

      const userEncryptionKeyRoute = /^\/api\/users\/([^/]+)\/encryption-key$/.exec(url.pathname);
      if (request.method === "GET" && userEncryptionKeyRoute) {
        const username = decodePathComponent(userEncryptionKeyRoute[1]).replace(/^@/, "").toLowerCase();
        const recipient = currentStore.users.find((candidate) => candidate.username === username);
        if (!recipient || recipient.id === user.id
          || (user.blockedUserIds || []).includes(recipient.id)
          || (recipient.blockedUserIds || []).includes(user.id)) {
          throw new HttpError(404, "User not found.");
        }
        sendJson(response, 200, {
          userId: recipient.id,
          publicKey: recipient.encryptionPublicKey || null,
          signingPublicKey: recipient.signingPublicKey || null
        });
        return;
      }

      const conversationEncryptionKeysRoute = /^\/api\/chats\/([^/]+)\/encryption-keys$/.exec(url.pathname);
      if (request.method === "GET" && conversationEncryptionKeysRoute) {
        const conversationId = decodePathComponent(conversationEncryptionKeysRoute[1]);
        const { conversation } = findReadableConversation(currentStore, conversationId, user.id);
        if (!conversation.memberIds.includes(user.id)) {
          throw new HttpError(403, "Join this chat to access encryption keys.");
        }
        sendJson(response, 200, {
          keys: conversation.memberIds.map((memberId) => {
            const member = currentStore.users.find((candidate) => candidate.id === memberId);
            return {
              id: memberId,
              publicKey: member?.encryptionPublicKey || null,
              signingPublicKey: member?.signingPublicKey || null
            };
          })
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/presence/chat") {
        const input = await readJsonBody(request);
        if (typeof input.clientId !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(input.clientId)
          || typeof input.visible !== "boolean"
          || (input.conversationId !== null && typeof input.conversationId !== "string")) {
          throw new HttpError(400, "Invalid chat presence state.");
        }
        let chatId = null;
        if (input.visible && input.conversationId) {
          const { conversation } = findReadableConversation(currentStore, input.conversationId, user.id);
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
        if (type === "channel") requireChannelPermission(conversation, user.id, "publish", "publish");
        const encryptedUpload = request.headers["x-polus-encrypted"] === "true";
        const uploadLimit = MAX_ATTACHMENT_BYTES
          + (encryptedUpload ? MAX_ENCRYPTED_ATTACHMENT_OVERHEAD_BYTES : 0);
        const declaredSize = Number(request.headers["content-length"] || 0);
        if (declaredSize > uploadLimit) throw new HttpError(413, "Files cannot exceed 100 MB.");
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
        await fs.mkdir(chatDirectory, { recursive: true, mode: 0o700 });
        if (process.platform !== "win32") await fs.chmod(chatDirectory, 0o700);
        const file = await fs.open(filePath, "wx", 0o600);
        let size = 0;
        let tooLarge = false;
        const signature = [];
        try {
          for await (const chunkValue of request) {
            const chunk = Buffer.from(chunkValue);
            size += chunk.length;
            if (size > uploadLimit) {
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
        if (type === "channel") requireChannelPermission(conversation, user.id, "publish", "publish");
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
        const file = await fs.open(filePath, "wx", 0o600);
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
        const publishedMessage = attachment?.messageId
          ? currentStore.messages.find((message) => message.id === attachment.messageId
            && (message.conversationId || message.room) === attachment.chatId
            && !message.deleted && (message.attachmentIds || []).includes(attachment.id))
          : null;
        const publicMedia = publishedMessage && attachmentChat && currentStore.channels.includes(attachmentChat)
          && !attachmentChat.isPrivate;
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
        response.on("close", () => fileStream.destroy());
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
        response.on("close", () => avatarStream.destroy());
        avatarStream.pipe(response);
        return;
      }

      const profileCoverRoute = /^\/api\/profile-covers\/([^/]+)$/.exec(url.pathname);
      if (request.method === "GET" && profileCoverRoute) {
        const target = currentStore.users.find((candidate) => candidate.id === decodePathComponent(profileCoverRoute[1]));
        if (!target?.profileCoverId
          || !(target.profileCoverMimeType?.startsWith("image/")
            || ["video/mp4", "video/webm"].includes(target.profileCoverMimeType))) {
          throw new HttpError(404, "Profile cover not found.");
        }
        const profilesRoot = path.resolve(dataDirectory, "uploads", "profiles");
        const userDirectory = path.resolve(profilesRoot, target.id);
        const filePath = path.resolve(userDirectory, target.profileCoverId);
        if (!userDirectory.startsWith(`${profilesRoot}${path.sep}`)
          || !filePath.startsWith(`${userDirectory}${path.sep}`)) throw new Error("Unsafe profile cover path.");
        let fileHandle;
        try {
          fileHandle = await fs.open(filePath, "r");
        } catch (error) {
          if (error.code === "ENOENT") throw new HttpError(404, "Profile cover not found.");
          throw error;
        }
        const stat = await fileHandle.stat();
        response.writeHead(200, {
          "Content-Type": target.profileCoverMimeType,
          "Content-Length": stat.size,
          "Content-Disposition": "inline",
          "Cache-Control": "private, max-age=86400",
          "X-Content-Type-Options": "nosniff"
        });
        const coverStream = fileHandle.createReadStream();
        coverStream.on("close", () => { void fileHandle.close().catch((error) => console.error("Profile cover close failed:", error)); });
        response.on("close", () => coverStream.destroy());
        coverStream.pipe(response);
        return;
      }

      if (request.method === "PATCH" && url.pathname === "/api/account/profile-design") {
        const input = await readJsonBody(request);
        if (!input || typeof input !== "object" || Array.isArray(input)
          || !["aurora", "ocean", "sunset"].includes(input.theme)
          || typeof input.accentColor !== "string" || !/^#[\da-f]{6}$/i.test(input.accentColor)
          || !["system", "serif", "rounded"].includes(input.font)
          || typeof input.motionEnabled !== "boolean"
          || input.gradientStart !== undefined
            && (typeof input.gradientStart !== "string" || !/^#[\da-f]{6}$/i.test(input.gradientStart))
          || input.gradientEnd !== undefined
            && (typeof input.gradientEnd !== "string" || !/^#[\da-f]{6}$/i.test(input.gradientEnd))
          || input.gradientDirection !== undefined
            && !["diagonal", "horizontal", "vertical"].includes(input.gradientDirection)
          || input.effects !== undefined && !["none", "glow", "particles"].includes(input.effects)
          || input.avatarFrame !== undefined && !["gradient", "glow", "double", "none"].includes(input.avatarFrame)
          || input.animation !== undefined && !["subtle", "float", "gradient", "none"].includes(input.animation)
          || input.backgroundImageEnabled !== undefined && typeof input.backgroundImageEnabled !== "boolean"
          || input.coverParallax !== undefined && typeof input.coverParallax !== "boolean") {
          throw new HttpError(400, "Invalid profile design.");
        }
        user.profileDesign = normalizeProfileDesign(input);
        await persist();
        sendJson(response, 200, { user: publicUser(user) });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/account/profile-cover") {
        const declaredSize = Number(request.headers["content-length"] || 0);
        const maxCoverBytes = 8 * 1024 * 1024;
        if (declaredSize > maxCoverBytes) throw new HttpError(413, "Profile covers cannot exceed 8 MB.");
        const coverId = `cover-${randomId()}`;
        const profilesRoot = path.resolve(dataDirectory, "uploads", "profiles");
        const userDirectory = path.resolve(profilesRoot, user.id);
        const filePath = path.resolve(userDirectory, coverId);
        if (!userDirectory.startsWith(`${profilesRoot}${path.sep}`)
          || !filePath.startsWith(`${userDirectory}${path.sep}`)) throw new Error("Unsafe profile cover path.");
        await fs.mkdir(userDirectory, { recursive: true, mode: 0o700 });
        if (process.platform !== "win32") await fs.chmod(userDirectory, 0o700);
        const file = await fs.open(filePath, "wx", 0o600);
        const previousCover = {
          id: user.profileCoverId,
          mimeType: user.profileCoverMimeType,
          size: user.profileCoverSize
        };
        let size = 0;
        let tooLarge = false;
        const signature = [];
        try {
          for await (const chunkValue of request) {
            const chunk = Buffer.from(chunkValue);
            size += chunk.length;
            if (size > maxCoverBytes) {
              tooLarge = true;
              continue;
            }
            if (tooLarge) continue;
            const signatureLength = signature.reduce((total, part) => total + part.length, 0);
            if (signatureLength < 32) signature.push(chunk.subarray(0, 32 - signatureLength));
            await file.writeFile(chunk);
          }
          if (tooLarge) throw new HttpError(413, "Profile covers cannot exceed 8 MB.");
          const mimeType = sniffMimeType(Buffer.concat(signature).subarray(0, 32));
          if (!(mimeType.startsWith("image/") || ["video/mp4", "video/webm"].includes(mimeType))) {
            throw new HttpError(400, "Profile cover must be a supported image or MP4/WebM video.");
          }
          if (declaredSize && size !== declaredSize) throw new HttpError(400, "Upload size did not match Content-Length.");
          user.profileCoverId = coverId;
          user.profileCoverMimeType = mimeType;
          user.profileCoverSize = size;
          await persist();
        } catch (error) {
          user.profileCoverId = previousCover.id;
          user.profileCoverMimeType = previousCover.mimeType;
          user.profileCoverSize = previousCover.size;
          await file.close();
          await fs.rm(filePath, { force: true });
          throw error;
        }
        await file.close();
        if (previousCover.id) await fs.rm(path.resolve(userDirectory, previousCover.id), { force: true });
        sendJson(response, 201, { user: publicUser(user) });
        return;
      }

      if (request.method === "DELETE" && url.pathname === "/api/account/profile-cover") {
        const oldCoverId = user.profileCoverId;
        delete user.profileCoverId;
        delete user.profileCoverMimeType;
        delete user.profileCoverSize;
        if (user.profileDesign) user.profileDesign.backgroundImageEnabled = false;
        await persist();
        if (oldCoverId) {
          const profilesRoot = path.resolve(dataDirectory, "uploads", "profiles");
          const userDirectory = path.resolve(profilesRoot, user.id);
          const filePath = path.resolve(userDirectory, oldCoverId);
          if (filePath.startsWith(`${userDirectory}${path.sep}`)) await fs.rm(filePath, { force: true });
        }
        sendJson(response, 200, { user: publicUser(user) });
        return;
      }

      const profileRoute = /^\/api\/users\/([^/]+)\/profile$/.exec(url.pathname);
      if (request.method === "GET" && url.pathname === "/api/contacts") {
        const contactIds = new Set(user.contactIds || []);
        const contacts = currentStore.users
          .filter((contact) => contactIds.has(contact.id))
          .map((contact) => ({
            ...publicUser(contact),
            online: contact.showOnlineStatus !== false
              && !(contact.blockedUserIds || []).includes(user.id)
              && Boolean(connectedUsers.get(contact.id)?.size),
            lastSeenAt: contact.showOnlineStatus === false || (contact.blockedUserIds || []).includes(user.id)
              ? null
              : contact.lastSeenAt || null,
            blocked: (user.blockedUserIds || []).includes(contact.id)
              || (contact.blockedUserIds || []).includes(user.id)
          }))
          .sort((left, right) => left.fullName.localeCompare(right.fullName));
        sendJson(response, 200, contacts);
        return;
      }

      const contactRoute = /^\/api\/contacts\/([^/]+)$/.exec(url.pathname);
      if (contactRoute && ["PUT", "DELETE"].includes(request.method)) {
        const username = decodePathComponent(contactRoute[1]).replace(/^@/, "").toLowerCase();
        const target = currentStore.users.find((candidate) => candidate.username === username);
        if (!target) throw new HttpError(404, "User not found.");
        if (target.id === user.id) throw new HttpError(400, "You cannot add yourself to contacts.");
        user.contactIds = Array.isArray(user.contactIds) ? user.contactIds : [];
        if (request.method === "PUT" && !user.contactIds.includes(target.id)) {
          user.contactIds.push(target.id);
        } else if (request.method === "DELETE") {
          user.contactIds = user.contactIds.filter((contactId) => contactId !== target.id);
        }
        await persist();
        sendJson(response, 200, {
          contact: request.method === "PUT" ? publicUser(target) : null,
          isContact: user.contactIds.includes(target.id)
        });
        return;
      }

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
            isContact: (user.contactIds || []).includes(target.id),
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
        await fs.mkdir(userDirectory, { recursive: true, mode: 0o700 });
        if (process.platform !== "win32") await fs.chmod(userDirectory, 0o700);
        const file = await fs.open(filePath, "wx", 0o600);
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
        const isPublicChannel = Boolean(chat && currentStore.channels.includes(chat) && !chat.isPrivate);
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
        const { conversation } = findReadableConversation(currentStore, chatId, user.id);
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
            ...currentStore.channels.filter((channel) =>
              channel.memberIds.includes(user.id) || !channel.isPrivate
            ),
            ...currentStore.conversations.filter((conversation) =>
              conversation.memberIds.includes(user.id)
                && !(user.hiddenChatIds || []).includes(conversation.id)
            )
          ];
        const summaryIndex = buildConversationSummaryIndex(
          currentStore, userConversations, user.id, queryUnreadCount, queryLastMessage
        );
        const channels = currentStore.channels
          .filter((channel) => (channel.memberIds.includes(user.id) || !channel.isPrivate)
            && !(user.hiddenChatIds || []).includes(channel.id))
          .map((channel) => chatSummary(channel, user.id, summaryIndex));
        const directs = currentStore.conversations
          .filter((conversation) => conversation.memberIds.includes(user.id)
            && !(user.hiddenChatIds || []).includes(conversation.id))
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

      const userChatRoute = /^\/api\/chats\/([^/]+)\/(pin|hide)$/.exec(url.pathname);
      if (userChatRoute && (request.method === "PUT" || request.method === "DELETE")) {
        const chatId = decodePathComponent(userChatRoute[1]);
        const chat = getChatRecord(currentStore, chatId);
        if (!chat || !getChatRole(chat, user.id)) throw new HttpError(404, "Chat not found.");
        const preference = userChatRoute[2] === "pin" ? "pinnedChatIds" : "hiddenChatIds";
        const chatType = currentStore.channels.includes(chat) ? "channel" : chat.type || "group";
        if (preference === "hiddenChatIds" && chatType === "saved") {
          throw new HttpError(400, "Saved Messages cannot be deleted.");
        }
        user[preference] = Array.isArray(user[preference]) ? user[preference] : [];
        if (request.method === "PUT" && !user[preference].includes(chatId)) {
          user[preference].push(chatId);
        } else if (request.method === "DELETE") {
          user[preference] = user[preference].filter((id) => id !== chatId);
        }
        await persist();
        broadcast(user.id, "chat-updated", {
          chatId,
          action: preference === "pinnedChatIds" ? "pin-changed" : "visibility-changed",
          pinned: user.pinnedChatIds.includes(chatId),
          hidden: user.hiddenChatIds.includes(chatId)
        });
        sendJson(response, 200, { ok: true, pinned: user.pinnedChatIds.includes(chatId) });
        return;
      }

      const channelProfileRoute = /^\/api\/channels\/([^/]+)\/profile$/.exec(url.pathname);
      if (request.method === "GET" && channelProfileRoute) {
        const channelId = decodePathComponent(channelProfileRoute[1]);
        const channel = currentStore.channels.find((item) => item.id === channelId);
        if (!channel || (channel.isPrivate && !channel.memberIds.includes(user.id))) {
          throw new HttpError(404, "Chat not found.");
        }
        sendJson(response, 200, {
          chat: chatSummary(channel, user.id),
          memberCount: channel.memberIds.length
        });
        return;
      }

      const inviteJoinRoute = /^\/api\/invites\/([^/]+)\/join$/.exec(url.pathname);
      if (request.method === "POST" && inviteJoinRoute) {
        const token = decodePathComponent(inviteJoinRoute[1]);
        const chat = [...currentStore.channels, ...currentStore.conversations]
          .find((item) => item.inviteToken === token);
        if (!chat || !["channel", "group"].includes(chat.type)) throw new HttpError(404, "Invite link not found.");
        if (!chat.memberIds.includes(user.id)) {
          if (chat.type === "group" && chat.memberIds.length >= 200) {
            throw new HttpError(409, "Groups cannot have more than 200 participants.");
          }
          chat.memberIds.push(user.id);
          chat.unreadCounts = chat.unreadCounts || {};
          chat.unreadCounts[user.id] = 0;
          chat.lastReadMessageIds = chat.lastReadMessageIds || {};
          chat.lastReadMessageIds[user.id] = latestMessageId(currentStore, chat.id);
          user.hiddenChatIds = (user.hiddenChatIds || []).filter((id) => id !== chat.id);
          await persist();
          broadcastChatMembers(chat, "chat-updated", { chatId: chat.id, action: "member-added", userId: user.id }, broadcast);
        }
        sendJson(response, 200, chatSummary(chat, user.id));
        return;
      }

      const chatRoute = /^\/api\/chats\/([^/]+)(?:\/(members|admins|owner|leave|settings|invite))?(?:\/([^/]+))?$/.exec(url.pathname);
      if (chatRoute) {
        const chatId = decodePathComponent(chatRoute[1]);
        const section = chatRoute[2] || "";
        const targetId = chatRoute[3] ? decodePathComponent(chatRoute[3]) : "";
        const chat = getChatRecord(currentStore, chatId);
        const role = chat ? getChatRole(chat, user.id) : null;
        if (!chat || !role) throw new HttpError(404, "Chat not found.");
        const chatType = currentStore.channels.includes(chat) ? "channel" : chat.type || "group";
        if (chatType === "saved" && !(request.method === "DELETE" && !section)) {
          throw new HttpError(400, "Saved Messages cannot be managed.");
        }
        if (chatType === "direct" && !(request.method === "DELETE" && !section)) {
          throw new HttpError(400, "Direct chats cannot be managed.");
        }

        if (section === "invite" && !targetId && request.method === "POST") {
          requireChatRole(chat, user.id, ["owner", "admin"]);
          chat.inviteToken = crypto.randomBytes(32).toString("base64url");
          await persist();
          sendJson(response, 200, { inviteUrl: `/join/${chat.inviteToken}` });
          return;
        }
        if (section === "invite" && !targetId && request.method === "DELETE") {
          requireChatRole(chat, user.id, ["owner", "admin"]);
          delete chat.inviteToken;
          await persist();
          sendJson(response, 200, { ok: true });
          return;
        }

        if (request.method === "GET" && !section) {
          sendJson(response, 200, {
            chat: chatSummary(chat, user.id),
            adminPermissions: chatType === "channel"
              ? role === "owner"
                ? chat.adminPermissions
                : role === "admin" ? { [user.id]: getChannelAdminPermissions(chat, user.id) } : {}
              : {},
            inviteUrl: ["owner", "admin"].includes(role) && chat.inviteToken
              ? `/join/${chat.inviteToken}` : null,
            members: chat.memberIds.map((memberId) => {
              const member = currentStore.users.find((candidate) => candidate.id === memberId);
              return member ? { ...publicUser(member), role: getChatRole(chat, memberId) } : null;
            }).filter(Boolean)
          });
          return;
        }

        if (request.method === "PUT" && section === "settings" && !targetId) {
          const input = await readJsonBody(request);
          if (chatType === "group") {
            requireChatRole(chat, user.id, ["owner"]);
            if (Object.keys(input).some((key) => !["name", "description", "isPublic"].includes(key))) {
              throw new HttpError(400, "Invalid group settings.");
            }
            if (input.isPublic !== undefined && typeof input.isPublic !== "boolean") {
              throw new HttpError(400, "Invalid group settings.");
            }
            const name = input.name === undefined ? undefined : cleanText(input.name, 50);
            if (name !== undefined && Array.from(name).length < 2) {
              throw new HttpError(400, "Group name is too short.");
            }
            if (input.description !== undefined && typeof input.description !== "string") {
              throw new HttpError(400, "Group description must be text.");
            }
            if (name !== undefined) chat.name = name;
            if (input.description !== undefined) chat.description = cleanText(input.description, 160);
            if (typeof input.isPublic === "boolean") chat.isPublic = input.isPublic;
            await persist();
            broadcastChatMembers(chat, "chat-updated", { chatId, action: "settings-changed" }, broadcast);
            sendJson(response, 200, { chat: chatSummary(chat, user.id) });
            return;
          }
          if (chatType !== "channel") throw new HttpError(400, "Only channels and groups have settings.");
          if (input.postAs !== undefined && input.postAs !== "channel" && input.postAs !== "person") {
            throw new HttpError(400, "Post identity must be channel or person.");
          }
          const changesChannelDetails = input.name !== undefined
            || input.description !== undefined || input.isPrivate !== undefined;
          if (changesChannelDetails) requireChatRole(chat, user.id, ["owner"]);
          else requireChatRole(chat, user.id, ["owner", "admin"]);
          const name = input.name === undefined ? undefined : cleanText(input.name, 50);
          if (name !== undefined && Array.from(name).length < 2) {
            throw new HttpError(400, "Channel name is too short.");
          }
          if (input.description !== undefined && typeof input.description !== "string") {
            throw new HttpError(400, "Channel description must be text.");
          }
          if (name !== undefined) chat.name = name;
          if (input.description !== undefined) chat.description = cleanText(input.description, 160);
          if (input.postAs !== undefined) chat.postAs = input.postAs;
          if (typeof input.isPrivate === "boolean") chat.isPrivate = input.isPrivate;
          await persist();
          broadcastChatMembers(chat, "chat-updated", { chatId, action: "settings-changed" }, broadcast);
          sendJson(response, 200, { chat: chatSummary(chat, user.id) });
          return;
        }

        if (request.method === "POST" && section === "members" && !targetId) {
          requireChatRole(chat, user.id, ["owner", "admin"]);
          const input = await readJsonBody(request);
          const usernames = Array.isArray(input.usernames)
            ? input.usernames.map((value) => cleanText(value, 32).replace(/^@/, "").toLowerCase())
            : [cleanText(input.username, 32).replace(/^@/, "").toLowerCase()];
          const uniqueUsernames = [...new Set(usernames.filter(Boolean))];
          if (!uniqueUsernames.length || uniqueUsernames.length > 199) {
            throw new HttpError(400, "Choose between 1 and 199 users.");
          }
          const invitees = uniqueUsernames.map((username) =>
            currentStore.users.find((candidate) => candidate.username === username));
          if (invitees.some((invitee) => !invitee)) throw new HttpError(404, "User not found.");
          if (invitees.some((invitee) => invitee.id === user.id)) {
            throw new HttpError(400, "You cannot add yourself to a chat.");
          }
          if (invitees.some((invitee) => (user.blockedUserIds || []).includes(invitee.id)
            || (invitee.blockedUserIds || []).includes(user.id))) {
            throw new HttpError(403, "Blocked users cannot be added to a chat.");
          }
          if (!Array.isArray(input.usernames) && chat.memberIds.includes(invitees[0].id)) {
            sendJson(response, 200, { chat: chatSummary(chat, user.id), added: false });
            return;
          }
          if (invitees.some((invitee) => chat.memberIds.includes(invitee.id))) {
            throw new HttpError(409, "One or more selected users are already chat members.");
          }
          if (chatType === "channel" && !chat.isPrivate) {
            throw new HttpError(400, "Invite users to public channels with an invite link.");
          }
          if (chatType === "group" && chat.memberIds.length + invitees.length > 200) {
            throw new HttpError(409, "Groups cannot have more than 200 participants.");
          }
          chat.unreadCounts = chat.unreadCounts || {};
          chat.lastReadMessageIds = chat.lastReadMessageIds || {};
          const latestId = latestMessageId(currentStore, chat.id);
          for (const invitee of invitees) {
            chat.memberIds.push(invitee.id);
            chat.unreadCounts[invitee.id] = 0;
            chat.lastReadMessageIds[invitee.id] = latestId;
            invitee.hiddenChatIds = (invitee.hiddenChatIds || []).filter((id) => id !== chat.id);
          }
          await persist();
          const event = { chatId, action: "members-added", userIds: invitees.map((invitee) => invitee.id) };
          broadcastChatMembers(chat, "chat-updated", event, broadcast);
          sendJson(response, 201, {
            chat: chatSummary(chat, user.id),
            added: invitees.map((invitee) => publicUser(invitee))
          });
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
          if (chat.adminPermissions) delete chat.adminPermissions[targetId];
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
          if (input.permissions !== undefined) {
            if (chatType !== "channel") {
              throw new HttpError(400, "Custom administrator permissions are only supported for channels.");
            }
            if (input.role !== undefined) throw new HttpError(400, "Update the role or permissions separately.");
            if (getChatRole(chat, targetId) !== "admin") {
              throw new HttpError(400, "Only administrators can have custom permissions.");
            }
            if (!input.permissions || typeof input.permissions !== "object"
              || Array.isArray(input.permissions)
              || CHANNEL_ADMIN_PERMISSION_KEYS.some((key) => typeof input.permissions[key] !== "boolean")
              || Object.keys(input.permissions).some((key) => !CHANNEL_ADMIN_PERMISSION_KEYS.includes(key))) {
              throw new HttpError(400, "Invalid administrator permissions.");
            }
            chat.adminPermissions = chat.adminPermissions || {};
            chat.adminPermissions[targetId] = Object.fromEntries(
              CHANNEL_ADMIN_PERMISSION_KEYS.map((key) => [key, input.permissions[key]])
            );
            await persist();
            broadcastChatMembers(chat, "chat-updated", { chatId, action: "permissions-changed", userId: targetId }, broadcast);
            sendJson(response, 200, {
              chat: chatSummary(chat, user.id),
              permissions: chat.adminPermissions[targetId]
            });
            return;
          }
          if (input.role === "admin") {
            if (!chat.adminIds.includes(targetId)) chat.adminIds.push(targetId);
            if (chatType === "channel") {
              chat.adminPermissions = chat.adminPermissions || {};
              chat.adminPermissions[targetId] = getChannelAdminPermissions(chat, targetId);
            }
          } else if (input.role === "member") {
            chat.adminIds = chat.adminIds.filter((adminId) => adminId !== targetId);
            if (chat.adminPermissions) delete chat.adminPermissions[targetId];
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
          if (chat.adminPermissions) delete chat.adminPermissions[newOwner.id];
          await persist();
          broadcastChatMembers(chat, "chat-updated", { chatId, action: "owner-changed", userId: newOwner.id }, broadcast);
          sendJson(response, 200, { chat: chatSummary(chat, user.id) });
          return;
        }

        if (request.method === "POST" && section === "leave" && !targetId) {
          if (role === "owner") throw new HttpError(409, "Transfer ownership or delete the chat before leaving.");
          chat.memberIds = chat.memberIds.filter((memberId) => memberId !== user.id);
          chat.adminIds = (chat.adminIds || []).filter((adminId) => adminId !== user.id);
          if (chat.adminPermissions) delete chat.adminPermissions[user.id];
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
          const deletionScope = url.searchParams.get("scope") || "everyone";
          if (deletionScope !== "me" && deletionScope !== "everyone") {
            throw new HttpError(400, "Deletion scope must be me or everyone.");
          }
          if (deletionScope === "everyone") {
            if (chatType === "saved") throw new HttpError(400, "Saved Messages cannot be deleted.");
            requireChatRole(chat, user.id, chatType === "direct" ? ["member", "owner"] : ["owner"]);
            const removed = removeChatData(currentStore, chatId);
            const uploadsRoot = path.resolve(dataDirectory, "uploads");
            await removeUnreferencedAttachmentFiles(currentStore, removed.removedAttachments, uploadsRoot);
            for (const memberId of chat.memberIds) {
              const member = currentStore.users.find((candidate) => candidate.id === memberId);
              if (member) {
                member.hiddenChatIds = (member.hiddenChatIds || []).filter((id) => id !== chatId);
                member.pinnedChatIds = (member.pinnedChatIds || []).filter((id) => id !== chatId);
              }
            }
            await persist();
            broadcastChatMembers(chat, "chat-updated", { chatId, action: "chat-deleted" }, broadcast);
            sendJson(response, 200, { ok: true });
            return;
          }
          if (chatType === "saved") throw new HttpError(400, "Saved Messages cannot be deleted.");
          user.hiddenChatIds = user.hiddenChatIds || [];
          if (!user.hiddenChatIds.includes(chatId)) user.hiddenChatIds.push(chatId);
          user.pinnedChatIds = (user.pinnedChatIds || []).filter((id) => id !== chatId);
          await persist();
          broadcast(user.id, "chat-updated", { chatId, action: "chat-hidden", userId: user.id });
          sendJson(response, 200, { ok: true });
          return;
        }

        throw new HttpError(404, "Not found.");
      }

      if (request.method === "PATCH" && url.pathname === "/api/account") {
        const input = await readJsonBody(request);
        const fullName = cleanText(input.fullName, 256);
        const about = cleanText(input.about, 1000);
        const encryptionKeyUpdate = input.encryptionKeyUpdate;
        if (Array.from(fullName).length < 1 || Array.from(fullName).length > 50) {
          throw new HttpError(400, "Display name must be 1–50 characters.");
        }
        if (Array.from(about).length > 200) {
          throw new HttpError(400, "About must be at most 200 characters.");
        }
        let updatedPasswordHash;
        let revokedSessionIds = [];
        if (input.newPassword) {
          if (typeof input.newPassword !== "string"
            || Array.from(input.newPassword).length < 8 || Array.from(input.newPassword).length > 128) {
            throw new HttpError(400, "Password must be 8–128 characters.");
          }
          const currentPassword = typeof input.currentPassword === "string" ? input.currentPassword : "";
          if (!await verifyPassword(currentPassword, user.passwordHash)) {
            throw new HttpError(401, "Current password is incorrect.");
          }
          if (user.sealedEncryptionPrivateKey
            && user.sealedEncryptionPrivateKey.keyVersion === undefined
            && encryptionKeyUpdate === undefined) {
            throw new HttpError(409, "Migrate the legacy encryption key before changing the password.");
          }
          if (encryptionKeyUpdate !== undefined) {
            const base64Pattern = /^[A-Za-z0-9+/]+={0,2}$/;
            const validRewrappedKey = (key, maxCiphertextLength) => key && typeof key === "object"
              && key.keyVersion === 3
              && typeof key.salt === "string" && base64Pattern.test(key.salt)
              && typeof key.iv === "string" && base64Pattern.test(key.iv)
              && typeof key.ciphertext === "string" && key.ciphertext.length <= maxCiphertextLength
              && base64Pattern.test(key.ciphertext)
              && key.iterations === 600000;
            if (!encryptionKeyUpdate || typeof encryptionKeyUpdate !== "object"
              || Array.isArray(encryptionKeyUpdate)
              || !user.encryptionPublicKey || !user.sealedEncryptionPrivateKey
              || user.sealedEncryptionPrivateKey.keyVersion !== undefined
              || !validRewrappedKey(encryptionKeyUpdate.sealedPrivateKey, 4000)) {
              throw new HttpError(409, "The encryption key cannot be migrated in its current state.");
            }
            const needsSigningMigration = Boolean(user.signingPublicKey
              && user.sealedSigningPrivateKey?.keyVersion === undefined);
            if ((needsSigningMigration && !validRewrappedKey(encryptionKeyUpdate.sealedSigningPrivateKey, 1000))
              || (encryptionKeyUpdate.sealedSigningPrivateKey !== undefined
                && (!user.signingPublicKey || user.sealedSigningPrivateKey?.keyVersion !== undefined
                  || !validRewrappedKey(encryptionKeyUpdate.sealedSigningPrivateKey, 1000)))) {
              throw new HttpError(400, "Invalid rewrapped signing key.");
            }
          }
          updatedPasswordHash = await passwordHash(input.newPassword);
        } else if (encryptionKeyUpdate !== undefined) {
          throw new HttpError(400, "Key migration requires a password change.");
        }
        if (updatedPasswordHash) {
          user.passwordHash = updatedPasswordHash;
          if (encryptionKeyUpdate) {
            user.sealedEncryptionPrivateKey = encryptionKeyUpdate.sealedPrivateKey;
            if (encryptionKeyUpdate.sealedSigningPrivateKey) {
              user.sealedSigningPrivateKey = encryptionKeyUpdate.sealedSigningPrivateKey;
            }
          }
          revokedSessionIds = currentStore.sessions
            .filter((session) => session.userId === user.id)
            .map((session) => session.id);
          currentStore.sessions = currentStore.sessions.filter((session) => session.userId !== user.id);
        }
        user.fullName = fullName;
        user.about = about;
        if (typeof input.showOnlineStatus === "boolean") user.showOnlineStatus = input.showOnlineStatus;
        if (typeof input.hideNotificationContent === "boolean") {
          user.hideNotificationContent = input.hideNotificationContent;
        }
        await persist();
        for (const sessionId of revokedSessionIds) {
          closeSessionStreams(sessionStreams, sessionId);
        }
        sendJson(response, 200, {
          user: {
            ...publicUser(user),
            createdAt: user.createdAt,
            hideNotificationContent: user.hideNotificationContent === true
          },
          ...(updatedPasswordHash ? { sessionsRevoked: true } : {})
        }, updatedPasswordHash
          ? { "Set-Cookie": expiredSessionCookie(request, request.headers["x-polus-account"] || "") }
          : {});
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/users") {
        const query = cleanText(url.searchParams.get("q") || "", 50).replace(/^@/, "").toLowerCase();
        const users = query.length < 2 ? [] : currentStore.users
          .filter((candidate) => candidate.id !== user.id
            && (candidate.username.includes(query) || candidate.fullName.toLowerCase().includes(query)
              || candidate.id.toLowerCase().includes(query)))
          .slice(0, 20)
          .map((candidate) => ({
            ...publicUser(candidate),
            isContact: (user.contactIds || []).includes(candidate.id)
          }));
        sendJson(response, 200, users);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/discover") {
        const query = cleanText(url.searchParams.get("q") || "", 50).replace(/^@/, "").toLocaleLowerCase();
        if (query.length < 2) {
          sendJson(response, 200, { users: [], channels: [], groups: [] });
          return;
        }
        const matches = (value) => String(value || "").toLocaleLowerCase().includes(query);
        const users = currentStore.users
          .filter((candidate) => candidate.id !== user.id
            && (matches(candidate.username) || matches(candidate.fullName)))
          .slice(0, 20)
          .map(publicUser);
        const channels = currentStore.channels
          .filter((channel) => !channel.isPrivate
            && (matches(channel.name) || matches(channel.description)))
          .slice(0, 20)
          .map((channel) => ({
            id: channel.id,
            type: "channel",
            name: channel.name,
            description: channel.description || "",
            memberCount: channel.memberIds.length,
            joined: channel.memberIds.includes(user.id)
          }));
        const groups = currentStore.conversations
          .filter((conversation) => conversation.type === "group" && conversation.isPublic === true
            && (matches(conversation.name) || matches(conversation.description)))
          .slice(0, 20)
          .map((conversation) => ({
            id: conversation.id,
            type: "group",
            name: conversation.name,
            description: conversation.description || "",
            memberCount: conversation.memberIds.length,
            joined: conversation.memberIds.includes(user.id)
          }));
        sendJson(response, 200, { users, channels, groups });
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
          isPrivate: input.isPrivate === true,
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
        if (input.isPublic !== undefined && typeof input.isPublic !== "boolean") {
          throw new HttpError(400, "Invalid group settings.");
        }
        const isPublic = input.isPublic === true;
        const usernames = Array.isArray(input.usernames)
          ? input.usernames.map((value) => cleanText(value, 32).replace(/^@/, "").toLowerCase()).filter(Boolean)
          : [];
        if (Array.from(name).length < 2) throw new HttpError(400, "Group name is too short.");
        if ((!isPublic && !usernames.length) || usernames.length > 199) {
          throw new HttpError(400, "Add between 2 and 199 other participants.");
        }
        const users = usernames.map((username) =>
          currentStore.users.find((candidate) => candidate.username === username)
        );
        if (users.some((participant) => !participant)) throw new HttpError(404, "One or more usernames were not found.");
        const memberIds = [...new Set([user.id, ...users.map((participant) => participant.id)])];
        if (!isPublic && memberIds.length < 2) throw new HttpError(400, "A group must have at least one other member.");
        const conversation = {
          id: `group_${randomId()}`,
          type: "group",
          name,
          description: cleanText(input.description, 160),
          isPublic,
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

      if (request.method === "POST" && /^\/api\/groups\/[^/]+\/join$/.test(url.pathname)) {
        const id = decodePathComponent(url.pathname.split("/")[3]);
        const group = currentStore.conversations.find((item) => item.id === id && item.type === "group");
        if (!group || !group.isPublic) throw new HttpError(404, "Group not found.");
        if (!group.memberIds.includes(user.id)) {
          if (group.memberIds.length >= 200) {
            throw new HttpError(409, "Groups cannot have more than 200 participants.");
          }
          group.memberIds.push(user.id);
          group.unreadCounts = group.unreadCounts || {};
          group.unreadCounts[user.id] = 0;
          group.lastReadMessageIds = group.lastReadMessageIds || {};
          group.lastReadMessageIds[user.id] = latestMessageId(currentStore, group.id);
          user.hiddenChatIds = (user.hiddenChatIds || []).filter((hiddenId) => hiddenId !== group.id);
          await persist();
          broadcastChatMembers(group, "chat-updated", { chatId: id, action: "member-added", userId: user.id }, broadcast);
        }
        sendJson(response, 200, chatSummary(group, user.id));
        return;
      }

      if (request.method === "POST" && /^\/api\/channels\/[^/]+\/join$/.test(url.pathname)) {
        const id = decodePathComponent(url.pathname.split("/")[3]);
        const channel = currentStore.channels.find((item) => item.id === id);
        if (!channel || (channel.isPrivate && !channel.memberIds.includes(user.id))) {
          throw new HttpError(404, "Channel not found.");
        }
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
        findReadableConversation(currentStore, conversationId, user.id);
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
        const encrypted = input.encrypted === true;
        if (input.encrypted !== undefined && typeof input.encrypted !== "boolean") {
          throw new HttpError(400, "Invalid message encryption mode.");
        }
        const text = encrypted
          ? (typeof input.text === "string" ? input.text : "")
          : cleanMessageText(input.text);
        if (!encrypted && !allowLegacyPlaintext) {
          throw new HttpError(400, "End-to-end encryption is required for new messages.");
        }
        const mediaType = input.mediaType === undefined || input.mediaType === null
          ? null
          : input.mediaType;
        const attachmentIds = Array.isArray(input.attachmentIds)
          ? [...new Set(input.attachmentIds.filter((id) => typeof id === "string"))]
          : [];
        if (mediaType !== null && mediaType !== "voice") {
          throw new HttpError(400, "Invalid message media type.");
        }
        if ((!text && attachmentIds.length === 0)
          || (encrypted ? text.length > 150000 : Array.from(text).length > 4000)) {
          throw new HttpError(400, "Message must contain 1–4000 characters.");
        }
        if (encrypted && !text.startsWith("polus-e2ee:v2:")) {
          throw new HttpError(400, "Invalid encrypted message.");
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
        let pendingDirect = null;
        if (recipient) {
          let direct = findDirectConversation(currentStore, user.id, recipient.id);
          if (!direct) {
            const memberIds = [user.id, recipient.id].sort();
            pendingDirect = {
              id: `dm_${memberIds.join("_")}`,
              type: "direct",
              memberIds,
              ownerId: null,
              adminIds: [],
              unreadCounts: {},
              lastReadMessageIds: {},
              createdAt: new Date().toISOString()
            };
            direct = pendingDirect;
          }
          chatId = direct.id;
        }
        let type;
        let conversation;
        if (pendingDirect) {
          type = "direct";
          conversation = pendingDirect;
        } else {
          ({ type, conversation } = findConversation(currentStore, chatId, user.id));
        }
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
        if (type === "channel") requireChannelPermission(conversation, user.id, "publish", "publish");
        if (type === "direct") {
          const otherUserId = conversation.memberIds.find((memberId) => memberId !== user.id);
          const otherUser = currentStore.users.find((candidate) => candidate.id === otherUserId);
          const blockedByEither = (user.blockedUserIds || []).includes(otherUserId)
            || (otherUser?.blockedUserIds || []).includes(user.id);
          if (blockedByEither) throw new HttpError(403, "This user cannot receive your messages.");
        }
        let cryptoContext = null;
        if (encrypted) {
          if (!validEncryptedMessage(text, conversation, currentStore, user.id)) {
            throw new HttpError(409, "Set up end-to-end encryption for every chat participant before sending.");
          }
          cryptoContext = getEncryptedMessageContext(text);
          if (currentStore.messages.some((item) =>
            item.authorId === user.id && (item.conversationId || item.room) === chatId
            && item.cryptoCounter === cryptoContext.counter)) {
            throw new HttpError(409, "This message counter was already used. Retry sending.");
          }
        }
        const attachments = attachmentIds.map((id) =>
          currentStore.attachments.find((item) => item.id === id)
        );
        if (attachments.some((attachment) => !attachment || attachment.authorId !== user.id
          || attachment.chatId !== chatId || attachment.messageId)) {
          throw new HttpError(400, "One or more attachments are invalid.");
        }
        if (mediaType === "voice" && (attachments.length !== 1
          || (!encrypted && !attachments[0].mimeType.startsWith("audio/")))) {
          throw new HttpError(400, "A voice message must contain one audio file.");
        }
        if (pendingDirect) currentStore.conversations.push(pendingDirect);
        messageAttempts.set(user.id, [...recentAttempts, now]);
        const createdAt = new Date(now).toISOString();
        const message = {
          id: currentStore.nextMessageId++,
          conversationId: chatId,
          authorId: user.id,
          text,
          ...(encrypted ? { encrypted: true } : {}),
          ...(encrypted ? { cryptoCounter: cryptoContext.counter } : {}),
          ...(mediaType ? { mediaType } : {}),
          createdAt,
          sentAt: createdAt,
          deleted: false,
          attachmentIds,
          ...(replyToId ? { replyToId } : {})
        };
        for (const attachment of attachments) attachment.messageId = message.id;
        currentStore.links.push(...(encrypted ? [] : extractLinks(text)).map((link) => ({
          id: randomId(),
          chatId,
          messageId: message.id,
          authorId: user.id,
          createdAt,
          title: "",
          ...link
        })));
        currentStore.messages.push(message);
        unhideChatForMembers(currentStore, conversation);
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
              hideContent: recipient?.hideNotificationContent === true || message.encrypted === true
            }).catch((error) =>
              console.error("Push notification failed:", error)
            );
          }
        }
        if (type === "channel" && !conversation.isPrivate) {
          for (const [viewerId, viewerClients] of viewingClients) {
            if (conversation.memberIds.includes(viewerId) || !connectedUsers.has(viewerId)) continue;
            const isViewingChannel = [...viewerClients.values()].some((view) =>
              view.visible && view.chatId === conversation.id);
            if (isViewingChannel) broadcast(viewerId, "message", safeMessage);
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
        const input = await readJsonBody(request, { allowEmpty: true });
        const sourceMessage = currentStore.messages.find((item) => item.id === Number(decodePathComponent(saveMessageRoute[1])));
        if (!sourceMessage || sourceMessage.deleted) throw new HttpError(404, "Message not found.");
        const sourceChatId = sourceMessage.conversationId || sourceMessage.room;
        const { type: sourceType, conversation: sourceChat } = findReadableConversation(currentStore, sourceChatId, user.id);
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
        const encrypted = input.encrypted === true;
        const text = encrypted && typeof input.text === "string" ? input.text : sourceMessage.text || "";
        let cryptoContext = null;
        if (sourceMessage.encrypted && !encrypted) {
          throw new HttpError(400, "Encrypted messages must be re-encrypted before saving.");
        }
        if (encrypted) {
          if (!validEncryptedMessage(text, savedChat, currentStore, user.id)) {
            throw new HttpError(409, "Unable to verify the encrypted message for Saved Messages.");
          }
          cryptoContext = getEncryptedMessageContext(text);
          if (currentStore.messages.some((item) =>
            item.authorId === user.id && (item.conversationId || item.room) === savedChat.id
            && item.cryptoCounter === cryptoContext.counter)) {
            throw new HttpError(409, "This message counter was already used. Retry saving.");
          }
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
          text,
          ...(encrypted ? { encrypted: true, cryptoCounter: cryptoContext.counter } : {}),
          ...(!encrypted && sourceMessage.mediaType ? { mediaType: sourceMessage.mediaType } : {}),
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
        const encrypted = input.encrypted === true;
        if (input.encrypted !== undefined && typeof input.encrypted !== "boolean") {
          throw new HttpError(400, "Invalid message encryption mode.");
        }
        if (!encrypted && !allowLegacyPlaintext) {
          throw new HttpError(400, "End-to-end encryption is required for forwarded messages.");
        }
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
        if (targetType === "channel") requireChannelPermission(targetChat, user.id, "publish", "publish");
        if (targetType === "direct") {
          const otherUserId = targetChat.memberIds.find((memberId) => memberId !== user.id);
          const otherUser = currentStore.users.find((candidate) => candidate.id === otherUserId);
          if ((user.blockedUserIds || []).includes(otherUserId)
            || (otherUser?.blockedUserIds || []).includes(user.id)) {
            throw new HttpError(403, "This user cannot receive your messages.");
          }
        }
        const forwardedText = encrypted
          ? (typeof input.text === "string" ? input.text : "")
          : sourceMessage.text || "";
        const cryptoContext = encrypted ? getEncryptedMessageContext(forwardedText) : null;
        if (!forwardedText || (encrypted
          ? !validEncryptedMessage(forwardedText, targetChat, currentStore, user.id)
          : Array.from(forwardedText).length > 4000)) {
          throw new HttpError(409, "Set up end-to-end encryption for every chat participant before forwarding.");
        }
        if (encrypted && currentStore.messages.some((item) =>
          item.authorId === user.id && (item.conversationId || item.room) === targetChatId
          && item.cryptoCounter === cryptoContext.counter)) {
          throw new HttpError(409, "This message counter was already used. Retry forwarding.");
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
          text: forwardedText,
          ...(encrypted ? { encrypted: true } : {}),
          ...(encrypted ? { cryptoCounter: cryptoContext.counter } : {}),
          ...(!encrypted && sourceMessage.mediaType ? { mediaType: sourceMessage.mediaType } : {}),
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
        currentStore.links.push(...(encrypted ? [] : currentStore.links)
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
        unhideChatForMembers(currentStore, targetChat);
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
        const reactionChatId = message.conversationId || message.room;
        const reactionChat = getChatRecord(currentStore, reactionChatId);
        if (!reactionChat || !getChatRole(reactionChat, user.id)) {
          throw new HttpError(404, "Message not found.");
        }
        if (typeof input.emoji !== "string" || !MESSAGE_REACTIONS.has(input.emoji)) {
          throw new HttpError(400, "Unsupported reaction.");
        }
        const reactions = message.reactions && typeof message.reactions === "object"
          ? message.reactions
          : {};
        message.reactions = { ...reactions };
        const selectedEmoji = Object.entries(message.reactions)
          .find(([, userIds]) => Array.isArray(userIds) && userIds.includes(user.id))?.[0];
        if (selectedEmoji === input.emoji) {
          for (const [emoji, userIds] of Object.entries(message.reactions)) {
            if (!Array.isArray(userIds) || !userIds.includes(user.id)) continue;
            message.reactions[emoji] = userIds.filter((userId) => userId !== user.id);
            if (message.reactions[emoji].length === 0) delete message.reactions[emoji];
          }
        } else {
          for (const [emoji, userIds] of Object.entries(message.reactions)) {
            if (!Array.isArray(userIds) || !userIds.includes(user.id)) continue;
            message.reactions[emoji] = userIds.filter((userId) => userId !== user.id);
            if (message.reactions[emoji].length === 0) delete message.reactions[emoji];
          }
          const userIds = Array.isArray(message.reactions[input.emoji]) ? message.reactions[input.emoji] : [];
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
        const targetChatId = targetMessage?.conversationId || targetMessage?.room;
        if (!targetMessage || !canReadMessage(currentStore, targetMessage, user.id)
          || !canAccessChat(currentStore, targetChatId, user.id)) {
          throw new HttpError(404, "Message not found.");
        }
        if (targetMessage.deleted) throw new HttpError(400, "Deleted messages cannot be edited.");
        const { type: targetType, conversation: targetChat } =
          findConversation(currentStore, targetChatId, user.id);
        const targetRole = getChatRole(targetChat, user.id);
        if (targetType === "channel" && targetRole === "admin") {
          requireChannelPermission(targetChat, user.id, "editMessages", "edit messages");
        }
        const canEditOtherChannelMessages = targetType === "channel" && targetRole === "admin"
          && hasChannelPermission(targetChat, user.id, "editMessages");
        if (targetMessage.authorId !== user.id && !canEditOtherChannelMessages) {
          throw new HttpError(403, "You can only edit your own messages.");
        }
        const createdAt = Date.parse(targetMessage.createdAt || targetMessage.sentAt);
        if (!Number.isFinite(createdAt) || Date.now() - createdAt > MESSAGE_EDIT_WINDOW_MS) {
          throw new HttpError(403, "Messages can only be edited within 48 hours.");
        }
        const input = await readJsonBody(request);
        const encrypted = input.encrypted === true;
        if (!encrypted && !allowLegacyPlaintext) {
          throw new HttpError(400, "End-to-end encryption is required for edited messages.");
        }
        const text = encrypted
          ? (typeof input.text === "string" ? input.text : "")
          : cleanMessageText(input.text);
        if (!text || (encrypted ? text.length > 150000 : Array.from(text).length > 4000)
          || (encrypted && !validEncryptedMessage(text, targetChat, currentStore, user.id))) {
          throw new HttpError(400, "Message must contain 1–4000 characters.");
        }
        const cryptoContext = encrypted ? getEncryptedMessageContext(text) : null;
        if (encrypted && currentStore.messages.some((item) =>
          item.id !== targetMessage.id && item.authorId === user.id
          && (item.conversationId || item.room) === targetChatId
          && item.cryptoCounter === cryptoContext.counter)) {
          throw new HttpError(409, "This message counter was already used. Retry editing.");
        }
        targetMessage.text = text;
        targetMessage.encrypted = encrypted;
        if (encrypted) {
          targetMessage.cryptoCounter = cryptoContext.counter;
          targetMessage.signatureAuthorId = user.id;
        } else {
          delete targetMessage.cryptoCounter;
          delete targetMessage.signatureAuthorId;
        }
        targetMessage.editedAt = new Date().toISOString();
        currentStore.links = currentStore.links.filter((link) => link.messageId !== targetMessage.id);
        currentStore.links.push(...(encrypted ? [] : extractLinks(text)).map((link) => ({
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
        const chatId = message?.conversationId || message?.room;
        if (!message || !canReadMessage(currentStore, message, user.id)
          || !canAccessChat(currentStore, chatId, user.id)) {
          throw new HttpError(404, "Message not found.");
        }
        if (message.deleted) {
          sendJson(response, 200, { ok: true });
          return;
        }
        const { type, conversation } = findConversation(
          currentStore, message.conversationId || message.room, user.id
        );
        const role = getChatRole(conversation, user.id);
        if (type === "channel" && role === "admin") {
          requireChannelPermission(conversation, user.id, "deleteMessages", "delete messages");
        }
        const isModerator = type === "group"
          ? ["owner", "admin"].includes(role)
          : type === "channel" && (role === "owner"
            || role === "admin" && hasChannelPermission(conversation, user.id, "deleteMessages"));
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
        if (!sessionStreams.has(auth.session.id)) sessionStreams.set(auth.session.id, new Set());
        sessionStreams.get(auth.session.id).add(response);
        const heartbeat = setInterval(() => response.write(": keep-alive\n\n"), 25000);
        response.on("close", () => {
          clearInterval(heartbeat);
          connectedUsers.get(user.id)?.delete(response);
          const streams = sessionStreams.get(auth.session.id);
          streams?.delete(response);
          if (streams?.size === 0) sessionStreams.delete(auth.session.id);
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
      if (request.aborted && error.code === "ECONNRESET") {
        console.warn("Client disconnected before request completed:", request.method, request.url.split("?")[0]);
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
    clearInterval(sessionStreamsCleanupTimer);
    clearInterval(eventHistoryCleanupTimer);
    clearInterval(registrationAttemptsCleanupTimer);
    if (maintenanceTimer) clearInterval(maintenanceTimer);
  });
  return server;
}

function createPushPayload(message, { hideContent = false, recipientId = "" } = {}) {
  const authorName = message.author?.fullName || `@${message.author?.username || "user"}`;
  const text = typeof message.text === "string" ? message.text.trim() : "";
  return {
    title: `${authorName} · Полюс`,
    body: hideContent ? "Новое сообщение" : Array.from(text || "Вложение").slice(0, 100).join(""),
    conversationId: String(message.conversationId || message.chatId || ""),
    accountUserId: String(recipientId)
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
      await sendNotification(subscription, JSON.stringify(createPushPayload(message, {
        hideContent,
        recipientId: userId
      })));
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
    await secureDataFile(backupTemporaryPath);
    await retryFileOperation(() => renameFile(backupTemporaryPath, backupPath), retryDelay);
    await secureDataFile(backupPath);
  } catch (error) {
    await fs.rm(backupTemporaryPath, { force: true });
    if (error.code !== "ENOENT") throw error;
  }

  try {
    await fs.writeFile(temporaryPath, contents, { encoding: "utf8", mode: 0o600 });
    await secureDataFile(temporaryPath);
    await retryFileOperation(() => renameFile(temporaryPath, filePath), retryDelay);
    await secureDataFile(filePath);
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
  await secureDataDirectory(DATA_DIRECTORY);
  const { database, store } = await loadSqliteStore(DATABASE_FILE, LEGACY_DATA_FILE);
  await Promise.all([
    secureDataFile(DATABASE_FILE),
    secureDataFile(`${DATABASE_FILE}-wal`),
    secureDataFile(`${DATABASE_FILE}-shm`),
    secureDataFile(LEGACY_DATA_FILE)
  ]);
  const uploadsDirectory = path.join(DATA_DIRECTORY, "uploads");
  await fs.mkdir(uploadsDirectory, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") await fs.chmod(uploadsDirectory, 0o700);
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
  cleanupExpiredEventHistory,
  closeExpiredSessionStreams,
  cleanupExpiredData,
  createPushPayload,
  createSqliteStoreWriter,
  createStoreWriter,
  getClientAddress,
  getLanAddresses,
  validEncryptedMessage,
  migrateLegacyChannelData,
  normalizeStore,
  loadStore,
  loadSqliteStore,
  secureDataDirectory,
  secureDataFile,
  writeStoreAtomically,
  sendPushToUser,
  PRIVACY_VERSION
};