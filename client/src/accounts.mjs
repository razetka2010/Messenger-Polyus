const ACCOUNTS_STORAGE_KEY = "polus-accounts";

export function createAccountKey() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function getStoredAccounts() {
  const value = localStorage.getItem(ACCOUNTS_STORAGE_KEY);
  if (!value) return [];
  const accounts = JSON.parse(value);
  if (!Array.isArray(accounts)) throw new Error("Saved accounts could not be read.");
  return accounts.filter((account) =>
    account && typeof account.key === "string" && /^[a-f0-9]{32}$/.test(account.key)
    && account.user && typeof account.user.id === "string"
  );
}

export function saveAccounts(accounts) {
  localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(accounts.map(({ key, user, unreadCount = 0 }) => ({
    key,
    user,
    unreadCount: Number.isSafeInteger(unreadCount) && unreadCount > 0 ? unreadCount : 0
  }))));
}

export function getRequestedAccountUserId() {
  return new URLSearchParams(window.location.search).get("accountUserId");
}
