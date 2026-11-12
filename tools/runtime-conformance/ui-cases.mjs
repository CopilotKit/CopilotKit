import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";

const SCHEMA_DESCRIPTION =
  "A2UI Component Schema — available components for generating UI surfaces. Use these component names and properties when creating A2UI operations.";
const BASIC_CATALOG = "https://a2ui.org/specification/v0_9/basic_catalog.json";
const schema = {
  components: {
    Column: { required: ["children"] },
    Text: { required: ["text"] },
  },
};

/** Create complete input without depending on a language's native model class. */
function input(extra = {}) {
  return {
    threadId: randomUUID(),
    runId: randomUUID(),
    messages: [{ id: randomUUID(), role: "user", content: "Show a card" }],
    tools: [],
    context: [],
    state: {},
    forwardedProps: {},
    ...extra,
  };
}

/** Script an AG-UI tool stream with visible chunk boundaries. */
function toolStream(name, chunks, toolCallId = "render-call") {
  return (request) => [
    { type: "RUN_STARTED", threadId: request.threadId, runId: request.runId },
    {
      type: "TOOL_CALL_START",
      toolCallId,
      toolCallName: name,
      parentMessageId: "assistant-message",
    },
    ...chunks.map((delta) => ({ type: "TOOL_CALL_ARGS", toolCallId, delta })),
    { type: "TOOL_CALL_END", toolCallId },
    { type: "RUN_FINISHED", threadId: request.threadId, runId: request.runId },
  ];
}

/** Await durable middleware output, not the immediate JSON run response. */
async function runAndWait(context, body = input()) {
  assert.equal(
    (await context.request("POST", "/agent/default/run", body)).status,
    200,
  );
  await context.platform.waitFor(
    () =>
      context.platform.events.some(
        (event) =>
          event.runId === body.runId &&
          ["RUN_FINISHED", "RUN_ERROR"].includes(event.type),
      ),
    10000,
  );
  return context.platform.events.filter((event) => event.runId === body.runId);
}

/** Point every driver at the same authenticated AIMock MCP server. */
function mcpConfiguration(platform) {
  return {
    mcpApps: {
      servers: [
        {
          type: "http",
          url: platform.mcpUrl,
          serverId: "cards",
          headers: { "x-fixture-auth": "mcp-fixture-token" },
        },
      ],
    },
  };
}

/** Generative UI (A2UI 1.0) and the A2UI v0.9 agents that the runtime converts for it. */
const SURFACE_ACTIVITY = "generative-ui-surface";
const V09_SURFACE_ACTIVITY = "a2ui-surface";
const STANDARD_CATALOG = "copilotkit/standard@1";
const RENDER_UI = "render_ui";
const RENDER_A2UI = "render_a2ui";
const GENERATIVE_UI_GUIDE =
  "Generative UI guide: available components, functions, targets, and how to call render_ui.";
const V09_TOOL_GUIDE = (name) =>
  `A2UI render tool usage guide — how to call ${name} with valid arguments.`;

/** A 1.0 component manifest, as the client describes an app component. */
const productCard = {
  description: "A product",
  props: {
    type: "object",
    properties: { name: { type: "string" } },
    required: ["name"],
  },
};

/**
 * The `forwardedProps` of a run from the 1.0 client: a "tool" envelope with
 * one inline catalog, and the click that started the run when there is one.
 */
function envelope({ action, catalogId = "shop" } = {}) {
  return {
    copilotkit: {
      ui: {
        "1.0": {
          supportedCatalogIds: [catalogId],
          inlineCatalogs: [
            {
              catalogId,
              protocolVersion: "1.0",
              components: { ProductCard: productCard },
              functions: {},
            },
          ],
        },
        metadata: {
          extensions: {
            copilotkit_format: 3,
            copilotkit_transport: "tool",
            copilotkit_targets: [{ id: "chat", kind: "chat" }],
            copilotkit_surfaces: {},
            copilotkit_contextSent: false,
            ...(action ? { copilotkit_action: action } : {}),
          },
        },
      },
    },
  };
}

/** A 1.0 click, as the client sends it in `copilotkit_action`. */
function clickAction(surfaceId = "card") {
  return {
    version: "1.0",
    action: {
      name: "confirm",
      surfaceId,
      sourceComponentId: "button",
      timestamp: "2026-10-20T10:00:00.000Z",
      userMessage: "Confirm",
      context: { selected: 2 },
    },
  };
}

/** The surface snapshots a browser receives, in order. */
function surfaceSnapshots(events) {
  return events.filter(
    (event) =>
      event.type === "ACTIVITY_SNAPSHOT" &&
      event.activityType === SURFACE_ACTIVITY,
  );
}

/** Every operation of the surface snapshots, in order. */
function surfaceOperations(events) {
  return surfaceSnapshots(events).flatMap((event) => event.content.operations);
}

/** A v0.9 surface must reach the browser only as a 1.0 surface. */
function assertNoV09Activity(events) {
  assert.equal(
    events.some((event) => event.activityType === V09_SURFACE_ACTIVITY),
    false,
    "An A2UI v0.9 activity reached the browser; it must be converted to 1.0",
  );
}

/** The tool names of the first agent input. */
function toolNames(context) {
  return context.platform.agentInputs[0].tools.map((tool) => tool.name);
}

/** Script several tool calls in one run, each with visible chunk boundaries. */
function toolCallsStream(calls) {
  return (request) => [
    { type: "RUN_STARTED", threadId: request.threadId, runId: request.runId },
    ...calls.flatMap(({ name, chunks, toolCallId }) => [
      {
        type: "TOOL_CALL_START",
        toolCallId,
        toolCallName: name,
        parentMessageId: "assistant-message",
      },
      ...chunks.map((delta) => ({ type: "TOOL_CALL_ARGS", toolCallId, delta })),
      { type: "TOOL_CALL_END", toolCallId },
    ]),
    { type: "RUN_FINISHED", threadId: request.threadId, runId: request.runId },
  ];
}

