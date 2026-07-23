# QA: Voice Input — Claude Agent SDK (TypeScript)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy
- `OPENAI_API_KEY` is set on the deployment (Whisper transcription)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/voice`
- [ ] Verify the chat interface loads with the header "Voice input"
- [ ] Verify a "Play sample" button is visible
- [ ] Verify the composer mic button is rendered

### 2. Sample audio transcription

- [ ] Click "Play sample"
- [ ] Wait for status to change from "Transcribing…" back to idle
- [ ] Verify the chat input is populated with text similar to "What is the weather in Tokyo?"

### 3. Mic recording

- [ ] Click the mic button in the composer
- [ ] Grant microphone permission if prompted
- [ ] Speak briefly then click again to stop
- [ ] Verify transcribed text appears in the composer

### 4. Error handling (key missing)

- [ ] In a deployment without `OPENAI_API_KEY`, click the sample button
- [ ] Verify the demo surfaces a clean 401 error (not 500/503)

## Expected Results

- Chat loads within 3 seconds
- Transcription completes within 8 seconds for sample audio
- Auth-failed path returns HTTP 401 with a readable error message
