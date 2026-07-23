// ─────────────────────────────────────────────────────────────────────────────
// YPS AI — frontend script
// ─────────────────────────────────────────────────────────────────────────────

import { ENGLISH_UI, getLanguage, LANGUAGES } from "./i18n.js";
import { normalizeSourcesList } from "./markdown.js";

// ── Source labels ─────────────────────────────────────────────────────────────
const SOURCE_TRANSLATION_KEYS = {
  all: "sourceAll",
  "UN Resolutions & Frameworks": "sourceUNResolutions",
  "UN Publications": "sourceUNPublications",
  "Regional Organizations Documents": "sourceRegional",
  "National Action Plans and Strategies": "sourceNAP",
  "Academic Research": "sourceAcademic",
  "Civil Society & NGO Publications": "sourceCivilSociety",
};

const STARTER_PROMPTS = [
  "starter1",
  "starter2",
  "starter3",
  "starter4",
];

const LANGUAGE_STORAGE_KEY = "yps-ai-language";

// ── Chat state ────────────────────────────────────────────────────────────────
let chats = [];
let activeChatId = null;
let activeSource = "all";
let activeLanguageCode = "en";
let activeLanguage = getLanguage("en");
let currentUI = { ...ENGLISH_UI };

// (Knowledge base retrieval is handled server-side in api/chat.js)

// ── DOM refs ──────────────────────────────────────────────────────────────────
const chatList            = document.querySelector("#chatList");
const chatSearchButton    = document.querySelector("#chatSearchButton");
const chatSearch          = document.querySelector("#chatSearch");
const chatSearchInput     = document.querySelector("#chatSearchInput");
const sidebar             = document.querySelector(".sidebar");
const mobileHistoryButton = document.querySelector("#mobileHistoryButton");
const messages            = document.querySelector("#messages");
const activeTitle         = document.querySelector("#activeTitle");
const brandLogo           = document.querySelector(".brand-logo");
const chatForm            = document.querySelector("#chatForm");
const messageInput        = document.querySelector("#messageInput");
const sourcePicker        = document.querySelector("#sourcePicker");
const sourceTrigger       = document.querySelector("#sourceTrigger");
const sourceLabel         = document.querySelector("#sourceLabel");
const sourceOptions       = Array.from(document.querySelectorAll(".source-option"));
const micButton           = document.querySelector("#micButton");
const speechStatus        = document.querySelector("#speechStatus");
const newChatButton       = document.querySelector("#newChatButton");
const aboutButton         = document.querySelector("#aboutButton");
const aboutModal          = document.querySelector("#aboutModal");
const closeAboutButton    = document.querySelector("#closeAboutButton");
const themeButton         = document.querySelector("#themeButton");
const accessibilityMenu   = document.querySelector("#accessibilityMenu");
const accessibilityButton = document.querySelector("#accessibilityButton");
const languageMenu        = document.querySelector("#languageMenu");
const languageButton      = document.querySelector("#languageButton");
const languagePanel       = document.querySelector("#languagePanel");
const languageSearch      = document.querySelector("#languageSearch");
const languageList        = document.querySelector("#languageList");
const languageStatus      = document.querySelector("#languageStatus");
const languageCurrent     = document.querySelector("#languageCurrent");
const currentLanguageName = document.querySelector("#currentLanguageName");
const largeTextToggle     = document.querySelector("#largeTextToggle");
const contrastToggle      = document.querySelector("#contrastToggle");
const colorBlindToggle    = document.querySelector("#colorBlindToggle");
const copyrightYear       = document.querySelector("#copyrightYear");
const SpeechRecognition   = window.SpeechRecognition || window.webkitSpeechRecognition;
const speechSynthesisApi  = window.speechSynthesis;

const LIGHT_LOGO_SRC  = "assets/yps-ai-logo.png?v=20260624-logo";
const DARK_LOGO_SRC   = "assets/yps-ai-logo-dark.png?v=20260624-darkgrey";
const MAX_INPUT_LINES = 7;
const MAX_HISTORY_MESSAGES = 21;
const LOADING_MSG_ID  = "__loading__";

const DOWNLOAD_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 3v11" />
    <path d="m7.5 9.5 4.5 4.5 4.5-4.5" />
    <path d="M5 16.5v1.8A2.7 2.7 0 0 0 7.7 21h8.6a2.7 2.7 0 0 0 2.7-2.7v-1.8" />
  </svg>
