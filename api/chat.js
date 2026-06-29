/**
 * YPS AI — Vercel Serverless Chat Endpoint
 * -----------------------------------------
 * POST /api/chat
 *
 * Body (JSON):
 *   {
 *     messages : [{ role: "user"|"assistant", text: "..." }, ...],
 *     context  : [{ source_name, category, text }, ...],   // retrieved chunks
 *     source   : "all" | "Academic Research" | ...
 *   }
 *
 * Response (JSON):
 *   { reply: "..." }   or   { error: "..." }
 *
 * Environment variables (set in Vercel dashboard → Settings → Environment Variables):
 *   DEEPSEEK_API_KEY   — your DeepSeek key  (starts with sk-)
 *   OPENAI_API_KEY     — OR your OpenAI key  (if you prefer OpenAI)
 *   AI_MODEL           — optional override, e.g. "deepseek-chat" or "gpt-4o-mini"
 *   API_BASE_URL       — optional override for the base URL
 */

export default async function handler(req, res) {
  // ── CORS ──────────────────────────────────────────────────────────────────
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ── API key & model ───────────────────────────────────────────────────────
  const apiKey =
    process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || null;

  if (!apiKey) {
    return res.status(500).json({
      error:
        "Server is missing an API key. Ask the site administrator to set DEEPSEEK_API_KEY in Vercel.",
    });
  }

  const isDeepSeek = Boolean(process.env.DEEPSEEK_API_KEY);
  const apiBase =
    process.env.API_BASE_URL ||
    (isDeepSeek ? "https://api.deepseek.com" : "https://api.openai.com");
  const model =
    process.env.AI_MODEL || (isDeepSeek ? "deepseek-chat" : "gpt-4o-mini");

  // ── Request body ──────────────────────────────────────────────────────────
  const { messages = [], context = [], source = "all" } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "No messages provided." });
  }

  // ── Build system prompt ───────────────────────────────────────────────────
  const sourceLabel =
    source === "all" ? "all available YPS source categories" : source;

  const contextBlock =
    context.length > 0
      ? "\n\nRELEVANT DOCUMENT EXCERPTS (use these as your primary evidence):\n\n" +
        context
          .map(
            (c, i) =>
              `[${i + 1}] "${c.source_name}" — ${c.category}:\n${c.text}`
          )
          .join("\n\n---\n\n")
      : "";

  const systemPrompt = `You are YPS AI, an expert assistant on the Youth, Peace and Security (YPS) agenda, anchored in UN Security Council Resolution 2250 (2015). You help organizations, academics, policymakers, and youth advocates understand and implement the YPS agenda.

You are currently drawing from: ${sourceLabel}.${contextBlock}

RESPONSE INSTRUCTIONS:
- Base your answer primarily on the document excerpts provided above.
- Cite sources inline using superscript-style markers like [1], [2], etc., matching the numbered excerpts above.
- End your response with a "**Sources:**" section that lists each cited document by its name and category.
- If the excerpts are insufficient, supplement with your general YPS knowledge and clearly note "Based on general YPS knowledge:".
- Be specific, evidence-based, and practical.
- Use clear paragraphs. You may use bullet points for lists.
- Aim for 200–400 words unless the question clearly requires more detail.`;

  // ── Call AI API ───────────────────────────────────────────────────────────
  let aiResponse;
  try {
    aiResponse = await fetch(`${apiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages.map((m) => ({
            role: m.role === "assistant" ? "assistant" : "user",
            content: m.text,
          })),
        ],
        max_tokens: 1500,
        temperature: 0.3,
      }),
    });
  } catch (networkErr) {
    console.error("Network error reaching AI API:", networkErr);
    return res
      .status(502)
      .json({ error: "Could not reach the AI service. Please try again." });
  }

  if (!aiResponse.ok) {
    const errText = await aiResponse.text();
    console.error(`AI API ${aiResponse.status}:`, errText);
    return res.status(aiResponse.status).json({
      error: `AI API returned an error (${aiResponse.status}). Please try again.`,
    });
  }

  const data = await aiResponse.json();
  const reply =
    data.choices?.[0]?.message?.content?.trim() || "No response generated.";

  return res.json({ reply });
}
