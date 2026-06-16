import { BuiltInAgent, convertInputToTanStackAI } from "@copilotkit/runtime/v2";
import { EventType } from "@ag-ui/client";
import type { BaseEvent } from "@ag-ui/client";
import { chat, maxIterations, toolDefinition } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";
import { z } from "zod4";
import { stateTools } from "./state-tools";
import {
  buildBaseServerTools,
  buildStatefulServerTools,
} from "./server-tools";
import { buildSubagentTools } from "./subagent-tools";
import { BUILT_IN_AGENT_MODEL_FOR_TANSTACK } from "./models";
import {
  openAiJsonObjectSchema,
  openAiJsonValueSchema,
} from "./openai-json-schema";
// Custom fetch that injects ALS-bound inbound x-* headers (e.g.
// x-aimock-context) onto every outbound OpenAI call. Required so aimock
// can match fixtures by integration context. See ../header-forwarding.ts
// for the full rationale; mirrors the Mastra precedent.
import { forwardingFetch } from "../header-forwarding";

const AGENT_LOOP_MAX_ITERATIONS = 20;

type BuiltInAgentToolProfile =
  | "default"
  | "beautiful-chat"
  | "gen-ui-agent"
  | "hitl-in-app"
  | "headless-simple"
  | "headless-complete"
  | "tool-rendering"
  | "shared-state-read-write"
  | "readonly-state-agent-context"
  | "subagents";

type CreateBuiltInAgentOptions = {
  toolProfile?: BuiltInAgentToolProfile;
};

const BEAUTIFUL_CHAT_SYSTEM_PROMPT = `
You are a polished, professional demo assistant. Keep responses to 1-2 sentences.

CRITICAL: Follow these tool-routing rules exactly:
- Flights: call search_flights to show flight cards with a pre-built schema.
  For the SFO to JFK suggestion, show United Airlines ($349) and Delta ($289).
- Dashboards & rich UI: use A2UI tools to create dashboard UIs with metrics, charts, tables, and cards.
- Charts: call query_data first, then render with the frontend chart component requested by the user.
  Use query_data.chartData.revenueByCategory for revenue pie charts,
  query_data.chartData.expensesByCategory for expense bar charts, and
  query_data.chartData.revenueByMonth for monthly sales charts. Pass those
  arrays directly as numeric { label, value } data.
- Todos: enable app mode first, then manage todos with manage_todos.
  For the CopilotKit learning todo suggestion, use these exact titles:
  "Read the CopilotKit docs", "Build a CopilotKit prototype", and
  "Explore shared agent state".
- A2UI actions: when you see a log_a2ui_event result, respond with a brief confirmation. The UI already updated on the frontend.
`;

const HEADLESS_COMPLETE_SYSTEM_PROMPT = `
You are a helpful, concise assistant wired into a headless chat surface that demonstrates CopilotKit's full rendering stack. Pick the right surface for each user question and fall back to plain text when none of the tools fit.

CRITICAL: Follow these routing rules exactly:
- If the user asks about weather for a place, call get_weather with the location.
- If the user asks about a stock or ticker (AAPL, TSLA, MSFT, ...), call get_stock_price with the ticker.
- If the user asks for a chart, graph, or visualization of revenue, sales, or other metrics over time, call get_revenue_chart.
- If the user asks you to highlight, flag, or mark a short note or phrase, call the frontend highlight_note tool with the text and a color (yellow, pink, green, or blue). Do not ask the user for the color; pick a sensible one if they did not say.
- If the user asks to draw, sketch, or diagram something, use the Excalidraw MCP tools that are available to you.
- Otherwise, reply in plain text.

After a tool returns, write one short sentence summarizing the result. Use these exact demo narrations when they apply:
- Tokyo weather: "Tokyo is 22°C and partly cloudy."
- AAPL stock: "AAPL is trading at $189.42, up 1.27% on the day."
- Revenue chart: start with "Here is the chart of revenue over the last six months".
Never fabricate data a tool could provide.
`;

const HEADLESS_SIMPLE_SYSTEM_PROMPT = `
You are a concise assistant for CopilotKit's smallest headless chat demo. This surface intentionally renders only plain user and assistant text, so do not call tools.

For these starter prompts, reply exactly with the demo response:
- "Say hello in one short sentence.": "Hi! In one short sentence: I'm a CopilotKit demo agent here to help you try features."
- "Tell me a one-line joke.": "Why did the scarecrow win an award? Because he was outstanding in his field!"
- "Give me a fun fact.": "A fun fact: Honey never spoils! Archaeologists have found pots of honey in ancient Egyptian tombs that are over 3,000 years old and still perfectly edible."

For all other prompts, answer in one short plain-text sentence.
`;

