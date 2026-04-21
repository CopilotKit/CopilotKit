---
name: debug-and-troubleshoot
description: >
  End-to-end debugging for CopilotKit v2 — CopilotKitCoreErrorCode catalog
  (17 snake_case codes including runtime_info_fetch_failed,
  agent_thread_locked, agent_run_failed, tool_handler_failed, etc.),
  TranscriptionErrorCode catalog (9 codes), AG-UI SSE event tracing, web
  inspector lazy-loading, onError wiring on both CopilotKitProvider and
  CopilotChat, server-first debug discipline, and deprecated-alias → canonical
  cheat sheet. v1 CopilotKitErrorCode (SCREAMING_SNAKE) is kept for migration
  context only. Load when diagnosing a CopilotKit runtime or client failure,
  when interpreting an error code, when tracing missing events, or when
  wiring onError handlers.
type: lifecycle
library: copilotkit
library_version: "1.56.2"
requires:
  - copilotkit/provider-setup
  - copilotkit/debug-mode
sources:
  - "CopilotKit/CopilotKit:packages/core/src/core/core.ts"
  - "CopilotKit/CopilotKit:packages/shared/src/utils/errors.ts"
  - "CopilotKit/CopilotKit:packages/shared/src/transcription-errors.ts"
  - "CopilotKit/CopilotKit:packages/web-inspector/src/index.ts"
  - "CopilotKit/CopilotKit:docs/snippets/shared/troubleshooting/common-issues.mdx"
  - "CopilotKit/CopilotKit:docs/snippets/shared/troubleshooting/error-debugging.mdx"
  - "CopilotKit/CopilotKit:docs/snippets/shared/troubleshooting/debug-mode.mdx"
---

## Setup

Debug in layers: server debug first, then client debug, then the web
inspector. Handle errors in `onError` using `CopilotKitCoreErrorCode`
string literals (snake_case).

### Server debug

```ts
// app/routes/api.copilotkit.$.tsx
import { CopilotRuntime } from "@copilotkit/runtime/v2";

const runtime = new CopilotRuntime({
  agents,
  debug:
    process.env.NODE_ENV !== "production"
      ? { events: true, lifecycle: true, verbose: true }
      : false,
});
```

### Client debug + onError

```tsx
import { CopilotKitProvider, CopilotChat } from "@copilotkit/react-core/v2";

<CopilotKitProvider
  runtimeUrl="/api/copilotkit"
  showDevConsole="auto"
  debug={process.env.NODE_ENV !== "production"}
  onError={({ error, code, context }) => {
    // central telemetry; keep UI toasts on the chat:
    telemetry.captureException(error, { tags: { code }, extra: context });
  }}
>
  <CopilotChat
    agentId="default"
    onError={({ code }) => {
      if (code === "agent_thread_locked") {
        toast({ title: "Agent busy — try again in a moment" });
      }
    }}
  />
</CopilotKitProvider>;
```

### Web inspector (dev)

```tsx
<CopilotKitProvider
  runtimeUrl="/api/copilotkit"
  showDevConsole="auto"
  debug={{ events: true, lifecycle: true }}
/>
```

`showDevConsole="auto"` mounts the inspector in development. It lazy-loads
`@copilotkit/web-inspector` via `@lit-labs/react` — zero cost in prod.

## Core Patterns

### Diagnose `runtime_info_fetch_failed`

Checks in order:

1. `runtimeUrl` starts with a leading `/` or is a full origin.
2. `/info` is reachable:

```bash
curl -i http://localhost:3000/api/copilotkit/info
```

3. CORS allows the browser origin (cross-origin deployments need
   `createCopilotRuntimeHandler({ cors: true })` or proxy-level CORS).
4. Cookie auth: `credentials="include"` on the provider AND CORS
   configured to allow credentials.

### Diagnose `agent_not_found`

- Server `agents: { default: ... }` key matches the client
  `<CopilotChat agentId="default">` / `useAgent({ agentId })` string.
- `/info` JSON lists the expected agent names.

### Diagnose `agent_thread_locked`

Double-submit or concurrent run. Handle it:

```tsx
<CopilotKitProvider
  runtimeUrl="/api/copilotkit"
  onError={({ code }) => {
    if (code === "agent_thread_locked") {
      toast.warning("Agent is busy — please wait");
    }
  }}
/>
```

