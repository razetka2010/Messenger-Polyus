import { requestJson } from "./apiClient.mjs";

const DATABASE_NAME = "polus-encryption";
const STORE_NAME = "identities";
const SIGNING_STORE_NAME = "signing-identities";
const MESSAGE_PREFIX = "polus-e2ee:v2:";
const LEGACY_MESSAGE_PREFIX = "polus-e2ee:v1:";
const CURRENT_KEY_VERSION = 3;
const CURRENT_KDF_ITERATIONS = 600_000;
const ATTACHMENT_CHUNK_SIZE = 1024 * 1024;
const ATTACHMENT_GCM_TAG_BYTES = 16;
const SUPPORTED_KEY_VERSIONS = new Map([
  [2, 310_000],
  [3, CURRENT_KDF_ITERATIONS]
]);
const TRUSTED_KEYS_PREFIX = "polus-trusted-encryption-keys:";
const pendingTrustChanges = new Map();

function requireCrypto() {
  if (!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) {
    throw new Error("End-to-end encryption requires a secure browser context.");
  }
  return globalThis.crypto;
}

function toBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function fromBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function getPublicKeyFingerprint(publicKey, signingPublicKey) {
  const identity = new TextEncoder().encode(`${publicKey}:${signingPublicKey}`);
  const digest = await requireCrypto().subtle.digest("SHA-256", identity);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readTrustedEncryptionKeys(userId) {
  const stored = globalThis.localStorage.getItem(`${TRUSTED_KEYS_PREFIX}${userId}`);
  if (!stored) return {};
  const trustedKeys = JSON.parse(stored);
  if (!trustedKeys || typeof trustedKeys !== "object" || Array.isArray(trustedKeys)
    || Object.values(trustedKeys).some((fingerprint) =>
      typeof fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(fingerprint))) {
    throw new Error("Saved encryption key fingerprints are invalid. Clear this browser's saved encryption fingerprints to continue.");
  }
  return trustedKeys;
}

export async function verifyRecipientEncryptionKeys(userId, recipients, { remember = true } = {}) {
  const fingerprints = await Promise.all(recipients.map(async ({ id, publicKey, signingPublicKey }) => {
    if (typeof id !== "string" || !id || typeof publicKey !== "string" || !publicKey
      || typeof signingPublicKey !== "string" || !signingPublicKey) {
      throw new Error("A chat participant has not set up end-to-end encryption.");
    }
    return {
      id,
      publicKey,
      signingPublicKey,
      fingerprint: await getPublicKeyFingerprint(publicKey, signingPublicKey)
    };
  }));
  const trustedKeys = readTrustedEncryptionKeys(userId);
  const changed = fingerprints.find(({ id, fingerprint }) =>
    trustedKeys[id] && trustedKeys[id] !== fingerprint);
  if (changed) {
    const error = new Error(`Encryption key changed for user ${changed.id}.`);
    error.code = "ENCRYPTION_KEY_CHANGED";
    error.userId = userId;
    error.recipientId = changed.id;
    error.publicKey = changed.publicKey;
    error.signingPublicKey = changed.signingPublicKey;
    error.previousFingerprint = trustedKeys[changed.id];
    error.newFingerprint = changed.fingerprint;
    throw error;
  }
  if (remember) {
    for (const { id, fingerprint } of fingerprints) trustedKeys[id] = fingerprint;
    globalThis.localStorage.setItem(`${TRUSTED_KEYS_PREFIX}${userId}`, JSON.stringify(trustedKeys));
  }
}

export async function trustChangedEncryptionKey(userId, recipientId, publicKey, signingPublicKey, previousFingerprint) {
  const fingerprint = await getPublicKeyFingerprint(publicKey, signingPublicKey);
  const trustedKeys = readTrustedEncryptionKeys(userId);
  if (trustedKeys[recipientId] !== previousFingerprint) {
    throw new Error("The trusted fingerprint changed while confirming the new encryption key. Try again.");
  }
  trustedKeys[recipientId] = fingerprint;
  globalThis.localStorage.setItem(`${TRUSTED_KEYS_PREFIX}${userId}`, JSON.stringify(trustedKeys));
}

async function pinOwnEncryptionKeys(userId, publicKey, signingPublicKey) {
  const trustedKeys = readTrustedEncryptionKeys(userId);
  trustedKeys[userId] = await getPublicKeyFingerprint(publicKey, signingPublicKey);
  globalThis.localStorage.setItem(`${TRUSTED_KEYS_PREFIX}${userId}`, JSON.stringify(trustedKeys));
}

async function confirmIncomingKeyChange(userId, error) {
  const key = `${userId}:${error.recipientId}:${error.newFingerprint}`;
  if (pendingTrustChanges.has(key)) return pendingTrustChanges.get(key);
  const pending = (async () => {
    const russian = globalThis.localStorage.getItem("polus-language") !== "en";
    const text = russian
      ? `Ключи отправителя ${error.recipientId} изменились.\nСтарый отпечаток: ${error.previousFingerprint}\nНовый отпечаток: ${error.newFingerprint}\n\nСверьте новый отпечаток с отправителем по независимому каналу. Доверять этому ключу?`
      : `The sender's keys changed.\nOld fingerprint: ${error.previousFingerprint}\nNew fingerprint: ${error.newFingerprint}\n\nVerify the new fingerprint through an independent channel. Trust this key?`;
    if (typeof globalThis.confirm !== "function" || !globalThis.confirm(text)) throw error;
    await trustChangedEncryptionKey(
      userId,
      error.recipientId,
      error.publicKey,
      error.signingPublicKey,
      error.previousFingerprint
    );
  })();
  pendingTrustChanges.set(key, pending);
  try {
    await pending;
  } finally {
    pendingTrustChanges.delete(key);
  }
}

export function rememberMessageCounter(userId, conversationId, senderId, counter, messageId) {
  const key = `polus-seen-message-counters:${userId}:${conversationId}:${senderId}`;
  const stored = globalThis.localStorage.getItem(key);
  const counters = stored ? JSON.parse(stored) : {};
  if (!counters || typeof counters !== "object" || Array.isArray(counters)) {
    throw new Error("Saved message counters are invalid.");
  }
  const counterKey = String(counter);
  if (counters[counterKey] !== undefined && String(counters[counterKey]) !== String(messageId)) {
    throw new Error("This signed message counter was already seen. The message may be a replay.");
  }
  counters[counterKey] = String(messageId);
  globalThis.localStorage.setItem(key, JSON.stringify(counters));
}

function openIdentityDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error("This browser cannot securely store encryption keys."));
      return;
    }
    const     request = indexedDB.open(DATABASE_NAME, 2);
    request.addEventListener("upgradeneeded", () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
      if (!request.result.objectStoreNames.contains(SIGNING_STORE_NAME)) {
        request.result.createObjectStore(SIGNING_STORE_NAME);
      }
    });
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error || new Error("Unable to open encryption key storage.")), { once: true });
  });
}

