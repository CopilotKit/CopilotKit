import { beforeEach, describe, expect, it, vi } from "vitest";
import { AIMessage } from "@langchain/core/messages";
import { StateGraph, START, END } from "@langchain/langgraph";
import type { A2UIToolParams } from "@ag-ui/langgraph";

// Capture the adapter boundary; no model or LLM responses are mocked.
const { captured, invoked } = vi.hoisted(() => {
  const params: A2UIToolParams[] = [];
  return {
    captured: params,
    invoked: vi.fn(
      async (_input: unknown, config: { state?: unknown }) => config.state,
    ),
  };
});
vi.mock("@ag-ui/langgraph", () => ({
  getA2UITools: (params: A2UIToolParams) => {
    captured.push(params);
    return { name: "generate_a2ui", invoke: invoked };
  },
}));
import { createCopilotkitMiddleware } from "../middleware";

const catalog = (id: string) => [
  {
    description: "A2UI catalog capabilities",
    value: "Available A2UI catalog:\n- " + id + "\n  - Card: {}",
  },
];
const middleware = createCopilotkitMiddleware();
async function wrap(state: object) {
  const tools: Array<{
    name: string;
    invoke: (input: unknown, config: { state: object }) => Promise<unknown>;
  }> = [];
  const request = { state, model: {}, tools, messages: [], runtime: {} };
  let received = request;
  await middleware.wrapModelCall(request, async (req) => {
    received = req;
    return new AIMessage("ok");
  });
  return received;
}
// The App Context note the model sees, folded into its system prompt.
async function context(state: object, runtime = {}) {
  const request = { state, model: {}, tools: [], messages: [], runtime };
  let received: { systemPrompt?: string } = request;
  await middleware.wrapModelCall(request, async (req) => {
    received = req;
    return new AIMessage("ok");
  });
  return received.systemPrompt;
}

beforeEach(() => {
  captured.length = 0;
  invoked.mockClear();
});

