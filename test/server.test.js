const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const Database = require("better-sqlite3");
const {
  createEmptyStore,
  createPushPayload,
  cleanupExpiredEventHistory,
  cleanupExpiredData,
  createSqliteStoreWriter,
  createStoreWriter,
  createMessengerServer,
  getClientAddress,
  getLanAddresses,
  validEncryptedMessage,
  closeExpiredSessionStreams,
  PRIVACY_VERSION,
  loadSqliteStore,
  loadStore,
  normalizeStore,
  secureDataDirectory,
  secureDataFile,
  sendPushToUser,
  writeStoreAtomically
} = require("../server");

test("resolves client IPs from the closest trusted proxy and ignores spoofed chains", () => {
  const trustedProxies = new Set(["127.0.0.1", "10.0.0.2"]);
  const request = (remoteAddress, forwardedFor) => ({
    socket: { remoteAddress },
    headers: { "x-forwarded-for": forwardedFor }
  });
  assert.equal(getClientAddress(request("198.51.100.9", "203.0.113.1"), trustedProxies), "198.51.100.9");
  assert.equal(
    getClientAddress(request("::ffff:127.0.0.1", "203.0.113.8, 10.0.0.2"), trustedProxies),
    "203.0.113.8"
  );
  assert.equal(
    getClientAddress(request("127.0.0.1", "203.0.113.1, 192.0.2.9"), trustedProxies),
    "192.0.2.9"
  );
  assert.equal(
    getClientAddress(request("127.0.0.1", "203.0.113.1, invalid"), trustedProxies),
    "127.0.0.1"
  );
});

