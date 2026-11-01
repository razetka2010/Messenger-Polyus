const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { afterEach, test } = require("node:test");
const apiClientPromise = import("../client/src/apiClient.mjs");
const conversationListPromise = import("../client/src/conversationList.mjs");

const originalFetch = globalThis.fetch;
const diagnosticsPromise = import("../client/src/diagnostics.mjs");

afterEach(() => {
  globalThis.fetch = originalFetch;
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

test("pins Saved Messages above activity-sorted chats and hides its management controls", async () => {
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
  const appSource = await fs.readFile(require.resolve("../client/src/App.jsx"), "utf8");
  const stylesSource = await fs.readFile(require.resolve("../public/styles.css"), "utf8");
  assert.doesNotMatch(appSource, /id="manage-chat"|id="chat-info"/);
  assert.doesNotMatch(appSource, /id="chat-management-dialog"/);
  assert.match(appSource, /<ChatInfoDialogContent \/>\s*<ChatManagementContent \/>/);
  assert.match(appSource, /id="chat-management-content" className="chat-profile-management"/);
  assert.match(appSource, /saved-bookmark-icon/);
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
  assert.match(appSource, /<video controls preload="metadata" src=\{url\} \/>/);
  assert.match(appSource, /new MediaRecorder\(stream/);
  assert.match(appSource, /function VoiceMessagePlayer\(/);
  assert.match(appSource, /preload="auto"/);
  assert.match(appSource, /onPlaying=\{\(event\)/);
  assert.match(appSource, /audio\.canPlayType\(attachment\.mimeType\) === ""/);
  assert.match(appSource, /if \(!window\.isSecureContext\)\s*\{\s*document\.dispatchEvent\(new CustomEvent\("polus:notify", \{ detail: labels\.recordingSecureContext \}\)\)/);
  assert.match(appSource, /recordingSecureContext: "Для записи голоса откройте Полюс по HTTPS/);
  assert.match(appSource, /recordingSecureContext: "Open Polus over HTTPS to record voice messages/);
  assert.match(appSource, /let activeVoiceMessageAudio = null/);
  assert.match(appSource, /if \(activeVoiceMessageAudio && activeVoiceMessageAudio !== audio\)\s*\{\s*activeVoiceMessageAudio\.pause\(\)/);
  assert.match(appSource, /if \(activeVoiceMessageAudio === audio\) activeVoiceMessageAudio = null/);
  assert.match(appSource, /if \(activeVoiceMessageAudio === event\.currentTarget\) activeVoiceMessageAudio = null/);
  assert.match(appSource, /const current = event\.currentTarget\.currentTime;\s*setPlayback\(\(playback\) => \(\{ \.\.\.playback, current \}\)\)/);
  assert.match(appSource, /const duration = event\.currentTarget\.duration;\s*setPlayback\(\(current\) => \(\{ \.\.\.current, duration \}\)\)/);
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

test("provides reaction, reply, and searchable message-forwarding controls", async () => {
  const appSource = await fs.readFile(require.resolve("../client/src/App.jsx"), "utf8");
  const controllerSource = await fs.readFile(
    require.resolve("../client/src/messengerController.js"),
    "utf8"
  );
  const stylesSource = await fs.readFile(require.resolve("../public/styles.css"), "utf8");
  assert.match(appSource, /function ForwardMessageDialog\(\)/);
  assert.match(appSource, /id="forward-message-dialog"/);
  assert.match(appSource, /id="forward-user-search"/);
  assert.match(appSource, /polus:forward-message-to-chat/);
  assert.match(appSource, /polus:message-react/);
  assert.match(appSource, /polus:reply-target-changed/);
  assert.match(appSource, /replyToId: replyTarget\.message\.id/);
  assert.match(appSource, /message\.forwardedFrom/);
  assert.match(appSource, /message\.reactions\.map/);
  assert.match(controllerSource, /\/reactions/);
  assert.match(controllerSource, /\/forward/);
  assert.match(controllerSource, /chat\.type !== "channel" \|\| \["owner", "admin"\]\.includes\(chat\.role\)/);
  assert.match(controllerSource, /polus:open-replied-message/);
  assert.match(controllerSource, /polus:realtime-messages-read/);
  assert.match(stylesSource, /\.message-reactions/);
  assert.match(stylesSource, /\.composer-reply-preview/);
  assert.match(stylesSource, /\.forward-target-list/);
});