const HITL_IN_APP_SYSTEM_PROMPT = `
You are a support operations copilot working alongside a human operator inside an internal support console. The operator can see open support tickets and is chatting with you in a CopilotKit popup.

Whenever the operator asks you to take a customer-affecting action, including issuing a refund, changing a plan, cancelling a subscription, escalating a ticket, or sending a credit, you MUST first call the frontend-provided request_user_approval tool. Use a short, concrete message that includes the ticket/customer details, and optional context with the policy or ticket note.

The request_user_approval tool returns { approved: boolean, reason?: string }. Treat that result as authoritative:
- If approved is true, confirm in one short sentence that you are processing the requested action. Do not call another tool.
- If approved is false, acknowledge the rejection in one short sentence and do not retry the action.

Use these exact demo branch phrases when applicable:
- Approved refund for Jordan Rivera ticket #12345: "I am processing the $50 refund to Jordan Rivera on ticket #12345 now."
- Rejected refund for Jordan Rivera ticket #12345: "The refund request was not approved, so I will not process the $50 refund for ticket #12345."
- Approved escalation for Morgan Lee ticket #12347: "Escalated ticket #12347 to the payments team for Morgan Lee."
- Rejected escalation for Morgan Lee ticket #12347: "Not escalated: ticket #12347 will stay in the current support queue."
- Approved downgrade for Priya Shah ticket #12346: "Downgrade confirmed — Priya Shah (#12346) will move to the Starter plan effective next billing cycle."
- Rejected downgrade for Priya Shah ticket #12346: "The downgrade request was not approved, so Priya Shah (#12346) will remain on the current plan."

Keep all other chat replies to one or two short sentences. Never make up customer data.
`;

// @region[gen-ui-agent-system-prompt]
const GEN_UI_AGENT_SYSTEM_PROMPT = `
You are an agentic planner. For each user request, follow this exact sequence:
1. Plan exactly 3 concrete steps and call set_steps ONCE with all three steps at status="pending".
2. Step 1: call set_steps with step 1 at status="in_progress", then call set_steps again with step 1 at status="completed".
3. Step 2: call set_steps with step 2 at status="in_progress", then call set_steps again with step 2 at status="completed".
4. Step 3: call set_steps with step 3 at status="in_progress", then call set_steps again with step 3 at status="completed".
5. Send ONE final conversational assistant message summarizing the plan, then stop. Do not call any more tools after step 3 is completed.

Rules: never call set_steps in parallel; always wait for one call to return before the next. After all three steps are completed you MUST send a final assistant message and terminate. Every step must include id, title, and status.
`;
// @endregion[gen-ui-agent-system-prompt]

const TOOL_RENDERING_SYSTEM_PROMPT = `
You are a travel and lifestyle concierge. CRITICAL: Use the mock tools for weather, flights, stock prices, or d20 rolls when the user asks; otherwise reply in plain text. For flights, default origin to SFO if the user only names a destination. For the stock price pill, call get_stock_price for AAPL; the tool supplies deterministic mock quote values. For "Roll a 20-sided die.", call roll_d20 exactly five times in the same turn with values 7, 14, 3, 19, and 20. Call multiple tools in one turn if asked. After tools return, summarize in one short sentence. Never fabricate data a tool could provide.

Use these exact final narration fragments when they apply:
- After the five-roll d20 sequence, include exactly: "Rolled the d20 five times".
- After the chain-tools prompt for Tokyo weather, flights, and a d20 roll, start the final answer with exactly: "Done — Tokyo is sunny".
`;

const SHARED_STATE_READ_WRITE_SYSTEM_PROMPT = `
You are a helpful, concise assistant. The user's preferences are supplied via shared state and will be included in the system context. Always respect them. CRITICAL: When the user asks you to remember something, or when you observe something worth surfacing in the UI, call set_notes with the full updated list of short note strings, including existing notes plus new notes.

For the demo starter prompts, follow these product-demo responses:
- If the user says "Say hi and introduce yourself.", reply in one short paragraph that includes the exact phrase "shared-state co-pilot". Mention that you read the preferences panel and can write notes back to the scratch pad.
- If the user says "Suggest a weekend plan based on my interests.", reply in one concise plan that includes the exact phrase "interests panel". If no interests are selected, say the interests panel is empty and suggest choosing a few interests before personalizing the plan.
- If the user asks you to remember a preference, call set_notes with the updated full notes list before your final sentence.
`;