test("cleans expired sessions and orphaned attachment files", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "polus-cleanup-"));
  try {
    const now = Date.now();
    const chatDirectory = path.join(directory, "uploads", "chat-1");
    await fs.mkdir(chatDirectory, { recursive: true });
    await fs.writeFile(path.join(chatDirectory, "orphan"), "file");
    await fs.writeFile(path.join(chatDirectory, "thumbnail"), "thumbnail");
    const store = createEmptyStore();
    store.sessions = [
      { id: "expired", expiresAt: now - 1 },
      { id: "active", expiresAt: now + 60_000 }
    ];
    store.attachments = [
      {
        id: "orphan",
        thumbnailId: "thumbnail",
        chatId: "chat-1",
        createdAt: new Date(now - 25 * 60 * 60 * 1000).toISOString(),
        messageId: null
      },
      {
        id: "attached",
        chatId: "chat-1",
        createdAt: new Date(now - 25 * 60 * 60 * 1000).toISOString(),
        messageId: "message-1"
      }
    ];
    store.uploadUsage = [
      { createdAt: new Date(now - 25 * 60 * 60 * 1000).toISOString() },
      { createdAt: new Date(now - 60 * 60 * 1000).toISOString() }
    ];
    let persistCount = 0;
    assert.equal(await cleanupExpiredData(store, directory, async () => { persistCount += 1; }, now), true);
    assert.equal(persistCount, 1);
    assert.deepEqual(store.sessions.map((session) => session.id), ["active"]);
    assert.deepEqual(store.attachments.map((attachment) => attachment.id), ["attached"]);
    assert.equal(store.uploadUsage.length, 1);
    await assert.rejects(fs.access(path.join(chatDirectory, "orphan")), { code: "ENOENT" });
    await assert.rejects(fs.access(path.join(chatDirectory, "thumbnail")), { code: "ENOENT" });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("cleans expired event history for disconnected users", () => {
  const recentEvents = new Map([
    ["expired", [{ id: 1, createdAt: 100 }]],
    ["recent", [{ id: 1, createdAt: 900 }]],
    ["connected", [{ id: 1, createdAt: 100 }]]
  ]);
  const eventSequences = new Map([
    ["expired", 1],
    ["recent", 1],
    ["connected", 1],
    ["orphaned", 4]
  ]);
  const connectedUsers = new Map([["connected", new Set()]]);

  assert.equal(cleanupExpiredEventHistory(recentEvents, eventSequences, connectedUsers, 500), 1);
  assert.deepEqual([...recentEvents.keys()], ["recent", "connected"]);
  assert.deepEqual([...eventSequences.keys()], ["recent", "connected"]);
});

test("closes streams whose sessions are missing or expired", () => {
  const closed = [];
  const sessionStreams = new Map([
    ["active", new Set([{ end() { closed.push("active"); } }])],
    ["expired", new Set([{ end() { closed.push("expired"); } }])],
    ["revoked", new Set([{ end() { closed.push("revoked"); } }])]
  ]);
  const sessions = [
    { id: "active", expiresAt: 200 }
  ];

  assert.equal(closeExpiredSessionStreams(sessionStreams, sessions, 100), 2);
  assert.deepEqual(closed.sort(), ["expired", "revoked"]);
  assert.deepEqual([...sessionStreams.keys()], ["active"]);
});

test("persists expired-session cleanup through the SQLite store writer", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "polus-sqlite-cleanup-"));
  let database;
  try {
    const loaded = await loadSqliteStore(
      path.join(directory, "store.sqlite"),
      path.join(directory, "legacy.json")
    );
    database = loaded.database;
    const { store } = loaded;
    store.sessions.push({
      id: "expired-session",
      userId: "cleanup-user",
      tokenHash: "expired-token",
      expiresAt: Date.now() - 1
    });
    const saveStore = createSqliteStoreWriter(database, store);
    await saveStore(store);

    assert.equal(await cleanupExpiredData(store, directory, saveStore), true);
    assert.deepEqual(store.sessions, []);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM sessions").get().count, 0);
  } finally {
    database?.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("persists account-key hashes for isolated sessions in SQLite", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "polus-account-sessions-"));
  let database;
  try {
    const databasePath = path.join(directory, "store.sqlite");
    const legacyPath = path.join(directory, "legacy.json");
    const loaded = await loadSqliteStore(databasePath, legacyPath);
    database = loaded.database;
    const saveStore = createSqliteStoreWriter(database, loaded.store);
    loaded.store.users.push({
      id: "account-user",
      username: "account_user",
      fullName: "Account User",
      passwordHash: "salt:hash"
    });

    loaded.store.sessions.push({
      id: "account-session",
      userId: "account-user",
      tokenHash: "session-hash",
      accountKeyHash: "account-key-hash",
      expiresAt: Date.now() + 60_000
    });
    await saveStore(loaded.store);
    assert.equal(database.prepare("SELECT account_key_hash FROM sessions WHERE id = ?")
      .get("account-session").account_key_hash, "account-key-hash");
    database.close();
    database = null;
    const reloaded = await loadSqliteStore(databasePath, legacyPath);
    database = reloaded.database;
    assert.equal(reloaded.store.sessions[0].accountKeyHash, "account-key-hash");
  } finally {
    database?.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("persists session creation times in SQLite", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "polus-session-created-"));
  let database;
  try {
    const databasePath = path.join(directory, "store.sqlite");
    const legacyPath = path.join(directory, "legacy.json");
    const loaded = await loadSqliteStore(databasePath, legacyPath);
    database = loaded.database;
    const saveStore = createSqliteStoreWriter(database, loaded.store);
    const createdAt = Date.now() - 1000;
    loaded.store.sessions.push({
      id: "created-session",
      userId: "created-user",
      tokenHash: "session-hash",
      createdAt,
      expiresAt: Date.now() + 60_000
    });
    await saveStore(loaded.store);
    database.close();
    database = null;
    const reloaded = await loadSqliteStore(databasePath, legacyPath);
    database = reloaded.database;
    assert.equal(reloaded.store.sessions[0].createdAt, createdAt);
  } finally {
    database?.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("lists sessions and revokes all sessions after password confirmation", async () => {
  await withServer({ store: createEmptyStore() }, async (baseUrl) => {
    const account = await register(baseUrl, "session_review", "Session Review");
    const secondLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "session_review", password: "a-secure-test-password" })
    });
    const secondCookie = secondLogin.headers.get("set-cookie").split(";")[0];
    const listed = await fetch(`${baseUrl}/api/account/sessions`, authenticatedRequest(account.cookie));
    assert.equal(listed.status, 200);
    const { sessions } = await listed.json();
    assert.equal(sessions.length, 2);
    assert.equal(sessions.filter((session) => session.isCurrent).length, 1);
    assert.ok(sessions.every((session) => Date.parse(session.createdAt) <= Date.parse(session.expiresAt)));

    const rejected = await fetch(`${baseUrl}/api/account/sessions/revoke-all`, authenticatedRequest(account.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: "wrong-password" })
    }));
    assert.equal(rejected.status, 401);
    assert.equal((await fetch(`${baseUrl}/api/bootstrap`, authenticatedRequest(secondCookie))).status, 200);

    const revoked = await fetch(`${baseUrl}/api/account/sessions/revoke-all`, authenticatedRequest(account.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: "a-secure-test-password" })
    }));
    assert.equal(revoked.status, 200);
    assert.match(revoked.headers.get("set-cookie"), /Max-Age=0/);
    assert.equal((await fetch(`${baseUrl}/api/bootstrap`, authenticatedRequest(account.cookie))).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/bootstrap`, authenticatedRequest(secondCookie))).status, 401);
  });
});

test("serves the shared encryption key only to authenticated accounts", async () => {
  const encryptionKey = "shared-encryption-key-for-tests-0123456789";
  await withServer({ store: createEmptyStore(), encryptionKey }, async (baseUrl) => {
    const publicResponse = await fetch(`${baseUrl}/api/account/encryption-config`);
    assert.equal(publicResponse.status, 401);
    const account = await register(baseUrl, "shared_key_test", "Shared Key");
    const configured = await fetch(
      `${baseUrl}/api/account/encryption-config`,
      authenticatedRequest(account.cookie)
    );
    assert.equal(configured.status, 200);
    assert.match(configured.headers.get("cache-control"), /no-store/);
    assert.deepEqual(await configured.json(), { wrappingKey: encryptionKey });
  });
  await withServer({ store: createEmptyStore(), encryptionKey: "" }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "missing_key_test",
        fullName: "Missing Key",
        password: "a-secure-test-password",
        confirmPassword: "a-secure-test-password",
        acceptPrivacy: true,
        privacyVersion: PRIVACY_VERSION
      })
    });
    assert.equal(response.status, 503);
  });
});

test("normalizes exactly one saved chat per user, including legacy single-member records", () => {
  const store = createEmptyStore();
  store.users.push(
    { id: "saved-user", username: "saved_user", fullName: "Saved User" },
    { id: "other-user", username: "other_user", fullName: "Other User" }
  );
  store.conversations.push({
    id: "legacy_saved_a",
    type: "saved",
    ownerId: "saved-user",
    memberIds: ["saved-user"],
    name: "must not persist"
  }, {
    id: "legacy_saved_b",
    type: "saved",
    ownerId: "saved-user",
    memberIds: ["saved-user"]
  }, {
    id: "legacy_single_member",
    createdBy: "other-user",
    memberIds: ["other-user"]
  });
  const normalized = normalizeStore(store);
  assert.equal(normalized.conversations.filter((chat) => chat.type === "saved").length, 2);
  const saved = normalized.conversations.find((chat) => chat.id === "saved_saved-user");
  assert.equal(saved.type, "saved");
  assert.deepEqual(saved.memberIds, ["saved-user"]);
  assert.equal(saved.ownerId, "saved-user");
  assert.equal(Object.hasOwn(saved, "name"), false);
  const migratedSingleMember = normalized.conversations.find((chat) => chat.id === "saved_other-user");
  assert.equal(migratedSingleMember.type, "saved");
  assert.deepEqual(migratedSingleMember.memberIds, ["other-user"]);
  const repeated = normalizeStore(normalized);
  assert.equal(repeated.conversations.filter((chat) => chat.type === "saved").length, 2);
});

async function withServer(options, run) {
  const server = createMessengerServer({
    allowLegacyPlaintext: true,
    encryptionKey: "shared-encryption-key-for-tests-0123456789",
    ...options
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test("creates a saved chat when registering a new user", async () => {
  await withServer({ store: createEmptyStore() }, async (baseUrl) => {
    const account = await register(baseUrl, "saved_signup", "Saved Signup");
    assert.equal(account.response.status, 201);
    const bootstrap = await fetch(`${baseUrl}/api/bootstrap`, authenticatedRequest(account.cookie));
    const { directs } = await bootstrap.json();
    assert.equal(directs.filter((chat) => chat.type === "saved").length, 1);
    assert.equal(directs[0].id, `saved_${account.body.user.id}`);
    assert.equal(directs[0].type, "saved");
    assert.equal(directs[0].name, null);
    assert.equal(directs[0].unreadCount, 0);
  });
});

test("accepts recorded voice messages and preserves their media type", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "polus-recorded-voice-"));
  try {
    await withServer({
      store: createEmptyStore(),
      dataDirectory: directory
    }, async (baseUrl) => {
      const account = await register(baseUrl, "voice_recorder", "Voice Recorder");
      const chatId = `saved_${account.body.user.id}`;
      const uploaded = await fetch(`${baseUrl}/api/chats/${chatId}/attachments`, authenticatedRequest(account.cookie, {
        method: "POST",
        headers: {
          "Content-Type": "audio/webm",
          "X-File-Mime-Type": "audio/webm",
          "X-File-Name": "voice-message.webm"
        },
        body: Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x93, 0x42, 0x82, 0x88])
      }));
      assert.equal(uploaded.status, 201);
      const attachment = await uploaded.json();
      assert.equal(attachment.mimeType, "audio/webm");
      const playableAttachment = await fetch(
        `${baseUrl}/api/attachments/${attachment.id}`,
        authenticatedRequest(account.cookie)
      );
      assert.equal(playableAttachment.status, 200);
      assert.equal(playableAttachment.headers.get("content-type"), "audio/webm");
      assert.match(playableAttachment.headers.get("content-disposition"), /^inline;/);

      const json = (value) => ({ "Content-Type": "application/json", body: JSON.stringify(value) });
      const mismatched = await fetch(`${baseUrl}/api/messages`, authenticatedRequest(account.cookie, {
        method: "POST",
        ...json({ conversationId: chatId, text: "", attachmentIds: [attachment.id], mediaType: "video_note" })
      }));
      assert.equal(mismatched.status, 400);

      const sent = await fetch(`${baseUrl}/api/messages`, authenticatedRequest(account.cookie, {
        method: "POST",
        ...json({ conversationId: chatId, text: "", attachmentIds: [attachment.id], mediaType: "voice" })
      }));
      assert.equal(sent.status, 201);
      assert.equal((await sent.json()).mediaType, "voice");
      const history = await fetch(`${baseUrl}/api/messages?conversationId=${chatId}`, authenticatedRequest(account.cookie));
      assert.equal((await history.json()).messages[0].mediaType, "voice");
    });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("protects saved chats and preserves shared files until the last message reference is removed", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "polus-saved-attachments-"));
  try {
    let persistedStore;
    let pushDeliveries = 0;
    await withServer({
      store: createEmptyStore(),
      dataDirectory: directory,
      pushSender: async () => { pushDeliveries += 1; },
      saveStore: async (current) => { persistedStore = current; }
    }, async (baseUrl) => {
      const alice = await register(baseUrl, "saved_alice", "Alice North");
      const bob = await register(baseUrl, "saved_bob", "Bob South");
      const json = (value) => ({ "Content-Type": "application/json", body: JSON.stringify(value) });
      const savedId = `saved_${alice.body.user.id}`;
      const foreignChat = await fetch(`${baseUrl}/api/chats/${savedId}`, authenticatedRequest(bob.cookie));
      await assertApiError(foreignChat, 404, "NOT_FOUND");
      const foreignMessages = await fetch(
        `${baseUrl}/api/messages?conversationId=${encodeURIComponent(savedId)}`,
        authenticatedRequest(bob.cookie)
      );
      await assertApiError(foreignMessages, 404, "NOT_FOUND");

      for (const [pathName, method, body] of [
        [`/api/chats/${savedId}`, "DELETE", undefined],
        [`/api/chats/${savedId}/hide`, "PUT", undefined],
        [`/api/chats/${savedId}/leave`, "POST", undefined],
        [`/api/chats/${savedId}/members`, "POST", { username: "saved_bob" }],
        [`/api/chats/${savedId}/owner`, "PUT", { username: "saved_bob" }]
      ]) {
        const response = await fetch(`${baseUrl}${pathName}`, authenticatedRequest(alice.cookie, {
          method,
          ...(body ? json(body) : {})
        }));
        await assertApiError(response, 400, "BAD_REQUEST");
      }

      const selfMessage = await fetch(`${baseUrl}/api/messages`, authenticatedRequest(alice.cookie, {
        method: "POST",
        ...json({ conversationId: savedId, text: "Private note" })
      }));
      assert.equal(selfMessage.status, 201);
      const selfMessageBody = await selfMessage.json();
      assert.equal(selfMessageBody.conversation.type, "saved");
      assert.equal(selfMessageBody.conversation.unreadCount, 0);
      const editedSelfMessage = await fetch(`${baseUrl}/api/messages/${selfMessageBody.id}`, authenticatedRequest(alice.cookie, {
        method: "PATCH",
        ...json({ text: "Edited private note" })
      }));
      assert.equal(editedSelfMessage.status, 200);
      assert.equal((await editedSelfMessage.json()).text, "Edited private note");

      const sourceResponse = await fetch(`${baseUrl}/api/messages`, authenticatedRequest(alice.cookie, {
        method: "POST",
        ...json({ recipientUsername: "saved_bob", text: "Remember https://example.org" })
      }));
      const source = await sourceResponse.json();
      const uploaded = await fetch(`${baseUrl}/api/chats/${source.conversation.id}/attachments`,
        authenticatedRequest(alice.cookie, {
          method: "POST",
          headers: { "X-File-Name": "shared.txt", "Content-Type": "application/octet-stream" },
          body: Buffer.from("shared attachment contents")
        }));
      assert.equal(uploaded.status, 201);
      const uploadedAttachment = await uploaded.json();
      const sourceWithAttachment = await fetch(`${baseUrl}/api/messages`, authenticatedRequest(alice.cookie, {
        method: "POST",
        ...json({
          conversationId: source.conversation.id,
          text: "Saved source https://example.org/path",
          attachmentIds: [uploadedAttachment.id]
        })
      }));
      const sourceMessage = await sourceWithAttachment.json();
      const pushesBeforeSave = pushDeliveries;
      const savedResponse = await fetch(`${baseUrl}/api/messages/${sourceMessage.id}/save`,
        authenticatedRequest(alice.cookie, { method: "POST" }));
      assert.equal(savedResponse.status, 201);
      const savedCopy = await savedResponse.json();
      assert.equal(savedCopy.conversationId, savedId);
      assert.equal(pushDeliveries, pushesBeforeSave);
      assert.equal(savedCopy.text, sourceMessage.text);
      assert.deepEqual(savedCopy.savedSource, {
        chatName: "Bob South",
        authorName: "Alice North",
        authorUsername: "saved_alice"
      });
      assert.notEqual(savedCopy.attachments[0].id, uploadedAttachment.id);
      const copiedAttachment = persistedStore.attachments.find((item) => item.id === savedCopy.attachments[0].id);
      assert.equal(copiedAttachment.storageId, uploadedAttachment.id);
      assert.equal(copiedAttachment.storageChatId, source.conversation.id);

      const savedBootstrap = await fetch(`${baseUrl}/api/bootstrap`, authenticatedRequest(alice.cookie));
      assert.equal((await savedBootstrap.json()).directs.find((chat) => chat.id === savedId).unreadCount, 0);
      const savedHistory = await fetch(`${baseUrl}/api/messages?conversationId=${encodeURIComponent(savedId)}`,
        authenticatedRequest(alice.cookie));
      assert.ok((await savedHistory.json()).messages.some((message) => message.id === savedCopy.id));
      const savedLinks = await fetch(`${baseUrl}/api/chats/${savedId}/materials?kind=links`,
        authenticatedRequest(alice.cookie));
      assert.equal((await savedLinks.json()).items.some((link) => link.url === "https://example.org/path"), true);

      const sourceFile = path.join(directory, "uploads", source.conversation.id, uploadedAttachment.id);
      const savedAttachmentResponse = await fetch(
        `${baseUrl}/api/attachments/${savedCopy.attachments[0].id}`,
        authenticatedRequest(alice.cookie)
      );
      assert.equal(savedAttachmentResponse.status, 200);
      const deletedSource = await fetch(`${baseUrl}/api/messages/${sourceMessage.id}`,
        authenticatedRequest(alice.cookie, { method: "DELETE" }));
      assert.equal(deletedSource.status, 200);
      assert.equal((await fs.readFile(sourceFile, "utf8")), "shared attachment contents");
      const savedAfterSourceDelete = await fetch(
        `${baseUrl}/api/messages?conversationId=${encodeURIComponent(savedId)}`,
        authenticatedRequest(alice.cookie)
      );
      assert.ok((await savedAfterSourceDelete.json()).messages.some((message) =>
        message.id === savedCopy.id && message.attachments.length === 1
      ));

      const deletedSavedCopy = await fetch(`${baseUrl}/api/messages/${savedCopy.id}`,
        authenticatedRequest(alice.cookie, { method: "DELETE" }));
      assert.equal(deletedSavedCopy.status, 200);
      await assert.rejects(fs.access(sourceFile), { code: "ENOENT" });
    });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("replies to messages, toggles private reactions, and forwards messages with shared attachments", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "polus-message-actions-"));
  try {
    let persistedStore;
    await withServer({
      store: createEmptyStore(),
      dataDirectory: directory,
      saveStore: async (current) => { persistedStore = current; }
    }, async (baseUrl) => {
      const alice = await register(baseUrl, "actions_alice", "Alice North");
      const bob = await register(baseUrl, "actions_bob", "Bob South");
      const carol = await register(baseUrl, "actions_carol", "Carol West");
      const json = (value) => ({ "Content-Type": "application/json", body: JSON.stringify(value) });
      const sourceResponse = await fetch(`${baseUrl}/api/messages`,
        authenticatedRequest(alice.cookie, {
          method: "POST",
          ...json({ recipientUsername: "actions_bob", text: "Forward this https://example.org/source" })
        }));
      assert.equal(sourceResponse.status, 201);
      const source = await sourceResponse.json();
      const channelResponse = await fetch(`${baseUrl}/api/channels`,
        authenticatedRequest(alice.cookie, {
          method: "POST",
          ...json({ name: "Forward target", description: "" })
        }));
      assert.equal(channelResponse.status, 201);
      const channel = await channelResponse.json();
      const joinedChannel = await fetch(
        `${baseUrl}/api/channels/${encodeURIComponent(channel.id)}/join`,
        authenticatedRequest(bob.cookie, { method: "POST" })
      );
      assert.equal(joinedChannel.status, 200);
      const forbiddenChannelForward = await fetch(
        `${baseUrl}/api/messages/${source.id}/forward`,
        authenticatedRequest(bob.cookie, {
          method: "POST",
          ...json({ conversationId: channel.id })
        })
      );
      await assertApiError(forbiddenChannelForward, 403, "FORBIDDEN");
      const uploadedResponse = await fetch(
        `${baseUrl}/api/chats/${encodeURIComponent(source.conversationId)}/attachments`,
        authenticatedRequest(alice.cookie, {
          method: "POST",
          headers: { "X-File-Name": "forwarded.txt", "Content-Type": "application/octet-stream" },
          body: Buffer.from("shared forwarded file")
        })
      );
      assert.equal(uploadedResponse.status, 201);
      const uploaded = await uploadedResponse.json();
      const sourceWithFileResponse = await fetch(`${baseUrl}/api/messages`,
        authenticatedRequest(alice.cookie, {
          method: "POST",
          ...json({
            conversationId: source.conversationId,
            text: "Forward this https://example.org/source",
            attachmentIds: [uploaded.id]
          })
        }));
      assert.equal(sourceWithFileResponse.status, 201);
      const sourceWithFile = await sourceWithFileResponse.json();
      const aliceHistoryUrl = `${baseUrl}/api/messages?conversationId=${encodeURIComponent(source.conversationId)}`;
      const unreadHistoryResponse = await fetch(aliceHistoryUrl, authenticatedRequest(alice.cookie));
      const unreadHistory = await unreadHistoryResponse.json();
      assert.equal(unreadHistory.messages.find((message) => message.id === sourceWithFile.id).seenByRecipient, false);
      const bobReadResponse = await fetch(`${baseUrl}/api/conversations/read`,
        authenticatedRequest(bob.cookie, {
          method: "POST",
          ...json({ conversationId: source.conversationId })
        }));
      assert.equal(bobReadResponse.status, 200);
      const readHistoryResponse = await fetch(aliceHistoryUrl, authenticatedRequest(alice.cookie));
      const readHistory = await readHistoryResponse.json();
      assert.equal(readHistory.messages.find((message) => message.id === sourceWithFile.id).seenByRecipient, true);

      const replyResponse = await fetch(`${baseUrl}/api/messages`,
        authenticatedRequest(alice.cookie, {
          method: "POST",
          ...json({
            conversationId: source.conversationId,
            text: "A reply",
            replyToId: sourceWithFile.id
          })
        }));
      assert.equal(replyResponse.status, 201);
      const reply = await replyResponse.json();
      assert.equal(reply.replyTo.id, sourceWithFile.id);
      assert.equal(reply.replyTo.author.username, "actions_alice");
      assert.equal(reply.replyTo.text, sourceWithFile.text);

      const crossChatReply = await fetch(`${baseUrl}/api/messages`,
        authenticatedRequest(alice.cookie, {
          method: "POST",
          ...json({
            conversationId: `saved_${alice.body.user.id}`,
            text: "Invalid cross-chat reply",
            replyToId: sourceWithFile.id
          })
        }));
      await assertApiError(crossChatReply, 404, "NOT_FOUND");

      const react = async (cookie, messageId, emoji) => fetch(
        `${baseUrl}/api/messages/${messageId}/reactions`,
        authenticatedRequest(cookie, { method: "POST", ...json({ emoji }) })
      );
      const aliceReaction = await react(alice.cookie, sourceWithFile.id, "👍");
      assert.equal(aliceReaction.status, 200);
      assert.deepEqual((await aliceReaction.json()).reactions, [
        { emoji: "👍", count: 1, reactedByMe: true }
      ]);
      const bobHistoryResponse = await fetch(
        `${baseUrl}/api/messages?conversationId=${encodeURIComponent(source.conversationId)}`,
        authenticatedRequest(bob.cookie)
      );
      const bobSource = (await bobHistoryResponse.json()).messages
        .find((message) => message.id === sourceWithFile.id);
      assert.deepEqual(bobSource.reactions, [{ emoji: "👍", count: 1, reactedByMe: false }]);
      const bobReaction = await react(bob.cookie, sourceWithFile.id, "👍");
      assert.equal((await bobReaction.json()).reactions[0].count, 2);
      const aliceSwitchedReaction = await react(alice.cookie, sourceWithFile.id, "🚀");
      assert.deepEqual((await aliceSwitchedReaction.json()).reactions, [
        { emoji: "👍", count: 1, reactedByMe: false },
        { emoji: "🚀", count: 1, reactedByMe: true }
      ]);
      const aliceSwitchedBack = await react(alice.cookie, sourceWithFile.id, "👍");
      assert.deepEqual((await aliceSwitchedBack.json()).reactions, [
        { emoji: "👍", count: 2, reactedByMe: true }
      ]);
      const aliceRemoval = await react(alice.cookie, sourceWithFile.id, "👍");
      assert.deepEqual((await aliceRemoval.json()).reactions, [
        { emoji: "👍", count: 1, reactedByMe: false }
      ]);
      await assertApiError(await react(alice.cookie, sourceWithFile.id, "not-an-emoji"), 400, "BAD_REQUEST");
      await assertApiError(await react(carol.cookie, sourceWithFile.id, "❤️"), 404, "NOT_FOUND");

      const existingChatForward = await fetch(
        `${baseUrl}/api/messages/${sourceWithFile.id}/forward`,
        authenticatedRequest(alice.cookie, {
          method: "POST",
          ...json({ conversationId: source.conversationId })
        })
      );
      assert.equal(existingChatForward.status, 201);
      const sameChatCopy = await existingChatForward.json();
      assert.equal(sameChatCopy.forwardedFrom.authorName, "Alice North");
      assert.equal(sameChatCopy.attachments.length, 1);
      assert.notEqual(sameChatCopy.attachments[0].id, uploaded.id);

      const userForwardResponse = await fetch(
        `${baseUrl}/api/messages/${sourceWithFile.id}/forward`,
        authenticatedRequest(alice.cookie, {
          method: "POST",
          ...json({ recipientUsername: "actions_carol" })
        })
      );
      assert.equal(userForwardResponse.status, 201);
      const forwarded = await userForwardResponse.json();
      assert.equal(forwarded.text, sourceWithFile.text);
      assert.equal(forwarded.forwardedFrom.authorName, "Alice North");
      assert.equal(forwarded.forwardedFrom.chatName, "Bob South");
      assert.notEqual(forwarded.attachments[0].id, uploaded.id);
      const copiedAttachment = persistedStore.attachments.find((item) => item.id === forwarded.attachments[0].id);
      assert.equal(copiedAttachment.storageId, uploaded.id);
      assert.equal(copiedAttachment.storageChatId, source.conversationId);

      const deletedSource = await fetch(`${baseUrl}/api/messages/${sourceWithFile.id}`,
        authenticatedRequest(alice.cookie, { method: "DELETE" }));
      assert.equal(deletedSource.status, 200);
      const sourceFile = path.join(directory, "uploads", source.conversationId, uploaded.id);
      assert.equal((await fs.readFile(sourceFile)).toString(), "shared forwarded file");
      const forwardedFileResponse = await fetch(
        `${baseUrl}/api/attachments/${encodeURIComponent(forwarded.attachments[0].id)}`,
        authenticatedRequest(carol.cookie)
      );
      assert.equal(forwardedFileResponse.status, 200);
      assert.equal(await forwardedFileResponse.text(), "shared forwarded file");

      const historyAfterDeletion = await fetch(
        `${baseUrl}/api/messages?conversationId=${encodeURIComponent(forwarded.conversationId)}`,
        authenticatedRequest(carol.cookie)
      );
      const retainedCopy = (await historyAfterDeletion.json()).messages
        .find((message) => message.id === forwarded.id);
      assert.equal(retainedCopy.text, sourceWithFile.text);
      assert.equal(retainedCopy.attachments.length, 1);
      assert.equal((await fetch(`${baseUrl}/api/messages/${sameChatCopy.id}`,
        authenticatedRequest(alice.cookie, { method: "DELETE" }))).status, 200);
      assert.equal((await fs.readFile(sourceFile)).toString(), "shared forwarded file");
      assert.equal((await fetch(`${baseUrl}/api/messages/${forwarded.id}`,
        authenticatedRequest(alice.cookie, { method: "DELETE" }))).status, 200);
      await assert.rejects(fs.access(sourceFile), { code: "ENOENT" });
    });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

async function register(baseUrl, username, fullName = username) {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username,
      fullName,
      password: "a-secure-test-password",
      confirmPassword: "a-secure-test-password",
      acceptPrivacy: true,
      privacyVersion: PRIVACY_VERSION
    })
  });
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  return { response, cookie, body: await response.json() };
}

function authenticatedRequest(cookie, options = {}) {
  return {
    ...options,
    headers: { ...(options.headers || {}), Cookie: cookie }
  };
}

function assertApiErrorBody(body, code) {
  assert.deepEqual(Object.keys(body), ["error"]);
  assert.deepEqual(Object.keys(body.error).sort(), ["code", "message"]);
  assert.equal(body.error.code, code);
  assert.equal(typeof body.error.message, "string");
  assert.ok(body.error.message.length > 0);
}

async function assertApiError(response, status, code) {
  assert.equal(response.status, status);
  assertApiErrorBody(await response.json(), code);
}

test("delivers a saved-message event to every account stream and no other account", async () => {
  await withServer({ store: createEmptyStore() }, async (baseUrl) => {
    const owner = await register(baseUrl, "stream_saved_owner", "Saved Owner");
    const other = await register(baseUrl, "stream_saved_other", "Other User");
    const sourceResponse = await fetch(`${baseUrl}/api/messages`, authenticatedRequest(owner.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipientUsername: "stream_saved_other", text: "Save this" })
    }));
    const source = await sourceResponse.json();
    const controllers = [new AbortController(), new AbortController(), new AbortController()];
    const readers = [];
    try {
      for (const [cookie, index] of [
        [owner.cookie, 0],
        [owner.cookie, 1],
        [other.cookie, 2]
      ]) {
        const response = await fetch(`${baseUrl}/api/stream`, {
          headers: { Cookie: cookie },
          signal: controllers[index].signal
        });
        const reader = response.body.getReader();
        readers.push(reader);
        assert.match(new TextDecoder().decode((await reader.read()).value), /retry: 3000/);
      }

      const savedResponse = await fetch(`${baseUrl}/api/messages/${source.id}/save`,
        authenticatedRequest(owner.cookie, { method: "POST" }));
      assert.equal(savedResponse.status, 201);
      const saved = await savedResponse.json();
      for (const reader of readers.slice(0, 2)) {
        const { value, done } = await reader.read();
        assert.equal(done, false);
        const event = new TextDecoder().decode(value);
        assert.match(event, /event: message/);
        assert.match(event, new RegExp(`"id":${saved.id}`));
      }
      const otherEvent = await Promise.race([
        readers[2].read(),
        new Promise((resolve) => setTimeout(() => resolve(null), 100))
      ]);
      assert.equal(otherEvent, null);
    } finally {
      for (const controller of controllers) controller.abort();
      await Promise.all(readers.map((reader) => reader.cancel().catch(() => {})));
    }
  });
});

test("imports an existing JSON store into normalized SQLite tables without changing the source", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "polus-sqlite-migration-"));
  const legacyPath = path.join(directory, "polus-store.json");
  const databasePath = path.join(directory, "polus.sqlite");
  const legacyStore = createEmptyStore();
  legacyStore.users.push({
    id: "user-1",
    username: "north_star",
    fullName: "North Star",
    passwordHash: "salt:hash"
  });
  legacyStore.channels.push({
    id: "chat-1",
    type: "channel",
    name: "Northern lights",
    createdBy: "user-1",
    ownerId: "user-1",
    memberIds: ["user-1"],
    adminIds: [],
    lastReadMessageIds: { "user-1": 0 },
    unreadCounts: { "user-1": 0 }
  });
  legacyStore.messages.push({
    id: 1,
    conversationId: "chat-1",
    authorId: "someone-else",
    text: "Stored separately",
    createdAt: new Date(1).toISOString(),
    attachmentIds: []
  });
  legacyStore.pushSubscriptions.push(
    { userId: "user-1", subscription: { endpoint: "https://notify.windows.com/one", keys: {} } },
    { userId: "user-2", subscription: { endpoint: "https://notify.windows.com/one", keys: {} } }
  );
  legacyStore.nextMessageId = 2;
  const sourceSnapshot = JSON.stringify(legacyStore);
  const databases = [];

  try {
    await fs.writeFile(legacyPath, sourceSnapshot, "utf8");
    const firstLoad = await loadSqliteStore(databasePath, legacyPath);
    databases.push(firstLoad.database);
    assert.equal(firstLoad.store.users[0].username, "north_star");
    const saveStore = createSqliteStoreWriter(firstLoad.database, firstLoad.store);
    firstLoad.store.messages.push({
      id: 2,
      conversationId: "chat-1",
      authorId: "someone-else",
      text: "Incremental insert",
      createdAt: new Date(2).toISOString(),
      attachmentIds: []
    });
    firstLoad.store.nextMessageId = 3;
    await saveStore(firstLoad.store);
    firstLoad.store.messages.push({
      id: 3,
      conversationId: "chat-1",
      authorId: "someone-else",
      text: "One more insert",
      createdAt: new Date(3).toISOString(),
      attachmentIds: []
    });
    firstLoad.store.nextMessageId = 4;
    await saveStore(firstLoad.store);
    assert.equal(saveStore.countUnreadMessages("chat-1", 0, "user-1"), 3);
    assert.equal(saveStore.lastMessageForChat("chat-1").text, "One more insert");
    const tables = firstLoad.database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    ).all().map((row) => row.name);
    for (const table of ["users", "sessions", "chats", "members", "messages", "attachments", "push_subscriptions"]) {
      assert.ok(tables.includes(table), `missing normalized table ${table}`);
    }
    assert.ok(!tables.includes("polus_store"));

    await fs.writeFile(legacyPath, "{}", "utf8");
    const secondLoad = await loadSqliteStore(databasePath, legacyPath);
    databases.push(secondLoad.database);
    assert.equal(secondLoad.store.users[0].username, "north_star");
    assert.equal(secondLoad.store.users[0].passwordHash, "salt:hash");
    assert.equal(secondLoad.store.messages.length, 3);
    assert.equal(secondLoad.store.channels[0].memberIds[0], "user-1");
    assert.equal(secondLoad.store.pushSubscriptions.length, 2);
    assert.equal(await fs.readFile(legacyPath, "utf8"), "{}");
    assert.equal((await fs.readFile(databasePath)).subarray(0, 15).toString(), "SQLite format 3");
  } finally {
    for (const database of databases) database.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("migrates the former SQLite snapshot table into normalized tables", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "polus-sqlite-snapshot-"));
  const databasePath = path.join(directory, "polus.sqlite");
  const legacyStore = createEmptyStore();
  legacyStore.users.push({
    id: "snapshot-user",
    username: "snapshot_user",
    fullName: "Snapshot User",
    passwordHash: "salt:hash"
  });
  const legacyDatabase = new Database(databasePath);
  legacyDatabase.exec(`CREATE TABLE polus_store (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    snapshot TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  legacyDatabase.prepare("INSERT INTO polus_store (id, snapshot) VALUES (1, ?)").run(JSON.stringify(legacyStore));
  legacyDatabase.close();

  let database;
  try {
    const loaded = await loadSqliteStore(databasePath, path.join(directory, "missing.json"));
    database = loaded.database;
    assert.equal(loaded.store.users[0].username, "snapshot_user");
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM users").get().count, 1);
    assert.equal(database.prepare(
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'polus_store'"
    ).get().count, 0);
  } finally {
    database?.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("lists usable LAN IPv4 addresses for the startup URL", () => {
  const addresses = getLanAddresses({
    ethernet: [
      { address: "192.168.1.25", family: "IPv4", internal: false },
      { address: "169.254.2.10", family: "IPv4", internal: false },
      { address: "127.0.0.1", family: "IPv4", internal: true }
    ],
    wifi: [{ address: "10.0.0.8", family: 4, internal: false }],
    virtual: [{ address: "192.168.1.25", family: "IPv4", internal: false }]
  });
  assert.deepEqual(addresses, ["10.0.0.8", "192.168.1.25"]);
});

test("retries transient Windows rename errors and keeps a previous store backup", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "polus-atomic-store-"));
  const filePath = path.join(directory, "polus-store.json");
  try {
    await fs.writeFile(filePath, '{"revision":1}', "utf8");
    let attempts = 0;
    await writeStoreAtomically(filePath, '{"revision":2}', {
      renameFile: async (source, destination) => {
        if (destination === filePath && attempts < 2) {
          attempts += 1;
          const error = new Error("File is temporarily locked.");
          error.code = "EPERM";
          throw error;
        }
        return fs.rename(source, destination);
      },
      retryDelay: async () => {}
    });

    assert.equal(attempts, 2);
    assert.equal(await fs.readFile(filePath, "utf8"), '{"revision":2}');
    assert.equal(await fs.readFile(`${filePath}.bak`, "utf8"), '{"revision":1}');
    if (process.platform !== "win32") {
      assert.equal((await fs.stat(filePath)).mode & 0o777, 0o600);
      assert.equal((await fs.stat(`${filePath}.bak`)).mode & 0o777, 0o600);
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("restricts data-directory permissions on POSIX systems", async () => {
  const directory = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "polus-private-data-")), "data");
  try {
    await secureDataDirectory(directory);
    await fs.writeFile(path.join(directory, "state"), "secret", "utf8");
    await secureDataFile(path.join(directory, "state"));
    if (process.platform !== "win32") {
      assert.equal((await fs.stat(directory)).mode & 0o777, 0o700);
      assert.equal((await fs.stat(path.join(directory, "state"))).mode & 0o777, 0o600);
    }
  } finally {
    await fs.rm(path.dirname(directory), { recursive: true, force: true });
  }
});

test("does not replace the store when Windows keeps the destination locked", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "polus-locked-store-"));
  const filePath = path.join(directory, "polus-store.json");
  try {
    await fs.writeFile(filePath, '{"revision":1}', "utf8");
    await assert.rejects(writeStoreAtomically(filePath, '{"revision":2}', {
      renameFile: async (source, destination) => {
        if (destination === filePath) {
          const error = new Error("File remains locked.");
          error.code = "EPERM";
          throw error;
        }
        return fs.rename(source, destination);
      },
      retryDelay: async () => {}
    }), { code: "EPERM" });
    assert.equal(await fs.readFile(filePath, "utf8"), '{"revision":1}');
    assert.deepEqual((await fs.readdir(directory)).sort(), ["polus-store.json", "polus-store.json.bak"]);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("serializes concurrent store writes and leaves a backup of the preceding revision", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "polus-store-queue-"));
  const filePath = path.join(directory, "store.json");
  let activeRenames = 0;
  let maximumActiveRenames = 0;
  try {
    const save = createStoreWriter(filePath, {
      renameFile: async (source, destination) => {
        activeRenames += 1;
        maximumActiveRenames = Math.max(maximumActiveRenames, activeRenames);
        await new Promise((resolve) => setTimeout(resolve, 5));
        try {
          await fs.rename(source, destination);
        } finally {
          activeRenames -= 1;
        }
      },
      retryDelay: async () => {}
    });
    await Promise.all([
      save({ revision: 1 }),
      save({ revision: 2 }),
      save({ revision: 3 })
    ]);

    assert.equal(maximumActiveRenames, 1);
    assert.deepEqual(JSON.parse(await fs.readFile(filePath, "utf8")), { revision: 3 });
    assert.deepEqual(JSON.parse(await fs.readFile(`${filePath}.bak`, "utf8")), { revision: 2 });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("removes expired push subscriptions without deleting another device subscription", async () => {
  const store = {
    pushSubscriptions: [
      { userId: "bob", subscription: { endpoint: "https://push.services.mozilla.com/expired" } },
      { userId: "bob", subscription: { endpoint: "https://push.services.mozilla.com/active" } },
      { userId: "alice", subscription: { endpoint: "https://push.services.mozilla.com/expired" } }
    ]
  };
  let persisted = 0;
  await sendPushToUser(store, "bob", {
    conversationId: "chat",
    author: { username: "alice", fullName: "Alice" },
    text: "Hello"
  }, async () => { persisted += 1; }, {
    sendNotification: async (subscription) => {
      if (subscription.endpoint.endsWith("/expired")) {
        const error = new Error("Gone");
        error.statusCode = 410;
        throw error;
      }
    }
  });

  assert.equal(persisted, 1);
  assert.deepEqual(store.pushSubscriptions.map((item) => item.userId), ["bob", "alice"]);
  assert.equal(store.pushSubscriptions[0].subscription.endpoint.endsWith("/active"), true);
});

test("builds short push previews and hides message content when requested", () => {
  const message = {
    conversationId: "channel-1",
    author: { username: "alice", fullName: "Alice North" },
    text: "x".repeat(150)
  };
  const visible = createPushPayload(message);
  assert.equal(visible.title, "Alice North · Полюс");
  assert.equal(visible.body.length, 100);
  assert.equal(visible.conversationId, "channel-1");
  assert.equal(createPushPayload(message, { recipientId: "recipient-1" }).accountUserId, "recipient-1");
  assert.equal(createPushPayload(message, { hideContent: true }).body, "Новое сообщение");
});

test("serves Polus, its logo, privacy page and English/Russian app", async () => {
  await withServer({}, async (baseUrl) => {
    const config = await fetch(`${baseUrl}/api/config`);
    assert.equal((await config.json()).privacyVersion, PRIVACY_VERSION);

    const page = await fetch(baseUrl);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("x-powered-by"), null);
    assert.match(page.headers.get("content-security-policy"), /img-src 'self' data: blob:/);
    assert.match(page.headers.get("content-security-policy"), /media-src 'self' blob:/);
    assert.equal(page.headers.get("strict-transport-security"), null);
    const pageBody = await page.text();
    const builtClient = pageBody.includes('id="root"');
    if (builtClient) {
      assert.match(pageBody, /\/assets\/index-[^"]+\.js/);
    }
    const profilePage = await fetch(`${baseUrl}/profile`);
    assert.equal(profilePage.status, 200);
    assert.equal(profilePage.headers.get("content-type"), "text/html; charset=utf-8");
    assert.match(await profilePage.text(), /id="root"/);
    const publicUserPage = await fetch(`${baseUrl}/users/profile_user`);
    assert.equal(publicUserPage.status, 200);
    assert.equal(publicUserPage.headers.get("content-type"), "text/html; charset=utf-8");
    assert.match(await publicUserPage.text(), /id="root"/);

    const styles = await fetch(`${baseUrl}/styles.css`);
    const stylesBody = await styles.text();
    assert.match(stylesBody, /\.send-button\s*\{[^}]*border-radius:\s*50%/s);
    assert.match(stylesBody, /\.message-avatar\.avatar-tone-0\s*\{[^}]*background:/s);

    assert.equal((await fetch(`${baseUrl}/app.js`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/legacy-app.html`)).status, 404);
    const controllerSource = await fs.readFile(path.join(__dirname, "..", "client", "src", "messengerController.js"), "utf8");
    assert.match(controllerSource, /polus:message-context-menu-request/);
    assert.match(controllerSource, /controllerListeners\.splice\(0\)/);
    assert.match(controllerSource, /openMessageContextMenu/);
    assert.doesNotMatch(controllerSource, /chatInfoContent|chatManagementContent|addManagementButton/);
    assert.doesNotMatch(controllerSource, /#message-input|#composer|#attachment-input|#user-search|#sidebar-search/);
    assert.doesNotMatch(controllerSource, /searchUsers|polus:user-search|polus:users-changed/);
    assert.doesNotMatch(controllerSource, /startDirectMessage|\/api\/directs/);
    assert.doesNotMatch(controllerSource, /async function createChannel|async function createGroup|listen\(document, "polus:create-(channel|group)"/);
    assert.doesNotMatch(controllerSource, /async function saveProfile|listen\(document, "polus:save-profile"/);
    const reactSource = await fs.readFile(path.join(__dirname, "..", "client", "src", "App.jsx"), "utf8");
    assert.match(reactSource, /function DiscoverySearchResults\(\{ query, conversations, onOpenConversation \}\)/);
    assert.match(reactSource, /requestJson\(`\/api\/discover\?q=\$\{encodeURIComponent\(query\)\}`\)/);
    assert.match(reactSource, /polus:request-direct-message/);
    assert.match(reactSource, /\/api\/directs\/\$\{encodeURIComponent\(event\.detail\.username\)\}/);
    assert.match(reactSource, /const handleCreateChannel = \(event\) => void handleCreateRequest\(event\)/);
    assert.match(reactSource, /const endpoint = channel \? \"\/api\/channels\" : \"\/api\/groups\"/);
    assert.match(reactSource, /A group must have at least one other member\./);
    assert.match(reactSource, /const handleSaveProfile = async \(event\)/);
    assert.match(reactSource, /requestJson\(\"\/api\/account\", \{/);
    assert.match(reactSource, /polus:profile-saved/);
    assert.doesNotMatch(controllerSource, /async function submitMessage|uploadSelectedFiles|polus:submit-message|polus:upload-selected-files/);
    assert.match(reactSource, /requestJson\("\/api\/messages"/);
    assert.match(reactSource, /uploadAttachment\(\s*conversationId/);
    assert.match(reactSource, /polus:message-sent/);
    assert.doesNotMatch(controllerSource, /async function editMessage|async function deleteMessage|polus:edit-message|polus:delete-message/);
    assert.match(reactSource, /const handleEditMessage = async \(event\)/);
    assert.match(reactSource, /body: JSON\.stringify\(\{ text: encryptedText, encrypted: true \}\)/);
    assert.match(reactSource, /const handleDeleteMessage = async \(event\)/);
    assert.match(reactSource, /polus:message-edited/);
    assert.match(reactSource, /polus:message-deleted/);
    assert.doesNotMatch(controllerSource, /api\(`\/api\/messages\?`|api\(\"\/api\/conversations\/read\"/);
    assert.match(reactSource, /polus:load-message-history/);
    assert.match(reactSource, /polus:mark-conversation-read/);
    assert.match(reactSource, /requestJson\(`\/api\/messages\?\$\{query\}`\)/);
    assert.match(reactSource, /requestJson\(\"\/api\/conversations\/read\"/);
    assert.doesNotMatch(controllerSource, /new EventSource|\/api\/stream|\/api\/presence\/chat|reportChatViewingState|viewingHeartbeatTimer/);
    assert.match(reactSource, /connectEventStream\(\"\/api\/stream\", \{/);
    assert.match(reactSource, /fetch\(\"\/api\/presence\/chat\", \{/);
    assert.doesNotMatch(reactSource, /new EventSource|accountApiUrl/);
    assert.match(reactSource, /document\.addEventListener\(\"polus:composer-state\", handlePresenceConversation\)/);
    assert.match(reactSource, /polus:realtime-message/);
    assert.match(reactSource, /ПОЛЮС/);
    assert.match(reactSource, /function MessengerShell\(/);
    assert.match(reactSource, /<main id="messenger-view"/);
    assert.doesNotMatch(reactSource, /LegacyMessenger|legacy-app\.html|createRoot\(document\.getElementById/);
    assert.doesNotMatch(reactSource, /MutationObserver/);
    assert.match(reactSource, /disposeController\?\.\(\)/);
    assert.doesNotMatch(reactSource, /data-i18n/);
    assert.doesNotMatch(controllerSource, /applyTranslations|querySelectorAll/);
    assert.match(reactSource, /function SidebarSearch\(/);
    assert.match(reactSource, /function ChatSearchDialog\(/);
    assert.match(reactSource, /aria-expanded=\{menuOpen\}/);
    assert.match(reactSource, /polus:create-channel/);
    assert.match(reactSource, /polus:save-profile/);
    assert.match(reactSource, /function ChatInfoDialogContent\(\)/);
    assert.match(reactSource, /function ChatManagementContent\(\)/);
    assert.match(reactSource, /function ProfileAvatarEditor\(\{ inputRef \}\)/);
    assert.match(reactSource, /function HeaderActions\(\)/);
    assert.match(reactSource, /function MediaViewer\(\)/);
    assert.match(reactSource, /polus:media-viewer-open/);
    assert.doesNotMatch(controllerSource, /mediaViewerIndex|navigateMediaViewer/);
    assert.match(reactSource, /profile-avatar-picker/);
    assert.match(reactSource, /profile-avatar-preview/);
    assert.match(reactSource, /id="chat-search"/);
    assert.match(reactSource, /info-member-avatar/);
    assert.match(reactSource, /info-member-role/);
    assert.doesNotMatch(controllerSource, /avatar\.replaceChildren\(\)|preview\.replaceChildren\(\)/);

    assert.match(stylesBody, /\.info-member\s*\{/);
    assert.match(stylesBody, /\.info-member-meta\s*\{/);

    const logo = await fetch(`${baseUrl}/logo.svg`);
    assert.equal(logo.status, 200);
    assert.match(await logo.text(), /полярной звезды|Полюс/i);

    const privacy = await fetch(`${baseUrl}/privacy`);
    assert.equal(privacy.status, 200);
    assert.match(await privacy.text(), /privacy.js/);

    const privacyScript = await fetch(`${baseUrl}/privacy.js`);
    assert.equal(privacyScript.status, 200);

    const manifest = await fetch(`${baseUrl}/manifest.webmanifest`);
    assert.equal(manifest.status, 200);
    assert.match(await manifest.text(), /Полюс/);
  });

});

test("limits registration attempts and returns client errors for malformed encodings", async () => {
  await withServer({ store: createEmptyStore() }, async (baseUrl) => {
    const account = await register(baseUrl, "encoding_test", "Encoding Test");
    const invalidRegistration = () => fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "invalid",
        fullName: "",
        password: "a-secure-test-password",
        confirmPassword: "a-secure-test-password",
        acceptPrivacy: true,
        privacyVersion: PRIVACY_VERSION
      })
    });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      assert.equal((await invalidRegistration()).status, 400);
    }
    await assertApiError(await invalidRegistration(), 429, "TOO_MANY_REQUESTS");

    const malformedCookie = await fetch(`${baseUrl}/api/bootstrap`, {
      headers: { Cookie: "polus_session=%ZZ" }
    });
    await assertApiError(malformedCookie, 400, "BAD_REQUEST");
    const channelResponse = await fetch(`${baseUrl}/api/channels`, authenticatedRequest(account.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Encoding test" })
    }));
    const channel = await channelResponse.json();
    assert.ok(channel.id, JSON.stringify({ status: channelResponse.status, channel }));
    const { port } = new URL(baseUrl);
    const malformedPath = await new Promise((resolve, reject) => {
      const request = http.request({
        method: "POST",
        hostname: "127.0.0.1",
        port,
        path: `/api/chats/${channel.id}/attachments`,
        headers: { Cookie: account.cookie, "X-File-Name": "%ZZ" }
      }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve({
          status: response.statusCode,
          body: JSON.parse(Buffer.concat(chunks).toString("utf8"))
        }));
      });
      request.on("error", reject);
      request.end();
    });
    assert.equal(malformedPath.status, 400, JSON.stringify(malformedPath.body));
    assertApiErrorBody(malformedPath.body, "BAD_REQUEST");
  });
});

test("enables HSTS when secure cookies are explicitly enabled", async () => {
  const previous = process.env.POLUS_COOKIE_SECURE;
  process.env.POLUS_COOKIE_SECURE = "true";
  try {
    await withServer({}, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/config`);
      assert.equal(response.headers.get("strict-transport-security"), "max-age=31536000");
    });
  } finally {
    if (previous === undefined) delete process.env.POLUS_COOKIE_SECURE;
    else process.env.POLUS_COOKIE_SECURE = previous;
  }
});

test("rejects cross-origin API mutations and sends browser hardening headers", async () => {
  await withServer({ store: createEmptyStore() }, async (baseUrl) => {
    const account = await register(baseUrl, "origin_guard", "Origin Guard");
    const response = await fetch(`${baseUrl}/api/account`, authenticatedRequest(account.cookie, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://attacker.example",
        "Sec-Fetch-Site": "cross-site"
      },
      body: JSON.stringify({ fullName: "Changed", about: "" })
    }));
    await assertApiError(response, 403, "FORBIDDEN");
    const sameOriginResponse = await fetch(`${baseUrl}/api/account`, authenticatedRequest(account.cookie, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl,
        "Sec-Fetch-Site": "same-origin"
      },
      body: JSON.stringify({ fullName: "Origin Guard Updated", about: "" })
    }));
    assert.equal(sameOriginResponse.status, 200);
    const me = await fetch(`${baseUrl}/api/auth/me`, authenticatedRequest(account.cookie));
    assert.equal((await me.json()).user.fullName, "Origin Guard Updated");
    assert.equal(me.headers.get("x-frame-options"), "DENY");
    assert.equal(me.headers.get("cross-origin-resource-policy"), "same-origin");
    assert.match(me.headers.get("permissions-policy"), /microphone=\(self\)/);
  });
});

