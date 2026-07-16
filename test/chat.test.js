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
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OPENROUTER_SITE_URL: process.env.OPENROUTER_SITE_URL,
    OPENROUTER_APP_NAME: process.env.OPENROUTER_APP_NAME,
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
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_SITE_URL;
  delete process.env.OPENROUTER_APP_NAME;
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
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_SITE_URL;
  delete process.env.OPENROUTER_APP_NAME;
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

test("OpenRouter credentials select the Nemotron free model and attribution headers", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnvironment = saveProviderEnvironment();
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  process.env.OPENROUTER_SITE_URL = "https://example.vercel.app";
  process.env.OPENROUTER_APP_NAME = "YPS AI";
  delete process.env.NVIDIA_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.API_BASE_URL;
  delete process.env.AI_MODEL;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, headers: options.headers, body: JSON.parse(options.body) });
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
    assert.equal(requests[0].url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(requests[0].headers.Authorization, "Bearer test-openrouter-key");
    assert.equal(requests[0].headers["HTTP-Referer"], "https://example.vercel.app");
    assert.equal(requests[0].headers["X-OpenRouter-Title"], "YPS AI");
    assert.equal(requests[0].body.model, "nvidia/nemotron-3-super-120b-a12b:free");
    assert.equal(requests[0].body.stream, true);
  } finally {
    globalThis.fetch = originalFetch;
    restoreProviderEnvironment(originalEnvironment);
  }
});

test("GitHub GPT-5 omits unsupported sampling and legacy token parameters", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnvironment = saveProviderEnvironment();
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_SITE_URL;
  delete process.env.OPENROUTER_APP_NAME;
  delete process.env.NVIDIA_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  process.env.OPENAI_API_KEY = "test-github-token";
  process.env.API_BASE_URL = '"https://models.github.ai/inference/chat/completions"';
  process.env.AI_MODEL = '"https://github.com/marketplace/models/azure-openai/gpt-5"';

  const requests = [];
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push({ url, headers: options.headers, body });

    if (body.stream === false) {
      return new Response(JSON.stringify({
        choices: [{ message: { content: "Explain youth participation in peacebuilding." } }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return streamedAIResponse("Réponse GPT-5");
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
    for (const request of requests) {
      assert.equal(request.url, "https://models.github.ai/inference/chat/completions");
      assert.equal(request.body.model, "openai/gpt-5");
      assert.equal("temperature" in request.body, false);
      assert.equal("max_tokens" in request.body, false);
    }
    assert.equal(requests[0].body.stream, false);
    assert.equal(requests[1].body.stream, true);
    assert.match(res.chunks.join(""), /Réponse GPT-5/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreProviderEnvironment(originalEnvironment);
  }
});

test("GitHub Models returns the provider's useful error detail", async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const originalEnvironment = saveProviderEnvironment();
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_SITE_URL;
  delete process.env.OPENROUTER_APP_NAME;
  delete process.env.NVIDIA_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  process.env.OPENAI_API_KEY = "test-github-token";
  process.env.API_BASE_URL = "https://models.github.ai/inference";
  process.env.AI_MODEL = "openai/gpt-5";

  console.error = () => {};
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: {
      message: "Unsupported request field for this model.",
      code: "invalid_request_error",
    },
  }), {
    status: 404,
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

    assert.equal(res.statusCode, 404);
    assert.match(res.jsonBody.error, /Unsupported request field for this model/);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
    restoreProviderEnvironment(originalEnvironment);
  }
});

test("GitHub Models retries a rejected request with a compact payload", async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const originalEnvironment = saveProviderEnvironment();
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_SITE_URL;
  delete process.env.OPENROUTER_APP_NAME;
  delete process.env.NVIDIA_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  process.env.OPENAI_API_KEY = "test-github-token";
  process.env.API_BASE_URL = "https://models.github.ai/inference";
  process.env.AI_MODEL = "openai/gpt-4o";

  const requests = [];
  console.warn = () => {};
  globalThis.fetch = async (url, options) => {
    requests.push({
      url,
      headers: options.headers,
      body: JSON.parse(options.body),
    });

    if (requests.length === 1) {
      return new Response(JSON.stringify({ message: "Payload is too large" }), {
        status: 413,
        headers: { "Content-Type": "application/json" },
      });
    }

    return streamedAIResponse("Compact response");
  };

  try {
    const messages = [];
    for (let index = 1; index <= 12; index += 1) {
      messages.push({
        role: "user",
        text: `Question ${index} about youth participation ${"x".repeat(500)}`,
      });
      messages.push({
        role: "assistant",
        text: `Answer ${index} ${"y".repeat(500)}`,
      });
    }
    messages.push({
      role: "user",
      text: "Explain youth participation in peacebuilding.",
    });

    const req = {
      method: "POST",
      body: { language: "en", source: "all", messages },
    };
    const res = new StreamingResponse();
    await chatHandler(req, res);

    assert.equal(requests.length, 2);
    assert.equal(requests[0].url, "https://models.github.ai/inference/chat/completions");
    assert.equal(requests[0].headers.Authorization, "Bearer test-github-token");
    assert.equal(requests[0].headers.Accept, "application/vnd.github+json");
    assert.equal(requests[0].headers["X-GitHub-Api-Version"], "2026-03-10");
    assert.equal(requests[0].body.model, "openai/gpt-4o");
    assert.equal(requests[0].body.max_tokens, 1200);
    assert.ok(requests[0].body.messages.length <= 10);

    assert.equal(requests[1].body.max_tokens, 800);
    assert.ok(requests[1].body.messages.length <= 4);
    assert.doesNotMatch(
      requests[1].body.messages[0].content,
      /RELEVANT DOCUMENT EXCERPTS/
    );
    assert.match(res.chunks.join(""), /Compact response/);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    restoreProviderEnvironment(originalEnvironment);
  }
});