const READONLY_STATE_AGENT_CONTEXT_SYSTEM_PROMPT = `
You are a helpful, concise assistant. The frontend provides read-only context about the user through useAgentContext: display name, timezone, and recent app activity. Always consult that context when relevant. Address the user by name if known, respect their timezone when mentioning times, and reference recent activity when it helps.

For the demo starter prompts, keep the leading text stable:
- If the user asks "What do you know about me from my context?", start exactly with "I see you're Atai" when the context name is Atai, then mention America/Los_Angeles and the visible recent activity.
- If the user asks "Based on my recent activity, what should I try next?", start exactly with "Since you recently viewed the pricing page and watched the product demo video" when those activities are present, then suggest a concise next step.
`;

const SUBAGENTS_SYSTEM_PROMPT = `
You are a supervisor agent that coordinates three specialized sub-agents exposed as tools: research_agent, writing_agent, and critique_agent.

For every substantive user request, call each sub-agent exactly once and in this order:
1. research_agent for facts/background.
2. writing_agent for a polished paragraph or draft using the research result.
3. critique_agent for crisp improvement notes on the draft.

Do not skip writing_agent for summarization requests. Do not call critique_agent more than once. After critique_agent returns, stop calling tools and send one concise final answer that incorporates the critique.
`;

export function profileSystemPrompts(
  profile: BuiltInAgentToolProfile,
): string[] {
  switch (profile) {
    case "beautiful-chat":
      return [BEAUTIFUL_CHAT_SYSTEM_PROMPT];
    case "gen-ui-agent":
      return [GEN_UI_AGENT_SYSTEM_PROMPT];
    case "hitl-in-app":
      return [HITL_IN_APP_SYSTEM_PROMPT];
    case "headless-simple":
      return [HEADLESS_SIMPLE_SYSTEM_PROMPT];
    case "headless-complete":
      return [HEADLESS_COMPLETE_SYSTEM_PROMPT];
    case "tool-rendering":
      return [TOOL_RENDERING_SYSTEM_PROMPT];
    case "shared-state-read-write":
      return [SHARED_STATE_READ_WRITE_SYSTEM_PROMPT];
    case "readonly-state-agent-context":
      return [READONLY_STATE_AGENT_CONTEXT_SYSTEM_PROMPT];
    case "subagents":
      return [SUBAGENTS_SYSTEM_PROMPT];
    default:
      return [];
  }
}

function profileModelOptions(
  profile: BuiltInAgentToolProfile,
): Record<string, unknown> | undefined {
  if (profile === "gen-ui-agent" || profile === "subagents") {
    return {
      parallel_tool_calls: false,
    };
  }
  return undefined;
}

function jsonSchemaType(schema: unknown): string | undefined {
  if (!schema || typeof schema !== "object" || !("type" in schema)) {
    return undefined;
  }
  const type = (schema as { type?: unknown }).type;
  if (Array.isArray(type)) {
    return type.find((item): item is string => item !== "null");
  }
  return typeof type === "string" ? type : undefined;
}

