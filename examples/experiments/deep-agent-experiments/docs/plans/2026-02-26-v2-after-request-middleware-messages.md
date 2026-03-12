# v2 afterRequestMiddleware — Expose Messages

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `afterRequestMiddleware` provide parsed messages, threadId, and runId by cloning the response before the body is consumed and parsing the SSE stream.

**Architecture:** Clone the Response in all 4 endpoint files before the body is consumed. A new `parseSSEResponse` helper reads the cloned body, decodes AG-UI events from the SSE text, and reconstructs messages. The parsed data is passed as new optional fields on `AfterRequestMiddlewareParameters`.

**Tech Stack:** TypeScript, Vitest, AG-UI event types from `@ag-ui/core`

**Base path:** `../CopilotKit/packages/v2/runtime/src` (aliased below as `$RT`)

**Test command:** `cd ../CopilotKit && pnpm --filter @copilotkitnext/runtime test`

---

### Task 1: Write failing tests for SSE parser

**Files:**
- Create: `$RT/__tests__/middleware-sse-parser.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { parseSSEResponse } from "../middleware-sse-parser";

function buildSSEResponse(events: Record<string, unknown>[]): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("parseSSEResponse", () => {
  it("extracts threadId and runId from RUN_STARTED", async () => {
    const response = buildSSEResponse([
      { type: "RUN_STARTED", threadId: "t-1", runId: "r-1" },
      { type: "RUN_FINISHED", threadId: "t-1", runId: "r-1" },
    ]);
    const result = await parseSSEResponse(response);
    expect(result.threadId).toBe("t-1");
    expect(result.runId).toBe("r-1");
  });

  it("reconstructs a text message from start/content/end events", async () => {
    const response = buildSSEResponse([
      { type: "RUN_STARTED", threadId: "t-1", runId: "r-1" },
      { type: "TEXT_MESSAGE_START", messageId: "m-1", role: "assistant" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "m-1", delta: "Hello" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "m-1", delta: " world" },
      { type: "TEXT_MESSAGE_END", messageId: "m-1" },
      { type: "RUN_FINISHED", threadId: "t-1", runId: "r-1" },
    ]);
    const result = await parseSSEResponse(response);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toEqual({
      id: "m-1",
      role: "assistant",
      content: "Hello world",
    });
  });

  it("reconstructs tool calls on assistant messages", async () => {
    const response = buildSSEResponse([
      { type: "RUN_STARTED", threadId: "t-1", runId: "r-1" },
      { type: "TEXT_MESSAGE_START", messageId: "m-1", role: "assistant" },
      { type: "TEXT_MESSAGE_END", messageId: "m-1" },
      {
        type: "TOOL_CALL_START",
        toolCallId: "tc-1",
        toolCallName: "get_weather",
        parentMessageId: "m-1",
      },
      { type: "TOOL_CALL_ARGS", toolCallId: "tc-1", delta: '{"city":"NYC"}' },
      { type: "TOOL_CALL_END", toolCallId: "tc-1" },
      { type: "RUN_FINISHED", threadId: "t-1", runId: "r-1" },
    ]);
    const result = await parseSSEResponse(response);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      id: "m-1",
      role: "assistant",
      toolCalls: [
        { id: "tc-1", name: "get_weather", args: '{"city":"NYC"}' },
      ],
    });
  });

  it("includes tool result messages", async () => {
    const response = buildSSEResponse([
      { type: "RUN_STARTED", threadId: "t-1", runId: "r-1" },
      {
        type: "TOOL_CALL_RESULT",
        toolCallId: "tc-1",
        messageId: "m-result",
        role: "tool",
        content: "72F sunny",
      },
      { type: "RUN_FINISHED", threadId: "t-1", runId: "r-1" },
    ]);
    const result = await parseSSEResponse(response);
    expect(result.messages).toContainEqual({
      id: "m-result",
      role: "tool",
      content: "72F sunny",
      toolCallId: "tc-1",
    });
  });

  it("uses MESSAGES_SNAPSHOT when present", async () => {
    const snapshotMessages = [
      { id: "u-1", role: "user", content: "hi" },
      { id: "a-1", role: "assistant", content: "hello" },
    ];
    const response = buildSSEResponse([
      { type: "RUN_STARTED", threadId: "t-1", runId: "r-1" },
      { type: "MESSAGES_SNAPSHOT", messages: snapshotMessages },
      { type: "RUN_FINISHED", threadId: "t-1", runId: "r-1" },
    ]);
    const result = await parseSSEResponse(response);
    expect(result.messages).toEqual(snapshotMessages);
  });

  it("returns empty messages for non-SSE responses", async () => {
    const response = new Response(JSON.stringify({ version: "1.0" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const result = await parseSSEResponse(response);
    expect(result.messages).toEqual([]);
    expect(result.threadId).toBeUndefined();
    expect(result.runId).toBeUndefined();
  });

  it("handles empty body gracefully", async () => {
    const response = new Response("", {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
    const result = await parseSSEResponse(response);
    expect(result.messages).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd ../CopilotKit && pnpm --filter @copilotkitnext/runtime test -- --testPathPattern middleware-sse-parser`
