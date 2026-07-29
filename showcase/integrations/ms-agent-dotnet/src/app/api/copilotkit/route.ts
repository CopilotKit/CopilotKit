import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import type { AbstractAgent, BaseEvent } from "@ag-ui/client";
import { EventType, FunctionMiddleware, HttpAgent } from "@ag-ui/client";
import { Observable } from "rxjs";

// The agent backend runs as a separate process on port 8000.
// This runtime proxies CopilotKit requests to it via AG-UI protocol.
const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";
const REPLAY_SAFE_TOOL_CALL_ID_SUFFIX = /__ck_run_[0-9a-f-]+$/i;

// Per-request request/response logging is gated behind this flag (default off).
// Under d6 probe fan-out, unconditional per-request logs flooded Railway's
// 500-logs/sec cap and killed the replica ("Messages dropped" → container stop).
// Set SHOWCASE_ROUTE_DEBUG=1 to re-enable verbose per-request tracing locally.
const ROUTE_DEBUG =
  process.env.SHOWCASE_ROUTE_DEBUG === "1" ||
  process.env.SHOWCASE_ROUTE_DEBUG === "true";

console.log("[copilotkit/route] Initializing CopilotKit runtime");
console.log(`[copilotkit/route] AGENT_URL: ${AGENT_URL}`);

function createAgent(path = "/") {
  const agent = new HttpAgent({ url: `${AGENT_URL}${path}` });
  // Universal strip middleware (no decision-suffix). Runs as the first
  // registered middleware so EVERY outbound request carries clean
  // canonical toolCallIds (the replay-safe `__ck_run_<uuid>` suffix is
  // removed) before any agent-specific middleware sees the input.
  // Decision suffixing (`__approved` / `__rejected` / `__cancelled`)
  // is intentionally NOT applied here — only `createReplaySafeAgent`
  // does that, because the suffix is non-idempotent and the inner
  // replay-safe middleware re-runs the same logic after this one.
  agent.use(
    new FunctionMiddleware((input, next) => {
      return next.run({
        ...input,
        messages: (input.messages ?? []).map(
          stripReplaySafeToolCallIdsFromMessage,
        ),
      });
    }),
  );
  return agent;
}

function stripReplaySafeToolCallId(id: string): string {
  return id.replace(REPLAY_SAFE_TOOL_CALL_ID_SUFFIX, "");
}

function makeReplaySafeToolCallId(id: string, runId: string): string {
  return `${stripReplaySafeToolCallId(id)}__ck_run_${runId}`;
}

function stripReplaySafeToolCallIdsFromMessage(message: unknown): unknown {
  if (!message || typeof message !== "object") return message;

  const next = { ...(message as Record<string, unknown>) };
  let changed = false;

  if (typeof next.toolCallId === "string") {
    next.toolCallId = stripReplaySafeToolCallId(next.toolCallId);
    changed = true;
  }

  if (typeof next.tool_call_id === "string") {
    next.tool_call_id = stripReplaySafeToolCallId(next.tool_call_id);
    changed = true;
  }

  // Strip on BOTH the camelCase (AG-UI canonical) and snake_case (OpenAI
  // wire format) tool-call arrays. Some runtimes / message converters
  // pass the OpenAI shape through unchanged; without this branch the
  // replay-safe `__ck_run_<uuid>` suffix slips through to aimock and
  // toolCallId-keyed fixtures fail to match on follow-up turns.
  const stripToolCallArrayEntry = (toolCall: unknown) => {
    if (!toolCall || typeof toolCall !== "object") return toolCall;
    const call = { ...(toolCall as Record<string, unknown>) };
    if (typeof call.id === "string") {
      call.id = stripReplaySafeToolCallId(call.id);
    }
    // OpenAI nests the tool_call_id under `function` in some shapes; strip
    // there too just to keep the surface clean before aimock sees it.
    if (call.function && typeof call.function === "object") {
      const fn = { ...(call.function as Record<string, unknown>) };
      if (typeof fn.tool_call_id === "string") {
        fn.tool_call_id = stripReplaySafeToolCallId(fn.tool_call_id);
        call.function = fn;
      }
    }
    return call;
  };

  if (Array.isArray(next.toolCalls)) {
    next.toolCalls = next.toolCalls.map(stripToolCallArrayEntry);
    changed = true;
  }

  if (Array.isArray(next.tool_calls)) {
    next.tool_calls = next.tool_calls.map(stripToolCallArrayEntry);
    changed = true;
  }

  return changed ? next : message;
}

