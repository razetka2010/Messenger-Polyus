const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");

const LEGACY_CHANNEL_IDS = new Set(["general", "introductions", "off-topic"]);

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
  for (const user of base.users) {
    user.pinnedChatIds = Array.isArray(user.pinnedChatIds) ? user.pinnedChatIds : [];
    user.hiddenChatIds = Array.isArray(user.hiddenChatIds) ? user.hiddenChatIds : [];
    user.contactIds = Array.isArray(user.contactIds) ? [...new Set(user.contactIds.filter((id) =>
      typeof id === "string" && id !== user.id))] : [];
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
    channel.isPrivate = channel.isPrivate === true;
    channel.memberIds = Array.isArray(channel.memberIds) ? channel.memberIds : [];
    channel.adminIds = Array.isArray(channel.adminIds) ? channel.adminIds : [];
    const storedAdminPermissions = channel.adminPermissions && typeof channel.adminPermissions === "object"
      && !Array.isArray(channel.adminPermissions) ? channel.adminPermissions : {};
    channel.adminPermissions = Object.fromEntries(channel.adminIds.map((adminId) => [
      adminId,
      {
        publish: storedAdminPermissions[adminId]?.publish !== false,
        editMessages: storedAdminPermissions[adminId]?.editMessages !== false,
        deleteMessages: storedAdminPermissions[adminId]?.deleteMessages !== false
      }
    ]));
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
    if (conversation.type === "group") conversation.isPublic = conversation.isPublic === true;
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
      created_at INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER NOT NULL,
      account_key_hash TEXT
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
  const sessionColumns = new Set(database.prepare("PRAGMA table_info(sessions)").all()
    .map((column) => column.name));
  if (!sessionColumns.has("account_key_hash")) {
    database.exec("ALTER TABLE sessions ADD COLUMN account_key_hash TEXT");
  }
  if (!sessionColumns.has("created_at")) {
    database.exec("ALTER TABLE sessions ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0");
  }
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
    [session.id, session.userId, session.tokenHash, session.createdAt || 0,
      session.expiresAt, session.accountKeyHash || null]
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
    upsert: `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, account_key_hash) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id, token_hash=excluded.token_hash,
      created_at=excluded.created_at, expires_at=excluded.expires_at, account_key_hash=excluded.account_key_hash`,
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
  store.sessions = database.prepare(`SELECT id, user_id, token_hash, created_at, expires_at, account_key_hash
    FROM sessions`).all()
    .map((row) => ({
      id: row.id,
      userId: row.user_id,
      tokenHash: row.token_hash,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      ...(row.account_key_hash ? { accountKeyHash: row.account_key_hash } : {})
    }));

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

module.exports = {
  createEmptyStore,
  createSavedConversation,
  createSqliteStoreWriter,
  getLanAddresses,
  loadSqliteStore,
  loadStore,
  migrateLegacyChannelData,
  normalizeStore
};
