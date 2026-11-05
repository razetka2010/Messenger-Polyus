const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { afterEach, test } = require("node:test");
const apiClientPromise = import("../client/src/apiClient.mjs");
const conversationListPromise = import("../client/src/conversationList.mjs");

const originalFetch = globalThis.fetch;
const originalLocalStorage = globalThis.localStorage;
const originalIndexedDB = globalThis.indexedDB;
const diagnosticsPromise = import("../client/src/diagnostics.mjs");
const encryptionPromise = import("../client/src/encryption.mjs");
const attachmentUploadsPromise = import("../client/src/attachmentUploads.mjs");
const attachmentFormattingPromise = import("../client/src/attachmentFormatting.mjs");

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalLocalStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = originalLocalStorage;
  if (originalIndexedDB === undefined) delete globalThis.indexedDB;
  else globalThis.indexedDB = originalIndexedDB;
});

test("JSON API client sends same-origin JSON requests", async () => {
  const { requestJson } = await apiClientPromise;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  assert.deepEqual(await requestJson("/api/test", {
    method: "POST",
    body: JSON.stringify({ value: 1 }),
    headers: { "X-Test": "yes" }
  }), { ok: true });
  assert.equal(request.url, "/api/test");
  assert.equal(request.options.credentials, "same-origin");
  assert.equal(request.options.headers["Content-Type"], "application/json");
  assert.equal(request.options.headers["X-Test"], "yes");
});

test("JSON API client binds each request and returned API resources to its account", async () => {
<<<<<<< Updated upstream
  const { accountApiUrl, requestJson } = await apiClientPromise;
=======
  const { requestJson } = await apiClientPromise;
>>>>>>> Stashed changes
  const accountKey = "a".repeat(32);
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({
      user: { avatarUrl: "/api/avatars/user-1?v=avatar" }
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const response = await requestJson("/api/auth/me", { accountKey });
  assert.equal(request.options.headers["X-Polus-Account"], accountKey);
<<<<<<< Updated upstream
  assert.equal(new URLSearchParams(response.user.avatarUrl.split("?")[1]).get("accountKey"), accountKey);
  assert.equal(accountApiUrl("/api/stream", accountKey), `/api/stream?accountKey=${accountKey}`);
=======
  assert.equal(response.user.avatarUrl, "/api/avatars/user-1?v=avatar");
  assert.equal(request.url, "/api/auth/me");
  assert.doesNotMatch(request.url, /accountKey/);
});

test("fetch event streams send account headers and parse server events without URL credentials", async () => {
  const { connectEventStream } = await apiClientPromise;
  const accountKey = "b".repeat(32);
  let request;
  let stream;
  let resolveEvent;
  const eventReceived = new Promise((resolve) => { resolveEvent = resolve; });
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("id: 42\r\nevent: chat-updated\r\ndata: {\"id\":\"chat-1\"}\r\n\r\n"));
        controller.close();
      }
    });
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" }
    });
  };
  stream = connectEventStream("/api/stream", {
    accountKey,
    onEvent(event) {
      resolveEvent(event);
      stream.close();
    }
  });
  const event = await eventReceived;
  assert.equal(request.url, "/api/stream");
  assert.equal(request.options.headers["X-Polus-Account"], accountKey);
  assert.equal(event.type, "chat-updated");
  assert.equal(event.lastEventId, "42");
  assert.deepEqual(JSON.parse(event.data), { id: "chat-1" });
});

test("authenticated resource fetches select the account through a header", async () => {
  const { fetchAccountResource } = await apiClientPromise;
  const accountKey = "c".repeat(32);
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  };
  const blob = await fetchAccountResource("/api/attachments/file-1", accountKey);
  assert.equal(request.url, "/api/attachments/file-1");
  assert.equal(request.options.headers["X-Polus-Account"], accountKey);
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [1, 2, 3]);
>>>>>>> Stashed changes
});

test("JSON API client preserves server errors and response status", async () => {
  const { ApiError, requestJson } = await apiClientPromise;
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: { code: "NOT_FOUND", message: "Not found." }
  }), {
    status: 404,
    headers: { "Content-Type": "application/json" }
  });

  await assert.rejects(requestJson("/api/missing"), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 404);
    assert.equal(error.message, "Not found.");
    return true;
  });
});

test("JSON API client reports invalid successful responses", async () => {
  const { requestJson } = await apiClientPromise;
  globalThis.fetch = async () => new Response("not-json", { status: 200 });

  await assert.rejects(requestJson("/api/test"), {
    message: "The server returned an invalid response."
  });
});

<<<<<<< Updated upstream
=======
test("encrypted attachment uploads hide the original file name and MIME type", async () => {
  const { uploadAttachment } = await attachmentUploadsPromise;
  const originalXhr = globalThis.XMLHttpRequest;
  let request;
  class TestXmlHttpRequest extends EventTarget {
    constructor() {
      super();
      this.upload = new EventTarget();
      this.headers = {};
      this.status = 201;
      this.responseText = JSON.stringify({ id: "attachment-1" });
      request = this;
    }

    open(method, url) {
      this.method = method;
      this.url = url;
    }

    setRequestHeader(name, value) {
      this.headers[name] = value;
    }

    send(body) {
      this.body = body;
      queueMicrotask(() => this.dispatchEvent(new Event("load")));
    }
  }
  globalThis.XMLHttpRequest = TestXmlHttpRequest;
  try {
    await uploadAttachment(
      "chat-1",
      { name: "private-finances.xlsx", type: "application/vnd.ms-excel", size: 32 },
      new AbortController().signal,
      () => {},
      { encrypted: true }
    );
    assert.equal(request.headers["X-File-Name"], "encrypted.bin");
    assert.equal(request.headers["X-File-Mime-Type"], "application/octet-stream");
    assert.equal(request.headers["X-Polus-Encrypted"], "true");
    assert.equal(request.headers["X-File-Name"].includes("private-finances"), false);
  } finally {
    if (originalXhr === undefined) delete globalThis.XMLHttpRequest;
    else globalThis.XMLHttpRequest = originalXhr;
  }
});

test("formats attachment sizes for message file cards", async () => {
  const { formatAttachmentSize } = await attachmentFormattingPromise;
  assert.equal(formatAttachmentSize(0), "0 B");
  assert.equal(formatAttachmentSize(512), "512 B");
  assert.equal(formatAttachmentSize(1024), "1.0 KB");
  assert.equal(formatAttachmentSize(1024 * 1024), "1.0 MB");
});

