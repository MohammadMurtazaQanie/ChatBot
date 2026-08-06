# YPS AI ChatBot

## Multilingual support

The interface supports 61 language choices, including separate Kurmanji and Sorani Kurdish options. A complete, saved translation file for every language is part of the website in `locales/`. During the normal build these design translations are embedded directly into `app.js`, so changing the website language makes no file request and never calls an AI or translation API.

Chat is separate from interface translation. Every chat request sends the selected website language to the AI endpoint. Non-English questions are translated to English for knowledge-base retrieval, while the final response is generated in the selected website language. Speech recognition, speech synthesis, dates, accessibility labels, source names, and downloads follow the same setting. The page layout stays in its original position for every language; only text uses right-to-left direction where appropriate.

Run the automated checks with:

```sh
npm test
```

The browser loads the generated classic `app.js` bundle so all controls work in both traditional static hosting and module-aware hosting. After changing `script.js` or `i18n.js`, regenerate it with `npm run build`.

## Gemini setup

The chat endpoint runs on the Gemini API through the `@google/genai` SDK and defaults to `models/gemini-3.6-flash`.

Create a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey), then add it in Vercel under **Project Settings → Environment Variables** for Production, Preview, and Development:

```text
GEMINI_API_KEY=your-gemini-key
```

`AI_MODEL` is an optional override and accepts either a bare id (`gemini-3.6-pro`) or a full resource name (`models/gemini-3.6-pro`).

Environment variables are applied at build time, so redeploy after adding or changing the key.

For local development, copy `.env.example` to `.env` and run `vercel dev`. `.env` is gitignored — keep the key only in Vercel environment variables and your local `.env`, never in the repository or browser code.
