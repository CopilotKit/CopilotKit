/**
 * LangGraph TypeScript agent for the Declarative Generative UI (A2UI — Dynamic Schema) demo.
 *
 * Ported from `src/agents/a2ui_dynamic.py`.
 *
 * Pattern:
 * - The agent binds an explicit `generate_a2ui` tool. When called, `generate_a2ui`
 *   invokes a secondary LLM bound to `render_a2ui` (tool_choice forced) using the
 *   registered client catalog injected as `copilotkit.context`.
 * - The tool result returns an `a2ui_operations` container which the A2UI
 *   middleware detects in the tool-call result and forwards to the frontend
 *   renderer.
 * - The runtime (see `src/app/api/copilotkit-declarative-gen-ui/route.ts`) uses
 *   `injectA2UITool: false` because the tool binding is owned by the agent here.
 */

import { z } from "zod";
import { RunnableConfig } from "@langchain/core/runnables";
import { tool } from "@langchain/core/tools";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { AIMessage, SystemMessage } from "@langchain/core/messages";
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

const generateA2ui = tool(
  async (_args, config?: RunnableConfig) => {
    // The runtime provided by the A2UI middleware injects a `copilotkit.context`
    // containing the registered client catalog schema + usage guidelines.
    const configurable = (config?.configurable ?? {}) as Record<
      string,
      unknown
    >;
    const state = (configurable.state ?? {}) as Record<string, unknown>;
    const messages = (state.messages ?? []) as unknown[];
    const copilotkit = (state.copilotkit ?? {}) as Record<string, unknown>;
    const contextEntries = (copilotkit.context ?? []) as Array<
      Record<string, unknown>
    >;

    const contextText = contextEntries
      .map((entry) =>
        entry && typeof entry === "object" && typeof entry.value === "string"
          ? (entry.value as string)
          : "",
      )
      .filter(Boolean)
      .join("\n\n");

    const renderTool = tool(async () => "rendered", {
      name: "render_a2ui",
      description: "Render a dynamic A2UI v0.9 surface.",
      schema: z.object({
        surfaceId: z.string().describe("Unique surface identifier."),
        catalogId: z
          .string()
          .describe(`The catalog ID (use "${CUSTOM_CATALOG_ID}").`),
        components: z
          .array(z.record(z.unknown()))
          .describe("A2UI v0.9 component array."),
        data: z
          .record(z.unknown())
          .optional()
          .describe("Optional initial data model for the surface."),
      }),
    });

    const model = new ChatOpenAI({ temperature: 0, model: "gpt-4.1" });
    const modelWithTool = model.bindTools!([renderTool], {
      tool_choice: { type: "function", function: { name: "render_a2ui" } },
    });

    // Drop the last message (the tool-call trigger itself) to mirror Python's
    // `runtime.state["messages"][:-1]`.
    const priorMessages = messages.slice(0, -1) as any[];

    const response = (await modelWithTool.invoke([
      new SystemMessage({ content: contextText }),
      ...priorMessages,
    ])) as AIMessage;

    if (!response.tool_calls?.length) {
      return JSON.stringify({ error: "LLM did not call render_a2ui" });
    }

    const args = (response.tool_calls[0].args ?? {}) as Record<string, unknown>;
    const surfaceId = (args.surfaceId as string) ?? "dynamic-surface";
    const catalogId = (args.catalogId as string) ?? CUSTOM_CATALOG_ID;
    const components = (args.components as unknown[]) ?? [];
    const data = (args.data as Record<string, unknown>) ?? {};

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
      "Generate dynamic A2UI components based on the conversation. A secondary LLM designs the UI schema and data. The result is returned as an a2ui_operations container for the A2UI middleware to detect and forward to the frontend renderer.",
    schema: z.object({}),
  },
);

const tools = [generateA2ui];

async function chatNode(state: AgentState, config: RunnableConfig) {
  const model = new ChatOpenAI({ temperature: 0, model: "gpt-4.1" });

  const modelWithTools = model.bindTools!([
    ...convertActionsToDynamicStructuredTools(state.copilotkit?.actions ?? []),
    ...tools,
  ]);

  const systemMessage = new SystemMessage({ content: SYSTEM_PROMPT });

  // Forward the full state into the tool execution context via `configurable`
  // so `generate_a2ui` can access messages + copilotkit.context.
  const augmentedConfig: RunnableConfig = {
    ...config,
    configurable: {
      ...(config.configurable ?? {}),
      state,
    },
  };

  const response = await modelWithTools.invoke(
    [systemMessage, ...state.messages],
    augmentedConfig,
  );

  return { messages: response };
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
  .addNode("tool_node", new ToolNode(tools))
  .addEdge(START, "chat_node")
  .addEdge("tool_node", "chat_node")
  .addConditionalEdges("chat_node", shouldContinue as any);

const memory = new MemorySaver();

export const graph = workflow.compile({
  checkpointer: memory,
});
