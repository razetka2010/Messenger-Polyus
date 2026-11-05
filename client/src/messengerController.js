import { fetchAccountResource, getActiveAccountKey, requestJson as api } from "./apiClient.mjs";
import { cropAvatar } from "./avatar.mjs";
import {
  decryptMessagePayload,
  encryptMessagePayload,
  getConversationEncryptionKeys,
  getEncryptionPublicKey,
  getOwnEncryptionPublicKey
} from "./encryption.mjs";

let polusReady = false;
(function protectFormsFromNativeSubmit() {
  const sensitiveParams = ["password", "confirmPassword", "currentPassword", "newPassword", "username", "fullName", "about"];
  try {
    const url = new URL(window.location.href);
    let changed = false;
    for (const name of sensitiveParams) {
      if (url.searchParams.has(name)) {
        url.searchParams.delete(name);
        changed = true;
      }
    }
    if (changed) window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // Адрес остаётся как есть, если его не удалось разобрать.
  }
})();

const translations = {
  ru: {
    language: "Язык", welcomeEyebrow: "ВАША ТОЧКА СВЯЗИ", signIn: "С возвращением",
    signInSubtitle: "Войдите, чтобы продолжить общение.", registerSubtitle: "Создай профиль, чтобы общаться с людьми на Полюсе.",
    signInButton: "Войти", fullName: "Имя и фамилия",
    fullNamePlaceholder: "Как тебя называть?", aboutOptional: "О себе (необязательно)",
    username: "Имя пользователя", usernameHint: "Уникально: 3–32 латинских буквы, цифры или _.",
    password: "Пароль", confirmPassword: "Повторите пароль", consent: "Я прочитал(а) и принимаю",
    privacyLink: "политику конфиденциальности", noAccount: "Впервые на Полюсе?", hasAccount: "Уже есть аккаунт?",
    createAccount: "Создать аккаунт", privateByDesign: "Твои разговоры — только для участников.",
    newMessage: "Новое сообщение", channels: "КАНАЛЫ", discover: "ОТКРЫТЫЕ КАНАЛЫ",
    savedMessages: "Избранное", savedMessagesCaption: "Личные заметки и сохранённые сообщения",
    savedMessageSaved: "Сообщение сохранено в Избранном.", savedFrom: "Источник:",
    messageForwarded: "Сообщение переслано.",
    directMessages: "ЛИЧНЫЕ СООБЩЕНИЯ", findPeople: "НАЙТИ ЛЮДЕЙ", searchPeople: "Искать по имени или @username",
    community: "СООБЩЕСТВО", createChannel: "Создать канал", channelName: "Название канала",
    channelDescription: "Описание", create: "Создать", createGroup: "Новая группа", groupName: "Название группы",
    groupMembers: "Участники (@имена через запятую)", yourAccount: "ТВОЙ АККАУНТ", account: "Аккаунт",
    currentPassword: "Текущий пароль (для смены пароля)", newPasswordOptional: "Новый пароль (необязательно)",
    saveChanges: "Сохранить", signOut: "Выйти", writeMessage: "Написать сообщение",
    send: "Отправить",
    messagePlaceholder: "Напиши сообщение…", join: "Вступить", joined: "Участник",
    loadOlderMessages: "Загрузить предыдущие сообщения", deletedMessage: "Сообщение удалено",
    emptyTitle: "Пока здесь тихо", emptyChannel: "Напиши первое сообщение — и разговор начнётся.",
    emptyDirect: "Напиши привет — начните личный разговор.", emptyGroup: "Напиши первое сообщение для группы.",
    noChannels: "Пока нет открытых каналов.", noDirects: "Личные беседы появятся здесь.",
    searchChats: "Поиск", sidebarMenu: "Меню", newGroup: "Новая группа", newChannel: "Новый канал",
    findPeopleItem: "Найти людей", findPeopleFor: "Найти людей:", noChats: "Здесь пока пусто. Нажмите на карандаш, чтобы найти людей.",
    you: "Вы", noMessagesYet: "Нет сообщений", photoLabel: "Фото", fileLabel: "Файлы", backLabel: "Назад",
    searchPlaceholder: "Имя или @username", searchPrompt: "Введи не меньше двух символов, чтобы найти людей.",
    noUsers: "Никого не нашли. Проверь имя пользователя.", edit: "Изменить", remove: "Удалить",
    edited: "изменено", messageSent: "Сообщение отправлено.", editPrompt: "Изменить сообщение",
    messageEditExpired: "Редактировать сообщение можно только в течение 48 часов.",
    errMessageLength: "Сообщение должно содержать от 1 до 4000 символов.",
    errMessageRate: "Можно отправлять не более 20 сообщений в минуту.",
    deleteConfirm: "Удалить это сообщение?", unavailablePush: "Push-уведомления требуют HTTPS и поддержки браузера.",
    permissionDenied: "Разреши уведомления в настройках браузера.", pushEnabled: "Уведомления включены.",
    pushDisabled: "Push-уведомления выключены.", notificationPrompt: "Разрешить браузерные push-уведомления?",
    secureRequired: "Push доступен только на защищённом сайте (HTTPS или localhost).",
    enableNotifications: "Включить push-уведомления", disableNotifications: "Выключить push-уведомления",
    messageArrived: "Новое сообщение от", channelLabel: "канал", groupLabel: "группа",
    online: "В сети", members: "участников", privacyVersion: "Версия политики",
    loginSuccess: "Рады снова видеть тебя.", registerSuccess: "Аккаунт создан. Добро пожаловать на Полюс!",
    errUsername: "Имя пользователя должно содержать 3–32 латинских буквы, цифры или _.",
    errName: "Отображаемое имя должно содержать от 1 до 50 символов.",
    errAbout: "Поле «О себе» не должно превышать 200 символов.",
    errPassword: "Пароль должен содержать 8–128 символов.",
    errPasswordMatch: "Пароли не совпадают.", errPrivacy: "Прочитай и прими политику конфиденциальности.",
    errTaken: "Это имя пользователя уже занято.", errLogin: "Неверное имя пользователя или пароль.",
    errRateLimit: "Слишком много неудачных попыток входа. Попробуй снова через 15 минут.", errCurrentPassword: "Неверный текущий пароль.",
    errNotFound: "Пользователь не найден.", errSelf: "Нельзя написать самому себе.",
    errChannelName: "Название канала слишком короткое.", errGroupName: "Название группы слишком короткое.",
    errGroupUsers: "Добавь от одного до 199 участников.", errGroupMembers: "В группе должен быть хотя бы один участник кроме тебя.",
    errUsernames: "Не удалось найти одно или несколько имён пользователей.",
    errEmptyMessage: "Сначала напиши сообщение.", errGeneric: "Не удалось выполнить запрос. Попробуй ещё раз.",
    joinChannel: "Вступить в канал", directTitle: "Личная переписка", leaveChannel: "Канал",
    groupParticipants: "участников", accountUpdated: "Настройки аккаунта сохранены.",
    channelCreated: "Канал создан.", groupCreated: "Группа создана.",
    manageChat: "Управление чатом", chatMembers: "Участники чата", inviteMember: "Добавить участника",
    groupSettings: "Настройки группы", groupManagement: "Управляйте названием, участниками и приглашениями.",
    groupDetails: "Информация о группе", groupDescription: "Описание группы",
    saveGroupDetails: "Сохранить изменения", groupSettingsSaved: "Настройки группы сохранены.",
    contacts: "Контакты", addContact: "Добавить в контакты", removeContact: "Удалить из контактов",
    contactAdded: "Контакт добавлен.", contactRemoved: "Контакт удалён.",
    addToGroup: "Добавить в группу", inviteToChannel: "Пригласить в канал",
    groupPrivacy: "Доступ к группе",
    publicGroup: "Публичная — видна в поиске, вступить может любой",
    privateGroup: "Приватная — только по приглашению",
    groupAdministrators: "Администраторы группы",
    searchGroupMembers: "Поиск по участникам", noGroupMembers: "Участники не найдены.",
    noGroupAdmins: "В группе пока нет администраторов.",
    confirmRemoveGroupMember: "Удалить участника из группы?",
    confirmLeaveGroup: "Выйти из этой группы?",
    groupTransferOwnershipHelp: "Передача владельца предоставит выбранному участнику полный контроль над группой.",
    confirmTransferGroupOwnership: "Передать владение группой выбранному участнику?",
    deleteGroupHeading: "Удалить группу", deleteGroupHelp: "Группа и история сообщений будут удалены для всех. Это действие нельзя отменить.",
    deleteGroup: "Удалить группу", confirmDeleteGroup: "Удалить эту группу и всю её историю для всех участников? Это действие нельзя отменить.",
    channelPostIdentity: "Публиковать сообщения от имени",
    postAsChannel: "Канала", postAsPerson: "Автора", postIdentitySaved: "Режим публикации обновлён.",
    channelPrivacy: "Приватность канала", publicChannel: "Публичный — отображается в списке каналов",
    privateChannel: "Частный — доступен только по ссылке", inviteLink: "Пригласительная ссылка",
    channelDetails: "Основная информация", channelName: "Название канала",
    channelDescription: "Описание канала", saveChannelDetails: "Сохранить изменения",
    saving: "Сохранение…", channelSettingsSaved: "Настройки канала сохранены.",
    channelPrivacySaved: "Приватность канала обновлена.",
    adminPermissionsSaved: "Права администратора обновлены.",
    invitationSettings: "Приглашения", invitationHelp: "Создайте ссылку или добавьте участника по имени пользователя.",
    noInviteLink: "Пригласительная ссылка ещё не создана.",
    rotateInviteLink: "Обновить ссылку", administration: "Управление каналом",
    createInviteLink: "Создать ссылку", copyInviteLink: "Скопировать ссылку",
    revokeInviteLink: "Отозвать ссылку", linkCopied: "Ссылка скопирована",
    usernamePlaceholder: "@username", makeAdmin: "Назначить администратором", removeAdmin: "Снять администратора",
    subscribers: "Подписчики", administrators: "Администраторы",
    appearance: "Внешний вид", appearanceUnavailable: "Настройки изображения и оформления канала пока не поддерживаются.",
    publishing: "Управление публикациями",
    postIdentityHelp: "Выберите, от чьего имени будут публиковаться сообщения администраторов.",
    permissions: "Права доступа",
    pinPostsUnavailable: "Закрепление публикаций в канале пока не поддерживается.",
    notifications: "Уведомления", channelNotifications: "Уведомления об активности канала",
    channelNotificationsHelp: "Настройка действует только для вашего аккаунта.",
    notAvailable: "Эта возможность пока не поддерживается.",
    ownerOnly: "Изменять эту настройку может только владелец канала.",
    managersOnly: "Изменять эту настройку могут только владелец и администраторы канала.",
    noAdministrators: "В канале пока нет администраторов.",
    yourAdminPermissions: "Разрешения, назначенные вам владельцем канала.",
    adminPermissionOptions: [
      { id: "publish", label: "Публиковать сообщения", description: "Разрешить отправлять сообщения и файлы в канал." },
      { id: "editMessages", label: "Редактировать сообщения", description: "Разрешить редактировать сообщения канала, в том числе опубликованные другими." },
      { id: "deleteMessages", label: "Удалять сообщения", description: "Разрешить удалять сообщения канала, в том числе опубликованные другими." }
    ],
    searchSubscribers: "Поиск по подписчикам", noMatchingSubscribers: "Подписчики не найдены.",
    selectSubscriber: "Выберите подписчика",
    confirmRemoveMember: "Удалить этого подписчика из канала?",
    confirmRevokeInvite: "Отозвать ссылку? Все, у кого она есть, потеряют возможность вступить по ней.",
    transferOwnershipHelp: "Передача владельца предоставит выбранному участнику полный контроль над каналом.",
    confirmTransferOwnership: "Передать владение выбранному участнику?",
    confirmLeave: "Покинуть канал?",
    deleteChannelHeading: "Удалить канал",
    deleteChannelHelp: "Канал и его история будут удалены для всех участников. Это действие нельзя отменить.",
    deleteChannel: "Удалить канал",
    confirmDeleteChannel: "Удалить канал и всю его историю для всех участников? Это действие нельзя отменить.",
    transferOwnership: "Передать владение", leaveChat: "Покинуть чат", deleteChat: "Удалить чат",
    roleOwner: "Владелец", roleAdmin: "Администратор", roleMember: "Участник",
    ownershipTransferred: "Владение передано.", chatDeleted: "Чат удалён.",
    chatInfo: "Информация о чате", searchChat: "Поиск по чату", profile: "ПРОФИЛЬ",
    invalidMaterialsResponse: "Сервер вернул некорректный список материалов. Обновите страницу и попробуйте снова.",
    profileAvatar: "Изображение должно быть не больше 5 МБ.",
    avatarPickerTitle: "Фото профиля", avatarPickerHint: "Выберите изображение до 5 МБ",
    chooseAvatar: "Выбрать фото", showOnline: "Показывать статус «в сети»",
    hideNotificationContent: "Скрывать текст сообщений в уведомлениях",
    noAbout: "Пользователь пока ничего не рассказал о себе.",
    noSharedChats: "Общих групп и каналов пока нет.", noSharedMedia: "Общих медиа пока нет.",
    attachFiles: "Прикрепить файлы", uploadFailed: "Не удалось загрузить файл.",
    thumbnailFailed: "Не удалось создать миниатюру; оригинал сохранён.",
    maxAttachments: "К одному сообщению можно прикрепить не более 10 файлов.",
    maxFileSize: "Размер файла не должен превышать 100 МБ.", muted: "Уведомления отключены",
    unmuted: "Уведомления включены", blockUser: "Заблокировать", unblockUser: "Разблокировать",
    writeToUser: "Написать", muteChat: "Отключить уведомления", unmuteChat: "Включить уведомления",
    sharedChats: "Общие группы и каналы", sharedGroup: "Группа", sharedChannel: "Канал",
    sharedMedia: "Общие медиа", showAll: "Показать все", showLess: "Свернуть",
    channelSettings: "Настройки канала",
    tabMembers: "Участники", tabMedia: "Медиа", tabFiles: "Файлы", tabLinks: "Ссылки", preview: "Миниатюра",
    openMessage: "Перейти к сообщению", searchPromptChat: "Введите текст для поиска",
    noResults: "Ничего не найдено", download: "Скачать", cancelUpload: "Отменить загрузку",
    onlineStatus: "В сети", lastSeen: "Был(а) в сети", registered: "Дата регистрации",
    offlineStatus: "Не в сети", blockedInfo: "Пользователь заблокирован.", profileSettingsSaved: "Профиль обновлён."
  },
  en: {
    language: "Language", welcomeEyebrow: "YOUR PLACE TO CONNECT", signIn: "Welcome back",
    signInSubtitle: "Sign in to pick up the conversation.", registerSubtitle: "Create a profile and start connecting on Polus.",
    signInButton: "Sign in", fullName: "Full name",
    fullNamePlaceholder: "What should we call you?", aboutOptional: "About (optional)",
    username: "Username", usernameHint: "Unique: 3–32 Latin letters, numbers, or _.",
    password: "Password", confirmPassword: "Confirm password", consent: "I have read and agree to the",
    privacyLink: "privacy policy", noAccount: "New to Polus?", hasAccount: "Already have an account?", createAccount: "Create an account",
    privateByDesign: "Your conversations are only for their members.", newMessage: "New message",
    channels: "CHANNELS", discover: "DISCOVER CHANNELS", directMessages: "DIRECT MESSAGES",
    savedMessages: "Saved Messages", savedMessagesCaption: "Personal notes and saved messages",
    savedMessageSaved: "Message saved to Saved Messages.", savedFrom: "From:",
    messageForwarded: "Message forwarded.",
    findPeople: "FIND PEOPLE", searchPeople: "Search by name or @username", community: "COMMUNITY",
    createChannel: "Create a channel", channelName: "Channel name", channelDescription: "Description",
    create: "Create", createGroup: "New group", groupName: "Group name",
    groupMembers: "Members (@usernames separated by commas)", yourAccount: "YOUR ACCOUNT", account: "Account",
    currentPassword: "Current password (to change password)", newPasswordOptional: "New password (optional)",
    saveChanges: "Save changes", signOut: "Sign out", writeMessage: "Write a message",
    send: "Send", messagePlaceholder: "Write a message…",
    join: "Join", joined: "Member", emptyTitle: "It's quiet in here",
    loadOlderMessages: "Load earlier messages", deletedMessage: "Message deleted",
    emptyChannel: "Send the first message and get the conversation started.",
    emptyDirect: "Say hello to start a private conversation.", emptyGroup: "Send the first message to your group.",
    noChannels: "There are no public channels yet.", noDirects: "Your direct messages will show up here.",
    searchChats: "Search", sidebarMenu: "Menu", newGroup: "New group", newChannel: "New channel",
    findPeopleItem: "Find people", findPeopleFor: "Find people:", noChats: "Nothing here yet. Tap the pencil to find people.",
    you: "You", noMessagesYet: "No messages yet", photoLabel: "Photo", fileLabel: "Files", backLabel: "Back",
    searchPlaceholder: "Name or @username", searchPrompt: "Type at least two characters to find people.",
    noUsers: "No matches. Check the username and try again.", edit: "Edit", remove: "Delete",
    edited: "edited", messageSent: "Message sent.", editPrompt: "Edit message",
    messageEditExpired: "Messages can only be edited within 48 hours.",
    errMessageLength: "A message must contain 1–4000 characters.",
    errMessageRate: "You can send at most 20 messages per minute.",
    deleteConfirm: "Delete this message?", unavailablePush: "Push notifications require HTTPS and browser support.",
    permissionDenied: "Allow notifications in your browser settings.", pushEnabled: "Notifications enabled.",
    pushDisabled: "Push notifications turned off.", notificationPrompt: "Allow browser push notifications?",
    secureRequired: "Push is available only on a secure site (HTTPS or localhost).",
    enableNotifications: "Enable push notifications", disableNotifications: "Disable push notifications",
    messageArrived: "New message from", channelLabel: "channel", groupLabel: "group",
    online: "Online", members: "members", privacyVersion: "Policy version",
    loginSuccess: "Welcome back.", registerSuccess: "Account created. Welcome to Polus!",
    errUsername: "Username must be 3–32 Latin letters, numbers, or underscores.",
    errName: "Display name must be 1–50 characters.", errAbout: "About must be at most 200 characters.",
    errPassword: "Password must be 8–128 characters.",
    errPasswordMatch: "Passwords do not match.", errPrivacy: "Please read and accept the privacy policy.",
    errTaken: "That username is already taken.", errLogin: "Incorrect username or password.",
    errRateLimit: "Too many failed sign-in attempts. Try again in 15 minutes.", errCurrentPassword: "Current password is incorrect.",
    errNotFound: "User not found.", errSelf: "You cannot message yourself.",
    errChannelName: "Channel name is too short.", errGroupName: "Group name is too short.",
    errGroupUsers: "Add between 1 and 199 participants.", errGroupMembers: "A group must have at least one other member.",
    errUsernames: "One or more usernames could not be found.",
    errEmptyMessage: "Write a message before sending.", errGeneric: "Request failed. Please try again.",
    joinChannel: "Join channel", directTitle: "Direct message", leaveChannel: "Channel",
    groupParticipants: "members", accountUpdated: "Account settings saved.",
    channelCreated: "Channel created.", groupCreated: "Group created.",
    manageChat: "Manage chat", chatMembers: "Chat members", inviteMember: "Add member",
    groupSettings: "Group settings", groupManagement: "Manage the group name, members, and invitations.",
    groupDetails: "Group information", groupDescription: "Group description",
    saveGroupDetails: "Save changes", groupSettingsSaved: "Group settings saved.",
    contacts: "Contacts", addContact: "Add to contacts", removeContact: "Remove from contacts",
    contactAdded: "Contact added.", contactRemoved: "Contact removed.",
    addToGroup: "Add to group", inviteToChannel: "Invite to channel",
    groupPrivacy: "Group access",
    publicGroup: "Public — discoverable and open to join",
    privateGroup: "Private — invite only",
    groupAdministrators: "Group administrators",
    searchGroupMembers: "Search members", noGroupMembers: "No members found.",
    noGroupAdmins: "There are no group administrators yet.",
    confirmRemoveGroupMember: "Remove this member from the group?",
    confirmLeaveGroup: "Leave this group?",
    groupTransferOwnershipHelp: "Transferring ownership gives the selected member full control of the group.",
    confirmTransferGroupOwnership: "Transfer group ownership to the selected member?",
    deleteGroupHeading: "Delete group", deleteGroupHelp: "The group and its message history will be deleted for everyone. This cannot be undone.",
    deleteGroup: "Delete group", confirmDeleteGroup: "Delete this group and its entire history for everyone? This cannot be undone.",
    channelPostIdentity: "Post messages as",
    postAsChannel: "Channel", postAsPerson: "Author", postIdentitySaved: "Posting identity updated.",
    channelPrivacy: "Channel privacy", publicChannel: "Public — shown in the channel list",
    privateChannel: "Private — available only by invite link", inviteLink: "Invite link",
    channelDetails: "Channel details", channelName: "Channel name",
    channelDescription: "Channel description", saveChannelDetails: "Save changes",
    saving: "Saving…", channelSettingsSaved: "Channel settings saved.",
    channelPrivacySaved: "Channel privacy updated.",
    adminPermissionsSaved: "Administrator permissions updated.",
    invitationSettings: "Invitations", invitationHelp: "Create an invite link or add a member by username.",
    noInviteLink: "No invite link has been created yet.",
    rotateInviteLink: "Refresh link", administration: "Channel administration",
    createInviteLink: "Create link", copyInviteLink: "Copy link",
    revokeInviteLink: "Revoke link", linkCopied: "Link copied",
    usernamePlaceholder: "@username", makeAdmin: "Make administrator", removeAdmin: "Remove administrator",
    subscribers: "Subscribers", administrators: "Administrators",
    appearance: "Appearance", appearanceUnavailable: "Channel image and appearance settings are not supported yet.",
    publishing: "Publishing",
    postIdentityHelp: "Choose whose identity administrators use when publishing messages.",
    permissions: "Permissions",
    pinPostsUnavailable: "Pinning channel posts is not supported yet.",
    notifications: "Notifications", channelNotifications: "Channel activity notifications",
    channelNotificationsHelp: "This setting applies only to your account.",
    notAvailable: "This feature is not available yet.",
    ownerOnly: "Only the channel owner can change this setting.",
    managersOnly: "Only the owner and channel administrators can change this setting.",
    noAdministrators: "There are no channel administrators yet.",
    yourAdminPermissions: "Permissions assigned to you by the channel owner.",
    adminPermissionOptions: [
      { id: "publish", label: "Publish messages", description: "Allow sending messages and files to the channel." },
      { id: "editMessages", label: "Edit messages", description: "Allow editing channel messages, including those published by others." },
      { id: "deleteMessages", label: "Delete messages", description: "Allow deleting channel messages, including those published by others." }
    ],
    searchSubscribers: "Search subscribers", noMatchingSubscribers: "No subscribers found.",
    selectSubscriber: "Select a subscriber",
    confirmRemoveMember: "Remove this subscriber from the channel?",
    confirmRevokeInvite: "Revoke this link? Anyone who has it will no longer be able to join with it.",
    transferOwnershipHelp: "Transferring ownership gives the selected member full control of the channel.",
    confirmTransferOwnership: "Transfer ownership to the selected member?",
    confirmLeave: "Leave this channel?",
    deleteChannelHeading: "Delete channel",
    deleteChannelHelp: "The channel and its history will be deleted for everyone. This cannot be undone.",
    deleteChannel: "Delete channel",
    confirmDeleteChannel: "Delete this channel and its entire history for everyone? This cannot be undone.",
    transferOwnership: "Transfer ownership", leaveChat: "Leave chat", deleteChat: "Delete chat",
    roleOwner: "Owner", roleAdmin: "Administrator", roleMember: "Member",
    ownershipTransferred: "Ownership transferred.", chatDeleted: "Chat deleted.",
    chatInfo: "Chat information", searchChat: "Search chat", profile: "PROFILE",
    invalidMaterialsResponse: "The server returned an invalid materials list. Refresh the page and try again.",
    profileAvatar: "Image must be no larger than 5 MB.",
    avatarPickerTitle: "Profile photo", avatarPickerHint: "Choose an image up to 5 MB",
    chooseAvatar: "Choose photo", showOnline: "Show online status",
    hideNotificationContent: "Hide message text in notifications",
    noAbout: "This user hasn't added an about section yet.",
    noSharedChats: "No shared groups or channels yet.", noSharedMedia: "No shared media yet.",
    attachFiles: "Attach files", uploadFailed: "Unable to upload the file.",
    thumbnailFailed: "Unable to create a preview; the original was kept.",
    maxAttachments: "A message can have up to 10 attachments.",
    maxFileSize: "Files cannot exceed 100 MB.", muted: "Notifications muted",
    unmuted: "Notifications enabled", blockUser: "Block", unblockUser: "Unblock",
    writeToUser: "Message", muteChat: "Mute notifications", unmuteChat: "Unmute notifications",
    sharedChats: "Shared groups and channels", sharedGroup: "Group", sharedChannel: "Channel",
    sharedMedia: "Shared media", showAll: "Show all", showLess: "Show less",
    channelSettings: "Channel settings",
    tabMembers: "Members", tabMedia: "Media", tabFiles: "Files", tabLinks: "Links", preview: "Preview",
    openMessage: "Go to message", searchPromptChat: "Enter text to search",
    noResults: "No results found", download: "Download", cancelUpload: "Cancel upload",
    onlineStatus: "Online", lastSeen: "Last seen", registered: "Joined",
    offlineStatus: "Offline", blockedInfo: "This user is blocked.", profileSettingsSaved: "Profile updated."
  }
};