Expected: FAIL — module `../middleware-sse-parser` does not exist

---

### Task 2: Implement SSE parser (green)

**Files:**
- Create: `$RT/middleware-sse-parser.ts`

**Step 1: Implement parseSSEResponse**

```typescript
import { logger } from "@copilotkitnext/shared";

export interface ParsedSSEResult {
  messages: Message[];
  threadId?: string;
  runId?: string;
}

/** Minimal message shape reconstructed from AG-UI events. */
export interface Message {
  id: string;
  role: string;
  content?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

interface ToolCall {
  id: string;
  name: string;
  args: string;
}

/**
 * Parse a cloned SSE Response body into structured messages.
 * Returns empty results for non-SSE responses.
 */
export async function parseSSEResponse(
  response: Response,
): Promise<ParsedSSEResult> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    return { messages: [] };
  }

  let text: string;
  try {
    text = await response.text();
  } catch {
    logger.warn("Failed to read SSE response body in afterRequestMiddleware");
    return { messages: [] };
  }

  if (!text.trim()) {
    return { messages: [] };
  }

  let threadId: string | undefined;
  let runId: string | undefined;
  const messagesById = new Map<string, Message>();
  const toolCallsById = new Map<string, ToolCall>();
  const toolCallParent = new Map<string, string>(); // toolCallId → messageId
  let snapshotMessages: Message[] | undefined;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;

    let event: Record<string, any>;
    try {
      event = JSON.parse(trimmed.slice(5).trim());
    } catch {
      continue;
    }

    switch (event.type) {
      case "RUN_STARTED":
        threadId = event.threadId;
        runId = event.runId;
        break;

      case "MESSAGES_SNAPSHOT":
        if (Array.isArray(event.messages)) {
          snapshotMessages = event.messages;
        }
        break;

      case "TEXT_MESSAGE_START":
        messagesById.set(event.messageId, {
          id: event.messageId,
          role: event.role ?? "assistant",
          content: "",
        });
        break;

      case "TEXT_MESSAGE_CONTENT": {
        const msg = messagesById.get(event.messageId);
        if (msg) {
          msg.content = (msg.content ?? "") + (event.delta ?? "");
        }
        break;
      }

      case "TOOL_CALL_START": {
        const tc: ToolCall = {
          id: event.toolCallId,
          name: event.toolCallName,
          args: "",
        };
        toolCallsById.set(event.toolCallId, tc);
        if (event.parentMessageId) {
          toolCallParent.set(event.toolCallId, event.parentMessageId);
        }
        break;
      }

      case "TOOL_CALL_ARGS": {
        const tc = toolCallsById.get(event.toolCallId);
        if (tc) {
          tc.args += event.delta ?? "";
        }
        break;
      }

      case "TOOL_CALL_END": {
        const tc = toolCallsById.get(event.toolCallId);
        const parentId = toolCallParent.get(event.toolCallId);
        if (tc && parentId) {
          const parent = messagesById.get(parentId);
          if (parent) {
            parent.toolCalls = parent.toolCalls ?? [];
            parent.toolCalls.push(tc);
          }
        }
        break;
      }

      case "TOOL_CALL_RESULT":
        messagesById.set(event.messageId, {
          id: event.messageId,
          role: "tool",
          content: event.content,
          toolCallId: event.toolCallId,
        });
        break;
    }
  }

  // Prefer MESSAGES_SNAPSHOT if present (contains full history).
  // Otherwise reconstruct from individual events.
  const messages = snapshotMessages ?? [...messagesById.values()];

  return { messages, threadId, runId };
}
```

**Step 2: Run tests to verify they pass**

Run: `cd ../CopilotKit && pnpm --filter @copilotkitnext/runtime test -- --testPathPattern middleware-sse-parser`
Expected: all 7 tests PASS

**Step 3: Commit**

```
feat(runtime): add SSE parser for afterRequestMiddleware messages
```

---

