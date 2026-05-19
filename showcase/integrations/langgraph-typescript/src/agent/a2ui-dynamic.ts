/**
 * LangGraph TypeScript agent for the Declarative Generative UI (A2UI — Dynamic Schema) demo.
 *
 * Ported from `src/agents/a2ui_dynamic.py`.
 *
 * Pattern:
 * - The agent binds an explicit `generate_a2ui` tool. When called, `generate_a2ui`
 *   invokes a secondary LLM bound to `_design_a2ui_surface` (tool_choice forced)
 *   using the registered client catalog injected as `copilotkit.context`.
 *   The internal tool is intentionally NOT named `render_a2ui` because the A2UI
 *   middleware default-intercepts tool calls by that name from the run's event
 *   stream and synthesises ACTIVITY_SNAPSHOT events from the LLM's RAW streaming
 *   args (catalogId + components, before our code can validate). That bypass
 *   surfaces "Cannot create component root without a type" infinite-loops.
 *   Renaming sidesteps the middleware's intercept list (`a2uiToolNames`).
 * - The tool result returns an `a2ui_operations` container which the A2UI
 *   middleware detects in the tool-call result and forwards to the frontend
 *   renderer.
 * - The runtime (see `src/app/api/copilotkit-declarative-gen-ui/route.ts`) uses
 *   `injectA2UITool: false` because the tool binding is owned by the agent here.
 *
 * State access for `generate_a2ui`:
 * The tool needs `state.messages` and `state.copilotkit.context` to forward
 * conversation history and the A2UI catalog schema to the secondary LLM. The
 * built-in `ToolNode` does not thread graph state through to tool execution
 * config. In Python, `ToolRuntime` provides this automatically. In TypeScript
 * we solve it with a state-aware wrapper node that snapshots state into a
 * module-level variable before delegating to `ToolNode`. This preserves
 * the standard LangChain tool invocation path (critical for `OnToolEnd`
 * events that the AG-UI adapter converts to `TOOL_CALL_RESULT` — which the
 * A2UI middleware needs to detect `a2ui_operations` in the tool result).
 */

import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { AIMessage, SystemMessage } from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import {
  MemorySaver,
  START,
  StateGraph,
  Annotation,
} from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import {
  convertActionsToDynamicStructuredTools,
  CopilotKitStateAnnotation,
} from "@copilotkit/sdk-js/langgraph";

const CUSTOM_CATALOG_ID = "declarative-gen-ui-catalog";
const A2UI_OPERATIONS_KEY = "a2ui_operations";
const BASIC_CATALOG_ID =
  "https://a2ui.org/specification/v0_9/basic_catalog.json";

const SYSTEM_PROMPT =
  "You are a demo assistant for Declarative Generative UI (A2UI — Dynamic " +
  "Schema). Whenever a response would benefit from a rich visual — a " +
  "dashboard, status report, KPI summary, card layout, info grid, a " +
  "pie/donut chart of part-of-whole breakdowns, a bar chart comparing " +
  "values across categories, or anything more structured than plain text — " +
  "call `generate_a2ui` to draw it. The registered catalog includes " +
  "`Card`, `StatusBadge`, `Metric`, `InfoRow`, `PrimaryButton`, `PieChart`, " +
  "and `BarChart` (in addition to the basic A2UI primitives). Prefer " +
  "`PieChart` for part-of-whole breakdowns (sales by region, traffic " +
  "sources, portfolio allocation) and `BarChart` for comparisons across " +
  "categories (quarterly revenue, headcount by team, signups per month). " +
  "`generate_a2ui` takes no arguments and handles the rendering " +
  "automatically. Keep chat replies to one short sentence; let the UI do " +
  "the talking.";

// Matches Python's _GENERATE_A2UI_PROMPT_HEADER — instructs the secondary LLM
// on flat component array format, required fields, and catalog constraints.
const GENERATE_A2UI_PROMPT_HEADER =
  `You are designing a dynamic A2UI v0.9 surface. Call the \`_design_a2ui_surface\`\n` +
  `tool with a flat component array.\n\n` +
  `Hard requirements (failing any of these breaks the renderer — be strict):\n` +
  `- \`catalogId\` MUST be exactly: "${CUSTOM_CATALOG_ID}"\n` +
  `- \`surfaceId\` is a short kebab-case identifier (e.g. "kpi-dashboard").\n` +
  `- \`components\` is a FLAT array. Every entry MUST include both an \`id\` (unique\n` +
  `  string) AND a \`component\` (string — the catalog component name). The root\n` +
  `  entry MUST have \`id: "root"\` AND a valid \`component\` field — never emit\n` +
  `  a root entry without a component type.\n` +
  `- Container components (Row, Column, Card) reference children by id via their\n` +
  `  \`children\` (array of strings) or \`child\` (single string) prop. Do NOT inline\n` +
  `  children objects. Define each child as its own entry in the flat array and\n` +
  `  reference its id.\n` +
  `- Use only catalog component names listed in the schema below.`;

/**
 * Drop component entries that aren't objects or are missing `id`/`component`.
 * Mirrors Python's `sanitize_a2ui_components`.
 */
