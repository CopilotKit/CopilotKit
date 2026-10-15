import { AbstractAgent, EventType } from "@ag-ui/client";
import type {
  ActivityDeltaEvent,
  ActivitySnapshotEvent,
  BaseEvent,
  RunAgentInput,
  ToolCallResultEvent,
} from "@ag-ui/client";
import { firstValueFrom, from, toArray } from "rxjs";
import type { Observable } from "rxjs";
import { describe, expect, it } from "vitest";
import type { GenerativeUIManifest } from "@copilotkit/shared";
import { GenerativeUIMiddleware } from "../generative-ui";

class ScriptedAgent extends AbstractAgent {
  lastInput?: RunAgentInput;
  constructor(private readonly script: BaseEvent[]) {
    super();
  }
  run(input: RunAgentInput): Observable<BaseEvent> {
    this.lastInput = input;
    return from(this.script);
  }
}

const manifest: GenerativeUIManifest = {
  catalogId: "shop",
  catalogVersion: "fnv1a:test",
  components: {
    ProductGrid: {
      props: { type: "object", properties: {} },
      slots: { children: "multiple" },
    },
    ProductCard: {
      props: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
      events: { onAddToCart: { parameters: { type: "object" } } },
    },
  },
  functions: { addToCart: { parameters: { type: "object" } } },
  targets: [
    { id: "chat", kind: "chat" },
    { id: "recommendations", kind: "inline" },
  ],
  surfaces: {},
};

const create = (surfaceId: string) => ({
  version: "v0.9",
  createSurface: { surfaceId, catalogId: "shop" },
});
const components = (surfaceId: string, ...nodes: unknown[]) => ({
  version: "v0.9",
  updateComponents: { surfaceId, components: nodes },
});

function chunk(text: string, size: number): string[] {
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += size)
    parts.push(text.slice(i, i + size));
  return parts;
}

function renderCall(
  args: unknown,
  toolCallId = "call-1",
  argsText?: string,
): BaseEvent[] {
  const text = argsText ?? JSON.stringify(args);
  return [
    {
      type: EventType.TOOL_CALL_START,
      toolCallId,
      toolCallName: "render_ui",
      parentMessageId: "msg-1",
    },
    ...chunk(text, 9).map((delta) => ({
      type: EventType.TOOL_CALL_ARGS,
      toolCallId,
      delta,
    })),
    { type: EventType.TOOL_CALL_END, toolCallId },
  ] as BaseEvent[];
}

async function run(
  script: BaseEvent[],
  forwardedProps: Record<string, unknown> = { generativeUI: manifest },
) {
  const agent = new ScriptedAgent([
    { type: EventType.RUN_STARTED, threadId: "t1", runId: "r1" } as BaseEvent,
    ...script,
    { type: EventType.RUN_FINISHED, threadId: "t1", runId: "r1" } as BaseEvent,
  ]);
  const input: RunAgentInput = {
    threadId: "t1",
    runId: "r1",
    state: {},
    messages: [],
    tools: [],
    context: [],
    forwardedProps,
  };
  const output = await firstValueFrom(
    new GenerativeUIMiddleware().run(input, agent).pipe(toArray()),
  );
  return { output, input: agent.lastInput! };
}

type ActivityEvent = ActivitySnapshotEvent | ActivityDeltaEvent;

const activity = (events: BaseEvent[]) =>
  events.filter(
    (e): e is ActivityEvent =>
      e.type === EventType.ACTIVITY_SNAPSHOT ||
      e.type === EventType.ACTIVITY_DELTA,
  );

function patchOf(event: ActivityEvent) {
  if (event.type !== EventType.ACTIVITY_DELTA) {
    throw new Error(`expected an ACTIVITY_DELTA event, got ${event.type}`);
  }
  return event.patch;
}