function textFromMessageContent(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;

  const text = content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const text = (part as { text?: unknown }).text;
      return typeof text === "string" ? text : "";
    })
    .join("");

  return text || undefined;
}

function textFromContextValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return undefined;

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function buildContextSystemMessage(context: unknown): string | undefined {
  if (!Array.isArray(context) || context.length === 0) return undefined;

  const lines = ["## Context from the application"];
  for (const entry of context) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const description =
      typeof record.description === "string" ? record.description : undefined;
    const value = textFromContextValue(record.value);
    if (!description || !value) continue;

    lines.push("", description, value);
  }

  return lines.length > 1 ? lines.join("\n") : undefined;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function buildSharedStateReadWriteSystemMessage(state: unknown): string {
  const stateRecord = readRecord(state);
  const prefs = readRecord(stateRecord?.preferences) ?? {};
  const name = typeof prefs.name === "string" ? prefs.name : "";
  const tone = typeof prefs.tone === "string" ? prefs.tone : "casual";
  const language =
    typeof prefs.language === "string" ? prefs.language : "English";
  const interests = Array.isArray(prefs.interests)
    ? prefs.interests.filter(
        (interest): interest is string => typeof interest === "string",
      )
    : [];

  return [
    "You are a helpful, concise assistant. The user's preferences are supplied via shared state and added as a system message at the start of every turn - always respect them. When the user asks you to remember something, or you observe something worth surfacing in the UI's notes panel, call `set_notes` with the FULL updated list of short notes (existing notes + new). Keep each note short.",
    "",
    "[shared-state-read-write] preferences:",
    "{",
    `  "name": ${JSON.stringify(name)},`,
    `  "tone": ${JSON.stringify(tone)},`,
    `  "language": ${JSON.stringify(language)},`,
    `  "interests": ${JSON.stringify(interests)}`,
    "}",
    "Tailor every response to these preferences. Address the user by name when appropriate.",
  ].join("\n");
}

type ToolResultDecision = "approved" | "rejected" | "cancelled";

function toolDecisionFromContent(
  content: unknown,
): ToolResultDecision | undefined {
  const text = textFromMessageContent(content);
  if (!text) return undefined;

  try {
    const parsed = JSON.parse(text);
    if (parsed?.approved === true || parsed?.accepted === true) {
      return "approved";
    }
    if (parsed?.approved === false || parsed?.accepted === false) {
      return "rejected";
    }
    if (parsed?.cancelled === true || parsed?.canceled === true) {
      return "cancelled";
    }
  } catch {
    const normalized = text.toLowerCase();
    if (
      (normalized.includes("cancelled") || normalized.includes("canceled")) &&
      (normalized.includes("not scheduled") ||
        normalized.includes("not booked") ||
        normalized.includes("no time"))
    ) {
      return "cancelled";
    }
  }

  return undefined;
}

function makeDecisionToolCallId(id: string, decision: ToolResultDecision) {
  return `${id}__${decision}`;
}

function applyToolResultDecisionSuffix(
  message: unknown,
  decisionsByToolCallId: Map<string, ToolResultDecision>,
): unknown {
  if (!message || typeof message !== "object") return message;

  const next = { ...(message as Record<string, unknown>) };
  let changed = false;

  if (typeof next.toolCallId === "string") {
    const decision = decisionsByToolCallId.get(next.toolCallId);
    if (decision) {
      next.toolCallId = makeDecisionToolCallId(next.toolCallId, decision);
      changed = true;
    }
  }

  if (typeof next.tool_call_id === "string") {
    const decision = decisionsByToolCallId.get(next.tool_call_id);
    if (decision) {
      next.tool_call_id = makeDecisionToolCallId(next.tool_call_id, decision);
      changed = true;
    }
  }

  const suffixArrayEntry = (toolCall: unknown) => {
    if (!toolCall || typeof toolCall !== "object") return toolCall;
    const call = { ...(toolCall as Record<string, unknown>) };
    if (typeof call.id === "string") {
      const decision = decisionsByToolCallId.get(call.id);
      if (decision) {
        call.id = makeDecisionToolCallId(call.id, decision);
      }
    }
    return call;
  };

  if (Array.isArray(next.toolCalls)) {
    next.toolCalls = next.toolCalls.map(suffixArrayEntry);
    changed = true;
  }

  if (Array.isArray(next.tool_calls)) {
    next.tool_calls = next.tool_calls.map(suffixArrayEntry);
    changed = true;
  }

  return changed ? next : message;
}

