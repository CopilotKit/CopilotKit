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
  {
    id: "a2ui.late-identifiers-preserve-painted-surface",
    configuration: { a2ui: { enabled: true, injectA2UITool: true, schema } },
    async run(context) {
      context.platform.faults.agentChunkDelayMs = 15;
      context.platform.faults.agentEvents = toolStream("render_a2ui", [
        '{"components":[{"id":"root","component":"Column","children":["text"]},{"id":"text","component":"Text","text":"Hello"}]',
        ',"surfaceId":"late-surface"',
        ',"catalogId":"late-catalog","data":{"items":[{"name":"one"},',
        '{"name":"two"}]}}',
      ]);
      const events = await runAndWait(context);
      const snapshots = events.filter(
        (event) =>
          event.activityType === "a2ui-surface" &&
          event.content?.a2ui_operations,
      );
      assert.ok(
        snapshots.length >= 2,
        "Complete components and progressive data must produce snapshots",
      );
      const operations = snapshots.flatMap(
        (event) => event.content.a2ui_operations,
      );
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
    configuration: { a2ui: { enabled: true, injectA2UITool: true, schema } },
    async run(context) {
      context.platform.faults.agentEvents = toolStream("render_a2ui", [
        JSON.stringify({ surfaceId: "card", components }),
      ]);
      const events = await runAndWait(context);
      assert.equal(
        events.some((event) => event.content?.a2ui_operations),
        false,
        "Invalid component tree reached the browser",
      );
      assert.ok(
        events.some(
          (event) =>
            event.content?.status === "retrying" &&
            event.content.errors.length > 0,
        ),
      );
    },
  })),
  {
    id: "a2ui.custom-tool-included-agent",
    configuration: {
      a2ui: {
        enabled: true,
        injectA2UITool: "custom_render",
        agents: ["default"],
      },
    },
    async run(context) {
      context.platform.faults.agentEvents = toolStream("custom_render", [
        '{"surfaceId":"card","components":[{"id":"root","component":"Text","text":"Hello"}]}',
      ]);
      const events = await runAndWait(context);
      const tools = context.platform.agentInputs[0].tools;
      assert.equal(
        tools.filter((tool) => tool.name === "custom_render").length,
        1,
      );
      assert.equal(
        tools.some((tool) => tool.name === "render_a2ui"),
        false,
      );
      assert.ok(events.some((event) => event.content?.a2ui_operations));
    },
  },
  {
    id: "a2ui.atomic-components-and-progressive-data",
    configuration: { a2ui: { enabled: true, injectA2UITool: true, schema } },
    async run(context) {
      const { platform } = context;
      platform.faults.agentChunkDelayMs = 15;
      platform.faults.agentEvents = toolStream("render_a2ui", [
        '{"surfaceId":"card","components":[{"id":"root","component":"Column","children":["text"]},',
        '{"id":"text","component":"Text","text":"Hello"}],"data":{"items":[{"name":"one"},',
        '{"name":"two"}]}}',
      ]);
      const events = await runAndWait(context);
      assert.equal(
        platform.agentInputs[0].tools.filter(
          (tool) => tool.name === "render_a2ui",
        ).length,
        1,
      );
      assert.ok(
        platform.agentInputs[0].context.some(
          (entry) => entry.description === SCHEMA_DESCRIPTION,
        ),
      );
      const activities = events.filter(
        (event) => event.activityType === "a2ui-surface",
      );
      assert.equal(activities[0].content.status, "building");
      assert.ok(
        activities.every(
          (event) =>
            event.messageId === "a2ui-surface-render-call" &&
            event.replace === true,
        ),
      );
      const painted = activities.filter(
        (event) => event.content.a2ui_operations,
      );
      assert.ok(painted.length >= 2, "Missing progressive data snapshots");
      for (const activity of painted) {
        const components = activity.content.a2ui_operations.find(
          (op) => op.updateComponents,
        )?.updateComponents.components;
        assert.equal(
          components.length,
          2,
          "Partial component tree was painted",
        );
        assert.equal(
          activity.content.a2ui_operations[0].createSurface.catalogId,
          BASIC_CATALOG,
        );
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
        event.content.a2ui_operations
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
    configuration: { a2ui: { enabled: true } },
    async run(context) {
      const action = {
        name: "confirm",
        surfaceId: "card",
        sourceComponentId: "button",
        context: { selected: 2 },
      };
      context.platform.faults.agentEvents = toolStream("render_a2ui", [
        '{"surfaceId":"card","components":[{"id":"root","component":"Text","text":"Hello"}]}',
      ]);
      const events = await runAndWait(
        context,
        input({
          context: [
            {
              description: SCHEMA_DESCRIPTION,
              value: JSON.stringify({
                catalogId: "https://example.test/catalog",
                components: {},
              }),
            },
          ],
          forwardedProps: {
            a2uiCatalogAvailable: true,
            a2uiAction: { userAction: action },
          },
        }),
      );
      const messages = context.platform.agentInputs[0].messages;
      const assistant = messages.find(
        (message) => message.toolCalls?.[0]?.function.name === "log_a2ui_event",
      );
      assert.deepEqual(
        JSON.parse(assistant.toolCalls[0].function.arguments),
        action,
      );
      assert.ok(
        messages.some(
          (message) =>
            message.role === "tool" &&
            message.toolCallId === assistant.toolCalls[0].id &&
            message.content ===
              'User performed action "confirm" on surface "card" (component: button). Context: {"selected":2}',
        ),
      );
      const painted = events.find((event) => event.content?.a2ui_operations);
      assert.equal(
        painted.content.a2ui_operations[0].createSurface.catalogId,
        "https://example.test/catalog",
      );
    },
  },
  {
    id: "a2ui.explicit-disable-wins-over-catalog",
    configuration: { a2ui: { enabled: false, injectA2UITool: true } },
    async run(context) {
      context.platform.faults.agentEvents = toolStream("render_a2ui", [
        '{"surfaceId":"card","components":[{"id":"root","component":"Text","text":"Hello"}]}',
      ]);
      const events = await runAndWait(
        context,
        input({ forwardedProps: { a2uiCatalogAvailable: true } }),
      );
      assert.equal(
        events.filter((event) => event.activityType === "a2ui-surface").length,
        0,
      );
      assert.equal(
        context.platform.agentInputs[0].tools.some(
          (tool) => tool.name === "render_a2ui",
        ),
        false,
      );
    },
  },
  {
    id: "a2ui.invalid-tree-does-not-paint",
    configuration: { a2ui: { enabled: true, injectA2UITool: true, schema } },
    async run(context) {
      context.platform.faults.agentEvents = toolStream("render_a2ui", [
        '{"surfaceId":"card","components":[{"id":"root","component":"Column","children":["missing"]}]}',
      ]);
      const events = await runAndWait(context);
      assert.equal(
        events.some((event) => event.content?.a2ui_operations),
        false,
      );
      const retry = events.find(
        (event) => event.content?.status === "retrying",
      );
      assert.ok(
        retry?.content.errors.some(
          (error) => error.code === "unresolved_child",
        ),
      );
    },
  },
  {
    id: "a2ui.custom-tool-and-agent-scope",
    configuration: {
      a2ui: {
        enabled: true,
        injectA2UITool: "custom_render",
        agents: ["another-agent"],
      },
    },
    async run(context) {
      const response = await context.request("GET", "/info");
      assert.deepEqual(response.body.a2ui.agents, ["another-agent"]);
      context.platform.faults.agentEvents = toolStream("custom_render", [
        '{"surfaceId":"card","components":[{"id":"root","component":"Text","text":"Hello"}]}',
      ]);
      const events = await runAndWait(context);
      assert.equal(
        events.some((event) => event.activityType === "a2ui-surface"),
        false,
      );
      assert.equal(
        context.platform.agentInputs[0].tools.some(
          (tool) => tool.name === "custom_render",
        ),
        false,
      );
    },
  },
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
