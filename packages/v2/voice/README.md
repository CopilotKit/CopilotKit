# @copilotkit/voice

Audio transcription providers for CopilotKit.

## Setup

```bash
pnpm add @copilotkit/voice openai
```

```typescript
import { CopilotRuntime, createCopilotEndpoint } from "@copilotkitnext/runtime";
import { TranscriptionServiceOpenAI } from "@copilotkit/voice";
import OpenAI from "openai";

const runtime = new CopilotRuntime({
  agents: { default: yourAgent },
  transcriptionService: new TranscriptionServiceOpenAI({
    openai: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
  }),
});
```

Once configured, the chat UI shows a microphone button. Users can record audio, which gets transcribed and inserted into the input field as text.

## TranscriptionServiceOpenAI

Uses [OpenAI Whisper](https://platform.openai.com/docs/guides/speech-to-text) for transcription.

```typescript
new TranscriptionServiceOpenAI({
  openai: new OpenAI({ apiKey: "..." }), // required
  model: "whisper-1", // default
  language: "en", // optional, ISO-639-1 code
  prompt: "Technical discussion context", // optional, helps with domain terms
  temperature: 0, // optional, 0 = deterministic
});
```

## Custom providers

Extend `TranscriptionService` from runtime:

```typescript
import {
  TranscriptionService,
  TranscribeFileOptions,
} from "@copilotkitnext/runtime";

class MyTranscriptionService extends TranscriptionService {
  async transcribeFile(options: TranscribeFileOptions): Promise<string> {
    // options.audioFile, options.mimeType, options.size
    return "transcribed text";
  }
}
```
