// ─────────────────────────────────────────────────────────────────────────────
// YPS AI — frontend script
// ─────────────────────────────────────────────────────────────────────────────

// ── Source labels ─────────────────────────────────────────────────────────────
const SOURCE_NOTES = {
  all: "I am considering all configured YPS source groups together.",
  "UN Resolutions & Frameworks":
    "I am focusing on UN resolutions, frameworks, and peace and security commitments relevant to YPS.",
  "UN Publications":
    "I am focusing on UN publications, guidance, policy briefs, and system-wide YPS learning.",
  "Regional Organizations Documents":
    "I am focusing on regional organization documents, strategies, declarations, and guidance related to YPS.",
  "National Action Plans and Strategies":
    "I am focusing on National Action Plans, strategies, and how public institutions translate YPS commitments into action.",
  "Academic Research":
    "I am focusing on academic research, evidence, concepts, methods, and debates relevant to YPS.",
  "Civil Society & NGO Publications":
    "I am focusing on civil society and NGO publications, youth-led peacebuilding practice, advocacy, and local implementation lessons.",
};

// Map source picker values → knowledge base file keys
const SOURCE_TO_KB_KEY = {
  all: ["un-resolutions", "un-publications", "regional-org", "nap-strategies", "academic-research", "ngo-civil-society"],
  "UN Resolutions & Frameworks": ["un-resolutions"],
  "UN Publications": ["un-publications"],
  "Regional Organizations Documents": ["regional-org"],
  "National Action Plans and Strategies": ["nap-strategies"],
  "Academic Research": ["academic-research"],
  "Civil Society & NGO Publications": ["ngo-civil-society"],
};

const STARTER_PROMPTS = [
  "Summarize the Youth, Peace and Security agenda",
  "What are the best ways to include youth in decision-making?",
  "Draft project ideas for local peacebuilding in Central Asia",
  "What are the stages of developing a National Action Plan?",
];

// ── Chat state ────────────────────────────────────────────────────────────────
let chats = [];
let activeChatId = null;
let activeSource = "all";

// ── Knowledge base cache (loaded lazily per category) ─────────────────────────
const kbCache = {};       // { "academic-research": [...chunks], ... }
const kbLoading = {};     // { "academic-research": Promise, ... }

// ── DOM refs ──────────────────────────────────────────────────────────────────
const chatList            = document.querySelector("#chatList");
const chatSearchButton    = document.querySelector("#chatSearchButton");
const chatSearch          = document.querySelector("#chatSearch");
const chatSearchInput     = document.querySelector("#chatSearchInput");
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
const largeTextToggle     = document.querySelector("#largeTextToggle");
const contrastToggle      = document.querySelector("#contrastToggle");
const colorBlindToggle    = document.querySelector("#colorBlindToggle");
const copyrightYear       = document.querySelector("#copyrightYear");
const SpeechRecognition   = window.SpeechRecognition || window.webkitSpeechRecognition;
const speechSynthesisApi  = window.speechSynthesis;

const LIGHT_LOGO_SRC  = "assets/yps-ai-logo.png?v=20260624-logo";
const DARK_LOGO_SRC   = "assets/yps-ai-logo-dark.png?v=20260624-darkgrey";
const MAX_INPUT_LINES = 7;
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