test("accepts Edge push subscription endpoints", async () => {
  await withServer({ store: createEmptyStore() }, async (baseUrl) => {
    const account = await register(baseUrl, "edge_push", "Edge Push");
    const response = await fetch(`${baseUrl}/api/push/subscribe`, authenticatedRequest(account.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subscription: {
          endpoint: "https://notify.windows.com/?token=test",
          keys: { p256dh: "public-key", auth: "auth-key" }
        }
      })
    }));
    assert.equal(response.status, 201);
  });
});

test("removes the specified push subscription on chunked logout requests", async () => {
  let persistedStore;
  await withServer({
    store: createEmptyStore(),
    saveStore: async (store) => { persistedStore = structuredClone(store); }
  }, async (baseUrl) => {
    const account = await register(baseUrl, "chunked_logout", "Chunked Logout");
    const endpoint = "https://notify.windows.com/?token=logout-test";
    const subscription = await fetch(`${baseUrl}/api/push/subscribe`, authenticatedRequest(account.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subscription: { endpoint, keys: { p256dh: "public-key", auth: "auth-key" } }
      })
    }));
    assert.equal(subscription.status, 201);
    assert.equal(persistedStore.pushSubscriptions.length, 1);

    const logout = await new Promise((resolve, reject) => {
      const request = http.request(baseUrl + "/api/auth/logout", {
        method: "POST",
        headers: {
          Cookie: account.cookie,
          "Content-Type": "application/json",
          "Transfer-Encoding": "chunked"
        }
      }, (response) => {
        response.resume();
        response.on("end", () => resolve(response));
      });
      request.on("error", reject);
      request.end(JSON.stringify({ pushEndpoint: endpoint }));
    });

    assert.equal(logout.statusCode, 200);
    assert.deepEqual(persistedStore.pushSubscriptions, []);
  });
});

test("returns the documented error envelope for invalid, unauthorized, forbidden and missing requests", async () => {
  await withServer({ store: createEmptyStore() }, async (baseUrl) => {
    await assertApiError(await fetch(`${baseUrl}/api/bootstrap`), 401, "UNAUTHORIZED");

    const invalidJson = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{"
    });
    await assertApiError(invalidJson, 400, "BAD_REQUEST");

    const nonObjectJson = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "null"
    });
    await assertApiError(nonObjectJson, 400, "BAD_REQUEST");

    const owner = await register(baseUrl, "errors_owner", "Owner");
    const member = await register(baseUrl, "errors_member", "Member");
    await assertApiError(
      await fetch(`${baseUrl}/api/not-a-route`, authenticatedRequest(owner.cookie)),
      404,
      "NOT_FOUND"
    );
    const duplicate = await register(baseUrl, "errors_owner", "Duplicate");
    assert.equal(duplicate.response.status, 409);
    assertApiErrorBody(duplicate.body, "CONFLICT");

    const channelResponse = await fetch(`${baseUrl}/api/channels`, authenticatedRequest(owner.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Read-only channel" })
    }));
    const channel = await channelResponse.json();
    const join = await fetch(`${baseUrl}/api/channels/${channel.id}/join`, authenticatedRequest(member.cookie, {
      method: "POST"
    }));
    assert.equal(join.status, 200);

    const forbiddenPost = await fetch(`${baseUrl}/api/messages`, authenticatedRequest(member.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: channel.id, text: "Not allowed" })
    }));
    await assertApiError(forbiddenPost, 403, "FORBIDDEN");
  });
});

