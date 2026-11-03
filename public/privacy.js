const languageSelect = document.querySelector("#privacy-language");
const content = document.querySelector("#privacy-content");
const navigation = document.querySelector("#privacy-navigation");
const sectionIds = ["data", "use", "notifications", "security", "choices", "operator"];
const version = "2026-10-31";

const policies = {
  ru: {
    title: "Политика конфиденциальности",
    breadcrumb: "Документы",
    toc: "В этом документе",
    eyebrow: "ПОЛИТИКА · ПОЛЮС",
    lead: "Здесь объясняется, какие данные обрабатывает эта версия Полюса и как они используются. Это шаблон политики для самостоятельного развёртывания, а не юридическая консультация.",
    versionLabel: `Версия от ${version}`,
    summaryTitle: "Коротко о главном",
    summary: "Полюс хранит данные, необходимые для работы аккаунта и переписок. Сообщения не имеют сквозного шифрования и доступны администратору сервера. Для публичного запуска оператору нужно указать свои контакты и правила хранения.",
    sections: [
      {
        title: "Какие данные мы храним",
        paragraphs: [
          "Для аккаунта хранятся выбранное имя пользователя (@username), отображаемое имя, необязательное описание «О себе», аватар, настройка видимости статуса и стойкий криптографический хеш пароля. Сам пароль в открытом виде не сохраняется. При регистрации фиксируются дата и версия принятия этой политики.",
          "Сообщения, каналы, участники групповых и личных бесед, профильные данные и настройки push-уведомлений хранятся на сервере, где размещён Полюс. Загруженные вложения и аватары хранятся отдельно в файловой системе сервера, а их метаданные — в базе данных. При входе создаётся случайная сессионная cookie; на сервере хранится только её хеш. IP-адрес кратковременно используется для ограничения частоты входа и регистрации."
        ]
      },
      {
        title: "Для чего используются данные",
        paragraphs: [
          "Данные нужны для входа в аккаунт, отображения профиля и материалов чатов, поиска, доставки сообщений участникам беседы и доставки запрошенных push-уведомлений. Email-адреса, рекламные идентификаторы и аналитика этой версией приложения не собираются."
        ]
      },
      {
        title: "Push-уведомления",
        paragraphs: [
          "Push работает только после вашего разрешения в браузере. Для его доставки браузер передаёт серверу адрес push-службы и ключи подписки, а служба браузера получает текст уведомления. В настройках профиля можно скрыть текст сообщения. Уведомления не отправляются, пока видимая вкладка открыта на соответствующем чате; для этого сервер временно хранит состояние активной вкладки в памяти. Отключите разрешение в настройках браузера; подписку можно удалить в настройках сайта."
        ]
      },
      {
        title: "Хранение и безопасность",
        paragraphs: [
          "Данные хранятся, пока администратор сервера не удалит их. Владелец конкретного сервера управляет доступом, сроками хранения, резервными копиями и удалением данных. Используйте HTTPS вне локальной разработки: без него сетевой трафик и cookie могут быть перехвачены. Сообщения не имеют сквозного шифрования и доступны администратору сервера."
        ]
      },
      {
        title: "Ваш выбор",
        paragraphs: [
          "Имя профиля можно изменить в настройках аккаунта; пароль — сменить, подтвердив текущий пароль. Вы можете не создавать аккаунт или запретить браузерные уведомления. Для запроса на удаление данных обратитесь к администратору сервера."
        ]
      },
      {
        title: "Настройте перед запуском для других людей",
        paragraphs: [
          "Перед публичным запуском замените эту страницу на политику, соответствующую вашему оператору, юрисдикции, контактам, срокам хранения и используемому серверу. Укажите ответственное лицо и способ связаться с ним. Регистрация сохраняет факт согласия с показанной версией документа."
        ]
      }
    ],
    footer: "Полюс может размещаться на разных серверах. О правилах обработки данных на конкретном сервере рассказывает его оператор.",
    back: "← Вернуться в Полюс",
    languageLabel: "Язык страницы"
  },
  en: {
    title: "Privacy policy",
    breadcrumb: "Documents",
    toc: "In this document",
    eyebrow: "POLICY · POLUS",
    lead: "This page explains what this version of Polus processes and why. It is a self-hosting policy template, not legal advice.",
    versionLabel: `Version dated ${version}`,
    summaryTitle: "The short version",
    summary: "Polus stores the data needed to run your account and conversations. Messages are not end-to-end encrypted and are accessible to the server administrator. Before a public launch, the operator should provide their own contact and retention details.",
    sections: [
      {
        title: "What we store",
        paragraphs: [
          "Your account stores your chosen username (@username), display name, optional bio, avatar, online-visibility preference, and a cryptographic password hash. Your plain-text password is never stored. Registration records when and which version of this policy you accepted.",
          "Messages, channels, group and direct conversation membership, profile data, and push notification subscriptions are stored on the server hosting Polus. Uploaded attachments and avatars are stored separately in the server file system, with their metadata in the database. Sign-in uses a random session cookie; only its hash is stored on the server. Your IP address is held temporarily to limit sign-in and registration attempts."
        ]
      },
      {
        title: "How data is used",
        paragraphs: [
          "Data is used to sign you in, show your profile and chat materials, search, deliver messages to conversation members, and send push notifications you request. This version does not collect email addresses, advertising identifiers, or analytics."
        ]
      },
      {
        title: "Push notifications",
        paragraphs: [
          "Push works only after you grant browser permission. Your browser shares a push service endpoint and subscription keys with the server; the browser's push service receives notification content. You can hide message text in profile settings. Notifications are skipped while a visible tab is open to that conversation; the server keeps active-tab state in memory temporarily for this purpose. Revoke permission in your browser settings; remove your subscription in the site's settings."
        ]
      },
      {
        title: "Storage and security",
        paragraphs: [
          "Data remains stored until the server administrator deletes it. The operator of each server controls access, retention, backups, and deletion. Use HTTPS outside local development: without it, network traffic and cookies may be intercepted. Messages are not end-to-end encrypted and are accessible to the server administrator."
        ]
      },
      {
        title: "Your choices",
        paragraphs: [
          "You can change your display name in account settings and change your password after verifying the current password. You may choose not to create an account or decline browser notifications. Contact your server administrator to request data deletion."
        ]
      },
      {
        title: "Before opening your server to others",
        paragraphs: [
          "Before a public launch, replace this page with a policy that reflects your operator, jurisdiction, contact details, retention period, and hosting setup. Provide a responsible person's name and contact method. Registration records consent to the displayed policy version."
        ]
      }
    ],
    footer: "Polus can be hosted on different servers. The operator of each server is responsible for explaining its data practices.",
    back: "← Back to Polus",
    languageLabel: "Page language"
  }
};

