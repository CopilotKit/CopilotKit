# Voice — Langroid

Speech-to-text via `@copilotkit/voice`. The chat's mic button (rendered by `<CopilotChat />` when the runtime advertises `audioFileTranscriptionEnabled: true`) records, POSTs to `/api/copilotkit-voice/transcribe`, and the transcript lands in the composer. A bundled sample audio button drives the same transcription pipeline without requiring mic permissions, so Playwright and screenshot flows work end-to-end.

## Topology

- **Page** — `src/app/demos/voice/page.tsx`. Mounts `<CopilotKit useSingleEndpoint={false}>` so the V2 runtime URL routes `/info`, `/agent/:id/run`, `/transcribe` separately.
- **Sample button** — `src/app/demos/voice/sample-audio-button.tsx`. Fetches `public/demo-audio/sample.wav`, POSTs as multipart/form-data, writes the transcript into the textarea via the native value setter + `input` event.
- **Runtime route** — `src/app/api/copilotkit-voice/[[...slug]]/route.ts`. Wires the **V2** `CopilotRuntime` directly (the V1 wrapper drops `transcriptionService`). Registers an `HttpAgent` against the unified Langroid AG-UI backend at `${AGENT_URL}/` for the chat itself; transcription runs locally inside the Next.js process via `TranscriptionServiceOpenAI`.

## OPENAI_API_KEY

Transcription requires an OpenAI key. When unset, the route returns `401 AUTH_FAILED` instead of an opaque 500 — the guarded service throws an error message containing `"api key"`, which the V2 runtime maps to `AUTH_FAILED`.

## Sample asset

`public/demo-audio/sample.wav` is the bundled clip. The README in that directory documents the regeneration recipe (16kHz mono, ~3-5s, "What is the weather in Tokyo?"). The sample button caption advertises that exact phrase so QA scripts can soft-assert against it.
