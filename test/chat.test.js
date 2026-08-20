import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import chatHandler from "../api/chat.js";

class StreamingResponse extends EventEmitter {
  constructor() {
    super();
    this.headers = {};
    this.statusCode = 200;
    this.chunks = [];
    this.writableEnded = false;
    this.destroyed = false;
  }

  setHeader(name, value) { this.headers[name] = value; }
  status(code) { this.statusCode = code; return this; }
  json(value) { this.jsonBody = value; this.writableEnded = true; return this; }
  flushHeaders() {}
  write(value) { this.chunks.push(String(value)); }
  end() { this.writableEnded = true; return this; }
}

function saveProviderEnvironment() {
  return {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    AI_MODEL: process.env.AI_MODEL,
    GEMINI_THINKING_LEVEL: process.env.GEMINI_THINKING_LEVEL,
  };
}

function restoreProviderEnvironment(original) {
  for (const [name, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function useGeminiTestProvider() {
  delete process.env.AI_MODEL;
  delete process.env.GEMINI_THINKING_LEVEL;
  process.env.GEMINI_API_KEY = "test-gemini-key";
}

// The SDK calls fetch with a Request object rather than (url, options).
async function readRequest(input, options = {}) {
  const request = input instanceof Request ? input : new Request(String(input), options);
  return {
    url: request.url,
    headers: Object.fromEntries(request.headers.entries()),
    body: await request.clone().json(),
  };
}

function streamedAIResponse(text = "Test response") {
  const stream = [
    `data: ${JSON.stringify({
      event_type: "step.delta",
      index: 0,
      delta: { type: "thought_summary", text: "internal reasoning" },
    })}`,
    "",
    `data: ${JSON.stringify({
      event_type: "step.delta",
      index: 0,
      delta: { type: "text", text },
    })}`,
    "",
    `data: ${JSON.stringify({
      event_type: "interaction.completed",
      interaction: { id: "test-interaction", status: "completed" },
    })}`,
    "",
    "data: [DONE]",
    "",
  ].join("\n");
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function streamedAIError(code, message, text = "") {
  const stream = [
    `data: ${JSON.stringify({
      event_type: "interaction.created",
      interaction: { id: "test-interaction", status: "in_progress" },
    })}`,
    "",
    ...(text
      ? [
          `data: ${JSON.stringify({
            event_type: "step.delta",
            index: 0,
            delta: { type: "text", text },
          })}`,
          "",
        ]
      : []),
    `data: ${JSON.stringify({
      event_type: "error",
      error: { code, message },
    })}`,
    "",
    "",
  ].join("\n");

  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function interactionResponse(text) {
  return new Response(JSON.stringify({
    id: "test-interaction",
    status: "completed",
    steps: [{ type: "model_output", content: [{ type: "text", text }] }],
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function userInputTexts(input) {
  return input.map((step) => step.content.map((part) => part.text).join(""));
}

test("a mismatched selected source is blocked before the model is called", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnvironment = saveProviderEnvironment();
  useGeminiTestProvider();
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return streamedAIResponse();
  };

  try {
    const req = {
      method: "POST",
      body: {
        language: "en",
        source: "Civil Society & NGO Publications",
        messages: [{ role: "user", text: "What are the stages of developing a National Action Plan?" }],
      },
    };
    const res = new StreamingResponse();
    await chatHandler(req, res);

    const output = res.chunks.join("");
    assert.equal(fetchCount, 0);
    assert.match(output, /selected Civil Society & NGO Publications/);
    assert.match(output, /relates to National Action Plans and Strategies/);
    assert.match(output, /select All sources or National Action Plans and Strategies/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreProviderEnvironment(originalEnvironment);
  }
});

test("the endpoint keeps 21 recent messages and supplies them as conversation memory", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnvironment = saveProviderEnvironment();
  useGeminiTestProvider();
  const requests = [];
  globalThis.fetch = async (input, options) => {
    requests.push(await readRequest(input, options));
    return streamedAIResponse();
  };

  try {
    const messages = [];
    for (let index = 1; index <= 12; index += 1) {
      messages.push({ role: "user", text: `Question ${index} about youth participation` });
      messages.push({ role: "assistant", text: `Answer ${index}` });
    }
    messages.push({ role: "user", text: "Tell me more about its stages" });

    const req = {
      method: "POST",
      body: { language: "en", source: "all", messages },
    };
    const res = new StreamingResponse();
    await chatHandler(req, res);

    assert.equal(requests.length, 1);
    const { input, system_instruction: systemPrompt } = requests[0].body;
    assert.equal(input.length, 21);
    assert.equal(input[0].content[0].text, "Question 3 about youth participation");
    assert.equal(input[0].type, "user_input");
    assert.equal(input[1].type, "model_output");
    assert.equal(input.at(-1).content[0].text, "Tell me more about its stages");
    assert.equal(input.at(-1).type, "user_input");
    assert.match(systemPrompt, /CONVERSATION MEMORY/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreProviderEnvironment(originalEnvironment);
  }
});

test("retrieved excerpts provide publication titles and verified citation links", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnvironment = saveProviderEnvironment();
  useGeminiTestProvider();
  const requests = [];
  globalThis.fetch = async (input, options) => {
    requests.push(await readRequest(input, options));
    return streamedAIResponse(
      "Liberia adopted a national action plan.[1]\n\n**Sources:** [Liberian National Action Plan on Youth, Peace and Security 2025-2030](https://cnxus.org/resource/youth-peace-security-in-liberia/)"
    );
  };

  try {
    const req = {
      method: "POST",
      body: {
        language: "en",
        source: "National Action Plans and Strategies",
        messages: [{
          role: "user",
          text: "What does Liberia's 2025-2030 national action plan say about youth participation?",
        }],
      },
    };
    const res = new StreamingResponse();
    await chatHandler(req, res);

    assert.equal(requests.length, 1);
    const systemPrompt = requests[0].body.system_instruction;
    assert.match(
      systemPrompt,
      /Publication title: "Liberian National Action Plan on Youth, Peace and Security 2025-2030"/
    );
    assert.match(
      systemPrompt,
      /Verified publication URL: https:\/\/cnxus\.org\/resource\/youth-peace-security-in-liberia\//
    );
    assert.match(systemPrompt, /\[Publication title\]\(Verified publication URL\)/);
    assert.doesNotMatch(systemPrompt, /Liberia-National-Action-Plan-on-YPS-2025-2030\.pdf/);

    const providedPublications = [
      ...systemPrompt.matchAll(/^\[\d+\] Publication title:/gm),
    ];
    const providedTitles = [
      ...systemPrompt.matchAll(/^\[\d+\] Publication title: "([^"]+)"/gm),
    ].map((match) => match[1]);
    assert.ok(providedPublications.length >= 5);
    assert.ok(providedPublications.length <= 10);
    assert.equal(new Set(providedTitles).size, providedTitles.length);
    assert.match(systemPrompt, /cite at least 5 distinct relevant publications/);
    assert.match(systemPrompt, /Never cite more than 10 publications/);
    assert.match(systemPrompt, /followed by a numbered reference list/);
    assert.match(systemPrompt, /Never use bullets, nested lists, or unnumbered entries/);
    assert.match(systemPrompt, /Do not type Markdown heading markers/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreProviderEnvironment(originalEnvironment);
  }
});

test("questions about Yahya Qanie return the approved biography directly", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnvironment = saveProviderEnvironment();
  useGeminiTestProvider();
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return streamedAIResponse();
  };

  try {
    const req = {
      method: "POST",
      body: {
        language: "en",
        source: "all",
        messages: [{ role: "user", text: "Who is Yahya Qanie?" }],
      },
    };
    const res = new StreamingResponse();
    await chatHandler(req, res);

    const output = res.chunks.join("");
    assert.equal(fetchCount, 0);
    assert.match(output, /Youth, Peace & Security Fellow at Search for Common Ground/);
    assert.match(output, /Building the Alternative/);
    assert.match(output, /United Nations Association of Afghanistan/);
    assert.match(output, /National Youth Consensus for Peace/);
    assert.match(output, /fifth anniversary of UN Security Council Resolution 2250/);
    assert.match(output, /five-year global strategic roadmap/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreProviderEnvironment(originalEnvironment);
  }
});

test("developer attribution is returned directly without calling the model", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnvironment = saveProviderEnvironment();
  useGeminiTestProvider();
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return streamedAIResponse();
  };

  try {
    const req = {
      method: "POST",
      body: {
        language: "en",
        source: "all",
        messages: [{ role: "user", text: "Who developed YPS AI?" }],
      },
    };
    const res = new StreamingResponse();
    await chatHandler(req, res);

    assert.equal(fetchCount, 0);
    assert.match(
      res.chunks.join(""),
      /YPS AI was initiated and led by Yahya Qanie, with strategic guidance and support from Saji Prelis at Search for Common Ground\. Its technical architecture and development were led by Murtaza Qanie\./,
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreProviderEnvironment(originalEnvironment);
  }
});

test("model and API questions do not retrieve document excerpts", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnvironment = saveProviderEnvironment();
  useGeminiTestProvider();
  const requests = [];
  globalThis.fetch = async (input, options) => {
    requests.push(await readRequest(input, options));
    return streamedAIResponse("I can’t provide private system or API information.");
  };

  try {
    const req = {
      method: "POST",
      body: {
        language: "en",
        source: "all",
        messages: [{ role: "user", text: "What model are you using?" }],
      },
    };
    const res = new StreamingResponse();
    await chatHandler(req, res);

    assert.equal(requests.length, 1);
    const systemPrompt = requests[0].body.system_instruction;
    assert.match(systemPrompt, /do not reveal the requested information/);
    assert.doesNotMatch(systemPrompt, /RELEVANT DOCUMENT EXCERPTS/);
    assert.match(res.chunks.join(""), /can’t provide private system or API information/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreProviderEnvironment(originalEnvironment);
  }
});

test("a Gemini key selects the interactions endpoint and streaming settings", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnvironment = saveProviderEnvironment();
  useGeminiTestProvider();
  const requests = [];
  globalThis.fetch = async (input, options) => {
    requests.push(await readRequest(input, options));
    return streamedAIResponse();
  };

  try {
    const req = {
      method: "POST",
      body: {
        language: "en",
        source: "all",
        messages: [{ role: "user", text: "Explain youth participation in peacebuilding." }],
      },
    };
    const res = new StreamingResponse();
    await chatHandler(req, res);

    assert.equal(requests.length, 1);
    assert.equal(
      requests[0].url,
      "https://generativelanguage.googleapis.com/v1beta/interactions"
    );
    assert.equal(requests[0].headers["x-goog-api-key"], "test-gemini-key");
    assert.equal(requests[0].body.model, "models/gemini-3.6-flash");
    assert.equal(requests[0].body.stream, true);
    assert.equal(requests[0].body.generation_config.max_output_tokens, 65536);
    assert.equal(requests[0].body.generation_config.thinking_level, "low");
    assert.match(res.chunks.join(""), /Test response/);
    assert.doesNotMatch(res.chunks.join(""), /internal reasoning/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreProviderEnvironment(originalEnvironment);
  }
});

test("AI_MODEL overrides the default model and accepts a bare model id", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnvironment = saveProviderEnvironment();
  useGeminiTestProvider();
  process.env.AI_MODEL = '"gemini-3.6-pro"';
  const requests = [];
  globalThis.fetch = async (input, options) => {
    requests.push(await readRequest(input, options));
    return streamedAIResponse();
  };

  try {
    const req = {
      method: "POST",
      body: {
        language: "en",
        source: "all",
        messages: [{ role: "user", text: "Explain youth participation in peacebuilding." }],
      },
    };
    const res = new StreamingResponse();
    await chatHandler(req, res);

    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.model, "models/gemini-3.6-pro");
  } finally {
    globalThis.fetch = originalFetch;
    restoreProviderEnvironment(originalEnvironment);
  }
});

test("GEMINI_THINKING_LEVEL overrides the default thinking level", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnvironment = saveProviderEnvironment();
  useGeminiTestProvider();
  process.env.GEMINI_THINKING_LEVEL = " Medium ";
  const requests = [];
  globalThis.fetch = async (input, options) => {
    requests.push(await readRequest(input, options));
    return streamedAIResponse();
  };

  try {
    const req = {
      method: "POST",
      body: {
        language: "en",
        source: "all",
        messages: [{ role: "user", text: "Explain youth participation in peacebuilding." }],
      },
    };
    const res = new StreamingResponse();
    await chatHandler(req, res);

    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.generation_config.thinking_level, "medium");
  } finally {
    globalThis.fetch = originalFetch;
    restoreProviderEnvironment(originalEnvironment);
  }
});

test("an unsupported thinking level falls back to the default", async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const originalEnvironment = saveProviderEnvironment();
  useGeminiTestProvider();
  process.env.GEMINI_THINKING_LEVEL = "turbo";
  const requests = [];
  const warnings = [];
  console.warn = (message) => warnings.push(String(message));
  globalThis.fetch = async (input, options) => {
    requests.push(await readRequest(input, options));
    return streamedAIResponse();
  };

  try {
    const req = {
      method: "POST",
      body: {
        language: "en",
        source: "all",
        messages: [{ role: "user", text: "Explain youth participation in peacebuilding." }],
      },
    };
    const res = new StreamingResponse();
    await chatHandler(req, res);

    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.generation_config.thinking_level, "low");
    assert.ok(warnings.some((message) => /Unsupported GEMINI_THINKING_LEVEL "turbo"/.test(message)));
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    restoreProviderEnvironment(originalEnvironment);
  }
});