function readSavedLanguage() {
  try {
    return localStorage.getItem("polus-language") === "en" ? "en" : "ru";
  } catch {
    return "ru";
  }
}

function renderPolicy() {
  const selected = languageSelect.value === "en" ? "en" : "ru";
  const policy = policies[selected];
  document.documentElement.lang = selected;
  document.title = `${policy.title} — ${selected === "ru" ? "Полюс" : "Polus"}`;
  document.querySelector('meta[name="description"]').content = policy.lead;
  document.querySelector("#privacy-breadcrumb").innerHTML =
    `${policy.breadcrumb} <span aria-hidden="true">/</span> ${policy.title}`;
  document.querySelector("#privacy-toc-title").textContent = policy.toc;
  document.querySelector("#privacy-toc-title").setAttribute("aria-label", policy.toc);
  document.querySelector("#privacy-eyebrow").textContent = policy.eyebrow;
  document.querySelector("#privacy-title").textContent = policy.title;
  document.querySelector("#privacy-lead").textContent = policy.lead;
  document.querySelector("#privacy-version").textContent = policy.versionLabel;
  document.querySelector("#privacy-summary-title").textContent = policy.summaryTitle;
  document.querySelector("#privacy-summary-copy").textContent = policy.summary;
  document.querySelector("#privacy-footer-note").textContent = policy.footer;
  document.querySelector("#privacy-back").textContent = policy.back;
  document.querySelector(".privacy-language select, #privacy-language")
    .setAttribute("aria-label", policy.languageLabel);
  navigation.innerHTML = policy.sections.map((section, index) =>
    `<a href="#privacy-section-${sectionIds[index]}" data-section="privacy-section-${sectionIds[index]}">
      <span class="privacy-toc-number">${String(index + 1).padStart(2, "0")}</span>
      <span>${section.title}</span>
    </a>`).join("");
  content.innerHTML = policy.sections.map((section, index) =>
    `<section class="privacy-section" id="privacy-section-${sectionIds[index]}" aria-labelledby="privacy-heading-${sectionIds[index]}">
      <div class="privacy-section-index">${String(index + 1).padStart(2, "0")}</div>
      <div class="privacy-section-copy">
        <h2 id="privacy-heading-${sectionIds[index]}">${section.title}</h2>
        ${section.paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join("")}
      </div>
    </section>`).join("");
  observeSections();
}

let sectionObserver;
function observeSections() {
  sectionObserver?.disconnect();
  if (!("IntersectionObserver" in window)) return;
  sectionObserver = new IntersectionObserver((entries) => {
    const current = entries
      .filter((entry) => entry.isIntersecting)
      .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top)[0];
    if (!current) return;
    navigation.querySelectorAll("a").forEach((link) => {
      if (link.dataset.section === current.target.id) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
  }, { rootMargin: "-12% 0px -72% 0px" });
  content.querySelectorAll(".privacy-section").forEach((section) => sectionObserver.observe(section));
}

function applySavedTheme() {
  try {
    const theme = localStorage.getItem("polus-theme");
    if (theme) {
      document.documentElement.dataset.theme = theme;
      document.documentElement.dataset.colorTheme = theme;
      document.documentElement.style.colorScheme = theme === "dark" ? "dark" : "light";
    }
  } catch {
    // Theme persistence is optional on this read-only page.
  }
}

languageSelect.value = readSavedLanguage();
languageSelect.addEventListener("change", () => {
  try {
    localStorage.setItem("polus-language", languageSelect.value);
  } catch {
    // Keep the selected language for the current page view.
  }
  renderPolicy();
});
navigation.addEventListener("click", (event) => {
  if (!(event.target instanceof Element) || !event.target.closest("a")) return;
  const details = document.querySelector(".privacy-toc-details");
  if (window.matchMedia("(max-width: 760px)").matches) details.open = false;
});
applySavedTheme();
renderPolicy();