async function getLocalIdentity(userId) {
  const database = await openIdentityDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(userId);
      request.addEventListener("success", () => resolve(request.result || null), { once: true });
      request.addEventListener("error", () => reject(request.error || new Error("Unable to read the encryption key.")), { once: true });
    });
  } finally {
    database.close();
  }
}

async function saveLocalIdentity(userId, privateKey) {
  const database = await openIdentityDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(privateKey, userId);
      transaction.addEventListener("complete", resolve, { once: true });
      transaction.addEventListener("error", () => reject(transaction.error || new Error("Unable to save the encryption key.")), { once: true });
      transaction.addEventListener("abort", () => reject(transaction.error || new Error("Unable to save the encryption key.")), { once: true });
    });
  } finally {
    database.close();
  }
}

async function getLocalSigningIdentity(userId) {
  const database = await openIdentityDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(SIGNING_STORE_NAME, "readonly")
        .objectStore(SIGNING_STORE_NAME).get(userId);
      request.addEventListener("success", () => resolve(request.result || null), { once: true });
      request.addEventListener("error", () =>
        reject(request.error || new Error("Unable to read the signing key.")), { once: true });
    });
  } finally {
    database.close();
  }
}

async function saveLocalSigningIdentity(userId, privateKey) {
  const database = await openIdentityDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(SIGNING_STORE_NAME, "readwrite");
      transaction.objectStore(SIGNING_STORE_NAME).put(privateKey, userId);
      transaction.addEventListener("complete", resolve, { once: true });
      transaction.addEventListener("error", () =>
        reject(transaction.error || new Error("Unable to save the signing key.")), { once: true });
      transaction.addEventListener("abort", () =>
        reject(transaction.error || new Error("Unable to save the signing key.")), { once: true });
    });
  } finally {
    database.close();
  }
}

function getWrappingKeyIterations(sealed) {
  const expectedIterations = sealed?.keyVersion === undefined
    ? 310_000
    : SUPPORTED_KEY_VERSIONS.get(sealed.keyVersion);
  if (!expectedIterations || sealed.iterations !== expectedIterations) {
    throw new Error("The saved encryption key uses an unsupported format.");
  }
  return expectedIterations;
}

