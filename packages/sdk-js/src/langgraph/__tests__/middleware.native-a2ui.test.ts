import { describe, expect, it } from "vitest";
import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
} from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import type { getA2UITools } from "@ag-ui/langgraph";
import { createCopilotkitMiddleware } from "../middleware";

const components = [{ id: "root", component: "Text", text: "Sales Dashboard" }];

// A deterministic in-process model drives the actual toolkit; no provider
// requests or SDK/factory mocks are involved in this adapter contract test.
async function generate(properties: object) {
  const prompts: string[] = [];
  const model = {
    bindTools: () => ({
      async *stream(messages: BaseMessage[]) {
        prompts.push(String(messages[0].content));
        yield new AIMessageChunk({
          content: "",
          tool_calls: [
            {
              id: "render",
              name: "render_a2ui",
              args: { surfaceId: "dashboard", components },
            },
          ],
        });
      },
    }),
  };
  const state = {
    messages: [
      new HumanMessage("Dashboard"),
      new AIMessage({
        content: "",
        tool_calls: [{ id: "generate", name: "generate_a2ui", args: {} }],
      }),
    ],
    thread_id: "native-tool-contract",
    ...properties,
  };
  const before = JSON.stringify(state);
  const middleware = createCopilotkitMiddleware();
  let tool: ReturnType<typeof getA2UITools> | undefined;
  await middleware.wrapModelCall(
    { model, state, tools: [], messages: [], runtime: {} },
    async (request) => {
      tool = request.tools.find(
        (candidate: { name: string }) => candidate.name === "generate_a2ui",
      );
      return new AIMessage("ok");
    },
  );
  if (!tool) throw new Error("Expected the native A2UI tool");
  const result = await tool.invoke({ intent: "create" }, { state });
  if (typeof result !== "string")
    throw new Error("Expected a native operations envelope");
  expect(JSON.stringify(state)).toBe(before);
  expect(JSON.parse(result)).toEqual({
    a2ui_operations: [
      {
        version: "v0.9",
        createSurface: {
          surfaceId: "dashboard",
          catalogId: "copilotkit://app-dashboard-catalog",
        },
      },
      {
        version: "v0.9",
        updateComponents: { surfaceId: "dashboard", components },
      },
    ],
  });
  middleware.afterAgent(state);
  return prompts[0];
}

describe("native A2UI tool namespace contract", () => {
  it("uses the merged schema in the real toolkit prompt and CopilotKit catalog in native operations", async () => {
    const prompt = await generate({
      "ag-ui": {
        inject_a2ui_tool: true,
        a2ui_schema: {
          catalogId: "agui://base",
          components: { Base: { description: "RETAINED_NATIVE_SCHEMA" } },
        },
      },
      copilotkit: {
        a2ui_schema: {
          catalogId: "copilotkit://app-dashboard-catalog",
          components: { Text: { description: "COPILOTKIT_SCHEMA" } },
        },
      },
    });
    expect(prompt).toContain("RETAINED_NATIVE_SCHEMA");
    expect(prompt).toContain("COPILOTKIT_SCHEMA");
  });

  it("uses an AG-UI-only serialized context catalog in native operations", async () => {
    const prompt = await generate({
      "ag-ui": {
        inject_a2ui_tool: true,
        context: JSON.stringify([
          {
            description: "A2UI catalog capabilities",
            value: JSON.stringify(
              "Available A2UI catalog:\n- copilotkit://app-dashboard-catalog\n  - Text: {...}",
            ),
          },
        ]),
      },
    });
    expect(prompt).toContain("copilotkit://app-dashboard-catalog");
  });
});
