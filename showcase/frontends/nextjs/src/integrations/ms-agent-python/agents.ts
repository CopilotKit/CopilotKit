// The agents of each ms-agent-python demo. One agent server runs them all,
// most at an endpoint of their own. Some demos also need an adapter between
// the page and the server: see MIDDLEWARE below the adapters.
import { EventType } from "@ag-ui/client";
import type {
  BaseEvent,
  Message,
  MiddlewareFunction,
  ToolMessage,
} from "@ag-ui/client";
import { concatMap, map } from "rxjs";
import { DEMO_AGENT_IDS } from "@/demo-agents";
import { httpAgent } from "@/lib/agents";
import type { IntegrationRuntime, RuntimeOptions } from "@/lib/agents";
import { createTranscriptionService } from "@/lib/transcription-service";

// The path of each demo's agent on the agent server, by demo id.
const AGENT_PATHS: Partial<Record<string, string>> = {
  "a2ui-fixed-schema": "/a2ui_fixed",
  "a2ui-recovery": "/a2ui_recovery",
  "agent-config": "/agent-config",
  "agentic-chat": "/",
  auth: "/",
  "beautiful-chat": "/beautiful-chat",
  "chat-customization-css": "/",
  "chat-slots": "/",
  "declarative-gen-ui": "/a2ui_dynamic",
  "declarative-hashbrown": "/byoc-hashbrown",
  "declarative-json-render": "/byoc-json-render",
  "frontend-tools": "/",
  "frontend-tools-async": "/",
  "gen-ui-agent": "/gen-ui-agent",
  "gen-ui-interrupt": "/interrupt-adapted",
  "gen-ui-tool-based": "/gen-ui-tool-based",
  "headless-complete": "/headless-complete",
  "headless-simple": "/",
  hitl: "/",
  "hitl-in-app": "/hitl-in-app",
  "hitl-in-chat": "/hitl-in-chat",
  "interrupt-headless": "/interrupt-adapted",
  "mcp-apps": "/mcp-apps",
  multimodal: "/multimodal",
  "open-gen-ui": "/open-gen-ui",
  "open-gen-ui-advanced": "/open-gen-ui-advanced",
  "prebuilt-popup": "/",
  "prebuilt-sidebar": "/",
  "readonly-state-agent-context": "/readonly-state-agent-context",
  "reasoning-custom": "/reasoning",
  "reasoning-default": "/reasoning",
  "shared-state-read": "/",
  "shared-state-read-write": "/shared-state-read-write",
  "shared-state-streaming": "/shared-state-streaming",
  subagents: "/subagents",
  "tool-rendering": "/tool-rendering",
  "tool-rendering-custom-catchall": "/tool-rendering",
  "tool-rendering-default-catchall": "/tool-rendering",
  "tool-rendering-reasoning-chain": "/tool-rendering-reasoning-chain",
  voice: "/voice",
};