/** Script a backend tool whose result carries A2UI operations. */
function toolResultStream(operations) {
  return (request) => [
    { type: "RUN_STARTED", threadId: request.threadId, runId: request.runId },
    {
      type: "TOOL_CALL_START",
      toolCallId: "search-call",
      toolCallName: "search_plans",
      parentMessageId: "assistant-message",
    },
    { type: "TOOL_CALL_ARGS", toolCallId: "search-call", delta: "{}" },
    { type: "TOOL_CALL_END", toolCallId: "search-call" },
    {
      type: "TOOL_CALL_RESULT",
      messageId: "search-result",
      toolCallId: "search-call",
      content: JSON.stringify({ a2ui_operations: operations }),
    },
    { type: "RUN_FINISHED", threadId: request.threadId, runId: request.runId },
  ];
}

/** A run with no output, for cases that check the agent input only. */
function emptyStream(request) {
  return [
    { type: "RUN_STARTED", threadId: request.threadId, runId: request.runId },
    { type: "RUN_FINISHED", threadId: request.threadId, runId: request.runId },
  ];
}

/** A v0.9 surface with a binding, the basic catalog, and a Button action. */
const v09PlanOperations = [
  {
    version: "v0.9",
    createSurface: { surfaceId: "plans", catalogId: BASIC_CATALOG },
  },
  {
    version: "v0.9",
    updateComponents: {
      surfaceId: "plans",
      components: [
        { id: "root", component: "Column", children: ["title", "choose"] },
        { id: "title", component: "Text", text: { path: "/title" } },
        {
          id: "choose",
          component: "Button",
          child: "choose-label",
          action: {
            event: { name: "choose", context: { plan: { path: "/plan" } } },
          },
        },
        { id: "choose-label", component: "Text", text: "Choose" },
      ],
    },
  },
  {
    version: "v0.9",
    updateDataModel: {
      surfaceId: "plans",
      path: "/",
      value: { title: "Plans", plan: "team" },
    },
  },
];

/** The 1.0 operations of `v09PlanOperations`. */
const convertedPlanOperations = [
  {
    version: "1.0",
    createSurface: { surfaceId: "plans", catalogId: STANDARD_CATALOG },
  },
  {
    version: "1.0",
    updateComponents: {
      surfaceId: "plans",
      components: [
        { id: "root", component: "Column", children: ["title", "choose"] },
        { id: "title", component: "Text", text: { "@path": "/title" } },
        {
          id: "choose",
          component: "Button",
          child: "choose-label",
          onClick: {
            event: { name: "choose", context: { plan: { "@path": "/plan" } } },
          },
        },
        { id: "choose-label", component: "Text", text: "Choose" },
      ],
    },
  },
  {
    version: "1.0",
    updateDataModel: {
      surfaceId: "plans",
      path: "/",
      value: { title: "Plans", plan: "team" },
    },
  },
];

const V10_BASIC_CATALOG =
  "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json";

/**
 * Native A2UI 1.0 operations on the A2UI path, as an ADK agent sends them:
 * the ADK fixture of #8353 (ag-ui #3374, `test_a2ui_protocol_versions.py`
 * `_ops`), then basic catalog components, then a v0.9 operation, which the
 * 1.0 surface rejects.
 */
const nativeV10Operations = [
  {
    version: "1.0",
    createSurface: { surfaceId: "s", catalogId: V10_BASIC_CATALOG },
  },
  {
    version: "1.0",
    updateComponents: {
      surfaceId: "s",
      components: [{ id: "root", component: "Text", text: "Hello" }],
    },
  },
  {
    version: "1.0",
    updateDataModel: { surfaceId: "s", path: "/", value: {} },
  },
  {
    version: "1.0",
    updateComponents: {
      surfaceId: "s",
      components: [
        { id: "root", component: "Column", children: ["title", "save"] },
        { id: "title", component: "Text", variant: "h2", text: "Profile" },
        {
          id: "save",
          component: "Button",
          child: "save-label",
          action: {
            event: { name: "save", context: { name: { "@path": "/name" } } },
          },
        },
        { id: "save-label", component: "Text", text: "Save" },
      ],
    },
  },
  {
    version: "v0.9",
    updateDataModel: { surfaceId: "s", path: "/name", value: "Ada" },
  },
];

/** What the client gets for `nativeV10Operations`. */
const passedNativeV10Operations = [
  {
    version: "1.0",
    createSurface: { surfaceId: "s", catalogId: STANDARD_CATALOG },
  },
  nativeV10Operations[1],
  nativeV10Operations[2],
  {
    version: "1.0",
    updateComponents: {
      surfaceId: "s",
      components: [
        { id: "root", component: "Column", children: ["title", "save"] },
        { id: "title", component: "Title", text: "Profile", size: "xl" },
        {
          id: "save",
          component: "Button",
          child: "save-label",
          onClick: {
            event: { name: "save", context: { name: { "@path": "/name" } } },
          },
        },
        { id: "save-label", component: "Text", text: "Save" },
      ],
    },
  },
];

/** Assert the one converted surface of `v09PlanOperations`. */
function assertConvertedPlanSurface(events) {
  assertNoV09Activity(events);
  const snapshots = surfaceSnapshots(events);
  assert.equal(snapshots.length, 1, "Expected one converted surface snapshot");
  const [snapshot] = snapshots;
  assert.equal(snapshot.messageId, "genui:plans");
  assert.equal(snapshot.replace, true);
  assert.deepEqual(snapshot.content, {
    surfaceId: "plans",
    target: "chat",
    catalogId: STANDARD_CATALOG,
    operations: convertedPlanOperations,
    status: "ready",
    rejected: [],
    a2uiSourceVersion: "0.9",
  });
  assert.ok(
    events.indexOf(snapshot) <
      events.findIndex((event) => event.type === "RUN_FINISHED"),
  );
}

/** The v0.9 `userAction` of `clickAction()`, as a v0.9 agent gets it. */
const clickUserAction = {
  name: "confirm",
  surfaceId: "card",
  sourceComponentId: "button",
  context: { selected: 2 },
  timestamp: "2026-10-20T10:00:00.000Z",
};

/**
 * Assert the click history of a v0.9 agent: the click of `clickAction()`
 * once, at the end of the conversation. A driver that announces
 * `expectedA2uiActionHistory: "private-user-json"` (TypeScript, whose
 * `@ag-ui/a2ui-middleware` 0.0.15 sends the action as private user JSON)
 * must give one `A2UI user action:` user message and no `log_a2ui_event`
 * call. The other drivers keep the `log_a2ui_event` tool call and result.
 */