async function deriveWrappingKey(passphrase, salt, iterations, usages) {
  const crypto = requireCrypto();
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    usages
  );
}

async function sealPrivateKey(privateKeyBytes, passphrase) {
  const crypto = requireCrypto();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrappingKey = await deriveWrappingKey(passphrase, salt, CURRENT_KDF_ITERATIONS, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, wrappingKey, privateKeyBytes);
  return {
    keyVersion: CURRENT_KEY_VERSION,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
    iterations: CURRENT_KDF_ITERATIONS
  };
}

async function unsealPrivateKey(sealed, passphrase) {
  const iterations = getWrappingKeyIterations(sealed);
  const crypto = requireCrypto();
  const wrappingKey = await deriveWrappingKey(passphrase, fromBase64(sealed.salt), iterations, ["decrypt"]);
  try {
    return await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(sealed.iv) },
      wrappingKey,
      fromBase64(sealed.ciphertext)
    );
  } catch {
    throw new Error("Unable to unlock the encryption key. Check your encryption passphrase.");
  }
}

async function storeEncryptionIdentity(
  accountKey,
  publicKey,
  sealedPrivateKey,
  signingPublicKey,
  sealedSigningPrivateKey
) {
  await requestJson("/api/account/encryption-key", {
    method: "PUT",
    accountKey,
    body: JSON.stringify({
      publicKey,
      sealedPrivateKey,
      ...(signingPublicKey ? { signingPublicKey, sealedSigningPrivateKey } : {})
    })
  });
}

async function getSharedEncryptionKey(accountKey) {
  const { wrappingKey } = await requestJson("/api/account/encryption-config", { accountKey });
  if (typeof wrappingKey !== "string" || new TextEncoder().encode(wrappingKey).length < 32) {
    throw new Error("The shared encryption key is not configured correctly on the server.");
  }
  return wrappingKey;
}

async function unsealWithSharedKey(sealed, sharedKey, legacyPassphrase, accountPassword) {
  getWrappingKeyIterations(sealed);
  try {
    return { bytes: await unsealPrivateKey(sealed, sharedKey), needsRewrap: false };
  } catch {
    const fallback = sealed.keyVersion === undefined ? accountPassword : legacyPassphrase;
    if (!fallback) {
      throw new Error("This key uses an older encryption phrase. Enter that phrase once to migrate it.");
    }
    try {
      return { bytes: await unsealPrivateKey(sealed, fallback), needsRewrap: true };
    } catch {
      throw new Error("Unable to unlock the old encryption key. Check the previous phrase or account password.");
    }
  }
}

export async function hasReadyEncryptionIdentity(userId, accountKey) {
  const [localIdentity, localSigningIdentity, stored] = await Promise.all([
    getLocalIdentity(userId),
    getLocalSigningIdentity(userId),
    requestJson("/api/account/encryption-key", { accountKey })
  ]);
  return Boolean(localIdentity && localSigningIdentity && stored.publicKey
    && stored.sealedPrivateKey?.keyVersion === CURRENT_KEY_VERSION
    && stored.sealedPrivateKey?.iterations === CURRENT_KDF_ITERATIONS
    && stored.signingPublicKey && stored.sealedSigningPrivateKey?.keyVersion === CURRENT_KEY_VERSION
    && stored.sealedSigningPrivateKey?.iterations === CURRENT_KDF_ITERATIONS);
}

