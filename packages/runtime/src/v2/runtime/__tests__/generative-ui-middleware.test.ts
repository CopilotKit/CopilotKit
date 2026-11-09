import { AbstractAgent, EventType } from "@ag-ui/client";
import type {
  ActivityDeltaEvent,
  ActivitySnapshotEvent,
  BaseEvent,
  Message,
  RunAgentInput,
  ToolCallResultEvent,
} from "@ag-ui/client";
import {
  EMPTY,
  concat,
  defer,
  firstValueFrom,
  from,
  takeWhile,
  toArray,
} from "rxjs";
import type { Observable } from "rxjs";
import { describe, expect, it } from "vitest";
import {
  GENERATIVE_UI_AGENT_FUNCTION_CALLS,
  GENERATIVE_UI_AGENT_FUNCTION_CALLS_OFF_REASON,
} from "@copilotkit/shared";
import type { CopilotKitUIEnvelope } from "@copilotkit/shared";
import { GenerativeUIMiddleware } from "../generative-ui";
import { MAX_REJECTED_RENDER_RETRIES } from "../generative-ui/generative-ui-middleware";

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
  CopilotKitUIEnvelope["1.0"]["inlineCatalogs"]
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
  functions: {
    addToCart: {
      parameters: { type: "object" },
      allowedCallers: "rendererOrAgent",
    },
  },
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
    "1.0": {
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
  version: "1.0",
  createSurface: { surfaceId, catalogId: "shop" },
});
const components = (surfaceId: string, ...nodes: unknown[]) => ({
  version: "1.0",
  updateComponents: { surfaceId, components: nodes },
});
const deleteSurface = (surfaceId: string) => ({
  version: "1.0",
  deleteSurface: { surfaceId },
});
const callFunction = (functionCallId: string, name = "addToCart") => ({
  version: "1.0",
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
        "1.0": {
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
    // The agent path is off for now: its rules are not in the guide.
    if (GENERATIVE_UI_AGENT_FUNCTION_CALLS) {
      expect(guide).toContain("callRendererFunction");
    } else {
      expect(guide).not.toContain("callRendererFunction");
    }
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
        version: "1.0",
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
    expect(guide).toContain("\n7. To show a different view");
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
          operations: [{ version: "1.0", createSurface }],
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

  it("keeps a catalogId of a base catalog that the envelope lists", async () => {
    const envelope = uiEnvelope();
    envelope["1.0"].supportedCatalogIds = ["shop", "copilotkit/standard@1"];
    const { output } = await run(
      renderCall({
        target: "recommendations",
        operations: [
          {
            version: "1.0",
            createSurface: {
              surfaceId: "recs",
              catalogId: "copilotkit/standard@1",
            },
          },
        ],
      }),
      { copilotkit: { ui: envelope } },
    );
    const [snapshot] = activity(output);
    expect(snapshot).toMatchObject({
      content: {
        catalogId: "copilotkit/standard@1",
        operations: [
          {
            version: "1.0",
            createSurface: {
              surfaceId: "recs",
              catalogId: "copilotkit/standard@1",
            },
          },
        ],
      },
    });
    expect(toolResult(output)).toMatchObject({ applied: 1, rejected: [] });
  });

  it("does not ask the model for a catalogId in the guide", async () => {
    const { input } = await run([]);
    const guide = input.context.map((entry) => entry.value).join("\n");
    expect(guide).not.toContain("catalogId");
  });

  it("teaches A2UI 1.0 in the guide", async () => {
    const guide = guideText((await run([])).input);
    expect(guide).not.toContain("v0.9");
    expect(guide).toContain('"version":"1.0"');
    expect(guide).toContain('{"@path":"/data/path"}');
    expect(guide).toContain('{"@call":"@index"}');
    if (GENERATIVE_UI_AGENT_FUNCTION_CALLS) {
      expect(guide).toContain('"callRendererFunction"');
      expect(guide).toContain('"rendererFunctionResponse"');
    }
  });

  it("keeps the inline data model and components of a createSurface in the snapshot", async () => {
    const op = {
      version: "1.0",
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
            version: "1.0",
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

  it("rejects a v0.9 operation with the 1.0 reason", async () => {
    const op = { version: "v0.9", createSurface: { surfaceId: "recs" } };
    const { output } = await run(
      renderCall({ target: "recommendations", operations: [op] }),
    );
    expect(activity(output)).toEqual([]);
    expect(toolResult(output).rejected).toEqual([
      { index: 0, reason: 'unsupported version "v0.9"; use "1.0"' },
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

  describe("callRendererFunction while the agent path is off", () => {
    it.skipIf(GENERATIVE_UI_AGENT_FUNCTION_CALLS)(
      "rejects the operation with the reason and emits no function-call activity",
      async () => {
        const { output } = await run(
          renderCall({ target: "chat", operations: [callFunction("f1")] }),
        );
        expect(activity(output)).toEqual([]);
        expect(toolResult(output)).toEqual({
          status: "rendered",
          applied: 0,
          calls: 0,
          rejected: [
            { index: 0, reason: GENERATIVE_UI_AGENT_FUNCTION_CALLS_OFF_REASON },
          ],
        });
      },
    );
  });

  describe.skipIf(!GENERATIVE_UI_AGENT_FUNCTION_CALLS)(
    "callRendererFunction",
    () => {
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
        expect(activity(output).map((e) => e.messageId)).toEqual([
          "genui-fn:f1",
        ]);
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
    },
  );

  it("rejects createSurface for a target that is not mounted", async () => {
    const { output } = await run(
      renderCall({ target: "sidebar", operations: [create("x")] }),
    );
    expect(activity(output)).toEqual([]);
    expect(toolResult(output).rejected[0].reason).toMatch(
      /target "sidebar" is not mounted/,
    );
  });

  describe("closed surfaces from the client", () => {
    const update = components("recs", {
      id: "c2",
      component: "ProductCard",
      name: "B",
    });

    it("rejects a createSurface and an update for a surface that an earlier run deleted", async () => {
      const { output } = await run(
        renderCall({
          target: "recommendations",
          operations: [create("recs"), update],
        }),
        withSurfaces({
          recs: { target: "recommendations", status: "deleted" },
        }),
      );
      expect(activity(output)).toEqual([]);
      expect(toolResult(output).rejected).toEqual([
        {
          index: 0,
          reason: 'surface id "recs" was used before; use a new surfaceId',
        },
        { index: 1, reason: expect.stringMatching(/does not exist/) },
      ]);
    });

    it("accepts a corrected createSurface for a surface whose create failed", async () => {
      const { output } = await run(
        renderCall({ target: "recommendations", operations: [create("recs")] }),
        withSurfaces({
          recs: {
            target: "recommendations",
            status: "failed",
            rejected: ['operation 0: component "c1": price is required'],
          },
        }),
      );
      expect(toolResult(output)).toMatchObject({ applied: 1, rejected: [] });
      expect(activity(output)[0].type).toBe(EventType.ACTIVITY_SNAPSHOT);
    });

    it("tells the model in the guide which ids are deleted or not created", async () => {
      const { input } = await run(
        [],
        withSurfaces({
          old: { target: "recommendations", status: "deleted" },
          bad: { target: "recommendations", status: "failed" },
        }),
      );
      const lines = guideText(input).split("\n");
      expect(lines).toContain(
        '- "old" (target "recommendations", deleted: never use this id again)',
      );
      expect(lines).toContain(
        '- "bad" (target "recommendations", not created: send a corrected createSurface with this id)',
      );
    });
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

describe("GenerativeUIMiddleware: fully rejected render_ui", () => {
  const badCall = () =>
    renderCall({
      target: "chat",
      operations: [{ createSurface: { surfaceId: "s1", catalogId: "shop" } }],
    });

  /** Real agents emit fresh ids every turn: suffix each id with the turn. */
  const withTurnIds = (e: BaseEvent, i: number) => {
    const keys = ["toolCallId", "parentMessageId"];
    if (String(e.type).startsWith("TEXT_MESSAGE")) keys.push("messageId");
    const ids: Record<string, string> = {};
    for (const key of keys) {
      const value = (e as unknown as Record<string, unknown>)[key];
      if (typeof value === "string") ids[key] = `${value}-t${i}`;
    }
    return { ...e, ...ids } as BaseEvent;
  };

  async function runTurns(
    turns: BaseEvent[][],
    {
      options,
      finish,
      input,
      stopAfter,
      onTurnStart,
      onTurnEnd,
    }: {
      /** Defaults to the runtime's retry count. */
      options?: { maxRejectedRetries?: number };
      finish?: Record<string, unknown>;
      input?: Partial<RunAgentInput>;
      stopAfter?: EventType;
      /** Runs when the agent starts the turn, before its events stream. */
      onTurnStart?: (turn: number, middleware: GenerativeUIMiddleware) => void;
      /** Runs once the turn's stream has completed, before the next turn. */
      onTurnEnd?: (turn: number, middleware: GenerativeUIMiddleware) => void;
    } = {},
  ) {
    const inputs: RunAgentInput[] = [];
    let turn = 0;
    const middleware = new GenerativeUIMiddleware(
      options ?? { maxRejectedRetries: MAX_REJECTED_RENDER_RETRIES },
    );
    class TurnAgent extends AbstractAgent {
      run(turnInput: RunAgentInput): Observable<BaseEvent> {
        inputs.push(turnInput);
        const i = turn++;
        onTurnStart?.(i, middleware);
        const script = turns[Math.min(i, turns.length - 1)];
        const { runId } = turnInput;
        const failed = script.some((e) => e.type === EventType.RUN_ERROR);
        return concat(
          from([
            { type: EventType.RUN_STARTED, threadId: "t1", runId },
            ...script.map((e) => withTurnIds(e, i)),
            ...(failed
              ? []
              : [
                  {
                    type: EventType.RUN_FINISHED,
                    threadId: "t1",
                    runId,
                    ...finish,
                  },
                ]),
          ] as BaseEvent[]),
          defer(() => {
            onTurnEnd?.(i, middleware);
            return EMPTY;
          }),
        );
      }
    }
    const runInput: RunAgentInput = {
      threadId: "t1",
      runId: "r1",
      state: {},
      messages: [
        { id: "u1", role: "user", content: "show me the shop" },
      ] as Message[],
      tools: [],
      context: [],
      forwardedProps: uiProps(),
      ...input,
    };
    const agent = new TurnAgent();
    agent.setMessages(runInput.messages);
    const events = middleware.run(runInput, agent);
    const output = await firstValueFrom(
      (stopAfter
        ? events.pipe(takeWhile((e) => e.type !== stopAfter, true))
        : events
      ).pipe(toArray()),
    );
    return { output, inputs };
  }

  it("gives the agent another turn that sees the rejection", async () => {
    const { output, inputs } = await runTurns([
      badCall(),
      [
        {
          type: EventType.TEXT_MESSAGE_START,
          messageId: "m2",
          role: "assistant",
        },
        {
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: "m2",
          delta: "fixed",
        },
        { type: EventType.TEXT_MESSAGE_END, messageId: "m2" },
      ] as BaseEvent[],
    ]);
    expect(inputs).toHaveLength(2);
    const tool = inputs[1].messages.find((m) => m.role === "tool");
    expect(tool?.content).toContain("rejected");
    expect(tool?.content).not.toContain('"rejected":[]');
    const assistant = inputs[1].messages.find((m) => m.role === "assistant");
    expect(
      (assistant as { toolCalls?: Array<{ id: string }> }).toolCalls?.[0].id,
    ).toBe((tool as { toolCallId: string }).toolCallId);
    const types = output.map((e) => e.type);
    expect(types.filter((t) => t === EventType.RUN_STARTED)).toHaveLength(1);
    expect(types.filter((t) => t === EventType.RUN_FINISHED)).toHaveLength(1);
    expect(types.at(-1)).toBe(EventType.RUN_FINISHED);
  });

  it("stops retrying after repeated rejections", async () => {
    const { output, inputs } = await runTurns([badCall()]);
    expect(inputs).toHaveLength(3);
    expect(
      output.filter((e) => e.type === EventType.RUN_FINISHED),
    ).toHaveLength(1);
  });

  it("does not retry when another tool call is waiting for the client", async () => {
    const { inputs } = await runTurns([
      [
        ...badCall(),
        {
          type: EventType.TOOL_CALL_START,
          toolCallId: "frontend-1",
          toolCallName: "frontendTool",
          parentMessageId: "msg-1",
        },
        {
          type: EventType.TOOL_CALL_ARGS,
          toolCallId: "frontend-1",
          delta: "{}",
        },
        { type: EventType.TOOL_CALL_END, toolCallId: "frontend-1" },
      ] as BaseEvent[],
    ]);
    expect(inputs).toHaveLength(1);
  });

  it("does not retry when some operations were accepted", async () => {
    const { inputs } = await runTurns([
      renderCall({
        target: "chat",
        operations: [
          create("s1"),
          { createSurface: { surfaceId: "s2", catalogId: "shop" } },
        ],
      }),
    ]);
    expect(inputs).toHaveLength(1);
  });

  it("carries the agent state into the retry turn", async () => {
    const { inputs } = await runTurns([
      [
        { type: EventType.STATE_SNAPSHOT, snapshot: { step: 1 } },
        ...badCall(),
      ] as BaseEvent[],
      [],
    ]);
    expect(inputs[1].state).toEqual({ step: 1 });
  });

  it("carries a null agent state into the retry turn", async () => {
    const { inputs } = await runTurns(
      [
        [
          { type: EventType.STATE_SNAPSHOT, snapshot: null },
          ...badCall(),
        ] as BaseEvent[],
        [],
      ],
      { input: { state: { step: 1 } } },
    );
    expect(inputs).toHaveLength(2);
    expect(inputs[1].state).toBeNull();
  });

  it("keeps a message the agent's snapshot removed out of the retry turn", async () => {
    const { inputs } = await runTurns(
      [
        [
          {
            type: EventType.MESSAGES_SNAPSHOT,
            messages: [{ id: "u1", role: "user", content: "show me the shop" }],
          },
          ...badCall(),
        ] as BaseEvent[],
        [],
      ],
      {
        input: {
          messages: [
            { id: "old", role: "user", content: "compacted away" },
            { id: "u1", role: "user", content: "show me the shop" },
          ] as Message[],
        },
      },
    );
    expect(inputs).toHaveLength(2);
    expect(inputs[1].messages.map((m) => m.id)).not.toContain("old");
    expect(inputs[1].messages[0]).toMatchObject({ id: "u1" });
  });

  it("brings back a message a later snapshot restores", async () => {
    const original = [
      { id: "old", role: "user", content: "compacted away" },
      { id: "u1", role: "user", content: "show me the shop" },
    ];
    const { inputs } = await runTurns(
      [
        [
          { type: EventType.MESSAGES_SNAPSHOT, messages: [original[1]] },
          ...badCall(),
        ] as BaseEvent[],
        [
          { type: EventType.MESSAGES_SNAPSHOT, messages: original },
          ...badCall(),
        ] as BaseEvent[],
        [],
      ],
      { input: { messages: original as Message[] } },
    );
    expect(inputs).toHaveLength(3);
    expect(inputs[1].messages.map((m) => m.id)).not.toContain("old");
    expect(inputs[2].messages.map((m) => m.id)).toContain("old");
  });

  it("keeps a message a snapshot removed out of every later retry turn", async () => {
    const { inputs } = await runTurns(
      [
        [
          {
            type: EventType.MESSAGES_SNAPSHOT,
            messages: [{ id: "u1", role: "user", content: "show me the shop" }],
          },
          ...badCall(),
        ] as BaseEvent[],
        badCall(),
        [],
      ],
      {
        input: {
          messages: [
            { id: "old", role: "user", content: "compacted away" },
            { id: "u1", role: "user", content: "show me the shop" },
          ] as Message[],
        },
      },
    );
    expect(inputs).toHaveLength(3);
    expect(inputs[2].messages.map((m) => m.id)).not.toContain("old");
    expect(inputs[2].messages.filter((m) => m.role === "tool")).toHaveLength(2);
  });

  it("keeps a snapshot's edit to a message in every later retry turn", async () => {
    const { inputs } = await runTurns(
      [
        [
          {
            type: EventType.MESSAGES_SNAPSHOT,
            messages: [{ id: "u1", role: "user", content: "[redacted]" }],
          },
          ...badCall(),
        ] as BaseEvent[],
        badCall(),
        [],
      ],
      {
        input: {
          messages: [
            { id: "u1", role: "user", content: "my card is 4111" },
          ] as Message[],
        },
      },
    );
    expect(inputs).toHaveLength(3);
    expect(inputs[1].messages[0]).toMatchObject({ content: "[redacted]" });
    expect(inputs[2].messages[0]).toMatchObject({ content: "[redacted]" });
    // Each turn's call, then its rejection, in turn order.
    expect(inputs[2].messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
      "tool",
    ]);
  });

  it("keeps a snapshot's edit to a message a later turn adds its call to", async () => {
    // Turn 1's render_ui call has parentMessageId "msg-1-t1" (see withTurnIds).
    const { inputs } = await runTurns(
      [
        [
          {
            type: EventType.MESSAGES_SNAPSHOT,
            messages: [
              { id: "u1", role: "user", content: "show me the shop" },
              { id: "msg-1-t1", role: "assistant", content: "[redacted]" },
            ],
          },
          ...badCall(),
        ] as BaseEvent[],
        badCall(),
        [],
      ],
      {
        input: {
          messages: [
            { id: "u1", role: "user", content: "show me the shop" },
            { id: "msg-1-t1", role: "assistant", content: "my card is 4111" },
          ] as Message[],
        },
      },
    );
    expect(inputs).toHaveLength(3);
    const edited = inputs[2].messages.find((m) => m.id === "msg-1-t1") as {
      content?: string;
      toolCalls?: Array<{ id: string }>;
    };
    expect(edited.content).toBe("[redacted]");
    expect(edited.toolCalls?.map((call) => call.id)).toEqual(["call-1-t1"]);
  });

  it("keeps the text a turn streams into a message a snapshot edited", async () => {
    // withTurnIds turns the text's messageId "a1" into "a1-t1" in turn 1.
    const { inputs } = await runTurns(
      [
        [
          {
            type: EventType.MESSAGES_SNAPSHOT,
            messages: [
              { id: "u1", role: "user", content: "show me the shop" },
              { id: "a1-t1", role: "assistant", content: "[redacted]" },
            ],
          },
          ...badCall(),
        ] as BaseEvent[],
        [
          {
            type: EventType.TEXT_MESSAGE_CONTENT,
            messageId: "a1",
            delta: " more",
          },
          ...badCall(),
        ] as BaseEvent[],
        [],
      ],
      {
        input: {
          messages: [
            { id: "u1", role: "user", content: "show me the shop" },
            { id: "a1-t1", role: "assistant", content: "my card is 4111" },
          ] as Message[],
        },
      },
    );
    expect(inputs).toHaveLength(3);
    expect(inputs[2].messages.find((m) => m.id === "a1-t1")).toMatchObject({
      content: "[redacted] more",
    });
  });

  it("keeps a turn's call on a message a snapshot removed, without its old content", async () => {
    // Turn 1's render_ui call has parentMessageId "msg-1-t1" (see withTurnIds).
    const { inputs } = await runTurns(
      [
        [
          {
            type: EventType.MESSAGES_SNAPSHOT,
            messages: [{ id: "u1", role: "user", content: "show me the shop" }],
          },
          ...badCall(),
        ] as BaseEvent[],
        badCall(),
        badCall(),
        [],
      ],
      {
        options: { maxRejectedRetries: 3 },
        input: {
          messages: [
            { id: "u1", role: "user", content: "show me the shop" },
            { id: "msg-1-t1", role: "assistant", content: "my card is 4111" },
          ] as Message[],
        },
      },
    );
    expect(inputs).toHaveLength(4);
    for (const turn of [2, 3]) {
      const messages = inputs[turn].messages;
      const recreated = messages.find((m) => m.id === "msg-1-t1") as {
        content?: string;
        toolCalls?: Array<{ id: string }>;
      };
      expect(recreated.content).toBeUndefined();
      expect(recreated.toolCalls?.map((call) => call.id)).toEqual([
        "call-1-t1",
      ]);
      // Every rejection result follows its call.
      const callIds = new Set(
        messages
          .flatMap(
            (m) => (m as { toolCalls?: Array<{ id: string }> }).toolCalls ?? [],
          )
          .map((call) => call.id),
      );
      for (const result of messages.filter((m) => m.role === "tool"))
        expect(callIds).toContain(
          (result as { toolCallId: string }).toolCallId,
        );
    }
  });

  it("keeps the text a turn streams into a message a snapshot removed, without its old content", async () => {
    // withTurnIds turns the text's messageId "a1" into "a1-t1" in turn 1.
    const { inputs } = await runTurns(
      [
        [
          {
            type: EventType.MESSAGES_SNAPSHOT,
            messages: [{ id: "u1", role: "user", content: "show me the shop" }],
          },
          ...badCall(),
        ] as BaseEvent[],
        [
          {
            type: EventType.TEXT_MESSAGE_CONTENT,
            messageId: "a1",
            delta: " more",
          },
          ...badCall(),
        ] as BaseEvent[],
        [],
      ],
      {
        input: {
          messages: [
            { id: "u1", role: "user", content: "show me the shop" },
            { id: "a1-t1", role: "assistant", content: "my card is 4111" },
          ] as Message[],
        },
      },
    );
    expect(inputs).toHaveLength(3);
    expect(inputs[2].messages.find((m) => m.id === "a1-t1")).toEqual({
      id: "a1-t1",
      role: "assistant",
      content: " more",
    });
  });

  it("can turn the retry off", async () => {
    const { inputs } = await runTurns([badCall()], {
      options: { maxRejectedRetries: 0 },
    });
    expect(inputs).toHaveLength(1);
  });

  it("does not retry unless the runtime turns retries on", async () => {
    const { output, inputs } = await runTurns([badCall(), []], {
      options: {},
    });
    expect(inputs).toHaveLength(1);
    expect(output.at(-1)).toMatchObject({
      type: EventType.RUN_FINISHED,
      runId: "r1",
    });
  });

  it("retries when operations is not an array", async () => {
    const { inputs } = await runTurns([
      renderCall({ target: "chat", operations: "nope" }),
      [],
    ]);
    expect(inputs).toHaveLength(2);
  });

  it("does not retry over an interrupt finish", async () => {
    const { inputs } = await runTurns([badCall()], {
      finish: { outcome: { type: "interrupt", interrupts: [] } },
    });
    expect(inputs).toHaveLength(1);
  });

  it("keeps the conversation history in the retry turn", async () => {
    const { inputs } = await runTurns([badCall()]);
    for (const input of [inputs[1], inputs[2]]) {
      expect(input.messages[0]).toMatchObject({ id: "u1", role: "user" });
      expect(new Set(input.messages.map((m) => m.id)).size).toBe(
        input.messages.length,
      );
    }
    expect(inputs[2].messages.filter((m) => m.role === "tool")).toHaveLength(2);
  });

  it("does not retry when another render_ui call of the turn rendered", async () => {
    const { inputs } = await runTurns([
      [
        ...renderCall({ target: "chat", operations: [create("s1")] }, "good"),
        ...renderCall(
          {
            target: "chat",
            operations: [
              { createSurface: { surfaceId: "s2", catalogId: "shop" } },
            ],
          },
          "bad",
        ),
      ] as BaseEvent[],
    ]);
    expect(inputs).toHaveLength(1);
  });

  it("does not retry when a rendered render_ui call of the turn already has a result", async () => {
    const { inputs } = await runTurns([
      [
        ...renderCall({ target: "chat", operations: [create("s1")] }, "good"),
        {
          type: EventType.TOOL_CALL_RESULT,
          messageId: "result-good",
          toolCallId: "good",
          content: "done",
        },
        ...renderCall(
          {
            target: "chat",
            operations: [
              { createSurface: { surfaceId: "s2", catalogId: "shop" } },
            ],
          },
          "bad",
        ),
      ] as BaseEvent[],
    ]);
    expect(inputs).toHaveLength(1);
  });

  it("retries even when the history holds an unanswered tool call", async () => {
    const { inputs } = await runTurns([badCall(), []], {
      input: {
        messages: [
          { id: "u1", role: "user", content: "show me the shop" },
          {
            id: "a0",
            role: "assistant",
            toolCalls: [
              {
                id: "old-1",
                type: "function",
                function: { name: "frontendTool", arguments: "{}" },
              },
            ],
          },
        ] as Message[],
      },
    });
    expect(inputs).toHaveLength(2);
  });

  it("retries when the turn's call lands on a message id from the history", async () => {
    // Turn 0's render_ui call has parentMessageId "msg-1-t0" (see withTurnIds).
    const { inputs } = await runTurns([badCall(), []], {
      input: {
        messages: [
          { id: "u1", role: "user", content: "show me the shop" },
          { id: "msg-1-t0", role: "assistant", content: "Here is the shop." },
        ] as Message[],
      },
    });
    expect(inputs).toHaveLength(2);
    // The retry history keeps the call the turn added to that message, so its
    // rejection result still follows a call.
    const reused = inputs[1].messages.find((m) => m.id === "msg-1-t0") as {
      toolCalls?: Array<{ id: string }>;
    };
    expect(reused.toolCalls?.map((call) => call.id)).toEqual(["call-1-t0"]);
  });

  it("does not resend resume input on the retry turn", async () => {
    const { inputs } = await runTurns([badCall(), []], {
      input: {
        resume: [{ interruptId: "i1", payload: { ok: true } }],
      } as Partial<RunAgentInput>,
    });
    expect(inputs[0].resume).toHaveLength(1);
    expect(inputs[1].resume).toBeUndefined();
  });

  it("starts no retry turn once the consumer has unsubscribed", async () => {
    const { inputs } = await runTurns([badCall(), []], {
      stopAfter: EventType.TOOL_CALL_RESULT,
    });
    expect(inputs).toHaveLength(1);
  });

  it("gives each retry turn its own runId and reports one outer run", async () => {
    const { output, inputs } = await runTurns([badCall()]);
    const runIds = inputs.map((i) => i.runId);
    expect(runIds[0]).toBe("r1");
    expect(new Set(runIds).size).toBe(3);
    expect(inputs[1].parentRunId).toBe(runIds[0]);
    expect(inputs[2].parentRunId).toBe(runIds[1]);
    const runEvents = output.filter(
      (e) =>
        e.type === EventType.RUN_STARTED || e.type === EventType.RUN_FINISHED,
    );
    expect(
      runEvents.map((e) => [e.type, (e as { runId?: string }).runId]),
    ).toEqual([
      [EventType.RUN_STARTED, "r1"],
      [EventType.RUN_FINISHED, "r1"],
    ]);
  });

  it("forwards a retry turn's RUN_ERROR unchanged", async () => {
    const { output } = await runTurns([
      badCall(),
      [{ type: EventType.RUN_ERROR, message: "boom" }] as BaseEvent[],
    ]);
    const error = output.find((e) => e.type === EventType.RUN_ERROR);
    expect(error).toEqual({ type: EventType.RUN_ERROR, message: "boom" });
    expect(
      output.filter((e) => e.type === EventType.RUN_FINISHED),
    ).toHaveLength(0);
  });

  /** The output with the random result message ids removed, for comparison. */
  const comparable = (events: BaseEvent[]) =>
    events.map((e) =>
      e.type === EventType.TOOL_CALL_RESULT ? { ...e, messageId: "" } : e,
    );

  it("ends the run as before the fix when stopped before the retry", async () => {
    const { output: stopped, inputs } = await runTurns([badCall(), []], {
      onTurnEnd: (_turn, middleware) => middleware.cancelRetries(),
    });
    expect(inputs).toHaveLength(1);
    const { output: noRetry } = await runTurns([badCall()], {
      options: { maxRejectedRetries: 0 },
    });
    expect(comparable(stopped)).toEqual(comparable(noRetry));
    expect(stopped.at(-1)).toMatchObject({
      type: EventType.RUN_FINISHED,
      runId: "r1",
    });
  });

  it("starts no further retry when stopped during a retry turn", async () => {
    const { output, inputs } = await runTurns([badCall()], {
      onTurnStart: (turn, middleware) => {
        if (turn === 1) middleware.cancelRetries();
      },
    });
    expect(inputs).toHaveLength(2);
    const finishes = output.filter((e) => e.type === EventType.RUN_FINISHED);
    expect(finishes).toHaveLength(1);
    expect(output.at(-1)).toMatchObject({
      type: EventType.RUN_FINISHED,
      runId: "r1",
    });
  });

  it("rejects an invalid maxRejectedRetries", () => {
    for (const n of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        () => new GenerativeUIMiddleware({ maxRejectedRetries: n }),
      ).toThrow(RangeError);
    }
  });
});