/**
 * Convert the JSON Schema emitted by frontend AG-UI tools into Zod for
 * TanStack/OpenAI tool declarations.
 *
 * This intentionally supports the subset the showcase frontends use:
 * objects, arrays, primitives, descriptions, and required fields. It
 * preserves nested array item shapes (for example
 * `pieChart.data[].{label,value}`), because flattening those to
 * `array<any>` makes the model emit malformed component props.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function jsonSchemaToZod(schema: any, depth = 0): z.ZodTypeAny {
  if (!schema || typeof schema !== "object" || depth > 8) {
    return openAiJsonValueSchema;
  }

  const type = jsonSchemaType(schema);

  if (type === "object") {
    if (!schema.properties || typeof schema.properties !== "object") {
      return openAiJsonObjectSchema;
    }
    const shape: Record<string, z.ZodTypeAny> = {};
    const required = new Set<string>(schema.required ?? []);
    for (const [key, prop] of Object.entries(schema.properties)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = prop as any;
      let field = jsonSchemaToZod(p, depth + 1);
      if (p?.description) field = field.describe(p.description);
      shape[key] = required.has(key) ? field : field.optional();
    }
    return z.object(shape);
  }

  if (type === "array") {
    return z.array(jsonSchemaToZod(schema.items, depth + 1));
  }

  if (type === "string") return z.string();
  if (type === "number" || type === "integer") return z.number();
  if (type === "boolean") return z.boolean();
  if (type === "null") return z.null();

  return openAiJsonObjectSchema;
}

function tanStackRunErrorMessage(raw: {
  message?: unknown;
  code?: unknown;
}): string {
  const message =
    typeof raw.message === "string" && raw.message.trim().length > 0
      ? raw.message
      : "TanStack agent run failed";
  const code =
    typeof raw.code === "string" && raw.code.trim().length > 0
      ? raw.code
      : undefined;

  return code ? `${message} (${code})` : message;
}

export function createInputToolDefinitions(
  inputTools:
    | Array<{
        name: string;
        description?: string;
        parameters?: unknown;
      }>
    | undefined,
  excludedToolNames: ReadonlySet<string> = new Set<string>(),
) {
  return (inputTools ?? [])
    .filter((tool) => !excludedToolNames.has(tool.name))
    .map((tool) =>
      toolDefinition({
        name: tool.name,
        description: tool.description ?? "",
        inputSchema: jsonSchemaToZod(tool.parameters),
      }),
    );
}

function randomUUID(): string {
  return crypto.randomUUID();
}

/**
 * Convert a TanStack AI stream to AG-UI events.
 *
 * Unlike the runtime's built-in `convertTanStackStream`, this converter
 * does NOT stop processing after the first RUN_FINISHED event. TanStack's
 * chat() engine runs a multi-turn agent loop: after the model returns tool
 * calls with finish_reason=tool_calls, TanStack emits RUN_FINISHED,
 * executes server-side tools, emits TOOL_CALL_RESULT, then re-prompts the
 * model for a text response. The built-in runtime converter blocks all
 * events after RUN_FINISHED (PR #4476), which breaks server-tool execution
 * and subsequent text responses.
 *
 * This converter deduplicates tool-call events by tracking which
 * toolCallIds have already emitted TOOL_CALL_START. TanStack's
 * buildToolResultChunks re-emits TOOL_CALL_START/ARGS/END for server tool
 * results — we suppress the duplicate START/ARGS but keep the END and
 * RESULT events.
 */