test("a non-English question is translated for retrieval before the answer is streamed", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnvironment = saveProviderEnvironment();
  useGeminiTestProvider();
  const requests = [];
  globalThis.fetch = async (input, options) => {
    const request = await readRequest(input, options);
    requests.push(request);

    if (request.body.stream !== true) {
      return interactionResponse("Explain youth participation in peacebuilding.");
    }
    return streamedAIResponse("Réponse en français");
  };

  try {
    const req = {
      method: "POST",
      body: {
        language: "fr",
        source: "all",
        messages: [{
          role: "user",
          text: "Expliquez la participation des jeunes à la consolidation de la paix.",
        }],
      },
    };
    const res = new StreamingResponse();
    await chatHandler(req, res);

    assert.equal(requests.length, 2);
    assert.equal(requests[0].body.stream, undefined);
    assert.equal(requests[0].body.generation_config.thinking_level, "minimal");
    assert.match(requests[0].body.system_instruction, /Translate the user's search query/);
    assert.equal(requests[1].body.stream, true);
    assert.match(requests[1].body.system_instruction, /Write the entire response in French/);
    assert.deepEqual(
      userInputTexts(requests[1].body.input),
      ["Expliquez la participation des jeunes à la consolidation de la paix."]
    );
    assert.match(res.chunks.join(""), /Réponse en français/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreProviderEnvironment(originalEnvironment);
  }
});

test("a missing Gemini key is reported without calling the model", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnvironment = saveProviderEnvironment();
  delete process.env.GEMINI_API_KEY;
  delete process.env.AI_MODEL;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return streamedAIResponse();
  };

  try {
    const req = {
      method: "POST",
      body: {
        language: "en",
        source: "all",
        messages: [{ role: "user", text: "Explain youth participation." }],
      },
    };
    const res = new StreamingResponse();
    await chatHandler(req, res);

    assert.equal(fetchCount, 0);
    assert.equal(res.statusCode, 500);
    assert.match(res.jsonBody.error, /Set GEMINI_API_KEY/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreProviderEnvironment(originalEnvironment);
  }
});