test("registers unique @usernames, stores only password hashes and requires sign-in", async () => {
  const savedStates = [];
  await withServer({
    store: createEmptyStore(),
    saveStore: async (store) => savedStates.push(JSON.parse(JSON.stringify(store)))
  }, async (baseUrl) => {
    const unauthorized = await fetch(`${baseUrl}/api/bootstrap`);
    assert.equal(unauthorized.status, 401);
    assert.deepEqual(await unauthorized.json(), {
      error: { code: "UNAUTHORIZED", message: "Please sign in again." }
    });

    const missingConsent = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "north_star",
        fullName: "North Star",
        password: "a-secure-test-password",
        confirmPassword: "a-secure-test-password",
        acceptPrivacy: false,
        privacyVersion: PRIVACY_VERSION
      })
    });
    assert.equal(missingConsent.status, 400);
    assert.equal((await missingConsent.json()).error.code, "BAD_REQUEST");

    const { response, cookie, body } = await register(baseUrl, "North_Star", "North Star");
    assert.equal(response.status, 201);
    assert.equal(body.user.username, "north_star");
    assert.equal(body.user.about, "");
    assert.ok(cookie.startsWith("polus_session="));
    const cookieHeader = response.headers.get("set-cookie");
    assert.match(cookieHeader, /HttpOnly/);
    assert.match(cookieHeader, /SameSite=Strict/);
    assert.match(cookieHeader, /Max-Age=2592000/);
    assert.ok(!JSON.stringify(savedStates).includes("a-secure-test-password"));
    assert.match(savedStates.at(-1).users[0].passwordHash, /^[a-f0-9]+:[a-f0-9]+$/);

    const bootstrapResponse = await fetch(`${baseUrl}/api/bootstrap`, authenticatedRequest(cookie));
    assert.equal(bootstrapResponse.status, 200);
    const bootstrap = await bootstrapResponse.json();
    assert.equal(bootstrap.user.fullName, "North Star");
    assert.equal(bootstrap.user.about, "");
    assert.deepEqual(bootstrap.channels, []);

    const duplicate = await register(baseUrl, "north_star", "Another Person");
    assert.equal(duplicate.response.status, 409);
    assert.equal(duplicate.body.error.code, "CONFLICT");

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "NORTH_STAR", password: "a-secure-test-password" })
    });
    assert.equal(login.status, 200);
    const secondDeviceCookie = login.headers.get("set-cookie").split(";")[0];
    assert.ok(secondDeviceCookie.startsWith("polus_session="));
    assert.equal((await fetch(`${baseUrl}/api/bootstrap`, authenticatedRequest(secondDeviceCookie))).status, 200);

    const logout = await fetch(`${baseUrl}/api/auth/logout`, authenticatedRequest(cookie, { method: "POST" }));
    assert.equal(logout.status, 200);
    assert.equal((await fetch(`${baseUrl}/api/bootstrap`, authenticatedRequest(cookie))).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/bootstrap`, authenticatedRequest(secondDeviceCookie))).status, 200);
  });
});

test("isolates account sessions by account key and revokes only the selected account", async () => {
  await withServer({ store: createEmptyStore() }, async (baseUrl) => {
    const account = await register(baseUrl, "multi_session", "Multi Session");
    const firstKey = "a".repeat(32);
    const attached = await fetch(`${baseUrl}/api/auth/accounts/attach`, authenticatedRequest(account.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountKey: firstKey })
    }));
    assert.equal(attached.status, 200);
    const firstCookie = attached.headers.get("set-cookie").match(/polus_session_[a-f0-9]{32}=[^;,]+/)[0];
    assert.match(attached.headers.get("set-cookie"), new RegExp(`polus_session_${firstKey}=`));
    assert.equal((await fetch(`${baseUrl}/api/bootstrap`, authenticatedRequest(account.cookie))).status, 401);

    const secondKey = "b".repeat(32);
    const secondLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Polus-Account": secondKey },
      body: JSON.stringify({ username: "multi_session", password: "a-secure-test-password" })
    });
    assert.equal(secondLogin.status, 200);
    const secondCookie = secondLogin.headers.get("set-cookie").match(/polus_session_[a-f0-9]{32}=[^;,]+/)[0];

    const firstRequest = authenticatedRequest(firstCookie, { headers: { "X-Polus-Account": firstKey } });
    const secondRequest = authenticatedRequest(secondCookie, { headers: { "X-Polus-Account": secondKey } });
    assert.equal((await fetch(`${baseUrl}/api/bootstrap`, firstRequest)).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/bootstrap`, secondRequest)).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/bootstrap`, authenticatedRequest(firstCookie, {
      headers: { "X-Polus-Account": secondKey }
    }))).status, 401);
    const streamController = new AbortController();
    const scopedStream = await fetch(`${baseUrl}/api/stream`, {
      headers: { Cookie: firstCookie, "X-Polus-Account": firstKey },
      signal: streamController.signal
    });
    assert.equal(scopedStream.status, 200);
    streamController.abort();
    assert.equal((await fetch(`${baseUrl}/api/stream?accountKey=${secondKey}`, {
      headers: { Cookie: firstCookie }
    })).status, 401);

    const logout = await fetch(`${baseUrl}/api/auth/logout`, authenticatedRequest(firstCookie, {
      method: "POST",
      headers: { "X-Polus-Account": firstKey }
    }));
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get("set-cookie"), new RegExp(`polus_session_${firstKey}=;`));
    assert.equal((await fetch(`${baseUrl}/api/bootstrap`, firstRequest)).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/bootstrap`, secondRequest)).status, 200);
    assert.ok(account.cookie.startsWith("polus_session="));
  });
});

test("migrates legacy encryption-key wrapping without changing the public identity", async () => {
  await withServer({ store: createEmptyStore() }, async (baseUrl) => {
    const account = await register(baseUrl, "key_migration", "Key Migration");
    const url = `${baseUrl}/api/account/encryption-key`;
    const request = (method, body) => fetch(url, authenticatedRequest(account.cookie, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {})
    }));
    const publicKey = crypto.generateKeyPairSync("rsa", { modulusLength: 3072 })
      .publicKey.export({ type: "spki", format: "der" }).toString("base64");
    const otherPublicKey = crypto.generateKeyPairSync("rsa", { modulusLength: 3072 })
      .publicKey.export({ type: "spki", format: "der" }).toString("base64");
    const legacySeal = { salt: "AQID", iv: "AQID", ciphertext: "AQID", iterations: 310000 };
    const newSeal = { ...legacySeal, keyVersion: 2, ciphertext: "BAUG" };
    const upgradedSeal = {
      ...legacySeal,
      keyVersion: 3,
      iterations: 600000,
      ciphertext: "CgsM"
    };

    assert.deepEqual(await (await request("GET")).json(), {
      userId: account.body.user.id,
      publicKey: null,
      sealedPrivateKey: null,
      signingPublicKey: null,
      sealedSigningPrivateKey: null
    });
    assert.equal((await request("PUT", { publicKey, sealedPrivateKey: legacySeal })).status, 201);
    assert.equal((await request("PUT", { publicKey, sealedPrivateKey: newSeal })).status, 200);
    assert.deepEqual(await (await request("GET")).json().then((result) => result.sealedPrivateKey), newSeal);
    const signingSeal = { ...newSeal, ciphertext: "BwgJ" };
    const signingPublicKey = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" })
      .publicKey.export({ type: "spki", format: "der" }).toString("base64");
    assert.equal((await request("PUT", {
      publicKey,
      sealedPrivateKey: newSeal,
      signingPublicKey,
      sealedSigningPrivateKey: signingSeal
    })).status, 200);
    const updatedIdentity = await (await request("GET")).json();
    assert.equal(updatedIdentity.signingPublicKey, signingPublicKey);
    assert.deepEqual(updatedIdentity.sealedSigningPrivateKey, signingSeal);
    assert.equal((await request("PUT", {
      publicKey,
      sealedPrivateKey: newSeal,
      signingPublicKey,
      sealedSigningPrivateKey: signingSeal
    })).status, 200);
    assert.equal((await request("PUT", {
      publicKey,
      sealedPrivateKey: { ...newSeal, ciphertext: "CgsM" },
      signingPublicKey,
      sealedSigningPrivateKey: signingSeal
    })).status, 409);
    const upgradedSigningSeal = { ...upgradedSeal, ciphertext: "DQ4P" };
    assert.equal((await request("PUT", {
      publicKey,
      sealedPrivateKey: upgradedSeal,
      signingPublicKey,
      sealedSigningPrivateKey: upgradedSigningSeal
    })).status, 200);
    assert.deepEqual((await (await request("GET")).json()).sealedPrivateKey, upgradedSeal);
    assert.equal((await request("PUT", {
      publicKey,
      sealedPrivateKey: newSeal,
      signingPublicKey,
      sealedSigningPrivateKey: signingSeal
    })).status, 409);
    assert.equal((await request("PUT", {
      publicKey: otherPublicKey,
      sealedPrivateKey: { ...newSeal, ciphertext: "CgsM" },
      signingPublicKey,
      sealedSigningPrivateKey: signingSeal
    })).status, 409);
  });
});

test("accepts only signed messages bound to the stored sender and chat context", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const signingPublicKey = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const senderPublicKey = "sender-encryption-key";
  const recipientPublicKey = "recipient-encryption-key";
  const conversation = { id: "chat-1", memberIds: ["sender", "recipient"] };
  const store = {
    users: [
      { id: "sender", encryptionPublicKey: senderPublicKey, signingPublicKey },
      { id: "recipient", encryptionPublicKey: recipientPublicKey, signingPublicKey: "recipient-signing-key" }
    ]
  };
  const packet = {
    version: 2,
    context: { conversationId: conversation.id, senderId: "sender", counter: 1 },
    iv: crypto.randomBytes(12).toString("base64"),
    ciphertext: crypto.randomBytes(32).toString("base64"),
    envelopes: {
      sender: crypto.randomBytes(384).toString("base64"),
      recipient: crypto.randomBytes(384).toString("base64")
    },
    senderPublicKey,
    signingPublicKey
  };
  const signedData = JSON.stringify({
    version: packet.version,
    context: packet.context,
    iv: packet.iv,
    ciphertext: packet.ciphertext,
    envelopes: packet.envelopes,
    senderPublicKey: packet.senderPublicKey,
    signingPublicKey: packet.signingPublicKey
  });
  packet.signature = crypto.sign("sha256", Buffer.from(signedData), {
    key: privateKey,
    dsaEncoding: "ieee-p1363"
  }).toString("base64");
  const serialize = (message) => `polus-e2ee:v2:${JSON.stringify(message)}`;

  assert.equal(validEncryptedMessage(serialize(packet), conversation, store, "sender"), true);
  assert.equal(validEncryptedMessage(serialize(packet), conversation, store, "recipient"), false);
  assert.equal(validEncryptedMessage(serialize({
    ...packet,
    context: { ...packet.context, conversationId: "other-chat" }
  }), conversation, store, "sender"), false);
  assert.equal(validEncryptedMessage(serialize({
    ...packet,
    signature: Buffer.alloc(64).toString("base64")
  }), conversation, store, "sender"), false);
});

test("rewraps a legacy encryption key atomically with the account password change", async () => {
  await withServer({ store: createEmptyStore() }, async (baseUrl) => {
    const account = await register(baseUrl, "legacy_rewrap", "Legacy Rewrap");
    const publicKey = crypto.generateKeyPairSync("rsa", { modulusLength: 3072 })
      .publicKey.export({ type: "spki", format: "der" }).toString("base64");
    const signingPublicKey = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" })
      .publicKey.export({ type: "spki", format: "der" }).toString("base64");
    const legacySeal = { salt: "AQID", iv: "BAUG", ciphertext: "BwgJ", iterations: 310000 };
    const migratedSeal = { ...legacySeal, keyVersion: 3, iterations: 600000, ciphertext: "CgsM" };
    const migratedSigningSeal = { ...legacySeal, keyVersion: 3, iterations: 600000, ciphertext: "DQ4P" };
    const encryptionKeyUrl = `${baseUrl}/api/account/encryption-key`;
    const keyRequest = (method, body, cookie = account.cookie) => fetch(encryptionKeyUrl, authenticatedRequest(cookie, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {})
    }));
    assert.equal((await keyRequest("PUT", {
      publicKey,
      sealedPrivateKey: legacySeal,
      signingPublicKey,
      sealedSigningPrivateKey: legacySeal
    })).status, 201);

    const patchAccount = (body) => fetch(`${baseUrl}/api/account`, authenticatedRequest(account.cookie, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName: "Legacy Rewrap", about: "", ...body })
    }));
    assert.equal((await patchAccount({
      currentPassword: "a-secure-test-password",
      newPassword: "a-new-secure-password"
    })).status, 409);

    const invalidUpdate = await patchAccount({
      currentPassword: "a-secure-test-password",
      newPassword: "a-new-secure-password",
      encryptionKeyUpdate: { sealedPrivateKey: { ...migratedSeal, iterations: 310000 } }
    });
    assert.equal(invalidUpdate.status, 409);
    assert.equal((await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "legacy_rewrap", password: "a-secure-test-password" })
    })).status, 200);

    const changed = await patchAccount({
      currentPassword: "a-secure-test-password",
      newPassword: "a-new-secure-password",
      encryptionKeyUpdate: {
        sealedPrivateKey: migratedSeal,
        sealedSigningPrivateKey: migratedSigningSeal
      }
    });
    assert.equal(changed.status, 200);
    const newLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "legacy_rewrap", password: "a-new-secure-password" })
    });
    const newCookie = newLogin.headers.get("set-cookie").split(";")[0];
    const migratedIdentity = await (await keyRequest("GET", undefined, newCookie)).json();
    assert.deepEqual(migratedIdentity.sealedPrivateKey, migratedSeal);
    assert.deepEqual(migratedIdentity.sealedSigningPrivateKey, migratedSigningSeal);
    assert.equal((await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "legacy_rewrap", password: "a-secure-test-password" })
    })).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "legacy_rewrap", password: "a-new-secure-password" })
    })).status, 200);
  });
});

test("enforces account limits, permits an 8-character password, and edits profile about", async () => {
  await withServer({ store: createEmptyStore() }, async (baseUrl) => {
    const longUsername = "a".repeat(32);
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: longUsername,
        fullName: "A",
        about: "Profile bio",
        password: "12345678",
        confirmPassword: "12345678",
        acceptPrivacy: true,
        privacyVersion: PRIVACY_VERSION
      })
    });
    assert.equal(response.status, 201);
    const cookie = response.headers.get("set-cookie").split(";")[0];
    const registeredUser = (await response.json()).user;
    assert.equal(registeredUser.about, "Profile bio");
    const anotherDeviceLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: longUsername, password: "12345678" })
    });
    const anotherDeviceCookie = anotherDeviceLogin.headers.get("set-cookie").split(";")[0];
    assert.equal(anotherDeviceLogin.status, 200);

    const invalidAccounts = [
      { username: "a".repeat(33), fullName: "Name", password: "12345678", confirmPassword: "12345678" },
      { username: "valid_username", fullName: "a".repeat(51), password: "12345678", confirmPassword: "12345678" },
      { username: "valid_username", fullName: "A", about: "b".repeat(201), password: "12345678", confirmPassword: "12345678" },
      { username: "valid_username", fullName: "A", password: "1234567", confirmPassword: "1234567" }
    ];
    for (const invalidAccount of invalidAccounts) {
      const invalid = await fetch(`${baseUrl}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...invalidAccount,
          acceptPrivacy: true,
          privacyVersion: PRIVACY_VERSION
        })
      });
      assert.equal(invalid.status, 400);
      assert.equal(typeof (await invalid.json()).error.message, "string");
    }

    const updated = await fetch(`${baseUrl}/api/account`, authenticatedRequest(cookie, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: "New name",
        about: "Updated bio",
        username: "changed_name",
        currentPassword: "12345678",
        newPassword: "87654321"
      })
    }));
    assert.equal(updated.status, 200);
    const updatedUser = (await updated.json()).user;
    assert.deepEqual({
      id: updatedUser.id,
      username: updatedUser.username,
      fullName: updatedUser.fullName,
      about: updatedUser.about
    }, {
      id: registeredUser.id,
      username: longUsername,
      fullName: "New name",
      about: "Updated bio"
    });
    assert.equal(updatedUser.showOnlineStatus, true);

    const oldPasswordLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: longUsername, password: "12345678" })
    });
    assert.equal(oldPasswordLogin.status, 401);
    assert.equal((await oldPasswordLogin.json()).error.code, "UNAUTHORIZED");
    const newPasswordLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: longUsername, password: "87654321" })
    });
    assert.equal(newPasswordLogin.status, 200);
    assert.equal((await fetch(`${baseUrl}/api/bootstrap`, authenticatedRequest(cookie))).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/bootstrap`, authenticatedRequest(anotherDeviceCookie))).status, 401);
  });
});

test("limits failed logins to ten per IP and username and across IPs per username", async () => {
  await withServer({ store: createEmptyStore() }, async (baseUrl) => {
    await register(baseUrl, "limit_pair_user", "Rate Limit User");
    const attemptLogin = (username) => fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "wrong-password" })
    });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const failed = await attemptLogin("LIMIT_PAIR_USER");
      await assertApiError(failed, 401, "UNAUTHORIZED");
    }

    const limited = await attemptLogin("limit_pair_user");
    await assertApiError(limited, 429, "TOO_MANY_REQUESTS");

    const separateUsername = await attemptLogin("a_different_user");
    assert.equal(separateUsername.status, 401);

    await register(baseUrl, "cross_ip_user", "Cross IP User");
    const port = Number(new URL(baseUrl).port);
    const attemptFromAddress = (localAddress) => new Promise((resolve, reject) => {
      const request = http.request({
        hostname: "127.0.0.1",
        port,
        path: "/api/auth/login",
        method: "POST",
        localAddress,
        headers: { "Content-Type": "application/json" }
      }, (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode));
      });
      request.on("error", reject);
      request.end(JSON.stringify({ username: "cross_ip_user", password: "wrong-password" }));
    });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const localAddress = attempt % 2 === 0 ? "127.0.0.1" : "127.0.0.2";
      assert.equal(await attemptFromAddress(localAddress), 401);
    }
    assert.equal(await attemptLogin("cross_ip_user").then((response) => response.status), 429);
  });
});

test("closes only the logged-out session's event streams", async () => {
  await withServer({ store: createEmptyStore() }, async (baseUrl) => {
    const account = await register(baseUrl, "stream_logout", "Stream Logout");
    const secondLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "stream_logout", password: "a-secure-test-password" })
    });
    assert.equal(secondLogin.status, 200);
    const secondCookie = secondLogin.headers.get("set-cookie").split(";")[0];
    const controllers = [new AbortController(), new AbortController()];
    const readers = [];
    try {
      for (const [cookie, index] of [[account.cookie, 0], [secondCookie, 1]]) {
        const response = await fetch(`${baseUrl}/api/stream`, {
          headers: { Cookie: cookie },
          signal: controllers[index].signal
        });
        const reader = response.body.getReader();
        readers.push(reader);
        assert.match(new TextDecoder().decode((await reader.read()).value), /retry: 3000/);
      }

      const logout = await fetch(`${baseUrl}/api/auth/logout`,
        authenticatedRequest(account.cookie, { method: "POST" }));
      assert.equal(logout.status, 200);
      assert.deepEqual(await readers[0].read(), { value: undefined, done: true });
      assert.equal((await fetch(`${baseUrl}/api/bootstrap`, authenticatedRequest(secondCookie))).status, 200);
    } finally {
      controllers.forEach((controller) => controller.abort());
    }
  });
});