### Trace missing AG-UI events — server first, client second

Dev tools Network tab on the `/run` SSE stream shows each event frame.
Server debug produces Pino logs with every event emitted. If the event
is missing in the Pino logs, the agent factory isn't yielding it — fix
the agent. If it's in the Pino logs but not the browser, check the SSE
connection isn't being buffered (proxies, compression).

### Deprecated-alias cheat sheet

| Deprecated                                                 | Canonical                                                           |
| ---------------------------------------------------------- | ------------------------------------------------------------------- |
| `publicApiKey`                                             | `publicLicenseKey`                                                  |
| `agents__unsafe_dev_only`                                  | (no prod alias — use `runtimeUrl` or `publicLicenseKey`)            |
| `selfManagedAgents`                                        | (no prod alias — same as above)                                     |
| `imageUploadsEnabled`                                      | `attachments={{ enabled: true }}`                                   |
| `createCopilotEndpoint*` aliases                           | `createCopilotRuntimeHandler`                                       |
| `createCopilotExpressHandler` / `createCopilotHonoHandler` | mount `createCopilotRuntimeHandler` in the framework's native route |
| `beforeRequestMiddleware` / `afterRequestMiddleware`       | `hooks.onRequest` / `hooks.onBeforeHandler`                         |

## Common Mistakes

### CRITICAL checking for v1 SCREAMING_SNAKE codes in v2

Wrong:

```ts
if (event.code === "API_NOT_FOUND") {
  /* never matches */
}
```

Correct:

```ts
if (event.code === "runtime_info_fetch_failed") {
  /* matches */
}
```

v2 codes are snake_case on `CopilotKitCoreErrorCode`
(`runtime_info_fetch_failed`, `agent_run_failed`, `agent_thread_locked`,
`tool_handler_failed`, …). v1 SCREAMING_SNAKE values never match v2.

Source: packages/core/src/core/core.ts:71-105

### HIGH chasing missing events client-side only

Wrong:

```tsx
// turning on client debug and puzzling over missing events
<CopilotKitProvider debug={{ events: true, verbose: true }} />
```

Correct:

```ts
// turn on server debug FIRST
new CopilotRuntime({
  agents,
  debug: { events: true, lifecycle: true, verbose: true },
});
```

Server drops events too; Pino server logs are more reliable as the first
trace point. If the event is in Pino but not the browser, then look at
the SSE stream in the Network tab.

Source: docs/snippets/shared/troubleshooting/debug-mode.mdx:62-69,129-141

### HIGH not handling agent_thread_locked

Wrong:

```tsx
<CopilotKitProvider runtimeUrl="/api/copilotkit" />
// no onError — double-submit shows a scary error banner
```

Correct:

```tsx
<CopilotKitProvider
  runtimeUrl="/api/copilotkit"
  onError={({ code }) => {
    if (code === "agent_thread_locked") {
      return toast({ title: "Agent busy — try again in a moment" });
    }
  }}
/>
```

`agent_thread_locked` is the common concurrent-run error — treat it as
a user-facing busy signal, not a crash.

Source: packages/core/src/core/core.ts:81-97

### MEDIUM debug:true expecting full payload logs

Wrong:

```tsx
<CopilotKitProvider debug={true} />
// expecting every event payload in the console — only gets summaries
```

Correct:

```tsx
<CopilotKitProvider debug={{ events: true, lifecycle: true, verbose: true }} />
```

Boolean `true` enables `events` + `lifecycle` summaries but keeps
`verbose: false`. Verbose is opt-in because it may log PII.

Source: docs/snippets/shared/troubleshooting/debug-mode.mdx:85-93

### MEDIUM duplicate onError side effects (provider + chat)

Wrong:

```tsx
<CopilotKitProvider onError={toast}>
  <CopilotChat onError={toast} />
</CopilotKitProvider>
```

Correct:

```tsx
<CopilotKitProvider onError={telemetry}>
  <CopilotChat onError={toast} />
</CopilotKitProvider>
```

Chat `onError` fires IN ADDITION TO provider `onError` — double toasts
if both trigger UI. Canonical split: telemetry on provider, UI on chat.

Source: docs/snippets/shared/troubleshooting/error-debugging.mdx:56-70

## References

- [Error codes — full catalog with root causes and resolutions](references/error-codes.md)