function sanitizeA2uiComponents(
  raw: unknown[],
): Array<Record<string, unknown>> {
  return (raw ?? []).filter(
    (c): c is Record<string, unknown> =>
      typeof c === "object" &&
      c !== null &&
      typeof (c as Record<string, unknown>).id === "string" &&
      (c as Record<string, unknown>).id !== "" &&
      typeof (c as Record<string, unknown>).component === "string" &&
      (c as Record<string, unknown>).component !== "",
  ) as Array<Record<string, unknown>>;
}

/** True iff `components` contains an entry with `id === "root"`. */
function hasRootComponent(components: Array<Record<string, unknown>>): boolean {
  return components.some((c) => c.id === "root");
}

const AgentStateAnnotation = Annotation.Root({
  ...CopilotKitStateAnnotation.spec,
});

export type AgentState = typeof AgentStateAnnotation.State;

function createSurfaceOp(
  surfaceId: string,
  catalogId: string = BASIC_CATALOG_ID,
) {
  return {
    version: "v0.9",
    createSurface: { surfaceId, catalogId },
  };
}

function updateComponentsOp(surfaceId: string, components: unknown[]) {
  return {
    version: "v0.9",
    updateComponents: { surfaceId, components },
  };
}

function updateDataModelOp(
  surfaceId: string,
  data: unknown,
  path: string = "/",
) {
  return {
    version: "v0.9",
    updateDataModel: { surfaceId, path, value: data },
  };
}

function renderA2uiOperations(operations: unknown[]): string {
  return JSON.stringify({ [A2UI_OPERATIONS_KEY]: operations });
}

// ---------------------------------------------------------------------------
// State snapshot for tool access
// ---------------------------------------------------------------------------
// The built-in ToolNode does not forward graph state through config to tools.
// Python's ToolRuntime provides `runtime.state` automatically; in TypeScript
// we snapshot the state into a module-level variable before ToolNode runs.
// This is safe because LangGraph TS runs graph nodes sequentially within a
// single thread — no concurrent writes to this variable for the same run.
let _currentState: AgentState | null = null;

/**
 * `generate_a2ui` — real LangChain tool invoked by ToolNode.
 *
 * Reads state from the module-level `_currentState` snapshot (set by the
 * `stateAwareToolNode` wrapper before ToolNode executes). Returns an
 * `a2ui_operations` JSON string that the A2UI middleware detects in the
 * `TOOL_CALL_RESULT` AG-UI event (emitted via the standard OnToolEnd path).
 */