// The runtime options that replace DEMO_RUNTIME_OPTIONS for ms-agent-python,
// key by key, by demo id.
const RUNTIME_OPTIONS: Partial<Record<string, () => RuntimeOptions>> = {
  // These agents have no A2UI tool of their own. With `injectA2UITool`, the
  // Agent Framework adapter adds its `generate_a2ui` sub-agent.
  "a2ui-recovery": () => ({
    a2ui: {
      injectA2UITool: true,
      defaultCatalogId: "declarative-gen-ui-catalog",
    },
  }),
  "beautiful-chat": () => ({
    a2ui: {
      injectA2UITool: true,
      defaultCatalogId: "copilotkit://app-dashboard-catalog",
    },
  }),
  "declarative-gen-ui": () => ({
    a2ui: {
      injectA2UITool: true,
      defaultCatalogId: "declarative-gen-ui-catalog",
    },
  }),
  // Transcribes with OPENAI_TRANSCRIPTION_API_KEY. Without it the voice demo
  // has no transcription.
  voice: () => ({ transcriptionService: createTranscriptionService() }),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Adapter: replay-safe tool calls.

// The suffix that `replaySafe` gives a tool call id for one run.
const RUN_SUFFIX = /__ck_run_[0-9a-f-]+$/i;

function withoutRunSuffix(toolCallId: string) {
  return toolCallId.replace(RUN_SUFFIX, "");
}

// `message` with each of its tool call ids changed by `rename`.
function renameToolCallIds(
  message: Message,
  rename: (toolCallId: string) => string,
) {
  if (message.role === "tool") {
    return { ...message, toolCallId: rename(message.toolCallId) };
  }
  if (message.role === "assistant" && message.toolCalls !== undefined) {
    const toolCalls = message.toolCalls.map((toolCall) => ({
      ...toolCall,
      id: rename(toolCall.id),
    }));
    return { ...message, toolCalls };
  }
  return message;
}

function resultText({ content }: ToolMessage) {
  if (typeof content === "string") return content;
  return content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}

// True when a plain-text tool result says that the call was cancelled and
// nothing was booked.
function reportsCancellation(text: string) {
  const lower = text.toLowerCase();
  const saysCancelled =
    lower.includes("cancelled") || lower.includes("canceled");
  const saysNothingBooked = ["not scheduled", "not booked", "no time"].some(
    (phrase) => lower.includes(phrase),
  );
  return saysCancelled && saysNothingBooked;
}

// The decision that a tool result reports: "approved", "rejected",
// "cancelled", or undefined when it reports none.
function toolDecision(text: string) {
  let result: unknown;
  try {
    result = JSON.parse(text);
  } catch {
    return reportsCancellation(text) ? "cancelled" : undefined;
  }
  if (!isRecord(result)) return undefined;
  const isApproved = result.approved === true || result.accepted === true;
  const isRejected = result.approved === false || result.accepted === false;
  const isCancelled = result.cancelled === true || result.canceled === true;
  if (isApproved) return "approved";
  if (isRejected) return "rejected";
  if (isCancelled) return "cancelled";
  return undefined;
}

// When the last message is a new user message, leaves out the tool calls and
// tool results of earlier turns, so that the agent answers the new message.
// An assistant message that only called tools is left out too.
function withoutEarlierToolTurns(messages: Message[]) {
  const isNewUserTurn = messages.at(-1)?.role === "user";
  if (!isNewUserTurn) return messages;
  const lastIndex = messages.length - 1;
  return messages.flatMap((message, index) => {
    if (index === lastIndex) return [message];
    if (message.role === "tool") return [];
    if (message.role !== "assistant" || message.toolCalls === undefined) {
      return [message];
    }
    const { toolCalls: _toolCalls, ...withoutToolCalls } = message;
    return withoutToolCalls.content?.trim() ? [withoutToolCalls] : [];
  });
}

// The messages that a replay-safe agent sends to the server.
function replaySafeMessages(messages: Message[]) {
  const stripped = messages.map((message) =>
    renameToolCallIds(message, withoutRunSuffix),
  );
  const decisions = new Map<string, string>();
  for (const message of stripped) {
    if (message.role !== "tool") continue;
    const decision = toolDecision(resultText(message));
    if (decision !== undefined) decisions.set(message.toolCallId, decision);
  }
  const withDecisions = stripped.map((message) =>
    renameToolCallIds(message, (toolCallId) => {
      const decision = decisions.get(toolCallId);
      return decision === undefined ? toolCallId : `${toolCallId}__${decision}`;
    }),
  );
  return withoutEarlierToolTurns(withDecisions);
}

// Makes the calls of `toolNames` safe to replay against recorded aimock
// responses, which use the same tool call id in every run:
// - The page gets each call with the suffix `__ck_run_<run id>` on its id, so
//   a new call never looks like an answered one.
// - The server gets the ids back without that suffix. A call with a decided
//   result gets `__approved`, `__rejected` or `__cancelled` instead, which
//   the recorded responses match on.
// - After a new user message, the server gets no tool calls or results from
//   earlier turns.
function replaySafe(toolNames: readonly string[]) {
  const replaySafeTools = new Set(toolNames);
  const middleware: MiddlewareFunction = (input, next) => {
    // The run-scoped id of each replay-safe call in this run, by its id.
    const runScopedIds = new Map<string, string>();
    const messages = replaySafeMessages(input.messages);
    return next.run({ ...input, messages }).pipe(
      map((event) => {
        const { toolCallId, toolCallName } = event;
        if (typeof toolCallId !== "string") return event;
        const id = withoutRunSuffix(toolCallId);
        const startsCall =
          event.type === EventType.TOOL_CALL_START ||
          event.type === EventType.TOOL_CALL_CHUNK;
        const isReplaySafeCall =
          startsCall &&
          typeof toolCallName === "string" &&
          replaySafeTools.has(toolCallName);
        if (isReplaySafeCall) {
          runScopedIds.set(id, `${id}__ck_run_${input.runId}`);
        }
        const runScopedId = runScopedIds.get(id);
        if (runScopedId === undefined) return event;
        return { ...event, toolCallId: runScopedId };
      }),
    );
  };
  return middleware;
}

// Adapter: set_steps calls as agent state.

// A state snapshot with the steps in the `set_steps` arguments so far, once
// they parse as JSON.
function stepsSnapshot(args: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(args);
  } catch {
    // The arguments arrive in chunks. Wait for the rest.
    return [];
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.steps)) return [];
  return [
    { type: EventType.STATE_SNAPSHOT, snapshot: { steps: parsed.steps } },
  ];
}

