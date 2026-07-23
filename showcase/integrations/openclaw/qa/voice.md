# QA: Voice Input (OpenClaw)

Demo source: `src/app/demos/voice/page.tsx` (+ `voice-chat.tsx`, `sample-audio-button.tsx`)
Route: `/demos/voice` · Agent: `voice-demo`
Runtime: `/api/copilotkit-voice` (dedicated V2 runtime, `useSingleEndpoint={false}`)
Run against the real backend at `http://localhost:3119/demos/voice`.

Status: **supported**. Transcription is a runtime concern, not a gateway one —
the dedicated runtime mounts a `transcriptionService`, so voice does not depend
on any OpenClaw gateway capability (see `PARITY_NOTES.md`, "Voice").

## What it exercises

Speech-to-text into the chat composer. Two independent affordances live on the
page:

1. **Mic button** — rendered by `<CopilotChat />` only because the runtime at
   `/api/copilotkit-voice` advertises `audioFileTranscriptionEnabled: true` on
   `/info`. Click it, speak, click again; the audio is POSTed to the runtime's
   `/transcribe` endpoint (an OpenAI Whisper-backed `TranscriptionService`) and
   the returned text is dropped into the composer. This is the **only** path
   that exercises real transcription.
2. **"Try a sample audio" button** (`data-testid="voice-sample-audio-button"`) —
   a deterministic test/demo affordance. Clicking it **synchronously injects** a
   canned phrase (`"What is the weather in Tokyo?"`) into the composer via the
   DOM. No mic permission, no audio fetch, no `/transcribe` round-trip — so it
   works in Playwright and screenshot flows regardless of transcription health.

The chat itself is the standard pass-through path: once a message is sent, it
runs against the single OpenClaw gateway endpoint like every other demo. Voice
only governs how text _gets into_ the composer.

## Prerequisites

- Stack is up; demo reachable at the URL above.
- `OPENAI_API_KEY` is configured on the runtime (required for the mic path only;
  the sample button works without it).
- For the mic path: a browser supporting `MediaRecorder` (Chromium/Firefox/
  Safari 14+) and microphone hardware.

## Manual steps

1. Open the demo. Confirm the header **"Voice input"** renders, the
   **"Try a sample audio"** button is visible at top-right, and `<CopilotChat />`
   renders below it with a composer.
2. Confirm the composer shows a **microphone button** — this is the
   authoritative signal that `transcriptionService` is mounted on
   `/api/copilotkit-voice` (the button only renders when `/info` reports
   `audioFileTranscriptionEnabled: true`).
3. **Sample path (no mic):** click **"Try a sample audio"**. Confirm the
   composer textarea (`data-testid="copilot-chat-textarea"`) is _immediately_
   populated with `"What is the weather in Tokyo?"` — no async delay, no
   "Transcribing…" state.
4. Send the message. Within ~10s the agent responds coherently about the weather
   (plain text and/or a tool render, depending on the gateway's tool state).
5. **Mic path (manual):** click the microphone button, grant mic permission,
   speak a short phrase, click again to stop. Within a few seconds the composer
   fills with the transcribed text; send and confirm the agent responds.

## Assertion bar

- Mic button is present in the composer (proves the transcription runtime is
  wired; its absence means `/api/copilotkit-voice/info` isn't reporting
  `audioFileTranscriptionEnabled`).
- Sample button populates the textarea **synchronously** — no perceptible delay,
  button stays enabled.
- Mic path returns text resembling what was spoken (requires `OPENAI_API_KEY`).
- No console errors on the successful paths.

## Protocol-level check (no browser)

Confirm the runtime advertises transcription and that `/transcribe` is guarded:

- `GET http://localhost:3119/api/copilotkit-voice/info` → JSON with
  `audioFileTranscriptionEnabled: true`.
- With no `OPENAI_API_KEY` set, a `POST` to `/api/copilotkit-voice/transcribe`
  fails deterministically ("OPENAI_API_KEY not configured…") rather than
  hanging — the `GuardedOpenAITranscriptionService` throws when the delegate is
  absent.

## Caveats

- The sample button is **not** transcription — it bypasses the mic and
  `/transcribe` entirely and just writes canned text into the textarea via the
  native value setter + a synthetic `input` event. Only the mic path proves
  real speech-to-text.
- The mic path requires `OPENAI_API_KEY` on the runtime; without it the mic
  button still renders but transcription fails with the guard error above.
- Unlike some fleet siblings, this demo bundles **no** `sample.wav` — the sample
  affordance injects text directly, so there is no audio file to play or fetch.
- Transcription lives entirely in the CopilotKit runtime; the OpenClaw gateway
  plays no part in the voice path (it only handles the resulting chat run).
