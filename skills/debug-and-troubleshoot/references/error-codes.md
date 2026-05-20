# CopilotKit v2 Error Codes — Catalog, Root Causes, Resolutions

Reference table for every v2 `CopilotKitCoreErrorCode` and
`TranscriptionErrorCode`. All v2 codes are **snake_case string values**.
The enum name is uppercase (`CopilotKitCoreErrorCode.RUNTIME_INFO_FETCH_FAILED`)
but the string value is lowercase
(`"runtime_info_fetch_failed"`) — equality checks must compare to the
string value.

## Reading this table

Each row has:

- **Code** — the snake_case string literal (what `event.code ===` checks).
- **Enum member** — the `CopilotKitCoreErrorCode.*` member.
- **Root cause** — what produces this code.
- **Resolution** — the first thing to check.

## CopilotKitCoreErrorCode (17 codes)

Source: `packages/core/src/core/core.ts:71-105`.

| Code                                   | Enum member                            | Root cause                                                                  | Resolution                                                                                                                                               |
| -------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runtime_info_fetch_failed`            | `RUNTIME_INFO_FETCH_FAILED`            | Client cannot reach `/info` on the runtime.                                 | Verify `runtimeUrl` (leading slash, correct origin), CORS, `credentials` if using cookie auth, and that the runtime is actually listening.               |
| `agent_connect_failed`                 | `AGENT_CONNECT_FAILED`                 | Agent SSE connection refused or dropped before a run starts.                | Check the agent's `connect()` implementation; inspect the Network tab for the SSE request status.                                                        |
| `agent_run_failed`                     | `AGENT_RUN_FAILED`                     | Agent `runAgent()` threw synchronously or the HTTP fetch failed.            | Check server Pino logs for the thrown error; verify LLM credentials and adapter config.                                                                  |
| `agent_run_failed_event`               | `AGENT_RUN_FAILED_EVENT`               | The agent emitted a `RUN_ERROR` event during the stream.                    | Read the `context.event` payload for the AG-UI error event message.                                                                                      |
| `agent_run_error_event`                | `AGENT_RUN_ERROR_EVENT`                | A tool call errored and the agent surfaced it as a run-level error.         | Check `context.toolName` and `context.error` for the specific tool failure.                                                                              |
| `tool_argument_parse_failed`           | `TOOL_ARGUMENT_PARSE_FAILED`           | The LLM returned tool arguments that failed the `parameters` schema.        | Tighten the zod schema's descriptions so the model complies, or add lenient fallbacks (`z.string().catch("")`).                                          |
| `tool_handler_failed`                  | `TOOL_HANDLER_FAILED`                  | The `handler` function on a `useFrontendTool` / `defineTool` threw.         | Wrap the handler in try/catch and return a structured error; inspect `context.error`.                                                                    |
| `tool_not_found`                       | `TOOL_NOT_FOUND`                       | Agent called a tool name that isn't registered on the active agent.         | Verify the `name` matches on both sides; if using `agentId` scoping, confirm the tool is scoped to the correct agent.                                    |
| `agent_not_found`                      | `AGENT_NOT_FOUND`                      | Client passed `agentId` that doesn't exist on the runtime.                  | Match `<CopilotChat agentId="default">` / `useAgent({ agentId })` string to `CopilotRuntime({ agents: { [key]: ... } })` key.                            |
| `agent_thread_locked`                  | `AGENT_THREAD_LOCKED`                  | Concurrent run attempted against a thread already running.                  | Handle in `onError` as a user-facing busy signal ("Agent busy, try again"). Debounce the submit handler.                                                 |
| `transcription_failed`                 | `TRANSCRIPTION_FAILED`                 | Generic transcription failure (catch-all).                                  | Inspect server Pino logs for the underlying `TranscriptionErrorResponse`.                                                                                |
| `transcription_service_not_configured` | `TRANSCRIPTION_SERVICE_NOT_CONFIGURED` | `/transcribe` hit with no `TranscriptionService` configured on the runtime. | Implement a `TranscriptionService` subclass and pass it to `new CopilotRuntime({ transcriptionService })`.                                               |
| `transcription_invalid_audio`          | `TRANSCRIPTION_INVALID_AUDIO`          | Audio MIME type not in the whitelist, or audio file too long/short.         | Check the client recorder's MIME type; see `TranscriptionErrorCode.INVALID_AUDIO_FORMAT` / `AUDIO_TOO_LONG` / `AUDIO_TOO_SHORT` for the specific reason. |
| `transcription_rate_limited`           | `TRANSCRIPTION_RATE_LIMITED`           | Transcription provider rate-limited the request.                            | Backoff and retry; add queueing if the provider quota is the bottleneck.                                                                                 |
| `transcription_auth_failed`            | `TRANSCRIPTION_AUTH_FAILED`            | Transcription provider auth failed (wrong API key).                         | Verify the transcription service's provider credentials.                                                                                                 |
| `transcription_network_error`          | `TRANSCRIPTION_NETWORK_ERROR`          | Network error reaching the transcription provider.                          | Retryable. Check provider status, egress, DNS.                                                                                                           |
| `subscriber_callback_failed`           | `SUBSCRIBER_CALLBACK_FAILED`           | A subscriber callback (passed to `copilotkit.subscribe`) threw.             | Wrap the subscriber body in try/catch. Inspect `context.subscriberName`.                                                                                 |

## TranscriptionErrorCode (9 codes)

Source: `packages/shared/src/transcription-errors.ts`. These are returned
by the runtime's `/transcribe` endpoint inside a
`TranscriptionErrorResponse` body and are mapped into
`CopilotKitCoreErrorCode.TRANSCRIPTION_*` on the client.

| Code                     | Enum member              | Root cause                                          | Resolution                                                                                            |
| ------------------------ | ------------------------ | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `service_not_configured` | `SERVICE_NOT_CONFIGURED` | No `TranscriptionService` passed to the runtime.    | Pass a `TranscriptionService` subclass to `new CopilotRuntime({ transcriptionService })`.             |
| `invalid_audio_format`   | `INVALID_AUDIO_FORMAT`   | Uploaded audio MIME not in the supported whitelist. | Check `TranscriptionErrors.invalidAudioFormat` message for the supported list; re-encode client-side. |
| `audio_too_long`         | `AUDIO_TOO_LONG`         | Audio exceeds the configured max duration.          | Split the audio client-side before upload.                                                            |
| `audio_too_short`        | `AUDIO_TOO_SHORT`        | Audio is empty or below the min-duration threshold. | Filter out near-zero-duration recordings before upload.                                               |
| `rate_limited`           | `RATE_LIMITED`           | Provider rate limit.                                | Backoff + retry. `retryable: true`.                                                                   |
| `auth_failed`            | `AUTH_FAILED`            | Provider auth rejected the API key.                 | Fix provider credentials in the `TranscriptionService` subclass.                                      |
| `provider_error`         | `PROVIDER_ERROR`         | Provider returned an internal error. Retryable.     | Retry with backoff; escalate if persistent.                                                           |
| `network_error`          | `NETWORK_ERROR`          | Network reaching the provider. Retryable.           | Retry; check egress.                                                                                  |
| `invalid_request`        | `INVALID_REQUEST`        | Malformed multipart / JSON payload from the client. | Validate the request shape on the client; do NOT retry — not retryable.                               |

## v1 Error Codes (for migration context only)

The v1 enum `CopilotKitErrorCode` uses SCREAMING_SNAKE values and is
distinct from the v2 enum. Equality checks against v1 codes will NEVER
match v2 events. This is listed ONLY so the migration playbook can map
old literals to their closest v2 equivalents.

Source: `packages/shared/src/utils/errors.ts:44-57`.

| v1 value                       | Rough v2 equivalent                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `NETWORK_ERROR`                | `runtime_info_fetch_failed`                                                                            |
| `NOT_FOUND`                    | `runtime_info_fetch_failed`                                                                            |
| `AGENT_NOT_FOUND`              | `agent_not_found`                                                                                      |
| `API_NOT_FOUND`                | `runtime_info_fetch_failed`                                                                            |
| `REMOTE_ENDPOINT_NOT_FOUND`    | `runtime_info_fetch_failed`                                                                            |
| `AUTHENTICATION_ERROR`         | (no direct equivalent — surface via HTTP 401 inside `onError` context)                                 |
| `MISUSE`                       | (no direct equivalent — most become `tool_argument_parse_failed` or thrown errors)                     |
| `UNKNOWN`                      | (no direct equivalent — inspect `error.message`)                                                       |
| `VERSION_MISMATCH`             | (no direct equivalent — handled by runtime before events fire)                                         |
| `CONFIGURATION_ERROR`          | (no direct equivalent — most become one of the specific `transcription_*` / `agent_*` codes)           |
| `MISSING_PUBLIC_API_KEY_ERROR` | (no direct equivalent — `publicLicenseKey` missing surfaces as a boot-time banner, not an error event) |
| `UPGRADE_REQUIRED_ERROR`       | (no direct equivalent — surfaces as a banner)                                                          |

## Typical onError Skeleton

```tsx
import { CopilotKitProvider } from "@copilotkit/react-core/v2";

<CopilotKitProvider
  runtimeUrl="/api/copilotkit"
  onError={({ code, error, context }) => {
    // Always capture telemetry FIRST — early returns in the switch below
    // would otherwise short-circuit past it. Surfacing every code to
    // telemetry makes the UI branches purely presentational.
    telemetry.captureException(error, { tags: { code }, extra: context });

    switch (code) {
      case "runtime_info_fetch_failed":
        banner("Can't reach the assistant service.");
        break;
      case "agent_not_found":
        banner("This assistant is unavailable right now.");
        break;
      case "agent_thread_locked":
        toast("Assistant is busy — try again in a moment.");
        break;
      case "tool_handler_failed":
      case "tool_argument_parse_failed":
        toast("Something went wrong running that action.");
        break;
      case "transcription_service_not_configured":
        toast("Voice input isn't available.");
        break;
      case "transcription_rate_limited":
        toast("Transcription is rate-limited — try again shortly.");
        break;
      default:
        // Telemetry already captured above; nothing else to do for
        // unknown codes unless you want a generic fallback toast.
        break;
    }
  }}
/>;
```