export async function ensureEncryptionIdentity(userId, accountPassword, legacyEncryptionPassphrase, accountKey) {
  const crypto = requireCrypto();
  const encryptionPassphrase = await getSharedEncryptionKey(accountKey);
  let stored = await requestJson("/api/account/encryption-key", { accountKey });
  let localIdentity = await getLocalIdentity(userId);
  let privateKeyBytes;

  if (stored.publicKey && stored.sealedPrivateKey) {
    const encryptionKey = await unsealWithSharedKey(
      stored.sealedPrivateKey,
      encryptionPassphrase,
      legacyEncryptionPassphrase,
      accountPassword
    );
    privateKeyBytes = encryptionKey.bytes;
    let needsRewrap = encryptionKey.needsRewrap
      || stored.sealedPrivateKey.keyVersion !== CURRENT_KEY_VERSION
      || stored.sealedPrivateKey.iterations !== CURRENT_KDF_ITERATIONS;
    let sealedSigningPrivateKey = stored.sealedSigningPrivateKey || null;
    if (stored.signingPublicKey && stored.sealedSigningPrivateKey) {
      const signingKey = await unsealWithSharedKey(
        stored.sealedSigningPrivateKey,
        encryptionPassphrase,
        legacyEncryptionPassphrase,
        accountPassword
      );
      needsRewrap ||= signingKey.needsRewrap
        || stored.sealedSigningPrivateKey.keyVersion !== CURRENT_KEY_VERSION
        || stored.sealedSigningPrivateKey.iterations !== CURRENT_KDF_ITERATIONS;
      if (needsRewrap) sealedSigningPrivateKey = await sealPrivateKey(signingKey.bytes, encryptionPassphrase);
    }
    if (needsRewrap) {
      const sealedPrivateKey = await sealPrivateKey(privateKeyBytes, encryptionPassphrase);
      await storeEncryptionIdentity(
        accountKey,
        stored.publicKey,
        sealedPrivateKey,
        stored.signingPublicKey,
        sealedSigningPrivateKey
      );
      stored = { ...stored, sealedPrivateKey, sealedSigningPrivateKey };
    }
    if (!localIdentity && privateKeyBytes) {
      localIdentity = await crypto.subtle.importKey(
        "pkcs8",
        privateKeyBytes,
        { name: "RSA-OAEP", hash: "SHA-256" },
        false,
        ["decrypt"]
      );
      await saveLocalIdentity(userId, localIdentity);
    } else if (!privateKeyBytes && !localIdentity) {
      privateKeyBytes = await unsealPrivateKey(stored.sealedPrivateKey, encryptionPassphrase);
      localIdentity = await crypto.subtle.importKey(
        "pkcs8",
        privateKeyBytes,
        { name: "RSA-OAEP", hash: "SHA-256" },
        false,
        ["decrypt"]
      );
      await saveLocalIdentity(userId, localIdentity);
    }
  } else if (stored.publicKey || stored.sealedPrivateKey) {
    throw new Error("The saved encryption identity is incomplete. Contact the server administrator.");
  } else {
    const encryptionKeyPair = await crypto.subtle.generateKey(
      { name: "RSA-OAEP", modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["encrypt", "decrypt"]
    );
    const signingKeyPair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"]
    );
    const publicKeyBytes = await crypto.subtle.exportKey("spki", encryptionKeyPair.publicKey);
    const signingPublicKeyBytes = await crypto.subtle.exportKey("spki", signingKeyPair.publicKey);
    privateKeyBytes = await crypto.subtle.exportKey("pkcs8", encryptionKeyPair.privateKey);
    const signingPrivateKeyBytes = await crypto.subtle.exportKey("pkcs8", signingKeyPair.privateKey);
    const sealedPrivateKey = await sealPrivateKey(privateKeyBytes, encryptionPassphrase);
    const sealedSigningPrivateKey = await sealPrivateKey(signingPrivateKeyBytes, encryptionPassphrase);
    const localSigningIdentity = await crypto.subtle.importKey(
      "pkcs8",
      signingPrivateKeyBytes,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"]
    );
    localIdentity = await crypto.subtle.importKey(
      "pkcs8",
      privateKeyBytes,
      { name: "RSA-OAEP", hash: "SHA-256" },
      false,
      ["decrypt"]
    );
    await saveLocalIdentity(userId, localIdentity);
    await storeEncryptionIdentity(
      accountKey,
      toBase64(new Uint8Array(publicKeyBytes)),
      sealedPrivateKey,
      toBase64(new Uint8Array(signingPublicKeyBytes)),
      sealedSigningPrivateKey
    );
    await saveLocalSigningIdentity(userId, localSigningIdentity);
    await pinOwnEncryptionKeys(
      userId,
      toBase64(new Uint8Array(publicKeyBytes)),
      toBase64(new Uint8Array(signingPublicKeyBytes))
    );
    return localIdentity;
  }

  if (!localIdentity) throw new Error("The encryption key could not be loaded.");
  let localSigningIdentity = await getLocalSigningIdentity(userId);
  if (stored.signingPublicKey && stored.sealedSigningPrivateKey) {
    if (!localSigningIdentity) {
      const { bytes: signingPrivateKeyBytes } = await unsealWithSharedKey(
        stored.sealedSigningPrivateKey,
        encryptionPassphrase,
        legacyEncryptionPassphrase,
        accountPassword
      );
      localSigningIdentity = await crypto.subtle.importKey(
        "pkcs8",
        signingPrivateKeyBytes,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["sign"]
      );
      await saveLocalSigningIdentity(userId, localSigningIdentity);
    }
    const signingPublicKey = await crypto.subtle.importKey(
      "spki",
      fromBase64(stored.signingPublicKey),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const proof = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      localSigningIdentity,
      challenge
    );
    if (!await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      signingPublicKey,
      proof,
      challenge
    )) {
      throw new Error("The local signing key does not match the saved encryption identity.");
    }
    return localIdentity;
  }
  if (stored.signingPublicKey || stored.sealedSigningPrivateKey) {
    throw new Error("The saved signing identity is incomplete. Contact the server administrator.");
  }
  const signingKeyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const signingPublicKeyBytes = await crypto.subtle.exportKey("spki", signingKeyPair.publicKey);
  const signingPrivateKeyBytes = await crypto.subtle.exportKey("pkcs8", signingKeyPair.privateKey);
  const sealedSigningPrivateKey = await sealPrivateKey(signingPrivateKeyBytes, encryptionPassphrase);
  localSigningIdentity = await crypto.subtle.importKey(
    "pkcs8",
    signingPrivateKeyBytes,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  await storeEncryptionIdentity(
    accountKey,
    stored.publicKey,
    stored.sealedPrivateKey,
    toBase64(new Uint8Array(signingPublicKeyBytes)),
    sealedSigningPrivateKey
  );
  await saveLocalSigningIdentity(userId, localSigningIdentity);
  await pinOwnEncryptionKeys(userId, stored.publicKey, toBase64(new Uint8Array(signingPublicKeyBytes)));
  return localIdentity;
}

