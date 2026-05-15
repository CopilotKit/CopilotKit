# Voice input

## What This Demo Shows

Speech-to-text transcription feeding the CopilotKit chat composer. The
runtime advertises `audioFileTranscriptionEnabled: true`, which makes
CopilotChat render its mic button automatically. A "Play sample" button
bypasses mic permissions entirely for QA and screenshot flows.

## How to Interact

1. **Mic path** — click the mic icon in the chat composer, speak, click
   again. The transcript appears in the textarea; you press send.
2. **Sample path** — click "Play sample" to fetch the bundled
   `sample.wav`, POST it to the transcription endpoint, and write the
   result straight into the textarea.

## Technical Details

**Dedicated runtime route** — `/api/copilotkit-voice` is the only
CopilotKit runtime in this app that mounts a `transcriptionService`. The
presence of that service flips the runtime-info flag the composer checks
to decide whether to render the mic button. Scoping to this per-demo
route keeps the mic UI off every other chat.

**Transcription service** — `TranscriptionServiceOpenAI` wraps the OpenAI
Whisper API. The OpenAI client + runtime are constructed lazily on the
first request so the Next.js build step can run without `OPENAI_API_KEY`.

**Shared backend** — the voice demo does not introduce a new agent. The
runtime proxies to the same MS Agent Framework backend at the root path
(`/`) that other chat demos use; voice is an input-modality concern, not
an agent-behaviour concern.

**Sample audio** — drop a `<100KB` WAV file named `sample.wav` in
`public/demo-audio/`. The file is fetched client-side, base64-encoded,
and POSTed to the runtime URL using the single-route transcription
envelope (`{ method: "transcribe", body: { audio, mimeType, filename }}`).

**Composer injection** — CopilotChat owns its textarea state internally.
To drop transcribed text in, we grab the tagged
`[data-testid="copilot-chat-textarea"]`, call the native
`HTMLTextAreaElement.value` setter, and dispatch a synthetic `input`
event so React's controlled-input tracking observes the change.