function messageRole(message: unknown): string | undefined {
  if (!message || typeof message !== "object") return undefined;
  const role = (message as Record<string, unknown>).role;
  return typeof role === "string" ? role : undefined;
}

function hasTextContent(message: Record<string, unknown>): boolean {
  const content = textFromMessageContent(message.content);
  return Boolean(content?.trim());
}

function dropStaleToolInteractionsBeforeLatestUser(messages: unknown[]) {
  const latestUserIndex = messages.findLastIndex(
    (message) => messageRole(message) === "user",
  );

  if (latestUserIndex < 0 || latestUserIndex !== messages.length - 1) {
    return messages;
  }

  let changed = false;
  const nextMessages: unknown[] = [];

  messages.forEach((message, index) => {
    if (index >= latestUserIndex || !message || typeof message !== "object") {
      nextMessages.push(message);
      return;
    }

    const record = message as Record<string, unknown>;
    if (record.role === "tool") {
      changed = true;
      return;
    }

    if (
      record.role === "assistant" &&
      (Array.isArray(record.toolCalls) || Array.isArray(record.tool_calls))
    ) {
      const next = { ...record };
      delete next.toolCalls;
      delete next.tool_calls;
      changed = true;

      if (hasTextContent(next)) {
        nextMessages.push(next);
      }
      return;
    }

    nextMessages.push(message);
  });

  return changed ? nextMessages : messages;
}

function prepareReplaySafeMessages(messages: unknown[] = []) {
  const stripped = messages.map(stripReplaySafeToolCallIdsFromMessage);
  const decisionsByToolCallId = new Map<string, ToolResultDecision>();

  for (const message of stripped) {
    if (!message || typeof message !== "object") continue;
    const record = message as Record<string, unknown>;
    const toolCallId =
      typeof record.tool_call_id === "string"
        ? record.tool_call_id
        : typeof record.toolCallId === "string"
          ? record.toolCallId
          : undefined;

    if (record.role !== "tool" || !toolCallId) {
      continue;
    }

    const decision = toolDecisionFromContent(record.content);
    if (decision) {
      decisionsByToolCallId.set(toolCallId, decision);
    }
  }

  const decisionAwareMessages =
    decisionsByToolCallId.size === 0
      ? stripped
      : stripped.map((message) =>
          applyToolResultDecisionSuffix(message, decisionsByToolCallId),
        );

  return dropStaleToolInteractionsBeforeLatestUser(decisionAwareMessages);
}

function createReplaySafeAgent(path: string, replaySafeToolNames: string[]) {
  const agent = createAgent(path);
  const replaySafeTools = new Set(replaySafeToolNames);

  agent.use(
    new FunctionMiddleware((input, next) => {
      return new Observable<BaseEvent>((subscriber) => {
        const toolCallIds = new Map<string, string>();
        const sanitizedInput = {
          ...input,
          messages: prepareReplaySafeMessages(input.messages),
        };

        const subscription = next.run(sanitizedInput).subscribe({
          next(event) {
            const e = event as BaseEvent & {
              toolCallId?: string;
              toolCallName?: string;
            };

            if (
              (e.type === EventType.TOOL_CALL_START ||
                e.type === EventType.TOOL_CALL_CHUNK) &&
              e.toolCallName &&
              replaySafeTools.has(e.toolCallName) &&
              e.toolCallId
            ) {
              const originalId = stripReplaySafeToolCallId(e.toolCallId);
              const rewrittenId = makeReplaySafeToolCallId(
                originalId,
                input.runId,
              );
              toolCallIds.set(originalId, rewrittenId);
              subscriber.next({ ...event, toolCallId: rewrittenId });
              return;
            }

            if (e.toolCallId) {
              const originalId = stripReplaySafeToolCallId(e.toolCallId);
              const rewrittenId = toolCallIds.get(originalId);
              if (rewrittenId) {
                subscriber.next({ ...event, toolCallId: rewrittenId });
                return;
              }
            }

            subscriber.next(event);
          },
          error(error) {
            subscriber.error(error);
          },
          complete() {
            subscriber.complete();
          },
        });

        return () => subscription.unsubscribe();
      });
    }),
  );

  return agent;
}

