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

<<<<<<< Updated upstream
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
=======
export async function fetchAccountResource(url, accountKey = getActiveAccountKey(), options = {}) {
>>>>>>> Stashed changes
  const response = await fetch(url, {
    credentials: "same-origin",
    ...requestOptions,
    headers: {
<<<<<<< Updated upstream
      ...(requestOptions.body ? { "Content-Type": "application/json" } : {}),
      ...(url.startsWith("/api/") ? { "X-Polus-Account": accountKey || "" } : {}),
      ...requestOptions.headers
=======
      ...(accountKey ? { "X-Polus-Account": accountKey } : {}),
      ...options.headers
>>>>>>> Stashed changes
    }
  });
  if (!response.ok) throw new ApiError("Unable to load the requested resource.", response.status);
  return response.blob();
}

export function connectEventStream(url, {
  accountKey = getActiveAccountKey(),
  onEvent,
  onOpen,
  onError
} = {}) {
  const controller = new AbortController();
  let lastEventId = "";
  let hasOpened = false;
  let closed = false;

  const run = async () => {
    while (!closed) {
      try {
        const response = await fetch(url, {
          credentials: "same-origin",
          headers: {
            ...(accountKey ? { "X-Polus-Account": accountKey } : {}),
            ...(lastEventId ? { "Last-Event-ID": lastEventId } : {})
          },
          signal: controller.signal
        });
        if (!response.ok || !response.body) {
          if (response.status === 401) {
            if (typeof document !== "undefined") {
              document.dispatchEvent(new CustomEvent("polus:account-session-invalid", { detail: { accountKey } }));
            }
            closed = true;
            return;
          }
          throw new ApiError("Unable to connect to live updates.", response.status);
        }

        onOpen?.({ reconnected: hasOpened });
        hasOpened = true;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let eventName = "message";
        let eventId = "";
        let data = [];
        const dispatch = () => {
          if (data.length) {
            if (eventId) lastEventId = eventId;
            onEvent?.({ type: eventName, data: data.join("\n"), lastEventId: eventId || lastEventId });
          }
          eventName = "message";
          eventId = "";
          data = [];
        };
        const processLine = (line) => {
          if (!line) {
            dispatch();
            return;
          }
          if (line.startsWith(":")) return;
          const separator = line.indexOf(":");
          const field = separator < 0 ? line : line.slice(0, separator);
          const value = separator < 0 ? "" : line.slice(separator + 1).replace(/^ /, "");
          if (field === "event") eventName = value || "message";
          else if (field === "data") data.push(value);
          else if (field === "id" && !value.includes("\0")) eventId = value;
        };

        while (!closed) {
          const { value, done } = await reader.read();
          buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
          let newline;
          while ((newline = buffer.indexOf("\n")) >= 0) {
            let line = buffer.slice(0, newline);
            buffer = buffer.slice(newline + 1);
            if (line.endsWith("\r")) line = line.slice(0, -1);
            processLine(line);
          }
          if (done) {
            if (buffer) processLine(buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer);
            dispatch();
            break;
          }
        }
      } catch (error) {
        if (closed || error.name === "AbortError") return;
        onError?.(error);
      }

      if (!closed) {
        await new Promise((resolve) => {
          const finish = () => {
            clearTimeout(timeout);
            controller.signal.removeEventListener("abort", finish);
            resolve();
          };
          const timeout = setTimeout(finish, 3000);
          controller.signal.addEventListener("abort", finish, { once: true });
        });
      }
    }
  };
  void run();
  return { close() { closed = true; controller.abort(); } };
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
