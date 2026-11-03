export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const ACTIVE_ACCOUNT_KEY = "polus-active-account";

export function getActiveAccountKey() {
  try {
    return localStorage.getItem(ACTIVE_ACCOUNT_KEY) || null;
  } catch {
    return null;
  }
}

export function setActiveAccountKey(accountKey) {
  try {
    if (accountKey) localStorage.setItem(ACTIVE_ACCOUNT_KEY, accountKey);
    else localStorage.removeItem(ACTIVE_ACCOUNT_KEY);
  } catch {
    throw new Error("Unable to save the active account on this device.");
  }
}

export function accountApiUrl(url, accountKey = getActiveAccountKey()) {
  if (!accountKey || !url.startsWith("/api/")) return url;
  const [pathname, search = ""] = url.split("?", 2);
  const query = new URLSearchParams(search);
  query.set("accountKey", accountKey);
  return `${pathname}?${query}`;
}

function scopeApiResourceUrls(value, accountKey) {
  if (typeof value === "string") return value.startsWith("/api/") ? accountApiUrl(value, accountKey) : value;
  if (Array.isArray(value)) return value.map((item) => scopeApiResourceUrls(item, accountKey));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) =>
      [key, scopeApiResourceUrls(item, accountKey)]));
  }
  return value;
}

export async function requestJson(url, options = {}) {
  const { accountKey = getActiveAccountKey(), ...requestOptions } = options;
  const belongsToActiveAccount = Boolean(accountKey) && accountKey === getActiveAccountKey();
  const response = await fetch(url, {
    credentials: "same-origin",
    ...requestOptions,
    headers: {
      ...(requestOptions.body ? { "Content-Type": "application/json" } : {}),
      ...(url.startsWith("/api/") ? { "X-Polus-Account": accountKey || "" } : {}),
      ...requestOptions.headers
    }
  });
  let result = {};
  try {
    result = await response.json();
  } catch {
    if (response.ok) throw new Error("The server returned an invalid response.");
  }
  if (belongsToActiveAccount && accountKey !== getActiveAccountKey()) {
    throw new DOMException("The active account changed during the request.", "AbortError");
  }
  if (response.status === 401 && belongsToActiveAccount
    && !/^\/api\/auth\/(?:login|register)$/.test(url)
    && typeof document !== "undefined") {
    document.dispatchEvent(new CustomEvent("polus:account-session-invalid", { detail: { accountKey } }));
  }
  if (!response.ok) {
    throw new ApiError(result.error?.message || result.error || "The request could not be completed.", response.status);
  }
  return scopeApiResourceUrls(result, accountKey);
}
