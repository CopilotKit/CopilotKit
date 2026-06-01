/**
 * Behavior tests for the CopilotKit LangGraph middleware.
 *
 * The contract these tests pin down (independent of how the middleware is
 * implemented internally — we only assert on what the model handler
 * observes and what state updates the middleware emits):
 *
 * - Frontend tools listed in `state.copilotkit.actions` reach the model
 *   alongside the agent's own tools. Empty actions = no change.
 * - App context from `state.copilotkit.context` (or runtime.context) becomes
 *   a SystemMessage `"App Context:\n<json>"`. Idempotent across re-runs.
 * - `afterModel` peels frontend tool calls off the last AIMessage so the
 *   ToolNode does not execute them; `afterAgent` re-attaches them.
 * - The opt-in `exposeState` knob surfaces user state into
 *   `request.systemPrompt` as a "Current agent state:" note. Default off;
 *   reserved internal keys / `_`-prefixed keys / empty values are filtered;
 *   allowlist forces an explicit subset; existing systemPrompt is kept.
 */

import { describe, it, expect } from "vitest";
import * as z from "zod";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";

import {
  copilotkitMiddleware,
  createCopilotkitMiddleware,
  zodState,
} from "../middleware";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(overrides: any = {}): any {
  return {
    model: { _modelType: () => "fake" },
    messages: [],
    systemPrompt: undefined,
    tools: [],
    state: { messages: [] },
    runtime: {},
    ...overrides,
  };
}

async function runWrap(middleware: any, request: any) {
  let received: any = null;
  const handler = async (req: any) => {
    received = req;
    return { content: "ok" } as any;
  };
  const result = await middleware.wrapModelCall(request, handler);
  expect(received).not.toBeNull();
  return { received, result };
}

