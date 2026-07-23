import { z } from "zod";
import { tool, type ToolRuntime } from "@langchain/core/tools";
import { SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import {
  createSurface,
  render,
  updateComponents,
  updateDataModel,
} from "./a2ui.js";

const CUSTOM_CATALOG_ID = "copilotkit://app-dashboard-catalog";

const renderA2uiSchema = z.object({
  surfaceId: z.string(),
  catalogId: z.string(),
  components: z.array(z.record(z.any())),
  data: z.record(z.any()).optional(),
});

const renderA2ui = tool(async () => "rendered", {
  name: "render_a2ui",
  description:
    "Render a dynamic A2UI v0.9 surface. components must be a flat array whose root id is 'root'.",
  schema: renderA2uiSchema,
});

const DynamicStateSchema = z.object({
  messages: z.array(z.any()).default(() => []),
  copilotkit: z
    .object({
      context: z
        .array(z.object({ value: z.string().optional() }).passthrough())
        .optional(),
    })
    .passthrough()
    .optional(),
});

export const generate_a2ui = tool(
  async (
    _input: Record<string, never>,
    runtime: ToolRuntime<typeof DynamicStateSchema>,
  ) => {
    const messages = (runtime.state.messages ?? []).slice(0, -1);
    const contextEntries = runtime.state.copilotkit?.context ?? [];
    const contextText = contextEntries
      .map((e) => (e && typeof e === "object" ? (e.value ?? "") : ""))
      .filter(Boolean)
      .join("\n\n");

    const model = new ChatOpenAI({ model: "gpt-4.1" });
    const modelWithTool = model.bindTools!([renderA2ui], {
      tool_choice: "render_a2ui",
    });

    const response = await modelWithTool.invoke([
      new SystemMessage({ content: contextText }),
      ...(messages as never[]),
    ]);

    const toolCalls = (
      response as { tool_calls?: Array<{ args: Record<string, unknown> }> }
    ).tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      return JSON.stringify({ error: "LLM did not call render_a2ui" });
    }

    const args = toolCalls[0].args as {
      surfaceId?: string;
      catalogId?: string;
      components?: unknown[];
      data?: Record<string, unknown>;
    };

    const surfaceId = args.surfaceId ?? "dynamic-surface";
    const catalogId = args.catalogId ?? CUSTOM_CATALOG_ID;
    const components = args.components ?? [];
    const data = args.data ?? {};

    const ops = [
      createSurface(surfaceId, catalogId),
      updateComponents(surfaceId, components),
    ];
    if (Object.keys(data).length > 0) {
      ops.push(updateDataModel(surfaceId, data));
    }
    return render(ops);
  },
  {
    name: "generate_a2ui",
    description:
      "Generate dynamic A2UI components based on the conversation. " +
      "A secondary LLM designs the UI schema and data.",
    schema: z.object({}),
  },
);