test("closes streams when a password change revokes other sessions", async () => {
  await withServer({ store: createEmptyStore() }, async (baseUrl) => {
    const account = await register(baseUrl, "stream_password", "Stream Password");
    const secondLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "stream_password", password: "a-secure-test-password" })
    });
    const secondCookie = secondLogin.headers.get("set-cookie").split(";")[0];
    const controller = new AbortController();
    try {
      const stream = await fetch(`${baseUrl}/api/stream`, {
        headers: { Cookie: secondCookie },
        signal: controller.signal
      });
      const reader = stream.body.getReader();
      assert.match(new TextDecoder().decode((await reader.read()).value), /retry: 3000/);

      const changed = await fetch(`${baseUrl}/api/account`, authenticatedRequest(account.cookie, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: "Stream Password",
          about: "",
          currentPassword: "a-secure-test-password",
          newPassword: "a-new-secure-password"
        })
      }));
      assert.equal(changed.status, 200);
      assert.deepEqual(await reader.read(), { value: undefined, done: true });
      assert.equal((await fetch(`${baseUrl}/api/bootstrap`, authenticatedRequest(secondCookie))).status, 401);
    } finally {
      controller.abort();
    }
  });
});

test("isolates direct messages, broadcasts to participants, and tracks unread counts", async () => {
  await withServer({ store: createEmptyStore() }, async (baseUrl) => {
    const alice = await register(baseUrl, "alice_north", "Alice North");
    const bob = await register(baseUrl, "bobby_south", "Bobby South");
    assert.equal(alice.response.status, 201);
    assert.equal(bob.response.status, 201);

    const directResponse = await fetch(
      `${baseUrl}/api/directs/bobby_south`,
      authenticatedRequest(alice.cookie, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      })
    );
    assert.equal(directResponse.status, 200);
    const direct = await directResponse.json();
    assert.equal(direct.type, "direct");
    assert.equal(direct.pending, true);
    const initialBootstrap = await fetch(`${baseUrl}/api/bootstrap`, authenticatedRequest(alice.cookie));
    assert.deepEqual((await initialBootstrap.json()).directs.filter((chat) => chat.type === "direct"), []);

    const controller = new AbortController();
    const eventResponse = await fetch(`${baseUrl}/api/stream`, {
      headers: { Cookie: bob.cookie },
      signal: controller.signal
    });
    const reader = eventResponse.body.getReader();
    const firstChunk = await reader.read();
    assert.match(new TextDecoder().decode(firstChunk.value), /retry: 3000/);

    const sent = await fetch(`${baseUrl}/api/messages`, authenticatedRequest(alice.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipientUsername: "bobby_south", text: "Hello!\nHow are you?" })
    }));
    assert.equal(sent.status, 201);
    const sentMessage = await sent.json();
    assert.match(sentMessage.text, /Hello!\nHow are you\?/);
    assert.equal(sentMessage.conversation.type, "direct");
    assert.equal(sentMessage.conversation.memberIds.length, 2);
    assert.equal(Number.isSafeInteger(sentMessage.id), true);
    const conversationId = sentMessage.conversation.id;

    const broadcast = await reader.read();
    const event = new TextDecoder().decode(broadcast.value);
    assert.match(event, /event: message/);
    assert.match(event, /Hello!/);
    assert.match(event, /How are you/);
    controller.abort();

    const replayController = new AbortController();
    const replayResponse = await fetch(`${baseUrl}/api/stream`, {
      headers: { Cookie: bob.cookie, "Last-Event-ID": "0" },
      signal: replayController.signal
    });
    const replayReader = replayResponse.body.getReader();
    let replayText = "";
    while (!replayText.includes("event: message")) {
      const { value, done } = await replayReader.read();
      assert.equal(done, false);
      replayText += new TextDecoder().decode(value);
    }
    assert.match(replayText, /id: 1\nevent: message/);
    assert.match(replayText, /Hello!/);
    replayController.abort();

    const bobBootstrap = await fetch(`${baseUrl}/api/bootstrap`, authenticatedRequest(bob.cookie));
    const bobDirect = (await bobBootstrap.json()).directs.find((item) => item.id === conversationId);
    assert.equal(bobDirect.unreadCount, 1);
    const read = await fetch(`${baseUrl}/api/conversations/read`, authenticatedRequest(bob.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId })
    }));
    assert.equal(read.status, 200);
    const afterRead = await fetch(`${baseUrl}/api/bootstrap`, authenticatedRequest(bob.cookie));
    const afterReadBody = await afterRead.json();
    const readDirect = afterReadBody.directs.find((chat) => chat.id === conversationId);
    assert.equal(readDirect.unreadCount, 0);
    assert.equal(readDirect.lastReadMessageId, sentMessage.id);
    const bobReply = await fetch(`${baseUrl}/api/messages`, authenticatedRequest(bob.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, text: "My own message" })
    }));
    assert.equal(bobReply.status, 201);
    const afterOwnReply = await fetch(`${baseUrl}/api/bootstrap`, authenticatedRequest(bob.cookie));
    const ownReplyBody = await afterOwnReply.json();
    const repliedDirect = ownReplyBody.directs.find((chat) => chat.id === conversationId);
    assert.equal(repliedDirect.unreadCount, 0);
    assert.equal(repliedDirect.lastReadMessageId, sentMessage.id);

    const edited = await fetch(`${baseUrl}/api/messages/${sentMessage.id}`, authenticatedRequest(alice.cookie, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Updated message" })
    }));
    assert.equal(edited.status, 200);
    assert.equal((await edited.json()).text, "Updated message");

    const unauthorizedEdit = await fetch(`${baseUrl}/api/messages/${sentMessage.id}`, authenticatedRequest(bob.cookie, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Not yours" })
    }));
    assert.equal(unauthorizedEdit.status, 403);
  });
});

test("sends push only when the recipient is not viewing that chat and respects privacy and mute", async () => {
  const deliveries = [];
  await withServer({
    store: createEmptyStore(),
    pushSender: async (_store, userId, message, _persist, options) => {
      deliveries.push({ userId, message, options });
    }
  }, async (baseUrl) => {
    const alice = await register(baseUrl, "push_alice", "Alice North");
    const bob = await register(baseUrl, "push_bobby", "Bobby South");
    const json = (value) => ({ "Content-Type": "application/json", body: JSON.stringify(value) });
    const groupResponse = await fetch(`${baseUrl}/api/groups`, authenticatedRequest(alice.cookie, {
      method: "POST",
      ...json({ name: "Other chat", usernames: ["push_bobby"] })
    }));
    const group = await groupResponse.json();
    const initialMessage = await fetch(`${baseUrl}/api/messages`, authenticatedRequest(alice.cookie, {
      method: "POST",
      ...json({ recipientUsername: "push_bobby", text: "Initial message" })
    }));
    const direct = (await initialMessage.json()).conversation;
    deliveries.length = 0;

    const presence = (conversationId, visible = true) => fetch(
      `${baseUrl}/api/presence/chat`,
      authenticatedRequest(bob.cookie, {
        method: "POST",
        ...json({ clientId: "browser-tab-0001", conversationId, visible })
      })
    );
    assert.equal((await presence(direct.id)).status, 200);
    const send = (text) => fetch(`${baseUrl}/api/messages`, authenticatedRequest(alice.cookie, {
      method: "POST",
      ...json({ conversationId: direct.id, text })
    }));

    assert.equal((await send("Visible in the open direct chat")).status, 201);
    assert.equal(deliveries.length, 0);
    assert.equal((await presence(group.id)).status, 200);
    assert.equal((await send("x".repeat(150))).status, 201);
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].userId, bob.body.user.id);
    assert.equal(deliveries[0].options.hideContent, false);
    assert.equal(createPushPayload(deliveries[0].message).body.length, 100);

    const privacySettings = await fetch(`${baseUrl}/api/account`, authenticatedRequest(bob.cookie, {
      method: "PATCH",
      ...json({
        fullName: "Bobby South",
        about: "",
        hideNotificationContent: true
      })
    }));
    assert.equal(privacySettings.status, 200);
    assert.equal((await privacySettings.json()).user.hideNotificationContent, true);
    assert.equal((await send("Private notification")).status, 201);
    assert.equal(deliveries.at(-1).options.hideContent, true);

    const mute = await fetch(`${baseUrl}/api/chats/${direct.id}/mute`, authenticatedRequest(bob.cookie, {
      method: "POST"
    }));
    assert.equal(mute.status, 200);
    const deliveryCount = deliveries.length;
    assert.equal((await presence(direct.id, false)).status, 200);
    assert.equal((await send("Muted notification")).status, 201);
    assert.equal(deliveries.length, deliveryCount);
  });
});

test("validates messages, pages history, enforces edit limits, and keeps deletions as tombstones", async () => {
  const store = createEmptyStore();
  let persistedStore;
  await withServer({
    store,
    saveStore: async (current) => { persistedStore = current; }
  }, async (baseUrl) => {
    const owner = await register(baseUrl, "history_owner", "Owner");
    const admin = await register(baseUrl, "history_admin", "Admin");
    const member = await register(baseUrl, "history_member", "Member");
    const outsider = await register(baseUrl, "history_outside", "Outside");
    const json = (value) => ({ "Content-Type": "application/json", body: JSON.stringify(value) });

    const groupResponse = await fetch(`${baseUrl}/api/groups`, authenticatedRequest(owner.cookie, {
      method: "POST",
      ...json({ name: "History room", usernames: ["history_admin", "history_member"] })
    }));
    const group = await groupResponse.json();
    const promote = await fetch(
      `${baseUrl}/api/chats/${group.id}/admins/${admin.body.user.id}`,
      authenticatedRequest(owner.cookie, { method: "PUT", ...json({ role: "admin" }) })
    );
    assert.equal(promote.status, 200);

    const post = (cookie, text) => fetch(`${baseUrl}/api/messages`, authenticatedRequest(cookie, {
      method: "POST",
      ...json({ conversationId: group.id, text })
    }));
    for (const invalidText of ["   ", "a".repeat(4001), "😊".repeat(4001)]) {
      const invalid = await post(owner.cookie, invalidText);
      assert.equal(invalid.status, 400);
      assert.equal((await invalid.json()).error.code, "BAD_REQUEST");
    }

    const sentByAuthor = new Map();
    for (let index = 0; index < 18; index += 1) {
      for (const [author, cookie] of [["owner", owner.cookie], ["admin", admin.cookie], ["member", member.cookie]]) {
        const sent = await post(cookie, `${author}-${index}`);
        assert.equal(sent.status, 201);
        const message = await sent.json();
        sentByAuthor.set(author, message);
      }
    }

    const latestPageResponse = await fetch(
      `${baseUrl}/api/messages?conversationId=${encodeURIComponent(group.id)}&limit=200`,
      authenticatedRequest(owner.cookie)
    );
    const latestPage = await latestPageResponse.json();
    assert.equal(latestPage.messages.length, 50);
    assert.equal(latestPage.hasMore, true);
    assert.ok(latestPage.messages.every((message, index, page) =>
      index === 0 || page[index - 1].id > message.id
    ));
    const previousPageResponse = await fetch(
      `${baseUrl}/api/messages?conversationId=${encodeURIComponent(group.id)}&before=${latestPage.nextCursor}`,
      authenticatedRequest(owner.cookie)
    );
    const previousPage = await previousPageResponse.json();
    assert.equal(previousPage.messages.length, 4);
    assert.equal(previousPage.hasMore, false);
    assert.equal(previousPage.nextCursor, null);
    assert.ok(previousPage.messages.every((message) => message.id < latestPage.nextCursor));
    const badCursor = await fetch(
      `${baseUrl}/api/messages?conversationId=${encodeURIComponent(group.id)}&before=invalid`,
      authenticatedRequest(owner.cookie)
    );
    assert.equal(badCursor.status, 400);
    const unicodeMessage = await post(owner.cookie, "😊".repeat(4000));
    assert.equal(unicodeMessage.status, 201);
    assert.equal(Array.from((await unicodeMessage.json()).text).length, 4000);

    const memberMessage = sentByAuthor.get("member");
    const edited = await fetch(`${baseUrl}/api/messages/${memberMessage.id}`, authenticatedRequest(member.cookie, {
      method: "PATCH",
      ...json({ text: "Edited successfully" })
    }));
    assert.equal(edited.status, 200);
    assert.equal((await edited.json()).text, "Edited successfully");
    const forbiddenEdit = await fetch(`${baseUrl}/api/messages/${memberMessage.id}`, authenticatedRequest(admin.cookie, {
      method: "PATCH",
      ...json({ text: "Not the author" })
    }));
    assert.equal(forbiddenEdit.status, 403);

    const storedMemberMessage = persistedStore.messages.find((message) => message.id === memberMessage.id);
    storedMemberMessage.createdAt = new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString();
    storedMemberMessage.sentAt = storedMemberMessage.createdAt;
    const tooLateEdit = await fetch(`${baseUrl}/api/messages/${memberMessage.id}`, authenticatedRequest(member.cookie, {
      method: "PATCH",
      ...json({ text: "Too late" })
    }));
    assert.equal(tooLateEdit.status, 403);
    const oldMessageDelete = await fetch(`${baseUrl}/api/messages/${memberMessage.id}`, authenticatedRequest(member.cookie, {
      method: "DELETE"
    }));
    assert.equal(oldMessageDelete.status, 200);
    const deletedMessage = await oldMessageDelete.json();
    assert.equal(deletedMessage.deleted, true);
    assert.equal(deletedMessage.text, "");
    assert.equal(storedMemberMessage.text, "");
    assert.equal(storedMemberMessage.deleted, true);

    const adminDelete = await fetch(`${baseUrl}/api/messages/${sentByAuthor.get("owner").id}`, authenticatedRequest(admin.cookie, {
      method: "DELETE"
    }));
    assert.equal(adminDelete.status, 200);
    assert.equal((await adminDelete.json()).deleted, true);
    const memberCannotDeleteOwner = await fetch(
      `${baseUrl}/api/messages/${sentByAuthor.get("admin").id}`,
      authenticatedRequest(member.cookie, { method: "DELETE" })
    );
    assert.equal(memberCannotDeleteOwner.status, 403);
    const hiddenFromOutsider = await fetch(
      `${baseUrl}/api/messages?conversationId=${encodeURIComponent(group.id)}`,
      authenticatedRequest(outsider.cookie)
    );
    assert.equal(hiddenFromOutsider.status, 404);
  });
});

test("limits each user to twenty messages per minute", async () => {
  await withServer({ store: createEmptyStore() }, async (baseUrl) => {
    const sender = await register(baseUrl, "rate_sender", "Sender");
    const recipient = await register(baseUrl, "rate_recipient", "Recipient");
    const send = (text) => fetch(`${baseUrl}/api/messages`, authenticatedRequest(sender.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipientUsername: "rate_recipient", text })
    }));
    for (let index = 0; index < 20; index += 1) {
      assert.equal((await send(`Message ${index}`)).status, 201);
    }
    const limited = await send("Message 21");
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).error.code, "TOO_MANY_REQUESTS");
    const recipientBootstrap = await fetch(`${baseUrl}/api/bootstrap`, authenticatedRequest(recipient.cookie));
    assert.equal((await recipientBootstrap.json()).directs.find((chat) => chat.type === "direct").unreadCount, 20);
  });
});