let messengerView = null;
let messageList = null;
const openDialogIds = new Set();
const controllerListeners = [];
let controllerInitialized = false;
let controllerSession = 0;
function listen(target, type, handler) {
  target.addEventListener(type, handler);
  controllerListeners.push(() => target.removeEventListener(type, handler));
}
function openDialog(id) {
  document.dispatchEvent(new CustomEvent("polus:open-dialog", { detail: { id } }));
}
function closeDialog(id) {
  document.dispatchEvent(new CustomEvent("polus:close-dialog", { detail: { id } }));
}
function isDialogOpen(id) {
  return openDialogIds.has(id);
}
let profilePreviewUrl = null;
let currentInfoTab = "members";
let chatInfoRequestId = 0;
let chatInfoState = null;
let sidebarSearchQuery = "";

let language = localStorage.getItem("polus-language") === "en" ? "en" : "ru";
let currentUser = null;
let currentConversation = null;
let channels = [];
let directs = [];
let messages = [];
let olderMessagesCursor = null;
let loadingOlderMessages = false;
let chatSearchTimer;
let chatSearchRequestId = 0;
let pushKey;

function t(key) {
  return translations[language][key] || translations.en[key] || key;
}

function setLanguage(value) {
  language = value === "en" ? "en" : "ru";
  localStorage.setItem("polus-language", language);
  window.dispatchEvent(new CustomEvent("polus:language-changed", { detail: { language } }));
}