export async function prepareEncryptionKeyPasswordChange(
  currentPassword,
  newPassword,
  accountKey,
  keyUnlockPassword = currentPassword
) {
  const encryptionPassphrase = await getSharedEncryptionKey(accountKey);
  const stored = await requestJson("/api/account/encryption-key", { accountKey });
  if (!stored.sealedPrivateKey || stored.sealedPrivateKey.keyVersion !== undefined) return null;

  let privateKeyBytes;
  try {
    privateKeyBytes = await unsealPrivateKey(stored.sealedPrivateKey, keyUnlockPassword);
  } catch {
    throw new Error("Unable to unlock the legacy encryption key. Check the password that sealed it.");
  }
  const crypto = requireCrypto();
  const encryptionPrivateKey = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyBytes,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["decrypt"]
  );
  const encryptionPublicKey = await crypto.subtle.importKey(
    "spki",
    fromBase64(stored.publicKey),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"]
  );
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const encryptedChallenge = await crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    encryptionPublicKey,
    challenge
  );
  const decryptedChallenge = new Uint8Array(await crypto.subtle.decrypt(
    { name: "RSA-OAEP" },
    encryptionPrivateKey,
    encryptedChallenge
  ));
  if (decryptedChallenge.some((byte, index) => byte !== challenge[index])) {
    throw new Error("The legacy encryption key does not match the saved public identity.");
  }
  const update = {
    sealedPrivateKey: await sealPrivateKey(privateKeyBytes, encryptionPassphrase)
  };

  if (stored.signingPublicKey && stored.sealedSigningPrivateKey
    && stored.sealedSigningPrivateKey.keyVersion === undefined) {
    let signingPrivateKeyBytes;
    try {
      signingPrivateKeyBytes = await unsealPrivateKey(stored.sealedSigningPrivateKey, keyUnlockPassword);
    } catch {
      throw new Error("Unable to unlock the legacy signing key. Check the password that sealed it.");
    }
    const signingPrivateKey = await crypto.subtle.importKey(
      "pkcs8",
      signingPrivateKeyBytes,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"]
    );
    const signingPublicKey = await crypto.subtle.importKey(
      "spki",
      fromBase64(stored.signingPublicKey),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );
    const signingChallenge = crypto.getRandomValues(new Uint8Array(32));
    const proof = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      signingPrivateKey,
      signingChallenge
    );
    if (!await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      signingPublicKey,
      proof,
      signingChallenge
    )) {
      throw new Error("The legacy signing key does not match the saved public identity.");
    }
    update.sealedSigningPrivateKey = await sealPrivateKey(signingPrivateKeyBytes, encryptionPassphrase);
  } else if (stored.signingPublicKey && stored.sealedSigningPrivateKey
    && stored.sealedSigningPrivateKey.keyVersion !== undefined) {
    getWrappingKeyIterations(stored.sealedSigningPrivateKey);
  }

  return update;
}

export async function getEncryptionPublicKey(username, accountKey) {
  const result = await requestJson(
    `/api/users/${encodeURIComponent(username)}/encryption-key`,
    { accountKey }
  );
  if (!result.publicKey) throw new Error(`@${username} has not set up end-to-end encryption.`);
  return {
    id: result.userId,
    publicKey: result.publicKey,
    signingPublicKey: result.signingPublicKey
  };
}