describe("effective AG-UI and CopilotKit properties", () => {
  it.each([null, false, []])(
    "treats explicit %j actions as empty while injection is enabled",
    async (actions) => {
      const result = await wrap({
        "ag-ui": { inject_a2ui_tool: true, actions: [{ name: "base" }] },
        copilotkit: { actions },
      });
      expect(result.tools.map((tool) => tool.name)).toEqual(["generate_a2ui"]);
    },
  );

  it("replaces serialized schemas atomically and adapts object context only for the toolkit", async () => {
    const schema = JSON.stringify({ catalogId: "override" });
    const state = {
      "ag-ui": {
        inject_a2ui_tool: true,
        a2ui_schema: JSON.stringify({
          catalogId: "base",
          components: { Card: {} },
        }),
      },
      copilotkit: { a2ui_schema: schema, context: { user: "alice" } },
    };
    const result = await wrap(state);
    await result.tools[0].invoke({}, { state });
    expect(captured[0].defaultCatalogId).toBe("override");
    expect(invoked.mock.calls[0][1].state).toEqual(
      expect.objectContaining({
        "ag-ui": expect.objectContaining({ a2ui_schema: schema, context: [] }),
      }),
    );
    expect(state.copilotkit.context).toEqual({ user: "alice" });
  });

  it("retains both namespace fields through the graph state schema", async () => {
    const graph = new StateGraph(middleware.stateSchema)
      .addNode("echo", () => ({}))
      .addEdge(START, "echo")
      .addEdge("echo", END)
      .compile();
    const state = {
      "ag-ui": { context: catalog("native") },
      copilotkit: { a2ui_schema: "schema", inject_a2ui_tool: false },
    };
    expect(await graph.invoke(state)).toEqual(state);
  });

  it("decodes serialized catalog carriers only at the catalog consumer", async () => {
    const entries = catalog("serialized");
    entries[0].value = JSON.stringify(entries[0].value);
    const state = {
      "ag-ui": { inject_a2ui_tool: true, context: JSON.stringify(entries) },
    };
    await wrap(state);
    expect(captured[0].defaultCatalogId).toBe("serialized");
    expect(await context(state)).toBe(
      "App Context:\n" + state["ag-ui"].context,
    );
  });

  it("ignores malformed catalog entries", async () => {
    await wrap({
      "ag-ui": {
        inject_a2ui_tool: true,
        context: [
          null,
          1,
          { description: 4, value: true },
          { description: "A2UI catalog", value: {} },
        ],
      },
    });
    expect(captured[0].defaultCatalogId).toBeUndefined();
  });

  it("merges nested context while preserving conflicting scalar and array leaves", async () => {
    const state = {
      "ag-ui": {
        context: {
          nested: { retained: 1, conflict: "old", items: [{ base: 1 }] },
          enabled: true,
        },
      },
      copilotkit: {
        context: {
          nested: { added: 2, conflict: null, items: [{ override: 2 }] },
          enabled: false,
        },
      },
    };
    const before = structuredClone(state);
    expect(await context(state)).toBe(
      "App Context:\n" +
        JSON.stringify(
          {
            nested: {
              retained: 1,
              conflict: null,
              items: [{ override: 2 }],
              added: 2,
            },
            enabled: false,
          },
          null,
          2,
        ),
    );
    expect(state).toEqual(before);
  });

  it.each([null, false, "", []])(
    "does not resurrect AG-UI or runtime context after an explicit %j override",
    async (value) => {
      expect(
        await context(
          { "ag-ui": { context: "base" }, copilotkit: { context: value } },
          { context: { copilotkit: { context: "runtime" } } },
        ),
      ).toBeUndefined();
    },
  );

  it("keeps serialized context atomic and preserves the runtime fallback", async () => {
    expect(
      await context({
        "ag-ui": { context: { base: 1 } },
        copilotkit: { context: '{"override":2}' },
      }),
    ).toBe('App Context:\n{"override":2}');
    expect(
      await context({}, { context: { copilotkit: { context: "runtime" } } }),
    ).toBe("App Context:\nruntime");
    expect(await context({}, { context: "runtime" })).toBeUndefined();
  });

  it.each(["ag-ui", "copilotkit"])(
    "uses a catalog and frontend action supplied only through %s",
    async (namespace) => {
      const state = {
        [namespace]: {
          context: catalog("catalog-one"),
          actions: [{ name: "frontend" }],
          inject_a2ui_tool: true,
        },
      };
      const result = await wrap(state);
      expect(result.tools.map((tool) => tool.name)).toEqual([
        "generate_a2ui",
        "frontend",
      ]);
      expect(captured[0].defaultCatalogId).toBe("catalog-one");
      expect(captured[0].guidelines.compositionGuide).toContain("catalog-one");
    },
  );

  it("replaces context and action lists as wholes, including empty lists", async () => {
    const state = {
      "ag-ui": {
        context: catalog("base"),
        actions: [{ name: "base" }],
        inject_a2ui_tool: true,
      },
      copilotkit: { context: [], actions: [] },
    };
    const result = await wrap(state);
    expect(result.tools.map((tool) => tool.name)).toEqual(["generate_a2ui"]);
    expect(captured[0].defaultCatalogId).toBeUndefined();
    expect(captured[0].guidelines).toBeUndefined();
  });

  it.each([false, null, ""])(
    "honors an explicit %j injection override",
    async (value) => {
      const result = await wrap({
        "ag-ui": { inject_a2ui_tool: true },
        copilotkit: { inject_a2ui_tool: value },
      });
      expect(result.tools).toEqual([]);
      expect(captured).toEqual([]);
    },
  );

  it("intercepts and restores AG-UI frontend calls without losing the namespace", () => {
    const message = new AIMessage({
      id: "assistant",
      content: "",
      tool_calls: [{ id: "call", name: "frontend", args: {} }],
    });
    const state = {
      "ag-ui": { actions: [{ name: "frontend" }] },
      messages: [message],
    };
    const intercepted = middleware.afterModel(state);
    expect(intercepted.messages[0].tool_calls).toEqual([]);
    const restored = middleware.afterAgent({ ...state, ...intercepted });
    expect(restored.messages[0].tool_calls).toEqual(message.tool_calls);
    expect(state.messages[0]).toBe(message);
  });

  it("delivers the merged native schema to the tool invocation without mutating state", async () => {
    const state = {
      "ag-ui": {
        inject_a2ui_tool: true,
        a2ui_schema: {
          catalogId: "base",
          components: { Card: { base: true, shared: "old" } },
        },
      },
      copilotkit: {
        a2ui_schema: {
          catalogId: "override",
          components: { Card: { shared: "new" }, Button: {} },
        },
      },
    };
    const before = structuredClone(state);
    const result = await wrap(state);
    await result.tools[0].invoke({}, { state });
    expect(captured[0].defaultCatalogId).toBe("override");
    expect(invoked.mock.calls[0][1].state).toEqual(
      expect.objectContaining({
        "ag-ui": expect.objectContaining({
          a2ui_schema: JSON.stringify({
            catalogId: "override",
            components: { Card: { base: true, shared: "new" }, Button: {} },
          }),
        }),
      }),
    );
    expect(state).toEqual(before);
  });
});