function showError(element, message) {
  document.dispatchEvent(new CustomEvent("polus:form-error", {
    detail: { id: element.id, message: localizeError(message) }
  }));
}

function clearError(id) {
  document.dispatchEvent(new CustomEvent("polus:form-error-clear", { detail: { id } }));
}

function localizeError(message) {
  const knownErrors = {
    "Username must be 3–32 letters, numbers, or underscores.": "errUsername",
    "Username must be 3–32 Latin letters, numbers, or underscores.": "errUsername",
    "Display name must be 1–50 characters.": "errName",
    "About must be at most 200 characters.": "errAbout",
    "Password must be 8–128 characters.": "errPassword",
    "Passwords do not match.": "errPasswordMatch",
    "Please read and accept the privacy policy.": "errPrivacy",
    "That username is already taken.": "errTaken",
    "Incorrect username or password.": "errLogin",
    "Too many failed sign-in attempts. Try again in 15 minutes.": "errRateLimit",
    "Current password is incorrect.": "errCurrentPassword",
    "User not found.": "errNotFound",
    "You cannot message yourself.": "errSelf",
    "Channel name is too short.": "errChannelName",
    "Group name is too short.": "errGroupName",
    "Add between 2 and 199 other participants.": "errGroupUsers",
    "A group must have at least two other members.": "errGroupMembers",
    "One or more usernames were not found.": "errUsernames",
    "Write a message before sending.": "errEmptyMessage",
    "Message must contain 1–4000 characters.": "errMessageLength",
    "You can send at most 20 messages per minute.": "errMessageRate",
    "Messages can only be edited within 48 hours.": "messageEditExpired"
  };
  return knownErrors[message] ? t(knownErrors[message]) : message || t("errGeneric");
}

function notify(message) {
  document.dispatchEvent(new CustomEvent("polus:notify", { detail: message }));
}

function validateMaterialsResponse(response) {
  if (!response || !Array.isArray(response.items)
    || !Number.isSafeInteger(response.total) || response.total < 0
    || typeof response.hasMore !== "boolean"
    || (response.nextCursor !== null && typeof response.nextCursor !== "string"
      && typeof response.nextCursor !== "number")) {
    throw new Error(t("invalidMaterialsResponse"));
  }
  return response;
}

function jsonOptions(method, body) {
  return { method, body: JSON.stringify(body) };
}

function requestFromReact(eventName, detail) {
  return new Promise((resolve, reject) => {
    document.dispatchEvent(new CustomEvent(eventName, {
      detail: { ...detail, resolve, reject }
    }));
  });
}

function validateMessageHistory(history) {
  if (!history || !Array.isArray(history.messages)
    || typeof history.hasMore !== "boolean"
    || (history.nextCursor !== null && typeof history.nextCursor !== "string"
      && typeof history.nextCursor !== "number")) {
    throw new Error(t("errGeneric"));
  }
  return history;
}

function initials(name) {
  return Array.from(name.trim())[0]?.toLocaleUpperCase(language === "ru" ? "ru-RU" : "en-US") || "?";
}

function formatTime(value) {
  return new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-US", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatDay(value) {
  return new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-US", {
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(new Date(value));
}

function presenceLabel(user) {
  if (user.showOnlineStatus === false) return "";
  if (user.online) return t("onlineStatus");
  if (user.lastSeenAt) return `${t("lastSeen")}: ${formatDay(user.lastSeenAt)} ${formatTime(user.lastSeenAt)}`;
  return t("offlineStatus");
}