function systemContents(messages: any[]): string[] {
  const out: string[] = [];
  for (const m of messages) {
    if (m._getType?.() === "system") {
      out.push(typeof m.content === "string" ? m.content : String(m.content));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Frontend-tool injection
// ---------------------------------------------------------------------------

describe("frontend tool injection", () => {
  it("passes the request through unchanged when there are no frontend tools", async () => {
    const backendTool = { name: "backend" };
    const request = makeRequest({
      state: { messages: [] },
      tools: [backendTool],
    });

    const { received } = await runWrap(copilotkitMiddleware, request);

    expect(received.tools).toEqual([backendTool]);
  });

  it("merges frontend tools from state.copilotkit.actions with the agent's own tools", async () => {
    const backend = { name: "backend" };
    const fe = [{ name: "fe_one" }, { name: "fe_two" }];
    const request = makeRequest({
      state: { messages: [], copilotkit: { actions: fe } },
      tools: [backend],
    });

    const { received } = await runWrap(copilotkitMiddleware, request);

    const names = received.tools.map((t: any) => t.name).sort();
    expect(names).toEqual(["backend", "fe_one", "fe_two"]);
  });

  it("does not mutate the input request when merging frontend tools", async () => {
    const request = makeRequest({
      state: {
        messages: [],
        copilotkit: { actions: [{ name: "fe" }] },
      },
      tools: [{ name: "backend" }],
    });

    await runWrap(copilotkitMiddleware, request);

    expect(request.tools.map((t: any) => t.name)).toEqual(["backend"]);
  });
});

// ---------------------------------------------------------------------------
// exposeState — opt-in state surfacing
// ---------------------------------------------------------------------------

describe("exposeState", () => {
  it("is off by default — user state never lands in the system prompt", async () => {
    const request = makeRequest({
      state: { messages: [], liked: ["a", "b"] },
    });

    const { received } = await runWrap(copilotkitMiddleware, request);

    expect(received.systemPrompt).toBeUndefined();
  });

  it("surfaces user state into the system prompt when set to true", async () => {
    const middleware = createCopilotkitMiddleware({ exposeState: true });
    const request = makeRequest({
      state: { messages: [], liked: ["a", "b"] },
    });

    const { received } = await runWrap(middleware, request);

    expect(received.systemPrompt).toBeDefined();
    const content =
      typeof received.systemPrompt.content === "string"
        ? received.systemPrompt.content
        : String(received.systemPrompt.content);
    expect(content).toContain("Current agent state:");
    expect(content).toContain('"liked"');
    expect(content).toContain('"a"');
    expect(content).toContain('"b"');
  });

  it("skips reserved internal keys when exposing state", async () => {
    const middleware = createCopilotkitMiddleware({ exposeState: true });
    const request = makeRequest({
      state: {
        messages: [new HumanMessage("hi")],
        tools: [{ name: "x" }],
        copilotkit: { actions: [] },
        structured_response: { foo: "bar" },
        thread_id: "t-1",
        remaining_steps: 5,
        "ag-ui": { context: [] },
        liked: ["a"],
      },
    });

    const { received } = await runWrap(middleware, request);

    const body =
      typeof received.systemPrompt?.content === "string"
        ? received.systemPrompt.content
        : "";
    expect(body).toContain('"liked"');
    for (const reserved of [
      "messages",
      "tools",
      "copilotkit",
      "structured_response",
      "thread_id",
      "remaining_steps",
      "ag-ui",
    ]) {
      expect(body).not.toContain(`"${reserved}"`);
    }
  });

  it("skips underscore-prefixed keys when exposing state", async () => {
    const middleware = createCopilotkitMiddleware({ exposeState: true });
    const request = makeRequest({
      state: { messages: [], _internal: { secret: 1 }, visible: "ok" },
    });

    const { received } = await runWrap(middleware, request);
    const body =
      typeof received.systemPrompt?.content === "string"
        ? received.systemPrompt.content
        : "";

    expect(body).not.toContain('"_internal"');
    expect(body).toContain('"visible"');
  });

  it.each([null, undefined, "", [], {}])(
    "skips keys with empty value %p",
    async (emptyValue) => {
      const middleware = createCopilotkitMiddleware({ exposeState: true });
      const request = makeRequest({
        state: { messages: [], filled: ["x"], blank: emptyValue },
      });

      const { received } = await runWrap(middleware, request);
      if (received.systemPrompt == null) return; // acceptable: nothing left

      const body =
        typeof received.systemPrompt.content === "string"
          ? received.systemPrompt.content
          : "";
      expect(body).toContain('"filled"');
      expect(body).not.toContain('"blank"');
    },
  );

  it("emits no system prompt when only reserved keys are present", async () => {
    const middleware = createCopilotkitMiddleware({ exposeState: true });
    const request = makeRequest({
      state: { messages: [new HumanMessage("hi")], tools: [] },
    });

    const { received } = await runWrap(middleware, request);

    expect(received.systemPrompt).toBeUndefined();
  });

  it("only includes named keys when given an allowlist", async () => {
    const middleware = createCopilotkitMiddleware({ exposeState: ["liked"] });
    const request = makeRequest({
      state: {
        messages: [],
        liked: ["a"],
        todos: [{ id: 1 }],
        other: "x",
      },
    });

    const { received } = await runWrap(middleware, request);
    const body =
      typeof received.systemPrompt?.content === "string"
        ? received.systemPrompt.content
        : "";

    expect(body).toContain('"liked"');
    expect(body).not.toContain('"todos"');
    expect(body).not.toContain('"other"');
  });

  it("honors an allowlist that explicitly names a normally-reserved key", async () => {
    const middleware = createCopilotkitMiddleware({
      exposeState: ["thread_id"],
    });
    const request = makeRequest({
      state: { messages: [], thread_id: "t-42" },
    });

    const { received } = await runWrap(middleware, request);
    const body =
      typeof received.systemPrompt?.content === "string"
        ? received.systemPrompt.content
        : "";

    expect(body).toContain("t-42");
  });

  it("appends to an existing string systemPrompt without replacing it", async () => {
    const middleware = createCopilotkitMiddleware({ exposeState: true });
    const request = makeRequest({
      state: { messages: [], liked: ["a"] },
      systemPrompt: "You are a helpful assistant.",
    });

    const { received } = await runWrap(middleware, request);
    const body =
      typeof received.systemPrompt.content === "string"
        ? received.systemPrompt.content
        : "";

    expect(body).toContain("You are a helpful assistant.");
    expect(body).toContain("Current agent state:");
    expect(body.indexOf("You are a helpful assistant.")).toBeLessThan(
      body.indexOf("Current agent state:"),
    );
  });

  it("appends to an existing SystemMessage systemPrompt without replacing it", async () => {
    const middleware = createCopilotkitMiddleware({ exposeState: true });
    const request = makeRequest({
      state: { messages: [], liked: ["a"] },
      systemPrompt: new SystemMessage({ content: "base" }),
    });

    const { received } = await runWrap(middleware, request);
    const body =
      typeof received.systemPrompt.content === "string"
        ? received.systemPrompt.content
        : "";

    expect(body).toContain("base");
    expect(body).toContain("Current agent state:");
  });

  it("keeps state hidden when explicitly disabled", async () => {
    const middleware = createCopilotkitMiddleware({ exposeState: false });
    const request = makeRequest({
      state: { messages: [], liked: ["a"] },
      systemPrompt: "base",
    });

    const { received } = await runWrap(middleware, request);

    expect(received.systemPrompt).toBe("base");
  });

  it("emits a parseable JSON snapshot in the note", async () => {
    const middleware = createCopilotkitMiddleware({ exposeState: true });
    const request = makeRequest({
      state: {
        messages: [],
        liked: ["a", "b"],
        count: 3,
        nested: { k: "v" },
      },
    });

    const { received } = await runWrap(middleware, request);
    const body =
      typeof received.systemPrompt.content === "string"
        ? received.systemPrompt.content
        : "";

    const jsonPart = body.split("Current agent state:\n")[1];
    expect(JSON.parse(jsonPart)).toEqual({
      liked: ["a", "b"],
      count: 3,
      nested: { k: "v" },
    });
  });
});

// ---------------------------------------------------------------------------
// beforeAgent — App Context injection
// ---------------------------------------------------------------------------

describe("beforeAgent", () => {
  it("returns no update when context is empty", () => {
    const state = {
      messages: [new HumanMessage("hi")],
      copilotkit: { context: [] },
    };
    const result = copilotkitMiddleware.beforeAgent(state, {} as any);
    expect(result).toBeUndefined();
  });

  it("injects an App Context SystemMessage into the message list", () => {
    const state = {
      messages: [new HumanMessage("hi")],
      copilotkit: {
        context: [{ description: "viewer role", value: "admin" }],
      },
    };

    const result = copilotkitMiddleware.beforeAgent(state, {} as any);

    expect(result).toBeDefined();
    const sys = systemContents(result!.messages);
    expect(sys.some((s) => s.startsWith("App Context:"))).toBe(true);
    expect(sys.some((s) => s.includes("admin"))).toBe(true);
  });

  it("uses runtime.context when state.copilotkit.context is missing", () => {
    const state = {
      messages: [new HumanMessage("hi")],
      copilotkit: {},
    };
    const runtime = { context: "route=/dashboard" };

    const result = copilotkitMiddleware.beforeAgent(state, runtime as any);

    const sys = systemContents(result!.messages);
    expect(sys.some((s) => s.includes("/dashboard"))).toBe(true);
  });

  it("does not duplicate the App Context message across re-runs", () => {
    const state = {
      messages: [new HumanMessage("hi")],
      copilotkit: { context: [{ description: "k", value: "v" }] },
    };

    const first = copilotkitMiddleware.beforeAgent(state, {} as any) ?? state;
    const second = copilotkitMiddleware.beforeAgent(first, {} as any) ?? first;

    const appContextMessages = systemContents(second.messages).filter((s) =>
      s.startsWith("App Context:"),
    );
    expect(appContextMessages).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// afterModel — frontend tool-call interception
// ---------------------------------------------------------------------------

describe("afterModel", () => {
  it("is a no-op when there are no frontend tools", () => {
    const state = {
      messages: [
        new HumanMessage("hi"),
        new AIMessage({
          content: "",
          tool_calls: [{ id: "1", name: "backend_only", args: {} }],
        }),
      ],
      copilotkit: { actions: [] },
    };

    expect(copilotkitMiddleware.afterModel(state, {} as any)).toBeUndefined();
  });

  it("peels frontend tool calls off the last AIMessage and stashes them", () => {
    const fe = { function: { name: "navigate" } };
    const ai = new AIMessage({
      content: "",
      tool_calls: [
        { id: "1", name: "backend_search", args: { q: "hi" } },
        { id: "2", name: "navigate", args: { path: "/x" } },
      ],
      id: "ai-1",
    });
    const state = {
      messages: [new HumanMessage("hi"), ai],
      copilotkit: { actions: [fe] },
    };

    const result = copilotkitMiddleware.afterModel(state, {} as any);

    expect(result).toBeDefined();
    const lastAI = result!.messages[result!.messages.length - 1] as AIMessage;
    expect(lastAI.tool_calls?.map((tc: any) => tc.name)).toEqual([
      "backend_search",
    ]);

    const intercepted = result!.copilotkit.interceptedToolCalls;
    expect(intercepted).toHaveLength(1);
    expect(intercepted[0].id).toBe("2");
    expect(intercepted[0].name).toBe("navigate");
    expect(result!.copilotkit.originalAIMessageId).toBe("ai-1");
  });
});

// ---------------------------------------------------------------------------
// afterAgent — frontend tool-call restoration
// ---------------------------------------------------------------------------

describe("afterAgent", () => {
  it("returns no update when there is nothing intercepted", () => {
    const state = {
      messages: [
        new HumanMessage("hi"),
        new AIMessage({ content: "ok", id: "ai-1" }),
      ],
      copilotkit: {},
    };

    expect(copilotkitMiddleware.afterAgent(state, {} as any)).toBeUndefined();
  });

  it("restores intercepted tool calls onto the original AIMessage", () => {
    const intercepted = [{ id: "2", name: "navigate", args: { path: "/x" } }];
    const state = {
      messages: [
        new HumanMessage("hi"),
        new AIMessage({ content: "", id: "ai-1" }),
      ],
      copilotkit: {
        interceptedToolCalls: intercepted,
        originalAIMessageId: "ai-1",
      },
    };

    const result = copilotkitMiddleware.afterAgent(state, {} as any);

    expect(result).toBeDefined();
    const restored = result!.messages.find(
      (m: any) => m.id === "ai-1" && m._getType?.() === "ai",
    ) as AIMessage;
    expect(restored.tool_calls?.map((tc: any) => tc.name)).toEqual([
      "navigate",
    ]);
    expect(result!.copilotkit.interceptedToolCalls).toBeUndefined();
    expect(result!.copilotkit.originalAIMessageId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// zodState — Standard-Schema JSON-schema augmentation
// ---------------------------------------------------------------------------
//
// Contract: a Zod v4 schema only carries `~standard.validate` + `vendor`, so
// LangGraph's `isStandardJSONSchema()` returns false and the field is dropped
// from `output_schema`. `zodState` patches `~standard.jsonSchema.input` onto
// the schema so the field survives serialization and reaches the frontend
// via AG-UI `STATE_SNAPSHOT` events.

type JsonSchema = {
  type?: string;
  properties?: Record<string, unknown>;
};
type StdJson = { jsonSchema?: { input: () => JsonSchema } };
const standardOf = (s: object): StdJson | undefined =>
  (s as { "~standard"?: StdJson })["~standard"];
const hasZodV4ToJsonSchema = (): boolean =>
  typeof (z as { toJSONSchema?: unknown }).toJSONSchema === "function";

describe("zodState", () => {
  it("attaches a ~standard.jsonSchema.input hook to a Zod schema", () => {
    const schema = z.object({ name: z.string() });
    expect(standardOf(schema)?.jsonSchema).toBeUndefined();

    const wrapped = zodState(schema);

    const std = standardOf(wrapped);
    expect(std?.jsonSchema).toBeDefined();
    expect(typeof std?.jsonSchema?.input).toBe("function");
  });

  it("returns a plain object from input() (real JSON Schema when zod v4 is available, else `{}`)", () => {
    // The contract langgraph cares about is just "input() returns an
    // object" — `isStandardJSONSchema()` doesn't introspect the shape.
    // When zod v4's `toJSONSchema` is present we get the real schema;
    // otherwise we get `{}`, which is still enough for the field to
    // appear in `output_schema` (langgraph-api treats it as opaque).
    const schema = z.object({ todos: z.array(z.string()) });
    const wrapped = zodState(schema);

    const json = standardOf(wrapped)?.jsonSchema?.input();

    expect(json).toBeTypeOf("object");
    expect(json).not.toBeNull();
    if (hasZodV4ToJsonSchema()) {
      expect(json?.type).toBe("object");
      expect(json?.properties?.todos).toBeDefined();
    }
  });

  it("caches the JSON Schema across calls (input() returns the same object)", () => {
    const schema = z.object({ x: z.string() });
    const wrapped = zodState(schema);
    const std = standardOf(wrapped);

    const a = std?.jsonSchema?.input();
    const b = std?.jsonSchema?.input();

    expect(a).toBe(b);
  });

  it("does not overwrite an existing jsonSchema hook", () => {
    const schema = z.object({ x: z.string() });
    const preset: StdJson["jsonSchema"] = { input: () => ({}) };
    const std = standardOf(schema);
    expect(std).toBeDefined();
    std!.jsonSchema = preset;

    zodState(schema);

    expect(standardOf(schema)?.jsonSchema).toBe(preset);
  });

  it("returns the same reference (mutates rather than copies)", () => {
    const schema = z.object({ x: z.string() });
    expect(zodState(schema)).toBe(schema);
  });

  it("is a no-op for a value without ~standard metadata", () => {
    const plain = { foo: "bar" };
    expect(() => zodState(plain)).not.toThrow();
    expect(zodState(plain)).toBe(plain);
  });

  it("works on optional / array / default-wrapped schemas (state-field shapes)", () => {
    const todos = zodState(
      z.array(z.object({ id: z.string(), text: z.string() })).default(() => []),
    );

    const std = standardOf(todos);
    expect(std).toBeDefined();
    expect(std?.jsonSchema).toBeDefined();
    const json = std?.jsonSchema?.input();
    expect(json).toBeTypeOf("object");
    if (hasZodV4ToJsonSchema()) {
      expect(json?.type).toBe("array");
    }
  });

  it("makes the wrapped field pass a StandardJSONSchemaV1-style probe", () => {
    // Mirrors what LangGraph's isStandardJSONSchema() looks for: an `input`
    // function on `~standard.jsonSchema` that returns a plain object.
    const schema = zodState(z.object({ liked: z.array(z.string()) }));
    const std = standardOf(schema);

    expect(std?.jsonSchema).toBeDefined();
    expect(typeof std?.jsonSchema?.input).toBe("function");
    expect(typeof std?.jsonSchema?.input()).toBe("object");
  });
});