`;

let recognition = null;
let isListening = false;
let voiceInputPending = false;
let transcriptAddedDuringListen = false;
let stopRequested = false;
let speakingMessageId = null;

if (copyrightYear) {
  copyrightYear.textContent = new Date().getFullYear();
}

let languageRequestId = 0;

function interpolate(template, values = {}) {
  return String(template || "").replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
  );
}

function t(key, values) {
  return interpolate(currentUI[key] || ENGLISH_UI[key] || key, values);
}

function readStoredLanguage() {
  try {
    return window.localStorage.getItem(LANGUAGE_STORAGE_KEY) || "en";
  } catch (error) {
    return "en";
  }
}

function storeLanguage(code) {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, code);
  } catch (error) {
    // The preference remains active for this page even if storage is unavailable.
  }
}

function renderLanguageList(query = "") {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleLanguages = LANGUAGES.filter((language) =>
    `${language.name} ${language.nativeName}`.toLocaleLowerCase().includes(normalizedQuery)
  );

  languageList.innerHTML = "";
  if (!visibleLanguages.length) {
    const empty = document.createElement("p");
    empty.className = "language-empty";
    empty.textContent = t("noLanguages");
    languageList.appendChild(empty);
    return;
  }

  visibleLanguages.forEach((language) => {
    const button = document.createElement("button");
    const selected = language.code === activeLanguageCode;
    button.type = "button";
    button.className = `language-option${selected ? " selected" : ""}`;
    button.dataset.language = language.code;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(selected));
    const nativeName = document.createElement("span");
    nativeName.className = "language-native-name";
    nativeName.textContent = language.nativeName;
    nativeName.dir = language.dir;

    button.appendChild(nativeName);
    button.addEventListener("click", async () => {
      const loaded = await setLanguage(language.code);
      if (loaded) closeLanguageMenu();
    });
    languageList.appendChild(button);
  });
}

function applyTranslations() {
  document.documentElement.lang = activeLanguage.code;
  document.documentElement.dir = "ltr";
  document.body.classList.toggle("rtl-text", activeLanguage.dir === "rtl");

  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
    element.dir = activeLanguage.dir;
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    element.setAttribute("placeholder", t(element.dataset.i18nPlaceholder));
    element.dir = activeLanguage.dir;
  });
  document.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
    element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel));
  });
  document.querySelector(".privacy-details").dir = activeLanguage.dir;

  languageCurrent.textContent = activeLanguage.nativeName;
  languageCurrent.dir = activeLanguage.dir;
  currentLanguageName.textContent = activeLanguage.nativeName;
  languageButton.title = `${t("language")}: ${activeLanguage.nativeName}`;
  languageButton.setAttribute("aria-label", `${t("chooseLanguage")}: ${activeLanguage.nativeName}`);
  themeButton.setAttribute("aria-label", document.body.classList.contains("dark") ? t("switchLight") : t("switchDark"));
  micButton.setAttribute("aria-label", isListening ? t("stopSpeech") : t("startSpeech"));
  chats.forEach((chat) => {
    if (chat.isUntitled) chat.title = t("newConversation");
  });

  if (recognition) recognition.lang = activeLanguage.speech;
  renderLanguageList(languageSearch.value);
  setActiveSource(activeSource, false);
  render();
}

function loadTranslations(code) {
  if (code === "en") return { ...ENGLISH_UI };

  const bundled = STATIC_LOCALES[code];
  if (!bundled || typeof bundled !== "object") {
    throw new Error(`Bundled locale is missing: ${code}`);
  }
  const complete = Object.keys(ENGLISH_UI).every(
    (key) => typeof bundled[key] === "string" && bundled[key].trim()
  );
  if (!complete) throw new Error("Bundled locale is incomplete");
  return { ...ENGLISH_UI, ...bundled };
}

async function setLanguage(code, { initial = false } = {}) {
  const language = LANGUAGES.find((item) => item.code === code) || getLanguage("en");
  const requestId = ++languageRequestId;

  activeLanguageCode = language.code;
  activeLanguage = language;
  storeLanguage(language.code);
  document.documentElement.lang = language.code;
  document.documentElement.dir = "ltr";
  document.body.classList.toggle("rtl-text", language.dir === "rtl");
  languageCurrent.textContent = language.nativeName;
  languageCurrent.dir = language.dir;
  currentLanguageName.textContent = language.nativeName;
  renderLanguageList(languageSearch.value);

  languageButton.disabled = true;
  languagePanel.setAttribute("aria-busy", "true");
  languageStatus.classList.remove("error");
  languageStatus.textContent = "";

  let translationLoaded = false;
  try {
    currentUI = loadTranslations(language.code);
    if (requestId !== languageRequestId) return;
    translationLoaded = true;
    languageStatus.textContent = "";
  } catch (error) {
    if (requestId !== languageRequestId) return;
    console.error("Could not load interface translation:", error);
    currentUI = { ...ENGLISH_UI };
    languageStatus.classList.add("error");
    languageStatus.textContent = t("genericError");
  } finally {
    if (requestId === languageRequestId) {
      languageButton.disabled = false;
      languagePanel.removeAttribute("aria-busy");
      applyTranslations();
      if (!initial) messageInput.focus();
    }
  }
  return translationLoaded;
}

// ─────────────────────────────────────────────────────────────────────────────
// API call — retrieval is handled server-side in api/chat.js
// ─────────────────────────────────────────────────────────────────────────────

async function callChatAPI(source, history, onDelta, languageCode = activeLanguageCode) {
  const apiMessages = history
    .filter((m) => m.id !== LOADING_MSG_ID)
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => ({ role: m.role, text: m.text }));

  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: apiMessages,
      source,
      language: languageCode,
    }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const localizedError = t("serverError", { status: response.status });
    throw new Error(activeLanguageCode === "en" ? data.error || localizedError : localizedError);
  }

  if (!response.body) {
    throw new Error(t("streamUnsupported"));
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let reply = "";

  function readEvent(line) {
    if (!line.trim()) return;

    let event;
    try {
      event = JSON.parse(line);
    } catch (error) {
      throw new Error(t("invalidStream"));
    }

    if (event.type === "error") {
      throw new Error(activeLanguageCode === "en" ? event.error || t("streamInterrupted") : t("streamInterrupted"));
    }

    if (event.type === "delta" && typeof event.delta === "string") {
      reply += event.delta;
      onDelta(event.delta);
    }
  }

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      lines.forEach(readEvent);

      if (done) break;
    }

    if (buffer.trim()) readEvent(buffer);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }

  if (!reply) {
    throw new Error(t("noResponse"));
  }

  return reply.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Markdown → HTML (minimal, safe)
// ─────────────────────────────────────────────────────────────────────────────

function renderMarkdown(text) {
  // Escape raw HTML first so we don't accidentally inject anything
  let html = normalizeSourcesList(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

  // Preserve safe Markdown links while applying the remaining inline formatting.
  const links = [];
  html = html.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s]+)\)/g, (_match, label, url) => {
    const token = `@@YPSLINK${links.length}@@`;
    links.push(
      `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`
    );
    return token;
  });

  // Bold **text**
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // Italic *text* or _text_
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(/_(.+?)_/g, "<em>$1</em>");

  // Inline citation markers [1], [2] → superscript
  html = html.replace(/\[(\d+)\]/g, "<sup class='cite'>[$1]</sup>");
  html = html.replace(/@@YPSLINK(\d+)@@/g, (_match, index) => links[Number(index)] || "");

  // Render block elements semantically so CSS controls spacing consistently.
  const lines = html.replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let paragraphLines = [];
  let listType = null;
  let inSourcesSection = false;

  function flushParagraph() {
    if (!paragraphLines.length) return;
    out.push(`<p>${paragraphLines.join(" ")}</p>`);
    paragraphLines = [];
  }

  function closeList() {
    if (!listType) return;
    out.push(`</${listType}>`);
    listType = null;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^\s*(#{1,6})\s+(.+)/);
    const sourcesHeadingMatch = line.match(
      /^\s*(?:<strong>)?Sources:(?:<\/strong>)?\s*$/i
    );
    const ulMatch = line.match(/^\s*[-*•]\s+(.+)/);
    const olMatch = line.match(/^\s*(\d+)\.\s+(.+)/);
    const match = ulMatch || olMatch;

    if (sourcesHeadingMatch) {
      flushParagraph();
      closeList();
      inSourcesSection = true;
      out.push(`<p class="sources-heading">${line.trim()}</p>`);
    } else if (headingMatch) {
      flushParagraph();
      closeList();
      const headingLevel = Math.min(4, headingMatch[1].length + 1);
      out.push(`<h${headingLevel}>${headingMatch[2]}</h${headingLevel}>`);
    } else if (match) {
      flushParagraph();
      const nextListType = ulMatch ? "ul" : "ol";
      if (listType !== nextListType) {
        closeList();
        const listClass =
          inSourcesSection && nextListType === "ol" ? ` class="sources-list"` : "";
        out.push(`<${nextListType}${listClass}>`);
        listType = nextListType;
      }
      const listContent = ulMatch ? ulMatch[1] : olMatch[2];
      const listValue = olMatch ? ` value="${Number(olMatch[1])}"` : "";
      if (inSourcesSection && olMatch) {
        out.push(
          `<li${listValue}><sup class="source-number" aria-hidden="true">${Number(
            olMatch[1]
          )}</sup><span class="source-reference-text">${listContent}</span></li>`
        );
      } else {
        out.push(`<li${listValue}>${listContent}</li>`);
      }
    } else if (line.trim() === "") {
      flushParagraph();
      closeList();
    } else {
      closeList();
      paragraphLines.push(line.trim());
    }
  }
  flushParagraph();
  closeList();

  return out.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Chat state
// ─────────────────────────────────────────────────────────────────────────────

function createId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : String(Date.now());
}

function isChatEmpty(chat) {
  return chat.messages.length === 0;
}

function createChat() {
  const existingEmptyChat = chats.find(isChatEmpty);
  if (existingEmptyChat) {
    activeChatId = existingEmptyChat.id;
    setActiveSource(existingEmptyChat.source, false);
    render();
    return existingEmptyChat;
  }

  const chat = {
    id: createId(),
    title: t("newConversation"),
    isUntitled: true,
    source: "all",
    messages: [],
    createdAt: new Date(),
  };
  chats.unshift(chat);
  activeChatId = chat.id;
  render();
  return chat;
}

function getActiveChat() {
  return chats.find((chat) => chat.id === activeChatId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Render
// ─────────────────────────────────────────────────────────────────────────────

function render() {
  renderHistory();
  renderMessages();
  updateNewChatAvailability();
}

function updateNewChatAvailability() {
  const hasEmptyChat = chats.some(isChatEmpty);

  newChatButton.disabled = hasEmptyChat;
  if (hasEmptyChat) {
    newChatButton.title = t("newChatDisabledTitle");
    return;
  }

  newChatButton.removeAttribute("title");
}

function renderHistory() {
  chatList.innerHTML = "";

  const query = chatSearchInput.value.trim().toLowerCase();
  const visibleChats = query
    ? chats.filter((chat) => {
        const searchableText = [
          chat.title,
          getSourceName(chat.source),
          ...chat.messages.map((m) => m.text),
        ]
          .join(" ")
          .toLowerCase();
        return searchableText.includes(query);
      })
    : chats;

  if (query && visibleChats.length === 0) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = t("noMatchingChats");
    chatList.appendChild(empty);
    return;
  }

  visibleChats.forEach((chat) => {
    const item = document.createElement("div");
    item.className = `chat-item-row${chat.id === activeChatId ? " active" : ""}`;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "chat-item";
    button.innerHTML = `
      <strong>${escapeHtml(chat.title)}</strong>
      <span>${chat.messages.length} · ${escapeHtml(t("messages"))} — ${escapeHtml(
        getSourceName(chat.source)
      )}</span>
    `;
    button.querySelector("strong").dir = "auto";
    button.querySelector("span").dir = activeLanguage.dir;
    button.addEventListener("click", () => {
      activeChatId = chat.id;
      setActiveSource(chat.source, false);
      closeMobileHistory();
      render();
    });

    const downloadButton = document.createElement("button");
    downloadButton.type = "button";
    downloadButton.className = "download-button chat-download";
    downloadButton.setAttribute("aria-label", t("downloadConversation", { title: chat.title }));
    downloadButton.innerHTML = DOWNLOAD_ICON;
    downloadButton.disabled = chat.messages.length === 0;
    downloadButton.addEventListener("click", () => downloadChat(chat));

    item.append(button, downloadButton);
    chatList.appendChild(item);
  });
}

function renderMessages() {
  const chat = getActiveChat();
  messages.innerHTML = "";

  if (!chat) {
    if (activeTitle) activeTitle.textContent = t("newConversation");
    return;
  }

  if (activeTitle) activeTitle.textContent = chat.title;
  setActiveSource(chat.source, false);

  if (chat.messages.length === 0) {
    messages.appendChild(createEmptyState());
    return;
  }

  chat.messages.forEach((item) => {
    // Loading indicator
    if (item.id === LOADING_MSG_ID) {
      const row = document.createElement("article");
      row.className = "message assistant";
      row.id = "loadingMessage";
      row.innerHTML = `
        <div class="bubble typing-bubble" aria-label="${escapeHtml(t("searchingAnswer"))}">
          <span class="typing-dot"></span>
          <span class="typing-dot"></span>
          <span class="typing-dot"></span>
        </div>`;
      messages.appendChild(row);
      messages.scrollTop = messages.scrollHeight;
      return;
    }

    const row = document.createElement("article");
    row.className = `message ${item.role}`;
    row.dataset.messageId = item.id;
    row.setAttribute("aria-busy", String(Boolean(item.isStreaming)));

    const bubble = document.createElement("div");
    bubble.className = `bubble${item.isStreaming ? " streaming-bubble" : ""}`;
    if (item.role === "assistant" && item.language) {
      const messageLanguage = getLanguage(item.language);
      bubble.lang = messageLanguage.code;
      bubble.dir = messageLanguage.dir;
    } else {
      bubble.dir = "auto";
    }

    if (item.role === "assistant") {
      bubble.innerHTML = renderMarkdown(item.text);
    } else {
      bubble.textContent = item.text;
    }

    row.appendChild(bubble);

    if (item.role === "assistant" && !item.isStreaming) {
      const actionBar = document.createElement("div");
      actionBar.className = "message-actions";

      const answerDownload = document.createElement("button");
      answerDownload.type = "button";
      answerDownload.className = "download-button answer-download";
      answerDownload.setAttribute("aria-label", t("downloadAnswer"));
      answerDownload.innerHTML = DOWNLOAD_ICON;
      answerDownload.addEventListener("click", () => downloadAnswer(chat, item));
      actionBar.appendChild(answerDownload);

      if (item.fromVoice) {
        const listenButton = document.createElement("button");
        listenButton.type = "button";
        listenButton.className = `listen-reply${speakingMessageId === item.id ? " playing" : ""}`;
        listenButton.setAttribute(
          "aria-label",
          speakingMessageId === item.id
            ? t("stopListening")
            : t("listenAnswer")
        );
        listenButton.innerHTML = `
          <svg viewBox="0 0 24 24" aria-hidden="true">
            ${
              speakingMessageId === item.id
                ? '<path d="M9 6v12M15 6v12" />'
                : '<path d="M4 9v6h4l5 4V5L8 9H4Z" /><path d="M16 9.5a4 4 0 0 1 0 5M18.5 7a7.5 7.5 0 0 1 0 10" />'
            }
          </svg>
          ${speakingMessageId === item.id ? escapeHtml(t("stop")) : escapeHtml(t("listen"))}
        `;
        listenButton.addEventListener("click", () => toggleAssistantAudio(item));
        actionBar.appendChild(listenButton);
      }

      row.appendChild(actionBar);
    }

    messages.appendChild(row);
  });

  messages.scrollTop = messages.scrollHeight;
}

function updateStreamingMessage(chat, item) {
  if (activeChatId !== chat.id) return;

  const row = Array.from(messages.querySelectorAll(".message")).find(
    (element) => element.dataset.messageId === item.id
  );
  const bubble = row?.querySelector(".bubble");

  if (!bubble) {
    renderMessages();
    return;
  }

  bubble.innerHTML = renderMarkdown(item.text);
  messages.scrollTop = messages.scrollHeight;
}

function createEmptyState() {
  const wrapper = document.createElement("div");
  wrapper.className = "empty-state";

  const inner = document.createElement("div");
  inner.className = "empty-state-inner";
  inner.dir = activeLanguage.dir;
  inner.innerHTML = `
    <div class="mark" aria-hidden="true"></div>
    <h2>${escapeHtml(t("emptyHeading"))}</h2>
    <p>${escapeHtml(t("emptySubtitle"))}</p>
    <div class="prompt-chips"></div>
  `;

  const chipBox = inner.querySelector(".prompt-chips");
  STARTER_PROMPTS.forEach((promptKey) => {
    const prompt = t(promptKey);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "prompt-chip";
    button.textContent = prompt;
    button.addEventListener("click", () => submitMessage(prompt));
    chipBox.appendChild(button);
  });

  wrapper.appendChild(inner);
  return wrapper;
}

// ─────────────────────────────────────────────────────────────────────────────
// Submit — async, calls real AI
// ─────────────────────────────────────────────────────────────────────────────

async function submitMessage(rawMessage, fromVoice = false) {
  const text = rawMessage.trim();
  if (!text) return;

  stopAssistantAudio();

  let chat = getActiveChat();
  if (!chat) {
    createChat();
    chat = getActiveChat();
  }

  chat.source = activeSource;
  const responseLanguageCode = activeLanguageCode;
  chat.messages.push({ id: createId(), role: "user", text, fromVoice, language: responseLanguageCode });

  if (chat.isUntitled) {
    chat.title = createTitle(text);
    chat.isUntitled = false;
  }

  messageInput.value = "";
  resizeInput();

  // Show loading indicator
  chat.messages.push({ id: LOADING_MSG_ID, role: "assistant", text: "" });
  render();

  const streamedReply = {
    id: createId(),
    role: "assistant",
    text: "",
    fromVoice,
    language: responseLanguageCode,
    isStreaming: true,
  };
  let streamStarted = false;
  let streamRenderFrame = null;

  function scheduleStreamingRender() {
    if (streamRenderFrame !== null) return;
    streamRenderFrame = window.requestAnimationFrame(() => {
      streamRenderFrame = null;
      updateStreamingMessage(chat, streamedReply);
    });
  }

  try {
    const reply = await callChatAPI(chat.source, chat.messages, (delta) => {
      if (!streamStarted) {
        chat.messages = chat.messages.filter((m) => m.id !== LOADING_MSG_ID);
        chat.messages.push(streamedReply);
        streamStarted = true;
        if (activeChatId === chat.id) renderMessages();
      }

      streamedReply.text += delta;
      scheduleStreamingRender();
    }, responseLanguageCode);

    if (!streamStarted) {
      chat.messages = chat.messages.filter((m) => m.id !== LOADING_MSG_ID);
      chat.messages.push(streamedReply);
    }

    streamedReply.text = reply;
    streamedReply.isStreaming = false;
  } catch (err) {
    chat.messages = chat.messages.filter((m) => m.id !== LOADING_MSG_ID);
    const errorText = `⚠️ ${err.message || t("genericError")}`;

    if (streamStarted) {
      streamedReply.text = `${streamedReply.text}\n\n${errorText}`;
      streamedReply.isStreaming = false;
    } else {
      chat.messages.push({
        id: createId(),
        role: "assistant",
        text: errorText,
        fromVoice,
        language: responseLanguageCode,
      });
    }
  }

  if (streamRenderFrame !== null) {
    window.cancelAnimationFrame(streamRenderFrame);
  }
  render();
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function createTitle(text) {
  return text.length > 42 ? `${text.slice(0, 39)}...` : text;
}

function sanitizeFileName(value) {
  return (value || "YPS AI chat")
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 72)
    .replace(/-+$/g, "")
    .toLowerCase();
}

function formatDate(value) {
  return new Intl.DateTimeFormat(activeLanguage.code, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value instanceof Date ? value : new Date(value));
}

function createTextFile(title, lines) {
  return [
    `${t("website")}: YPS AI`,
    `${t("date")}: ${formatDate(new Date())}`,
    `${t("title")}: ${title}`,
    "",
    ...lines,
    "",
  ].join("\n");
}

function downloadTextFile(fileName, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${sanitizeFileName(fileName)}.txt`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

