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
  const controllerSource = await fs.readFile(require.resolve("../client/src/messengerController.js"), "utf8");
  const stylesSource = await fs.readFile(require.resolve("../public/styles.css"), "utf8");
  assert.doesNotMatch(appSource, /id="manage-chat"|id="chat-info"/);
  assert.doesNotMatch(appSource, /id="chat-management-dialog"/);
  assert.match(appSource, /<ChatInfoDialogContent \/>\s*<ChatManagementContent \/>/);
  assert.match(appSource, /id="chat-management-content" className="chat-profile-management"/);
  assert.match(appSource, /saved-bookmark-icon/);
  assert.match(appSource, /className="channel-preview-join"/);
  assert.match(appSource, /polus:join-channel/);
  assert.match(appSource, /conversation\.pinned && !saved && !discover/);
  assert.match(appSource, /className="chat-row-pinned"/);
  assert.match(stylesSource, /\.chat-row-pinned svg/);
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
  assert.match(stylesSource, /\.chat-row\[aria-current="page"\] \+ \.chat-row-menu-trigger\s*\{\s*color: #fff;/);
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
  assert.match(appSource, /if \(!navigator\.mediaDevices\?\.getUserMedia \|\| typeof MediaRecorder === "undefined"\) \{\s*voiceFileInput\.current\?\.click\(\)/);
  assert.match(appSource, /await navigator\.mediaDevices\.getUserMedia\(\{ audio: true \}\)/);
  assert.match(appSource, /if \(!window\.isSecureContext\) voiceFileInput\.current\?\.click\(\)/);
  assert.match(appSource, /recordVoiceHttp: "Записать голосовое сообщение/);
  assert.match(appSource, /recordVoiceHttp: "Record voice message/);
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
  assert.match(appSource, /function ForwardMessageDialog\(\)/);
  assert.match(appSource, /id="forward-message-dialog"/);
  assert.match(appSource, /id="forward-user-search"/);
  assert.match(appSource, /polus:forward-message-to-chat/);
  assert.match(appSource, /polus:message-react/);
  assert.match(appSource, /polus:reply-target-changed/);
  assert.match(appSource, /replyToId: replyTarget\.message\.id/);
  assert.match(appSource, /polus:refresh-messenger-state/);
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
