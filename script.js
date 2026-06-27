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

const STARTER_PROMPTS = [
  "Summarize the Youth, Peace and Security agenda",
  "What are the best ways to include youth in decision-making?",
  "Draft project ideas for local peacebuilding in Central Asia",
  "What are the stages of developing a National Action Plan?",
];

let chats = [];
let activeChatId = null;
let activeSource = "all";

const chatList = document.querySelector("#chatList");
const chatSearchButton = document.querySelector("#chatSearchButton");
const chatSearch = document.querySelector("#chatSearch");
const chatSearchInput = document.querySelector("#chatSearchInput");
const messages = document.querySelector("#messages");
const activeTitle = document.querySelector("#activeTitle");
const brandLogo = document.querySelector(".brand-logo");
const chatForm = document.querySelector("#chatForm");
const messageInput = document.querySelector("#messageInput");
const sourcePicker = document.querySelector("#sourcePicker");
const sourceTrigger = document.querySelector("#sourceTrigger");
const sourceLabel = document.querySelector("#sourceLabel");
const sourceOptions = Array.from(document.querySelectorAll(".source-option"));
const micButton = document.querySelector("#micButton");
const speechStatus = document.querySelector("#speechStatus");
const newChatButton = document.querySelector("#newChatButton");
const aboutButton = document.querySelector("#aboutButton");
const aboutModal = document.querySelector("#aboutModal");
const closeAboutButton = document.querySelector("#closeAboutButton");
const themeButton = document.querySelector("#themeButton");
const accessibilityMenu = document.querySelector("#accessibilityMenu");
const accessibilityButton = document.querySelector("#accessibilityButton");
const largeTextToggle = document.querySelector("#largeTextToggle");
const contrastToggle = document.querySelector("#contrastToggle");
const colorBlindToggle = document.querySelector("#colorBlindToggle");
const copyrightYear = document.querySelector("#copyrightYear");
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const speechSynthesisApi = window.speechSynthesis;
const LIGHT_LOGO_SRC = "assets/yps-ai-logo.png?v=20260624-logo";
const DARK_LOGO_SRC = "assets/yps-ai-logo-dark.png?v=20260624-darkgrey";
const MAX_INPUT_LINES = 7;
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

function createId() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
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
          ...chat.messages.map((message) => message.text),
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
      <span>${chat.messages.length} messages - ${escapeHtml(chat.source === "all" ? "All sources" : chat.source)}</span>
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
    if (activeTitle) {
      activeTitle.textContent = "New conversation";
    }
    return;
  }

  if (activeTitle) {
    activeTitle.textContent = chat.title;
  }
  setActiveSource(chat.source, false);

  if (chat.messages.length === 0) {
    messages.appendChild(createEmptyState());
    return;
  }

  chat.messages.forEach((item) => {
    const row = document.createElement("article");
    row.className = `message ${item.role}`;

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = item.text;

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
          speakingMessageId === item.id ? "Stop listening to this answer" : "Listen to this answer",
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

function submitMessage(rawMessage, fromVoice = false) {
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
  render();

  window.setTimeout(() => {
    const reply = generateReply(text, chat.source, chat.messages);
    chat.messages.push({ id: createId(), role: "assistant", text: reply, fromVoice });
    render();
  }, 360);
}

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
  return [`Website: YPS AI`, `Date: ${formatDate(new Date())}`, `Title: ${title}`, "", ...lines, ""].join(
    "\n",
  );
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
  const messageIndex = chat.messages.findIndex((item) => item.id === message.id);
  const prompt = [...chat.messages]
    .slice(0, messageIndex)
    .reverse()
    .find((item) => item.role === "user");
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
    ...chat.messages.flatMap((message) => {
      const label = message.role === "user" ? "You" : "Answer";
      return [`${label}: ${message.text}`, ""];
    }),
  ];

  downloadTextFile(chat.title, createTextFile(chat.title, lines));
}