function downloadAnswer(chat, message) {
  const title = `${chat.title} - ${t("answer")}`;
  const messageIndex = chat.messages.findIndex((m) => m.id === message.id);
  const prompt = [...chat.messages]
    .slice(0, messageIndex)
    .reverse()
    .find((m) => m.role === "user");
  const lines = [
    `${t("source")}: ${getSourceName(chat.source)}`,
    "",
    `${t("you")}: ${prompt ? prompt.text : ""}`,
    "",
    `${t("answer")}: ${message.text}`,
  ];
  downloadTextFile(title, createTextFile(title, lines));
}

function downloadChat(chat) {
  if (!chat.messages.length) return;
  const lines = [
    `${t("source")}: ${getSourceName(chat.source)}`,
    `${t("created")}: ${formatDate(chat.createdAt)}`,
    "",
    ...chat.messages
      .filter((m) => m.id !== LOADING_MSG_ID)
      .flatMap((m) => {
        const label = m.role === "user" ? t("you") : t("answer");
        return [`${label}: ${m.text}`, ""];
      }),
  ];
  downloadTextFile(chat.title, createTextFile(chat.title, lines));
}

function resizeInput() {
  messageInput.style.height = "auto";
  const styles = window.getComputedStyle(messageInput);
  const lineHeight = Number.parseFloat(styles.lineHeight) || 22;
  const padding =
    Number.parseFloat(styles.paddingTop) +
    Number.parseFloat(styles.paddingBottom) || 0;
  const maxHeight = lineHeight * MAX_INPUT_LINES + padding;
  const nextHeight = Math.min(messageInput.scrollHeight, maxHeight);
  messageInput.style.height = `${nextHeight}px`;
  messageInput.classList.toggle("multiline", messageInput.scrollHeight > 62);
  messageInput.classList.toggle("scrollable", messageInput.scrollHeight > maxHeight);
}