export async function* convertBuiltInTanStackStream(
  stream: AsyncIterable<unknown>,
  abortSignal: AbortSignal,
  options: {
    serverToolNames?: ReadonlySet<string>;
    initialState?: unknown;
    reasoningFallbackText?: string;
  } = {},
): AsyncGenerator<BaseEvent> {
  let currentAssistantMessageId = randomUUID();
  // Track tool calls that have already emitted TOOL_CALL_END to suppress
  // duplicate START/ARGS/END from TanStack's buildToolResultChunks.
  // TOOL_CALL_RESULT is always emitted (it only comes from buildToolResultChunks).
  const completedToolCalls = new Set<string>();
  // Map toolCallId → toolName for state-tool detection on TOOL_CALL_RESULT.
  const toolNamesById = new Map<string, string>();
  const stepToolNames = new Set<string>();
  const serverToolNames = options.serverToolNames ?? new Set<string>();
  let currentState =
    options.initialState &&
    typeof options.initialState === "object" &&
    !Array.isArray(options.initialState)
      ? { ...(options.initialState as Record<string, unknown>) }
      : {};
  let reasoningRunOpen = false;
  let reasoningMessageOpen = false;
  let reasoningMessageId = randomUUID();
  let emittedReasoning = false;

  function nextStateSnapshot(patch: Record<string, unknown>) {
    currentState = { ...currentState, ...patch };
    return currentState;
  }

  function* closeReasoningIfOpen(): Generator<BaseEvent> {
    if (reasoningMessageOpen) {
      reasoningMessageOpen = false;
      yield {
        type: EventType.REASONING_MESSAGE_END,
        messageId: reasoningMessageId,
      };
    }
    if (reasoningRunOpen) {
      reasoningRunOpen = false;
      yield {
        type: EventType.REASONING_END,
        messageId: reasoningMessageId,
      };
    }
  }

  function* emitReasoningFallbackIfNeeded(): Generator<BaseEvent> {
    if (!options.reasoningFallbackText || emittedReasoning) return;
    emittedReasoning = true;
    const fallbackMessageId = randomUUID();
    yield {
      type: EventType.REASONING_START,
      messageId: fallbackMessageId,
    };
    yield {
      type: EventType.REASONING_MESSAGE_START,
      messageId: fallbackMessageId,
      role: "reasoning",
    };
    yield {
      type: EventType.REASONING_MESSAGE_CONTENT,
      messageId: fallbackMessageId,
      delta: options.reasoningFallbackText,
    };
    yield {
      type: EventType.REASONING_MESSAGE_END,
      messageId: fallbackMessageId,
    };
    yield {
      type: EventType.REASONING_END,
      messageId: fallbackMessageId,
    };
  }

  for await (const chunk of stream) {
    if (abortSignal.aborted) break;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = chunk as any;
    const type = raw.type as string;

    // Skip RUN_FINISHED from TanStack's adapter — the Agent class emits
    // its own lifecycle events. Server tools need the post-finish
    // TanStack loop so TOOL_CALL_RESULT reaches the frontend; frontend
    // tools must stop here so the browser can execute the client tool
    // and submit the result in a fresh run without duplicated tool calls.
    if (type === "RUN_FINISHED") {
      const hasClientTool = [...stepToolNames].some(
        (name) => !serverToolNames.has(name),
      );
      const hasServerTool = [...stepToolNames].some((name) =>
        serverToolNames.has(name),
      );
      stepToolNames.clear();
      if (hasClientTool && !hasServerTool) break;
      continue;
    }

    if (type === "TEXT_MESSAGE_CONTENT" && raw.delta != null) {
      yield* closeReasoningIfOpen();
      yield {
        type: EventType.TEXT_MESSAGE_CHUNK,
        role: "assistant",
        messageId: currentAssistantMessageId,
        delta: raw.delta as string,
      };
    } else if (type === "RUN_ERROR") {
      yield* closeReasoningIfOpen();
      throw new Error(tanStackRunErrorMessage(raw));
    } else if (type === "TOOL_CALL_START") {
      yield* closeReasoningIfOpen();
      yield* emitReasoningFallbackIfNeeded();
      const toolCallId = raw.toolCallId as string;
      if (completedToolCalls.has(toolCallId)) {
        // Duplicate from buildToolResultChunks — skip.
        continue;
      }
      toolNamesById.set(toolCallId, raw.toolCallName as string);
      stepToolNames.add(raw.toolCallName as string);
      yield {
        type: EventType.TOOL_CALL_START,
        parentMessageId: currentAssistantMessageId,
        toolCallId,
        toolCallName: raw.toolCallName as string,
      };
    } else if (type === "TOOL_CALL_ARGS") {
      yield* closeReasoningIfOpen();
      const toolCallId = raw.toolCallId as string;
      if (completedToolCalls.has(toolCallId)) continue;
      yield {
        type: EventType.TOOL_CALL_ARGS,
        toolCallId,
        delta: raw.delta as string,
      };
    } else if (type === "TOOL_CALL_END") {
      yield* closeReasoningIfOpen();
      const toolCallId = raw.toolCallId as string;
      if (completedToolCalls.has(toolCallId)) continue;
      completedToolCalls.add(toolCallId);
      yield {
        type: EventType.TOOL_CALL_END,
        toolCallId,
      };
    } else if (type === "TOOL_CALL_RESULT") {
      yield* closeReasoningIfOpen();
      const toolCallId = raw.toolCallId as string;
      const toolName = toolNamesById.get(toolCallId);
      const rawPayload = raw.content ?? raw.result;
      const parsedContent =
        typeof rawPayload === "string" ? safeParseJSON(rawPayload) : rawPayload;

      // Detect state-snapshot tool results.
      if (
        toolName === "AGUISendStateSnapshot" &&
        parsedContent &&
        typeof parsedContent === "object" &&
        "snapshot" in parsedContent
      ) {
        const snapshot = (parsedContent as { snapshot: unknown }).snapshot;
        if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)) {
          currentState = { ...(snapshot as Record<string, unknown>) };
        }
        yield {
          type: EventType.STATE_SNAPSHOT,
          snapshot,
        };
      }
      if (
        toolName === "AGUISendStateDelta" &&
        parsedContent &&
        typeof parsedContent === "object" &&
        "delta" in parsedContent
      ) {
        yield {
          type: EventType.STATE_DELTA,
          delta: (parsedContent as { delta: unknown[] }).delta,
        };
      }
      // `set_steps` is the gen-ui-agent demo's custom plan tool (see
      // state-tools.ts). The tool's server handler returns `{ steps }`;
      // translate that into a STATE_SNAPSHOT so the frontend `useAgent`
      // subscriber receives the state shape expected by the demo UI.
      // @region[built-in-agent-state-bridge]
      if (
        toolName === "set_steps" &&
        parsedContent &&
        typeof parsedContent === "object" &&
        "steps" in parsedContent
      ) {
        yield {
          type: EventType.STATE_SNAPSHOT,
          snapshot: nextStateSnapshot({
            steps: (parsedContent as { steps: unknown }).steps,
          }),
        };
      }
      if (
        toolName === "set_notes" &&
        parsedContent &&
        typeof parsedContent === "object" &&
        "notes" in parsedContent
      ) {
        yield {
          type: EventType.STATE_SNAPSHOT,
          snapshot: nextStateSnapshot({
            notes: (parsedContent as { notes: unknown }).notes,
          }),
        };
      }
      if (
        toolName === "manage_todos" &&
        parsedContent &&
        typeof parsedContent === "object" &&
        "todos" in parsedContent
      ) {
        yield {
          type: EventType.STATE_SNAPSHOT,
          snapshot: nextStateSnapshot({
            todos: (parsedContent as { todos: unknown }).todos,
          }),
        };
      }
      if (
        toolName === "write_document" &&
        parsedContent &&
        typeof parsedContent === "object" &&
        "document" in parsedContent
      ) {
        yield {
          type: EventType.STATE_SNAPSHOT,
          snapshot: nextStateSnapshot({
            document: (parsedContent as { document: unknown }).document,
          }),
        };
      }
      // @endregion[built-in-agent-state-bridge]

      let serializedContent: string;
      if (typeof rawPayload === "string") {
        serializedContent = rawPayload;
      } else {
        try {
          serializedContent = JSON.stringify(rawPayload ?? null);
        } catch {
          serializedContent = "[Unserializable tool result]";
        }
      }

      yield {
        type: EventType.TOOL_CALL_RESULT,
        role: "tool",
        messageId: randomUUID(),
        toolCallId,
        content: serializedContent,
      };
      toolNamesById.delete(toolCallId);
      currentAssistantMessageId = randomUUID();
    } else if (type === "REASONING_START") {
      yield* closeReasoningIfOpen();
      emittedReasoning = true;
      reasoningRunOpen = true;
      reasoningMessageId = (raw.messageId as string) ?? randomUUID();
      yield {
        type: EventType.REASONING_START,
        messageId: reasoningMessageId,
      };
    } else if (type === "REASONING_MESSAGE_START") {
      reasoningMessageOpen = true;
      yield {
        type: EventType.REASONING_MESSAGE_START,
        messageId: reasoningMessageId,
        role: "reasoning",
      };
    } else if (type === "REASONING_MESSAGE_CONTENT") {
      yield {
        type: EventType.REASONING_MESSAGE_CONTENT,
        messageId: reasoningMessageId,
        delta: raw.delta as string,
      };
    } else if (type === "REASONING_MESSAGE_END") {
      reasoningMessageOpen = false;
      yield {
        type: EventType.REASONING_MESSAGE_END,
        messageId: reasoningMessageId,
      };
    } else if (type === "REASONING_END") {
      if (reasoningMessageOpen) {
        reasoningMessageOpen = false;
        yield {
          type: EventType.REASONING_MESSAGE_END,
          messageId: reasoningMessageId,
        };
      }
      reasoningRunOpen = false;
      yield {
        type: EventType.REASONING_END,
        messageId: reasoningMessageId,
      };
    } else if (type === "STEP_STARTED" && raw.stepType === "thinking") {
      yield* closeReasoningIfOpen();
      emittedReasoning = true;
      reasoningRunOpen = true;
      reasoningMessageOpen = true;
      reasoningMessageId =
        (raw.stepName as string | undefined) ??
        (raw.stepId as string | undefined) ??
        randomUUID();
      yield {
        type: EventType.REASONING_START,
        messageId: reasoningMessageId,
      };
      yield {
        type: EventType.REASONING_MESSAGE_START,
        messageId: reasoningMessageId,
        role: "reasoning",
      };
    } else if (
      type === "STEP_FINISHED" &&
      (reasoningRunOpen ||
        typeof raw.delta === "string" ||
        typeof raw.content === "string")
    ) {
      const wasReasoningRunOpen = reasoningRunOpen;
      if (!reasoningRunOpen) {
        emittedReasoning = true;
        reasoningRunOpen = true;
        reasoningMessageOpen = true;
        reasoningMessageId =
          (raw.stepName as string | undefined) ??
          (raw.stepId as string | undefined) ??
          randomUUID();
        yield {
          type: EventType.REASONING_START,
          messageId: reasoningMessageId,
        };
        yield {
          type: EventType.REASONING_MESSAGE_START,
          messageId: reasoningMessageId,
          role: "reasoning",
        };
      }
      const delta =
        typeof raw.delta === "string"
          ? raw.delta
          : typeof raw.content === "string" && !wasReasoningRunOpen
            ? raw.content
            : "";
      if (delta) {
        yield {
          type: EventType.REASONING_MESSAGE_CONTENT,
          messageId: reasoningMessageId,
          delta,
        };
      }
    }
    // All other event types (CUSTOM, STEP_FINISHED, etc.) are silently
    // ignored — the runtime does not need them.
  }

  yield* closeReasoningIfOpen();
}