function generateReply(text, source, history) {
  const lower = text.toLowerCase();
  const sourceNote = SOURCE_NOTES[source] || SOURCE_NOTES.all;
  const priorTurns = Math.max(0, Math.floor((history.length - 1) / 2));

  if (lower.includes("national action plan") || lower.includes("nap")) {
    return `${sourceNote}\n\nA strong YPS National Action Plan should usually include: youth participation mechanisms, protection measures, prevention priorities, partnerships with youth-led organizations, budget lines, indicators, and a reporting cycle. Start by asking which young people are affected, who already leads peace work locally, and what decision spaces they can meaningfully enter.`;
  }

  if (lower.includes("resolution") || lower.includes("2250")) {
    return `${sourceNote}\n\nUN Security Council Resolution 2250 frames young people as partners in peace, not only as beneficiaries. Useful entry points are participation, protection, prevention, partnerships, and disengagement and reintegration. For a practical answer, connect each pillar to a concrete institution, budget, and youth-led accountability channel.`;
  }

  if (lower.includes("project") || lower.includes("proposal") || lower.includes("idea")) {
    return `${sourceNote}\n\nA compact YPS project concept could include: a youth-led conflict analysis, dialogue sessions with local authorities, small grants for community peace actions, psychosocial referral pathways, and a public learning brief. Keep the design participatory: young people should help define the problem, choose activities, monitor risks, and present the results.`;
  }

  if (lower.includes("participat") || lower.includes("peace process")) {
    return `${sourceNote}\n\nYouth participation works best when it moves beyond consultation. Consider reserved seats, paid advisory roles, youth caucuses, local-to-national feedback channels, and protection protocols for young peacebuilders who may face backlash. The key test is whether youth input can change decisions.`;
  }

  if (lower.includes("source") || lower.includes("about")) {
    return `${sourceNote}\n\nThis prototype is structured around these source modes: UN Resolutions & Frameworks, UN Publications, Regional Organizations Documents, National Action Plans and Strategies, Academic Research, Civil Society & NGO Publications, and All sources. A production version would connect these modes to a reviewed document library and cite exact documents in each answer.`;
  }

  return `${sourceNote}\n\nHere is a YPS-focused way to approach this: define the peace and security issue, identify which groups of young people are most affected, map the institutions with decision power, and choose one practical action that increases meaningful youth participation. This chat has ${priorTurns} earlier exchange${priorTurns === 1 ? "" : "s"} in temporary memory for this page session.`;
}

function resizeInput() {
  messageInput.style.height = "auto";
  const styles = window.getComputedStyle(messageInput);
  const lineHeight = Number.parseFloat(styles.lineHeight) || 22;
  const padding =
    Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.paddingBottom) || 0;
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
  micButton.setAttribute("aria-label", nextState ? "Stop speech to text" : "Start speech to text");
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
  if (speechSynthesisApi) {
    speechSynthesisApi.cancel();
  }
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
  const utterance = new SpeechSynthesisUtterance(text.replace(/\s+/g, " ").trim());
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
    if (speechSynthesisApi) {
      speechSynthesisApi.cancel();
    }
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
        try {
          speech.stop();
        } catch (error) {
          setListeningState(false, "Ready to send");
        }
      }, 120);
    }

    if (!stopRequested) {
      speechStatus.textContent = interim || "Listening";
    }
  });

  speech.addEventListener("error", (event) => {
    const message = event.error === "not-allowed" ? "Mic permission denied" : "Mic unavailable";
    setListeningState(false, message);
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

  if (willOpen) {
    chatSearchInput.focus();
  }
});

chatSearchInput.addEventListener("input", renderHistory);

document.addEventListener("click", (event) => {
  if (!sourcePicker.contains(event.target)) {
    closeSourceMenu();
  }
  if (!accessibilityMenu.contains(event.target)) {
    closeAccessibilityMenu();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeSourceMenu();
    closeAccessibilityMenu();
    closeChatSearch(true);
  }
});

micButton.addEventListener("click", () => {
  if (!recognition) {
    recognition = setupSpeechRecognition();
  }

  if (!recognition) {
    return;
  }

  if (isListening) {
    recognition.stop();
    return;
  }

  try {
    recognition.start();
  } catch (error) {
    setListeningState(false, "Mic already active");
  }
});

newChatButton.addEventListener("click", () => {
  closeChatSearch(true);
  createChat();
});

aboutButton.addEventListener("click", () => {
  aboutModal.showModal();
});

closeAboutButton.addEventListener("click", () => {
  aboutModal.close();
});

aboutModal.addEventListener("click", (event) => {
  if (event.target === aboutModal) {
    aboutModal.close();
  }
});

themeButton.addEventListener("click", () => {
  const isDark = document.body.classList.toggle("dark");
  if (brandLogo) {
    brandLogo.src = isDark ? DARK_LOGO_SRC : LIGHT_LOGO_SRC;
  }
  themeButton.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
});

createChat();