function getSourceName(source) {
  return t(SOURCE_TRANSLATION_KEYS[source] || "sourceAll");
}

function setActiveSource(source, updateChat = true) {
  activeSource = source;
  sourceLabel.textContent = getSourceName(source);
  sourceLabel.dir = activeLanguage.dir;

  sourceOptions.forEach((option) => {
    const isSelected = option.dataset.source === source;
    option.classList.toggle("selected", isSelected);
    option.setAttribute("aria-selected", String(isSelected));
  });

  if (updateChat) {
    const chat = getActiveChat();
    if (chat) {
      chat.source = source;
      renderHistory();
    }
  }
}

function closeSourceMenu() {
  sourcePicker.classList.remove("open");
  sourceTrigger.setAttribute("aria-expanded", "false");
}

function closeAccessibilityMenu() {
  accessibilityMenu.classList.remove("open");
  accessibilityButton.setAttribute("aria-expanded", "false");
}

function closeLanguageMenu(clearSearch = false) {
  languageMenu.classList.remove("open");
  languageButton.setAttribute("aria-expanded", "false");
  if (clearSearch && languageSearch.value) {
    languageSearch.value = "";
    renderLanguageList();
  }
}

function closeChatSearch(clearQuery = false) {
  chatSearch.hidden = true;
  chatSearchButton.setAttribute("aria-expanded", "false");
  if (clearQuery && chatSearchInput.value) {
    chatSearchInput.value = "";
    renderHistory();
  }
}