const generateA2uiTool = tool(
  async () => {
    const state = _currentState;
    if (!state) {
      return JSON.stringify({ error: "No state available for generate_a2ui" });
    }

    const messages = state.messages ?? [];
    const copilotkit = state.copilotkit ?? {};
    const contextEntries = ((copilotkit as Record<string, unknown>).context ??
      []) as Array<Record<string, unknown>>;

    const contextText = contextEntries
      .map((entry) =>
        entry && typeof entry === "object" && typeof entry.value === "string"
          ? (entry.value as string)
          : "",
      )
      .filter(Boolean)
      .join("\n\n");

    // Internal tool intentionally named `_design_a2ui_surface` (NOT
    // `render_a2ui`) to avoid the A2UI middleware's default tool-call
    // intercept. See module docstring.
    const designTool = tool(async () => "designed", {
      name: "_design_a2ui_surface",
      description: "Design a dynamic A2UI v0.9 surface.",
      schema: z.object({
        surfaceId: z.string().describe("Unique surface identifier."),
        catalogId: z
          .string()
          .describe(`The catalog ID (use "${CUSTOM_CATALOG_ID}").`),
        components: z
          .array(z.record(z.unknown()))
          .describe(
            "A2UI v0.9 component array (flat format). Every entry MUST have `id` and `component`.",
          ),
        data: z
          .record(z.unknown())
          .optional()
          .describe("Optional initial data model for the surface."),
      }),
    });

    const model = new ChatOpenAI({ temperature: 0, model: "gpt-4.1" });
    const modelWithTool = model.bindTools!([designTool], {
      tool_choice: {
        type: "function",
        function: { name: "_design_a2ui_surface" },
      },
    });

    // Prepend the explicit instruction header (matching Python's
    // _GENERATE_A2UI_PROMPT_HEADER) so the LLM knows about flat-array
    // constraints, required fields, and the canonical catalog ID.
    const prompt = `${GENERATE_A2UI_PROMPT_HEADER}\n\n${contextText}`.trim();

    // Drop the last message (the tool-call trigger itself) to mirror
    // Python's `runtime.state["messages"][:-1]`.
    const rawPrior = (messages as unknown[]).slice(0, -1) as Array<{
      _getType?: () => string;
      type?: string;
      content?: unknown;
      tool_calls?: unknown[];
      additional_kwargs?: Record<string, unknown>;
    }>;

    // Filter out ToolMessages and AIMessages that are pure tool_call
    // containers (no text content). The secondary LLM only needs
    // conversational context (human messages + AI text responses);
    // sending the graph's internal tool_call/tool_result pairs causes
    // OpenAI to reject with "tool_calls must be followed by tool
    // messages responding to each tool_call_id".
    const priorMessages = rawPrior.filter((msg) => {
      const msgType =
        typeof msg._getType === "function" ? msg._getType() : msg.type;
      if (msgType === "tool") return false;
      if (msgType === "ai") {
        const hasToolCalls = (msg.tool_calls as unknown[] | undefined)?.length
          ? (msg.tool_calls as unknown[]).length > 0
          : false;
        const addlToolCalls = msg.additional_kwargs?.tool_calls as
          | unknown[]
          | undefined;
        const hasAddlToolCalls = addlToolCalls
          ? addlToolCalls.length > 0
          : false;
        const hasContent =
          typeof msg.content === "string" &&
          (msg.content as string).trim().length > 0;
        if ((hasToolCalls || hasAddlToolCalls) && !hasContent) return false;
      }
      return true;
    });

    let response: AIMessage;
    try {
      response = (await modelWithTool.invoke([
        new SystemMessage({ content: prompt }),
        ...priorMessages,
      ])) as AIMessage;
    } catch (err) {
      console.error("[a2ui-dynamic] Secondary LLM failed:", err);
      return JSON.stringify({ error: `Secondary LLM failed: ${err}` });
    }

    if (!response.tool_calls?.length) {
      return JSON.stringify({
        error: "LLM did not call _design_a2ui_surface",
      });
    }

    const args = (response.tool_calls[0].args ?? {}) as Record<string, unknown>;
    const surfaceId = (args.surfaceId as string) ?? "dynamic-surface";
    // Force the canonical catalog ID — the secondary LLM has been observed
    // hallucinating IDs from sibling demos when context is sparse.
    const catalogId = CUSTOM_CATALOG_ID;
    const components = sanitizeA2uiComponents(
      (args.components as unknown[]) ?? [],
    );
    const data = (args.data as Record<string, unknown>) ?? {};

    if (!hasRootComponent(components)) {
      return JSON.stringify({
        error: "LLM produced no valid root component for the A2UI surface.",
      });
    }

    const ops: unknown[] = [
      createSurfaceOp(surfaceId, catalogId),
      updateComponentsOp(surfaceId, components),
    ];
    if (data && Object.keys(data).length > 0) {
      ops.push(updateDataModelOp(surfaceId, data));
    }

    return renderA2uiOperations(ops);
  },
  {
    name: "generate_a2ui",
    description:
      "Generate dynamic A2UI components based on the conversation. " +
      "A secondary LLM designs the UI schema and data. The result is " +
      "returned as an a2ui_operations container for the A2UI middleware " +
      "to detect and forward to the frontend renderer.",
    schema: z.object({}),
  },
);

const tools = [generateA2uiTool];

// Standard ToolNode — invokes tools via the LangChain runtime so that
// `OnToolEnd` events fire and the AG-UI adapter emits `TOOL_CALL_RESULT`.
const _toolNode = new ToolNode(tools);

async function chatNode(state: AgentState) {
  const model = new ChatOpenAI({ temperature: 0, model: "gpt-4.1" });

  const modelWithTools = model.bindTools!([
    ...convertActionsToDynamicStructuredTools(state.copilotkit?.actions ?? []),
    ...tools,
  ]);

  const systemMessage = new SystemMessage({ content: SYSTEM_PROMPT });

  const response = await modelWithTools.invoke([
    systemMessage,
    ...state.messages,
  ]);

  return { messages: response };
}

/**
 * State-aware tool node wrapper.
 *
 * Snapshots the current graph state into the module-level `_currentState`
 * variable, then delegates to the real `ToolNode`. This gives
 * `generateA2uiTool` access to `state.messages` and
 * `state.copilotkit.context` while preserving the standard LangChain tool
 * invocation path (OnToolEnd events -> TOOL_CALL_RESULT AG-UI events ->
 * A2UI middleware detection).
 */
async function stateAwareToolNode(
  state: AgentState,
  config: Record<string, unknown>,
) {
  _currentState = state;
  try {
    return await _toolNode.invoke(state, config);
  } finally {
    _currentState = null;
  }
}

function shouldContinue({ messages, copilotkit }: AgentState) {
  const lastMessage = messages[messages.length - 1] as AIMessage;

  if (lastMessage.tool_calls?.length) {
    const actions = copilotkit?.actions;
    const toolCallName = lastMessage.tool_calls![0].name;

    if (!actions || actions.every((action) => action.name !== toolCallName)) {
      return "tool_node";
    }
  }

  return "__end__";
}

const workflow = new StateGraph(AgentStateAnnotation)
  .addNode("chat_node", chatNode)
  .addNode("tool_node", stateAwareToolNode as unknown as typeof chatNode)
  .addEdge(START, "chat_node")
  .addEdge("tool_node", "chat_node")
  .addConditionalEdges(
    "chat_node",
    shouldContinue as unknown as (state: AgentState) => string,
  );

const memory = new MemorySaver();

export const graph = workflow.compile({
  checkpointer: memory,
});
