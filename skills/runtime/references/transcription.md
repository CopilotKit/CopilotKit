# CopilotKit Transcription

Subclass `TranscriptionService`, pass an instance to `CopilotRuntime({ transcriptionService })`,
and the `POST /transcribe` endpoint lights up. The service has a single method,
`transcribeFile`, that returns the transcript as a plain string.

## Setup

```typescript
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  TranscriptionService,
  type TranscribeFileOptions,
} from "@copilotkit/runtime/v2";
import OpenAI from "openai";

class OpenAIWhisperTranscription extends TranscriptionService {
  private client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  async transcribeFile({ audioFile }: TranscribeFileOptions): Promise<string> {
    const result = await this.client.audio.transcriptions.create({
      file: audioFile,
      model: "whisper-1",
    });
    return result.text;
  }
}

const runtime = new CopilotRuntime({
  agents: {
    /* ... */
  } as any,
  transcriptionService: new OpenAIWhisperTranscription(),
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export default { fetch: handler };
```

## Core Patterns

### Abstract contract

```typescript
// packages/runtime/src/v2/runtime/transcription-service/transcription-service.ts
export interface TranscribeFileOptions {
  audioFile: File;
  mimeType?: string;
  size?: number;
}

export abstract class TranscriptionService {
  abstract transcribeFile(options: TranscribeFileOptions): Promise<string>;
}
```

### Supported request shapes

Multipart (REST mode):

```typescript
const form = new FormData();
form.append("audio", blob, "recording.webm");
await fetch("/api/copilotkit/transcribe", { method: "POST", body: form });
```

JSON (works in both multi-route and single-endpoint modes — dispatch is by
`Content-Type: application/json`; `mimeType` is required in the payload):

```typescript
await fetch("/api/copilotkit/transcribe", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    audio: base64String,
    mimeType: "audio/webm",
    filename: "recording.webm", // optional
  }),
});
```

### Reject oversize audio with a graceful 400

```typescript
class OpenAIWhisperTranscription extends TranscriptionService {
  private client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  async transcribeFile({
    audioFile,
    size,
  }: TranscribeFileOptions): Promise<string> {
    const max = 25 * 1024 * 1024; // 25 MB
    if ((size ?? audioFile.size) > max) {
      // "too long" keyword → audio_too_long response
      throw new Error("Audio duration too long — max 25MB per upload");
    }
    const result = await this.client.audio.transcriptions.create({
      file: audioFile,
      model: "whisper-1",
    });
    return result.text;
  }
}
```

### Error auto-categorization

The runtime inspects `String(error).toLowerCase()` thrown by your service and maps keywords
to error codes. Let the provider error bubble up — do not re-categorize inside the service.

| Keyword substrings                       | Maps to                          |
| ---------------------------------------- | -------------------------------- |
| `rate`, `429`, `too many`                | `rate_limited` (retryable)       |
| `auth`, `401`, `api key`, `unauthorized` | `auth_failed` (not retryable)    |
| `too long`, `duration`, `length`         | `audio_too_long` (not retryable) |
| (anything else)                          | `provider_error` (retryable)     |

Full error-code enum:

```typescript
// packages/shared/src/transcription-errors.ts
export enum TranscriptionErrorCode {
  SERVICE_NOT_CONFIGURED = "service_not_configured",
  INVALID_AUDIO_FORMAT = "invalid_audio_format",
  AUDIO_TOO_LONG = "audio_too_long",
  AUDIO_TOO_SHORT = "audio_too_short",
  RATE_LIMITED = "rate_limited",
  AUTH_FAILED = "auth_failed",
  PROVIDER_ERROR = "provider_error",
  NETWORK_ERROR = "network_error",
  INVALID_REQUEST = "invalid_request",
}
```

## Common Mistakes

### HIGH Calling /transcribe without configuring transcriptionService

Wrong:

```typescript
new CopilotRuntime({ agents });
// client calls /api/copilotkit/transcribe → 503
```

Correct:

```typescript
new CopilotRuntime({
  agents,
  transcriptionService: new MyWhisperService(),
});
```

Unconfigured runtime returns HTTP 503 with
`{ error: "service_not_configured" }`. The frontend gets no transcript with no obvious
server-side failure.

Source: `packages/runtime/src/v2/runtime/handlers/handle-transcribe.ts:203-207`.

### MEDIUM Form field named "file" instead of "audio"

Wrong:

```typescript
const form = new FormData();
form.append("file", blob, "recording.webm");
await fetch("/api/copilotkit/transcribe", { method: "POST", body: form });
```

Correct:

```typescript
const form = new FormData();
form.append("audio", blob, "recording.webm");
await fetch("/api/copilotkit/transcribe", { method: "POST", body: form });
```

The handler reads `formData.get("audio")` — any other field name yields `null` and returns
`invalid_request`.

Source: `packages/runtime/src/v2/runtime/handlers/handle-transcribe.ts:91-97`.

### MEDIUM Base64 payload missing mimeType

Wrong:

```typescript
await fetch("/api/copilotkit/transcribe", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ audio: b64 }),
});
```

Correct:

```typescript
await fetch("/api/copilotkit/transcribe", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ audio: b64, mimeType: "audio/webm" }),
});
```

JSON mode requires `mimeType` — the handler explicitly rejects payloads missing it with
`invalid_request`.

Source: `packages/runtime/src/v2/runtime/handlers/handle-transcribe.ts:131-136`.

### LOW Re-categorizing errors inside the service

Wrong:

```typescript
class MyService extends TranscriptionService {
  async transcribeFile(opts: TranscribeFileOptions): Promise<string> {
    try {
      return await doTranscribe(opts);
    } catch (e) {
      // trying to hand-pick error codes
      throw new Error("RATE_LIMITED");
    }
  }
}
```

Correct:

```typescript
class MyService extends TranscriptionService {
  async transcribeFile(opts: TranscribeFileOptions): Promise<string> {
    return doTranscribe(opts); // let provider errors bubble up verbatim
  }
}
```

The runtime scans `String(error).toLowerCase()` for `"rate"`, `"429"`, `"auth"`, `"too long"`
etc. Provider-native messages (`"OpenAI returned 429 rate limited"`) auto-map to the right
code. Hand-crafted codes bypass the keyword matcher and end up as `provider_error`.

Source: `packages/runtime/src/v2/runtime/handlers/handle-transcribe.ts:160-196`.

### MEDIUM Returning a rich object instead of a string

Wrong:

```typescript
class MyService extends TranscriptionService {
  async transcribeFile(opts: TranscribeFileOptions): Promise<string> {
    // @ts-expect-error returning the wrong shape
    return {
      text: "hi",
      segments: [
        /* ... */
      ],
    };
  }
}
```

Correct:

```typescript
class MyService extends TranscriptionService {
  async transcribeFile(opts: TranscribeFileOptions): Promise<string> {
    const result = await provider.transcribe(opts.audioFile);
    return result.text;
  }
}
```

`transcribeFile` returns `Promise<string>`. The handler sends
`{ transcription: string }` back to the client — any other shape is a TypeScript error and
would be JSON-stringified wrongly at runtime.

Source: `packages/runtime/src/v2/runtime/transcription-service/transcription-service.ts:9-11`.

## See also

- `copilotkit/setup-endpoint` — `/transcribe` is one of the routes the handler mounts
- `copilotkit/debug-and-troubleshoot` — `TranscriptionErrorCode` catalog
