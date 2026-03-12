# Design: v2 afterRequestMiddleware — Expose Messages

**Date:** 2026-02-26
**Ticket:** tkt-v2-after-mw
**Slack:** https://copilotkit.slack.com/archives/C09C1BLEPC1/p1769639928266649

## Problem

In CopilotKit v2, `afterRequestMiddleware` receives `{ runtime, response, path }`. The `response` body (SSE stream) has already been consumed by the time middleware runs, so consumers cannot inspect assistant output for telemetry, logging, or action tracking.

In v1, `onAfterRequest` promised `{ outputMessages, inputMessages, threadId, runId }` but was never fully implemented (called with `{}`).

## Solution

Clone the response before the body is consumed. Parse the cloned SSE stream to extract structured messages. Pass both the cloned response and parsed data to the middleware.

## Design

### Extended Type

```typescript
// middleware.ts
export interface AfterRequestMiddlewareParameters {
  runtime: CopilotRuntime;
  response: Response;       // cloned — body consumed by our parsing
  path: string;
  // New fields — populated for agent/run and agent/connect SSE responses
  messages?: Message[];     // reconstructed from TEXT_MESSAGE and TOOL_CALL events
  threadId?: string;        // from RUN_STARTED event
  runId?: string;           // from RUN_STARTED event
}
```

Backward-compatible: existing middleware code that only reads `response`/`path` continues to work. New fields are optional.

### Clone Points

In all four endpoint files, clone the response before the body is consumed:

**Express endpoints** (`express.ts`, `express-single.ts`):
```typescript
const responseForMiddleware = response.clone();
await sendFetchResponse(res, response);       // consumes original body
callAfterRequestMiddleware({ runtime, response: responseForMiddleware, path });
```

**Hono endpoints** (`hono.ts`, `hono-single.ts`):
```typescript
.use("*", async (c, next) => {
  await next();
  const responseForMiddleware = c.res.clone();
  callAfterRequestMiddleware({ runtime, response: responseForMiddleware, path });
})
```

### SSE Parsing

New internal helper `middleware-sse-parser.ts`:

```typescript
interface ParsedSSEResult {
  messages: Message[];
  threadId?: string;
  runId?: string;
}

export async function parseSSEResponse(response: Response): Promise<ParsedSSEResult>
```

Logic:
1. Check `content-type` header — only parse `text/event-stream` responses. For JSON responses (info, error), return `{ messages: [] }`.
2. Read response body as text.
3. Split on SSE `data:` lines, JSON-parse each into a BaseEvent.
4. Walk events to reconstruct messages:
   - `TEXT_MESSAGE_START` — create message entry with `id`, `role`
   - `TEXT_MESSAGE_CONTENT` — append `delta` to message content
   - `TEXT_MESSAGE_END` — finalize message
   - `TOOL_CALL_START` — create tool call entry on parent message
   - `TOOL_CALL_ARGS` — append args delta
   - `TOOL_CALL_END` — finalize tool call
   - `MESSAGES_SNAPSHOT` — if present, use directly (contains full history)
5. Extract `threadId`/`runId` from `RUN_STARTED` event.

### callAfterRequestMiddleware Update

```typescript
export async function callAfterRequestMiddleware({
  runtime, response, path,
}: AfterRequestMiddlewareParameters): Promise<void> {
  const mw = runtime.afterRequestMiddleware;
  if (!mw) return;

  // Parse structured data from the cloned response
  const { messages, threadId, runId } = await parseSSEResponse(response);

  if (typeof mw === "function") {
    return (mw as AfterRequestMiddlewareFn)({
      runtime, response, path, messages, threadId, runId,
    });
  }
}
```

Note: `response.body` is consumed by `parseSSEResponse`. Middleware consumers should use the structured `messages`/`threadId`/`runId` fields. The `response` object still provides `status` and `headers`.

## Files Changed

All in `CopilotKit/packages/v2/runtime/src/`:

| File | Change |
|------|--------|
| `middleware.ts` | Extend `AfterRequestMiddlewareParameters`, update `callAfterRequestMiddleware` |
| `middleware-sse-parser.ts` | New — SSE stream to messages parser |
| `endpoints/express.ts` | `response.clone()` before `sendFetchResponse()` |
| `endpoints/express-single.ts` | Same |
| `endpoints/hono.ts` | `c.res.clone()` in after-middleware |
| `endpoints/hono-single.ts` | Same |
| `__tests__/middleware-sse-parser.test.ts` | New — unit tests for SSE parser |
| `__tests__/middleware*.test.ts` | Extend existing tests to verify messages/threadId/runId |

No changes to: `runtime.ts`, `handlers/`, `runner/`, public API exports (only type extension).

## Testing (TDD)

1. **Red:** Write `middleware-sse-parser.test.ts` — feed mock SSE text, assert messages/threadId/runId
2. **Green:** Implement `parseSSEResponse`
3. **Refactor:** Clean up
4. **Red:** Extend `middleware-single.test.ts` — assert afterRequestMiddleware receives messages
5. **Green:** Wire clone + parsing into endpoints
6. **Refactor:** Clean up
7. **E2E:** Update `tkt-v2-after-mw` reproduction to verify fix works