function assertA2UIActionHistory(context, messages) {
  if (context.expectedA2uiActionHistory === "private-user-json") {
    const actionPrefix = "A2UI user action:\n";
    const actionMessages = messages.filter(
      (message) =>
        message.role === "user" &&
        typeof message.content === "string" &&
        message.content.startsWith(actionPrefix),
    );
    assert.equal(actionMessages.length, 1);
    assert.equal(messages.at(-1), actionMessages[0]);
    assert.deepEqual(
      JSON.parse(actionMessages[0].content.slice(actionPrefix.length)),
      clickUserAction,
    );
    assert.ok(
      !messages.some((message) =>
        message.toolCalls?.some(
          (call) => call.function.name === "log_a2ui_event",
        ),
      ),
    );
    return;
  }
  assert.equal(context.expectedA2uiActionHistory, undefined);
  const [call, result] = messages.slice(-2);
  assert.equal(call.role, "assistant");
  assert.equal(call.toolCalls[0].function.name, "log_a2ui_event");
  assert.deepEqual(
    JSON.parse(call.toolCalls[0].function.arguments),
    clickUserAction,
  );
  assert.equal(result.role, "tool");
  assert.equal(result.toolCallId, call.toolCalls[0].id);
  assert.equal(
    result.content,
    'User performed action "confirm" on surface "card" (component: button). Context: {"selected":2}',
  );
}

const validCard = [
  { id: "root", component: "Column", children: ["text"] },
  { id: "text", component: "Text", text: "Hello" },
];