function createGenUiAgent() {
  const agent = createAgent("/gen-ui-agent");

  agent.use(
    new FunctionMiddleware((input, next) => {
      // The outer createAgent middleware already stripped replay-safe ids
      // on inbound messages, so this middleware only needs to wire the
      // gen-ui-agent's STATE_SNAPSHOT bridging from set_steps tool args.
      return new Observable<BaseEvent>((subscriber) => {
        const setStepsToolCallIds = new Set<string>();
        const argsByToolCallId = new Map<string, string>();

        const emitStateSnapshotFromArgs = (toolCallId: string) => {
          const args = argsByToolCallId.get(toolCallId);
          if (!args) return;

          try {
            const parsed = JSON.parse(args);
            if (!Array.isArray(parsed?.steps)) return;

            subscriber.next({
              type: EventType.STATE_SNAPSHOT,
              snapshot: { steps: parsed.steps },
            } as BaseEvent);
          } catch {
            // Args may arrive in chunks; wait until the buffered JSON is whole.
          }
        };

        const subscription = next.run(input).subscribe({
          next(event) {
            if (
              event.type === EventType.TOOL_CALL_START &&
              (event as { toolCallName?: string }).toolCallName === "set_steps"
            ) {
              const toolCallId = (event as { toolCallId?: string }).toolCallId;
              if (toolCallId) setStepsToolCallIds.add(toolCallId);
              return;
            }

            if (event.type === EventType.TOOL_CALL_ARGS) {
              const toolCallId = (event as { toolCallId?: string }).toolCallId;
              if (toolCallId && setStepsToolCallIds.has(toolCallId)) {
                const delta = String((event as { delta?: string }).delta ?? "");
                argsByToolCallId.set(
                  toolCallId,
                  `${argsByToolCallId.get(toolCallId) ?? ""}${delta}`,
                );
                emitStateSnapshotFromArgs(toolCallId);
                return;
              }
            }

            if (
              event.type === EventType.TOOL_CALL_END ||
              event.type === EventType.TOOL_CALL_RESULT
            ) {
              const toolCallId = (event as { toolCallId?: string }).toolCallId;
              if (toolCallId && setStepsToolCallIds.has(toolCallId)) {
                if (event.type === EventType.TOOL_CALL_RESULT) {
                  setStepsToolCallIds.delete(toolCallId);
                  argsByToolCallId.delete(toolCallId);
                }
                return;
              }
            }

            subscriber.next(event);
          },
          error(error) {
            subscriber.error(error);
          },
          complete() {
            subscriber.complete();
          },
        });

        return () => subscription.unsubscribe();
      });
    }),
  );

  return agent;
}

/**
 * Extract the (possibly still-streaming, unterminated) value of the
 * `document` string argument from a partial `write_document` tool-args
 * buffer. OpenAI streams tool-call args as raw JSON deltas, so mid-stream
 * the buffer looks like `{"document":"Autumn lea` — not parseable by
 * `JSON.parse`. To stream `state.document` per-token we decode the string
 * value ourselves, honoring JSON escape sequences and stopping cleanly at
 * the point the buffer currently ends (an in-progress escape or `\u` code
 * simply waits for the next delta).
 */