function messageDayKey(message) {
  const date = new Date(message.createdAt || message.sentAt);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function getConversation(id) {
  return channels.find((item) => item.id === id) || directs.find((item) => item.id === id);
}

function getTranslatedConversationName(conversation) {
  return conversation.type === "saved" ? t("savedMessages") : conversation.name;
}

function renderConversations() {
  const unreadCount = [...channels, ...directs].reduce((total, conversation) =>
    total + (Number.isSafeInteger(conversation.unreadCount) ? conversation.unreadCount : 0), 0);
  document.dispatchEvent(new CustomEvent("polus:account-unread-count", { detail: { unreadCount } }));
  window.dispatchEvent(new CustomEvent("polus:conversations-changed", {
    detail: {
      channels,
      directs,
      currentConversationId: currentConversation?.id || null,
      language
    }
  }));
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function renderMessages({
  preserveScroll = false,
  keepScrollTop = false,
  previousHeight = 0,
  previousTop = 0
} = {}) {
  closeMessageContextMenu();
  window.dispatchEvent(new CustomEvent("polus:messages-changed", {
    detail: {
      conversation: currentConversation,
      messages,
      currentUserId: currentUser?.id,
      olderMessagesCursor,
      loadingOlderMessages,
      scroll: keepScrollTop
        ? { mode: "top", previousTop }
        : preserveScroll
          ? { mode: "preserve", previousHeight, previousTop }
          : { mode: "bottom" }
    }
  }));
}

function handleMessageContextMenu(event) {
  const row = event.target instanceof Element ? event.target.closest("[data-message-id]") : null;
  if (!row || !currentConversation) return;
  const message = messages.find((item) => String(item.id) === row.dataset.messageId);
  if (!message || message.deleted) return;
  const ownMessage = message.authorId === currentUser.id || message.author?.id === currentUser.id;
  const canModerate = ["channel", "group"].includes(currentConversation.type)
    && ["owner", "admin"].includes(currentConversation.role);
  const canEdit = currentConversation.joined !== false && ownMessage
    && Date.now() - Date.parse(message.createdAt || message.sentAt) <= 48 * 60 * 60 * 1000;
  const canDelete = currentConversation.joined !== false && (ownMessage || canModerate);
  const canSave = currentConversation.type !== "saved";
  const canReply = currentConversation.joined !== false
    && (currentConversation.type !== "channel" || canModerate);
  const canForward = true;
  if (!canEdit && !canDelete && !canSave && !canReply && !canForward) return;
  event.preventDefault();
  openMessageContextMenu(event.clientX, event.clientY, message, {
    canEdit, canDelete, canSave, canReply, canForward, canReact: currentConversation.joined !== false
  });
}

function closeMessageContextMenu() {
  document.dispatchEvent(new CustomEvent("polus:message-context-menu-close"));
}

function openMessageContextMenu(x, y, message, permissions) {
  document.dispatchEvent(new CustomEvent("polus:message-context-menu-open", {
    detail: { x, y, message, ...permissions }
  }));
}

async function openMediaViewer(attachmentId) {
  const mediaResponse = validateMaterialsResponse(
    await api(`/api/chats/${encodeURIComponent(currentConversation.id)}/materials?kind=media`)
  );
  const index = mediaResponse.items.findIndex((item) => item.id === attachmentId);
  if (index < 0) return;
  document.dispatchEvent(new CustomEvent("polus:media-viewer-open", {
    detail: { items: mediaResponse.items, index }
  }));
  openDialog("media-viewer");
}

function formatFileSize(size) {
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB"];
  let value = size / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function updateConversationHeader(conversation) {
  window.dispatchEvent(new CustomEvent("polus:conversation-header-changed", {
    detail: { conversation, language }
  }));
  if (!conversation) {
    document.dispatchEvent(new CustomEvent("polus:composer-state", {
      detail: { visible: true, enabled: false, conversation: null }
    }));
    return;
  }
  const canPost = conversation.type !== "channel"
    || conversation.joined !== false && ["owner", "admin"].includes(conversation.role);
  const isChannelPreview = conversation.type === "channel" && conversation.joined === false;
  document.dispatchEvent(new CustomEvent("polus:composer-state", {
    detail: {
      visible: canPost || isChannelPreview,
      enabled: canPost,
      conversation
    }
  }));
}

async function openChatInfo(tab = currentInfoTab) {
  if (!currentConversation || currentConversation.pending) return;
  currentInfoTab = tab;
  const requestId = ++chatInfoRequestId;
  const conversation = currentConversation;
  const tabs = [
    "media",
    ...(conversation.joined !== false ? ["files"] : []),
    "links"
  ];
  const selectedTab = tabs.includes(tab) ? tab : tabs[0];
  const tabResponses = {};
  try {
    await Promise.all(tabs.map(async (tabName) => {
      const tabQuery = new URLSearchParams({ kind: tabName });
      tabResponses[tabName] = validateMaterialsResponse(
        await api(`/api/chats/${encodeURIComponent(conversation.id)}/materials?${tabQuery}`)
      );
    }));
  } catch (error) {
    notify(localizeError(error.message));
    return;
  }
  if (requestId !== chatInfoRequestId || currentConversation?.id !== conversation.id) return;
  if (conversation.type === "channel") {
    document.dispatchEvent(new CustomEvent("polus:chat-management-changed", { detail: null }));
  } else {
    await openChatManagement();
  }
  if (requestId !== chatInfoRequestId || currentConversation?.id !== conversation.id) return;
  chatInfoState = { conversation, tabs, responses: tabResponses, selectedTab, loadingMore: false };
  publishChatInfo();
  openDialog("chat-info-dialog");
}

function publishChatInfo() {
  if (!chatInfoState) return;
  const { conversation, tabs, responses, selectedTab, loadingMore } = chatInfoState;
  const roleLabel = (role) => t(`role${role[0].toUpperCase()}${role.slice(1)}`);
  const response = responses[selectedTab];
  const items = response.items.map((item) => ({
    ...item,
    roleLabel: item.role ? roleLabel(item.role) : "",
    presence: item.role ? presenceLabel(item) : "",
    createdAtLabel: item.createdAt ? formatDay(item.createdAt) : "",
    sizeLabel: item.size === undefined ? "" : formatFileSize(item.size),
    displayDetail: selectedTab === "links"
      ? `${item.domain} · @${item.author?.username || ""} · ${item.createdAt ? formatDay(item.createdAt) : ""}`
      : `${formatFileSize(item.size)} · @${item.author?.username || ""} · ${item.createdAt ? formatDay(item.createdAt) : ""}`
  }));
  document.dispatchEvent(new CustomEvent("polus:chat-info-changed", {
    detail: {
      chatName: getTranslatedConversationName(conversation),
      chatType: conversation.type,
      conversationId: conversation.id,
      avatarUrl: conversation.avatarUrl || null,
      description: conversation.description || "",
      memberCount: conversation.memberIds?.length || 0,
      canManageChannel: conversation.type === "channel"
        && (["owner", "admin"].includes(conversation.role)
          || conversation.ownerId === currentUser?.id
          || conversation.createdBy === currentUser?.id
          || conversation.adminIds?.includes(currentUser?.id)),
      selectedTab,
      tabs: tabs.map((kind) => ({
        kind,
        label: t(`tab${kind[0].toUpperCase()}${kind.slice(1)}`),
        total: responses[kind].total
      })),
      response: { ...response, items },
      canView: Boolean(conversation.joined),
      canMute: Boolean(conversation.joined) && conversation.type !== "saved",
      muted: Boolean(conversation.muted),
      loadingMore,
      labels: {
        members: t("tabMembers"),
        memberCountUnit: t("members"),
        channelSettings: t("channelSettings"),
        groupSettings: t("groupSettings"),
        media: t("tabMedia"),
        files: t("tabFiles"),
        links: t("tabLinks"),
        noResults: t("noResults"),
        openMessage: t("openMessage"),
        download: t("download"),
        loadOlderMessages: t("loadOlderMessages"),
        muteChat: t("muteChat"),
        unmuteChat: t("unmuteChat"),
        loading: language === "ru" ? "Загрузка…" : "Loading…"
      }
    }
  }));
}

async function loadMoreChatInfo(kind, cursor) {
  const state = chatInfoState;
  if (!state || state.selectedTab !== kind || state.loadingMore) return;
  state.loadingMore = true;
  publishChatInfo();
  try {
    const query = new URLSearchParams({ kind, before: String(cursor) });
    const next = validateMaterialsResponse(
      await api(`/api/chats/${encodeURIComponent(state.conversation.id)}/materials?${query}`)
    );
    if (chatInfoState !== state || currentConversation?.id !== state.conversation.id) return;
    const previous = state.responses[kind];
    state.responses[kind] = {
      ...next,
      total: previous.total,
      items: [...previous.items, ...next.items]
    };
  } catch (error) {
    notify(localizeError(error.message));
  } finally {
    if (chatInfoState === state) {
      state.loadingMore = false;
      publishChatInfo();
    }
  }
}

async function toggleChatMute(mute, { conversation = currentConversation, refreshInfo = true } = {}) {
  if (!conversation) return;
  const method = mute ? "POST" : "DELETE";
  const result = await api(`/api/chats/${encodeURIComponent(conversation.id)}/mute`, { method });
  conversation.muted = result.muted;
  for (const item of [...directs, ...channels]) {
    if (item.id === conversation.id) item.muted = result.muted;
  }
  notify(t(result.muted ? "muted" : "unmuted"));
  if (refreshInfo && currentConversation?.id === conversation.id) await openChatInfo(currentInfoTab);
}

async function jumpToMessage(messageId) {
  if (!currentConversation) return;
  const conversationId = currentConversation.id;
  while (messages.length && messages[0].id > messageId) {
    const before = messages[0].id;
    const history = validateMessageHistory(await requestFromReact("polus:load-message-history", {
      conversationId,
      before
    }));
    if (currentConversation?.id !== conversationId) return;
    if (!history.messages.length) break;
    const olderMessages = await Promise.all(history.messages.reverse()
      .map((message) => decryptMessagePayload(currentUser.id, message)));
    messages = [...olderMessages, ...messages];
    if (!history.hasMore) olderMessagesCursor = null;
    else olderMessagesCursor = history.nextCursor;
  }
  renderMessages();
  const row = messageList.querySelector(`[data-message-id="${CSS.escape(String(messageId))}"]`);
  if (!row) {
    notify(t("noResults"));
    return;
  }
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  row.classList.add("is-highlighted");
  setTimeout(() => row.classList.remove("is-highlighted"), 1800);
}

async function searchChat(queryValue) {
  const requestId = ++chatSearchRequestId;
  const query = queryValue.trim();
  if (query.length < 2) {
    document.dispatchEvent(new CustomEvent("polus:chat-search-results", {
      detail: { results: [], message: t("searchPromptChat") }
    }));
    return;
  }
  const normalizedQuery = query.toLocaleLowerCase();
  const results = messages
    .filter((message) => !message.deleted && message.text?.toLocaleLowerCase().includes(normalizedQuery))
    .map((message) => ({
      id: message.id,
      author: message.author || { fullName: currentUser.fullName },
      text: message.text,
      createdAt: message.createdAt || message.sentAt
    }));
  if (requestId !== chatSearchRequestId) return;
  document.dispatchEvent(new CustomEvent("polus:chat-search-results", {
    detail: { results, message: results.length ? "" : t("noResults") }
  }));
}

<<<<<<< Updated upstream
async function openUserProfile(username) {
  if (username.toLowerCase() === currentUser.username.toLowerCase()) {
    closeDialog("profile-view-dialog");
    document.dispatchEvent(new CustomEvent("polus:open-own-profile"));
    return;
=======
async function loadUserProfile(username) {
  let response;
  try {
    response = await api(`/api/users/${encodeURIComponent(username)}/profile`);
  } catch (error) {
    document.dispatchEvent(new CustomEvent("polus:user-profile-error", {
      detail: { username, message: localizeError(error.message) }
    }));
    throw error;
>>>>>>> Stashed changes
  }
  const { user: target, sharedChats, sharedMedia, canMessage } = response;
  const targetDirect = [currentConversation, ...directs].find((chat) =>
    chat && !chat.pending && chat.type === "direct" && chat.memberIds?.includes(target.id));
  document.dispatchEvent(new CustomEvent("polus:user-profile-changed", {
    detail: {
      user: target,
      sharedChats,
      sharedMedia,
      canMessage,
      status: presenceLabel(target),
      registered: target.createdAt ? formatDay(target.createdAt) : "",
      muted: targetDirect ? targetDirect.muted : null,
      labels: {
        writeToUser: t("writeToUser"),
        addContact: t("addContact"),
        removeContact: t("removeContact"),
        contactAdded: t("contactAdded"),
        contactRemoved: t("contactRemoved"),
        addToGroup: t("addToGroup"),
        inviteToChannel: t("inviteToChannel"),
        blockUser: t("blockUser"),
        unblockUser: t("unblockUser"),
        muteChat: t("muteChat"),
        unmuteChat: t("unmuteChat"),
        about: t("aboutOptional"),
        noAbout: t("noAbout"),
        registered: t("registered"),
        sharedChats: t("sharedChats"),
        sharedGroup: t("sharedGroup"),
        sharedChannel: t("sharedChannel"),
        showAll: t("showAll"),
        showLess: t("showLess"),
        noSharedChats: t("noSharedChats"),
        sharedMedia: t("sharedMedia"),
        noSharedMedia: t("noSharedMedia")
      }
    }
  }));
}

async function openUserProfile(username) {
  const path = `/users/${encodeURIComponent(username)}`;
  if (window.location.pathname !== path) {
    window.history.pushState({ polusPage: true, polusUserProfile: true }, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
  await loadUserProfile(username);
}

async function markConversationRead(conversation) {
  if (conversation.type === "saved" || conversation.pending || document.visibilityState !== "visible"
    || conversation.type === "channel" && conversation.joined === false
    || currentConversation?.id !== conversation.id || !isMessageListAtBottom()) return;
  const latestDisplayedId = messages.at(-1)?.id || 0;
  if (!conversation.unreadCount && latestDisplayedId <= (conversation.lastReadMessageId || 0)) return;
  conversation.unreadCount = 0;
  renderConversations();
  try {
    const result = await requestFromReact("polus:mark-conversation-read", {
      conversationId: conversation.id
    });
    conversation.lastReadMessageId = result.lastReadMessageId;
  } catch (error) {
    if (error.status !== 401) notify(localizeError(error.message));
  }
}

function isMessageListAtBottom() {
  return messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight < 80;
}

async function openConversation(conversation) {
  messengerView.classList.add("chat-open");
  currentConversation = conversation;
  messages = [];
  olderMessagesCursor = null;
  loadingOlderMessages = false;
  updateConversationHeader(conversation);
  renderConversations();
  renderMessages();
  if (!conversation.pending) {
    try {
      const history = validateMessageHistory(await requestFromReact("polus:load-message-history", {
        conversationId: conversation.id
      }));
      if (currentConversation?.id !== conversation.id) return;
      messages = await Promise.all(history.messages.reverse()
        .map((message) => decryptMessagePayload(currentUser.id, message)));
      olderMessagesCursor = history.nextCursor;
      renderMessages();
      if (document.visibilityState === "visible") await markConversationRead(conversation);
    } catch (error) {
      notify(localizeError(error.message));
    }
  }
  if (window.history?.replaceState) {
    const target = new URL(window.location.href);
    target.searchParams.set("conversation", conversation.id);
    window.history.replaceState({}, "", target);
  }
}

async function loadOlderMessages() {
  if (!currentConversation || !olderMessagesCursor || loadingOlderMessages) return;
  loadingOlderMessages = true;
  const previousHeight = messageList.scrollHeight;
  const previousTop = messageList.scrollTop;
  const conversationId = currentConversation.id;
  renderMessages();
  try {
    const history = validateMessageHistory(await requestFromReact("polus:load-message-history", {
      conversationId,
      before: olderMessagesCursor
    }));
    if (currentConversation?.id !== conversationId) return;
    if (history.messages.length === 0) {
      olderMessagesCursor = null;
      return;
    }
    const olderMessages = await Promise.all(history.messages.reverse()
      .map((message) => decryptMessagePayload(currentUser.id, message)));
    messages = [...olderMessages, ...messages]
      .sort((left, right) => left.id - right.id);
    olderMessagesCursor = history.nextCursor;
  } catch (error) {
    notify(localizeError(error.message));
  } finally {
    loadingOlderMessages = false;
    if (currentConversation?.id === conversationId) {
      renderMessages({ preserveScroll: true, previousHeight, previousTop });
    }
  }
}

function setUser(user) {
  currentUser = user;
  document.dispatchEvent(new CustomEvent("polus:current-user-changed", { detail: user }));
  renderProfileAvatarPreview(user);
}

function renderProfileAvatarPreview(user, src = user.avatarUrl) {
  document.dispatchEvent(new CustomEvent("polus:profile-avatar-preview-changed", {
    detail: { user, previewUrl: src === user.avatarUrl ? "" : src, fileName: "" }
  }));
}

function prepareOwnProfile() {
  if (profilePreviewUrl) URL.revokeObjectURL(profilePreviewUrl);
  profilePreviewUrl = null;
  document.dispatchEvent(new CustomEvent("polus:prepare-profile"));
}

async function updateProfileAvatarPreview(file) {
  if (profilePreviewUrl) URL.revokeObjectURL(profilePreviewUrl);
  profilePreviewUrl = null;
  if (!file) {
    renderProfileAvatarPreview(currentUser);
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    document.dispatchEvent(new CustomEvent("polus:profile-avatar-clear"));
    renderProfileAvatarPreview(currentUser);
    notify(t("profileAvatar"));
    return;
  }
  document.dispatchEvent(new CustomEvent("polus:profile-avatar-preview-changed", {
    detail: { user: currentUser, previewUrl: "", fileName: file.name }
  }));
  try {
    const cropped = await cropAvatar(file);
    profilePreviewUrl = URL.createObjectURL(cropped);
    document.dispatchEvent(new CustomEvent("polus:profile-avatar-preview-changed", {
      detail: { user: currentUser, previewUrl: profilePreviewUrl, fileName: file.name }
    }));
  } catch (error) {
    renderProfileAvatarPreview(currentUser);
    notify(localizeError(error.message));
  }
}

async function loadMessenger(session) {
  const data = await api("/api/bootstrap");
  if (session !== controllerSession) return;
  setUser(data.user);
  const [nextChannels, nextDirects] = await Promise.all([
    Promise.all(data.channels.map(async (conversation) => ({
      ...conversation,
      ...(conversation.lastMessage
        ? { lastMessage: await decryptMessagePayload(data.user.id, conversation.lastMessage) }
        : {})
    }))),
    Promise.all(data.directs.map(async (conversation) => ({
      ...conversation,
      ...(conversation.lastMessage
        ? { lastMessage: await decryptMessagePayload(data.user.id, conversation.lastMessage) }
        : {})
    })))
  ]);
  if (session !== controllerSession) return;
  channels = nextChannels;
  directs = nextDirects;
  pushKey = data.vapidPublicKey;
  renderConversations();
  if ("serviceWorker" in navigator && window.isSecureContext) {
    try {
      await navigator.serviceWorker.register("/sw.js");
    } catch (error) {
      console.error("Service worker registration failed:", error);
    }
  }
  if (session !== controllerSession) return;
  const requestedId = new URLSearchParams(location.search).get("conversation");
  const first = getConversation(requestedId) || channels.find((channel) => channel.joined) || directs[0];
  if (first) await openConversation(first);
  if (session !== controllerSession) return;
  if (!getConversation(requestedId)) messengerView.classList.remove("chat-open");
  document.dispatchEvent(new CustomEvent("polus:connect-realtime"));
}

async function receiveMessage(message) {
  message = await decryptMessagePayload(currentUser.id, message);
  let conversation = getConversation(message.conversationId);
  let fetchedConversation = false;
  if (!conversation) {
    await refreshMessengerState();
    conversation = getConversation(message.conversationId);
    fetchedConversation = true;
  }
  if (!conversation) return;
  if (conversation.type === "saved") conversation.unreadCount = 0;
  if (currentConversation?.pending
    && (message.author.id === currentUser.id || currentConversation.username === message.author.username)) {
    currentConversation = conversation;
    updateConversationHeader(conversation);
    messages = [];
  }
  conversation.lastMessage = message;
  if (currentConversation?.id === message.conversationId) {
    const wasAtBottom = document.visibilityState === "visible" && isMessageListAtBottom();
    const previousHeight = messageList.scrollHeight;
    const previousTop = messageList.scrollTop;
    if (!messages.some((item) => item.id === message.id)) {
      messages.push(message);
      messages.sort((left, right) => left.id - right.id);
    }
    renderMessages(wasAtBottom ? {} : { keepScrollTop: true, previousTop, previousHeight });
    if (wasAtBottom) {
      void markConversationRead(conversation);
    } else if (conversation.type !== "saved" && conversation.joined !== false
      && message.authorId !== currentUser.id) {
      conversation.unreadCount = (conversation.unreadCount || 0) + 1;
      renderConversations();
    }
  } else {
    const incoming = message.authorId !== currentUser.id;
    if (conversation.type !== "saved" && conversation.joined !== false && incoming && !fetchedConversation) {
      conversation.unreadCount = (conversation.unreadCount || 0) + 1;
    }
    if (conversation.type !== "saved" && conversation.joined !== false && incoming) {
      notify(`${t("messageArrived")} @${message.author.username}`);
    }
    renderConversations();
  }
}

async function refreshMessengerState() {
  const data = await api("/api/bootstrap");
  [channels, directs] = await Promise.all([
    Promise.all(data.channels.map(async (conversation) => ({
      ...conversation,
      ...(conversation.lastMessage
        ? { lastMessage: await decryptMessagePayload(data.user.id, conversation.lastMessage) }
        : {})
    }))),
    Promise.all(data.directs.map(async (conversation) => ({
      ...conversation,
      ...(conversation.lastMessage
        ? { lastMessage: await decryptMessagePayload(data.user.id, conversation.lastMessage) }
        : {})
    })))
  ]);
  const updatedConversation = currentConversation && getConversation(currentConversation.id);
  if (updatedConversation) {
    currentConversation = updatedConversation;
    if (updatedConversation.type === "channel" && updatedConversation.postAs !== "channel") {
      messages = messages.map((message) => {
        if (!message.displayAuthor) return message;
        const { displayAuthor, ...personMessage } = message;
        return personMessage;
      });
    }
    updateConversationHeader(updatedConversation);
  } else if (currentConversation && !currentConversation.pending) {
    currentConversation = null;
    messengerView.classList.remove("chat-open");
    messages = [];
    updateConversationHeader(null);
    closeDialog("chat-info-dialog");
    const target = new URL(window.location.href);
    target.searchParams.delete("conversation");
    window.history?.replaceState({}, "", target);
  }
  renderConversations();
  renderMessages();
}

async function resyncRealtimeState() {
  await refreshMessengerState();
  const conversation = currentConversation;
  if (!conversation || conversation.pending) return;
  const history = validateMessageHistory(await requestFromReact("polus:load-message-history", {
    conversationId: conversation.id
  }));
  if (currentConversation?.id !== conversation.id) return;
  messages = await Promise.all(history.messages.reverse()
    .map((message) => decryptMessagePayload(currentUser.id, message)));
  olderMessagesCursor = history.nextCursor;
  loadingOlderMessages = false;
  renderMessages();
  if (document.visibilityState === "visible") await markConversationRead(conversation);
}

async function applySentMessage({ sent, conversation: submittedConversation } = {}) {
  if (!sent || !submittedConversation) return;
  sent = await decryptMessagePayload(currentUser.id, sent);
  const isPendingConversation = Boolean(submittedConversation.pending);
  const sentConversation = isPendingConversation ? sent.conversation : null;
  if (sentConversation) {
    sentConversation.lastMessage = sent;
    const existingIndex = directs.findIndex((conversation) => conversation.id === sentConversation.id);
    if (existingIndex < 0) directs.unshift(sentConversation);
    else directs[existingIndex] = sentConversation;
    if (currentConversation?.id === submittedConversation.id) {
      currentConversation = sentConversation;
      olderMessagesCursor = null;
      updateConversationHeader(sentConversation);
      await markConversationRead(sentConversation);
      const target = new URL(window.location.href);
      target.searchParams.set("conversation", sentConversation.id);
      window.history?.replaceState({}, "", target);
    }
  } else {
    const conversation = getConversation(submittedConversation.id);
    if (conversation) conversation.lastMessage = sent;
    if (currentConversation?.id === submittedConversation.id) currentConversation.lastMessage = sent;
  }
  if (currentConversation?.id === (sentConversation?.id || submittedConversation.id)) {
    if (!messages.some((message) => message.id === sent.id)) messages.push(sent);
    messages.sort((left, right) => left.id - right.id);
    renderMessages();
  }
  renderConversations();
}

async function saveMessageToFavorites(message) {
  if (!message || currentConversation?.type === "saved") return;
  const savedConversationId = `saved_${currentUser.id}`;
  const recipients = await getOwnEncryptionPublicKey();
  const encryptedText = await encryptMessagePayload(currentUser.id, [recipients], savedConversationId, {
    text: message.text || "",
    mediaType: message.mediaType || null,
    attachments: (message.attachments || []).map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      mimeType: attachment.mimeType,
      size: attachment.size,
      encrypted: attachment.encrypted === true,
      ...(attachment.encryption || {})
    }))
  });
  const savedResult = await api(`/api/messages/${encodeURIComponent(message.id)}/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ encrypted: true, text: encryptedText })
  });
  const saved = await decryptMessagePayload(currentUser.id, savedResult);
  let conversation = directs.find((item) => item.id === saved.conversation.id);
  if (!conversation) {
    conversation = saved.conversation;
    directs.unshift(conversation);
  }
  conversation.lastMessage = saved;
  conversation.unreadCount = 0;
  if (currentConversation?.id === conversation.id) {
    currentConversation.lastMessage = saved;
    if (!messages.some((item) => item.id === saved.id)) messages.push(saved);
    messages.sort((left, right) => left.id - right.id);
    renderMessages();
  }
  renderConversations();
  notify(t("savedMessageSaved"));
}

async function applyMessageMutation(message) {
  if (!message) return;
  message = await decryptMessagePayload(currentUser.id, message);
  const index = messages.findIndex((item) => item.id === message.id);
  if (index >= 0) {
    const wasAtBottom = isMessageListAtBottom();
    const previousTop = messageList.scrollTop;
    messages = messages.map((item) => item.id === message.id ? message : item);
    renderMessages(wasAtBottom ? {} : { keepScrollTop: true, previousTop });
  }
  const conversation = getConversation(message.conversationId);
  if (conversation?.lastMessage?.id === message.id) {
    conversation.lastMessage = message;
    renderConversations();
  }
}

async function openChatManagement(chatId = currentConversation?.id, requireCurrent = true) {
  const selectedChat = getConversation(chatId);
  if (!chatId || (requireCurrent
    && (!selectedChat || !["channel", "group"].includes(selectedChat.type) || selectedChat.pending))) {
    document.dispatchEvent(new CustomEvent("polus:chat-management-changed", { detail: null }));
    return;
  }
  try {
    const { chat, inviteUrl, members: chatMembers, adminPermissions } =
      await api(`/api/chats/${encodeURIComponent(chatId)}`);
    if (requireCurrent && currentConversation?.id !== chatId) return;
    document.dispatchEvent(new CustomEvent("polus:chat-management-changed", {
      detail: {
        chat: { ...chat, inviteUrl },
        adminPermissions,
        members: chatMembers.map((member) => ({
          ...member,
          roleLabel: t(`role${member.role[0].toUpperCase()}${member.role.slice(1)}`)
        })),
        currentUserId: currentUser.id,
        labels: {
          chatMembers: t("chatMembers"),
          groupManagement: t("groupManagement"),
          groupDetails: t("groupDetails"),
          groupDescription: t("groupDescription"),
          groupName: t("groupName"),
          saveGroupDetails: t("saveGroupDetails"),
          groupSettingsSaved: t("groupSettingsSaved"),
          groupPrivacy: t("groupPrivacy"),
          publicGroup: t("publicGroup"),
          privateGroup: t("privateGroup"),
          groupAdministrators: t("groupAdministrators"),
          searchGroupMembers: t("searchGroupMembers"),
          noGroupMembers: t("noGroupMembers"),
          noGroupAdmins: t("noGroupAdmins"),
          confirmRemoveGroupMember: t("confirmRemoveGroupMember"),
          confirmLeaveGroup: t("confirmLeaveGroup"),
          groupTransferOwnershipHelp: t("groupTransferOwnershipHelp"),
          confirmTransferGroupOwnership: t("confirmTransferGroupOwnership"),
          deleteGroupHeading: t("deleteGroupHeading"),
          deleteGroupHelp: t("deleteGroupHelp"),
          deleteGroup: t("deleteGroup"),
          confirmDeleteGroup: t("confirmDeleteGroup"),
          makeAdmin: t("makeAdmin"),
          removeAdmin: t("removeAdmin"),
          remove: t("remove"),
          channelPostIdentity: t("channelPostIdentity"),
          channelPrivacy: t("channelPrivacy"),
          publicChannel: t("publicChannel"),
          privateChannel: t("privateChannel"),
          inviteLink: t("inviteLink"),
          createInviteLink: t("createInviteLink"),
          copyInviteLink: t("copyInviteLink"),
          revokeInviteLink: t("revokeInviteLink"),
          postAsPerson: t("postAsPerson"),
          postAsChannel: t("postAsChannel"),
          usernamePlaceholder: t("usernamePlaceholder"),
          inviteMember: t("inviteMember"),
          channelDetails: t("channelDetails"),
          channelName: t("channelName"),
          channelDescription: t("channelDescription"),
          saveChannelDetails: t("saveChannelDetails"),
          saving: t("saving"),
          invitationSettings: t("invitationSettings"),
          invitationHelp: t("invitationHelp"),
          linkCopied: t("linkCopied"),
          noInviteLink: t("noInviteLink"),
          rotateInviteLink: t("rotateInviteLink"),
          administration: t("administration"),
          subscribers: t("subscribers"),
          administrators: t("administrators"),
          appearance: t("appearance"),
          appearanceUnavailable: t("appearanceUnavailable"),
          publishing: t("publishing"),
          postIdentityHelp: t("postIdentityHelp"),
          permissions: t("permissions"),
          pinPostsUnavailable: t("pinPostsUnavailable"),
          notifications: t("notifications"),
          channelNotifications: t("channelNotifications"),
          channelNotificationsHelp: t("channelNotificationsHelp"),
          notAvailable: t("notAvailable"),
          ownerOnly: t("ownerOnly"),
          managersOnly: t("managersOnly"),
          noAdministrators: t("noAdministrators"),
          yourAdminPermissions: t("yourAdminPermissions"),
          adminPermissionOptions: t("adminPermissionOptions"),
          searchSubscribers: t("searchSubscribers"),
          noMatchingSubscribers: t("noMatchingSubscribers"),
          selectSubscriber: t("selectSubscriber"),
          confirmRemoveMember: t("confirmRemoveMember"),
          confirmRevokeInvite: t("confirmRevokeInvite"),
          transferOwnershipHelp: t("transferOwnershipHelp"),
          confirmTransferOwnership: t("confirmTransferOwnership"),
          confirmLeave: t("confirmLeave"),
          deleteChannelHeading: t("deleteChannelHeading"),
          deleteChannelHelp: t("deleteChannelHelp"),
          deleteChannel: t("deleteChannel"),
          confirmDeleteChannel: t("confirmDeleteChannel"),
          transferOwnership: t("transferOwnership"),
          deleteChat: t("deleteChat"),
          leaveChat: t("leaveChat")
        }
      }
    }));
  } catch (error) {
    document.dispatchEvent(new CustomEvent("polus:chat-management-changed", { detail: null }));
    notify(localizeError(error.message));
  }
}

async function handleChatManagementAction({ action, chatId, memberId, makeAdmin, postAs, isPrivate, isPublic, muted, permissions, username, name, description }) {
  const selectedChat = currentConversation;
  const settingsPageOpen = window.location.pathname === `/channels/${encodeURIComponent(chatId)}/settings`
    || window.location.pathname === `/groups/${encodeURIComponent(chatId)}/settings`;
  const groupSettingsPageOpen = window.location.pathname === `/groups/${encodeURIComponent(chatId)}/settings`;
  if ((!selectedChat || selectedChat.id !== chatId || !["channel", "group"].includes(selectedChat.type))
    && !settingsPageOpen) {
    closeDialog("chat-info-dialog");
    return;
  }
  const refreshDialog = async () => {
    await refreshMessengerState();
    if (settingsPageOpen) {
      await openChatManagement(chatId, false);
    } else if (currentConversation?.id === chatId) await openChatInfo(currentInfoTab);
    else closeDialog("chat-info-dialog");
  };
  try {
    if (action === "toggle-admin") {
      await api(`/api/chats/${encodeURIComponent(chatId)}/admins/${encodeURIComponent(memberId)}`,
        jsonOptions("PUT", { role: makeAdmin ? "admin" : "member" }));
      await refreshDialog();
    } else if (action === "set-admin-permissions") {
      await api(`/api/chats/${encodeURIComponent(chatId)}/admins/${encodeURIComponent(memberId)}`,
        jsonOptions("PUT", { permissions }));
      await refreshDialog();
      notify(t("adminPermissionsSaved"));
    } else if (action === "remove-member") {
      await api(`/api/chats/${encodeURIComponent(chatId)}/members/${encodeURIComponent(memberId)}`,
        { method: "DELETE" });
      await refreshDialog();
    } else if (action === "set-post-identity") {
      await api(`/api/chats/${encodeURIComponent(chatId)}/settings`, jsonOptions("PUT", { postAs }));
      await refreshDialog();
      notify(t("postIdentitySaved"));
    } else if (action === "set-channel-privacy") {
      await api(`/api/chats/${encodeURIComponent(chatId)}/settings`, jsonOptions("PUT", { isPrivate }));
      await refreshDialog();
      notify(t("channelPrivacySaved"));
    } else if (action === "save-channel-details") {
      await api(`/api/chats/${encodeURIComponent(chatId)}/settings`, jsonOptions("PUT", { name, description }));
      await refreshDialog();
      notify(t("channelSettingsSaved"));
    } else if (action === "save-group-details") {
      await api(`/api/chats/${encodeURIComponent(chatId)}/settings`, jsonOptions("PUT", { name, description }));
      await refreshDialog();
      notify(t("groupSettingsSaved"));
    } else if (action === "set-group-privacy") {
      await api(`/api/chats/${encodeURIComponent(chatId)}/settings`, jsonOptions("PUT", { isPublic }));
      await refreshDialog();
      notify(t("groupSettingsSaved"));
    } else if (action === "toggle-channel-notifications") {
      const result = await api(`/api/chats/${encodeURIComponent(chatId)}/mute`, {
        method: muted ? "POST" : "DELETE"
      });
      await refreshDialog();
      notify(t(result.muted ? "muted" : "unmuted"));
    } else if (action === "create-invite-link") {
      await api(`/api/chats/${encodeURIComponent(chatId)}/invite`, { method: "POST" });
      await refreshDialog();
    } else if (action === "revoke-invite-link") {
      await api(`/api/chats/${encodeURIComponent(chatId)}/invite`, { method: "DELETE" });
      await refreshDialog();
    } else if (action === "invite-member") {
      await api(`/api/chats/${encodeURIComponent(chatId)}/members`, jsonOptions("POST", { username }));
      await refreshDialog();
    } else if (action === "transfer-ownership") {
      await api(`/api/chats/${encodeURIComponent(chatId)}/owner`, jsonOptions("PUT", { username }));
      await refreshDialog();
      notify(t("ownershipTransferred"));
    } else if (action === "delete-chat") {
      const confirmMessage = selectedChat?.type === "group" || groupSettingsPageOpen
        ? t("confirmDeleteGroup")
        : t("confirmDeleteChannel");
      if (!window.confirm(confirmMessage)) {
        if (settingsPageOpen) await openChatManagement(chatId, false);
        else await openChatInfo(currentInfoTab);
        return;
      }
      await api(`/api/chats/${encodeURIComponent(chatId)}`, { method: "DELETE" });
      closeDialog("chat-info-dialog");
      await refreshMessengerState();
      if (groupSettingsPageOpen) document.dispatchEvent(new CustomEvent("polus:exit-group-settings"));
      else if (settingsPageOpen) document.dispatchEvent(new CustomEvent("polus:profile-page-back"));
      notify(t("chatDeleted"));
    } else if (action === "leave-chat") {
      await api(`/api/chats/${encodeURIComponent(chatId)}/leave`, { method: "POST" });
      closeDialog("chat-info-dialog");
      await refreshMessengerState();
      if (groupSettingsPageOpen) document.dispatchEvent(new CustomEvent("polus:exit-group-settings"));
      else if (settingsPageOpen) document.dispatchEvent(new CustomEvent("polus:profile-page-back"));
    }
  } catch (error) {
    notify(localizeError(error.message));
    if (settingsPageOpen) await openChatManagement(chatId, false);
    else if (currentConversation?.id === chatId) await openChatInfo(currentInfoTab);
  }
}

async function signOut() {
  try {
    document.dispatchEvent(new CustomEvent("polus:presence-stop"));
    const registration = "serviceWorker" in navigator && window.isSecureContext
      ? await navigator.serviceWorker.ready
      : null;
    const subscription = registration ? await registration.pushManager.getSubscription() : null;
    await api("/api/auth/logout", jsonOptions("POST", {
      pushEndpoint: subscription?.endpoint || ""
    }));
    setPushEnabled(false);
    currentUser = null;
    document.dispatchEvent(new CustomEvent("polus:current-user-changed", { detail: null }));
    currentConversation = null;
    messengerView.classList.remove("chat-open");
    channels = [];
    directs = [];
    messages = [];
    document.dispatchEvent(new CustomEvent("polus:session-signed-out"));
  } catch (error) {
    notify(localizeError(error.message));
  }
}

function decodeBase64Url(value) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const raw = atob(value.replace(/-/g, "+").replace(/_/g, "/") + padding);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

async function togglePushNotifications() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    notify(t("unavailablePush"));
    return;
  }
  if (!window.isSecureContext) {
    notify(t("secureRequired"));
    return;
  }
  try {
    const permissionPromise = Notification.permission === "default"
      ? Notification.requestPermission()
      : Promise.resolve(Notification.permission);
    const registration = await navigator.serviceWorker.ready;
    const current = await registration.pushManager.getSubscription();
    if (current && getPushPreference() !== false) {
      await api("/api/push/subscribe", jsonOptions("DELETE", { endpoint: current.endpoint }));
      setPushEnabled(false);
      savePushPreference(false);
      notify(t("pushDisabled"));
      return;
    }
    if (Notification.permission === "denied") {
      notify(t("permissionDenied"));
      return;
    }
    const permission = await permissionPromise;
    if (permission !== "granted") {
      notify(t("permissionDenied"));
      return;
    }
    if (!pushKey) {
      notify(t("unavailablePush"));
      return;
    }
    const subscription = current || await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeBase64Url(pushKey)
    });
    await api("/api/push/subscribe", jsonOptions("POST", { subscription: subscription.toJSON() }));
    setPushEnabled(true);
    savePushPreference(true);
    notify(t("pushEnabled"));
  } catch (error) {
    notify(localizeError(error.message));
  }
}

async function checkPushSubscription() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)
    || !("Notification" in window) || !window.isSecureContext) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    const enabled = Boolean(subscription) && getPushPreference() !== false;
    if (enabled && Notification.permission === "granted") {
      await api("/api/push/subscribe", jsonOptions("POST", { subscription: subscription.toJSON() }));
      setPushEnabled(true);
      savePushPreference(true);
    } else {
      setPushEnabled(enabled);
    }
  } catch (error) {
    console.error("Unable to read push subscription:", error);
  }
}

function getPushPreference() {
  try {
    const value = localStorage.getItem(`polus-push-enabled:${currentUser.id}`);
    return value === null ? null : value === "true";
  } catch (error) {
    console.error("Unable to read the notification preference:", error);
    return null;
  }
}

function savePushPreference(enabled) {
  try {
    localStorage.setItem(`polus-push-enabled:${currentUser.id}`, String(enabled));
  } catch {
    throw new Error("Unable to save the notification preference on this device.");
  }
}

function setPushEnabled(enabled) {
  document.dispatchEvent(new CustomEvent("polus:push-state-changed", { detail: { enabled } }));
}

function registerControllerListeners() {
  const onDialogOpenState = (event) => {
    if (event.detail.open) openDialogIds.add(event.detail.id);
    else openDialogIds.delete(event.detail.id);
  };
  listen(document, "polus:dialog-open-state", onDialogOpenState);
  listen(document, "polus:load-older-messages", () => void loadOlderMessages());
  listen(document, "polus:open-profile", (event) => {
    if (event.detail?.username) {
      void openUserProfile(event.detail.username).catch((error) => notify(localizeError(error.message)));
    }
  });
  listen(document, "polus:load-user-profile", (event) => {
    if (event.detail?.username) {
      void loadUserProfile(event.detail.username).catch((error) => {
        document.dispatchEvent(new CustomEvent("polus:user-profile-error", {
          detail: { username: event.detail.username, message: localizeError(error.message) }
        }));
      });
    }
  });
  listen(document, "polus:user-profile-action", (event) => {
    const { action, username } = event.detail || {};
    void (async () => {
      if (action === "message") {
        document.dispatchEvent(new CustomEvent("polus:request-direct-message", { detail: { username } }));
        return;
      }
      if (action === "toggle-contact") {
        const { user } = await api(`/api/users/${encodeURIComponent(username)}/profile`);
        await api(`/api/contacts/${encodeURIComponent(username)}`, {
          method: user.isContact ? "DELETE" : "PUT"
        });
        document.dispatchEvent(new CustomEvent("polus:contacts-changed"));
<<<<<<< Updated upstream
        await openUserProfile(username);
=======
        await loadUserProfile(username);
>>>>>>> Stashed changes
        notify(t(user.isContact ? "contactRemoved" : "contactAdded"));
        return;
      }
      if (action === "share-to-group" || action === "share-to-channel") {
        document.dispatchEvent(new CustomEvent("polus:open-contact-share", {
          detail: { username, type: action === "share-to-group" ? "group" : "channel" }
        }));
        return;
      }
      if (action === "toggle-block") {
        const { user } = await api(`/api/users/${encodeURIComponent(username)}/profile`);
        await api(`/api/users/${encodeURIComponent(username)}/block`, {
          method: user.blocked ? "DELETE" : "POST"
        });
        await loadUserProfile(username);
        return;
      }
      if (action === "toggle-mute") {
        const { user } = await api(`/api/users/${encodeURIComponent(username)}/profile`);
        const conversation = [currentConversation, ...directs].find((chat) =>
          chat && !chat.pending && chat.type === "direct" && chat.memberIds?.includes(user.id));
        if (!conversation) return;
        await toggleChatMute(!conversation.muted, { conversation, refreshInfo: false });
        await loadUserProfile(username);
      }
    })().catch((error) => notify(localizeError(error.message)));
  });
  listen(document, "polus:chat-info-action", (event) => {
    const { action, tab, cursor, attachmentId, canView, messageId, conversationId } = event.detail || {};
    if (!conversationId || currentConversation?.id !== conversationId) return;
    void (async () => {
      if (action === "select-tab") return openChatInfo(tab);
      if (action === "load-more") return loadMoreChatInfo(tab, cursor);
      if (action === "toggle-mute") return toggleChatMute(!currentConversation?.muted);
      if (action === "open-media") {
        if (canView) await openMediaViewer(attachmentId);
        else {
          const blob = await fetchAccountResource(
            `/api/attachments/${encodeURIComponent(attachmentId)}`,
            getActiveAccountKey()
          );
          const objectUrl = URL.createObjectURL(blob);
          window.open(objectUrl, "_blank", "noopener,noreferrer");
        }
        return;
      }
      if (action === "open-message") {
        closeDialog("chat-info-dialog");
        await jumpToMessage(messageId);
      }
    })().catch((error) => notify(localizeError(error.message)));
  });
  listen(document, "polus:chat-management-action", (event) => {
    void handleChatManagementAction(event.detail || {});
  });
  listen(document, "polus:request-chat-management", (event) => {
    void openChatManagement(event.detail?.chatId, false);
  });
  listen(document, "polus:chat-row-action", (event) => {
    const { action, conversation } = event.detail || {};
    if (action !== "pin" || !conversation?.id) return;
    void api(`/api/chats/${encodeURIComponent(conversation.id)}/pin`, {
      method: conversation.pinned ? "DELETE" : "PUT"
    }).then(refreshMessengerState).catch((error) => notify(localizeError(error.message)));
  });
  listen(document, "polus:chat-delete", (event) => {
    const { conversationId, scope } = event.detail || {};
    if (!conversationId || !["me", "everyone"].includes(scope)) return;
    void (async () => {
      await api(`/api/chats/${encodeURIComponent(conversationId)}?scope=${scope}`, { method: "DELETE" });
      closeDialog("chat-delete-dialog");
      await refreshMessengerState();
      notify(t("chatDeleted"));
    })().catch((error) => notify(localizeError(error.message)));
  });
  listen(document, "polus:open-searched-message", (event) => {
    document.dispatchEvent(new CustomEvent("polus:close-chat-search"));
    void jumpToMessage(event.detail.messageId).catch((error) => notify(localizeError(error.message)));
  });
  listen(document, "polus:open-media", (event) => {
    if (event.detail?.attachmentId) {
      if (event.detail.decryptedUrl) {
        document.dispatchEvent(new CustomEvent("polus:media-viewer-open", {
          detail: {
            items: [{ ...event.detail.attachment, decryptedUrl: event.detail.decryptedUrl }],
            index: 0
          }
        }));
        openDialog("media-viewer");
      } else {
        void openMediaViewer(event.detail.attachmentId).catch((error) => notify(localizeError(error.message)));
      }
    }
  });
  listen(document, "visibilitychange", () => {
    if (document.visibilityState === "visible" && currentConversation && isMessageListAtBottom()) {
      void markConversationRead(currentConversation);
    }
  });
  listen(document, "polus:message-context-menu-request", (event) => {
    handleMessageContextMenu(event.detail.event);
  });
  listen(document, "polus:message-list-scroll", () => {
    if (document.visibilityState === "visible" && currentConversation && isMessageListAtBottom()) {
      void markConversationRead(currentConversation);
    }
  });
  listen(document, "polus:realtime-message", (event) => {
    void receiveMessage(event.detail).catch((error) => notify(localizeError(error.message)));
  });
  listen(document, "polus:realtime-chat-updated", (event) => {
    const update = event.detail;
    void refreshMessengerState().then(() => {
      if (isDialogOpen("chat-info-dialog") && currentConversation?.id === update.chatId) {
        return openChatInfo(currentInfoTab);
      }
      return undefined;
    }).catch((error) => notify(localizeError(error.message)));
  });
  listen(document, "polus:realtime-message-updated", (event) => {
    void applyMessageMutation(event.detail).catch((error) => notify(localizeError(error.message)));
  });
  listen(document, "polus:realtime-message-deleted", (event) => {
    void applyMessageMutation(event.detail).catch((error) => notify(localizeError(error.message)));
  });
  listen(document, "polus:realtime-messages-read", (event) => {
    const { conversationId, readerId, lastReadMessageId } = event.detail || {};
    if (!conversationId || readerId === currentUser?.id || !Number.isSafeInteger(lastReadMessageId)) return;
    let changed = false;
    messages = messages.map((message) => {
      if (message.conversationId !== conversationId
        || message.authorId !== currentUser?.id
        || message.id > lastReadMessageId
        || message.seenByRecipient) return message;
      changed = true;
      return { ...message, seenByRecipient: true };
    });
    if (changed && currentConversation?.id === conversationId) renderMessages();
    const conversation = getConversation(conversationId);
    if (conversation?.lastMessage?.authorId === currentUser?.id
      && conversation.lastMessage.id <= lastReadMessageId
      && !conversation.lastMessage.seenByRecipient) {
      conversation.lastMessage = { ...conversation.lastMessage, seenByRecipient: true };
      renderConversations();
    }
  });
  listen(document, "polus:realtime-resync", () => {
    void resyncRealtimeState().catch((error) => notify(localizeError(error.message)));
  });
  listen(document, "polus:refresh-messenger-state", (event) => {
    const { resolve, reject } = event.detail || {};
    if (typeof resolve !== "function" || typeof reject !== "function") return;
    void refreshMessengerState().then(resolve, reject);
  });
  listen(document, "polus:message-edited", (event) => {
    void applyMessageMutation(event.detail?.message).catch((error) => notify(localizeError(error.message)));
  });
  listen(document, "polus:message-deleted", (event) => {
    void applyMessageMutation(event.detail?.message).catch((error) => notify(localizeError(error.message)));
  });
  listen(document, "polus:message-react", (event) => {
    const { messageId, emoji } = event.detail || {};
    if (!messageId || !emoji) return;
    void api(`/api/messages/${encodeURIComponent(messageId)}/reactions`,
      jsonOptions("POST", { emoji }))
      .then(applyMessageMutation)
      .catch((error) => notify(localizeError(error.message)));
  });
  listen(document, "polus:reply-message", (event) => {
    const message = event.detail?.message;
    if (!message || message.conversationId !== currentConversation?.id) return;
    document.dispatchEvent(new CustomEvent("polus:reply-target-changed", {
      detail: { conversationId: currentConversation.id, message }
    }));
  });
  listen(document, "polus:open-replied-message", (event) => {
    const { messageId } = event.detail || {};
    if (messageId) void jumpToMessage(messageId).catch((error) => notify(localizeError(error.message)));
  });
  listen(document, "polus:forward-message", (event) => {
    const message = event.detail?.message;
    if (!message) return;
    const chats = [...channels, ...directs].filter((chat) =>
      !chat.pending
      && chat.joined !== false
      && (chat.type !== "channel" || ["owner", "admin"].includes(chat.role))
    );
    document.dispatchEvent(new CustomEvent("polus:forward-dialog-open", {
      detail: { message, chats }
    }));
  });
  listen(document, "polus:forward-message-to-chat", (event) => {
    const { message, messageId, conversationId, recipientUsername, resolve, reject } = event.detail || {};
    if (!message || !messageId) {
      reject?.(new Error("The source message could not be loaded."));
      return;
    }
    void (async () => {
      try {
        const targetConversation = conversationId ? getConversation(conversationId) : null;
        if (conversationId && !targetConversation) throw new Error(t("selectChat"));
        if (!conversationId && !recipientUsername) throw new Error(t("selectChat"));
        const recipients = targetConversation
          ? await getConversationEncryptionKeys(targetConversation.id)
          : [
            await getOwnEncryptionPublicKey(),
            await getEncryptionPublicKey(recipientUsername)
          ];
        const targetConversationId = targetConversation
          ? targetConversation.id
          : `dm_${recipients.map((item) => item.id).sort().join("_")}`;
        const text = await encryptMessagePayload(currentUser.id, recipients, targetConversationId, {
          text: message.text || "",
          mediaType: message.mediaType || null,
          attachments: (message.attachments || []).map((attachment) => ({
            id: attachment.id,
            name: attachment.name,
            mimeType: attachment.mimeType,
            size: attachment.size,
            encrypted: attachment.encrypted === true,
            ...(attachment.encryption || {})
          }))
        });
        const forwarded = await api(`/api/messages/${encodeURIComponent(messageId)}/forward`,
          jsonOptions("POST", {
            ...(conversationId ? { conversationId } : {}),
            ...(recipientUsername ? { recipientUsername } : {}),
            encrypted: true,
            text
          }));
        await refreshMessengerState();
        const forwardedConversation = getConversation(forwarded.conversationId);
        await applySentMessage({ sent: forwarded, conversation: forwardedConversation });
        notify(t("messageForwarded"));
        resolve?.();
      } catch (error) {
        reject?.(new Error(localizeError(error.message)));
      }
    })();
  });
  listen(document, "polus:save-message", (event) => {
    void saveMessageToFavorites(event.detail?.message).catch((error) => notify(localizeError(error.message)));
  });
  listen(document, "polus:set-language", (event) => setLanguage(event.detail.language));
  listen(document, "polus:message-sent", (event) => {
    void applySentMessage(event.detail).catch((error) => notify(localizeError(error.message)));
  });
  listen(document, "polus:chat-info", () => void openChatInfo());
  listen(document, "polus:search-chat", (event) => {
    clearTimeout(chatSearchTimer);
    const query = event.detail.query;
    if (!query.trim()) {
      ++chatSearchRequestId;
      document.dispatchEvent(new CustomEvent("polus:chat-search-results", {
        detail: { results: [], message: t("searchPromptChat") }
      }));
      return;
    }
    chatSearchTimer = setTimeout(() => {
      void searchChat(query).catch((error) => notify(localizeError(error.message)));
    }, 180);
  });
  listen(document, "polus:profile-dialog-open", prepareOwnProfile);
  listen(document, "polus:profile-avatar-selected", (event) => {
    void updateProfileAvatarPreview(event.detail.file);
  });
  listen(document, "polus:profile-saved", (event) => {
    if (profilePreviewUrl) URL.revokeObjectURL(profilePreviewUrl);
    profilePreviewUrl = null;
    setUser(event.detail.user);
  });
  listen(document, "polus:sign-out", () => void signOut());
  listen(document, "polus:toggle-push", () => void togglePushNotifications());
  listen(document, "polus:sidebar-search", (event) => {
    sidebarSearchQuery = event.detail.query;
    renderConversations();
  });
  listen(document, "polus:clear-sidebar-search", () => {
    sidebarSearchQuery = "";
  });
  listen(document, "polus:find-people", () => {
    const query = sidebarSearchQuery.trim();
    document.dispatchEvent(new CustomEvent("polus:open-people-search", { detail: { query } }));
  });
  listen(document, "polus:open-conversation", (event) => {
    const conversation = event.detail.conversation;
    if (!conversation.pending) {
      if (conversation.type === "channel") {
        if (!channels.some((item) => item.id === conversation.id)) channels.unshift(conversation);
      } else if (!directs.some((item) => item.id === conversation.id)) {
        directs.unshift(conversation);
      }
    }
    renderConversations();
    void openConversation(conversation);
  });
  listen(document, "polus:join-channel", (event) => {
    const channelId = event.detail?.channelId;
    if (typeof channelId !== "string" || !channelId) return;
    void api(`/api/channels/${encodeURIComponent(channelId)}/join`, { method: "POST" })
      .then((conversation) => {
        channels = channels.map((channel) => channel.id === conversation.id ? conversation : channel);
        renderConversations();
        return openConversation(conversation);
      })
      .catch((error) => notify(localizeError(error.message)));
  });
}

async function start(session) {
  setLanguage(language);
  try {
    await loadMessenger(session);
    if (session !== controllerSession) return;
    await checkPushSubscription();
  } catch (error) {
    if (session === controllerSession) notify(localizeError(error.message));
  }
}

export function initializeMessenger() {
  if (controllerInitialized) return () => {};
  messengerView = document.querySelector("#messenger-view");
  messageList = document.querySelector("#message-list");
  if (!messengerView || !messageList) {
    throw new Error("Messenger controller requires the mounted messenger view and message list.");
  }
  controllerInitialized = true;
  const session = ++controllerSession;
  registerControllerListeners();
  listen(document, "submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if ((form.getAttribute("method") || "").toLowerCase() === "dialog") return;
    event.preventDefault();
    if (!polusReady) {
      window.alert("Страница загрузилась не полностью. Обновите её (Ctrl+F5).");
    }
  });
  polusReady = true;
  void start(session);
  return () => {
    if (session !== controllerSession) return;
    ++controllerSession;
    polusReady = false;
    for (const removeListener of controllerListeners.splice(0)) removeListener();
    controllerInitialized = false;
    clearTimeout(chatSearchTimer);
  };
}