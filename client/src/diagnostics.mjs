const STORAGE_KEY = "polus:diagnostics";
const MAX_LOG_ENTRIES = 200;
let storageWarningShown = false;

export function createClientId(cryptoApi = globalThis.crypto) {
  if (typeof cryptoApi?.randomUUID === "function") {
    try {
      return cryptoApi.randomUUID();
    } catch {
      // Fall back for browsers that expose but cannot use randomUUID.
    }
  }

  const bytes = new Uint8Array(16);
  if (typeof cryptoApi?.getRandomValues === "function") {
    try {
      cryptoApi.getRandomValues(bytes);
    } catch {
      fillRandomBytes(bytes);
    }
  } else {
    fillRandomBytes(bytes);
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function fillRandomBytes(bytes) {
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
}

export function getClientDiagnostics() {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const entries = JSON.parse(stored);
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

export function clearClientDiagnostics() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn("[Polus] Unable to clear diagnostic history.", error);
  }
}

export function logClientDiagnostic(event, details = {}, level = "debug") {
  const entry = { timestamp: new Date().toISOString(), event, details };
  const logger = console[level] || console.debug;
  logger.call(console, `[Polus] ${event}`, details);

  if (event === "composer.input.changed") return;

  try {
    const entries = getClientDiagnostics();
    entries.push(entry);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_LOG_ENTRIES)));
  } catch (error) {
    if (!storageWarningShown) {
      storageWarningShown = true;
      console.warn("[Polus] Diagnostic history is unavailable in this browser.", error);
    }
  }
}