test("streams, authorizes, indexes, searches and deletes chat attachments", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "polus-uploads-"));
  try {
    let persistedStore;
    await withServer({
      store: createEmptyStore(),
      dataDirectory: directory,
      saveStore: async (current) => { persistedStore = current; }
    }, async (baseUrl) => {
      const owner = await register(baseUrl, "file_owner", "Owner");
      const member = await register(baseUrl, "file_member", "Member");
      const outsider = await register(baseUrl, "file_outside", "Outside");
      const json = (value) => ({ "Content-Type": "application/json", body: JSON.stringify(value) });
      const created = await fetch(`${baseUrl}/api/groups`, authenticatedRequest(owner.cookie, {
        method: "POST",
        ...json({ name: "Files", usernames: ["file_member"] })
      }));
      const chat = await created.json();

      const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2]);
      const upload = await fetch(`${baseUrl}/api/chats/${chat.id}/attachments`, authenticatedRequest(member.cookie, {
        method: "POST",
        headers: {
          "Content-Type": "text/html",
          "X-File-Name": encodeURIComponent("..\\unsafe<photo>.png")
        },
        body: png
      }));
      assert.equal(upload.status, 201);
      const attachment = await upload.json();
      assert.equal(attachment.mimeType, "image/png");
      assert.equal(attachment.name, "unsafe_photo_.png");
      assert.equal(attachment.size, png.length);
      const thumbnailResponse = await fetch(
        `${baseUrl}/api/chats/${chat.id}/attachments/${attachment.id}/thumbnail`,
        authenticatedRequest(member.cookie, {
          method: "POST",
          headers: { "Content-Type": "image/png" },
          body: png
        })
      );
      assert.equal(thumbnailResponse.status, 201);
      assert.ok((await thumbnailResponse.json()).thumbnailUrl);
      const thumbnailId = persistedStore.attachments.find((item) => item.id === attachment.id).thumbnailId;
      const executable = await fetch(`${baseUrl}/api/chats/${chat.id}/attachments`, authenticatedRequest(member.cookie, {
        method: "POST",
        headers: {
          "Content-Type": "image/png",
          "X-File-Name": "setup.exe"
        },
        body: Buffer.from("MZ executable")
      }));
      assert.equal(executable.status, 201);
      const executableFile = await executable.json();
      assert.equal(executableFile.mimeType, "application/octet-stream");

      const messageResponse = await fetch(`${baseUrl}/api/messages`, authenticatedRequest(member.cookie, {
        method: "POST",
        ...json({
          conversationId: chat.id,
          text: "Look here https://example.com/picture",
          attachmentIds: [attachment.id, executableFile.id]
        })
      }));
      assert.equal(messageResponse.status, 201);
      const message = await messageResponse.json();
      assert.equal(message.attachments.length, 2);
      assert.equal(message.attachments[0].id, attachment.id);
      assert.ok(message.attachments[0].thumbnailUrl);
      assert.equal(message.attachments[1].id, executableFile.id);
      const tooManyAttachments = await fetch(`${baseUrl}/api/messages`, authenticatedRequest(member.cookie, {
        method: "POST",
        ...json({
          conversationId: chat.id,
          text: "Too many",
          attachmentIds: Array.from({ length: 11 }, (_, index) => `fake-${index}`)
        })
      }));
      assert.equal(tooManyAttachments.status, 400);
      assert.equal(persistedStore.links.length, 1);
      assert.equal(persistedStore.links[0].domain, "example.com");

      const history = await fetch(`${baseUrl}/api/messages?conversationId=${chat.id}`, authenticatedRequest(owner.cookie));
      const historyBody = await history.json();
      assert.equal(historyBody.messages[0].attachments[0].name, attachment.name);

      const media = await fetch(`${baseUrl}/api/chats/${chat.id}/materials?kind=media`, authenticatedRequest(owner.cookie));
      const mediaBody = await media.json();
      assert.equal(mediaBody.total, 1);
      assert.ok(Array.isArray(mediaBody.items));
      const files = await fetch(`${baseUrl}/api/chats/${chat.id}/materials?kind=files`, authenticatedRequest(owner.cookie));
      const filesBody = await files.json();
      assert.equal(filesBody.total, 1);
      assert.ok(Array.isArray(filesBody.items));
      const members = await fetch(`${baseUrl}/api/chats/${chat.id}/materials?kind=members`, authenticatedRequest(owner.cookie));
      const membersBody = await members.json();
      assert.ok(Array.isArray(membersBody.items));
      const links = await fetch(`${baseUrl}/api/chats/${chat.id}/materials?kind=links`, authenticatedRequest(owner.cookie));
      assert.equal(links.status, 200);
      const linksBody = await links.json();
      assert.equal(linksBody.total, 1);
      assert.ok(Array.isArray(linksBody.items));
      assert.equal(linksBody.items[0].domain, "example.com");
      const search = await fetch(`${baseUrl}/api/chats/${chat.id}/search?q=unsafe_photo`, authenticatedRequest(owner.cookie));
      assert.equal((await search.json()).results[0].id, message.id);

      const fileResponse = await fetch(`${baseUrl}/api/attachments/${attachment.id}`, authenticatedRequest(owner.cookie));
      assert.equal(fileResponse.status, 200);
      assert.equal(fileResponse.headers.get("content-type"), "image/png");
      assert.match(fileResponse.headers.get("content-disposition"), /^inline;/);
      assert.equal(Buffer.compare(Buffer.from(await fileResponse.arrayBuffer()), png), 0);
      const partialFile = await fetch(`${baseUrl}/api/attachments/${attachment.id}`, authenticatedRequest(owner.cookie, {
        headers: { Range: "bytes=2-5" }
      }));
      assert.equal(partialFile.status, 206);
      assert.equal(partialFile.headers.get("content-range"), `bytes 2-5/${png.length}`);
      assert.deepEqual(Buffer.from(await partialFile.arrayBuffer()), png.subarray(2, 6));
      const unsatisfiableRange = await fetch(`${baseUrl}/api/attachments/${attachment.id}`, authenticatedRequest(owner.cookie, {
        headers: { Range: `bytes=${png.length}-` }
      }));
      assert.equal(unsatisfiableRange.status, 416);
      assert.equal(unsatisfiableRange.headers.get("content-range"), `bytes */${png.length}`);
      const headFile = await fetch(`${baseUrl}/api/attachments/${attachment.id}`, authenticatedRequest(owner.cookie, {
        method: "HEAD",
        headers: { Range: "bytes=0-1" }
      }));
      assert.equal(headFile.status, 206);
      assert.equal(headFile.headers.get("content-length"), "2");
      assert.equal(await headFile.text(), "");
      const thumbnailFile = await fetch(
        `${baseUrl}/api/attachments/${attachment.id}?thumbnail=1`,
        authenticatedRequest(owner.cookie)
      );
      assert.equal(thumbnailFile.status, 200);
      assert.equal(thumbnailFile.headers.get("content-type"), "image/png");
      assert.equal(thumbnailFile.headers.get("x-content-type-options"), "nosniff");
      const executableResponse = await fetch(
        `${baseUrl}/api/attachments/${executableFile.id}`,
        authenticatedRequest(owner.cookie)
      );
      assert.match(executableResponse.headers.get("content-disposition"), /^attachment;/);
      assert.equal(executableResponse.headers.get("x-content-type-options"), "nosniff");

      const outsiderResponse = await fetch(`${baseUrl}/api/attachments/${attachment.id}`, authenticatedRequest(outsider.cookie));
      assert.equal(outsiderResponse.status, 404);
      const outsiderThumbnail = await fetch(
        `${baseUrl}/api/attachments/${attachment.id}?thumbnail=1`,
        authenticatedRequest(outsider.cookie)
      );
      assert.equal(outsiderThumbnail.status, 404);
      const outsiderMaterials = await fetch(
        `${baseUrl}/api/chats/${chat.id}/materials?kind=media`,
        authenticatedRequest(outsider.cookie)
      );
      assert.equal(outsiderMaterials.status, 404);

      const deleteMessage = await fetch(`${baseUrl}/api/messages/${message.id}`, authenticatedRequest(owner.cookie, {
        method: "DELETE"
      }));
      assert.equal(deleteMessage.status, 200);
      assert.equal((await deleteMessage.json()).attachments.length, 0);
      assert.equal(persistedStore.attachments.length, 0);
      await assert.rejects(fs.access(path.join(directory, "uploads", chat.id, attachment.id)), { code: "ENOENT" });
      await assert.rejects(fs.access(path.join(directory, "uploads", chat.id, executableFile.id)), { code: "ENOENT" });
      await assert.rejects(fs.access(path.join(directory, "uploads", chat.id, thumbnailId)), { code: "ENOENT" });
      const emptyMedia = await fetch(`${baseUrl}/api/chats/${chat.id}/materials?kind=media`, authenticatedRequest(owner.cookie));
      assert.equal((await emptyMedia.json()).total, 0);

      const channelResponse = await fetch(`${baseUrl}/api/channels`, authenticatedRequest(owner.cookie, {
        method: "POST",
        ...json({ name: "Public media" })
      }));
      const channel = await channelResponse.json();
      const channelUpload = await fetch(`${baseUrl}/api/chats/${channel.id}/attachments`, authenticatedRequest(owner.cookie, {
        method: "POST",
        headers: { "Content-Type": "image/png", "X-File-Name": "public.png" },
        body: png
      }));
      const publicAttachment = await channelUpload.json();
      const unpublishedFile = await fetch(
        `${baseUrl}/api/attachments/${publicAttachment.id}`,
        authenticatedRequest(outsider.cookie)
      );
      assert.equal(unpublishedFile.status, 404);
      const channelMessage = await fetch(`${baseUrl}/api/messages`, authenticatedRequest(owner.cookie, {
        method: "POST",
        ...json({
          conversationId: channel.id,
          text: "Public link https://example.net",
          attachmentIds: [publicAttachment.id]
        })
      }));
      assert.equal(channelMessage.status, 201);
      const publicMedia = await fetch(
        `${baseUrl}/api/chats/${channel.id}/materials?kind=media`,
        authenticatedRequest(outsider.cookie)
      );
      assert.equal((await publicMedia.json()).total, 1);
      const publicFile = await fetch(
        `${baseUrl}/api/attachments/${publicAttachment.id}`,
        authenticatedRequest(outsider.cookie)
      );
      assert.equal(publicFile.status, 200);
      const deniedFiles = await fetch(
        `${baseUrl}/api/chats/${channel.id}/materials?kind=files`,
        authenticatedRequest(outsider.cookie)
      );
      assert.equal(deniedFiles.status, 404);
      const deniedMembers = await fetch(
        `${baseUrl}/api/chats/${channel.id}/materials?kind=members`,
        authenticatedRequest(outsider.cookie)
      );
      assert.equal(deniedMembers.status, 404);
      for (let messageIndex = 0; messageIndex < 5; messageIndex += 1) {
        const urls = Array.from({ length: 10 }, (_, linkIndex) =>
          `https://example.net/${messageIndex}-${linkIndex}`).join(" ");
        const linkedMessage = await fetch(`${baseUrl}/api/messages`, authenticatedRequest(owner.cookie, {
          method: "POST",
          ...json({ conversationId: channel.id, text: urls })
        }));
        assert.equal(linkedMessage.status, 201);
      }
      const publicLinkPage = await fetch(
        `${baseUrl}/api/chats/${channel.id}/materials?kind=links`,
        authenticatedRequest(outsider.cookie)
      );
      const firstLinkPage = await publicLinkPage.json();
      assert.equal(firstLinkPage.total, 51);
      assert.equal(firstLinkPage.items.length, 50);
      assert.ok(firstLinkPage.nextCursor);
      const secondLinkPageResponse = await fetch(
        `${baseUrl}/api/chats/${channel.id}/materials?kind=links&before=${encodeURIComponent(firstLinkPage.nextCursor)}`,
        authenticatedRequest(outsider.cookie)
      );
      const secondLinkPage = await secondLinkPageResponse.json();
      assert.equal(secondLinkPage.items.length, 1);
      assert.equal(secondLinkPage.hasMore, false);
      assert.notEqual(firstLinkPage.items[49].id, secondLinkPage.items[0].id);
    });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("exposes profile controls, online visibility, blocks and per-chat mute settings", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "polus-profiles-"));
  try {
  await withServer({ store: createEmptyStore(), dataDirectory: directory }, async (baseUrl) => {
    const alice = await register(baseUrl, "profile_alice", "Alice");
    const bob = await register(baseUrl, "profile_bobby", "Bobby");
    const json = (value) => ({ "Content-Type": "application/json", body: JSON.stringify(value) });
    const direct = await fetch(`${baseUrl}/api/directs/profile_bobby`, authenticatedRequest(alice.cookie, {
      method: "POST",
      ...json({})
    }));
    assert.equal((await direct.json()).pending, true);
    const sent = await fetch(`${baseUrl}/api/messages`, authenticatedRequest(alice.cookie, {
      method: "POST",
      ...json({ recipientUsername: "profile_bobby", text: "A link https://example.org" })
    }));
    assert.equal(sent.status, 201);
    const sentBody = await sent.json();
    const chat = sentBody.conversation;
    const muted = await fetch(`${baseUrl}/api/chats/${chat.id}/mute`, authenticatedRequest(alice.cookie, {
      method: "POST"
    }));
    assert.equal((await muted.json()).muted, true);
    const bootstrap = await fetch(`${baseUrl}/api/bootstrap`, authenticatedRequest(alice.cookie));
    assert.equal((await bootstrap.json()).directs.find((item) => item.id === chat.id).muted, true);

    const profile = await fetch(`${baseUrl}/api/users/profile_bobby/profile`, authenticatedRequest(alice.cookie));
    const profileBody = await profile.json();
    assert.equal(profileBody.user.username, "profile_bobby");
    assert.equal(profileBody.canMessage, true);
    assert.equal(profileBody.sharedMedia.length, 0);
    assert.deepEqual(profileBody.user.profileDesign, {
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
    });

    const invalidDesign = await fetch(`${baseUrl}/api/account/profile-design`, authenticatedRequest(alice.cookie, {
      method: "PATCH",
      ...json({ theme: "url(javascript:alert(1))", accentColor: "red", font: "unknown", motionEnabled: true })
    }));
    assert.equal(invalidDesign.status, 400);
    const invalidEffectDesign = await fetch(`${baseUrl}/api/account/profile-design`, authenticatedRequest(alice.cookie, {
      method: "PATCH",
      ...json({
        theme: "aurora",
        accentColor: "#4d83d1",
        font: "system",
        motionEnabled: true,
        effects: "url(javascript:alert(1))"
      })
    }));
    assert.equal(invalidEffectDesign.status, 400);
    const ownDesign = await fetch(`${baseUrl}/api/account/profile-design`, authenticatedRequest(alice.cookie, {
      method: "PATCH",
      ...json({
        userId: bob.body.user.id,
        theme: "ocean",
        accentColor: "#1188aa",
        font: "rounded",
        motionEnabled: false,
        gradientStart: "#dff7f8",
        gradientEnd: "#b9dbe8",
        gradientDirection: "horizontal",
        effects: "particles",
        avatarFrame: "double",
        animation: "gradient",
        backgroundImageEnabled: true,
        coverParallax: true
      })
    }));
    assert.equal(ownDesign.status, 200);
    assert.deepEqual((await ownDesign.json()).user.profileDesign, {
      theme: "ocean",
      accentColor: "#1188aa",
      font: "rounded",
      motionEnabled: false,
      gradientStart: "#dff7f8",
      gradientEnd: "#b9dbe8",
      gradientDirection: "horizontal",
      effects: "particles",
      avatarFrame: "double",
      animation: "gradient",
      backgroundImageEnabled: true,
      coverParallax: true
    });
    const legacyDesign = await fetch(`${baseUrl}/api/account/profile-design`, authenticatedRequest(alice.cookie, {
      method: "PATCH",
      ...json({ theme: "sunset", accentColor: "#123456", font: "serif", motionEnabled: true })
    }));
    assert.equal(legacyDesign.status, 200);
    assert.equal((await legacyDesign.json()).user.profileDesign.gradientStart, "#fff0df");
    const bobOwnDesign = await fetch(`${baseUrl}/api/users/profile_bobby/profile`, authenticatedRequest(alice.cookie));
    assert.deepEqual((await bobOwnDesign.json()).user.profileDesign, {
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
    });

    const blocked = await fetch(`${baseUrl}/api/users/profile_bobby/block`, authenticatedRequest(alice.cookie, {
      method: "POST"
    }));
    assert.equal((await blocked.json()).blocked, true);
    const blockedProfile = await fetch(`${baseUrl}/api/users/profile_bobby/profile`, authenticatedRequest(alice.cookie));
    assert.equal((await blockedProfile.json()).canMessage, false);
    const rejectedMessage = await fetch(`${baseUrl}/api/messages`, authenticatedRequest(alice.cookie, {
      method: "POST",
      ...json({ conversationId: chat.id, text: "blocked" })
    }));
    assert.equal(rejectedMessage.status, 403);
    const unblocked = await fetch(`${baseUrl}/api/users/profile_bobby/block`, authenticatedRequest(alice.cookie, {
      method: "DELETE"
    }));
    assert.equal((await unblocked.json()).blocked, false);
    const unmuted = await fetch(`${baseUrl}/api/chats/${chat.id}/mute`, authenticatedRequest(alice.cookie, {
      method: "DELETE"
    }));
    assert.equal((await unmuted.json()).muted, false);

    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const avatar = await fetch(`${baseUrl}/api/account/avatar`, authenticatedRequest(bob.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: png
    }));
    assert.equal(avatar.status, 201);
    const avatarInfo = await avatar.json();
    const avatarResponse = await fetch(`${baseUrl}${avatarInfo.avatarUrl}`, authenticatedRequest(alice.cookie));
    assert.equal(avatarResponse.status, 200);
    assert.equal(avatarResponse.headers.get("content-type"), "image/png");

    const invalidCover = await fetch(`${baseUrl}/api/account/profile-cover`, authenticatedRequest(bob.cookie, {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body: Buffer.from("not an image")
    }));
    assert.equal(invalidCover.status, 400);
    const cover = await fetch(`${baseUrl}/api/account/profile-cover`, authenticatedRequest(bob.cookie, {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body: png
    }));
    assert.equal(cover.status, 201);
    const coverUser = (await cover.json()).user;
    assert.match(coverUser.profileCoverUrl, /^\/api\/profile-covers\//);
    const coverResponse = await fetch(`${baseUrl}${coverUser.profileCoverUrl}`, authenticatedRequest(alice.cookie));
    assert.equal(coverResponse.status, 200);
    assert.equal(coverResponse.headers.get("content-type"), "image/png");
    const wrongOwnerDelete = await fetch(`${baseUrl}/api/account/profile-cover`, authenticatedRequest(alice.cookie, {
      method: "DELETE"
    }));
    assert.equal(wrongOwnerDelete.status, 200);
    const bobCoverStillExists = await fetch(`${baseUrl}${coverUser.profileCoverUrl}`, authenticatedRequest(alice.cookie));
    assert.equal(bobCoverStillExists.status, 200);

    const webmCover = await fetch(`${baseUrl}/api/account/profile-cover`, authenticatedRequest(bob.cookie, {
      method: "POST",
      headers: { "Content-Type": "video/webm" },
      body: Buffer.from([0x1a, 0x45, 0xdf, 0xa3])
    }));
    assert.equal(webmCover.status, 201);
    const videoCoverUser = (await webmCover.json()).user;
    assert.equal(videoCoverUser.profileCoverMimeType, "video/webm");
    const videoCover = await fetch(`${baseUrl}${videoCoverUser.profileCoverUrl}`, authenticatedRequest(alice.cookie));
    assert.equal(videoCover.status, 200);
    assert.equal(videoCover.headers.get("content-type"), "video/webm");

    const updated = await fetch(`${baseUrl}/api/account`, authenticatedRequest(bob.cookie, {
      method: "PATCH",
      ...json({ fullName: "Bobby", about: "Bio", showOnlineStatus: false })
    }));
    assert.equal((await updated.json()).user.showOnlineStatus, false);
    const hiddenStatus = await fetch(`${baseUrl}/api/users/profile_bobby/profile`, authenticatedRequest(alice.cookie));
    assert.equal((await hiddenStatus.json()).user.lastSeenAt, null);
  });

  test("manages private per-user contacts and rejects self or unknown contact additions", async () => {
    await withServer({ store: createEmptyStore() }, async (baseUrl) => {
      const alice = await register(baseUrl, "contacts_alice", "Alice");
      const bob = await register(baseUrl, "contacts_bobby", "Bobby");

      const emptyContacts = await fetch(`${baseUrl}/api/contacts`, authenticatedRequest(alice.cookie));
      assert.deepEqual(await emptyContacts.json(), []);
      const add = await fetch(`${baseUrl}/api/contacts/contacts_bobby`,
        authenticatedRequest(alice.cookie, { method: "PUT" }));
      assert.equal(add.status, 200);
      assert.equal((await add.json()).isContact, true);
      const duplicateAdd = await fetch(`${baseUrl}/api/contacts/contacts_bobby`,
        authenticatedRequest(alice.cookie, { method: "PUT" }));
      assert.equal((await duplicateAdd.json()).isContact, true);
      const aliceContacts = await fetch(`${baseUrl}/api/contacts`, authenticatedRequest(alice.cookie));
      assert.deepEqual((await aliceContacts.json()).map((contact) => contact.id), [bob.body.user.id]);
      const bobContacts = await fetch(`${baseUrl}/api/contacts`, authenticatedRequest(bob.cookie));
      assert.deepEqual(await bobContacts.json(), []);
      const profile = await fetch(`${baseUrl}/api/users/contacts_bobby/profile`, authenticatedRequest(alice.cookie));
      assert.equal((await profile.json()).user.isContact, true);
      const search = await fetch(`${baseUrl}/api/users?q=contacts_bobby`, authenticatedRequest(alice.cookie));
      assert.equal((await search.json())[0].isContact, true);
      const searchById = await fetch(`${baseUrl}/api/users?q=${encodeURIComponent(bob.body.user.id)}`,
        authenticatedRequest(alice.cookie));
      assert.equal((await searchById.json())[0].id, bob.body.user.id);

      await assertApiError(
        await fetch(`${baseUrl}/api/contacts/contacts_alice`, authenticatedRequest(alice.cookie, { method: "PUT" })),
        400,
        "BAD_REQUEST"
      );
      await assertApiError(
        await fetch(`${baseUrl}/api/contacts/missing_user`, authenticatedRequest(alice.cookie, { method: "PUT" })),
        404,
        "NOT_FOUND"
      );
      const remove = await fetch(`${baseUrl}/api/contacts/contacts_bobby`,
        authenticatedRequest(alice.cookie, { method: "DELETE" }));
      assert.equal((await remove.json()).isContact, false);
      const afterRemoval = await fetch(`${baseUrl}/api/contacts`, authenticatedRequest(alice.cookie));
      assert.deepEqual(await afterRemoval.json(), []);
    });
  });

  test("adds multiple contacts to a group atomically and rejects blocked or existing members", async () => {
    await withServer({ store: createEmptyStore() }, async (baseUrl) => {
      const owner = await register(baseUrl, "picker_owner", "Owner");
      const first = await register(baseUrl, "picker_first", "First");
      const second = await register(baseUrl, "picker_second", "Second");
      const blocked = await register(baseUrl, "picker_blocked", "Blocked");
      const json = (value) => ({
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value)
      });
      const groupResponse = await fetch(`${baseUrl}/api/groups`, authenticatedRequest(owner.cookie, {
        method: "POST",
        ...json({ name: "Picker group", usernames: ["picker_first"] })
      }));
      const group = await groupResponse.json();
      const addTwo = await fetch(`${baseUrl}/api/chats/${group.id}/members`,
        authenticatedRequest(owner.cookie, { method: "POST", ...json({ usernames: ["picker_second", "picker_blocked"] }) }));
      assert.equal(addTwo.status, 201);
      assert.equal((await addTwo.json()).added.length, 2);

      const addAlreadyMember = await fetch(`${baseUrl}/api/chats/${group.id}/members`,
        authenticatedRequest(owner.cookie, { method: "POST", ...json({ usernames: ["picker_first", "picker_second"] }) }));
      assert.equal(addAlreadyMember.status, 409);

      await fetch(`${baseUrl}/api/users/picker_blocked/block`, authenticatedRequest(owner.cookie, { method: "POST" }));
      const addBlocked = await fetch(`${baseUrl}/api/chats/${group.id}/members`,
        authenticatedRequest(owner.cookie, { method: "POST", ...json({ usernames: ["picker_blocked"] }) }));
      assert.equal(addBlocked.status, 403);
      const members = await fetch(`${baseUrl}/api/chats/${group.id}`, authenticatedRequest(owner.cookie));
      assert.equal((await members.json()).members.length, 4);
      assert.notEqual(first.body.user.id, second.body.user.id);
    });
  });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("previews public channels without joining and creates multi-member groups", async () => {
  await withServer({ store: createEmptyStore() }, async (baseUrl) => {
    const alice = await register(baseUrl, "group_alice", "Alice");
    const bob = await register(baseUrl, "group_bobby", "Bobby");
    const charlie = await register(baseUrl, "group_charlie", "Charlie");
    const dana = await register(baseUrl, "group_dana", "Dana");

    const createdChannel = await fetch(`${baseUrl}/api/channels`, authenticatedRequest(alice.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Study club", description: "Let's learn together" })
    }));
    assert.equal(createdChannel.status, 201);
    const channel = await createdChannel.json();
    assert.equal(channel.joined, true);
    const channelMessage = await fetch(`${baseUrl}/api/messages`, authenticatedRequest(alice.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: channel.id, text: "Posted before joining" })
    }));
    assert.equal(channelMessage.status, 201);

    const previewHistory = await fetch(
      `${baseUrl}/api/messages?conversationId=${encodeURIComponent(channel.id)}`,
      authenticatedRequest(bob.cookie)
    );
    assert.equal(previewHistory.status, 200);
    const previewMessages = await previewHistory.json();
    assert.equal(previewMessages.messages.length, 1);
    assert.equal(previewMessages.messages[0].text, "Posted before joining");
    const previewBootstrap = await fetch(`${baseUrl}/api/bootstrap`, authenticatedRequest(bob.cookie));
    const previewChannel = (await previewBootstrap.json()).channels.find((item) => item.id === channel.id);
    assert.equal(previewChannel.joined, false);
    assert.equal(previewChannel.unreadCount, 0);

    const blockedPost = await fetch(`${baseUrl}/api/messages`, authenticatedRequest(bob.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: channel.id, text: "Not joined yet" })
    }));
    assert.equal(blockedPost.status, 404);

    const join = await fetch(`${baseUrl}/api/channels/${channel.id}/join`, authenticatedRequest(bob.cookie, {
      method: "POST"
    }));
    assert.equal(join.status, 200);
    assert.equal((await join.json()).joined, true);
    const bobChannelBootstrap = await fetch(`${baseUrl}/api/bootstrap`, authenticatedRequest(bob.cookie));
    const bobChannel = (await bobChannelBootstrap.json()).channels.find((item) => item.id === channel.id);
    assert.equal(bobChannel.unreadCount, 0);

    const groupResponse = await fetch(`${baseUrl}/api/groups`, authenticatedRequest(alice.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Northern lights", usernames: ["group_bobby", "@group_charlie"] })
    }));
    assert.equal(groupResponse.status, 201);
    const group = await groupResponse.json();
    assert.equal(group.type, "group");
    assert.equal(group.memberIds.length, 3);

    const updateGroup = await fetch(`${baseUrl}/api/chats/${group.id}/settings`, authenticatedRequest(alice.cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Northern lights club", description: "Shared study notes" })
    }));
    assert.equal(updateGroup.status, 200);
    assert.equal((await updateGroup.json()).chat.name, "Northern lights club");
    const memberCannotUpdateGroup = await fetch(
      `${baseUrl}/api/chats/${group.id}/settings`,
      authenticatedRequest(bob.cookie, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Renamed without permission" })
      })
    );
    assert.equal(memberCannotUpdateGroup.status, 403);

    const groupMessage = await fetch(`${baseUrl}/api/messages`, authenticatedRequest(alice.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: group.id, text: "Posted before invitation" })
    }));
    assert.equal(groupMessage.status, 201);
    const inviteLateMember = await fetch(`${baseUrl}/api/chats/${group.id}/members`, authenticatedRequest(alice.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "group_dana" })
    }));
    assert.equal(inviteLateMember.status, 201);
    const danaBootstrap = await fetch(`${baseUrl}/api/bootstrap`, authenticatedRequest(dana.cookie));
    const danaGroup = (await danaBootstrap.json()).directs.find((item) => item.id === group.id);
    assert.equal(danaGroup.unreadCount, 0);

    const groupBootstrap = await fetch(`${baseUrl}/api/bootstrap`, authenticatedRequest(charlie.cookie));
    assert.ok((await groupBootstrap.json()).directs.some((direct) => direct.id === group.id));

    const twoPersonGroupResponse = await fetch(`${baseUrl}/api/groups`, authenticatedRequest(alice.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Small community", usernames: ["group_bobby"] })
    }));
    assert.equal(twoPersonGroupResponse.status, 201);
    assert.equal((await twoPersonGroupResponse.json()).memberIds.length, 2);
  });
});

