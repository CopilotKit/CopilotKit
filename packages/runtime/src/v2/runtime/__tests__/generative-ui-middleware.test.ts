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
import type { CopilotKitUIEnvelope } from "@copilotkit/shared";
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

type Extensions = CopilotKitUIEnvelope["metadata"]["extensions"];
type InlineCatalog = NonNullable<
  CopilotKitUIEnvelope["v1.0"]["inlineCatalogs"]
>[number];

const catalog: InlineCatalog = {
  catalogId: "shop",
  protocolVersion: "1.0",
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
};

const extensions: Extensions = {
  copilotkit_format: 3,
  copilotkit_transport: "tool",
  copilotkit_targets: [
    { id: "chat", kind: "chat" },
    { id: "recommendations", kind: "inline" },
  ],
  copilotkit_surfaces: {},
  copilotkit_contextSent: false,
};

/** A format 3 envelope, with some catalog or extension fields changed. */
function uiEnvelope(
  overrides: {
    catalog?: Partial<InlineCatalog>;
    extensions?: Partial<Extensions>;
  } = {},
): CopilotKitUIEnvelope {
  return {
    "v1.0": {
      supportedCatalogIds: ["shop"],
      inlineCatalogs: [{ ...catalog, ...overrides.catalog }],
    },
    metadata: { extensions: { ...extensions, ...overrides.extensions } },
  };
}

/** The forwardedProps of a run that carries the envelope. */
function uiProps(overrides: Parameters<typeof uiEnvelope>[0] = {}) {
  return { copilotkit: { ui: uiEnvelope(overrides) } };
}

/** The forwardedProps of a run whose envelope lists these surfaces. */
function withSurfaces(surfaces: Extensions["copilotkit_surfaces"]) {
  return uiProps({ extensions: { copilotkit_surfaces: surfaces } });
}

const create = (surfaceId: string) => ({
  version: "v1.0",
  createSurface: { surfaceId, catalogId: "shop" },
});
const components = (surfaceId: string, ...nodes: unknown[]) => ({
  version: "v1.0",
  updateComponents: { surfaceId, components: nodes },
});
const deleteSurface = (surfaceId: string) => ({
  version: "v1.0",
  deleteSurface: { surfaceId },
});
const callFunction = (functionCallId: string, name = "addToCart") => ({
  version: "v1.0",
  callRendererFunction: {
    functionCallId,
    callFunction: { "@call": name, args: { productId: "p1" } },
  },
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
  ];
}