function closeMobileHistory() {
  sidebar.classList.remove("history-open");
  mobileHistoryButton.setAttribute("aria-expanded", "false");
}

function setListeningState(nextState, status = "") {
  isListening = nextState;
  micButton.classList.toggle("listening", nextState);
  micButton.setAttribute(
    "aria-label",
    nextState ? t("stopSpeech") : t("startSpeech")
  );
  speechStatus.textContent = status;
}

function appendTranscript(text) {
  const existing = messageInput.value.trimEnd();
  messageInput.value = existing ? `${existing} ${text}` : text;
  transcriptAddedDuringListen = true;
  resizeInput();
  messageInput.focus();
}

function toggleAssistantAudio(message) {
  if (speakingMessageId === message.id) {
    stopAssistantAudio();
    return;
  }
  speakAssistantReply(message.text, message.id);
}

function stopAssistantAudio() {
  if (speechSynthesisApi) speechSynthesisApi.cancel();
  speakingMessageId = null;
  speechStatus.textContent = "";
  renderMessages();
}

function speakAssistantReply(text, messageId) {
  if (!speechSynthesisApi) {
    speechStatus.textContent = t("audioNotSupported");
    return;
  }
  speechSynthesisApi.cancel();
  speakingMessageId = messageId;
  renderMessages();
  const utterance = new SpeechSynthesisUtterance(
    text.replace(/\s+/g, " ").trim()
  );
  utterance.lang = activeLanguage.speech;
  utterance.rate = 0.96;
  utterance.pitch = 1;
  utterance.addEventListener("start", () => {
    speechStatus.textContent = t("speaking");
  });
  utterance.addEventListener("end", () => {
    speakingMessageId = null;
    speechStatus.textContent = "";
    renderMessages();
  });
  utterance.addEventListener("error", () => {
    speakingMessageId = null;
    speechStatus.textContent = t("audioUnavailable");
    renderMessages();
  });
  speechSynthesisApi.speak(utterance);
}