export async function getOwnEncryptionPublicKey(accountKey) {
  const result = await requestJson("/api/account/encryption-key", { accountKey });
  if (!result.publicKey) throw new Error("Your account has not set up end-to-end encryption.");
  return {
    id: result.userId,
    publicKey: result.publicKey,
    signingPublicKey: result.signingPublicKey
  };
}

export async function getConversationEncryptionKeys(conversationId, accountKey) {
  const result = await requestJson(
    `/api/chats/${encodeURIComponent(conversationId)}/encryption-keys`,
    { accountKey }
  );
  if (!Array.isArray(result.keys) || result.keys.some((item) =>
    typeof item.id !== "string" || typeof item.publicKey !== "string"
      || typeof item.signingPublicKey !== "string")) {
    throw new Error("A chat participant has not set up end-to-end encryption.");
  }
  return result.keys;
}

function nextMessageCounter(userId) {
  const deviceKey = `polus-message-device:${userId}`;
  const storedDeviceId = globalThis.localStorage.getItem(deviceKey);
  let deviceId;
  if (storedDeviceId === null) {
    const random = requireCrypto().getRandomValues(new Uint32Array(1))[0];
    deviceId = random;
    globalThis.localStorage.setItem(deviceKey, String(deviceId));
  } else {
    deviceId = Number(storedDeviceId);
  }
  if (!Number.isSafeInteger(deviceId) || deviceId < 0 || deviceId > 0xffffffff) {
    throw new Error("The saved message device identifier is invalid.");
  }
  const sequenceKey = `polus-message-sequence:${userId}`;
  const storedSequence = globalThis.localStorage.getItem(sequenceKey);
  const previous = storedSequence === null ? 0 : Number(storedSequence);
  if (!Number.isSafeInteger(previous) || previous < 0 || previous >= 0x200000) {
    throw new Error("The saved message counter is invalid.");
  }
  const sequence = previous + 1;
  const counter = deviceId * 0x200000 + sequence;
  if (!Number.isSafeInteger(counter)) throw new Error("Unable to create a safe message counter.");
  globalThis.localStorage.setItem(sequenceKey, String(sequence));
  return counter;
}

function signedMessageData(packet) {
  return JSON.stringify({
    version: packet.version,
    context: packet.context,
    iv: packet.iv,
    ciphertext: packet.ciphertext,
    envelopes: packet.envelopes,
    senderPublicKey: packet.senderPublicKey,
    signingPublicKey: packet.signingPublicKey
  });
}

export async function encryptMessagePayload(userId, recipients, conversationId, payload) {
  const crypto = requireCrypto();
  const privateKey = await getLocalIdentity(userId);
  const signingPrivateKey = await getLocalSigningIdentity(userId);
  if (!privateKey || !signingPrivateKey) {
    throw new Error("Unlock end-to-end encryption before sending messages.");
  }
  await verifyRecipientEncryptionKeys(userId, recipients);
  const uniqueRecipients = new Map(recipients.map((item) => [item.id, item]));
  if (!uniqueRecipients.has(userId)) throw new Error("Your encryption key is missing from this chat.");
  const senderIdentity = uniqueRecipients.get(userId);
  const context = {
    conversationId,
    senderId: userId,
    counter: nextMessageCounter(userId)
  };
  const contentKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt({
    name: "AES-GCM",
    iv,
    additionalData: new TextEncoder().encode(JSON.stringify(context))
  }, contentKey, plaintext);
  const rawKey = await crypto.subtle.exportKey("raw", contentKey);
  const envelopes = {};
  await Promise.all([...uniqueRecipients.values()].map(async ({ id, publicKey }) => {
    const imported = await crypto.subtle.importKey(
      "spki",
      fromBase64(publicKey),
      { name: "RSA-OAEP", hash: "SHA-256" },
      false,
      ["encrypt"]
    );
    const envelope = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, imported, rawKey);
    envelopes[id] = toBase64(new Uint8Array(envelope));
  }));
  const packet = {
    version: 2,
    context,
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
    envelopes,
    senderPublicKey: senderIdentity.publicKey,
    signingPublicKey: senderIdentity.signingPublicKey
  };
  packet.signature = toBase64(new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    signingPrivateKey,
    new TextEncoder().encode(signedMessageData(packet))
  )));
  return `${MESSAGE_PREFIX}${JSON.stringify(packet)}`;
}