function safeParseJSON(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function createBuiltInAgent(options: CreateBuiltInAgentOptions = {}) {
  const toolProfile = options.toolProfile ?? "default";

  return new BuiltInAgent({
    // Use "custom" to bypass the runtime's convertTanStackStream which
    // has a runFinished flag (PR #4476) that blocks all events after the
    // first RUN_FINISHED. This breaks the multi-turn agent loop needed
    // for server-tool execution (tool-rendering, shared-state).
    type: "custom",
    factory: async ({ input, abortController }) => {
      const { messages, systemPrompts } = convertInputToTanStackAI(input);
      // Subagent tools are built per-run so their nested chat() calls
      // abort with the parent.
      const subagentTools = buildSubagentTools(abortController);
      const statefulServerTools = buildStatefulServerTools(input.state);
      const profileServerTools = buildBaseServerTools({
        searchFlightsMode:
          toolProfile === "beautiful-chat"
            ? "beautiful-chat-a2ui"
            : "generic",
        stockPriceMode:
          toolProfile === "headless-complete" ? "headless-complete" : "generic",
      });

      const serverTools = [
        ...stateTools,
        ...profileServerTools,
        ...statefulServerTools,
        ...subagentTools,
      ];

      // @region[built-in-agent-tool-bridge]
      // Collect server-side tool names so we can skip frontend tools
      // that shadow them (e.g. get_weather has both a server executor
      // and a useRenderTool on the frontend).
      const serverToolNames = new Set<string>(serverTools.map((t) => t.name));

      // Convert AG-UI frontend tools (useHumanInTheLoop, useRenderTool,
      // useFrontendTool) to TanStack definition-only tool declarations.
      // TanStack's chat() treats these as "needs client execution" and
      // pauses the agent loop, allowing the CopilotKit frontend SDK to
      // handle them.
      const frontendTools = createInputToolDefinitions(
        input.tools,
        serverToolNames,
      );
      // @endregion[built-in-agent-tool-bridge]

      const stream = chat({
        // Inject forwardingFetch so the OpenAI client picks up inbound
        // x-* headers (e.g. x-aimock-context) bound into ALS by the
        // route handler. Without this, /v1/responses calls to aimock
        // miss every fixture (404) and the D6 subset goes 0/6.
        adapter: openaiText(BUILT_IN_AGENT_MODEL_FOR_TANSTACK, {
          fetch: forwardingFetch,
        }),
        messages,
        systemPrompts: [...profileSystemPrompts(toolProfile), ...systemPrompts],
        tools: [...serverTools, ...frontendTools],
        agentLoopStrategy: maxIterations(AGENT_LOOP_MAX_ITERATIONS),
        modelOptions: profileModelOptions(toolProfile),
        abortController,
      });

      return convertBuiltInTanStackStream(stream, abortController.signal, {
        serverToolNames,
        initialState: input.state,
      });
    },
  });
}