function setupSpeechRecognition() {
  if (!SpeechRecognition) {
    speechStatus.textContent = t("speechNotSupported");
    micButton.disabled = true;
    return null;
  }

  const speech = new SpeechRecognition();
  speech.continuous = false;
  speech.interimResults = true;
  speech.lang = activeLanguage.speech;

  speech.addEventListener("start", () => {
    transcriptAddedDuringListen = false;
    stopRequested = false;
    if (speechSynthesisApi) speechSynthesisApi.cancel();
    setListeningState(true, t("listening"));
  });

  speech.addEventListener("result", (event) => {
    let interim = "";
    let finalText = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const transcript = event.results[index][0].transcript.trim();
      if (event.results[index].isFinal) {
        finalText += `${transcript} `;
      } else {
        interim += transcript;
      }
    }
    if (finalText.trim()) {
      appendTranscript(finalText.trim());
      voiceInputPending = true;
      stopRequested = true;
      setListeningState(false, t("readyToSend"));
      window.setTimeout(() => {
        try { speech.stop(); } catch (e) {
          setListeningState(false, t("readyToSend"));
        }
      }, 120);
    }
    if (!stopRequested) {
      speechStatus.textContent = interim || t("listening");
    }
  });

  speech.addEventListener("error", (event) => {
    const msg = event.error === "not-allowed" ? t("micPermissionDenied") : t("micUnavailable");
    setListeningState(false, msg);
  });

  speech.addEventListener("end", () => {
    setListeningState(false, transcriptAddedDuringListen ? t("readyToSend") : "");
    stopRequested = false;
  });

  return speech;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ─────────────────────────────────────────────────────────────────────────────
