# YPS AI ChatBot

## Multilingual support

The interface supports 61 language choices, including separate Kurmanji and Sorani Kurdish options. A complete, saved translation file for every language is part of the website in `locales/`. During the normal build these design translations are embedded directly into `app.js`, so changing the website language makes no file request and never calls an AI or translation API.

Chat is separate from interface translation. Every chat request sends the selected website language to the AI endpoint. Non-English questions are translated to English for knowledge-base retrieval, while the final response is generated in the selected website language. Speech recognition, speech synthesis, dates, accessibility labels, source names, and downloads follow the same setting. The page layout stays in its original position for every language; only text uses right-to-left direction where appropriate.

Run the automated checks with:

```sh
npm test
```

The browser loads the generated classic `app.js` bundle so all controls work in both traditional static hosting and module-aware hosting. After changing `script.js` or `i18n.js`, regenerate it with `npm run build`.

## OpenRouter setup

The chat endpoint supports OpenRouter directly and defaults to `nvidia/nemotron-3-super-120b-a12b:free` whenever `OPENROUTER_API_KEY` is configured. OpenRouter takes priority when keys for more than one provider are present.

Add these values in Vercel under **Project Settings → Environment Variables**:

```text
OPENROUTER_API_KEY=your-openrouter-key
API_BASE_URL=https://openrouter.ai/api/v1
AI_MODEL=nvidia/nemotron-3-super-120b-a12b:free
OPENROUTER_SITE_URL=https://your-domain.example
OPENROUTER_APP_NAME=YPS AI
```

`OPENROUTER_SITE_URL` and `OPENROUTER_APP_NAME` are optional attribution values. If `API_BASE_URL` or `AI_MODEL` still contains values from a previous NVIDIA or other-provider setup, replace them with the OpenRouter values above or delete them so the OpenRouter defaults are used. Keep the API key only in Vercel environment variables; never add it to the repository or browser code.

## GitHub Models setup

To use GitHub Models, add these values in Vercel and replace the model value with the exact publisher/model ID shown in the GitHub Models catalog:

```text
OPENAI_API_KEY=your-github-token
API_BASE_URL=https://models.github.ai/inference
AI_MODEL=openai/gpt-5
```

Remove any `OPENROUTER_API_KEY`, `NVIDIA_API_KEY`, or `DEEPSEEK_API_KEY` value unless that provider should take priority. The endpoint automatically removes unsupported `temperature` and legacy `max_tokens` fields for GitHub reasoning models such as `openai/gpt-5`. It also applies a smaller conversation and document budget for GitHub Models; if GitHub returns HTTP 413, it retries once with a compact request. Keep the GitHub token only in Vercel environment variables.