test("supports private channels, rotatable invite links, pinned chats, and scoped deletion", async () => {
  await withServer({ store: createEmptyStore() }, async (baseUrl) => {
    const owner = await register(baseUrl, "invite_owner", "Owner");
    const member = await register(baseUrl, "invite_member", "Member");
    const outsider = await register(baseUrl, "invite_outsider", "Outsider");
    const privateChannelResponse = await fetch(`${baseUrl}/api/channels`, authenticatedRequest(owner.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Private room", isPrivate: true })
    }));
    assert.equal(privateChannelResponse.status, 201);
    const privateChannel = await privateChannelResponse.json();
    assert.equal(privateChannel.isPrivate, true);

    const outsiderBootstrap = await fetch(`${baseUrl}/api/bootstrap`, authenticatedRequest(outsider.cookie));
    assert.equal((await outsiderBootstrap.json()).channels.some((chat) => chat.id === privateChannel.id), false);
    await assertApiError(
      await fetch(`${baseUrl}/api/channels/${privateChannel.id}/profile`, authenticatedRequest(outsider.cookie)),
      404,
      "NOT_FOUND"
    );
    await assertApiError(
      await fetch(`${baseUrl}/api/channels/${privateChannel.id}/join`, authenticatedRequest(outsider.cookie, { method: "POST" })),
      404,
      "NOT_FOUND"
    );

    const inviteResponse = await fetch(`${baseUrl}/api/chats/${privateChannel.id}/invite`,
      authenticatedRequest(owner.cookie, { method: "POST" }));
    assert.equal(inviteResponse.status, 200);
    const invite = await inviteResponse.json();
    assert.match(invite.inviteUrl, /^\/join\/[A-Za-z0-9_-]+$/);
    const token = invite.inviteUrl.split("/").at(-1);
    const joinResponse = await fetch(`${baseUrl}/api/invites/${token}/join`,
      authenticatedRequest(member.cookie, { method: "POST" }));
    assert.equal(joinResponse.status, 200);
    assert.equal((await joinResponse.json()).joined, true);

    const memberBootstrap = await fetch(`${baseUrl}/api/bootstrap`, authenticatedRequest(member.cookie));
    assert.ok((await memberBootstrap.json()).channels.some((chat) => chat.id === privateChannel.id));
    const makePublic = await fetch(`${baseUrl}/api/chats/${privateChannel.id}/settings`,
      authenticatedRequest(owner.cookie, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPrivate: false })
      }));
    assert.equal(makePublic.status, 200);
    const publicBootstrap = await fetch(`${baseUrl}/api/bootstrap`, authenticatedRequest(outsider.cookie));
    assert.ok((await publicBootstrap.json()).channels.some((chat) => chat.id === privateChannel.id));
    const makePrivate = await fetch(`${baseUrl}/api/chats/${privateChannel.id}/settings`,
      authenticatedRequest(owner.cookie, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPrivate: true })
      }));
    assert.equal(makePrivate.status, 200);
    const privateAgainBootstrap = await fetch(`${baseUrl}/api/bootstrap`, authenticatedRequest(outsider.cookie));
    assert.equal((await privateAgainBootstrap.json()).channels.some((chat) => chat.id === privateChannel.id), false);

    const pin = await fetch(`${baseUrl}/api/chats/${privateChannel.id}/pin`,
      authenticatedRequest(member.cookie, { method: "PUT" }));
    assert.equal(pin.status, 200);
    const pinnedBootstrap = await fetch(`${baseUrl}/api/bootstrap`, authenticatedRequest(member.cookie));
    assert.equal((await pinnedBootstrap.json()).channels.find((chat) => chat.id === privateChannel.id).pinned, true);

    const hide = await fetch(`${baseUrl}/api/chats/${privateChannel.id}/hide`,
      authenticatedRequest(member.cookie, { method: "PUT" }));
    assert.equal(hide.status, 200);
    const hiddenBootstrap = await fetch(`${baseUrl}/api/bootstrap`, authenticatedRequest(member.cookie));
    assert.equal((await hiddenBootstrap.json()).channels.some((chat) => chat.id === privateChannel.id), false);
    await fetch(`${baseUrl}/api/chats/${privateChannel.id}/hide`,
      authenticatedRequest(member.cookie, { method: "DELETE" }));

    const revoke = await fetch(`${baseUrl}/api/chats/${privateChannel.id}/invite`,
      authenticatedRequest(owner.cookie, { method: "DELETE" }));
    assert.equal(revoke.status, 200);
    await assertApiError(
      await fetch(`${baseUrl}/api/invites/${token}/join`, authenticatedRequest(outsider.cookie, { method: "POST" })),
      404,
      "NOT_FOUND"
    );

    const groupResponse = await fetch(`${baseUrl}/api/groups`, authenticatedRequest(owner.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Temporary group", usernames: ["invite_member"] })
    }));
    const group = await groupResponse.json();
    const groupInviteResponse = await fetch(`${baseUrl}/api/chats/${group.id}/invite`,
      authenticatedRequest(owner.cookie, { method: "POST" }));
    const groupInvite = await groupInviteResponse.json();
    const groupToken = groupInvite.inviteUrl.split("/").at(-1);
    const groupJoin = await fetch(`${baseUrl}/api/invites/${groupToken}/join`,
      authenticatedRequest(outsider.cookie, { method: "POST" }));
    assert.equal(groupJoin.status, 200);
    assert.equal((await groupJoin.json()).type, "group");
    const hideForMember = await fetch(`${baseUrl}/api/chats/${group.id}?scope=me`,
      authenticatedRequest(member.cookie, { method: "DELETE" }));
    assert.equal(hideForMember.status, 200);
    const memberChats = await fetch(`${baseUrl}/api/bootstrap`, authenticatedRequest(member.cookie));
    assert.equal((await memberChats.json()).directs.some((chat) => chat.id === group.id), false);
    const newMessage = await fetch(`${baseUrl}/api/messages`, authenticatedRequest(owner.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: group.id, text: "A new message restores the chat" })
    }));
    assert.equal(newMessage.status, 201);
    const restoredChats = await fetch(`${baseUrl}/api/bootstrap`, authenticatedRequest(member.cookie));
    assert.equal((await restoredChats.json()).directs.some((chat) => chat.id === group.id), true);
    await fetch(`${baseUrl}/api/chats/${group.id}?scope=me`,
      authenticatedRequest(member.cookie, { method: "DELETE" }));
    const deleteForEveryone = await fetch(`${baseUrl}/api/chats/${group.id}?scope=everyone`,
      authenticatedRequest(owner.cookie, { method: "DELETE" }));
    assert.equal(deleteForEveryone.status, 200);

    for (const route of [
      `/channels/${privateChannel.id}`,
      `/channels/${privateChannel.id}/settings`,
      `/groups/${group.id}/settings`,
      `/join/${token}`
    ]) {
      const page = await fetch(`${baseUrl}${route}`);
      assert.equal(page.status, 200);
      assert.match(page.headers.get("content-type"), /text\/html/);
    }
  });
});

test("creates exactly one direct chat when the first messages race", async () => {
  await withServer({ store: createEmptyStore() }, async (baseUrl) => {
    const alice = await register(baseUrl, "race_alice", "Alice");
    const bob = await register(baseUrl, "race_bobby", "Bobby");
    const send = (text) => fetch(`${baseUrl}/api/messages`, authenticatedRequest(alice.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipientUsername: "race_bobby", text })
    }));

    const responses = await Promise.all([send("First"), send("Second")]);
    assert.deepEqual(responses.map((response) => response.status), [201, 201]);
    const messages = await Promise.all(responses.map((response) => response.json()));
    assert.equal(messages[0].conversation.id, messages[1].conversation.id);
    assert.equal(messages[0].conversation.memberIds.length, 2);

    const bootstrap = await fetch(`${baseUrl}/api/bootstrap`, authenticatedRequest(bob.cookie));
    const bobDirects = (await bootstrap.json()).directs.filter((chat) => chat.type === "direct");
    assert.equal(bobDirects.length, 1);
    assert.equal(bobDirects[0].unreadCount, 2);
  });
});

test("does not create a direct chat when message validation fails", async () => {
  await withServer({ store: createEmptyStore() }, async (baseUrl) => {
    const alice = await register(baseUrl, "validation_alice", "Alice");
    const bob = await register(baseUrl, "validation_bobby", "Bobby");
    const json = (value) => ({ "Content-Type": "application/json", body: JSON.stringify(value) });
    const assertNoDirectChats = async () => {
      for (const account of [alice, bob]) {
        const response = await fetch(`${baseUrl}/api/bootstrap`, authenticatedRequest(account.cookie));
        assert.equal(response.status, 200);
        assert.equal((await response.json()).directs.some((chat) => chat.type === "direct"), false);
      }
    };
    const send = (payload) => fetch(`${baseUrl}/api/messages`, authenticatedRequest(alice.cookie, {
      method: "POST",
      ...json({ recipientUsername: "validation_bobby", text: "Hello", ...payload })
    }));

    const invalidReply = await send({ replyToId: 999 });
    assert.equal(invalidReply.status, 404);
    await assertNoDirectChats();

    const invalidAttachment = await send({ attachmentIds: ["missing-attachment"] });
    assert.equal(invalidAttachment.status, 400);
    await assertNoDirectChats();

    const blocked = await fetch(`${baseUrl}/api/users/validation_alice/block`, authenticatedRequest(bob.cookie, {
      method: "POST"
    }));
    assert.equal(blocked.status, 200);
    const blockedMessage = await send({});
    assert.equal(blockedMessage.status, 403);
    await assertNoDirectChats();
  });
});

