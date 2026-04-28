# QA: Voice input — Claude Agent SDK (Python)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)
- `ANTHROPIC_API_KEY` is set on the deployment (for chat replies)
- `OPENAI_API_KEY` is set on the Next.js runtime (for Whisper
  transcription). If it is not, the mic button still renders but
  clicking it (or clicking "Play sample") will return a clean 401.

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/voice`
- [ ] Verify the "Voice input" header renders
- [ ] Verify the mic button is visible on the chat composer
- [ ] Verify the "Play sample" button renders next to a caption
      matching `SAMPLE_LABEL` (e.g. "What is the weather in Tokyo?")

### 2. Feature-Specific Checks

#### Play sample

- [ ] Click "Play sample"
- [ ] Verify the button flips to "Transcribing…" briefly
- [ ] Verify the composer's textarea is populated with the transcribed
      text
- [ ] Press send and verify Claude replies to the transcribed prompt

#### Mic button (manual)

- [ ] Click the mic button, allow microphone access, speak a short
      sentence, click again
- [ ] Verify the textarea is populated with the transcription
- [ ] Press send and verify Claude replies

### 3. Misconfigured deployment

- [ ] With `OPENAI_API_KEY` unset, click "Play sample"
- [ ] Verify the error slot renders "Error — see console"
- [ ] Verify the network response is HTTP 401, not 500/503

### 4. Error Handling

- [ ] No console errors during normal usage (other than the expected
      401 when `OPENAI_API_KEY` is missing).

## Expected Results

- Mic button always visible (transcription service is always mounted).
- Missing `OPENAI_API_KEY` manifests as 401, not silent failure.