function findToolResult(output: BaseEvent[]) {
  const result = output.find(
    (e): e is ToolCallResultEvent => e.type === EventType.TOOL_CALL_RESULT,
  );
  if (!result) throw new Error("the run has no TOOL_CALL_RESULT event");
  return result;
}

function toolResult(output: BaseEvent[]) {
  const { content } = findToolResult(output);
  if (typeof content !== "string") {
    throw new Error("the render_ui tool result is not a JSON string");
  }
  return JSON.parse(content);
}

function guideText(input: RunAgentInput) {
  const guide = input.context.find((c) => c.value.includes("render_ui"));
  if (!guide) throw new Error("the run has no generative UI guide");
  return guide.value;
}

describe("GenerativeUIMiddleware", () => {
  it("passes runs without a manifest through unchanged", async () => {
    const { output, input } = await run([], {});
    expect(input.tools).toEqual([]);
    expect(output.map((e) => e.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.RUN_FINISHED,
    ]);
  });

  it("injects the render_ui tool and the guide context", async () => {
    const { input } = await run([]);
    const tool = input.tools.find((t) => t.name === "render_ui");
    expect(tool?.parameters).toMatchObject({
      required: ["target", "operations"],
      properties: { target: { enum: ["chat", "recommendations"] } },
    });
    expect(guideText(input)).toContain("ProductCard");
  });

  it("tells the model to show a different view in a new surface, not an existing one", async () => {
    const { input } = await run([], {
      generativeUI: {
        ...manifest,
        surfaces: { cart_surface: { target: "chat" } },
      },
    });
    const guide = guideText(input);
    // A follow-up such as "checkout" after "show my cart" must not overwrite the cart card.
    expect(guide).toContain(
      "To show a different view, create a new surface with a new surfaceId",
    );
    expect(guide).toContain(
      "Never reuse an earlier chat surface for a different view",
    );
  });

  it("tells the model to list child ids in the root's slot before sending the children", async () => {
    const { input } = await run([]);
    const guide = guideText(input);
    // A ProductGrid root sent without `children` renders only its title.
    expect(guide).toContain(
      "The root must already list the ids of its children in its slot props",
    );
    expect(guide).toContain(
      "A component that no slot references is never shown",
    );
  });

  it("parses a target description from forwarded props and prints it in the guide", async () => {
    const { input } = await run([], {
      generativeUI: {
        ...manifest,
        targets: [
          { id: "chat", kind: "chat" },
          {
            id: "recommendations",
            kind: "inline",
            description:
              "Next to the product list. Use it for product recommendations.",
          },
        ],
      },
    });
    expect(guideText(input)).toContain(
      [
        "### Targets",
        '- "chat" (inside the chat transcript)',
        '- "recommendations" (a named area of the app): Next to the product list. Use it for product recommendations.',
      ].join("\n"),
    );
  });

  it("does not tell the model about app state, even when the client still sends it", async () => {
    const { input } = await run([], {
      generativeUI: { ...manifest, appState: ["cart"] },
    });
    const guide = guideText(input);
    expect(guide).not.toContain("App state");
    expect(guide).not.toContain("/app");
    // The rules after the removed app state rule are numbered again.
    expect(guide).toContain("\n6. To show a different view");
    expect(guide).toContain("\n7. If the conversation ends");
  });

  it("emits a snapshot for createSurface and one delta per further operation", async () => {
    const ops = [
      create("recs"),
      components("recs", {
        id: "root",
        component: "ProductGrid",
        children: ["c1"],
      }),
      components("recs", {
        id: "c1",
        component: "ProductCard",
        name: "A",
        onAddToCart: {
          functionCall: { call: "addToCart", args: { productId: "p1" } },
        },
      }),
    ];
    const { output } = await run(
      renderCall({ target: "recommendations", operations: ops }),
    );
    const events = activity(output);
    expect(events[0]).toMatchObject({
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId: "genui:recs",
      activityType: "generative-ui-surface",
      replace: true,
      content: {
        surfaceId: "recs",
        target: "recommendations",
        catalogId: "shop",
        operations: [ops[0]],
        status: "streaming",
        rejected: [],
      },
    });
    expect(events.slice(1, 3).map(patchOf)).toEqual([
      [{ op: "add", path: "/operations/-", value: ops[1] }],
      [{ op: "add", path: "/operations/-", value: ops[2] }],
    ]);
    expect(patchOf(events[3])).toEqual([
      { op: "replace", path: "/status", value: "ready" },
    ]);
    const endIndex = output.findIndex(
      (e) => e.type === EventType.TOOL_CALL_END,
    );
    expect(output.indexOf(events[2])).toBeLessThan(endIndex);
  });

  it("rejects an invalid operation, keeps the rest, and reports it in the tool result", async () => {
    const ops = [
      create("recs"),
      components("recs", { id: "x", component: "Unknown" }),
      components("recs", {
        id: "root",
        component: "ProductGrid",
        children: [],
      }),
    ];
    const { output } = await run(
      renderCall({ target: "recommendations", operations: ops }),
    );
    const patches = activity(output)
      .slice(1)
      .map((e) => patchOf(e)[0]);
    expect(patches[0]).toMatchObject({
      op: "add",
      path: "/rejected/-",
      value: { index: 1 },
    });
    expect(patches[1]).toEqual({
      op: "add",
      path: "/operations/-",
      value: ops[2],
    });
    expect(toolResult(output)).toMatchObject({
      status: "rendered",
      applied: 2,
      rejected: [
        {
          index: 1,
          reason: expect.stringContaining('unknown component "Unknown"'),
        },
      ],
    });
    const finishedIndex = output.findIndex(
      (e) => e.type === EventType.RUN_FINISHED,
    );
    expect(output.indexOf(findToolResult(output))).toBeLessThan(finishedIndex);
  });

  it("rejects createSurface for a target that is not mounted", async () => {
    const { output } = await run(
      renderCall({ target: "sidebar", operations: [create("x")] }),
    );
    expect(activity(output)).toEqual([]);
    expect(toolResult(output).rejected[0].reason).toMatch(
      /target "sidebar" is not mounted/,
    );
  });

  it("updates an existing surface with deltas only", async () => {
    const op = components("recs", {
      id: "c2",
      component: "ProductCard",
      name: "B",
    });
    const { output } = await run(
      renderCall({ target: "recommendations", operations: [op] }),
      {
        generativeUI: {
          ...manifest,
          surfaces: { recs: { target: "recommendations" } },
        },
      },
    );
    const events = activity(output);
    expect(events.every((e) => e.type === EventType.ACTIVITY_DELTA)).toBe(true);
    expect(patchOf(events[0])).toEqual([
      { op: "replace", path: "/status", value: "streaming" },
      { op: "replace", path: "/rejected", value: [] },
      { op: "add", path: "/operations/-", value: op },
    ]);
    expect(patchOf(events[1])).toEqual([
      { op: "replace", path: "/status", value: "ready" },
    ]);
  });

  it("clears the surface's rejections when a second render_ui call first touches it", async () => {
    const first = [
      create("recs"),
      components("recs", { id: "x", component: "Unknown" }),
    ];
    const repair = components("recs", {
      id: "root",
      component: "ProductGrid",
      children: [],
    });
    const { output } = await run([
      ...renderCall({ target: "recommendations", operations: first }, "call-1"),
      ...renderCall(
        { target: "recommendations", operations: [repair] },
        "call-2",
      ),
    ]);
    const patches = activity(output)
      .filter((e) => e.type === EventType.ACTIVITY_DELTA)
      .map(patchOf);
    expect(patches[0]).toEqual([
      {
        op: "add",
        path: "/rejected/-",
        value: { index: 1, reason: expect.stringContaining("Unknown") },
      },
    ]);
    expect(patches[1]).toEqual([
      { op: "replace", path: "/status", value: "ready" },
    ]);
    expect(patches[2]).toEqual([
      { op: "replace", path: "/status", value: "streaming" },
      { op: "replace", path: "/rejected", value: [] },
      { op: "add", path: "/operations/-", value: repair },
    ]);
  });

  it("clears old rejections before reporting a new one on an existing surface", async () => {
    const bad = components("recs", { id: "x", component: "Unknown" });
    const { output } = await run(
      renderCall({ target: "recommendations", operations: [bad] }),
      {
        generativeUI: {
          ...manifest,
          surfaces: { recs: { target: "recommendations" } },
        },
      },
    );
    expect(patchOf(activity(output)[0])).toEqual([
      { op: "replace", path: "/status", value: "streaming" },
      { op: "replace", path: "/rejected", value: [] },
      {
        op: "add",
        path: "/rejected/-",
        value: { index: 0, reason: expect.stringContaining("Unknown") },
      },
    ]);
  });

  describe("tool result when operations are malformed", () => {
    it("renders operations sent as a JSON-encoded string", async () => {
      const ops = [
        create("recs"),
        components("recs", {
          id: "root",
          component: "ProductGrid",
          children: [],
        }),
      ];
      const { output } = await run(
        renderCall({
          target: "recommendations",
          operations: JSON.stringify(ops),
        }),
      );
      const events = activity(output);
      expect(events[0]).toMatchObject({
        type: EventType.ACTIVITY_SNAPSHOT,
        content: { operations: [ops[0]] },
      });
      expect(patchOf(events[1])).toEqual([
        { op: "add", path: "/operations/-", value: ops[1] },
      ]);
      expect(patchOf(events[2])).toEqual([
        { op: "replace", path: "/status", value: "ready" },
      ]);
      expect(toolResult(output)).toEqual({
        status: "rendered",
        applied: 2,
        rejected: [],
      });
    });

    it("still requires a target for string-encoded operations", async () => {
      const { output } = await run(
        renderCall({ operations: JSON.stringify([create("recs")]) }),
      );
      expect(activity(output)).toEqual([]);
      expect(toolResult(output)).toMatchObject({
        status: "rendered",
        applied: 0,
        rejected: [
          { index: 0, reason: "render_ui was called without a target" },
        ],
      });
    });

    it("reports an error when no operation could be parsed", async () => {
      const { output } = await run(
        renderCall({ target: "recommendations", operations: [] }),
      );
      expect(activity(output)).toEqual([]);
      expect(toolResult(output)).toEqual({
        status: "error",
        applied: 0,
        rejected: [],
        reason: expect.stringContaining("nothing was rendered"),
      });
    });

    it("reports an error when operations is a string that is not a JSON array", async () => {
      const { output } = await run(
        renderCall({
          target: "recommendations",
          operations: "createSurface recs",
        }),
      );
      expect(toolResult(output)).toMatchObject({ status: "error", applied: 0 });
    });

    it("counts a truncated trailing operation as rejected", async () => {
      const ops = [
        create("recs"),
        components("recs", {
          id: "root",
          component: "ProductGrid",
          children: [],
        }),
      ];
      const full = JSON.stringify({
        target: "recommendations",
        operations: ops,
      });
      const truncated = full.slice(0, full.indexOf("updateComponents") + 10);
      const { output } = await run(renderCall(undefined, "call-1", truncated));
      expect(activity(output)[0]).toMatchObject({
        type: EventType.ACTIVITY_SNAPSHOT,
      });
      expect(toolResult(output)).toEqual({
        status: "rendered",
        applied: 1,
        rejected: [{ index: 1, reason: "operation was truncated" }],
      });
    });
  });

  it("buffers operations until the target arrives", async () => {
    const ops = [
      create("recs"),
      components("recs", {
        id: "root",
        component: "ProductGrid",
        children: [],
      }),
    ];
    const argsText = JSON.stringify({
      operations: ops,
      target: "recommendations",
    });
    const { output } = await run(renderCall(undefined, "call-1", argsText));
    const events = activity(output);
    expect(events[0]).toMatchObject({
      type: EventType.ACTIVITY_SNAPSHOT,
      content: { target: "recommendations" },
    });
    expect(patchOf(events[1])).toEqual([
      { op: "add", path: "/operations/-", value: ops[1] },
    ]);
  });

  describe("untrusted manifest", () => {
    it("drops a component entry without props instead of throwing, and rejects ops that use it", async () => {
      const forged = {
        catalogId: "shop",
        components: { X: {} },
        targets: [{ id: "chat", kind: "chat" }],
      };
      const ops = [
        create("s"),
        components("s", { id: "root", component: "X" }),
      ];
      const { output, input } = await run(
        renderCall({ target: "chat", operations: ops }),
        {
          generativeUI: forged,
        },
      );
      expect(input.tools.some((t) => t.name === "render_ui")).toBe(true);
      const events = activity(output);
      expect(events[0]).toMatchObject({
        type: EventType.ACTIVITY_SNAPSHOT,
        content: { surfaceId: "s", target: "chat" },
      });
      expect(patchOf(events[1])).toEqual([
        {
          op: "add",
          path: "/rejected/-",
          value: {
            index: 1,
            reason: expect.stringContaining('unknown component "X"'),
          },
        },
      ]);
      expect(toolResult(output)).toMatchObject({
        status: "rendered",
        applied: 1,
        rejected: [
          {
            index: 1,
            reason: expect.stringContaining('unknown component "X"'),
          },
        ],
      });
      expect(output[output.length - 1].type).toBe(EventType.RUN_FINISHED);
    });

    it("treats a non-array props.required as no required props", async () => {
      const forged = {
        catalogId: "shop",
        components: {
          ProductCard: {
            props: {
              type: "object",
              properties: { name: { type: "string" } },
              required: 5,
            },
          },
        },
        targets: [{ id: "chat", kind: "chat" }],
      };
      const ops = [
        create("s"),
        components("s", { id: "root", component: "ProductCard" }),
      ];
      const { output } = await run(
        renderCall({ target: "chat", operations: ops }),
        { generativeUI: forged },
      );
      expect(toolResult(output)).toMatchObject({
        status: "rendered",
        applied: 2,
        rejected: [],
      });
    });

    it("drops a target description that is not a string", async () => {
      const forged = {
        catalogId: "shop",
        components: {},
        targets: [{ id: "recommendations", kind: "inline", description: 5 }],
      };
      const { input } = await run([], { generativeUI: forged });
      expect(guideText(input)).toContain(
        '### Targets\n- "recommendations" (a named area of the app)\n\n',
      );
    });

    it("passes the run through unchanged when catalogId is not a string", async () => {
      const { output, input } = await run([], {
        generativeUI: { catalogId: 1 },
      });
      expect(input.tools).toEqual([]);
      expect(input.context).toEqual([]);
      expect(output.map((e) => e.type)).toEqual([
        EventType.RUN_STARTED,
        EventType.RUN_FINISHED,
      ]);
    });
  });

  it("reports a user event to the model as a synthetic tool call", async () => {
    const event = {
      name: "show_more",
      surfaceId: "recs",
      componentId: "c1",
      context: { productId: "p1" },
    };
    const { input } = await run([], {
      generativeUI: manifest,
      generativeUIAction: event,
    });
    const [assistant, tool] = input.messages.slice(-2);
    if (assistant.role !== "assistant" || tool.role !== "tool") {
      throw new Error("expected an assistant tool call and then its result");
    }
    const [call] = assistant.toolCalls ?? [];
    expect(call.function).toEqual({
      name: "log_generative_ui_event",
      arguments: JSON.stringify(event),
    });
    expect(tool.toolCallId).toBe(call.id);
    expect(tool.content).toContain('"show_more"');
  });
});