test("encrypts attachments in authenticated chunks and decrypts them from a stream", async () => {
  const { encryptAttachment, decryptAttachment } = await encryptionPromise;
  const plaintext = new Uint8Array(1024 * 1024 + 73);
  for (let index = 0; index < plaintext.length; index += 1) plaintext[index] = index % 251;
  const file = new File([plaintext], "chunked.bin", { type: "application/octet-stream" });
  const encrypted = await encryptAttachment(file);
  assert.equal(encrypted.metadata.encryptionVersion, 1);
  assert.equal(encrypted.metadata.chunkSize, 1024 * 1024);
  assert.equal(encrypted.blob.size, plaintext.length + 2 * 16);

  const attachment = {
    id: "attachment-id",
    encrypted: true,
    size: plaintext.length,
    mimeType: file.type,
    encryption: {
      key: encrypted.metadata.key,
      iv: encrypted.metadata.iv,
      version: encrypted.metadata.encryptionVersion,
      chunkSize: encrypted.metadata.chunkSize
    }
  };
  globalThis.fetch = async () => new Response(encrypted.blob.stream());
  const decrypted = await decryptAttachment(attachment, "account-slot");
  assert.deepEqual(new Uint8Array(await decrypted.arrayBuffer()), plaintext);

  const bytes = new Uint8Array(await encrypted.blob.arrayBuffer());
  const firstChunkLength = 1024 * 1024 + 16;
  const reordered = new Blob([
    bytes.subarray(firstChunkLength),
    bytes.subarray(0, firstChunkLength)
  ]);
  globalThis.fetch = async () => new Response(reordered.stream());
  await assert.rejects(decryptAttachment(attachment, "account-slot"), {
    message: "The encrypted attachment could not be verified or decrypted."
  });

  const legacyPlaintext = new Uint8Array([9, 8, 7, 6, 5]);
  const legacyKey = await globalThis.crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  const legacyIv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const legacyCiphertext = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: legacyIv },
    legacyKey,
    legacyPlaintext
  );
  const legacyKeyBytes = await globalThis.crypto.subtle.exportKey("raw", legacyKey);
  globalThis.fetch = async () => new Response(new Blob([legacyCiphertext]).stream());
  const legacyDecrypted = await decryptAttachment({
    ...attachment,
    size: legacyPlaintext.length,
    encryption: {
      key: Buffer.from(legacyKeyBytes).toString("base64"),
      iv: Buffer.from(legacyIv).toString("base64")
    }
  }, "account-slot");
  assert.deepEqual(new Uint8Array(await legacyDecrypted.arrayBuffer()), legacyPlaintext);
});