// Event listeners
// ─────────────────────────────────────────────────────────────────────────────

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const fromVoice = voiceInputPending;
  submitMessage(messageInput.value, fromVoice);
  voiceInputPending = false;
  transcriptAddedDuringListen = false;
  speechStatus.textContent = "";
});

messageInput.addEventListener("input", resizeInput);

sourceTrigger.addEventListener("click", () => {
  const isOpen = sourcePicker.classList.toggle("open");
  sourceTrigger.setAttribute("aria-expanded", String(isOpen));
  closeAccessibilityMenu();
  closeLanguageMenu();
});

sourceOptions.forEach((option) => {
  option.addEventListener("click", () => {
    setActiveSource(option.dataset.source);
    closeSourceMenu();
  });
});

accessibilityButton.addEventListener("click", () => {
  const isOpen = accessibilityMenu.classList.toggle("open");
  accessibilityButton.setAttribute("aria-expanded", String(isOpen));
  closeSourceMenu();
  closeLanguageMenu();
  closeMobileHistory();
});

languageButton.addEventListener("click", () => {
  const isOpen = languageMenu.classList.toggle("open");
  languageButton.setAttribute("aria-expanded", String(isOpen));
  closeSourceMenu();
  closeAccessibilityMenu();
  closeMobileHistory();
  if (isOpen) {
    renderLanguageList(languageSearch.value);
    window.setTimeout(() => languageSearch.focus(), 0);
  }
});