export async function decryptMessagePayload(userId, message) {
  if (!message?.encrypted || typeof message.text !== "string"
    || (!message.text.startsWith(MESSAGE_PREFIX) && !message.text.startsWith(LEGACY_MESSAGE_PREFIX))) {
    return message;
  }
  const privateKey = await getLocalIdentity(userId);
  if (!privateKey) throw new Error("Unlock end-to-end encryption to read this conversation.");
  const isSigned = message.text.startsWith(MESSAGE_PREFIX);
  const prefix = isSigned ? MESSAGE_PREFIX : LEGACY_MESSAGE_PREFIX;
  const packet = JSON.parse(message.text.slice(prefix.length));
  const envelope = packet.envelopes?.[userId];
  if (typeof envelope !== "string") {
    throw new Error("This message was not encrypted for your account.");
  }
  const crypto = requireCrypto();
  if (isSigned) {
    const context = packet.context;
    if (packet.version !== 2 || !context || context.conversationId !== message.conversationId
      || context.senderId !== (message.signatureAuthorId || message.authorId) || !Number.isSafeInteger(context.counter)
      || !packet.senderPublicKey || !packet.signingPublicKey || !packet.signature) {
      throw new Error("The encrypted message context is invalid.");
    }
    const signingPublicKey = await crypto.subtle.importKey(
      "spki",
      fromBase64(packet.signingPublicKey),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );
    const signatureValid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      signingPublicKey,
      fromBase64(packet.signature),
      new TextEncoder().encode(signedMessageData(packet))
    );
    if (!signatureValid) throw new Error("The encrypted message signature is invalid.");
    try {
      await verifyRecipientEncryptionKeys(userId, [{
        id: context.senderId,
        publicKey: packet.senderPublicKey,
        signingPublicKey: packet.signingPublicKey
      }], { remember: false });
    } catch (error) {
      if (error.code !== "ENCRYPTION_KEY_CHANGED") throw error;
      await confirmIncomingKeyChange(userId, error);
    }
    await verifyRecipientEncryptionKeys(userId, [{
      id: context.senderId,
      publicKey: packet.senderPublicKey,
      signingPublicKey: packet.signingPublicKey
    }]);
  }
  const rawKey = await crypto.subtle.decrypt(
    { name: "RSA-OAEP" },
    privateKey,
    fromBase64(envelope)
  );
  const contentKey = await crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["decrypt"]);
  const additionalData = isSigned
    ? new TextEncoder().encode(JSON.stringify(packet.context))
    : undefined;
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(packet.iv), ...(additionalData ? { additionalData } : {}) },
    contentKey,
    fromBase64(packet.ciphertext)
  );
  if (isSigned) {
    rememberMessageCounter(
      userId,
      packet.context.conversationId,
      packet.context.senderId,
      packet.context.counter,
      message.id
    );
  }
  const payload = JSON.parse(new TextDecoder().decode(plaintext));
  const attachmentMetadata = Array.isArray(payload.attachments) ? payload.attachments : [];
  const metadata = new Map(attachmentMetadata.map((item) => [item.id, item]));
  const decryptedMessage = {
    ...message,
    ...(isSigned ? { signatureVerified: true } : { signatureVerified: false }),
    text: typeof payload.text === "string" ? payload.text : "",
    mediaType: payload.mediaType || message.mediaType,
    attachments: (message.attachments || []).map((attachment, index) => {
      const info = metadata.get(attachment.id) || attachmentMetadata[index];
      const safeInfo = {};
      if (info && typeof info === "object") {
        for (const key of [
          "name", "mimeType", "size", "key", "iv", "encrypted", "encryptionVersion", "chunkSize"
        ]) {
          if (Object.hasOwn(info, key)) safeInfo[key] = info[key];
        }
      }
      return {
        ...attachment,
        ...safeInfo,
        ...(info ? {
          encryption: {
            key: safeInfo.key,
            iv: safeInfo.iv,
            ...(safeInfo.encryptionVersion ? { version: safeInfo.encryptionVersion } : {}),
            ...(safeInfo.chunkSize ? { chunkSize: safeInfo.chunkSize } : {})
          }
        } : {}),
        encrypted: safeInfo.encrypted === true
      };
    })
  };
  if (message.replyTo?.encrypted) {
    const reply = await decryptMessagePayload(userId, message.replyTo);
    decryptedMessage.replyTo = {
      ...message.replyTo,
      text: reply.text,
      ...(reply.signatureVerified !== undefined ? { signatureVerified: reply.signatureVerified } : {})
    };
  }
  return decryptedMessage;
}