>>>>>>> Stashed changes
test("privacy page exposes bilingual policy sections and in-page navigation", async () => {
  const [page, script, styles] = await Promise.all([
    fs.readFile(require.resolve("../public/privacy.html"), "utf8"),
    fs.readFile(require.resolve("../public/privacy.js"), "utf8"),
    fs.readFile(require.resolve("../public/styles.css"), "utf8")
  ]);
  assert.match(page, /id="privacy-navigation"/);
  assert.match(page, /id="privacy-summary-copy"/);
  assert.match(script, /title: "Политика конфиденциальности"/);
  assert.match(script, /title: "Privacy policy"/);
  assert.equal((script.match(/title: "/g) || []).length, 14);
  assert.match(script, /IntersectionObserver/);
  assert.match(script, /aria-current", "location"/);
  assert.match(styles, /\.privacy-layout\s*\{[\s\S]*grid-template-columns: 220px/);
  assert.match(styles, /:root\[data-theme="dark"\] \.privacy-page/);
});

test("keeps account slots when a realtime stream disconnects", async () => {
  const [app, api] = await Promise.all([
    fs.readFile(require.resolve("../client/src/App.jsx"), "utf8"),
    fs.readFile(require.resolve("../client/src/apiClient.mjs"), "utf8")
  ]);
  assert.doesNotMatch(app, /EventSource\.CLOSED[\s\S]{0,300}polus:account-session-invalid/);
  assert.match(api, /response\.status === 401[\s\S]{0,220}polus:account-session-invalid/);
});

test("creates client IDs in browsers without crypto.randomUUID", async () => {
  const { createClientId } = await diagnosticsPromise;
  const fallbackId = createClientId({
    getRandomValues(bytes) {
      bytes.fill(0x10);
      return bytes;
    }
  });
  assert.match(fallbackId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.match(createClientId({}), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("pins recipient encryption keys and blocks changed keys until explicitly trusted", async () => {
  const { trustChangedEncryptionKey, verifyRecipientEncryptionKeys } = await encryptionPromise;
  const saved = new Map();
  globalThis.localStorage = {
    getItem(key) { return saved.get(key) || null; },
    setItem(key, value) { saved.set(key, value); }
  };
  const ownerId = "owner";
  const recipientId = "recipient";
  const originalKey = "AQID";
  const replacementKey = "BAUG";
  const originalSigningKey = "AgMEBQ==";
  const replacementSigningKey = "BwgJCg==";

  await verifyRecipientEncryptionKeys(ownerId, [{
    id: recipientId,
    publicKey: originalKey,
    signingPublicKey: originalSigningKey
  }]);
  const priorFingerprint = JSON.parse(saved.get("polus-trusted-encryption-keys:owner"))[recipientId];

  await verifyRecipientEncryptionKeys(ownerId, [{
    id: recipientId,
    publicKey: originalKey,
    signingPublicKey: originalSigningKey
  }]);
  await assert.rejects(
    verifyRecipientEncryptionKeys(ownerId, [{
      id: recipientId,
      publicKey: replacementKey,
      signingPublicKey: replacementSigningKey
    }]),
    (error) => {
      assert.equal(error.code, "ENCRYPTION_KEY_CHANGED");
      assert.equal(error.userId, ownerId);
      assert.equal(error.recipientId, recipientId);
      assert.equal(error.signingPublicKey, replacementSigningKey);
      assert.equal(error.previousFingerprint, priorFingerprint);
      assert.match(error.newFingerprint, /^[a-f0-9]{64}$/);
      return true;
    }
  );
  assert.equal(JSON.parse(saved.get("polus-trusted-encryption-keys:owner"))[recipientId], priorFingerprint);

  await trustChangedEncryptionKey(
    ownerId,
    recipientId,
    replacementKey,
    replacementSigningKey,
    priorFingerprint
  );
  await verifyRecipientEncryptionKeys(ownerId, [{
    id: recipientId,
    publicKey: replacementKey,
    signingPublicKey: replacementSigningKey
  }]);
});

test("detects repeated signed-message counters in the same chat", async () => {
  const { rememberMessageCounter } = await encryptionPromise;
  const saved = new Map();
  globalThis.localStorage = {
    getItem(key) { return saved.get(key) || null; },
    setItem(key, value) { saved.set(key, value); }
  };
  rememberMessageCounter("owner", "chat-1", "sender", 123, "message-1");
  rememberMessageCounter("owner", "chat-1", "sender", 123, "message-1");
  assert.throws(
    () => rememberMessageCounter("owner", "chat-1", "sender", 123, "replayed-message"),
    { message: "This signed message counter was already seen. The message may be a replay." }
  );
});

test("encrypts and verifies message signatures bound to chat and sender context", async () => {
  const {
    decryptMessagePayload,
    encryptMessagePayload,
    ensureEncryptionIdentity,
    hasReadyEncryptionIdentity
  } = await encryptionPromise;
  const storage = new Map();
  globalThis.localStorage = {
    getItem(key) { return storage.get(key) || null; },
    setItem(key, value) { storage.set(key, value); },
    removeItem(key) { storage.delete(key); }
  };
  const indexedStores = new Map();
  const database = {
    objectStoreNames: { contains(name) { return indexedStores.has(name); } },
    createObjectStore(name) { indexedStores.set(name, new Map()); },
    transaction() {
      const transaction = new EventTarget();
      transaction.objectStore = (name) => ({
        get(key) {
          const request = new EventTarget();
          queueMicrotask(() => {
            request.result = indexedStores.get(name).get(key);
            request.dispatchEvent(new Event("success"));
          });
          return request;
        },
        put(value, key) {
          indexedStores.get(name).set(key, value);
          queueMicrotask(() => transaction.dispatchEvent(new Event("complete")));
        }
      });
      return transaction;
    },
    close() {}
  };
  globalThis.indexedDB = {
    open() {
      const request = new EventTarget();
      request.result = database;
      queueMicrotask(() => {
        request.dispatchEvent(new Event("upgradeneeded"));
        request.dispatchEvent(new Event("success"));
      });
      return request;
    }
  };
  let identity = null;
  globalThis.fetch = async (url, options) => {
    if (url === "/api/account/encryption-config") {
      return new Response(JSON.stringify({ wrappingKey: "shared-encryption-key-for-tests-0123456789" }), { status: 200 });
    }
    if (url !== "/api/account/encryption-key") throw new Error(`Unexpected request: ${url}`);
    if (options.method === "PUT") {
      identity = JSON.parse(options.body);
      return new Response(JSON.stringify({ ok: true }), { status: 201 });
    }
    return new Response(JSON.stringify({
      userId: "alice",
      publicKey: identity?.publicKey || null,
      sealedPrivateKey: identity?.sealedPrivateKey || null,
      signingPublicKey: identity?.signingPublicKey || null,
      sealedSigningPrivateKey: identity?.sealedSigningPrivateKey || null
    }), { status: 200 });
  };

  await ensureEncryptionIdentity(
    "alice",
    "account-password",
    "a separate encryption phrase",
    "account-slot"
  );
  assert.equal(identity.sealedPrivateKey.keyVersion, 3);
  assert.equal(identity.sealedPrivateKey.iterations, 600000);
  assert.equal(identity.sealedSigningPrivateKey.keyVersion, 3);
  assert.equal(identity.sealedSigningPrivateKey.iterations, 600000);
  indexedStores.get("signing-identities").delete("alice");
  await ensureEncryptionIdentity(
    "alice",
    "account-password",
    "a different encryption phrase",
    "account-slot"
  );
  await ensureEncryptionIdentity(
    "alice",
    "account-password",
    "a separate encryption phrase",
    "account-slot"
  );
  const downgradeForMigrationTest = async (sealed, passphrase) => {
    const sharedMaterial = await globalThis.crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode("shared-encryption-key-for-tests-0123456789"),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    const oldSalt = Buffer.from(sealed.salt, "base64");
    const oldWrappingKey = await globalThis.crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt: oldSalt, iterations: 600000 },
      sharedMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
    const plaintext = await globalThis.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: Buffer.from(sealed.iv, "base64") },
      oldWrappingKey,
      Buffer.from(sealed.ciphertext, "base64")
    );
    const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const legacyMaterial = await globalThis.crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(passphrase),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    const wrappingKey = await globalThis.crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations: 310000 },
      legacyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt"]
    );
    const ciphertext = await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv }, wrappingKey, plaintext);
    return {
      keyVersion: 2,
      salt: Buffer.from(salt).toString("base64"),
      iv: Buffer.from(iv).toString("base64"),
      ciphertext: Buffer.from(ciphertext).toString("base64"),
      iterations: 310000
    };
  };
  identity.sealedPrivateKey = await downgradeForMigrationTest(identity.sealedPrivateKey, "old legacy phrase");
  identity.sealedSigningPrivateKey = await downgradeForMigrationTest(identity.sealedSigningPrivateKey, "old legacy phrase");
  assert.equal(await hasReadyEncryptionIdentity("alice", "account-slot"), false);
  await assert.rejects(ensureEncryptionIdentity(
    "alice",
    "account-password",
    "",
    "account-slot"
  ), { message: "This key uses an older encryption phrase. Enter that phrase once to migrate it." });
  await ensureEncryptionIdentity(
    "alice",
    "account-password",
    "old legacy phrase",
    "account-slot"
  );
  assert.equal(identity.sealedPrivateKey.keyVersion, 3);
  assert.equal(identity.sealedSigningPrivateKey.keyVersion, 3);
  assert.equal(await hasReadyEncryptionIdentity("alice", "account-slot"), true);
  const conversationId = "direct-chat";
  const attachmentKey = Buffer.alloc(32, 7).toString("base64");
  const attachmentIv = Buffer.alloc(12, 8).toString("base64");
  const text = await encryptMessagePayload("alice", [{
    id: "alice",
    publicKey: identity.publicKey,
    signingPublicKey: identity.signingPublicKey
  }], conversationId, {
    text: "authenticated",
    attachments: [{
      id: "spoofed-id",
      url: "/api/attachments/spoofed-id",
      name: "shared.txt",
      mimeType: "text/plain",
      size: 12,
      encrypted: true,
      key: attachmentKey,
      iv: attachmentIv,
      encryptionVersion: 1,
      chunkSize: 1024 * 1024
    }]
  });
  const message = {
    id: 1,
    encrypted: true,
    text,
    authorId: "alice",
    conversationId,
    attachments: [{
      id: "server-attachment-id",
      url: "/api/attachments/server-attachment-id",
      name: "server-name.bin",
      mimeType: "application/octet-stream",
      size: 28
    }]
  };
  const decrypted = await decryptMessagePayload("alice", message);
  assert.equal(decrypted.text, "authenticated");
  assert.equal(decrypted.signatureVerified, true);
  assert.equal(decrypted.attachments[0].id, "server-attachment-id");
  assert.equal(decrypted.attachments[0].url, "/api/attachments/server-attachment-id");
  assert.equal(decrypted.attachments[0].name, "shared.txt");
  assert.equal(decrypted.attachments[0].mimeType, "text/plain");
  assert.deepEqual(decrypted.attachments[0].encryption, {
    key: attachmentKey,
    iv: attachmentIv,
    version: 1,
    chunkSize: 1024 * 1024
  });

  const packet = JSON.parse(text.slice("polus-e2ee:v2:".length));
  const tamperedPacket = { ...packet, ciphertext: "AA==" };
  await assert.rejects(decryptMessagePayload("alice", {
    ...message,
    text: `polus-e2ee:v2:${JSON.stringify(tamperedPacket)}`
  }), { message: "The encrypted message signature is invalid." });
  packet.context.conversationId = "other-chat";
  await assert.rejects(decryptMessagePayload("alice", {
    ...message,
    text: `polus-e2ee:v2:${JSON.stringify(packet)}`
  }), { message: "The encrypted message context is invalid." });
  await assert.rejects(decryptMessagePayload("alice", { ...message, id: 2 }), {
    message: "This signed message counter was already seen. The message may be a replay."
  });
});

test("uses the shared server key and migrates legacy private-key phrases", async () => {
  const { prepareEncryptionKeyPasswordChange } = await encryptionPromise;
  const password = "old-account-password";
  const encryptionPair = await globalThis.crypto.subtle.generateKey(
    { name: "RSA-OAEP", modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["encrypt", "decrypt"]
  );
  const privateKeyBytes = await globalThis.crypto.subtle.exportKey("pkcs8", encryptionPair.privateKey);
  const signingPair = await globalThis.crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const signingPrivateKeyBytes = await globalThis.crypto.subtle.exportKey("pkcs8", signingPair.privateKey);
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const material = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  const wrappingKey = await globalThis.crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 310000 },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    wrappingKey,
    privateKeyBytes
  );
  const legacySeal = {
    salt: Buffer.from(salt).toString("base64"),
    iv: Buffer.from(iv).toString("base64"),
    ciphertext: Buffer.from(ciphertext).toString("base64"),
    iterations: 310000
  };
  const signingSalt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const signingIv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const signingWrappingKey = await globalThis.crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: signingSalt, iterations: 310000 },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
  const signingCiphertext = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: signingIv },
    signingWrappingKey,
    signingPrivateKeyBytes
  );
  const serverKey = {
    publicKey: Buffer.from(await globalThis.crypto.subtle.exportKey("spki", encryptionPair.publicKey)).toString("base64"),
    sealedPrivateKey: legacySeal,
    signingPublicKey: Buffer.from(await globalThis.crypto.subtle.exportKey("spki", signingPair.publicKey)).toString("base64"),
    sealedSigningPrivateKey: {
      salt: Buffer.from(signingSalt).toString("base64"),
      iv: Buffer.from(signingIv).toString("base64"),
      ciphertext: Buffer.from(signingCiphertext).toString("base64"),
      iterations: 310000
    }
  };
  const sharedWrappingKey = "shared-encryption-key-for-tests-0123456789";
  globalThis.fetch = async (url) => {
    if (url === "/api/account/encryption-config") {
      return new Response(JSON.stringify({ wrappingKey: sharedWrappingKey }), { status: 200 });
    }
    assert.equal(url, "/api/account/encryption-key");
    return new Response(JSON.stringify(serverKey), { status: 200 });
  };

  const rewrapped = await prepareEncryptionKeyPasswordChange(
    password,
    "new-account-password",
    "account-slot"
  );
  assert.equal(rewrapped.sealedPrivateKey.keyVersion, 3);
  assert.equal(rewrapped.sealedPrivateKey.iterations, 600000);
  assert.notEqual(rewrapped.sealedPrivateKey.ciphertext, legacySeal.ciphertext);
  assert.equal(rewrapped.sealedSigningPrivateKey.keyVersion, 3);
  assert.equal(rewrapped.sealedSigningPrivateKey.iterations, 600000);
  await assert.rejects(prepareEncryptionKeyPasswordChange(
    "wrong-account-password",
    "another-new-password",
    "account-slot"
  ), { message: "Unable to unlock the legacy encryption key. Check the password that sealed it." });
});

