import { BuiltInAgent, convertInputToTanStackAI } from "@copilotkit/runtime/v2";
import type { TanStackChatMessage } from "@copilotkit/runtime/v2";
import { EventType } from "@ag-ui/client";
import type { BaseEvent } from "@ag-ui/client";
import { chat, toolDefinition } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";
import { z } from "zod";
import { stateTools } from "./state-tools";
import { baseServerTools } from "./server-tools";
import { buildSubagentTools } from "./subagent-tools";
// Custom fetch that injects ALS-bound inbound x-* headers (e.g.
// x-aimock-context) onto every outbound OpenAI call. Required so aimock
// can match fixtures by integration context. See ../header-forwarding.ts
// for the full rationale; mirrors the Mastra precedent.
import { forwardingFetch } from "../header-forwarding";
import { DEMO_AGENT_LOOP_STRATEGY, throwOnRunError } from "./demo-stream";

/**
 * Convert a JSON Schema object to a Zod schema (shallow — handles the
 * common { type: "object", properties: {...} } shape that AG-UI tools
 * produce). Deep/recursive conversion is intentionally omitted: the
 * schema is only used for LLM tool-call declaration, not runtime
 * validation.
 */
// Exported so the OGUI and MCP-Apps factories can declare the tools that
// their runtime middleware injects into `input.tools` (see ogui-factory.ts /
// mcp-apps-factory.ts) without duplicating this conversion.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function jsonSchemaToZod(schema: any): z.ZodTypeAny {
  if (!schema || typeof schema !== "object") return z.object({});
  if (schema.type === "object" && schema.properties) {
    const shape: Record<string, z.ZodTypeAny> = {};
    const required = new Set<string>(schema.required ?? []);
    for (const [key, prop] of Object.entries(schema.properties)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = prop as any;
      let field: z.ZodTypeAny;
      switch (p?.type) {
        case "string":
          field = z.string();
          break;
        case "number":
        case "integer":
          field = z.number();
          break;
        case "boolean":
          field = z.boolean();
          break;
        case "array":
          field = z.array(z.any());
          break;
        default:
          field = z.any();
      }
      if (p?.description) field = field.describe(p.description);
      shape[key] = required.has(key) ? field : field.optional();
    }
    return z.object(shape);
  }
  return z.object({});
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
// Exported for unit tests (tanstack-factory.test.ts) — the state-emission
// branches below are the only place a demo's left-hand panel gets its data, and
// they are easy to break silently.
export async function* convertStream(
  stream: AsyncIterable<unknown>,
  abortSignal: AbortSignal,
): AsyncGenerator<BaseEvent> {
  const messageId = randomUUID();
  // Track tool calls that have already emitted TOOL_CALL_END to suppress
  // duplicate START/ARGS/END from TanStack's buildToolResultChunks.
  // TOOL_CALL_RESULT is always emitted (it only comes from buildToolResultChunks).
  const completedToolCalls = new Set<string>();
  // Map toolCallId → toolName for state-tool detection on TOOL_CALL_RESULT.
  const toolNamesById = new Map<string, string>();
  // Accumulate streamed TOOL_CALL_ARGS per call so TOOL_CALL_RESULT can read
  // the call's `task` back out — the subagents delegation log needs the task
  // text, which only ever appears in the args, never in the result.
  const toolArgsById = new Map<string, string>();
  // Running `delegations` list for the subagents demo. Emitted whole on each
  // append (see the STATE_DELTA below for why it is not an RFC-6902 append).
  const delegations: Delegation[] = [];

  for await (const chunk of stream) {
    if (abortSignal.aborted) break;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = chunk as any;
    const type = raw.type as string;

    // Fail loud on an upstream rejection — see ./demo-stream.
    throwOnRunError(raw);

    // Skip RUN_FINISHED from TanStack's adapter — the Agent class emits
    // its own lifecycle events.
    if (type === "RUN_FINISHED") continue;

    if (type === "TEXT_MESSAGE_CONTENT" && raw.delta != null) {
      yield {
        type: EventType.TEXT_MESSAGE_CHUNK,
        role: "assistant",
        messageId,
        delta: raw.delta as string,
      };
    } else if (type === "TOOL_CALL_START") {
      const toolCallId = raw.toolCallId as string;
      if (completedToolCalls.has(toolCallId)) {
        // Duplicate from buildToolResultChunks — skip.
        continue;
      }
      toolNamesById.set(toolCallId, raw.toolCallName as string);
      yield {
        type: EventType.TOOL_CALL_START,
        parentMessageId: messageId,
        toolCallId,
        toolCallName: raw.toolCallName as string,
      };
    } else if (type === "TOOL_CALL_ARGS") {
      const toolCallId = raw.toolCallId as string;
      if (completedToolCalls.has(toolCallId)) continue;
      toolArgsById.set(
        toolCallId,
        (toolArgsById.get(toolCallId) ?? "") + ((raw.delta as string) ?? ""),
      );
      yield {
        type: EventType.TOOL_CALL_ARGS,
        toolCallId,
        delta: raw.delta as string,
      };
    } else if (type === "TOOL_CALL_END") {
      const toolCallId = raw.toolCallId as string;
      if (completedToolCalls.has(toolCallId)) continue;
      completedToolCalls.add(toolCallId);
      yield {
        type: EventType.TOOL_CALL_END,
        toolCallId,
      };
    } else if (type === "TOOL_CALL_RESULT") {
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
        yield {
          type: EventType.STATE_SNAPSHOT,
          snapshot: (parsedContent as { snapshot: unknown }).snapshot,
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
      // translate that into a STATE_DELTA that adds `/steps` on the
      // agent state, so the frontend `useAgent` subscriber sees the
      // plan update and `StepsPanel` mounts `agent-state-card`.
      //
      // Use RFC-6902 `add` (not `replace`): the agent's initial state is
      // `{}` (no STATE_SNAPSHOT precedes the first STATE_DELTA), and
      // `fast-json-patch` in strict mode rejects `replace` on an
      // unresolvable path with OPERATION_PATH_UNRESOLVABLE.
      // `@ag-ui/client@0.0.57` swallows that throw with `console.warn`
      // and never updates state, so `replace` results in the panel
      // staying in its placeholder. `add` creates `/steps` on first
      // emission and idempotently overwrites on subsequent calls.
      if (
        toolName === "set_steps" &&
        parsedContent &&
        typeof parsedContent === "object" &&
        "steps" in parsedContent
      ) {
        yield {
          type: EventType.STATE_DELTA,
          delta: [
            {
              op: "add",
              path: "/steps",
              value: (parsedContent as { steps: unknown }).steps,
            },
          ],
        };
      }
      // `set_notes` is the shared-state-read-write demo's agent-authored
      // notes tool (see server-tools.ts). Its server handler returns
      // `{ notes }`; translate that into a STATE_DELTA that adds `/notes`
      // on the agent state, so the frontend `useAgent` subscriber sees the
      // update and the notes card (`notes-list` / `note-item`) populates.
      //
      // Same RFC-6902 `add`-not-`replace` rationale as `set_steps` above:
      // the agent's initial state carries no `/notes` snapshot before the
      // first delta, and `fast-json-patch` strict mode rejects `replace` on
      // an unresolvable path (OPERATION_PATH_UNRESOLVABLE), which
      // `@ag-ui/client` swallows with a console.warn and never applies —
      // leaving the panel in its placeholder. `add` creates `/notes` on the
      // first emission and idempotently overwrites on subsequent calls.
      if (
        toolName === "set_notes" &&
        parsedContent &&
        typeof parsedContent === "object" &&
        "notes" in parsedContent
      ) {
        yield {
          type: EventType.STATE_DELTA,
          delta: [
            {
              op: "add",
              path: "/notes",
              value: (parsedContent as { notes: unknown }).notes,
            },
          ],
        };
      }

      // Sub-agent delegation results (subagents demo). `buildSubagentTools`
      // exposes `research_agent` / `writing_agent` / `critique_agent`, each
      // returning `{ role, text }`. The frontend
      // (`demos/subagents/page.tsx`) renders `agent.state.delegations` in the
      // left-hand log — but nothing here used to emit that slot, so the tools
      // ran, the chat filled in, and the panel stayed empty forever. The
      // reference declares `delegations` on its agent state with an
      // `operator.add` reducer (`langgraph-python/src/agents/subagents.py`);
      // this is the equivalent for a runtime with no per-agent state schema.
      //
      // Emitted as a whole-array `add` rather than an RFC-6902 `/-` append for
      // the same reason `set_steps` below uses `add`: the agent's initial
      // state is `{}`, so an append into a not-yet-existent `/delegations`
      // array is an unresolvable path. `fast-json-patch` strict mode rejects
      // it and `@ag-ui/client` swallows the throw with a console.warn, which
      // would leave the panel in its placeholder — exactly the bug being
      // fixed. `add` creates the array on the first result and overwrites it
      // with the grown list on each subsequent one.
      if (toolName && SUBAGENT_TOOL_NAMES.has(toolName)) {
        delegations.push({
          id: toolCallId,
          sub_agent: toolName,
          task: extractTask(toolArgsById.get(toolCallId)),
          status: "completed",
          result: extractResultText(parsedContent),
        });
        yield {
          type: EventType.STATE_DELTA,
          delta: [{ op: "add", path: "/delegations", value: [...delegations] }],
        };
      }

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
    }
    // All other event types (CUSTOM, STEP_FINISHED, etc.) are silently
    // ignored — the runtime does not need them.
  }
}

function safeParseJSON(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Delegation-log entry shape. Mirrors `Delegation` in
 * `demos/subagents/delegation-log.tsx` (and the reference's `Delegation`
 * TypedDict) — the frontend reads `sub_agent`, `task`, `status`, `result`.
 */
type Delegation = {
  id: string;
  sub_agent: string;
  task: string;
  status: "completed";
  result: string;
};

/** Tool names `buildSubagentTools` exposes; kept in sync with `subagentRoles`. */
const SUBAGENT_TOOL_NAMES = new Set([
  "research_agent",
  "writing_agent",
  "critique_agent",
]);

/**
 * Pull `task` out of the accumulated TOOL_CALL_ARGS JSON. Args stream in as
 * deltas and a run can be cut short mid-call, so a partial/unparseable buffer
 * is expected rather than exceptional — fall back to an empty task and let the
 * log render the entry without it.
 */
function extractTask(argsJson: string | undefined): string {
  if (!argsJson) return "";
  const parsed = safeParseJSON(argsJson);
  if (parsed && typeof parsed === "object" && "task" in parsed) {
    const task = (parsed as { task: unknown }).task;
    if (typeof task === "string") return task;
  }
  return "";
}

/** Read the sub-agent's prose out of its `{ role, text }` result. */
function extractResultText(parsedContent: unknown): string {
  if (parsedContent && typeof parsedContent === "object") {
    const text = (parsedContent as { text?: unknown }).text;
    if (typeof text === "string") return text;
  }
  return typeof parsedContent === "string" ? parsedContent : "";
}

/**
 * Options for {@link createBuiltInAgent}. All fields are OPT-IN — omitting them
 * (the default for every demo except multimodal) preserves the base agent's
 * behaviour byte-for-byte.
 */
export interface BuiltInAgentOptions {
  /**
   * Async hook to rewrite the converted TanStack messages before they reach
   * the model. Used by the multimodal factory to flatten PDF `document`
   * content parts to text server-side (the OpenAI text adapter cannot consume
   * `document` parts and drops the turn otherwise). Left undefined by default.
   */
  preprocessMessages?: (
    messages: TanStackChatMessage[],
  ) => TanStackChatMessage[] | Promise<TanStackChatMessage[]>;
  /**
   * Per-demo system prompt, prepended ahead of the frontend-supplied
   * `systemPrompts`.
   *
   * The north-star reference wires each demo to its own graph with its own
   * prompt (28 graphs in `langgraph-python/langgraph.json`). This integration
   * shares ONE agent across ~20 demos, so without this option a demo whose
   * behaviour depends on being *told* what to do has nothing driving it. The
   * aimock fixtures hide that — they replay a scripted tool-call sequence
   * keyed on `userMessage` + `context`, so D6 goes green whether or not the
   * model could have reasoned its way there (showcase/GOTCHAS.md #8).
   *
   * Live symptoms this exists to prevent: `gen-ui-tool-based` answering
   * "I used placeholder values since no sales figures were provided" and
   * plotting zeros; `gen-ui-agent` publishing its plan once and then
   * narrating instead of walking the steps.
   */
  systemPrompt?: string;
}

export function createBuiltInAgent(options: BuiltInAgentOptions = {}) {
  return new BuiltInAgent({
    // Use "custom" to bypass the runtime's convertTanStackStream which
    // has a runFinished flag (PR #4476) that blocks all events after the
    // first RUN_FINISHED. This breaks the multi-turn agent loop needed
    // for server-tool execution (tool-rendering, shared-state).
    type: "custom",
    factory: async ({ input, abortController }) => {
      const { messages: convertedMessages, systemPrompts } =
        convertInputToTanStackAI(input);
      // Opt-in message rewrite (multimodal PDF flatten). Default: pass-through.
      const messages = options.preprocessMessages
        ? await options.preprocessMessages(convertedMessages)
        : convertedMessages;
      // Subagent tools are built per-run so their nested chat() calls
      // abort with the parent.
      const subagentTools = buildSubagentTools(abortController);

      const serverTools = [...stateTools, ...baseServerTools, ...subagentTools];

      // Collect server-side tool names so we can skip frontend tools
      // that shadow them (e.g. get_weather has both a server executor
      // and a useRenderTool on the frontend).
      const serverToolNames = new Set(serverTools.map((t) => t.name));

      // Convert AG-UI frontend tools (useHumanInTheLoop, useRenderTool,
      // useFrontendTool) to TanStack definition-only tool declarations.
      // TanStack's chat() treats these as "needs client execution" and
      // pauses the agent loop, allowing the CopilotKit frontend SDK to
      // handle them.
      const frontendTools = (input.tools ?? [])
        .filter((t) => !serverToolNames.has(t.name))
        .map((t) =>
          toolDefinition({
            name: t.name,
            description: t.description ?? "",
            inputSchema: jsonSchemaToZod(t.parameters),
          }),
        );

      const stream = chat({
        // Inject forwardingFetch so the OpenAI client picks up inbound
        // x-* headers (e.g. x-aimock-context) bound into ALS by the
        // route handler. Without this, /v1/responses calls to aimock
        // miss every fixture (404) and the D6 subset goes 0/6.
        adapter: openaiText("gpt-5.4", { fetch: forwardingFetch }),
        messages,
        systemPrompts: options.systemPrompt
          ? [options.systemPrompt, ...systemPrompts]
          : systemPrompts,
        tools: [...serverTools, ...frontendTools],
        abortController,
        agentLoopStrategy: DEMO_AGENT_LOOP_STRATEGY,
      });

      return convertStream(stream, abortController.signal);
    },
  });
}