// ─────────────────────────────────────────────────────────────────────────────
// Knowledge base helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Load a single category JSON file, with deduplication via the promise cache. */
function loadKBCategory(key) {
  if (kbCache[key]) return Promise.resolve(kbCache[key]);
  if (kbLoading[key]) return kbLoading[key];

  kbLoading[key] = fetch(`knowledge/${key}.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`${key}.json not found (${r.status})`);
      return r.json();
    })
    .then((chunks) => {
      kbCache[key] = chunks;
      return chunks;
    })
    .catch((err) => {
      console.warn(`[KB] Could not load ${key}:`, err.message);
      kbCache[key] = [];
      return [];
    });

  return kbLoading[key];
}

/** Load all category files required for the active source filter. */
async function loadKBForSource(source) {
  const keys = SOURCE_TO_KB_KEY[source] || SOURCE_TO_KB_KEY.all;
  const results = await Promise.all(keys.map(loadKBCategory));
  return results.flat();
}

// ─────────────────────────────────────────────────────────────────────────────
// Retrieval — simple TF-IDF-style keyword scoring
// ─────────────────────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "the","a","an","and","or","but","in","on","at","to","for","of","with",
  "is","are","was","were","be","been","being","have","has","had","do","does",
  "did","will","would","could","should","may","might","shall","can","that",
  "this","these","those","it","its","we","our","they","their","you","your",
  "i","my","he","she","his","her","as","by","from","not","no","so","if","about",
]);

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

function scoreChunk(chunkText, queryTokens) {
  const tokens = tokenize(chunkText);
  const freq = {};
  for (const t of tokens) freq[t] = (freq[t] || 0) + 1;

  let score = 0;
  for (const qt of queryTokens) {
    if (freq[qt]) score += 1 + Math.log(freq[qt]);
    // Partial prefix match (e.g. "youth" matches "youthful")
    for (const t in freq) {
      if (t !== qt && t.startsWith(qt)) score += 0.3;
    }
  }
  return score;
}

function retrieveContext(chunks, query, topK = 5) {
  if (!chunks.length) return [];
  const queryTokens = tokenize(query);
  if (!queryTokens.length) return [];

  return chunks
    .map((c) => ({ ...c, _score: scoreChunk(c.text, queryTokens) }))
    .filter((c) => c._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, topK);
}

// ─────────────────────────────────────────────────────────────────────────────
// API call
// ─────────────────────────────────────────────────────────────────────────────

async function callChatAPI(query, source, history) {
  // Load and search the knowledge base
  const allChunks = await loadKBForSource(source);
  const context = retrieveContext(allChunks, query, 5);

  // Build message history for the API (last 10 turns max to stay within limits)
  const apiMessages = history
    .filter((m) => m.id !== LOADING_MSG_ID)
    .slice(-10)
    .map((m) => ({ role: m.role, text: m.text }));

  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: apiMessages, context, source }),
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    throw new Error(data.error || `Server error (${response.status})`);
  }

  return data.reply;
}

// ─────────────────────────────────────────────────────────────────────────────
// Markdown → HTML (minimal, safe)
// ─────────────────────────────────────────────────────────────────────────────

function renderMarkdown(text) {
  // Escape raw HTML first so we don't accidentally inject anything
  let html = text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

  // Bold **text**
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // Italic *text* or _text_
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(/_(.+?)_/g, "<em>$1</em>");

  // Inline citation markers [1], [2] → superscript
  html = html.replace(/\[(\d+)\]/g, "<sup class='cite'>[$1]</sup>");

  // Split into lines for block-level processing
  const lines = html.split("\n");
  const out = [];
  let inUL = false;
  let inOL = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ulMatch = line.match(/^[-*•]\s+(.+)/);
    const olMatch = line.match(/^\d+\.\s+(.+)/);

    if (ulMatch) {
      if (!inUL) { out.push("<ul>"); inUL = true; }
      if (inOL)  { out.push("</ol>"); inOL = false; }
      out.push(`<li>${ulMatch[1]}</li>`);
    } else if (olMatch) {
      if (!inOL) { out.push("<ol>"); inOL = true; }
      if (inUL)  { out.push("</ul>"); inUL = false; }
      out.push(`<li>${olMatch[1]}</li>`);
    } else {
      if (inUL) { out.push("</ul>"); inUL = false; }
      if (inOL) { out.push("</ol>"); inOL = false; }

      if (line.trim() === "") {
        // Paragraph break
        if (out.length && out[out.length - 1] !== "<br>") out.push("<br>");
      } else {
        out.push(line);
        out.push("<br>");
      }
    }
  }
  if (inUL) out.push("</ul>");
  if (inOL) out.push("</ol>");

  // Clean up multiple consecutive <br>
  return out.join("\n").replace(/(<br>\s*){3,}/g, "<br><br>");
}

// ─────────────────────────────────────────────────────────────────────────────
// Chat state
// ─────────────────────────────────────────────────────────────────────────────

function createId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : String(Date.now());
}

function createChat() {
  const chat = {
    id: createId(),
    title: "New conversation",
    source: "all",
    messages: [],
    createdAt: new Date(),
  };
  chats.unshift(chat);
  activeChatId = chat.id;
  render();
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
    empty.textContent = "No matching chats";
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
      <span>${chat.messages.length} messages - ${escapeHtml(
        chat.source === "all" ? "All sources" : chat.source
      )}</span>
    `;
    button.addEventListener("click", () => {
      activeChatId = chat.id;
      setActiveSource(chat.source, false);
      render();
    });

    const downloadButton = document.createElement("button");
    downloadButton.type = "button";
    downloadButton.className = "download-button chat-download";
    downloadButton.setAttribute("aria-label", `Download ${chat.title} conversation`);
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
    if (activeTitle) activeTitle.textContent = "New conversation";
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
        <div class="bubble typing-bubble" aria-label="Searching sources and generating answer">
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

    const bubble = document.createElement("div");
    bubble.className = "bubble";

    if (item.role === "assistant") {
      bubble.innerHTML = renderMarkdown(item.text);
    } else {
      bubble.textContent = item.text;
    }

    row.appendChild(bubble);

    if (item.role === "assistant") {
      const actionBar = document.createElement("div");
      actionBar.className = "message-actions";

      const answerDownload = document.createElement("button");
      answerDownload.type = "button";
      answerDownload.className = "download-button answer-download";
      answerDownload.setAttribute("aria-label", "Download this answer");
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
            ? "Stop listening to this answer"
            : "Listen to this answer"
        );
        listenButton.innerHTML = `
          <svg viewBox="0 0 24 24" aria-hidden="true">
            ${
              speakingMessageId === item.id
                ? '<path d="M9 6v12M15 6v12" />'
                : '<path d="M4 9v6h4l5 4V5L8 9H4Z" /><path d="M16 9.5a4 4 0 0 1 0 5M18.5 7a7.5 7.5 0 0 1 0 10" />'
            }
          </svg>
          ${speakingMessageId === item.id ? "Stop" : "Listen"}
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

function createEmptyState() {
  const wrapper = document.createElement("div");
  wrapper.className = "empty-state";

  const inner = document.createElement("div");
  inner.className = "empty-state-inner";
  inner.innerHTML = `
    <div class="mark" aria-hidden="true"></div>
    <h2><span>Ask focused questions about</span><span>Youth, Peace and Security.</span></h2>
    <p>Choose a source group and start a conversation.</p>
    <div class="prompt-chips"></div>
  `;

  const chipBox = inner.querySelector(".prompt-chips");
  STARTER_PROMPTS.forEach((prompt) => {
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
  chat.messages.push({ id: createId(), role: "user", text, fromVoice });

  if (chat.title === "New conversation") {
    chat.title = createTitle(text);
  }

  messageInput.value = "";
  resizeInput();

  // Show loading indicator
  chat.messages.push({ id: LOADING_MSG_ID, role: "assistant", text: "" });
  render();

  try {
    const reply = await callChatAPI(text, chat.source, chat.messages);
    // Remove loading indicator and add real reply
    chat.messages = chat.messages.filter((m) => m.id !== LOADING_MSG_ID);
    chat.messages.push({ id: createId(), role: "assistant", text: reply, fromVoice });
  } catch (err) {
    chat.messages = chat.messages.filter((m) => m.id !== LOADING_MSG_ID);
    chat.messages.push({
      id: createId(),
      role: "assistant",
      text: `⚠️ ${err.message || "Something went wrong. Please try again."}`,
      fromVoice,
    });
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
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value instanceof Date ? value : new Date(value));
}

function createTextFile(title, lines) {
  return [
    `Website: YPS AI`,
    `Date: ${formatDate(new Date())}`,
    `Title: ${title}`,
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
  const title = `${chat.title} - Answer`;
  const messageIndex = chat.messages.findIndex((m) => m.id === message.id);
  const prompt = [...chat.messages]
    .slice(0, messageIndex)
    .reverse()
    .find((m) => m.role === "user");
  const lines = [
    `Source: ${getSourceName(chat.source)}`,
    "",
    `You: ${prompt ? prompt.text : ""}`,
    "",
    `Answer: ${message.text}`,
  ];
  downloadTextFile(title, createTextFile(title, lines));
}

function downloadChat(chat) {
  if (!chat.messages.length) return;
  const lines = [
    `Source: ${getSourceName(chat.source)}`,
    `Created: ${formatDate(chat.createdAt)}`,
    "",
    ...chat.messages
      .filter((m) => m.id !== LOADING_MSG_ID)
      .flatMap((m) => {
        const label = m.role === "user" ? "You" : "Answer";
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
  return source === "all" ? "All sources" : source;
}

function setActiveSource(source, updateChat = true) {
  activeSource = source;
  sourceLabel.textContent = getSourceName(source);

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

function closeChatSearch(clearQuery = false) {
  chatSearch.hidden = true;
  chatSearchButton.setAttribute("aria-expanded", "false");
  if (clearQuery && chatSearchInput.value) {
    chatSearchInput.value = "";
    renderHistory();
  }
}

function setListeningState(nextState, status = "") {
  isListening = nextState;
  micButton.classList.toggle("listening", nextState);
  micButton.setAttribute(
    "aria-label",
    nextState ? "Stop speech to text" : "Start speech to text"
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
    speechStatus.textContent = "Audio not supported";
    return;
  }
  speechSynthesisApi.cancel();
  speakingMessageId = messageId;
  renderMessages();
  const utterance = new SpeechSynthesisUtterance(
    text.replace(/\s+/g, " ").trim()
  );
  utterance.lang = "en-US";
  utterance.rate = 0.96;
  utterance.pitch = 1;
  utterance.addEventListener("start", () => {
    speechStatus.textContent = "Speaking";
  });
  utterance.addEventListener("end", () => {
    speakingMessageId = null;
    speechStatus.textContent = "";
    renderMessages();
  });
  utterance.addEventListener("error", () => {
    speakingMessageId = null;
    speechStatus.textContent = "Audio unavailable";
    renderMessages();
  });
  speechSynthesisApi.speak(utterance);
}

function setupSpeechRecognition() {
  if (!SpeechRecognition) {
    speechStatus.textContent = "Speech not supported";
    micButton.disabled = true;
    return null;
  }

  const speech = new SpeechRecognition();
  speech.continuous = false;
  speech.interimResults = true;
  speech.lang = "en-US";

  speech.addEventListener("start", () => {
    transcriptAddedDuringListen = false;
    stopRequested = false;
    if (speechSynthesisApi) speechSynthesisApi.cancel();
    setListeningState(true, "Listening");
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
      setListeningState(false, "Ready to send");
      window.setTimeout(() => {
        try { speech.stop(); } catch (e) {
          setListeningState(false, "Ready to send");
        }
      }, 120);
    }
    if (!stopRequested) {
      speechStatus.textContent = interim || "Listening";
    }
  });

  speech.addEventListener("error", (event) => {
    const msg = event.error === "not-allowed" ? "Mic permission denied" : "Mic unavailable";
    setListeningState(false, msg);
  });

  speech.addEventListener("end", () => {
    setListeningState(false, transcriptAddedDuringListen ? "Ready to send" : "");
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
});

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

document.addEventListener("click", (event) => {
  if (!sourcePicker.contains(event.target)) closeSourceMenu();
  if (!accessibilityMenu.contains(event.target)) closeAccessibilityMenu();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeSourceMenu();
    closeAccessibilityMenu();
    closeChatSearch(true);
  }
});

micButton.addEventListener("click", () => {
  if (!recognition) recognition = setupSpeechRecognition();
  if (!recognition) return;
  if (isListening) { recognition.stop(); return; }
  try { recognition.start(); } catch (e) {
    setListeningState(false, "Mic already active");
  }
});

newChatButton.addEventListener("click", () => {
  closeChatSearch(true);
  createChat();
});

aboutButton.addEventListener("click", () => { aboutModal.showModal(); });
closeAboutButton.addEventListener("click", () => { aboutModal.close(); });
aboutModal.addEventListener("click", (event) => {
  if (event.target === aboutModal) aboutModal.close();
});

themeButton.addEventListener("click", () => {
  const isDark = document.body.classList.toggle("dark");
  if (brandLogo) brandLogo.src = isDark ? DARK_LOGO_SRC : LIGHT_LOGO_SRC;
  themeButton.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
});

// ── Boot ──────────────────────────────────────────────────────────────────────
createChat();