test("migrates only the three removed legacy channels and their persisted content", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "polus-migration-"));
  try {
    const uploads = path.join(directory, "uploads");
    for (const id of ["general", "introductions", "off-topic", "other-channel"]) {
      await fs.mkdir(path.join(uploads, id), { recursive: true });
      await fs.writeFile(path.join(uploads, id, "fixture.bin"), "test");
    }
    const filePath = path.join(directory, "polus-store.json");
    await fs.writeFile(filePath, JSON.stringify({
      ...createEmptyStore(),
      channels: ["general", "introductions", "off-topic", "other-channel"]
        .map((id) => ({ id, memberIds: [] })),
      messages: [
        { id: "legacy-message", room: "general", text: "legacy" },
        { id: "kept-message", room: "other-channel", text: "kept" }
      ],
      attachments: [
        { id: "legacy-attachment", chatId: "general", messageId: "legacy-message" },
        { id: "kept-attachment", chatId: "other-channel", messageId: "kept-message" }
      ],
      links: [
        { id: "legacy-link", chatId: "general", messageId: "legacy-message" },
        { id: "kept-link", chatId: "other-channel", messageId: "kept-message" }
      ]
    }));
    await fs.writeFile(path.join(directory, "messages.jsonl"), [
      JSON.stringify({ room: "general", message: "removed" }),
      JSON.stringify({ room: "other-channel", message: "kept" })
    ].join("\n"));

    const store = await loadStore(filePath);
    assert.deepEqual(store.channels.map((channel) => channel.id), ["other-channel"]);
    assert.deepEqual(store.messages.map((message) => message.id), [1]);
    assert.deepEqual(store.attachments.map((attachment) => attachment.id), ["kept-attachment"]);
    assert.deepEqual(store.links.map((link) => link.id), ["kept-link"]);
    assert.equal(store.attachments[0].messageId, 1);
    assert.equal(store.links[0].messageId, 1);
    for (const id of ["general", "introductions", "off-topic"]) {
      await assert.rejects(fs.access(path.join(uploads, id)), { code: "ENOENT" });
    }
    await fs.access(path.join(uploads, "other-channel"));
    const legacyMessages = await fs.readFile(path.join(directory, "messages.jsonl"), "utf8");
    assert.match(legacyMessages, /other-channel/);
    assert.doesNotMatch(legacyMessages, /"general"/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("lets channel owners and administrators choose whether messages are displayed as the channel", async () => {
  await withServer({ store: createEmptyStore() }, async (baseUrl) => {
    const owner = await register(baseUrl, "identity_owner", "Channel Owner");
    const admin = await register(baseUrl, "identity_admin", "Channel Admin");
    const member = await register(baseUrl, "identity_member", "Channel Member");
    const json = (value) => ({ "Content-Type": "application/json", body: JSON.stringify(value) });
    const created = await fetch(`${baseUrl}/api/channels`, authenticatedRequest(owner.cookie, {
      method: "POST",
      ...json({ name: "Identity channel", isPrivate: true })
    }));
    const channel = await created.json();
    assert.equal(channel.postAs, "person");

    for (const username of ["identity_admin", "identity_member"]) {
      const invited = await fetch(`${baseUrl}/api/chats/${channel.id}/members`, authenticatedRequest(owner.cookie, {
        method: "POST",
        ...json({ username })
      }));
      assert.equal(invited.status, 201);
    }
    const promoted = await fetch(
      `${baseUrl}/api/chats/${channel.id}/admins/${admin.body.user.id}`,
      authenticatedRequest(owner.cookie, { method: "PUT", ...json({ role: "admin" }) })
    );
    assert.equal(promoted.status, 200);

    const send = async (account, text) => {
      const response = await fetch(`${baseUrl}/api/messages`, authenticatedRequest(account.cookie, {
        method: "POST",
        ...json({ conversationId: channel.id, text })
      }));
      assert.equal(response.status, 201);
      return response.json();
    };
    const beforeChange = await send(owner, "Before identity change");
    assert.equal(beforeChange.displayAuthor, undefined);
    assert.equal(beforeChange.author.fullName, "Channel Owner");

    for (const account of [member]) {
      const forbidden = await fetch(`${baseUrl}/api/chats/${channel.id}/settings`, authenticatedRequest(account.cookie, {
        method: "PUT",
        ...json({ postAs: "channel" })
      }));
      assert.equal(forbidden.status, 403);
    }
    const adminChange = await fetch(`${baseUrl}/api/chats/${channel.id}/settings`, authenticatedRequest(admin.cookie, {
      method: "PUT",
      ...json({ postAs: "channel" })
    }));
    assert.equal(adminChange.status, 200);
    assert.equal((await adminChange.json()).chat.postAs, "channel");
    const invalid = await fetch(`${baseUrl}/api/chats/${channel.id}/settings`, authenticatedRequest(owner.cookie, {
      method: "PUT",
      ...json({ postAs: "everyone" })
    }));
    assert.equal(invalid.status, 400);

    const changed = await fetch(`${baseUrl}/api/chats/${channel.id}/settings`, authenticatedRequest(owner.cookie, {
      method: "PUT",
      ...json({ postAs: "channel" })
    }));
    assert.equal(changed.status, 200);
    assert.equal((await changed.json()).chat.postAs, "channel");

    const afterChange = await send(admin, "Posted as the channel");
    assert.equal(afterChange.authorId, admin.body.user.id);
    assert.equal(afterChange.author.fullName, "Channel Admin");
    assert.deepEqual(afterChange.displayAuthor, {
      id: channel.id,
      fullName: "Identity channel",
      avatarUrl: null,
      isChannel: true
    });

    const history = await fetch(`${baseUrl}/api/messages?conversationId=${encodeURIComponent(channel.id)}`,
      authenticatedRequest(member.cookie));
    const historyBody = await history.json();
    assert.equal(historyBody.messages[0].displayAuthor.fullName, "Identity channel");
    assert.equal(historyBody.messages[1].displayAuthor.fullName, "Identity channel");

    const restored = await fetch(`${baseUrl}/api/chats/${channel.id}/settings`, authenticatedRequest(owner.cookie, {
      method: "PUT",
      ...json({ postAs: "person" })
    }));
    assert.equal((await restored.json()).chat.postAs, "person");
    const personHistory = await fetch(`${baseUrl}/api/messages?conversationId=${encodeURIComponent(channel.id)}`,
      authenticatedRequest(member.cookie));
    assert.equal((await personHistory.json()).messages.every((message) => !message.displayAuthor), true);

    const updatedDetails = await fetch(`${baseUrl}/api/chats/${channel.id}/settings`, authenticatedRequest(owner.cookie, {
      method: "PUT",
      ...json({ name: "Updated channel", description: "Updated description" })
    }));
    assert.equal(updatedDetails.status, 200);
    const updatedChat = (await updatedDetails.json()).chat;
    assert.equal(updatedChat.name, "Updated channel");
    assert.equal(updatedChat.description, "Updated description");

    const invalidDetails = await fetch(`${baseUrl}/api/chats/${channel.id}/settings`, authenticatedRequest(owner.cookie, {
      method: "PUT",
      ...json({ name: " ", description: 123 })
    }));
    assert.equal(invalidDetails.status, 400);
    const unchanged = await fetch(`${baseUrl}/api/chats/${channel.id}`, authenticatedRequest(owner.cookie));
    assert.equal((await unchanged.json()).chat.name, "Updated channel");
  });
});

test("enforces individual channel administrator publishing, editing, and deletion permissions", async () => {
  await withServer({ store: createEmptyStore() }, async (baseUrl) => {
    const owner = await register(baseUrl, "rights_owner", "Rights Owner");
    const admin = await register(baseUrl, "rights_admin", "Rights Admin");
    const member = await register(baseUrl, "rights_member", "Rights Member");
    const json = (value) => ({ "Content-Type": "application/json", body: JSON.stringify(value) });
    const created = await fetch(`${baseUrl}/api/channels`, authenticatedRequest(owner.cookie, {
      method: "POST",
      ...json({ name: "Permissions channel", isPrivate: true })
    }));
    const channel = await created.json();
    for (const username of ["rights_admin", "rights_member"]) {
      const added = await fetch(`${baseUrl}/api/chats/${channel.id}/members`, authenticatedRequest(owner.cookie, {
        method: "POST",
        ...json({ username })
      }));
      assert.equal(added.status, 201);
    }
    const promoted = await fetch(`${baseUrl}/api/chats/${channel.id}/admins/${admin.body.user.id}`,
      authenticatedRequest(owner.cookie, { method: "PUT", ...json({ role: "admin" }) }));
    assert.equal(promoted.status, 200);

    const ownerManagement = await fetch(`${baseUrl}/api/chats/${channel.id}`,
      authenticatedRequest(owner.cookie));
    const ownerDetails = await ownerManagement.json();
    assert.deepEqual(ownerDetails.adminPermissions[admin.body.user.id], {
      publish: true,
      editMessages: true,
      deleteMessages: true
    });
    const adminManagement = await fetch(`${baseUrl}/api/chats/${channel.id}`,
      authenticatedRequest(admin.cookie));
    const adminDetails = await adminManagement.json();
    assert.deepEqual(Object.keys(adminDetails.adminPermissions), [admin.body.user.id]);

    const post = async (account, text) => fetch(`${baseUrl}/api/messages`, authenticatedRequest(account.cookie, {
      method: "POST",
      ...json({ conversationId: channel.id, text })
    }));
    const ownerMessageResponse = await post(owner, "Owner's channel message");
    assert.equal(ownerMessageResponse.status, 201);
    const ownerMessage = await ownerMessageResponse.json();
    const permissions = { publish: false, editMessages: false, deleteMessages: false };
    const updated = await fetch(`${baseUrl}/api/chats/${channel.id}/admins/${admin.body.user.id}`,
      authenticatedRequest(owner.cookie, { method: "PUT", ...json({ permissions }) }));
    assert.equal(updated.status, 200);
    assert.deepEqual((await updated.json()).permissions, permissions);

    assert.equal((await post(admin, "Not allowed")).status, 403);
    const adminPostIdentity = await fetch(`${baseUrl}/api/chats/${channel.id}/settings`,
      authenticatedRequest(admin.cookie, { method: "PUT", ...json({ postAs: "channel" }) }));
    assert.equal(adminPostIdentity.status, 200);
    assert.equal((await adminPostIdentity.json()).chat.postAs, "channel");
    const editForbidden = await fetch(`${baseUrl}/api/messages/${ownerMessage.id}`, authenticatedRequest(admin.cookie, {
      method: "PATCH",
      ...json({ text: "Not allowed" })
    }));
    assert.equal(editForbidden.status, 403);
    const deleteForbidden = await fetch(`${baseUrl}/api/messages/${ownerMessage.id}`, authenticatedRequest(admin.cookie, {
      method: "DELETE"
    }));
    assert.equal(deleteForbidden.status, 403);

    const partialPermissions = { publish: true, editMessages: true, deleteMessages: false };
    const partialUpdate = await fetch(`${baseUrl}/api/chats/${channel.id}/admins/${admin.body.user.id}`,
      authenticatedRequest(owner.cookie, { method: "PUT", ...json({ permissions: partialPermissions }) }));
    assert.equal(partialUpdate.status, 200);
    const adminMessageResponse = await post(admin, "Allowed admin post");
    assert.equal(adminMessageResponse.status, 201);
    assert.ok((await adminMessageResponse.json()).id);
    const editOther = await fetch(`${baseUrl}/api/messages/${ownerMessage.id}`, authenticatedRequest(admin.cookie, {
      method: "PATCH",
      ...json({ text: "Edited by admin" })
    }));
    assert.equal(editOther.status, 200);
    assert.equal((await editOther.json()).text, "Edited by admin");
    const deleteStillForbidden = await fetch(`${baseUrl}/api/messages/${ownerMessage.id}`, authenticatedRequest(admin.cookie, {
      method: "DELETE"
    }));
    assert.equal(deleteStillForbidden.status, 403);

    const invalidPermissions = await fetch(`${baseUrl}/api/chats/${channel.id}/admins/${admin.body.user.id}`,
      authenticatedRequest(owner.cookie, {
        method: "PUT",
        ...json({ permissions: { publish: true, editMessages: true, deleteMessages: true, transferOwnership: true } })
      }));
    assert.equal(invalidPermissions.status, 400);
    const fullPermissions = { ...partialPermissions, deleteMessages: true };
    const fullUpdate = await fetch(`${baseUrl}/api/chats/${channel.id}/admins/${admin.body.user.id}`,
      authenticatedRequest(owner.cookie, { method: "PUT", ...json({ permissions: fullPermissions }) }));
    assert.equal(fullUpdate.status, 200);
    const deleteAllowed = await fetch(`${baseUrl}/api/messages/${ownerMessage.id}`,
      authenticatedRequest(admin.cookie, { method: "DELETE" }));
    assert.equal(deleteAllowed.status, 200);

    const removeAdmin = await fetch(`${baseUrl}/api/chats/${channel.id}/admins/${admin.body.user.id}`,
      authenticatedRequest(owner.cookie, { method: "PUT", ...json({ role: "member" }) }));
    assert.equal(removeAdmin.status, 200);
    const demotedDetails = await fetch(`${baseUrl}/api/chats/${channel.id}`,
      authenticatedRequest(owner.cookie));
    assert.equal((await demotedDetails.json()).adminPermissions[admin.body.user.id], undefined);
    assert.equal((await post(member, "Member cannot publish")).status, 403);
  });
});

test("enforces channel and group owner/admin/member permissions and ownership transfer", async () => {
  await withServer({ store: createEmptyStore() }, async (baseUrl) => {
    const owner = await register(baseUrl, "roles_owner", "Owner");
    const admin = await register(baseUrl, "roles_admin", "Admin");
    const member = await register(baseUrl, "roles_member", "Member");
    const outsider = await register(baseUrl, "roles_outsider", "Outsider");
    const json = (value) => ({ "Content-Type": "application/json", body: JSON.stringify(value) });

    const channelResponse = await fetch(`${baseUrl}/api/channels`, authenticatedRequest(owner.cookie, {
      method: "POST",
      ...json({ name: "Role channel" })
    }));
    const channel = await channelResponse.json();
    assert.equal(channel.role, "owner");
    assert.equal(channel.ownerId, channel.memberIds[0]);

    const join = await fetch(`${baseUrl}/api/channels/${channel.id}/join`, authenticatedRequest(member.cookie, {
      method: "POST"
    }));
    assert.equal(join.status, 200);
    const leaveChannel = await fetch(`${baseUrl}/api/chats/${channel.id}/leave`, authenticatedRequest(member.cookie, {
      method: "POST"
    }));
    assert.equal(leaveChannel.status, 200);
    const leftChannelHistory = await fetch(
      `${baseUrl}/api/messages?conversationId=${encodeURIComponent(channel.id)}`,
      authenticatedRequest(member.cookie)
    );
    assert.equal(leftChannelHistory.status, 200);
    const rejoin = await fetch(`${baseUrl}/api/channels/${channel.id}/join`, authenticatedRequest(member.cookie, {
      method: "POST"
    }));
    assert.equal(rejoin.status, 200);
    const ownerMessage = await fetch(`${baseUrl}/api/messages`, authenticatedRequest(owner.cookie, {
      method: "POST",
      ...json({ conversationId: channel.id, text: "Owner message" })
    }));
    assert.equal(ownerMessage.status, 201);
    const ownerMessageBody = await ownerMessage.json();
    const memberPost = await fetch(`${baseUrl}/api/messages`, authenticatedRequest(member.cookie, {
      method: "POST",
      ...json({ conversationId: channel.id, text: "not allowed" })
    }));
    assert.equal(memberPost.status, 403);
    const memberReply = await fetch(`${baseUrl}/api/messages`, authenticatedRequest(member.cookie, {
      method: "POST",
      ...json({
        conversationId: channel.id,
        text: "reply not allowed",
        replyToId: ownerMessageBody.id
      })
    }));
    assert.equal(memberReply.status, 403);

    const joinAdmin = await fetch(`${baseUrl}/api/channels/${channel.id}/join`,
      authenticatedRequest(admin.cookie, { method: "POST" }));
    assert.equal(joinAdmin.status, 200);
    const promote = await fetch(
      `${baseUrl}/api/chats/${channel.id}/admins/${admin.body.user.id}`,
      authenticatedRequest(owner.cookie, { method: "PUT", ...json({ role: "admin" }) })
    );
    assert.equal(promote.status, 200);
    const adminPost = await fetch(`${baseUrl}/api/messages`, authenticatedRequest(admin.cookie, {
      method: "POST",
      ...json({ conversationId: channel.id, text: "Admin post" })
    }));
    assert.equal(adminPost.status, 201);
    const adminPostMessage = await adminPost.json();
    const outsiderHistory = await fetch(
      `${baseUrl}/api/messages?conversationId=${encodeURIComponent(channel.id)}`,
      authenticatedRequest(outsider.cookie)
    );
    assert.equal(outsiderHistory.status, 200);
    const leaveAsAdmin = await fetch(`${baseUrl}/api/chats/${channel.id}/leave`,
      authenticatedRequest(admin.cookie, { method: "POST" }));
    assert.equal(leaveAsAdmin.status, 200);
    const editAfterLeaving = await fetch(`${baseUrl}/api/messages/${adminPostMessage.id}`,
      authenticatedRequest(admin.cookie, {
        method: "PATCH",
        ...json({ text: "Tampered after leaving" })
      }));
    assert.equal(editAfterLeaving.status, 404);
    const deleteAfterLeaving = await fetch(`${baseUrl}/api/messages/${adminPostMessage.id}`,
      authenticatedRequest(admin.cookie, { method: "DELETE" }));
    assert.equal(deleteAfterLeaving.status, 404);
    const ownerHistory = await fetch(
      `${baseUrl}/api/messages?conversationId=${encodeURIComponent(channel.id)}`,
      authenticatedRequest(owner.cookie)
    );
    assert.equal((await ownerHistory.json()).messages[0].text, "Admin post");

    const groupResponse = await fetch(`${baseUrl}/api/groups`, authenticatedRequest(owner.cookie, {
      method: "POST",
      ...json({ name: "Private group", usernames: ["roles_admin", "roles_member"] })
    }));
    assert.equal(groupResponse.status, 201);
    const group = await groupResponse.json();
    const hiddenGroup = await fetch(`${baseUrl}/api/chats/${group.id}`, authenticatedRequest(outsider.cookie));
    assert.equal(hiddenGroup.status, 404);
    assert.equal((await hiddenGroup.json()).error.code, "NOT_FOUND");

    const ownerLeave = await fetch(`${baseUrl}/api/chats/${group.id}/leave`, authenticatedRequest(owner.cookie, {
      method: "POST"
    }));
    assert.equal(ownerLeave.status, 409);

    const promoteGroupAdmin = await fetch(
      `${baseUrl}/api/chats/${group.id}/admins/${admin.body.user.id}`,
      authenticatedRequest(owner.cookie, { method: "PUT", ...json({ role: "admin" }) })
    );
    assert.equal(promoteGroupAdmin.status, 200);
    const invited = await fetch(`${baseUrl}/api/chats/${group.id}/members`, authenticatedRequest(admin.cookie, {
      method: "POST",
      ...json({ username: "roles_outsider" })
    }));
    assert.equal(invited.status, 201);
    const removed = await fetch(
      `${baseUrl}/api/chats/${group.id}/members/${outsider.body.user.id}`,
      authenticatedRequest(admin.cookie, { method: "DELETE" })
    );
    assert.equal(removed.status, 200);
    const promotedMember = await fetch(
      `${baseUrl}/api/chats/${group.id}/admins/${member.body.user.id}`,
      authenticatedRequest(owner.cookie, { method: "PUT", ...json({ role: "admin" }) })
    );
    assert.equal(promotedMember.status, 200);
    const adminCannotRemoveAdmin = await fetch(
      `${baseUrl}/api/chats/${group.id}/members/${member.body.user.id}`,
      authenticatedRequest(admin.cookie, { method: "DELETE" })
    );
    assert.equal(adminCannotRemoveAdmin.status, 403);

    const transfer = await fetch(`${baseUrl}/api/chats/${group.id}/owner`, authenticatedRequest(owner.cookie, {
      method: "PUT",
      ...json({ username: "roles_admin" })
    }));
    assert.equal(transfer.status, 200);
    assert.equal((await transfer.json()).chat.ownerId, admin.body.user.id);
    const oldOwnerLeave = await fetch(`${baseUrl}/api/chats/${group.id}/leave`, authenticatedRequest(owner.cookie, {
      method: "POST"
    }));
    assert.equal(oldOwnerLeave.status, 200);
    const deleteGroup = await fetch(`${baseUrl}/api/chats/${group.id}`, authenticatedRequest(admin.cookie, {
      method: "DELETE"
    }));
    assert.equal(deleteGroup.status, 200);
    const deletedGroup = await fetch(`${baseUrl}/api/chats/${group.id}`, authenticatedRequest(member.cookie));
    assert.equal(deletedGroup.status, 404);
  });
});

test("discovers public channels and groups and allows joining public groups", async () => {
  await withServer({ store: createEmptyStore() }, async (baseUrl) => {
    const owner = await register(baseUrl, "discover_owner", "Owner");
    const outsider = await register(baseUrl, "discover_outsider", "Outsider");
    const json = (value) => ({
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value)
    });

    const publicChannelResponse = await fetch(`${baseUrl}/api/channels`, authenticatedRequest(owner.cookie, {
      method: "POST",
      ...json({ name: "Public Reading Room" })
    }));
    const publicChannel = await publicChannelResponse.json();
    const privateChannelResponse = await fetch(`${baseUrl}/api/channels`, authenticatedRequest(owner.cookie, {
      method: "POST",
      ...json({ name: "Private Reading Room", isPrivate: true })
    }));
    const privateChannel = await privateChannelResponse.json();
    const publicGroupResponse = await fetch(`${baseUrl}/api/groups`, authenticatedRequest(owner.cookie, {
      method: "POST",
      ...json({ name: "Public Book Club", description: "Read together", isPublic: true, usernames: [] })
    }));
    assert.equal(publicGroupResponse.status, 201);
    const publicGroup = await publicGroupResponse.json();
    assert.equal(publicGroup.isPublic, true);
    assert.equal(publicGroup.memberIds.length, 1);
    const privateGroupResponse = await fetch(`${baseUrl}/api/groups`, authenticatedRequest(owner.cookie, {
      method: "POST",
      ...json({ name: "Private Book Club", usernames: ["discover_outsider"] })
    }));
    const privateGroup = await privateGroupResponse.json();

    const discoverResponse = await fetch(`${baseUrl}/api/discover?q=book`, authenticatedRequest(outsider.cookie));
    assert.equal(discoverResponse.status, 200);
    const discovery = await discoverResponse.json();
    assert.deepEqual(discovery.users, []);
    assert.deepEqual(discovery.channels, []);
    assert.deepEqual(discovery.groups.map((group) => group.id), [publicGroup.id]);
    assert.equal(discovery.groups[0].joined, false);
    assert.equal(discovery.groups[0].memberCount, 1);

    const channelDiscovery = await fetch(`${baseUrl}/api/discover?q=reading`, authenticatedRequest(outsider.cookie));
    const publicChannels = (await channelDiscovery.json()).channels;
    assert.deepEqual(publicChannels.map((channel) => channel.id), [publicChannel.id]);
    assert.equal(publicChannels[0].joined, false);
    await assertApiError(
      await fetch(`${baseUrl}/api/groups/${privateGroup.id}/join`, authenticatedRequest(outsider.cookie, { method: "POST" })),
      404,
      "NOT_FOUND"
    );

    const joinedResponse = await fetch(`${baseUrl}/api/groups/${publicGroup.id}/join`,
      authenticatedRequest(outsider.cookie, { method: "POST" }));
    assert.equal(joinedResponse.status, 200);
    assert.equal((await joinedResponse.json()).joined, true);
    const outsiderBootstrap = await fetch(`${baseUrl}/api/bootstrap`, authenticatedRequest(outsider.cookie));
    assert.ok((await outsiderBootstrap.json()).directs.some((chat) => chat.id === publicGroup.id));

    const nonOwnerPrivacyChange = await fetch(`${baseUrl}/api/chats/${publicGroup.id}/settings`,
      authenticatedRequest(outsider.cookie, { method: "PUT", ...json({ isPublic: false }) }));
    assert.equal(nonOwnerPrivacyChange.status, 403);
    const makePrivate = await fetch(`${baseUrl}/api/chats/${publicGroup.id}/settings`,
      authenticatedRequest(owner.cookie, { method: "PUT", ...json({ isPublic: false }) }));
    assert.equal(makePrivate.status, 200);
    assert.equal((await makePrivate.json()).chat.isPublic, false);
    const privateDiscovery = await fetch(`${baseUrl}/api/discover?q=book`, authenticatedRequest(outsider.cookie));
    assert.deepEqual((await privateDiscovery.json()).groups, []);

    const discoverChannelsAndPeople = await fetch(`${baseUrl}/api/discover?q=discover`, authenticatedRequest(owner.cookie));
    const broadResults = await discoverChannelsAndPeople.json();
    assert.ok(broadResults.users.some((candidate) => candidate.username === "discover_outsider"));
    assert.equal(broadResults.channels.length, 0);
    assert.equal(broadResults.groups.length, 0);
    assert.notEqual(privateChannel.id, publicChannel.id);
  });
});