test("opens joined channel headers in chat info and keeps discover channels on the join page", async () => {
  const appSource = await fs.readFile(require.resolve("../client/src/App.jsx"), "utf8");
  const controllerSource = await fs.readFile(require.resolve("../client/src/messengerController.js"), "utf8");
  const headerHandler = appSource.match(/const openHeaderDetails = \(\) => \{([\s\S]*?)\n  \};/)?.[1];
  assert.ok(headerHandler);
  assert.match(headerHandler, /conversation\.type === "channel"[\s\S]*conversation\.joined !== false[\s\S]*polus:chat-info/);
  assert.match(headerHandler, /else \{[\s\S]*polus:open-channel-profile/);
  assert.doesNotMatch(headerHandler.match(/if \(conversation\.joined !== false\) \{([\s\S]*?)\n      \} else/)?.[1] || "", /polus:open-channel-profile/);

  const profilePage = appSource.slice(
    appSource.indexOf("function ChannelProfilePage"),
    appSource.indexOf("function ChannelSettingsPage")
  );
  assert.match(profilePage, /if \(response\.chat\.joined\)[\s\S]*replaceHistory: true/);
  assert.match(profilePage, /Вступить в канал/);
  assert.match(profilePage, /Join channel/);
  assert.doesNotMatch(profilePage, /Открыть чат|Open chat/);

  assert.match(appSource, /snapshot\?\.canManageChannel/);
  assert.match(appSource, /\{snapshot\.memberCount\} \{snapshot\.labels\.memberCountUnit\}/);
  assert.match(appSource, /polus:open-channel-settings/);
  assert.match(controllerSource, /canManageChannel: conversation\.type === "channel"\s*&& \(\["owner", "admin"\]\.includes\(conversation\.role\)\s*\|\| conversation\.ownerId === currentUser\?\.id\s*\|\| conversation\.createdBy === currentUser\?\.id\s*\|\| conversation\.adminIds\?\.includes\(currentUser\?\.id\)\)/);
  assert.match(appSource, /className="primary-button channel-settings-link"/);
  assert.match(appSource, /channelSettings: "Настройки канала"/);
  assert.match(controllerSource, /channelSettings: "Channel settings"/);
  assert.match(controllerSource, /conversation\.joined !== false \? \["files"\]/);
  assert.match(appSource, /polus:channel-settings-profile/);
  assert.match(appSource, /const handleChannelSettingsProfile = \(event\) => \{\s*const channelId = event\.detail\?\.channelId \|\| activeChannelSettingsId;\s*if \(channelId\) void openChannelChat\(channelId, true\);/);
  assert.match(appSource, /if \(settingsChannelId && currentConversation\?\.id !== settingsChannelId\) \{\s*void openChannelChat\(settingsChannelId\);/);
  assert.match(appSource, /if \(event\.detail\.replaceHistory\) \{\s*window\.history\.replaceState\(\{\}, "", "\/"\);/);
});

test("exposes group settings backed by existing group-management APIs", async () => {
  const [app, controller, server] = await Promise.all([
    fs.readFile(require.resolve("../client/src/App.jsx"), "utf8"),
    fs.readFile(require.resolve("../client/src/messengerController.js"), "utf8"),
    fs.readFile(require.resolve("../server.js"), "utf8")
  ]);
  assert.match(app, /snapshot\?\.chatType === "group"[\s\S]*snapshot\.labels\.groupSettings/);
  assert.match(app, /function GroupSettingsPage\(\{ groupId, onBack \}\)[\s\S]*useState\("info"\)[\s\S]*polus:request-chat-management[\s\S]*Group settings sections[\s\S]*<ChatManagementContent \/>/);
  assert.match(app, /className="community-page channel-settings-page group-settings-page"/);
  assert.match(app, /function ChannelSettingsPage\([\s\S]*?<main className="community-page channel-settings-page">/);
  assert.match(app, /function ChatManagementContent\(\)[\s\S]*activeSection === "info"[\s\S]*save-group-details[\s\S]*activeSection === "members"[\s\S]*polus:open-user-picker[\s\S]*activeSection === "administrators"[\s\S]*toggle-admin[\s\S]*activeSection === "invites"[\s\S]*activeSection === "additional"[\s\S]*transfer-ownership[\s\S]*delete-chat/);
  assert.match(app, /\/groups\/\$\{encodeURIComponent\(groupId\)\}\/settings/);
  assert.match(app, /polus:open-group-settings/);
  assert.match(controller, /polus:request-chat-management/);
  assert.match(controller, /action === "save-group-details"[\s\S]*\/settings[\s\S]*groupSettingsSaved/);
  assert.match(server, /if \(chatType === "group"\) \{[\s\S]*requireChatRole\(chat, user\.id, \["owner"\]\)[\s\S]*Invalid group settings\./);
  const styles = await fs.readFile(require.resolve("../public/styles.css"), "utf8");
  assert.match(styles, /\.group-settings-page \.channel-settings-layout\s*\{\s*grid-template-columns: 220px minmax\(0, 1fr\);/);
  assert.match(styles, /\.channel-settings-layout\s*\{\s*display: grid;\s*grid-template-columns: 220px minmax\(0, 1fr\);/);
});

test("integrates contacts navigation, profiles, and reusable group/channel member selection", async () => {
  const [app, server, styles] = await Promise.all([
    fs.readFile(require.resolve("../client/src/App.jsx"), "utf8"),
    fs.readFile(require.resolve("../server.js"), "utf8"),
    fs.readFile(require.resolve("../public/styles.css"), "utf8")
  ]);
  assert.match(app, /function ContactsPage\(/);
  assert.match(app, /onOpenContacts=\{\(\) => document\.dispatchEvent\(new CustomEvent\("polus:open-contacts"\)\)\}/);
  assert.match(app, /setContactsPage\(pathname === "\/contacts"\)/);
  assert.match(app, /requestJson\("\/api\/contacts"\)/);
  assert.match(app, /polus:request-direct-message/);
  assert.match(app, /function UserPicker\(\)/);
  assert.match(app, /polus:open-user-picker/);
  assert.match(app, /<\/main>\s*<ReactDialogs user=\{user\} \/>/);
  assert.match(app, /close\(\);\s*window\.setTimeout\(\(\) => document\.dispatchEvent\(new CustomEvent\("polus:open-profile"/);
  assert.match(app, /excludeUserIds: members\.map\(\(member\) => member\.id\)/);
  assert.match(app, /body: JSON\.stringify\(\{ usernames: selectedContacts\.map\(\(contact\) => contact\.username\) \}\)/);
  assert.match(app, /function ContactShareDialog\(\)/);
  assert.match(server, /request\.method === "GET" && url\.pathname === "\/api\/contacts"/);
  assert.match(server, /isContact: \(user\.contactIds \|\| \[\]\)\.includes\(candidate\.id\)/);
  assert.match(styles, /\.contacts-page/);
  assert.match(styles, /:root\[data-theme="dark"\] \.contacts-page/);
  assert.match(styles, /@media \(max-width: 760px\) \{\s*\.contacts-page-header/);
});

<<<<<<< Updated upstream
test("presents other-user profiles with accessible actions and openable shared communities", async () => {
=======
test("presents public user profiles as themed pages with accessible actions and shared communities", async () => {
>>>>>>> Stashed changes
  const [app, controller, styles] = await Promise.all([
    fs.readFile(require.resolve("../client/src/App.jsx"), "utf8"),
    fs.readFile(require.resolve("../client/src/messengerController.js"), "utf8"),
    fs.readFile(require.resolve("../public/styles.css"), "utf8")
  ]);
<<<<<<< Updated upstream
  assert.match(app, /function UserProfileContent\(\)[\s\S]*user-profile-dialog-header[\s\S]*profile-message-button/);
  assert.match(app, /profile-secondary-actions[\s\S]*user\.isContact \? labels\.removeContact : labels\.addContact/);
  assert.match(app, /<details className="profile-more-actions">[\s\S]*confirmBlock/);
  assert.match(app, /user\.blocked && \([\s\S]*labels\.unblockUser/);
  assert.match(app, /user\.about \? \([\s\S]*labels\.noAbout/);
  assert.match(app, /sharedChats\.length > 0 && \([\s\S]*showAllSharedChats/);
  assert.match(app, /polus:open-profile-community/);
  assert.match(app, /handleOpenProfileCommunity[\s\S]*bootstrap\.channels : bootstrap\.directs/);
  assert.match(controller, /sharedGroup: t\("sharedGroup"\)[\s\S]*showAll: t\("showAll"\)/);
  assert.match(styles, /\.profile-view-dialog \{[^}]*overflow-x: hidden;/);
  assert.match(styles, /:root\[data-theme="dark"\] \.profile-secondary-actions/);
  assert.match(styles, /@media \(max-width: 520px\) \{\s*\.profile-view-dialog/);
=======
  assert.match(app, /function UserProfileContent\(\{ username, currentUserId, currentUsername, onBack \}\)/);
  assert.match(app, /user\.id === currentUserId[\s\S]*user\.username\?\.toLocaleLowerCase\(\) === currentUsername\?\.toLocaleLowerCase\(\)/);
  assert.match(app, /className=\{`public-profile-page profile-theme-\$\{design\.theme\} profile-font-\$\{design\.font\}/);
  assert.match(app, /user\.isContact \? labels\.removeContact : labels\.addContact/);
  assert.match(app, /<details className="profile-more-actions">[\s\S]*confirmBlock/);
  assert.match(app, /user\.blocked && \([\s\S]*labels\.unblockUser/);
  assert.match(app, /user\.about && \([\s\S]*labels\.about/);
  assert.match(app, /sharedChats\.length > 0 && \([\s\S]*showAllSharedChats/);
  assert.match(app, /polus:open-profile-community/);
  assert.match(app, /polus:load-user-profile/);
  assert.match(app, /const timer = window\.setTimeout\(\(\) => \{\s*document\.dispatchEvent\(new CustomEvent\("polus:load-user-profile"/);
  assert.match(controller, /\/users\/\$\{encodeURIComponent\(username\)\}/);
  assert.match(controller, /window\.history\.pushState\(\{ polusPage: true, polusUserProfile: true \}, "", path\)/);
  assert.match(app, /function ProfileDesignEditor\(\{ user \}\)/);
  assert.match(app, /Настроить профиль/);
  assert.match(app, /section: "appearance"/);
  assert.match(app, /\/api\/account\/profile-design/);
  assert.match(app, /\/api\/account\/profile-cover/);
  assert.match(app, /gradientStart: event\.target\.value/);
  assert.match(app, /video\/mp4,video\/webm/);
  assert.match(app, /AuthenticatedVideo src=\{user\.profileCoverUrl\}/);
  assert.match(app, /backgroundImageEnabled/);
  assert.match(app, /profile-avatar-frame-\$\{design\.avatarFrame\}/);
  assert.match(app, /This server does not support profile design settings yet/);
  assert.doesNotMatch(app, /id="profile-view-dialog"|profile-view-dialog/);
  assert.match(app, /handleOpenProfileCommunity[\s\S]*bootstrap\.channels : bootstrap\.directs/);
  assert.match(controller, /sharedGroup: t\("sharedGroup"\)[\s\S]*showAll: t\("showAll"\)/);
  assert.match(styles, /\.public-profile-page \{/);
  assert.match(styles, /\.public-profile-actions > \.secondary-button \{ color: #edf5ff; background: #263a52;/);
  assert.match(styles, /\.profile-theme-ocean \.public-profile-actions > \.secondary-button/);
  assert.match(styles, /\.public-profile-cover/);
  assert.match(styles, /\.profile-effects-glow/);
  assert.match(styles, /@keyframes profile-particles-drift/);
  assert.match(styles, /@media \(max-width: 680px\) \{\s*\.public-profile-content/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\) \{\s*\.public-profile-page/);
>>>>>>> Stashed changes
});

test("closes every native modal when the user clicks outside its dialog bounds", async () => {
  const app = await fs.readFile(require.resolve("../client/src/App.jsx"), "utf8");
  assert.match(app, /const closeOnBackdropClick = \(event\) => \{\s*const dialog = event\.target;\s*if \(dialog\?\.tagName !== "DIALOG" \|\| !dialog\.open \|\| event\.detail === 0\) return;/);
  assert.match(app, /event\.clientX < bounds\.left \|\| event\.clientX > bounds\.right[\s\S]*event\.clientY < bounds\.top \|\| event\.clientY > bounds\.bottom[\s\S]*dialog\.close\(\)/);
  assert.match(app, /document\.addEventListener\("click", closeOnBackdropClick, true\)/);
  assert.match(app, /document\.removeEventListener\("click", closeOnBackdropClick, true\)/);
});

test("pins Saved Messages above chats and hides unavailable controls in previews", async () => {
  const { getConversationHeaderControls, orderConversations } = await conversationListPromise;
  const chats = [
    { id: "quiet", type: "direct", lastActivity: 1 },
    { id: "saved_user", type: "saved", lastActivity: 0 },
    { id: "active", type: "group", lastActivity: 5 }
  ];
  const ordered = orderConversations(chats, (chat) => chat.lastActivity);
  assert.deepEqual(ordered.map((chat) => chat.id), ["saved_user", "active", "quiet"]);
  assert.deepEqual(getConversationHeaderControls(ordered[0]), {
    search: true,
    push: false
  });
  assert.deepEqual(getConversationHeaderControls({
    id: "public-preview",
    type: "channel",
    joined: false
  }), {
    search: false,
    push: false
  });
  const appSource = await fs.readFile(require.resolve("../client/src/App.jsx"), "utf8");
  const messageContentSource = await fs.readFile(require.resolve("../client/src/components/MessageContent.jsx"), "utf8");
  const controllerSource = await fs.readFile(require.resolve("../client/src/messengerController.js"), "utf8");
  const stylesSource = await fs.readFile(require.resolve("../public/styles.css"), "utf8");
  assert.doesNotMatch(appSource, /id="manage-chat"|id="chat-info"/);
  assert.match(messageContentSource, /className="message-attachment-image"[\s\S]*?src=\{url\}/);
  assert.match(appSource, /<AuthenticatedImage\s+key=\{attachment\.id\}\s+src=\{attachment\.thumbnailUrl/);
  assert.doesNotMatch(appSource, /id="chat-management-dialog"/);
  assert.match(appSource, /<ChatInfoDialogContent \/>\s*<\/dialog>/);
  assert.match(appSource, /<GroupSettingsPage[\s\S]*groupId=\{groupSettingsId\}/);
  assert.match(appSource, /id="chat-management-content" className="chat-profile-management"/);
  assert.match(appSource, /saved-bookmark-icon/);
  assert.match(appSource, /className="channel-preview-join"/);
  assert.match(appSource, /polus:join-channel/);
  assert.match(appSource, /conversation\.pinned && !saved && !discover/);
  assert.match(appSource, /className="chat-row-pinned"/);
  assert.match(stylesSource, /\.chat-row-pinned svg/);
  assert.match(appSource, /function ConversationList\(\{ userId \}\)/);
  assert.match(appSource, /people-search-section/);
  assert.match(appSource, /<DiscoverySearchResults/);
  assert.match(appSource, /\/api\/discover\?q=\$\{encodeURIComponent\(query\)\}/);
  assert.match(appSource, /Public channels|Публичные каналы/);
  assert.match(appSource, /Public groups|Публичные группы/);
  assert.match(appSource, /polus:open-people-search/);
  assert.match(appSource, /searchRef\.current\?\.focus\(\)/);
  assert.doesNotMatch(appSource, /function PeopleDirectoryDialog|id="directory-dialog"/);
  assert.match(appSource, /name="isPublic"[\s\S]*public.*invite only|name="isPublic"[\s\S]*Публичная/);
  assert.match(appSource, /polus:set-group-privacy|set-group-privacy/);
  assert.match(controllerSource, /listen\(document, "polus:join-channel"/);
  assert.doesNotMatch(controllerSource, /if \(!conversation\.joined && conversation\.type === "channel"\)/);
  assert.match(appSource, /LanguageContext\.Provider value=\{\{ language, setLanguage, theme, setTheme, messageSound, setMessageSound \}\}/);
  assert.match(appSource, /createClientId\(\)/);
  assert.match(appSource, /composer\.submit\.started/);
  assert.match(appSource, /app\.unhandled-rejection/);
  assert.match(appSource, /useLayoutEffect\(\(\) => \{\s*if \(!visible \|\| !enabled \|\| submitting \|\| !conversation\) return;\s*if \(window\.matchMedia\("\(max-width: 760px\)"\)\.matches\) return;\s*textAreaRef\.current\?\.focus\(\);/);
  assert.doesNotMatch(appSource, /requestAnimationFrame\(\(\) => \{\s*textAreaRef\.current/);
  assert.match(appSource, /id="settings-language"/);
  assert.match(appSource, /id="profile-settings-language"/);
  assert.match(appSource, /id="settings-message-sound"/);
  for (const theme of ["light", "dark", "arctic", "lavender", "warm"]) {
    assert.match(appSource, new RegExp(`id: "${theme}"`));
  }
  assert.doesNotMatch(appSource, /id: "black"|Black AMOLED|Чёрная/);
  assert.match(appSource, /function ProfileSettingsPage\(\{ user, onBack, onUserUpdate \}\)/);
  assert.match(appSource, /className="profile-page"/);
  assert.match(appSource, /className="profile-page-layout"/);
  assert.match(appSource, /className="profile-page-sidebar"/);
  assert.match(appSource, /href="#profile-account"/);
  assert.match(appSource, /href="#profile-privacy"/);
  assert.match(appSource, /href="#profile-security"/);
  assert.match(appSource, /href="#profile-appearance"/);
  assert.doesNotMatch(appSource, /profile-page-card/);
  assert.match(appSource, /window\.location\.pathname === "\/profile"/);
  assert.match(appSource, /polusProfilePage/);
  assert.match(appSource, /className="settings-gear-icon" aria-hidden="true">⚙<\/span>/);
  assert.match(appSource, /dataset\.theme = theme/);
  assert.match(appSource, /dataset\.colorTheme = theme/);
  assert.match(stylesSource, /:root\[data-theme="dark"\]/);
  assert.match(stylesSource, /:root\[data-theme="dark"\] \.profile-page \{[^}]*background: #0c121c;/);
  assert.match(stylesSource, /:root\[data-theme="dark"\] \.profile-page \.text-field \{[^}]*background: #202d40;/);
  assert.match(stylesSource, /:root\[data-theme="dark"\] \.profile-page-title h1,[\s\S]*?:root\[data-theme="dark"\] \.profile-page-section-title h2,[\s\S]*?color: #e4eaf3;/);
  assert.doesNotMatch(stylesSource, /data-color-theme="black"/);
  assert.match(stylesSource, /:root\[data-color-theme="arctic"\]/);
  assert.match(stylesSource, /:root\[data-color-theme="lavender"\]/);
  assert.match(stylesSource, /:root\[data-color-theme="warm"\]/);
  assert.match(appSource, /function ChannelProfilePage\(\{ channelId, onBack, onOpenChat \}\)/);
  assert.match(appSource, /function ChannelSettingsPage\(\{ channelId, onBack, onProfile \}\)/);
  assert.match(appSource, /onProfile=\{\(\) => document\.dispatchEvent\(new CustomEvent\("polus:channel-settings-profile"/);
  assert.match(appSource, /onBack=\{\(\) => document\.dispatchEvent\(new CustomEvent\("polus:profile-page-back", \{\s*detail: \{ channelId: channelSettingsId \}/);
  assert.match(appSource, /function InviteLandingPage\(\{ token, onBack, onOpenChat \}\)/);
  assert.match(appSource, /polus:open-channel-profile/);
  assert.match(appSource, /polus:open-channel-settings/);
  assert.match(appSource, /\/settings`/);
  assert.match(appSource, /polus:chat-delete-request/);
  assert.match(appSource, /deleteForEveryone/);
  assert.match(appSource, /channel-privacy-choice/);
  assert.match(appSource, /invite-link-management/);
  assert.match(appSource, /members\.find\(\(member\) => member\.id === snapshot\.currentUserId\)\?\.role/);
  assert.match(appSource, /id="channel-settings-name"/);
  assert.match(appSource, /id="channel-settings-description"/);
  assert.match(appSource, /labels\.invitationSettings/);
  assert.match(appSource, /labels\.administration/);
  assert.match(appSource, /save-channel-details/);
  assert.match(appSource, /className="chat-row-menu"/);
  assert.match(appSource, /target\.closest\("\.chat-row-menu"\) \|\| target\.closest\("\.chat-row-menu-trigger"\)/);
  assert.match(appSource, /title=\{language === "ru" \? "Действия с чатом" : "Chat actions"\}/);
  assert.match(stylesSource, /\.community-page/);
  assert.match(stylesSource, /\.chat-row-menu/);
  assert.match(stylesSource, /\.chat-row\[aria-current="page"\] \+ \.chat-row-menu-trigger\s*\{\s*color: #426b91;/);
  assert.match(appSource, /className="chat-row-meta"/);
  assert.match(appSource, /<time className="chat-row-time" dateTime=\{lastTime\}>/);
  assert.match(stylesSource, /\.chat-row-meta\s*\{[^}]*display: grid;[^}]*justify-items: end;/);
  assert.match(stylesSource, /\.conversation-row-wrapper:hover \.chat-row-menu-trigger/);
  assert.match(stylesSource, /\.chat-row\[aria-current="page"\] \{[^}]*background: #eaf2fa;/);
  assert.match(stylesSource, /\.profile-page-layout/);
  assert.match(stylesSource, /\.profile-page-sidebar/);
  assert.match(stylesSource, /\.profile-page-sidebar \{[^}]*position: sticky;[^}]*top: 68px;/s);
  assert.match(stylesSource, /\.profile-page-sidebar \{[^}]*height: calc\(100vh - 68px\);/s);
  assert.match(stylesSource, /\.profile-page-section \+ \.profile-page-section/);
  assert.match(stylesSource, /\.sidebar-search \{[^}]*height: 40px;[^}]*align-self: center;/);
  assert.match(stylesSource, /\.sidebar-search input \{[^}]*display: block;/);
  assert.match(stylesSource, /\.message-list \{[^}]*background-color: #f2f4f7;/s);
  assert.doesNotMatch(stylesSource, /\.message-list \{[^}]*background-image: radial-gradient/s);
  assert.match(appSource, /message-bubble-footer/);
  assert.match(appSource, /message-read-status/);
  assert.match(appSource, /message\.seenByRecipient \? " is-read" : ""/);
  assert.match(appSource, /messages-read/);
  assert.match(appSource, /messageTimeGap <= 5 \* 60 \* 1000/);
  assert.match(stylesSource, /\.message-row\.is-own \.message-avatar \{ display: none; \}/);
  assert.match(stylesSource, /\.message-row\.is-own \.message-content \{ max-width: min\(680px, 78%\); \}/);
  assert.match(appSource, /className="[^"]*record-message-button"/);
  assert.match(appSource, /onClick=\{\(\) => void startRecording\(\)\}/);
  assert.doesNotMatch(appSource, /startRecording\("video_note"\)/);
  assert.doesNotMatch(appSource, /video_note|VideoNotePlayer|recordVideo|recordingVideoLimit/);
  assert.match(messageContentSource, /<video controls preload="metadata" src=\{url\} \/>/);
  assert.match(appSource, /new MediaRecorder\(stream/);
  assert.match(messageContentSource, /function VoiceMessagePlayer\(/);
  assert.match(messageContentSource, /preload="auto"/);
  assert.match(messageContentSource, /onPlaying=\{\(event\)/);
  assert.match(messageContentSource, /audio\.canPlayType\(attachment\.mimeType\) === ""/);
  assert.match(appSource, /if \(!navigator\.mediaDevices\?\.getUserMedia \|\| typeof MediaRecorder === "undefined"\) \{\s*voiceFileInput\.current\?\.click\(\)/);
  assert.match(appSource, /await navigator\.mediaDevices\.getUserMedia\(\{ audio: true \}\)/);
  assert.match(appSource, /if \(!window\.isSecureContext\) voiceFileInput\.current\?\.click\(\)/);
  assert.match(appSource, /recordVoiceHttp: "Записать голосовое сообщение/);
  assert.match(appSource, /recordVoiceHttp: "Record voice message/);
  assert.match(messageContentSource, /let activeVoiceMessageAudio = null/);
  assert.match(messageContentSource, /if \(activeVoiceMessageAudio && activeVoiceMessageAudio !== audio\)\s*\{\s*activeVoiceMessageAudio\.pause\(\)/);
  assert.match(messageContentSource, /if \(activeVoiceMessageAudio === audio\) activeVoiceMessageAudio = null/);
  assert.match(messageContentSource, /if \(activeVoiceMessageAudio === event\.currentTarget\) activeVoiceMessageAudio = null/);
  assert.match(messageContentSource, /const current = event\.currentTarget\.currentTime;\s*setPlayback\(\(playback\) => \(\{ \.\.\.playback, current \}\)\)/);
  assert.match(messageContentSource, /const duration = event\.currentTarget\.duration;\s*setPlayback\(\(current\) => \(\{ \.\.\.current, duration \}\)\)/);
  assert.match(appSource, /setPendingRecording\(\{ file, duration \}\)/);
  assert.match(appSource, /recordingCancelledRef\.current = true;\s*setPendingRecording\(null\)/);
  assert.match(appSource, /function sendPendingRecording\(/);
  assert.match(appSource, /className="recording-send"/);
  assert.match(appSource, /labels\.sendRecording/);
  assert.match(stylesSource, /\.recording-send \{/);
  assert.match(stylesSource, /\.voice-message-wave\.is-playing span/);
  assert.doesNotMatch(stylesSource, /video-note-player|recording-video-preview/);
  assert.match(stylesSource, /@keyframes recording-wave/);
  assert.match(appSource, /className="send-icon" viewBox="0 0 24 24"/);
  assert.match(appSource, /className="composer-upload-status"/);
  assert.match(appSource, /className="chat-header-identity"/);
  assert.match(appSource, /polus:open-profile/);
  assert.match(appSource, /polus:chat-info/);
  assert.match(appSource, /className="chat-info-identity"/);
  assert.match(appSource, /snapshot\?\.avatarUrl/);
  assert.match(stylesSource, /\.chat-header-identity/);
  assert.match(stylesSource, /\.chat-info-avatar img/);
  assert.match(stylesSource, /\.composer \{[^}]*max-width: 100%;/s);
  assert.match(stylesSource, /\.composer textarea \{[^}]*width: 0;[^}]*min-width: 0;/s);
  assert.match(stylesSource, /\.composer-entry \{ display: flex; width: 100%; min-width: 0;/);
  assert.match(stylesSource, /\.composer \{[^}]*margin: 0 25px 10px;/s);
  assert.match(stylesSource, /@media \(max-width: 760px\) \{\s*\.messenger-shell \{[^}]*position: fixed;[^}]*inset: 0;[^}]*height: 100vh;[^}]*height: 100dvh;/s);
  assert.match(stylesSource, /\.chat-panel \{ touch-action: pan-y; \}/);
  assert.match(appSource, /touch\.clientX <= 32/);
  assert.match(appSource, /deltaX >= 85 && deltaX > deltaY \* 1\.4/);
  assert.match(appSource, /onTouchEnd=\{handleMobileTouchEnd\}/);
  assert.match(appSource, /onClick=\{closeMobileChat\}/);
  assert.match(stylesSource, /\.message-list \{ min-height: 0; gap: 7px; padding: 16px 12px; -webkit-overflow-scrolling: touch; \}/);
  assert.match(appSource, /if \(window\.matchMedia\("\(max-width: 760px\)"\)\.matches\) return;\s*textAreaRef\.current\?\.focus\(\)/);
  assert.doesNotMatch(appSource, /id="app-language"/);
});

test("keeps pinned chats above recent chats without displacing Saved Messages", async () => {
  const { orderConversations } = await conversationListPromise;
  const chats = [
    { id: "quiet", type: "direct", pinned: false, lastActivity: 1 },
    { id: "saved", type: "saved", pinned: false, lastActivity: 0 },
    { id: "active", type: "group", pinned: false, lastActivity: 8 },
    { id: "pinned", type: "channel", pinned: true, lastActivity: 2 }
  ];
  assert.deepEqual(orderConversations(chats, (chat) => chat.lastActivity).map((chat) => chat.id),
    ["saved", "pinned", "active", "quiet"]);
});

test("loads the messenger controller with the app entry instead of a stale-prone dynamic chunk", async () => {
  const appSource = await fs.readFile(require.resolve("../client/src/App.jsx"), "utf8");
  const controllerSource = await fs.readFile(require.resolve("../client/src/messengerController.js"), "utf8");
  assert.match(appSource, /import \{ initializeMessenger \} from "\.\/messengerController\.js"/);
  assert.doesNotMatch(appSource, /import\(["']\.\/messengerController\.js["']\)/);
  assert.match(controllerSource, /export function initializeMessenger\(\) \{\s*if \(controllerInitialized\) return \(\) => \{\};\s*messengerView = document\.querySelector\("#messenger-view"\);\s*messageList = document\.querySelector\("#message-list"\);/);
});

test("provides reaction, reply, and searchable message-forwarding controls", async () => {
  const appSource = await fs.readFile(require.resolve("../client/src/App.jsx"), "utf8");
  const controllerSource = await fs.readFile(
    require.resolve("../client/src/messengerController.js"),
    "utf8"
  );
  const stylesSource = await fs.readFile(require.resolve("../public/styles.css"), "utf8");
  assert.match(controllerSource, /async function applyMessageMutation\(message\)[\s\S]*?const wasAtBottom = isMessageListAtBottom\(\);[\s\S]*?renderMessages\(wasAtBottom \? \{\} : \{ keepScrollTop: true, previousTop \}\);/);
  assert.match(controllerSource, /async function openConversation\(conversation\)[\s\S]*?messages = await Promise\.all\(history\.messages\.reverse\(\)[\s\S]*?renderMessages\(\);/);
  assert.doesNotMatch(stylesSource, /\.message-list\s*\{[^}]*scroll-behavior:\s*smooth/s);
  assert.match(appSource, /function ForwardMessageDialog\(\)/);
  assert.match(appSource, /id="forward-message-dialog"/);
  assert.match(appSource, /id="forward-user-search"/);
  assert.match(appSource, /polus:forward-message-to-chat/);
  assert.match(appSource, /polus:message-react/);
  assert.match(appSource, /polus:reply-target-changed/);
  assert.match(appSource, /replyToId: replyTarget\.message\.id/);
  assert.match(appSource, /polus:refresh-messenger-state/);
  assert.match(appSource, /requestJson\(`\/api\/discover\?q=\$\{encodeURIComponent\(query\)\}`\)/);
  assert.match(appSource, /MESSAGE_REACTION_EMOJIS/);
  assert.match(appSource, /function PushOnboardingDialog\(\{ user \}\)/);
  assert.match(appSource, /polus-push-onboarding-dismissed:\$\{user\.id\}/);
  assert.match(appSource, /await navigator\.serviceWorker\.ready/);
  assert.match(appSource, /if \(subscription \|\| Notification\.permission === "denied"\) return;/);
  assert.match(appSource, /sessionStorage\.getItem\(key\) === "done"/);
  assert.match(appSource, /polus:toggle-push/);
  assert.match(appSource, /accept="audio\/\*"\s+capture="user"/);
  assert.match(appSource, /await navigator\.mediaDevices\.getUserMedia\(\{ audio: true \}\)/);
  assert.match(appSource, /setPendingRecording\(\{ file: audioFile, duration: 0, fromFile: true \}\)/);
  assert.match(appSource, /const onScroll = \(event\) => \{\s*if \(menuRef\.current\?\.contains\(event\.target\)\) return;\s*close\(\);/);
  assert.match(appSource, /message\.forwardedFrom/);
  assert.match(appSource, /message\.reactions\.map/);
  assert.match(controllerSource, /\/reactions/);
  assert.match(controllerSource, /const canReply = currentConversation\.joined !== false\s+\&\& \(currentConversation\.type !== "channel" \|\| canModerate\);/);
  assert.match(controllerSource, /polus:refresh-messenger-state/);
  assert.match(controllerSource, /const permissionPromise = Notification\.permission === "default"\s+\? Notification\.requestPermission\(\)/);
  assert.match(controllerSource, /\/forward/);
  assert.match(controllerSource, /chat\.type !== "channel" \|\| \["owner", "admin"\]\.includes\(chat\.role\)/);
  assert.match(controllerSource, /polus:open-replied-message/);
  assert.match(controllerSource, /polus:realtime-messages-read/);
  assert.match(stylesSource, /\.message-reactions/);
  assert.match(stylesSource, /\.context-reaction-picker \{[^}]*overscroll-behavior: contain;[^}]*touch-action: pan-y;/);
  assert.match(stylesSource, /\.composer-reply-preview/);
  assert.match(stylesSource, /\.forward-target-list/);
});