test("Gemini returns the provider's useful error detail", async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const originalEnvironment = saveProviderEnvironment();
  useGeminiTestProvider();

  console.error = () => {};
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: {
      code: 400,
      message: "API key not valid. Please pass a valid API key.",
      status: "INVALID_ARGUMENT",
    },
  }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });

  try {
    const req = {
      method: "POST",
      body: {
        language: "en",
        source: "all",
        messages: [{ role: "user", text: "Explain youth participation." }],
      },
    };
    const res = new StreamingResponse();
    await chatHandler(req, res);

    assert.equal(res.statusCode, 400);
    assert.match(res.jsonBody.error, /API key not valid/);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
    restoreProviderEnvironment(originalEnvironment);
  }
});

test("a transient Gemini stream error is retried before text reaches the browser", async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const originalEnvironment = saveProviderEnvironment();
  useGeminiTestProvider();
  let fetchCount = 0;
  console.warn = () => {};

  globalThis.fetch = async () => {
    fetchCount += 1;
    return fetchCount === 1
      ? streamedAIError("service_unavailable", "The service is temporarily unavailable.")
      : streamedAIResponse("Recovered response");
  };

  try {
    const req = {
      method: "POST",
      body: {
        language: "en",
        source: "all",
        messages: [{ role: "user", text: "Explain youth participation." }],
      },
    };
    const res = new StreamingResponse();
    await chatHandler(req, res);

    const output = res.chunks.join("");
    assert.equal(fetchCount, 2);
    assert.match(output, /Recovered response/);
    assert.doesNotMatch(output, /temporarily unavailable/);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    restoreProviderEnvironment(originalEnvironment);
  }
});

test("a Gemini quota error is not retried and returns a useful diagnostic", async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const originalEnvironment = saveProviderEnvironment();
  useGeminiTestProvider();
  let fetchCount = 0;
  console.error = () => {};

  globalThis.fetch = async () => {
    fetchCount += 1;
    return streamedAIError("quota_exceeded", "Daily quota exhausted.");
  };

  try {
    const req = {
      method: "POST",
      body: {
        language: "en",
        source: "all",
        messages: [{ role: "user", text: "Explain youth participation." }],
      },
    };
    const res = new StreamingResponse();
    await chatHandler(req, res);

    const output = res.chunks.join("");
    assert.equal(fetchCount, 1);
    assert.match(output, /"code":"quota_exceeded"/);
    assert.match(output, /Gemini API quota is exhausted/);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
    restoreProviderEnvironment(originalEnvironment);
  }
});