// The events that the page gets for one event from the server.
function setStepsEvents(event: BaseEvent, argsByCall: Map<string, string>) {
  const { toolCallId } = event;
  if (typeof toolCallId !== "string") return [event];
  const startsSetSteps =
    event.type === EventType.TOOL_CALL_START &&
    event.toolCallName === "set_steps";
  if (startsSetSteps) {
    argsByCall.set(toolCallId, "");
    return [];
  }
  const args = argsByCall.get(toolCallId);
  if (args === undefined) return [event];
  switch (event.type) {
    case EventType.TOOL_CALL_ARGS: {
      const argsSoFar = args + String(event.delta ?? "");
      argsByCall.set(toolCallId, argsSoFar);
      return stepsSnapshot(argsSoFar);
    }
    case EventType.TOOL_CALL_END:
      return [];
    case EventType.TOOL_CALL_RESULT:
      argsByCall.delete(toolCallId);
      return [];
    default:
      return [event];
  }
}

// The gen-ui-agent server reports its plan with `set_steps` tool calls. The
// page gets each call's steps as the agent state `{ steps }` instead of the
// call itself.
const setStepsAsState: MiddlewareFunction = (input, next) => {
  // The arguments so far of each `set_steps` call in this run, by call id.
  const argsByCall = new Map<string, string>();
  return next
    .run(input)
    .pipe(concatMap((event) => setStepsEvents(event, argsByCall)));
};

// Adapter: preferences in the prompt.

// The system prompt with the user's preferences from the agent state.
function preferencesPrompt(state: unknown) {
  const preferences: Record<string, unknown> =
    isRecord(state) && isRecord(state.preferences) ? state.preferences : {};
  const name = typeof preferences.name === "string" ? preferences.name : "";
  const tone =
    typeof preferences.tone === "string" ? preferences.tone : "casual";
  const language =
    typeof preferences.language === "string" ? preferences.language : "English";
  const interests = Array.isArray(preferences.interests)
    ? preferences.interests.filter(
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

// The shared-state-read-write server does not read the agent state. Each run
// starts with a system message that holds the user's preferences from it.
const preferencesInPrompt: MiddlewareFunction = (input, next) =>
  next.run({
    ...input,
    messages: [
      {
        id: `${input.runId}-shared-state`,
        role: "system",
        content: preferencesPrompt(input.state),
      },
      ...input.messages,
    ],
  });

// The adapter of each demo whose agent needs one, by demo id.
const MIDDLEWARE: Partial<Record<string, MiddlewareFunction>> = {
  "gen-ui-agent": setStepsAsState,
  "gen-ui-interrupt": replaySafe(["schedule_meeting"]),
  hitl: replaySafe(["generate_task_steps"]),
  "hitl-in-app": replaySafe(["request_user_approval"]),
  "hitl-in-chat": replaySafe(["book_call"]),
  "interrupt-headless": replaySafe(["schedule_meeting"]),
  "shared-state-read-write": preferencesInPrompt,
};

export default {
  createRuntimeConfig(demoId) {
    const path = AGENT_PATHS[demoId];
    const agentIds = DEMO_AGENT_IDS[demoId];
    if (path === undefined || agentIds === undefined) return undefined;
    const middleware = MIDDLEWARE[demoId];
    const agents = Object.fromEntries(
      agentIds.map((agentId) => {
        const agent = httpAgent("ms-agent-python", path);
        return [agentId, middleware ? agent.use(middleware) : agent];
      }),
    );
    return { agents, options: RUNTIME_OPTIONS[demoId]?.() };
  },
} satisfies IntegrationRuntime;