const a2uiCases = [
  {
    id: "a2ui.late-identifiers-preserve-painted-surface",
    configuration: {
      generativeUI: { a2uiVersion: "0.9", injectA2UITool: true, schema },
    },
    async run(context) {
      context.platform.faults.agentChunkDelayMs = 15;
      context.platform.faults.agentEvents = toolStream(RENDER_A2UI, [
        '{"components":[{"id":"root","component":"Column","children":["text"]},{"id":"text","component":"Text","text":"Hello"}]',
        ',"surfaceId":"late-surface"',
        ',"catalogId":"late-catalog","data":{"items":[{"name":"one"},',
        '{"name":"two"}]}}',
      ]);
      const events = await runAndWait(context);
      assertNoV09Activity(events);
      const snapshots = surfaceSnapshots(events);
      assert.ok(
        snapshots.length >= 2,
        "Complete components and progressive data must produce snapshots",
      );
      assert.ok(
        snapshots.every((event) => event.messageId === "genui:late-surface"),
        "A late surfaceId must not move the painted surface",
      );
      const operations = surfaceOperations(events);
      const created = operations
        .filter((operation) => operation.createSurface)
        .map((operation) => operation.createSurface);
      assert.equal(
        new Set(created.map((surface) => surface.surfaceId)).size,
        1,
        "A late surfaceId must not replace a painted surface",
      );
      assert.equal(
        new Set(created.map((surface) => surface.catalogId)).size,
        1,
        "A late catalogId must not replace a painted catalog",
      );
      assert.equal(
        new Set(snapshots.map((event) => event.content.catalogId)).size,
        1,
        "A late catalogId must not replace a painted catalog",
      );
      const updates = operations
        .filter((operation) => operation.updateDataModel)
        .map((operation) => operation.updateDataModel);
      assert.ok(
        updates.length >= 2,
        "Data must still stream after late identifiers",
      );
      assert.ok(
        updates.every((update) => update.surfaceId === created[0].surfaceId),
      );
      assert.equal(updates.at(-1).value.items.length, 2);
    },
  },
  ...[
    ["self-cycle", [{ id: "root", component: "Column", children: ["root"] }]],
    [
      "two-node-cycle",
      [
        { id: "root", component: "Column", children: ["child"] },
        { id: "child", component: "Column", children: ["root"] },
      ],
    ],
    [
      "duplicate-id",
      [
        { id: "root", component: "Text", text: "One" },
        { id: "root", component: "Text", text: "Two" },
      ],
    ],
  ].map(([name, components]) => ({
    id: `a2ui.reject-${name}`,
    configuration: {
      generativeUI: { a2uiVersion: "0.9", injectA2UITool: true, schema },
    },
    async run(context) {
      // The first call is invalid. The model retries in the same run.
      context.platform.faults.agentEvents = toolCallsStream([
        {
          name: RENDER_A2UI,
          toolCallId: "render-call",
          chunks: [JSON.stringify({ surfaceId: "card", components })],
        },
        {
          name: RENDER_A2UI,
          toolCallId: "render-retry",
          chunks: [
            JSON.stringify({ surfaceId: "card", components: validCard }),
          ],
        },
      ]);
      const events = await runAndWait(context);
      assertNoV09Activity(events);
      const painted = surfaceOperations(events)
        .filter((operation) => operation.updateComponents)
        .map((operation) => operation.updateComponents.components);
      assert.ok(painted.length > 0, "The valid retry must paint the surface");
      for (const tree of painted) {
        assert.deepEqual(
          tree,
          validCard,
          "Invalid component tree reached the browser",
        );
      }
    },
  })),
  {
    id: "a2ui.recovery-exhausted-shows-an-error-surface",
    configuration: {
      generativeUI: { a2uiVersion: "0.9", injectA2UITool: true, schema },
    },
    async run(context) {
      // An agent's A2UI tool gave up after its retries. The A2UI middleware
      // sends a `failed` lifecycle snapshot, which names no surface.
      context.platform.faults.agentEvents = (request) => [
        {
          type: "RUN_STARTED",
          threadId: request.threadId,
          runId: request.runId,
        },
        {
          type: "TOOL_CALL_START",
          toolCallId: "generate-call",
          toolCallName: "generate_a2ui",
          parentMessageId: "assistant-message",
        },
        { type: "TOOL_CALL_ARGS", toolCallId: "generate-call", delta: "{}" },
        { type: "TOOL_CALL_END", toolCallId: "generate-call" },
        {
          type: "TOOL_CALL_RESULT",
          messageId: "generate-result",
          toolCallId: "generate-call",
          content: JSON.stringify({
            code: "a2ui_recovery_exhausted",
            error: "root is missing",
            attempts: [{ attempt: 1 }, { attempt: 2 }, { attempt: 3 }],
          }),
        },
        {
          type: "RUN_FINISHED",
          threadId: request.threadId,
          runId: request.runId,
        },
      ];
      const events = await runAndWait(context);
      assertNoV09Activity(events);
      const failures = surfaceSnapshots(events).filter(
        (event) => event.content.status === "error",
      );
      assert.equal(
        failures.length,
        1,
        "The failure must reach the browser once",
      );
      const [failure] = failures;
      assert.equal(failure.messageId, `genui:${failure.content.surfaceId}`);
      assert.equal(failure.content.target, "chat");
      assert.deepEqual(failure.content.operations, []);
      assert.deepEqual(failure.content.rejected, [
        { index: 0, reason: "root is missing" },
      ]);
      assert.equal(failure.content.a2uiSourceVersion, "0.9");
    },
  },
  {
    id: "a2ui.custom-tool-included-agent",
    configuration: {
      generativeUI: {
        a2uiVersion: "0.9",
        injectA2UITool: "custom_render",
        agents: ["default"],
      },
    },
    async run(context) {
      context.platform.faults.agentEvents = toolStream("custom_render", [
        '{"surfaceId":"card","components":[{"id":"root","component":"Text","text":"Hello"}]}',
      ]);
      const events = await runAndWait(context);
      const tools = toolNames(context);
      assert.equal(tools.filter((tool) => tool === "custom_render").length, 1);
      assert.equal(tools.includes(RENDER_A2UI), false);
      assert.equal(tools.includes(RENDER_UI), false);
      assertNoV09Activity(events);
      const snapshot = surfaceSnapshots(events).at(-1);
      assert.equal(snapshot?.messageId, "genui:card");
      assert.deepEqual(
        snapshot.content.operations.find((op) => op.updateComponents)
          ?.updateComponents.components,
        [{ id: "root", component: "Text", text: "Hello" }],
      );
    },
  },
  {
    id: "a2ui.atomic-components-and-progressive-data",
    configuration: {
      generativeUI: { a2uiVersion: "0.9", injectA2UITool: true, schema },
    },
    async run(context) {
      const { platform } = context;
      platform.faults.agentChunkDelayMs = 15;
      platform.faults.agentEvents = toolStream(RENDER_A2UI, [
        '{"surfaceId":"card","components":[{"id":"root","component":"Column","children":["text"]},',
        '{"id":"text","component":"Text","text":"Hello"}],"data":{"items":[{"name":"one"},',
        '{"name":"two"}]}}',
      ]);
      const events = await runAndWait(context);
      assert.equal(
        toolNames(context).filter((tool) => tool === RENDER_A2UI).length,
        1,
      );
      assert.ok(
        platform.agentInputs[0].context.some(
          (entry) =>
            entry.description === SCHEMA_DESCRIPTION &&
            entry.value === JSON.stringify(schema),
        ),
        "The configured schema must reach the agent",
      );
      assertNoV09Activity(events);
      const painted = surfaceSnapshots(events);
      assert.ok(painted.length >= 2, "Missing progressive data snapshots");
      for (const activity of painted) {
        assert.equal(activity.messageId, "genui:card");
        assert.equal(activity.replace, true);
        assert.equal(activity.content.surfaceId, "card");
        assert.equal(activity.content.status, "ready");
        assert.equal(activity.content.a2uiSourceVersion, "0.9");
        assert.ok(
          activity.content.operations.every((op) => op.version === "1.0"),
        );
        const components = activity.content.operations.find(
          (op) => op.updateComponents,
        )?.updateComponents.components;
        assert.equal(
          components.length,
          2,
          "Partial component tree was painted",
        );
        assert.equal(
          activity.content.operations[0].createSurface.catalogId,
          STANDARD_CATALOG,
          "The v0.9 basic catalog must become the standard catalog",
        );
        assert.equal(activity.content.catalogId, STANDARD_CATALOG);
      }
      const firstPaintIndex = events.indexOf(painted[0]);
      const firstArgsIndex = events.findIndex(
        (event) => event.type === "TOOL_CALL_ARGS",
      );
      const closedArgsIndex = events.findIndex(
        (event) =>
          event.type === "TOOL_CALL_ARGS" && event.delta.includes('}],"data"'),
      );
      assert.ok(
        firstPaintIndex > firstArgsIndex && firstPaintIndex < closedArgsIndex,
      );
      const sizes = painted.flatMap((event) =>
        event.content.operations
          .filter((op) => op.updateDataModel)
          .map((op) => op.updateDataModel.value.items.length),
      );
      assert.ok(sizes.includes(1) && sizes.includes(2));
      const result = events.find(
        (event) =>
          event.type === "TOOL_CALL_RESULT" &&
          event.toolCallId === "render-call",
      );
      assert.deepEqual(JSON.parse(result.content), { status: "rendered" });
      assert.ok(
        events.indexOf(result) <
          events.findIndex((event) => event.type === "RUN_FINISHED"),
      );
    },
  },
  {
    id: "a2ui.action-history-and-catalog",
    configuration: { generativeUI: { a2uiVersion: "0.9" } },
    async run(context) {
      const catalogId = "https://example.test/catalog";
      // The client's catalog has only `ProductCard`, and a v0.9 render may
      // use only the components of the schema in the agent's context.
      context.platform.faults.agentEvents = toolStream(RENDER_A2UI, [
        '{"surfaceId":"card","components":[{"id":"root","component":"ProductCard","name":"Hello"}]}',
      ]);
      const events = await runAndWait(
        context,
        input({
          messages: [{ id: randomUUID(), role: "user", content: "Confirm" }],
          forwardedProps: envelope({ action: clickAction(), catalogId }),
        }),
      );
      assertA2UIActionHistory(
        context,
        context.platform.agentInputs[0].messages,
      );
      assertNoV09Activity(events);
      const painted = surfaceSnapshots(events).at(-1);
      assert.equal(painted?.content.catalogId, catalogId);
      assert.equal(
        painted.content.operations[0].createSurface.catalogId,
        catalogId,
        "A surface must keep the client's own catalog id",
      );
    },
  },
  {
    id: "a2ui.explicit-disable-wins-over-catalog",
    configuration: { generativeUI: false },
    async run(context) {
      context.platform.faults.agentEvents = toolStream(RENDER_A2UI, [
        '{"surfaceId":"card","components":[{"id":"root","component":"Text","text":"Hello"}]}',
      ]);
      const events = await runAndWait(
        context,
        input({ forwardedProps: envelope() }),
      );
      assert.equal(
        events.filter((event) =>
          [SURFACE_ACTIVITY, V09_SURFACE_ACTIVITY].includes(event.activityType),
        ).length,
        0,
      );
      const tools = toolNames(context);
      assert.equal(tools.includes(RENDER_A2UI), false);
      assert.equal(tools.includes(RENDER_UI), false);
    },
  },
  {
    id: "a2ui.invalid-tree-does-not-paint",
    configuration: {
      generativeUI: { a2uiVersion: "0.9", injectA2UITool: true, schema },
    },
    async run(context) {
      context.platform.faults.agentEvents = toolStream(RENDER_A2UI, [
        '{"surfaceId":"card","components":[{"id":"root","component":"Column","children":["missing"]}]}',
      ]);
      const events = await runAndWait(context);
      assert.ok(
        toolNames(context).includes(RENDER_A2UI),
        "The v0.9 render path must be active",
      );
      assertNoV09Activity(events);
      // A runtime may show that the UI failed: a surface with status
      // "error" and no operations. Nothing of the tree may be painted.
      assert.deepEqual(
        surfaceSnapshots(events).filter(
          (event) =>
            event.content.status !== "error" ||
            event.content.operations.length > 0,
        ),
        [],
        "A tree with an unresolved child was painted",
      );
      assert.equal(
        events.some((event) => event.type === "ACTIVITY_DELTA"),
        false,
      );
    },
  },
  {
    id: "a2ui.custom-tool-and-agent-scope",
    configuration: {
      generativeUI: {
        a2uiVersion: "0.9",
        injectA2UITool: "custom_render",
        agents: ["another-agent"],
      },
    },
    async run(context) {
      const response = await context.request("GET", "/info");
      assert.deepEqual(response.body.generativeUI, {
        enabled: true,
        agents: ["another-agent"],
      });
      context.platform.faults.agentEvents = toolStream("custom_render", [
        '{"surfaceId":"card","components":[{"id":"root","component":"Text","text":"Hello"}]}',
      ]);
      const events = await runAndWait(
        context,
        input({ forwardedProps: envelope() }),
      );
      assert.equal(
        events.some((event) =>
          [SURFACE_ACTIVITY, V09_SURFACE_ACTIVITY].includes(event.activityType),
        ),
        false,
      );
      const tools = toolNames(context);
      assert.equal(tools.includes("custom_render"), false);
      assert.equal(tools.includes(RENDER_UI), false);
    },
  },
  ...[
    ["omitted", undefined],
    ["explicit", { generativeUI: { a2uiVersion: "1.0" } }],
    ["unlisted-in-map", { generativeUI: { a2uiVersion: { other: "0.9" } } }],
  ].map(([label, configuration]) => ({
    id: `generative-ui.a2ui-version.v10-agent-gets-render-ui-${label}`,
    configuration,
    async run(context) {
      context.platform.faults.agentEvents = emptyStream;
      await runAndWait(context, input({ forwardedProps: envelope() }));
      const tools = toolNames(context);
      assert.equal(tools.filter((tool) => tool === RENDER_UI).length, 1);
      assert.equal(tools.includes(RENDER_A2UI), false);
      const descriptions = context.platform.agentInputs[0].context.map(
        (entry) => entry.description,
      );
      assert.ok(descriptions.includes(GENERATIVE_UI_GUIDE));
      assert.equal(
        descriptions.some((description) => description.startsWith("A2UI")),
        false,
        "A 1.0 agent must not get a v0.9 prompt",
      );
    },
  })),
  ...[
    ["single", { a2uiVersion: "0.9" }],
    ["listed-in-map", { a2uiVersion: { default: "0.9" } }],
  ].map(([label, generativeUI]) => ({
    id: `generative-ui.a2ui-version.v09-agent-gets-render-a2ui-${label}`,
    configuration: { generativeUI },
    async run(context) {
      context.platform.faults.agentEvents = emptyStream;
      await runAndWait(context, input({ forwardedProps: envelope() }));
      const tools = toolNames(context);
      assert.equal(tools.filter((tool) => tool === RENDER_A2UI).length, 1);
      assert.equal(tools.includes(RENDER_UI), false);
      const entries = context.platform.agentInputs[0].context;
      const descriptions = entries.map((entry) => entry.description);
      assert.equal(descriptions.includes(GENERATIVE_UI_GUIDE), false);
      assert.ok(descriptions.includes(V09_TOOL_GUIDE(RENDER_A2UI)));
      const schemas = entries.filter(
        (entry) => entry.description === SCHEMA_DESCRIPTION,
      );
      assert.equal(schemas.length, 1, "Expected one v0.9 component schema");
      const catalog = JSON.parse(schemas[0].value);
      assert.equal(catalog.catalogId, "shop");
      assert.deepEqual(
        Object.keys(catalog.components),
        ["ProductCard"],
        "The v0.9 schema must list the client's catalog components",
      );
    },
  })),
  {
    id: "generative-ui.a2ui-version.v09-schema-replaces-client-entry",
    configuration: { generativeUI: { a2uiVersion: "0.9" } },
    async run(context) {
      context.platform.faults.agentEvents = emptyStream;
      await runAndWait(
        context,
        input({
          context: [{ description: SCHEMA_DESCRIPTION, value: "{}" }],
          forwardedProps: envelope(),
        }),
      );
      const schemas = context.platform.agentInputs[0].context.filter(
        (entry) => entry.description === SCHEMA_DESCRIPTION,
      );
      assert.equal(schemas.length, 1, "A stale schema entry was duplicated");
      assert.equal(JSON.parse(schemas[0].value).catalogId, "shop");
    },
  },
  {
    id: "generative-ui.a2ui-version.v09-operations-convert-to-v10",
    configuration: { generativeUI: { a2uiVersion: "0.9" } },
    async run(context) {
      context.platform.faults.agentEvents = toolResultStream(v09PlanOperations);
      const events = await runAndWait(
        context,
        input({ forwardedProps: envelope() }),
      );
      assertConvertedPlanSurface(events);
    },
  },
  {
    id: "generative-ui.a2ui-version.v10-agent-tool-result-converts",
    async run(context) {
      context.platform.faults.agentEvents = toolResultStream(v09PlanOperations);
      const events = await runAndWait(
        context,
        input({ forwardedProps: envelope() }),
      );
      assertConvertedPlanSurface(events);
    },
  },
  {
    id: "generative-ui.a2ui-version.native-v10-operations-pass-through",
    configuration: { generativeUI: { a2uiVersion: "0.9" } },
    async run(context) {
      context.platform.faults.agentEvents =
        toolResultStream(nativeV10Operations);
      const events = await runAndWait(
        context,
        input({ forwardedProps: envelope() }),
      );
      assertNoV09Activity(events);
      const snapshots = surfaceSnapshots(events);
      assert.equal(snapshots.length, 1, "Expected one native surface snapshot");
      const [snapshot] = snapshots;
      assert.equal(snapshot.messageId, "genui:s");
      assert.equal(snapshot.replace, true);
      // No `a2uiSourceVersion`: the surface is 1.0, so a click on it is 1.0.
      assert.deepEqual(snapshot.content, {
        surfaceId: "s",
        target: "chat",
        catalogId: STANDARD_CATALOG,
        operations: passedNativeV10Operations,
        status: "ready",
        rejected: [
          {
            index: 4,
            reason:
              'surface "s" is A2UI 1.0; an A2UI 0.9 operation cannot change it',
          },
        ],
      });

      // The client sends the click on the native surface as a 1.0 action,
      // with the surface summary that has no `a2uiSourceVersion`. The agent
      // gets it unchanged, even though it is a v0.9 agent.
      context.platform.faults.agentEvents = emptyStream;
      const click = {
        id: randomUUID(),
        role: "user",
        content: "Confirm\n\nselected: 2",
      };
      const forwardedProps = envelope({ action: clickAction("s") });
      forwardedProps.copilotkit.ui.metadata.extensions.copilotkit_surfaces = {
        s: { target: "chat" },
      };
      await runAndWait(context, input({ messages: [click], forwardedProps }));
      const agentInput = context.platform.agentInputs.at(-1);
      assert.equal(
        agentInput.messages.at(-1).id,
        click.id,
        "A click on a native 1.0 surface must reach the agent unchanged",
      );
      assert.equal(
        Object.hasOwn(agentInput.forwardedProps, "a2uiAction"),
        false,
      );
      assert.equal(
        agentInput.messages.some(
          (message) =>
            message.toolCalls?.some(
              (call) => call.function.name === "log_a2ui_event",
            ) ||
            (typeof message.content === "string" &&
              message.content.startsWith("A2UI user action:")),
        ),
        false,
      );
    },
  },
  ...[
    ["v09", { generativeUI: { a2uiVersion: "0.9" } }],
    ["v10", undefined],
  ].map(([label, configuration]) => ({
    id: `generative-ui.a2ui-version.click-reaches-${label}-agent`,
    configuration,
    async run(context) {
      context.platform.faults.agentEvents = emptyStream;
      const history = [
        { id: randomUUID(), role: "user", content: "Which plans are there?" },
        { id: randomUUID(), role: "assistant", content: "Here they are." },
      ];
      const click = {
        id: randomUUID(),
        role: "user",
        content: "Confirm\n\nselected: 2",
      };
      const body = input({
        messages: [...history, click],
        forwardedProps: envelope({ action: clickAction() }),
      });
      const events = await runAndWait(context, body);
      const agentInput = context.platform.agentInputs[0];
      const ids = agentInput.messages.map((message) => message.id);
      if (label === "v10") {
        assert.equal(ids.at(-1), click.id, "A 1.0 agent must see the click");
        assert.equal(
          Object.hasOwn(agentInput.forwardedProps, "a2uiAction"),
          false,
        );
        assert.equal(
          agentInput.messages.some((message) =>
            message.toolCalls?.some(
              (call) => call.function.name === "log_a2ui_event",
            ),
          ),
          false,
        );
      } else {
        assert.equal(
          ids.includes(click.id),
          false,
          "A v0.9 agent must get the click as an action, not a message",
        );
        assert.deepEqual(ids.slice(0, 2), [history[0].id, history[1].id]);
        assertA2UIActionHistory(context, agentInput.messages);
        assert.deepEqual(agentInput.forwardedProps.a2uiAction, {
          userAction: clickUserAction,
        });
      }
      const started = events.find((event) => event.type === "RUN_STARTED");
      assert.deepEqual(
        started.input.messages.map((message) => message.id),
        [history[0].id, history[1].id, click.id],
        "The stored thread must keep the click message",
      );
    },
  })),
  ...[
    ["omitted", undefined, { enabled: true }],
    ["v09", { a2uiVersion: "0.9" }, { enabled: true }],
    [
      "agents",
      { a2uiVersion: { default: "0.9" }, agents: ["default"] },
      { enabled: true, agents: ["default"] },
    ],
    ["disabled", false, { enabled: false }],
  ].map(([label, generativeUI, expected]) => ({
    id: `generative-ui.a2ui-version.info-${label}`,
    configuration: generativeUI === undefined ? undefined : { generativeUI },
    async run(context) {
      const response = await context.request("GET", "/info");
      assert.equal(response.status, 200);
      assert.deepEqual(response.body.generativeUI, expected);
      assert.equal(Object.hasOwn(response.body, "a2uiEnabled"), false);
      assert.equal(Object.hasOwn(response.body, "a2ui"), false);
    },
  })),
];

