import { randomUUID } from "node:crypto";
import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
  isToolMessage,
} from "@langchain/core/messages";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { a2uiContext } from "../../_shared/a2ui/context";
import malformed from "../../_shared/a2ui/fixtures/malformed-sales-dashboards.json";

const fake = vi.hoisted(() => ({
  invoke: vi.fn(),
  stream: vi.fn(),
  bindTools: vi.fn(),
}));
vi.mock("./openai-headers", () => ({
  makeChatOpenAI: () => ({
    bindTools: fake.bindTools,
  }),
}));
import { graph } from "./beautiful-chat";

const catalog = {
  catalogId: "test-dashboard",
  components: {
    Column: {
      allOf: [
        { properties: { children: { type: "array" } }, required: ["children"] },
      ],
    },
    Metric: {
      allOf: [
        {
          properties: { label: { type: "string" }, value: { type: "string" } },
          required: ["label", "value"],
        },
      ],
    },
  },
};
const context = [
  {
    description: "A2UI Component Schema — available components",
    value: JSON.stringify(catalog),
  },
  {
    description: "A2UI usage guide",
    value: "Use flat components with id root and top-level props.",
  },
];
const valid = {
  surfaceId: "sales",
  components: [
    { id: "root", component: "Column", children: ["revenue"] },
    { id: "revenue", component: "Metric", label: "Revenue", value: "$327,700" },
  ],
};

beforeEach(() => {
  vi.resetAllMocks();
  fake.bindTools.mockReturnValue({ invoke: fake.invoke, stream: fake.stream });
  fake.invoke
    .mockResolvedValueOnce(
      new AIMessage({
        content: "",
        tool_calls: [
          {
            id: "generation",
            name: "generate_a2ui",
            args: { intent: "create" },
            type: "tool_call",
          },
        ],
      }),
    )
    .mockResolvedValue(new AIMessage("Done."));
});

function output(args: object) {
  return (async function* () {
    yield new AIMessageChunk({
      content: "",
      tool_calls: [
        { id: randomUUID(), name: "render_a2ui", args, type: "tool_call" },
      ],
    });
  })();
}
async function run(contextEntries = context) {
  return graph.invoke(
    {
      messages: [new HumanMessage("Show a sales dashboard")],
      "ag-ui": {
        context: contextEntries,
        inject_a2ui_tool: true,
        actions: [
          {
            name: "render_a2ui",
            description: "Render UI",
            parameters: { type: "object", properties: {} },
          },
        ],
      },
    },
    { configurable: { thread_id: randomUUID() } },
  );
}
function generationResult(result: Awaited<ReturnType<typeof run>>) {
  const message = result.messages.find(
    (m) => isToolMessage(m) && m.tool_call_id === "generation",
  );
  expect(message).toBeDefined();
  return JSON.parse(String(message!.content));
}

describe("beautiful-chat catalog and recovery", () => {
  it("fails explicitly when catalog context is absent instead of guessing a catalog", async () => {
    const result = generationResult(await run([]));
    expect(fake.stream).not.toHaveBeenCalled();
    expect(result.code).toBe("a2ui_recovery_exhausted");
    expect(result.error).toContain("component schema is missing");
    expect(result.a2ui_operations).toBeUndefined();
  });
  it("preserves AG-UI catalog and usage guide through the graph and model call", async () => {
    fake.stream.mockImplementation(() => output(valid));
    const result = await run();
    expect(result["ag-ui"].context).toEqual(context);
    expect(String(fake.invoke.mock.calls[0][0][0].content)).toContain(
      "Use flat components",
    );
    expect(String(fake.stream.mock.calls[0][0][0].content)).toContain("Metric");
    expect(String(fake.stream.mock.calls[0][0][0].content)).toContain(
      "Use flat components",
    );
    const names = fake.bindTools.mock.calls[0][0].map(
      (t: { name?: string }) => t.name,
    );
    expect(names).toContain("generate_a2ui");
    expect(names).not.toContain("render_a2ui");
    expect(
      generationResult(result).a2ui_operations[0].createSurface.catalogId,
    ).toBe("test-dashboard");
  });

  it.each(malformed)(
    "recovers from captured malformed dashboard $threadId",
    async ({ args }) => {
      fake.stream
        .mockImplementationOnce(() => output(args))
        .mockImplementation(() => output(valid));
      const result = await run();
      expect(fake.stream).toHaveBeenCalledTimes(2);
      expect(String(fake.stream.mock.calls[1][0][0].content)).toContain(
        "missing_component_type",
      );
      expect(generationResult(result).a2ui_operations).toBeDefined();
    },
  );

  it.each([
    { id: "root", component: "MetricCard", label: "Revenue", value: "$1" },
    {
      id: "root",
      component: "Metric",
      props: { label: "Revenue", value: "$1" },
    },
  ])(
    "returns an actionable terminal failure for invalid catalog props: %j",
    async (component) => {
      fake.stream.mockImplementation(() => output({ components: [component] }));
      const result = generationResult(await run());
      expect(fake.stream).toHaveBeenCalledTimes(3);
      expect(result.code).toBe("a2ui_recovery_exhausted");
      expect(result.a2ui_operations).toBeUndefined();
      expect(result.attempts[0].errors[0].code).toBe(
        component.component === "MetricCard"
          ? "unknown_component"
          : "missing_required_prop",
      );
    },
  );
});

describe("effective A2UI context", () => {
  it("uses CopilotKit leaf overrides including explicit null, false and empty context", () => {
    const result = a2uiContext({
      "ag-ui": { context, inject_a2ui_tool: true, a2ui_schema: catalog },
      copilotkit: { context: [], inject_a2ui_tool: false, a2ui_schema: null },
    });
    expect(result.prompt).toBe("");
    expect(result.catalog).toBeUndefined();
    expect(result.properties.inject_a2ui_tool).toBe(false);
  });
  it("supports serialized context and nested catalog overrides", () => {
    const result = a2uiContext({
      "ag-ui": { context: JSON.stringify(context), a2ui_schema: catalog },
      copilotkit: { a2ui_schema: { catalogId: "override" } },
    });
    expect(result.catalogId).toBe("override");
    expect(result.catalog?.components.Metric.required).toEqual([
      "label",
      "value",
    ]);
    expect(result.prompt).toContain("Use flat components");
  });
});
