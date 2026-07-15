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
    NVIDIA_API_KEY: process.env.NVIDIA_API_KEY,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    API_BASE_URL: process.env.API_BASE_URL,
    AI_MODEL: process.env.AI_MODEL,
  };
}

function restoreProviderEnvironment(original) {
  for (const [name, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function useOpenAITestProvider() {
  delete process.env.NVIDIA_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.API_BASE_URL;
  delete process.env.AI_MODEL;
  process.env.OPENAI_API_KEY = "test-key";
}

function streamedAIResponse(text = "Test response") {
  const stream = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}`,
    "",
    "data: [DONE]",
    "",
  ].join("\n");
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

test("a mismatched selected source is blocked before the model is called", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnvironment = saveProviderEnvironment();
  useOpenAITestProvider();
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
  useOpenAITestProvider();
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
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
    assert.equal(requests[0].body.messages.length, 22);
    assert.equal(requests[0].body.messages[1].content, "Question 3 about youth participation");
    assert.equal(requests[0].body.messages.at(-1).content, "Tell me more about its stages");
    assert.match(requests[0].body.messages[0].content, /CONVERSATION MEMORY/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreProviderEnvironment(originalEnvironment);
  }
});

test("developer attribution is returned directly without calling the model", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnvironment = saveProviderEnvironment();
  useOpenAITestProvider();
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
    assert.match(res.chunks.join(""), /Murtaza Qanie, Yahya Qanie, Lena Slachmuijlder, and Saji Prelis/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreProviderEnvironment(originalEnvironment);
  }
});

test("model and API questions receive the humorous security-response guidance", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnvironment = saveProviderEnvironment();
  useOpenAITestProvider();
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return streamedAIResponse("Nice try—my technical backstage pass stays backstage. I can help with YPS instead.");
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
    const systemPrompt = requests[0].body.messages[0].content;
    assert.match(systemPrompt, /begin with a light, friendly joke/);
    assert.match(systemPrompt, /internal technical details stay private/);
    assert.doesNotMatch(systemPrompt, /RELEVANT DOCUMENT EXCERPTS/);
    assert.match(res.chunks.join(""), /technical backstage pass stays backstage/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreProviderEnvironment(originalEnvironment);
  }
});

test("NVIDIA credentials select the NVIDIA endpoint and GLM streaming settings", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnvironment = saveProviderEnvironment();
  process.env.NVIDIA_API_KEY = "test-nvidia-key";
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.API_BASE_URL;
  delete process.env.AI_MODEL;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
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
    assert.equal(requests[0].url, "https://integrate.api.nvidia.com/v1/chat/completions");
    assert.equal(requests[0].body.model, "z-ai/glm-5.2");
    assert.equal(requests[0].body.max_tokens, 16384);
    assert.equal(requests[0].body.top_p, 1);
    assert.equal(requests[0].body.seed, 42);
  } finally {
    globalThis.fetch = originalFetch;
    restoreProviderEnvironment(originalEnvironment);
  }
});