export const uiCases = [
  ...["agent", "resource-proxy", "tool-proxy"].map((path) => ({
    id: `mcp-apps.standard-mime-${path}`,
    configuration: mcpConfiguration,
    async run(context) {
      context.platform.faults.agentEvents = toolStream("show_card", [
        '{"title":"MIME contract"}',
      ]);
      const proxy =
        path === "resource-proxy"
          ? { method: "resources/read", params: { uri: "ui://fixture/card" } }
          : {
              method: "tools/call",
              params: {
                name: "show_card",
                arguments: { title: "MIME contract" },
              },
            };
      const events = await runAndWait(
        context,
        input(
          path === "agent"
            ? {}
            : {
                forwardedProps: {
                  __proxiedMCPRequest: { serverId: "cards", ...proxy },
                },
              },
        ),
      );
      const requests = context.platform.requests.filter(
        (request) => request.path === "/mcp",
      );
      const initializations = requests.filter(
        (request) => request.body?.method === "initialize",
      );
      assert.ok(
        initializations.length > 0,
        "The test must observe MCP initialization",
      );
      for (const request of initializations) {
        assert.ok(
          request.body.params.capabilities?.extensions?.[
            "io.modelcontextprotocol/ui"
          ]?.mimeTypes?.includes("text/html;profile=mcp-app"),
          "Every MCP connection must advertise the January MCP Apps MIME type",
        );
      }
      assert.ok(
        requests.some(
          (request) =>
            request.body?.method ===
            (path === "resource-proxy" ? "resources/read" : "tools/call"),
        ),
      );
      if (path === "agent") {
        assert.ok(events.some((event) => event.activityType === "mcp-apps"));
      } else {
        assert.equal(context.platform.agentInputs.length, 0);
        const result = events.find(
          (event) => event.type === "RUN_FINISHED",
        ).result;
        if (path === "resource-proxy") {
          assert.equal(
            result.contents[0].mimeType,
            "text/html;profile=mcp-app",
          );
          assert.match(result.contents[0].text, /Fixture card/);
        } else {
          assert.equal(result.content[0].text, "Card: MIME contract");
        }
      }
    },
  })),
  ...["ambiguous", "explicit-first", "explicit-second", "unknown-id"].map(
    (selection) => ({
      id: `mcp-apps.server-selection-${selection}`,
      configuration(platform) {
        return {
          mcpApps: {
            servers: ["first", "second"].map((serverId) => ({
              ...mcpConfiguration(platform).mcpApps.servers[0],
              serverId,
              headers: {
                "x-fixture-auth": "mcp-fixture-token",
                "x-fixture-account": serverId,
              },
            })),
          },
        };
      },
      async run(context) {
        const serverHash = createHash("md5")
          .update(
            JSON.stringify({ type: "http", url: context.platform.mcpUrl }),
          )
          .digest("hex");
        const serverId =
          selection === "ambiguous"
            ? undefined
            : selection.replace("explicit-", "");
        const events = await runAndWait(
          context,
          input({
            forwardedProps: {
              __proxiedMCPRequest: {
                serverHash,
                ...(serverId ? { serverId } : {}),
                method: "tools/call",
                params: {
                  name: "show_card",
                  arguments: { title: "Account test" },
                },
              },
            },
          }),
        );
        const requests = context.platform.requests.filter(
          (request) => request.path === "/mcp",
        );
        const result = events.find(
          (event) => event.type === "RUN_FINISHED",
        ).result;
        if (selection === "ambiguous" || selection === "unknown-id") {
          assert.equal(
            requests.length,
            0,
            "Ambiguous hashes and unknown explicit IDs must fail before sending credentials",
          );
          assert.ok(result.error);
        } else {
          assert.deepEqual(context.platform.mcpCalls, [
            { title: "Account test" },
          ]);
          assert.ok(requests.length > 0);
          assert.ok(
            requests.every(
              (request) => request.headers["x-fixture-account"] === serverId,
            ),
            "Explicit server ID must select its own credentials",
          );
          assert.equal(result.content[0].text, "Card: Account test");
        }
        assert.equal(context.platform.agentInputs.length, 0);
      },
    }),
  ),
  ...[
    ["omitted", undefined, true],
    ["model", ["model"], true],
    ["app", ["app"], false],
    ["both", ["app", "model"], true],
    ["empty", [], false],
  ].map(([label, visibility, modelVisible]) => ({
    id: `mcp-apps.visibility-${label}`,
    configuration: mcpConfiguration,
    async run(context) {
      context.platform.mcp.addTool({
        name: "visibility_card",
        description: "Visibility contract",
        inputSchema: { type: "object", properties: {} },
        _meta: {
          ui: {
            resourceUri: "ui://fixture/card",
            ...(visibility === undefined ? {} : { visibility }),
          },
        },
      });
      context.platform.mcp.onToolCall(
        "visibility_card",
        () => "Visible in app",
      );
      await runAndWait(context);
      assert.equal(
        context.platform.agentInputs[0].tools.some(
          (tool) => tool.name === "visibility_card",
        ),
        modelVisible,
        "Explicit visibility must include model before a tool enters model input",
      );
      const events = await runAndWait(
        context,
        input({
          forwardedProps: {
            __proxiedMCPRequest: {
              serverId: "cards",
              method: "tools/call",
              params: { name: "visibility_card", arguments: {} },
            },
          },
        }),
      );
      assert.equal(
        events.find((event) => event.type === "RUN_FINISHED").result.content[0]
          .text,
        "Visible in app",
      );
      assert.equal(
        context.platform.agentInputs.length,
        1,
        "UI proxy must bypass the model",
      );
    },
  })),
  ...["nested", "both"].map((format) => ({
    id: `mcp-apps.current-metadata-${format}`,
    configuration: mcpConfiguration,
    async run(context) {
      context.platform.mcp.addTool({
        name: "current_card",
        description: "Current MCP metadata",
        inputSchema: { type: "object", properties: {} },
        _meta: {
          ui: { resourceUri: "ui://fixture/card" },
          ...(format === "both"
            ? { "ui/resourceUri": "ui://legacy-wrong" }
            : {}),
        },
      });
      context.platform.mcp.onToolCall("current_card", () => "Card");
      context.platform.faults.agentEvents = toolStream(
        "current_card",
        ["{}"],
        "current-metadata-call",
      );
      const events = await runAndWait(context);
      assert.ok(
        context.platform.agentInputs[0].tools.some(
          (tool) => tool.name === "current_card",
        ),
        "current MCP metadata must discover the UI tool",
      );
      const activity = events.find(
        (event) => event.activityType === "mcp-apps",
      );
      assert.equal(activity?.content.resourceUri, "ui://fixture/card");
    },
  })),
  ...a2uiCases,
  {
    id: "mcp-apps.discover-execute-and-persist",
    configuration: mcpConfiguration,
    async run(context) {
      const { platform } = context;
      platform.faults.agentEvents = toolStream(
        "show_card",
        ['{"title":"Example"}'],
        "mcp-call",
      );
      const events = await runAndWait(context);
      const tools = platform.agentInputs[0].tools;
      assert.ok(
        tools.some(
          (tool) =>
            tool.name === "show_card" &&
            tool.description.includes("[UI Resource: ui://fixture/card]"),
        ),
      );
      assert.equal(
        tools.some((tool) => tool.name === "internal_tool"),
        false,
      );
      assert.deepEqual(platform.mcpCalls, [{ title: "Example" }]);
      const activity = events.find(
        (event) => event.activityType === "mcp-apps",
      );
      assert.equal(activity.content.resourceUri, "ui://fixture/card");
      assert.equal(activity.content.serverId, "cards");
      assert.equal(
        activity.content.serverHash,
        createHash("md5")
          .update(JSON.stringify({ type: "http", url: platform.mcpUrl }))
          .digest("hex"),
      );
      assert.deepEqual(activity.content.toolInput, { title: "Example" });
      const result = events.find(
        (event) =>
          event.type === "TOOL_CALL_RESULT" && event.toolCallId === "mcp-call",
      );
      assert.equal(result.content, "Card: Example");
      assert.ok(
        events.indexOf(activity) <
          events.findIndex((event) => event.type === "RUN_FINISHED"),
      );
      // Native hardening beyond pinned TS: trusted HTTP auth and explicit teardown.
      assert.ok(
        platform.requests.some(
          (request) => request.path === "/mcp" && request.method === "DELETE",
        ),
        "MCP session not closed",
      );
      await platform.waitFor(() => platform.mcp.getSessions().size === 0);
      for (const value of [
        platform.agentInputs,
        platform.events,
        platform.telemetry,
      ]) {
        assert.equal(
          JSON.stringify(value).includes("mcp-fixture-token"),
          false,
          "MCP credential leaked outside transport",
        );
      }
    },
  },
  {
    id: "mcp-apps.resource-reentry-bypasses-agent",
    configuration: mcpConfiguration,
    async run(context) {
      const events = await runAndWait(
        context,
        input({
          forwardedProps: {
            __proxiedMCPRequest: {
              serverId: "cards",
              method: "resources/read",
              params: { uri: "ui://fixture/card" },
            },
          },
        }),
      );
      assert.equal(context.platform.agentInputs.length, 0);
      const terminal = events.find((event) => event.type === "RUN_FINISHED");
      assert.equal(
        terminal.result.contents[0].mimeType,
        "text/html;profile=mcp-app",
      );
      assert.match(terminal.result.contents[0].text, /Fixture card/);
    },
  },
  {
    id: "mcp-apps.tool-reentry-bypasses-agent",
    configuration: mcpConfiguration,
    async run(context) {
      const events = await runAndWait(
        context,
        input({
          forwardedProps: {
            __proxiedMCPRequest: {
              serverId: "cards",
              method: "tools/call",
              params: {
                name: "show_card",
                arguments: { title: "From iframe" },
              },
            },
          },
        }),
      );
      assert.equal(context.platform.agentInputs.length, 0);
      assert.deepEqual(context.platform.mcpCalls, [{ title: "From iframe" }]);
      assert.equal(
        events.find((event) => event.type === "RUN_FINISHED").result.content[0]
          .text,
        "Card: From iframe",
      );
    },
  },
  {
    id: "mcp-apps.unknown-server-cannot-trigger-network",
    configuration: mcpConfiguration,
    async run(context) {
      const events = await runAndWait(
        context,
        input({
          forwardedProps: {
            __proxiedMCPRequest: {
              serverId: "unconfigured",
              method: "resources/read",
              params: { uri: "https://untrusted.test" },
            },
          },
        }),
      );
      assert.equal(context.platform.agentInputs.length, 0);
      assert.equal(
        context.platform.requests.filter((request) => request.path === "/mcp")
          .length,
        0,
      );
      assert.ok(
        events.find((event) => event.type === "RUN_FINISHED").result.error,
      );
    },
  },
  {
    id: "mcp-apps.agent-scope-blocks-reentry",
    configuration(platform) {
      const configuration = mcpConfiguration(platform);
      configuration.mcpApps.servers[0].agentId = "another-agent";
      return configuration;
    },
    async run(context) {
      const events = await runAndWait(
        context,
        input({
          forwardedProps: {
            __proxiedMCPRequest: {
              serverId: "cards",
              method: "resources/read",
              params: { uri: "ui://fixture/card" },
            },
          },
        }),
      );
      assert.equal(context.platform.agentInputs.length, 0);
      assert.equal(
        context.platform.requests.filter((request) => request.path === "/mcp")
          .length,
        0,
      );
      assert.ok(
        events.find((event) => event.type === "RUN_FINISHED").result.error,
      );
    },
  },
  {
    id: "mcp-apps.browser-cannot-override-transport",
    configuration: mcpConfiguration,
    async run(context) {
      const events = await runAndWait(
        context,
        input({
          forwardedProps: {
            __proxiedMCPRequest: {
              serverId: "cards",
              url: "http://127.0.0.1:1/untrusted",
              headers: { "x-fixture-auth": "browser-controlled" },
              method: "resources/read",
              params: { uri: "ui://fixture/card" },
            },
          },
        }),
      );
      assert.equal(context.platform.agentInputs.length, 0);
      assert.match(
        events.find((event) => event.type === "RUN_FINISHED").result.contents[0]
          .text,
        /Fixture card/,
      );
      const requests = context.platform.requests.filter(
        (request) => request.path === "/mcp",
      );
      assert.ok(requests.length > 0);
      assert.ok(
        requests.every(
          (request) =>
            request.headers["x-fixture-auth"] === "mcp-fixture-token",
        ),
      );
    },
  },
  {
    id: "mcp-apps.disallowed-method-cannot-trigger-network",
    configuration: mcpConfiguration,
    async run(context) {
      const events = await runAndWait(
        context,
        input({
          forwardedProps: {
            __proxiedMCPRequest: {
              serverId: "cards",
              method: "roots/list",
              params: {},
            },
          },
        }),
      );
      assert.equal(context.platform.agentInputs.length, 0);
      assert.equal(
        context.platform.requests.filter((request) => request.path === "/mcp")
          .length,
        0,
      );
      assert.ok(
        events.find((event) => event.type === "RUN_FINISHED").result.error,
      );
    },
  },
];
