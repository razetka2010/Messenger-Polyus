const content = document.querySelector("#privacy-content");
const languageSelect = document.querySelector("#privacy-language");
const language = localStorage.getItem("polus-language") || "ru";
languageSelect.value = language;

const policies = {
  ru: `<div class="eyebrow">ПОЛЮС · ВЕРСИЯ 2026-10-31</div>
    <h1>Политика конфиденциальности</h1>
    <p class="privacy-lead">Здесь объясняется, какие данные обрабатывает эта версия Полюса и как они используются. Это шаблон политики для самостоятельного развёртывания, а не юридическая консультация.</p>
    <h2>Какие данные мы храним</h2>
    <p>Для аккаунта хранятся выбранное имя пользователя (@username), отображаемое имя, необязательное описание «О себе», аватар, настройка видимости статуса и стойкий криптографический хеш пароля. Сам пароль в открытом виде не сохраняется. При регистрации фиксируются дата и версия принятия этой политики.</p>
    <p>Сообщения, каналы, участники групповых и личных бесед, профильные данные и настройки push-уведомлений хранятся на сервере, где размещён Полюс. Загруженные вложения и аватары хранятся отдельно в файловой системе сервера, а их метаданные — в базе данных. При входе создаётся случайная сессионная cookie; на сервере хранится только её хеш. IP-адрес кратковременно используется для ограничения частоты входа и регистрации.</p>
    <h2>Для чего используются данные</h2>
    <p>Данные нужны для входа в аккаунт, отображения профиля и материалов чатов, поиска, доставки сообщений участникам беседы и доставки запрошенных push-уведомлений. Email-адреса, рекламные идентификаторы и аналитика этой версией приложения не собираются.</p>
    <h2>Push-уведомления</h2>
    <p>Push работает только после вашего разрешения в браузере. Для его доставки браузер передаёт серверу адрес push-службы и ключи подписки, а служба браузера получает текст уведомления. В настройках профиля можно скрыть текст сообщения. Уведомления не отправляются, пока видимая вкладка открыта на соответствующем чате; для этого сервер временно хранит состояние активной вкладки в памяти. Отключите разрешение в настройках браузера; подписку можно удалить в настройках сайта.</p>
    <h2>Хранение и безопасность</h2>
    <p>Данные хранятся, пока администратор сервера не удалит их. Владелец конкретного сервера управляет доступом, сроками хранения, резервными копиями и удалением данных. Используйте HTTPS вне локальной разработки: без него сетевой трафик и cookie могут быть перехвачены. Сообщения не имеют сквозного шифрования и доступны администратору сервера.</p>
    <h2>Ваш выбор</h2>
    <p>Имя профиля можно изменить в настройках аккаунта; пароль — сменить, подтвердив текущий пароль. Вы можете не создавать аккаунт или запретить браузерные уведомления. Для запроса на удаление данных обратитесь к администратору сервера.</p>
    <h2>Настройте перед запуском для других людей</h2>
    <p>Перед публичным запуском замените эту страницу на политику, соответствующую вашему оператору, юрисдикции, контактам, срокам хранения и используемому серверу. Укажите ответственное лицо и способ связаться с ним. Регистрация сохраняет факт согласия с показанной версией документа.</p>
    <a class="primary-button privacy-back" href="/">Вернуться в Полюс</a>`,
  en: `<div class="eyebrow">POLUS · VERSION 2026-10-31</div>
    <h1>Privacy policy</h1>
    <p class="privacy-lead">This page explains what this version of Polus processes and why. It is a self-hosting policy template, not legal advice.</p>
    <h2>What we store</h2>
    <p>Your account stores your chosen username (@username), display name, optional bio, avatar, online-visibility preference, and a cryptographic password hash. Your plain-text password is never stored. Registration records when and which version of this policy you accepted.</p>
    <p>Messages, channels, group and direct conversation membership, profile data, and push notification subscriptions are stored on the server hosting Polus. Uploaded attachments and avatars are stored separately in the server file system, with their metadata in the database. Sign-in uses a random session cookie; only its hash is stored on the server. Your IP address is held temporarily to limit sign-in and registration attempts.</p>
    <h2>How data is used</h2>
    <p>Data is used to sign you in, show your profile and chat materials, search, deliver messages to conversation members, and send push notifications you request. This version does not collect email addresses, advertising identifiers, or analytics.</p>
    <h2>Push notifications</h2>
    <p>Push works only after you grant browser permission. Your browser shares a push service endpoint and subscription keys with the server; the browser's push service receives notification content. You can hide message text in profile settings. Notifications are skipped while a visible tab is open to that conversation; the server keeps active-tab state in memory temporarily for this purpose. Revoke permission in your browser settings; remove your subscription in the site's settings.</p>
    <h2>Storage and security</h2>
    <p>Data remains stored until the server administrator deletes it. The operator of each server controls access, retention, backups, and deletion. Use HTTPS outside local development: without it, network traffic and cookies may be intercepted. Messages are not end-to-end encrypted and are accessible to the server administrator.</p>
    <h2>Your choices</h2>
    <p>You can change your display name in account settings and change your password after verifying the current password. You may choose not to create an account or decline browser notifications. Contact your server administrator to request data deletion.</p>
    <h2>Before opening your server to others</h2>
    <p>Before a public launch, replace this page with a policy that reflects your operator, jurisdiction, contact details, retention period, and hosting setup. Provide a responsible person's name and contact method. Registration records consent to the displayed policy version.</p>
    <a class="primary-button privacy-back" href="/">Back to Polus</a>`
};

function renderPolicy() {
  const selected = languageSelect.value === "en" ? "en" : "ru";
  document.documentElement.lang = selected;
  document.title = selected === "ru" ? "Конфиденциальность — Полюс" : "Privacy — Polus";
  content.innerHTML = policies[selected];
}

languageSelect.addEventListener("change", () => {
  localStorage.setItem("polus-language", languageSelect.value);
  renderPolicy();
});
renderPolicy();