languageSearch.addEventListener("input", () => renderLanguageList(languageSearch.value));

largeTextToggle.addEventListener("change", () => {
  document.body.classList.toggle("large-text", largeTextToggle.checked);
});

contrastToggle.addEventListener("change", () => {
  document.body.classList.toggle("high-contrast", contrastToggle.checked);
});

colorBlindToggle.addEventListener("change", () => {
  document.body.classList.toggle("color-blind", colorBlindToggle.checked);
});

chatSearchButton.addEventListener("click", () => {
  const willOpen = chatSearch.hidden;
  chatSearch.hidden = !willOpen;
  chatSearchButton.setAttribute("aria-expanded", String(willOpen));
  if (willOpen) chatSearchInput.focus();
});

chatSearchInput.addEventListener("input", renderHistory);

mobileHistoryButton.addEventListener("click", () => {
  const isOpen = sidebar.classList.toggle("history-open");
  mobileHistoryButton.setAttribute("aria-expanded", String(isOpen));
  closeAccessibilityMenu();
  closeLanguageMenu();
  closeSourceMenu();
});

document.addEventListener("click", (event) => {
  if (!sourcePicker.contains(event.target)) closeSourceMenu();
  if (!accessibilityMenu.contains(event.target)) closeAccessibilityMenu();
  if (!languageMenu.contains(event.target)) closeLanguageMenu();
  if (!sidebar.contains(event.target)) closeMobileHistory();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeSourceMenu();
    closeAccessibilityMenu();
    closeLanguageMenu(true);
    closeChatSearch(true);
    closeMobileHistory();
  }
});

micButton.addEventListener("click", () => {
  if (!recognition) recognition = setupSpeechRecognition();
  if (!recognition) return;
  if (isListening) { recognition.stop(); return; }
  try { recognition.start(); } catch (e) {
    setListeningState(false, t("micAlreadyActive"));
  }
});



newChatButton.addEventListener("click", () => {
  closeChatSearch(true);
  closeMobileHistory();
  createChat();
});

aboutButton.addEventListener("click", () => {
  closeMobileHistory();
  aboutModal.showModal();
});
closeAboutButton.addEventListener("click", () => { aboutModal.close(); });
aboutModal.addEventListener("click", (event) => {
  if (event.target === aboutModal) aboutModal.close();
});

themeButton.addEventListener("click", () => {
  const isDark = document.body.classList.toggle("dark");
  if (brandLogo) brandLogo.src = isDark ? DARK_LOGO_SRC : LIGHT_LOGO_SRC;
  themeButton.setAttribute("aria-label", isDark ? t("switchLight") : t("switchDark"));
});

// ── Boot ──────────────────────────────────────────────────────────────────────
createChat();
setLanguage(readStoredLanguage(), { initial: true });