### Task 3: Extend AfterRequestMiddlewareParameters type and update callAfterRequestMiddleware

**Files:**
- Modify: `$RT/middleware.ts`

**Step 1: Write the failing test**

Add to `$RT/__tests__/middleware-single.test.ts` a new test that verifies messages are passed:

```typescript
it("passes parsed messages and runId to afterRequestMiddleware for info endpoint", async () => {
  let receivedParams: Record<string, unknown> = {};
  const after = vi.fn().mockImplementation((params) => {
    receivedParams = params;
  });

  const runtime = dummyRuntime({
    afterRequestMiddleware: after,
  });

  const endpoint = createCopilotEndpointSingleRoute({
    runtime,
    basePath: "/rpc",
  });
  await endpoint.fetch(buildRequest({ method: "info" }));

  // Wait for async middleware
  await new Promise((r) => setImmediate(r));

  expect(after).toHaveBeenCalled();
  // For non-SSE (info) responses, messages should be empty array
  expect(receivedParams).toHaveProperty("messages");
  expect(receivedParams.messages).toEqual([]);
  expect(receivedParams).toHaveProperty("path");
});
```

Run: `cd ../CopilotKit && pnpm --filter @copilotkitnext/runtime test -- --testPathPattern middleware-single`
Expected: FAIL — `messages` not in params

**Step 2: Update middleware.ts**

In `$RT/middleware.ts`, make these changes:

1. Add import at top (after existing imports, line ~17):
```typescript
import { parseSSEResponse } from "./middleware-sse-parser";
import type { Message } from "./middleware-sse-parser";
```

2. Extend `AfterRequestMiddlewareParameters` (line 29-32) to:
```typescript
export interface AfterRequestMiddlewareParameters {
  runtime: CopilotRuntime;
  response: Response;
  path: string;
  /** Reconstructed messages from the SSE stream (empty for non-SSE responses). */
  messages?: Message[];
  /** Thread ID from RUN_STARTED event. */
  threadId?: string;
  /** Run ID from RUN_STARTED event. */
  runId?: string;
}
```

3. Update `callAfterRequestMiddleware` (line 82-94) to parse SSE before calling middleware:
```typescript
export async function callAfterRequestMiddleware({
  runtime,
  response,
  path,
}: { runtime: CopilotRuntime; response: Response; path: string }): Promise<void> {
  const mw = runtime.afterRequestMiddleware;
  if (!mw) return;

  const { messages, threadId, runId } = await parseSSEResponse(response);

  if (typeof mw === "function") {
    return (mw as AfterRequestMiddlewareFn)({
      runtime,
      response,
      path,
      messages,
      threadId,
      runId,
    });
  }

  logger.warn({ mw }, "Unsupported afterRequestMiddleware value – skipped");
}
```

**Step 3: Run tests**

Run: `cd ../CopilotKit && pnpm --filter @copilotkitnext/runtime test -- --testPathPattern middleware-single`
Expected: all tests PASS (including new one)

**Step 4: Commit**

```
feat(runtime): extend afterRequestMiddleware with messages, threadId, runId
```

---

### Task 4: Clone response in Express endpoints

**Files:**
- Modify: `$RT/endpoints/express.ts:137-138`
- Modify: `$RT/endpoints/express-single.ts:173`

**Step 1: Write the failing test**

Add to `$RT/__tests__/middleware-single-express.test.ts`:

```typescript
it("passes parsed messages to afterRequestMiddleware", async () => {
  let receivedParams: Record<string, unknown> = {};
  const after = vi.fn().mockImplementation((params) => {
    receivedParams = params;
  });

  const runtime = dummyRuntime({
    afterRequestMiddleware: after,
  });

  const endpoint = createCopilotEndpointSingleRouteExpress({
    runtime,
    basePath: "/rpc",
  });

  const response = await request(endpoint).post("/rpc").send({ method: "info" });

  // Wait for async middleware
  await new Promise((r) => setTimeout(r, 50));

  expect(after).toHaveBeenCalled();
  expect(receivedParams).toHaveProperty("messages");
  expect(receivedParams.messages).toEqual([]);
});
```

Run: `cd ../CopilotKit && pnpm --filter @copilotkitnext/runtime test -- --testPathPattern middleware-single-express`
Expected: FAIL — `messages` not in params (body consumed before parsing)

**Step 2: Clone response in express.ts**

