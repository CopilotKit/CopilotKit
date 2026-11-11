import { A2UI_SCHEMA_CONTEXT_DESCRIPTION } from "@ag-ui/a2ui-toolkit";
import { tool } from "ai";
import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  SALES_CATALOG_ID,
  SALES_GUIDELINES,
  displayFlightTool,
  generateA2uiTool,
  subagentMessages,
  withoutRenderTool,
} from "./a2ui";
import {
  scriptedModel,
  systemPromptOf,
  toolOptions,
} from "./test-support/mock-model";
import type { ScriptedReply } from "./test-support/mock-model";

const VALID_SURFACE = {
  surfaceId: "sales",
  components: [
    { id: "root", component: "Column", children: ["m1"] },
    { id: "m1", component: "Metric", label: "Revenue", value: "$4.2M" },
  ],
};
const DANGLING_SURFACE = {
  surfaceId: "sales",
  components: [{ id: "root", component: "Column", children: ["missing"] }],
};

const RENDER_GUIDE =
  "A2UI render tool usage guide — how to call render_a2ui with valid arguments.";

const conversation: ModelMessage[] = [
  { role: "user", content: "Show me my sales dashboard for this quarter." },
];

function generate(replies: ScriptedReply[]) {
  const model = scriptedModel(replies);
  const generateA2ui = generateA2uiTool({
    model: () => model,
    defaultCatalogId: SALES_CATALOG_ID,
    guidelines: SALES_GUIDELINES,
    context: [
      {
        description: A2UI_SCHEMA_CONTEXT_DESCRIPTION,
        value: JSON.stringify({ catalogId: SALES_CATALOG_ID, components: [] }),
      },
      { description: RENDER_GUIDE, value: "Call render_a2ui with components." },
    ],
    messages: [],
    state: {},
  });
  const run = () =>
    generateA2ui.execute!({}, toolOptions("call-outer", conversation));
  return { model, run };
}

describe("withoutRenderTool", () => {
  it("drops only the middleware's render_a2ui", () => {
    const clientTool = tool({ inputSchema: z.object({}) });
    const kept = withoutRenderTool({
      render_a2ui: clientTool,
      change_background: clientTool,
    });
    expect(Object.keys(kept)).toEqual(["change_background"]);
  });
});

describe("subagentMessages", () => {
  it("keeps the user and assistant text, nothing else", () => {
    expect(
      subagentMessages([
        { role: "system", content: "rules" },
        { role: "user", content: [{ type: "text", text: "Hi" }] },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Hello" },
            { type: "tool-call", toolCallId: "c", toolName: "x", input: {} },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "c",
              toolName: "x",
              output: { type: "text", value: "done" },
            },
          ],
        },
      ]),
    ).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello" },
    ]);
  });
});

describe("generateA2uiTool", () => {
  it("forces one render_a2ui call and stamps the page's catalog on the surface", async () => {
    const { model, run } = generate([
      { toolCall: { name: "render_a2ui", input: VALID_SURFACE } },
    ]);
    const result = (await run()) as {
      a2ui_operations: Array<Record<string, unknown>>;
    };

    expect(result.a2ui_operations[0]).toEqual({
      version: "v0.9",
      createSurface: { surfaceId: "sales", catalogId: SALES_CATALOG_ID },
    });
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(model.doGenerateCalls[0]!.toolChoice).toEqual({
      type: "tool",
      toolName: "render_a2ui",
    });
    const system = systemPromptOf(model);
    expect(system).toContain("Vantage Threads");
    // The middleware's render-tool guide is for the outer model; the sub-agent
    // does not see it.
    expect(system).not.toContain("Call render_a2ui with components.");
  });

  it("retries an invalid surface and returns the healed one", async () => {
    const { model, run } = generate([
      { toolCall: { name: "render_a2ui", input: DANGLING_SURFACE } },
      { toolCall: { name: "render_a2ui", input: VALID_SURFACE } },
    ]);
    const result = (await run()) as Record<string, unknown>;
    expect(result).toHaveProperty("a2ui_operations");
    expect(model.doGenerateCalls).toHaveLength(2);
  });

  it("returns the recovery-exhausted envelope when every attempt is invalid", async () => {
    const { model, run } = generate([
      { toolCall: { name: "render_a2ui", input: DANGLING_SURFACE } },
    ]);
    const result = (await run()) as Record<string, unknown>;
    expect(result).toMatchObject({ code: "a2ui_recovery_exhausted" });
    expect(model.doGenerateCalls).toHaveLength(3);
  });
});

describe("displayFlightTool", () => {
  it("returns the fixed flight surface filled with the trip", async () => {
    const result = (await displayFlightTool().execute!(
      { origin: "SFO", destination: "JFK", airline: "United", price: "$289" },
      toolOptions("c"),
    )) as { a2ui_operations: Array<Record<string, unknown>> };
    expect(result.a2ui_operations[0]).toEqual({
      version: "v0.9",
      createSurface: {
        surfaceId: "flight-fixed-schema",
        catalogId: "copilotkit://flight-fixed-catalog",
      },
    });
    expect(result.a2ui_operations[2]).toEqual({
      version: "v0.9",
      updateDataModel: {
        surfaceId: "flight-fixed-schema",
        path: "/",
        value: {
          origin: "SFO",
          destination: "JFK",
          airline: "United",
          price: "$289",
        },
      },
    });
  });
});