export async function encryptAttachment(file) {
  const crypto = requireCrypto();
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const chunkCount = Math.max(1, Math.ceil(file.size / ATTACHMENT_CHUNK_SIZE));
  const parts = [];
  const encoder = new TextEncoder();
  for (let index = 0; index < chunkCount; index += 1) {
    const start = index * ATTACHMENT_CHUNK_SIZE;
    const plaintext = await file.slice(start, Math.min(start + ATTACHMENT_CHUNK_SIZE, file.size)).arrayBuffer();
    const chunkIv = new Uint8Array(iv);
    new DataView(chunkIv.buffer).setUint32(8, index);
    const additionalData = encoder.encode(`polus-attachment-chunk:v1:${file.size}:${chunkCount}:${index}`);
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: chunkIv, additionalData },
      key,
      plaintext
    );
    parts.push(new Blob([encrypted], { type: "application/octet-stream" }));
  }
  const rawKey = await crypto.subtle.exportKey("raw", key);
  return {
    blob: new Blob(parts, { type: "application/octet-stream" }),
    metadata: {
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      encrypted: true,
      key: toBase64(new Uint8Array(rawKey)),
      iv: toBase64(iv),
      encryptionVersion: 1,
      chunkSize: ATTACHMENT_CHUNK_SIZE
    }
  };
}

export async function decryptAttachment(attachment, accountKey) {
  if (!attachment?.encrypted || !attachment.encryption) {
    throw new Error("This attachment is not available for decryption.");
  }
  const response = await fetch(
    `/api/attachments/${encodeURIComponent(attachment.id)}`,
    { credentials: "same-origin", headers: { "X-Polus-Account": accountKey || "" } }
  );
  if (!response.ok) throw new Error("Unable to download the encrypted attachment.");
  const crypto = requireCrypto();
  const key = await crypto.subtle.importKey(
    "raw",
    fromBase64(attachment.encryption.key),
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );
  if (attachment.encryption.version === 1) {
    const chunkSize = attachment.encryption.chunkSize;
    const plaintextSize = attachment.size;
    if (chunkSize !== ATTACHMENT_CHUNK_SIZE
      || !Number.isSafeInteger(plaintextSize)
      || plaintextSize < 0
      || plaintextSize > 100 * 1024 * 1024) {
      throw new Error("The encrypted attachment metadata is invalid.");
    }
    const chunkCount = Math.max(1, Math.ceil(plaintextSize / chunkSize));
    const baseIv = fromBase64(attachment.encryption.iv);
    if (baseIv.length !== 12) throw new Error("The encrypted attachment metadata is invalid.");
    const parts = [];
    const reader = response.body?.getReader();
    if (!reader) throw new Error("The encrypted attachment could not be verified or decrypted.");
    let pending = new Uint8Array(0);
    let chunkIndex = 0;
    const encoder = new TextEncoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const combined = new Uint8Array(pending.length + value.length);
        combined.set(pending);
        combined.set(value, pending.length);
        let offset = 0;
        while (chunkIndex < chunkCount) {
          const plaintextChunkSize = Math.min(chunkSize, plaintextSize - chunkIndex * chunkSize);
          const ciphertextChunkSize = plaintextChunkSize + ATTACHMENT_GCM_TAG_BYTES;
          if (combined.length - offset < ciphertextChunkSize) break;
          const chunkIv = new Uint8Array(baseIv);
          new DataView(chunkIv.buffer).setUint32(8, chunkIndex);
          const additionalData = encoder.encode(
            `polus-attachment-chunk:v1:${plaintextSize}:${chunkCount}:${chunkIndex}`
          );
          const plaintext = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: chunkIv, additionalData },
            key,
            combined.subarray(offset, offset + ciphertextChunkSize)
          );
          parts.push(new Blob([plaintext], { type: "application/octet-stream" }));
          offset += ciphertextChunkSize;
          chunkIndex += 1;
        }
        pending = combined.slice(offset);
        if (chunkIndex === chunkCount && pending.length) {
          throw new Error("The encrypted attachment has unexpected trailing data.");
        }
      }
      if (chunkIndex !== chunkCount || pending.length) {
        throw new Error("The encrypted attachment is incomplete.");
      }
      return new Blob(parts, { type: attachment.mimeType || "application/octet-stream" });
    } catch {
      throw new Error("The encrypted attachment could not be verified or decrypted.");
    } finally {
      reader.releaseLock();
    }
  }
  let plaintext;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(attachment.encryption.iv) },
      key,
      await response.arrayBuffer()
    );
  } catch {
    throw new Error("The encrypted attachment could not be verified or decrypted.");
  }
  return new Blob([plaintext], { type: attachment.mimeType || "application/octet-stream" });
}