function extractStreamingDocument(argsBuffer: string): string | undefined {
  // Fast path: the whole args JSON has arrived.
  try {
    const parsed = JSON.parse(argsBuffer);
    if (parsed && typeof parsed.document === "string") return parsed.document;
  } catch {
    // Fall through to partial extraction while the buffer is incomplete.
  }

  const keyMatch = argsBuffer.match(/"document"\s*:\s*"/);
  if (!keyMatch || keyMatch.index === undefined) return undefined;

  const start = keyMatch.index + keyMatch[0].length;
  let result = "";
  for (let i = start; i < argsBuffer.length; i++) {
    const ch = argsBuffer[i];
    if (ch === "\\") {
      const next = argsBuffer[i + 1];
      // Escape started but its payload hasn't streamed yet — wait for more.
      if (next === undefined) break;
      switch (next) {
        case "n":
          result += "\n";
          break;
        case "t":
          result += "\t";
          break;
        case "r":
          result += "\r";
          break;
        case "b":
          result += "\b";
          break;
        case "f":
          result += "\f";
          break;
        case '"':
          result += '"';
          break;
        case "\\":
          result += "\\";
          break;
        case "/":
          result += "/";
          break;
        case "u": {
          const hex = argsBuffer.slice(i + 2, i + 6);
          // Incomplete \uXXXX escape — wait for the rest of the code point.
          if (hex.length < 4) return result;
          result += String.fromCharCode(parseInt(hex, 16));
          i += 4;
          break;
        }
        default:
          result += next;
      }
      i += 1;
      continue;
    }
    // Unescaped closing quote — the string value is complete.
    if (ch === '"') break;
    result += ch;
  }
  return result;
}

// Shared State (Streaming) — per-token bridge for the .NET
// `write_document` tool. The backend agent (D5ParityAgentFactory
// .CreateSharedStateStreamingAgent) streams the tool's `document` string
// argument as TOOL_CALL_ARGS deltas and commits a final authoritative
// STATE_SNAPSHOT via SnapshotAfterRunAgent. This shim mirrors
// `createGenUiAgent`: it buffers those arg deltas and, per delta, emits an
// incremental `STATE_SNAPSHOT { document }` so the UI's DocumentView
// (subscribed to `agent.state.document`) grows token-by-token instead of
// jumping once at the end. The write_document tool-call events themselves
// are swallowed (like set_steps) — the document lives in state, not in a
// chat tool-call bubble. The backend's final STATE_SNAPSHOT still passes
// through as the authoritative commit.
function createSharedStateStreamingAgent() {
  const agent = createAgent("/shared-state-streaming");

  agent.use(
    new FunctionMiddleware((input, next) => {
      return new Observable<BaseEvent>((subscriber) => {
        const writeDocumentToolCallIds = new Set<string>();
        const argsByToolCallId = new Map<string, string>();
        const lastEmittedByToolCallId = new Map<string, string>();

        const emitStateSnapshotFromArgs = (toolCallId: string) => {
          const args = argsByToolCallId.get(toolCallId);
          if (args === undefined) return;

          const document = extractStreamingDocument(args);
          if (document === undefined) return;

          // Only emit when the decoded document actually grew/changed, so
          // token deltas that don't advance the string (e.g. structural
          // JSON chars) don't spam redundant snapshots.
          if (lastEmittedByToolCallId.get(toolCallId) === document) return;
          lastEmittedByToolCallId.set(toolCallId, document);

          subscriber.next({
            type: EventType.STATE_SNAPSHOT,
            snapshot: { document },
          } as BaseEvent);
        };

        const subscription = next.run(input).subscribe({
          next(event) {
            if (
              event.type === EventType.TOOL_CALL_START &&
              (event as { toolCallName?: string }).toolCallName ===
                "write_document"
            ) {
              const toolCallId = (event as { toolCallId?: string }).toolCallId;
              if (toolCallId) writeDocumentToolCallIds.add(toolCallId);
              return;
            }

            if (event.type === EventType.TOOL_CALL_ARGS) {
              const toolCallId = (event as { toolCallId?: string }).toolCallId;
              if (toolCallId && writeDocumentToolCallIds.has(toolCallId)) {
                const delta = String((event as { delta?: string }).delta ?? "");
                argsByToolCallId.set(
                  toolCallId,
                  `${argsByToolCallId.get(toolCallId) ?? ""}${delta}`,
                );
                emitStateSnapshotFromArgs(toolCallId);
                return;
              }
            }

            if (
              event.type === EventType.TOOL_CALL_END ||
              event.type === EventType.TOOL_CALL_RESULT
            ) {
              const toolCallId = (event as { toolCallId?: string }).toolCallId;
              if (toolCallId && writeDocumentToolCallIds.has(toolCallId)) {
                if (event.type === EventType.TOOL_CALL_RESULT) {
                  writeDocumentToolCallIds.delete(toolCallId);
                  argsByToolCallId.delete(toolCallId);
                  lastEmittedByToolCallId.delete(toolCallId);
                }
                return;
              }
            }

            subscriber.next(event);
          },
          error(error) {
            subscriber.error(error);
          },
          complete() {
            subscriber.complete();
          },
        });

        return () => subscription.unsubscribe();
      });
    }),
  );

  return agent;
}

function createReadonlyContextAgent() {
  const agent = createAgent("/readonly-state-agent-context");

  agent.use(
    new FunctionMiddleware((input, next) => {
      // The outer createAgent middleware already stripped replay-safe ids
      // on `input.messages`, so the injected system message rides along
      // with already-canonicalised toolCallIds.
      const contextMessage = buildContextSystemMessage(
        (input as { context?: unknown }).context,
      );
      if (!contextMessage) {
        return next.run(input);
      }

      return next.run({
        ...input,
        messages: [
          {
            id: `${input.runId ?? crypto.randomUUID()}-app-context`,
            role: "system",
            content: contextMessage,
          },
          ...(input.messages ?? []),
        ],
      });
    }),
  );

  return agent;
}

function createSharedStateReadWriteAgent() {
  const agent = createAgent("/shared-state-read-write");

  agent.use(
    new FunctionMiddleware((input, next) => {
      // The outer createAgent middleware already stripped replay-safe ids
      // on `input.messages`; the injected shared-state system message
      // rides along with already-canonicalised toolCallIds.
      return next.run({
        ...input,
        messages: [
          {
            id: `${input.runId ?? crypto.randomUUID()}-shared-state`,
            role: "system",
            content: buildSharedStateReadWriteSystemMessage(
              (input as { state?: unknown }).state,
            ),
          },
          ...(input.messages ?? []),
        ],
      });
    }),
  );

  return agent;
}

function createReasoningAgent(path = "/reasoning") {
  const agent = createAgent(path);

  // Microsoft.Agents.AI.Hosting.AGUI.AspNetCore@1.0.0-preview.251110.1
  // does not emit AG-UI REASONING_MESSAGE_* events yet. Keep the backend
  // behavior intact, but add the reasoning-role stream shape CopilotKit's
  // v2 chat slots expect. Also strip replayed reasoning messages before
  // sending follow-up turns back to the .NET AG-UI host, whose input mapper
  // only accepts user/assistant/system/tool roles.
  agent.use(
    new FunctionMiddleware((input, next) => {
      // The outer createAgent middleware already stripped replay-safe ids
      // on inbound messages. Here we additionally drop reasoning-role
      // messages because the .NET AG-UI host's input mapper rejects
      // them (it only accepts user/assistant/system/tool roles).
      const sanitizedInput = {
        ...input,
        messages: input.messages?.filter(
          (message) => message.role !== "reasoning",
        ),
      };
      const reasoningMessageId = `${input.runId ?? crypto.randomUUID()}-reasoning`;
      const reasoningDelta =
        "I am checking the request, choosing the relevant tool or answer path, and then summarizing the result.";

      return new Observable<BaseEvent>((subscriber) => {
        let injected = false;
        const injectReasoning = () => {
          if (injected) return;
          injected = true;
          subscriber.next({
            type: EventType.REASONING_START,
            messageId: reasoningMessageId,
          } as BaseEvent);
          subscriber.next({
            type: EventType.REASONING_MESSAGE_START,
            messageId: reasoningMessageId,
            role: "reasoning",
          } as BaseEvent);
          subscriber.next({
            type: EventType.REASONING_MESSAGE_CONTENT,
            messageId: reasoningMessageId,
            delta: reasoningDelta,
          } as BaseEvent);
          subscriber.next({
            type: EventType.REASONING_MESSAGE_END,
            messageId: reasoningMessageId,
          } as BaseEvent);
          subscriber.next({
            type: EventType.REASONING_END,
            messageId: reasoningMessageId,
          } as BaseEvent);
        };

        const subscription = next.run(sanitizedInput).subscribe({
          next(event) {
            subscriber.next(event);
            if (event.type === EventType.RUN_STARTED) {
              injectReasoning();
            }
          },
          error(error) {
            subscriber.error(error);
          },
          complete() {
            injectReasoning();
            subscriber.complete();
          },
        });

        return () => subscription.unsubscribe();
      });
    }),
  );

  return agent;
}

// Register the same agent under all names used by demo pages.
const agentNames = [
  "agentic_chat",
  "human_in_the_loop",
  "tool-rendering",
  "shared-state-read",
  "prebuilt-sidebar",
  "prebuilt-popup",
  "chat-slots",
  "chat-customization-css",
  "headless-simple",
  "frontend-tools",
  "frontend-tools-async",
  // Aliases for ADK/LGP-style underscore names (frontend pages use these).
  "frontend_tools",
  "frontend_tools_async",
];

// Agent names routed to the interrupt-adapted scheduling backend. Both
// gen-ui-interrupt and interrupt-headless share the same MS Agent Framework
// scheduling agent; only the frontend UX differs (inline in chat vs. external
// popup driven from a button grid).
const interruptAgentNames = ["gen-ui-interrupt", "interrupt-headless"];

const agents: Record<string, AbstractAgent> = {};
for (const name of agentNames) {
  agents[name] = createAgent();
}

agents["human_in_the_loop"] = createReplaySafeAgent("/", [
  "generate_task_steps",
]);

agents["headless-complete"] = createAgent("/headless-complete");

// Interrupt-adapted demos — frontend-tool shim for LangGraph `interrupt()`.
// Both gen-ui-interrupt and interrupt-headless share the same scheduling agent;
// only the frontend UX differs (inline time-picker vs. external popup).
for (const name of interruptAgentNames) {
  agents[name] = createReplaySafeAgent("/interrupt-adapted", [
    "schedule_meeting",
  ]);
}
// In-App HITL -- async frontend-tool + app-level modal (outside chat).
// Dedicated hitl-in-app agent mounted at /hitl-in-app on the FastAPI
// backend; agent has tools=[] and relies on the frontend-provided
// `request_user_approval` tool injected by CopilotKit at request time.
agents["hitl-in-app"] = createReplaySafeAgent("/hitl-in-app", [
  "request_user_approval",
]);

// In-Chat HITL -- frontend-defined `book_call` tool rendered inline in the
// chat via `useHumanInTheLoop`. Backend agent has tools=[] and routes to
// /hitl-in-chat on the FastAPI backend.
agents["hitl-in-chat"] = createReplaySafeAgent("/hitl-in-chat", ["book_call"]);

// Generative UI Agent — backend with `set_steps` tool + `steps` state
// schema mirrored from LGP's gen_ui_agent. The frontend renders a live
// progress card subscribed to `agent.state.steps`.
agents["gen-ui-agent"] = createGenUiAgent();

// Tool-Based Generative UI -- frontend registers `render_bar_chart` and
// `render_pie_chart` via `useComponent`; backend agent has tools=[] and a
// system prompt that picks the right chart type for the user's request.
agents["gen-ui-tool-based"] = createAgent("/gen-ui-tool-based");

// Shared State (Streaming) — `write_document` tool whose `document` string
// arg streams into `state.document` per-token. The shim buffers the tool's
// TOOL_CALL_ARGS deltas and emits an incremental STATE_SNAPSHOT on each,
// mirroring `createGenUiAgent`'s set_steps bridge (the .NET host has no
// `predict_state_config`, so per-token emission is done here on the route).
// See `src/agents/shared_state_streaming.py` for the Python reference.
agents["shared-state-streaming"] = createSharedStateStreamingAgent();

// Readonly state via `useAgentContext` — minimal agent, no tools, reads
// frontend-provided context entries on every turn.
agents["readonly-state-agent-context"] = createReadonlyContextAgent();

// Shared State (Read + Write) — bidirectional state via state_schema +
// state_update. Backend exposes a dedicated agent at /shared-state-read-write
// with `preferences` + `notes` slots; UI writes preferences via setState,
// agent writes notes via the `set_notes` tool.
agents["shared-state-read-write"] = createSharedStateReadWriteAgent();

// Sub-Agents — supervisor agent at /subagents that delegates to research /
// writing / critique sub-agents and surfaces a live `delegations` log to the
// UI via shared state.
agents["subagents"] = createAgent("/subagents");

// Thread-ID frontend-tool round-trip — reuses the default frontend_tools
// passthrough agent (no dedicated backend). The demo exercises thread-id
// persistence across a frontend tool round-trip; it mirrors langgraph-python's
// mapping of this demo name onto the frontend_tools agent.
agents["threadid-frontend-tool-roundtrip"] = createAgent();

agents["default"] = createAgent();

// Tool-rendering demos — share the dedicated reasoning-chain agent
// mounted at /tool-rendering-reasoning-chain on the Python backend. All
// three cells call the same agent; they differ only in how the frontend
// renders tool calls.
// Reasoning cells (`reasoning-default` + `reasoning-custom`) share a
// dedicated backend mounted at `/reasoning` that uses the OpenAI Responses
// API (gpt-5/o-series) — the only chat client that emits AG-UI
// `REASONING_MESSAGE_*` events. See `src/agents/reasoning_agent.py`.
agents["reasoning-default"] = createReasoningAgent("/reasoning");
agents["reasoning-custom"] = createReasoningAgent("/reasoning");

// Tool-rendering demos — the plain `tool-rendering` cell and the two
// catchall variants share a non-reasoning backend (mounted at
// `/tool-rendering`). The reasoning-chain cell has its own dedicated
// backend (mounted at `/tool-rendering-reasoning-chain`) that routes
// through OpenAI's Responses API for reasoning streaming; mixing
// reasoning blocks into the catchall renderers breaks the
// default-catchall cell's spec.
agents["tool-rendering"] = createAgent("/tool-rendering");
agents["tool-rendering-default-catchall"] = createAgent("/tool-rendering");
agents["tool-rendering-custom-catchall"] = createAgent("/tool-rendering");
agents["tool-rendering-reasoning-chain"] = createReasoningAgent(
  "/tool-rendering-reasoning-chain",
);

console.log(
  `[copilotkit/route] Registered ${Object.keys(agents).length} agent names: ${Object.keys(agents).join(", ")}`,
);

export const POST = async (req: NextRequest) => {
  const url = req.url;
  const contentType = req.headers.get("content-type");
  if (ROUTE_DEBUG) {
    console.log(
      `[copilotkit/route] POST ${url} (content-type: ${contentType})`,
    );
  }

  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime: new CopilotRuntime({
        // @ts-ignore -- Published CopilotRuntime agents type wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed in source, pending release
        agents,
      }),
    });

    const response = await handleRequest(req);
    if (!response.ok) {
      console.log(`[copilotkit/route] Response status: ${response.status}`);
    } else if (ROUTE_DEBUG) {
      console.log(`[copilotkit/route] Response status: ${response.status}`);
    }
    return response;
  } catch (error: unknown) {
    const err = error as Error;
    console.error(`[copilotkit/route] ERROR: ${err.message}`);
    console.error(`[copilotkit/route] Stack: ${err.stack}`);
    return NextResponse.json(
      { error: err.message, stack: err.stack },
      { status: 500 },
    );
  }
};

export const GET = async () => {
  if (ROUTE_DEBUG) {
    console.log("[copilotkit/route] GET /api/copilotkit (health probe)");
  }

  let agentStatus = "unknown";
  try {
    const res = await fetch(`${AGENT_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    agentStatus = res.ok ? "reachable" : `error (${res.status})`;
  } catch (e: unknown) {
    agentStatus = `unreachable (${(e as Error).message})`;
  }

  return NextResponse.json({
    status: "ok",
    agent_url: AGENT_URL,
    agent_status: agentStatus,
    env: {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ? "set" : "NOT SET",
      NODE_ENV: process.env.NODE_ENV,
    },
  });
};