In `$RT/endpoints/express.ts`, change lines 137-138 from:
```typescript
      const response = await factory({ request, req });
      await sendFetchResponse(res, response);
      callAfterRequestMiddleware({ runtime, response, path }).catch((error) => {
```
to:
```typescript
      const response = await factory({ request, req });
      const responseForMiddleware = response.clone();
      await sendFetchResponse(res, response);
      callAfterRequestMiddleware({ runtime, response: responseForMiddleware, path }).catch((error) => {
```

Also update the error catch path (line ~153) from:
```typescript
        callAfterRequestMiddleware({ runtime, response: error, path }).catch(
```
to:
```typescript
        const errorResponseForMiddleware = error.clone();
        callAfterRequestMiddleware({ runtime, response: errorResponseForMiddleware, path }).catch(
```

**Step 3: Clone response in express-single.ts**

In `$RT/endpoints/express-single.ts`, change line 173 from:
```typescript
      await sendFetchResponse(res, response);
      callAfterRequestMiddleware({ runtime, response, path }).catch((error) => {
```
to:
```typescript
      const responseForMiddleware = response.clone();
      await sendFetchResponse(res, response);
      callAfterRequestMiddleware({ runtime, response: responseForMiddleware, path }).catch((error) => {
```

Also update the error catch path (line ~188) from:
```typescript
        callAfterRequestMiddleware({ runtime, response: error, path }).catch(
```
to:
```typescript
        const errorResponseForMiddleware = error.clone();
        callAfterRequestMiddleware({ runtime, response: errorResponseForMiddleware, path }).catch(
```

**Step 4: Run tests**

Run: `cd ../CopilotKit && pnpm --filter @copilotkitnext/runtime test -- --testPathPattern middleware`
Expected: all tests PASS

**Step 5: Commit**

```
feat(runtime): clone response before consuming in Express endpoints
```

---

### Task 5: Clone response in Hono endpoints

**Files:**
- Modify: `$RT/endpoints/hono-single.ts:96-112`
- Modify: `$RT/endpoints/hono.ts:108-125`

**Step 1: Update hono-single.ts**

Change lines 96-112 from:
```typescript
    .use("*", async (c, next) => {
      await next();

      const response = c.res;
      const path = c.req.path;

      callAfterRequestMiddleware({
        runtime,
        response,
        path,
      }).catch((error) => {
```
to:
```typescript
    .use("*", async (c, next) => {
      await next();

      const response = c.res.clone();
      const path = c.req.path;

      callAfterRequestMiddleware({
        runtime,
        response,
        path,
      }).catch((error) => {
```

**Step 2: Update hono.ts**

Same change in lines 108-125 — replace `const response = c.res;` with `const response = c.res.clone();`.

**Step 3: Run all tests**

Run: `cd ../CopilotKit && pnpm --filter @copilotkitnext/runtime test`
Expected: all tests PASS

**Step 4: Commit**

```
feat(runtime): clone response before consuming in Hono endpoints
```

---

### Task 6: Verify with reproduction ticket

**Files:**
- Modify: `deep-agent/app/server/tickets/tkt-v2-after-mw.ts`

**Step 1: Update the afterRequestMiddleware in the reproduction**

In the reproduction's `afterRequestMiddleware`, update the callback to log the new fields:

```typescript
  afterRequestMiddleware: async ({ response, path, messages, threadId, runId }) => {
    console.log("[tkt-v2-after-mw server] ──────────────────────────────────");
    console.log("[tkt-v2-after-mw server] afterRequestMiddleware CALLED");
    console.log("[tkt-v2-after-mw server] path:", path);
    console.log("[tkt-v2-after-mw server] response.status:", response.status);
    console.log("[tkt-v2-after-mw server] threadId:", threadId);
    console.log("[tkt-v2-after-mw server] runId:", runId);
    console.log("[tkt-v2-after-mw server] messages:", JSON.stringify(messages, null, 2));
    console.log("[tkt-v2-after-mw server] message count:", messages?.length ?? 0);
    console.log("[tkt-v2-after-mw server] ──────────────────────────────────");
  },
```

**Step 2: Start the app and agent, navigate to the ticket, send a message**

Expected: server terminal shows `[tkt-v2-after-mw server]` logs with populated `messages`, `threadId`, `runId`.

**Step 3: Commit**

```
fix(tkt-v2-after-mw): update reproduction to verify middleware messages fix
```

---

### Task 7: Run full test suite and verify no regressions

**Step 1: Run all runtime tests**

Run: `cd ../CopilotKit && pnpm --filter @copilotkitnext/runtime test`
Expected: all existing + new tests PASS

**Step 2: Type check**

Run: `cd ../CopilotKit && pnpm --filter @copilotkitnext/runtime check-types`
Expected: no type errors