async function run(
  script: BaseEvent[],
  forwardedProps: Record<string, unknown> = uiProps(),
) {
  const agent = new ScriptedAgent([
    { type: EventType.RUN_STARTED, threadId: "t1", runId: "r1" },
    ...script,
    { type: EventType.RUN_FINISHED, threadId: "t1", runId: "r1" },
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

function parseToolResult({ content }: ToolCallResultEvent) {
  if (typeof content !== "string") {
    throw new Error("the render_ui tool result is not a JSON string");
  }
  return JSON.parse(content);
}

function toolResult(output: BaseEvent[]) {
  return parseToolResult(findToolResult(output));
}

/** The parsed results of every render_ui call, in order. */
function toolResults(output: BaseEvent[]) {
  return output
    .filter(
      (e): e is ToolCallResultEvent => e.type === EventType.TOOL_CALL_RESULT,
    )
    .map(parseToolResult);
}

/** The middleware added nothing to the run and changed none of its events. */
function expectPassThrough({ output, input }: Awaited<ReturnType<typeof run>>) {
  expect(input.tools).toEqual([]);
  expect(input.context).toEqual([]);
  expect(output.map((e) => e.type)).toEqual([
    EventType.RUN_STARTED,
    EventType.RUN_FINISHED,
  ]);
}

function guideText(input: RunAgentInput) {
  const guide = input.context.find((c) => c.value.includes("render_ui"));
  if (!guide) throw new Error("the run has no generative UI guide");
  return guide.value;
}

describe("GenerativeUIMiddleware", () => {
  it("passes runs without an envelope through unchanged", async () => {
    expectPassThrough(await run([], {}));
  });

  it("does not read a manifest from the generativeUI prop", async () => {
    const legacyManifest = {
      catalogId: "shop",
      components: catalog.components,
      functions: catalog.functions,
      targets: extensions.copilotkit_targets,
      surfaces: {},
    };
    expectPassThrough(await run([], { generativeUI: legacyManifest }));
  });

  it("adds no render_ui tool for a markdown envelope", async () => {
    expectPassThrough(
      await run(
        [],
        uiProps({ extensions: { copilotkit_transport: "markdown" } }),
      ),
    );
  });

  it("adds no render_ui tool when the tool envelope has no catalog components", async () => {
    // Without components the server cannot validate the operations.
    expectPassThrough(
      await run([], uiProps({ catalog: { components: undefined } })),
    );
  });

  it.each([
    [
      "a component has no props schema",
      {
        ...uiEnvelope(),
        "v1.0": {
          supportedCatalogIds: ["shop"],
          inlineCatalogs: [{ ...catalog, components: { X: {} } }],
        },
      },
    ],
    [
      "the envelope has the format 2 shape",
      {
        method: "a2ui",
        version: "v0.9",
        format: 2,
        transport: "tool",
        catalog: { id: "shop", components: catalog.components },
        functions: catalog.functions,
        targets: extensions.copilotkit_targets,
        surfaces: {},
        contextSent: false,
      },
    ],
  ])("passes the run through when %s", async (_case, malformed) => {
    expectPassThrough(await run([], { copilotkit: { ui: malformed } }));
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

  it("leaves the function, event, and template rules out of the guide when the catalog has none", async () => {
    const { input } = await run(
      [],
      uiProps({
        catalog: {
          components: {
            Card: { props: { type: "object", properties: {} } },
          },
          functions: {},
        },
      }),
    );
    const guide = guideText(input);
    expect(guide).not.toContain("callRendererFunction");
    expect(guide).not.toContain("userMessage");
    expect(guide).not.toContain("@index");
    expect(guide).toContain("Never use a surfaceId again");
  });

  it("keeps the function, event, and template rules when the catalog has them", async () => {
    const { input } = await run([]);
    const guide = guideText(input);
    expect(guide).toContain("callRendererFunction");
    expect(guide).toContain("userMessage");
    expect(guide).toContain("@index");
  });

  it("tells the model to show a different view in a new surface, not an existing one", async () => {
    const { input } = await run(
      [],
      withSurfaces({ cart_surface: { target: "chat" } }),
    );
    const guide = guideText(input);
    // A follow-up such as "checkout" after "show my cart" must not overwrite the cart card.
    expect(guide).toContain(
      "To show a different view, create a new surface with a new surfaceId",
    );
    expect(guide).toContain(
      "Never reuse an earlier chat surface for a different view",
    );
  });

  it("lists the user values and the rejections of an existing surface in the guide", async () => {
    const { input } = await run(
      [],
      withSurfaces({
        cart_surface: { target: "chat" },
        form: {
          target: "chat",
          dataModel: { "/form/email": "me@x.io" },
          rejected: ['operation 2: unknown component "Missing"'],
        },
      }),
    );
    const guide = guideText(input);
    expect(guide).toContain(
      [
        '- "cart_surface" (target "chat")',
        '- "form" (target "chat")',
        '  user values: {"/form/email":"me@x.io"}',
        '  rejected: operation 2: unknown component "Missing"',
      ].join("\n"),
    );
    expect(guide).toContain(
      "Rejected operations were dropped: send them again with the problem fixed.",
    );
  });

  it("cuts long user values in the guide", async () => {
    const { input } = await run(
      [],
      withSurfaces({
        form: { target: "chat", dataModel: { "/a": "x".repeat(600) } },
      }),
    );
    expect(guideText(input).split("\n")).toContain(
      `  user values: {"/a":"${"x".repeat(493)}...`,
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

  it("prints a target description from the envelope in the guide", async () => {
    const { input } = await run(
      [],
      uiProps({
        extensions: {
          copilotkit_targets: [
            { id: "chat", kind: "chat" },
            {
              id: "recommendations",
              kind: "inline",
              description:
                "Next to the product list. Use it for product recommendations.",
            },
          ],
        },
      }),
    );
    expect(guideText(input)).toContain(
      [
        "### Targets",
        '- "chat" (inside the chat transcript)',
        '- "recommendations" (a named area of the app): Next to the product list. Use it for product recommendations.',
      ].join("\n"),
    );
  });

  describe("a target that limits its components", () => {
    const notAllowed = (id: string) =>
      `component "${id}": "ProductCard" is not allowed in target "recommendations"; use one of: ProductGrid`;
    const grid = { id: "root", component: "ProductGrid", children: ["c1"] };
    const productCard = { id: "c1", component: "ProductCard", name: "A" };

    /** An envelope whose "recommendations" target takes only ProductGrid. */
    const limitedProps = (surfaces: Extensions["copilotkit_surfaces"] = {}) =>
      uiProps({
        extensions: {
          copilotkit_targets: [
            { id: "chat", kind: "chat" },
            {
              id: "recommendations",
              kind: "inline",
              description: "Next to the product list.",
              components: ["ProductGrid"],
            },
          ],
          copilotkit_surfaces: surfaces,
        },
      });

    it("lists the components of the target in the guide", async () => {
      const { input } = await run([], limitedProps());
      expect(guideText(input)).toContain(
        '- "recommendations" (a named area of the app; only ProductGrid): Next to the product list.',
      );
    });

    it("accepts a component of the list and rejects another one with the reason", async () => {
      const ops = [
        create("recs"),
        components("recs", grid),
        components("recs", productCard),
      ];
      const { output } = await run(
        renderCall({ target: "recommendations", operations: ops }),
        limitedProps(),
      );
      expect(toolResult(output)).toEqual({
        status: "rendered",
        applied: 2,
        calls: 0,
        rejected: [{ index: 2, reason: notAllowed("c1") }],
      });
    });

    it("rejects a createSurface whose inline components are not in the list", async () => {
      const op = {
        version: "v1.0",
        createSurface: {
          surfaceId: "recs",
          components: [{ ...productCard, id: "root" }],
        },
      };
      const { output } = await run(
        renderCall({ target: "recommendations", operations: [op] }),
        limitedProps(),
      );
      expect(activity(output)).toEqual([]);
      expect(toolResult(output).rejected).toEqual([
        { index: 0, reason: notAllowed("root") },
      ]);
    });

    it("checks an update against the target that the surface was created on", async () => {
      const { output } = await run(
        renderCall({
          target: "chat",
          operations: [components("recs", productCard)],
        }),
        limitedProps({ recs: { target: "recommendations" } }),
      );
      expect(toolResult(output).rejected).toEqual([
        { index: 0, reason: notAllowed("c1") },
      ]);
    });
  });

  it("does not tell the model about app state, even when the client still sends it", async () => {
    const { input } = await run([], {
      copilotkit: { ui: { ...uiEnvelope(), appState: ["cart"] } },
    });
    const guide = guideText(input);
    expect(guide).not.toContain("App state");
    expect(guide).not.toContain("/app");
    // The rules after the removed app state rule are numbered again.
    expect(guide).toContain("\n6. To show a different view");
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
          functionCall: { "@call": "addToCart", args: { productId: "p1" } },
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

  it.each([
    ["no catalogId", { surfaceId: "recs" }],
    ["another catalogId", { surfaceId: "recs", catalogId: "old/catalog@1" }],
  ])(
    "applies a createSurface with %s, with the catalog id of the envelope",
    async (_name, createSurface) => {
      const { output } = await run(
        renderCall({
          target: "recommendations",
          operations: [{ version: "v1.0", createSurface }],
        }),
      );
      const [snapshot] = activity(output);
      expect(snapshot).toMatchObject({
        type: EventType.ACTIVITY_SNAPSHOT,
        content: { operations: [create("recs")] },
      });
      expect(toolResult(output)).toMatchObject({ applied: 1, rejected: [] });
    },
  );

  it("does not ask the model for a catalogId in the guide", async () => {
    const { input } = await run([]);
    const guide = input.context.map((entry) => entry.value).join("\n");
    expect(guide).not.toContain("catalogId");
  });

  it("teaches A2UI v1.0 in the guide", async () => {
    const guide = guideText((await run([])).input);
    expect(guide).not.toContain("v0.9");
    expect(guide).toContain('"version":"v1.0"');
    expect(guide).toContain('{"@path":"/data/path"}');
    expect(guide).toContain('{"@call":"@index"}');
    expect(guide).toContain('"callRendererFunction"');
    expect(guide).toContain('"rendererFunctionResponse"');
  });

  it("keeps the inline data model and components of a createSurface in the snapshot", async () => {
    const op = {
      version: "v1.0",
      createSurface: {
        surfaceId: "recs",
        dataModel: { title: "Picks" },
        components: [{ id: "root", component: "ProductGrid", children: [] }],
      },
    };
    const { output } = await run(
      renderCall({ target: "recommendations", operations: [op] }),
    );
    expect(activity(output)[0]).toMatchObject({
      type: EventType.ACTIVITY_SNAPSHOT,
      content: {
        operations: [
          {
            version: "v1.0",
            createSurface: {
              surfaceId: "recs",
              catalogId: "shop",
              dataModel: { title: "Picks" },
              components: [
                { id: "root", component: "ProductGrid", children: [] },
              ],
            },
          },
        ],
      },
    });
    expect(toolResult(output)).toMatchObject({ applied: 1, rejected: [] });
  });

  it("rejects a v0.9 operation with the v1.0 reason", async () => {
    const op = { version: "v0.9", createSurface: { surfaceId: "recs" } };
    const { output } = await run(
      renderCall({ target: "recommendations", operations: [op] }),
    );
    expect(activity(output)).toEqual([]);
    expect(toolResult(output).rejected).toEqual([
      { index: 0, reason: 'unsupported version "v0.9"; use "v1.0"' },
    ]);
  });

  it.each([
    ["created in this run", {}, [create("recs"), deleteSurface("recs")]],
    [
      "listed in the envelope",
      { recs: { target: "recommendations" } },
      [deleteSurface("recs")],
    ],
  ])(
    "rejects a createSurface after deleteSurface for a surface %s",
    async (_case, surfaces, before) => {
      const { output } = await run(
        renderCall({
          target: "recommendations",
          operations: [...before, create("recs")],
        }),
        withSurfaces(surfaces),
      );
      const snapshots = activity(output).filter(
        (e) => e.type === EventType.ACTIVITY_SNAPSHOT,
      );
      expect(snapshots).toHaveLength(before.length - 1);
      expect(toolResult(output)).toMatchObject({
        applied: before.length,
        rejected: [
          {
            index: before.length,
            reason: 'surface id "recs" was used before; use a new surfaceId',
          },
        ],
      });
    },
  );

  describe("callRendererFunction", () => {
    it("emits one function-call activity and counts it in the tool result", async () => {
      const { output } = await run(
        renderCall({ target: "chat", operations: [callFunction("f1")] }),
      );
      expect(activity(output)).toEqual([
        {
          type: EventType.ACTIVITY_SNAPSHOT,
          messageId: "genui-fn:f1",
          activityType: "generative-ui-function-call",
          content: {
            functionCallId: "f1",
            callFunction: { "@call": "addToCart", args: { productId: "p1" } },
          },
          replace: true,
        },
      ]);
      expect(toolResult(output)).toEqual({
        status: "rendered",
        applied: 0,
        calls: 1,
        rejected: [],
      });
    });

    it("runs a function call when render_ui has no target", async () => {
      const { output } = await run(
        renderCall({ operations: [callFunction("f1"), create("recs")] }),
      );
      expect(activity(output).map((e) => e.messageId)).toEqual(["genui-fn:f1"]);
      expect(toolResult(output)).toMatchObject({
        calls: 1,
        rejected: [
          { index: 1, reason: "render_ui was called without a target" },
        ],
      });
    });

    it("rejects a functionCallId that an earlier render_ui call of the run used", async () => {
      const { output } = await run([
        ...renderCall({ target: "chat", operations: [callFunction("f1")] }),
        ...renderCall(
          { target: "chat", operations: [callFunction("f1")] },
          "call-2",
        ),
      ]);
      expect(activity(output)).toHaveLength(1);
      expect(toolResults(output)[1]).toMatchObject({
        calls: 0,
        rejected: [
          {
            index: 0,
            reason:
              'functionCallId "f1" was used before; use a new functionCallId',
          },
        ],
      });
    });

    it("rejects a function that the client did not declare", async () => {
      const { output } = await run(
        renderCall({
          target: "chat",
          operations: [callFunction("f1", "deleteAccount")],
        }),
      );
      expect(activity(output)).toEqual([]);
      expect(toolResult(output)).toMatchObject({
        calls: 0,
        rejected: [
          {
            index: 0,
            reason: expect.stringContaining(
              'function "deleteAccount" is not exposed to generative UI',
            ),
          },
        ],
      });
    });
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
      withSurfaces({ recs: { target: "recommendations" } }),
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
      withSurfaces({ recs: { target: "recommendations" } }),
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
        calls: 0,
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
        calls: 0,
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
        calls: 0,
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

  it("adds no hidden event messages and no event rule to the guide", async () => {
    // An event that matches no function reaches the agent as a normal user
    // message, so the middleware must not add a synthetic tool call for it.
    const { input } = await run([], {
      ...uiProps(),
      generativeUIAction: {
        name: "show_more",
        surfaceId: "recs",
        componentId: "c1",
        context: {},
      },
    });
    expect(input.messages).toEqual([]);
    expect(guideText(input)).not.toContain("log_generative_ui_event");
  });
});
