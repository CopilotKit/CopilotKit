import { AbstractAgent, EventType } from "@ag-ui/client";
import type {
  ActivitySnapshotEvent,
  BaseEvent,
  Message,
  RunAgentInput,
} from "@ag-ui/client";
import {
  A2UI_SCHEMA_CONTEXT_DESCRIPTION,
  RENDER_A2UI_TOOL_NAME,
} from "@ag-ui/a2ui-middleware";
import { from } from "rxjs";
import type { Observable } from "rxjs";
import { describe, expect, it } from "vitest";
import {
  GENERATIVE_UI_ACTIVITY_TYPE,
  GENERATIVE_UI_CONTEXT_DESCRIPTION,
  GENERATIVE_UI_RENDER_TOOL,
} from "@copilotkit/shared";
import type {
  A2UIActionMessage,
  CopilotKitUIEnvelope,
  GenerativeUIComponentManifest,
} from "@copilotkit/shared";
import { CopilotRuntime } from "../core/runtime";
import type { CopilotRuntimeOptions } from "../core/runtime";
import { configureAgentForRequest } from "../handlers/shared/agent-utils";
import { handleRunAgent } from "../handlers/handle-run";
import { resolveA2UIVersion } from "../generative-ui/a2ui-v09-middleware";
import type { InMemoryAgentRunner } from "../runner/in-memory";

const BASIC_CATALOG_ID =
  "https://a2ui.org/specification/v0_9/basic_catalog.json";

const productCard: GenerativeUIComponentManifest = {
  description: "A product",
  props: {
    type: "object",
    properties: { name: { type: "string" } },
    required: ["name"],
  },
};

const action: A2UIActionMessage = {
  version: "1.0",
  action: {
    name: "choose",
    surfaceId: "plans",
    sourceComponentId: "team-button",
    timestamp: "2026-10-20T10:00:00.000Z",
    userMessage: "Show me the Team plan",
    context: { plan: "team" },
  },
};

/** A "tool" envelope as the 1.0 client sends it, with an optional click. */
function envelope(copilotkitAction?: A2UIActionMessage): CopilotKitUIEnvelope {
  return {
    "1.0": {
      supportedCatalogIds: ["shop"],
      inlineCatalogs: [
        {
          catalogId: "shop",
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
        ...(copilotkitAction ? { copilotkit_action: copilotkitAction } : {}),
      },
    },
  };
}

/** The v0.9 operations of a surface, as a tool result or `A2UIMiddleware` carries them. */
const v09Operations = [
  {
    version: "v0.9",
    createSurface: { surfaceId: "plans", catalogId: BASIC_CATALOG_ID },
  },
  {
    version: "v0.9",
    updateComponents: {
      surfaceId: "plans",
      components: [{ id: "root", component: "Text", text: "Plans" }],
    },
  },
];

/** A run whose backend tool returns v0.9 operations, as `copilotkit.a2ui.render` does. */
const toolResultRun: BaseEvent[] = [
  { type: EventType.RUN_STARTED, threadId: "thread-1", runId: "run-1" },
  {
    type: EventType.TOOL_CALL_START,
    toolCallId: "search-call",
    toolCallName: "search_plans",
    parentMessageId: "assistant-1",
  },
  { type: EventType.TOOL_CALL_ARGS, toolCallId: "search-call", delta: "{}" },
  { type: EventType.TOOL_CALL_END, toolCallId: "search-call" },
  {
    type: EventType.TOOL_CALL_RESULT,
    messageId: "search-result",
    toolCallId: "search-call",
    content: JSON.stringify({ a2ui_operations: v09Operations }),
  },
  { type: EventType.RUN_FINISHED, threadId: "thread-1", runId: "run-1" },
];

/** A run whose model streams a `render_a2ui` call. */
const renderA2UIRun: BaseEvent[] = [
  { type: EventType.RUN_STARTED, threadId: "thread-1", runId: "run-1" },
  {
    type: EventType.TOOL_CALL_START,
    toolCallId: "render-call",
    toolCallName: RENDER_A2UI_TOOL_NAME,
    parentMessageId: "assistant-1",
  },
  {
    type: EventType.TOOL_CALL_ARGS,
    toolCallId: "render-call",
    delta: JSON.stringify({
      surfaceId: "plans",
      components: [{ id: "root", component: "Text", text: "Plans" }],
    }),
  },
  { type: EventType.TOOL_CALL_END, toolCallId: "render-call" },
  { type: EventType.RUN_FINISHED, threadId: "thread-1", runId: "run-1" },
];

const emptyRun: BaseEvent[] = [
  { type: EventType.RUN_STARTED, threadId: "thread-1", runId: "run-1" },
  { type: EventType.RUN_FINISHED, threadId: "thread-1", runId: "run-1" },
];

/** Emits a fixed script and records the input that reaches it. */
class ScriptedAgent extends AbstractAgent {
  script: BaseEvent[] = emptyRun;
  inputs: RunAgentInput[] = [];

  run(input: RunAgentInput): Observable<BaseEvent> {
    this.inputs.push(input);
    return from(this.script);
  }

  clone(): AbstractAgent {
    const cloned = super.clone() as ScriptedAgent;
    cloned.script = this.script;
    cloned.inputs = this.inputs;
    return cloned;
  }
}

function runtimeWith(
  generativeUI: CopilotRuntimeOptions["generativeUI"],
  agent: AbstractAgent,
) {
  return new CopilotRuntime({ agents: { default: agent }, generativeUI });
}

/** Configures `agent` for one "tool" run and runs it. */
async function runConfigured(
  generativeUI: CopilotRuntimeOptions["generativeUI"],
  script: BaseEvent[],
  messages: Message[] = [],
  forwardedProps: Record<string, unknown> = {
    copilotkit: { ui: envelope() },
  },
) {
  const agent = new ScriptedAgent();
  agent.script = script;
  configureAgentForRequest({
    runtime: runtimeWith(generativeUI, agent),
    request: new Request("http://localhost/run"),
    agentId: "default",
    agent,
    providerGenerativeUITransport: "tool",
  });
  agent.setMessages(messages);
  const events: BaseEvent[] = [];
  await agent.runAgent(
    { runId: "run-1", forwardedProps },
    {
      onEvent: ({ event }) => {
        events.push(event);
      },
    },
  );
  return { events, input: agent.inputs[0]! };
}

function activitySnapshots(events: BaseEvent[]) {
  return events.filter(
    (event): event is ActivitySnapshotEvent =>
      event.type === EventType.ACTIVITY_SNAPSHOT,
  );
}

describe("resolveA2UIVersion", () => {
  it.each<[string, CopilotRuntimeOptions["generativeUI"], string, string]>([
    ["defaults to 1.0 without the option", undefined, "default", "1.0"],
    ["defaults to 1.0 for generativeUI: true", true, "default", "1.0"],
    ["defaults to 1.0 without a2uiVersion", { agents: [] }, "default", "1.0"],
    ["uses one version for every agent", { a2uiVersion: "0.9" }, "any", "0.9"],
    [
      "uses the version of the agent in a record",
      { a2uiVersion: { legacy: "0.9", current: "1.0" } },
      "legacy",
      "0.9",
    ],
    [
      "uses 1.0 for an agent that is not in the record",
      { a2uiVersion: { legacy: "0.9" } },
      "other",
      "1.0",
    ],
  ])("%s", (_name, generativeUI, agentId, expected) => {
    expect(resolveA2UIVersion(generativeUI, agentId)).toBe(expected);
  });
});

describe("configureAgentForRequest with a2uiVersion", () => {
  it("gives a v0.9 agent render_a2ui and the v0.9 catalog, and no render_ui", async () => {
    const { input } = await runConfigured({ a2uiVersion: "0.9" }, emptyRun);

    const toolNames = input.tools.map((tool) => tool.name);
    expect(toolNames).toContain(RENDER_A2UI_TOOL_NAME);
    expect(toolNames).not.toContain(GENERATIVE_UI_RENDER_TOOL);

    const descriptions = input.context.map((entry) => entry.description);
    expect(descriptions).not.toContain(GENERATIVE_UI_CONTEXT_DESCRIPTION);
    expect(descriptions).toContain(
      `A2UI render tool usage guide — how to call ${RENDER_A2UI_TOOL_NAME} with valid arguments.`,
    );
    const schema = input.context.find(
      (entry) => entry.description === A2UI_SCHEMA_CONTEXT_DESCRIPTION,
    );
    expect(JSON.parse(schema!.value)).toMatchObject({
      catalogId: "shop",
      components: { ProductCard: expect.any(Object) },
    });
  });

  it("replaces a stale catalog entry instead of adding a second one", async () => {
    const agent = new ScriptedAgent();
    configureAgentForRequest({
      runtime: runtimeWith({ a2uiVersion: "0.9" }, agent),
      request: new Request("http://localhost/run"),
      agentId: "default",
      agent,
      providerGenerativeUITransport: "tool",
    });
    await agent.runAgent({
      runId: "run-1",
      forwardedProps: { copilotkit: { ui: envelope() } },
      context: [{ description: A2UI_SCHEMA_CONTEXT_DESCRIPTION, value: "{}" }],
    });

    const schemas = agent.inputs[0]!.context.filter(
      (entry) => entry.description === A2UI_SCHEMA_CONTEXT_DESCRIPTION,
    );
    expect(schemas).toHaveLength(1);
    expect(schemas[0]!.value).not.toBe("{}");
  });

  it("gives a 1.0 agent render_ui and no v0.9 tool or prompt", async () => {
    const { input } = await runConfigured(
      { a2uiVersion: { legacy: "0.9" } },
      emptyRun,
    );

    const toolNames = input.tools.map((tool) => tool.name);
    expect(toolNames).toContain(GENERATIVE_UI_RENDER_TOOL);
    expect(toolNames).not.toContain(RENDER_A2UI_TOOL_NAME);

    const descriptions = input.context.map((entry) => entry.description);
    expect(descriptions).toContain(GENERATIVE_UI_CONTEXT_DESCRIPTION);
    expect(descriptions.filter((d) => d.startsWith("A2UI"))).toEqual([]);
  });

  it.each([
    ["a v0.9 agent", { a2uiVersion: "0.9" } as const],
    ["a 1.0 agent", undefined],
  ])(
    "converts the v0.9 operations of a tool result to a 1.0 surface for %s",
    async (_name, generativeUI) => {
      const { events } = await runConfigured(generativeUI, toolResultRun);

      const snapshots = activitySnapshots(events);
      expect(snapshots).toEqual([
        expect.objectContaining({
          messageId: "genui:plans",
          activityType: GENERATIVE_UI_ACTIVITY_TYPE,
          content: expect.objectContaining({
            surfaceId: "plans",
            a2uiSourceVersion: "0.9",
            operations: expect.arrayContaining([
              expect.objectContaining({ createSurface: expect.any(Object) }),
            ]),
          }),
        }),
      ]);
    },
  );

  it("converts the streamed render_a2ui surface of a v0.9 agent", async () => {
    const { events } = await runConfigured(
      { a2uiVersion: "0.9" },
      renderA2UIRun,
    );

    const snapshots = activitySnapshots(events);
    expect(snapshots.length).toBeGreaterThan(0);
    expect(
      snapshots.every(
        (event) =>
          event.activityType === GENERATIVE_UI_ACTIVITY_TYPE &&
          event.messageId === "genui:plans",
      ),
    ).toBe(true);
    expect(snapshots.at(-1)!.content).toMatchObject({
      surfaceId: "plans",
      a2uiSourceVersion: "0.9",
    });
  });
});

describe("a click on a converted surface", () => {
  const firstTurn: Message[] = [
    { id: "u1", role: "user", content: "Which plans are there?" },
    { id: "a1", role: "assistant", content: "Here they are." },
  ];
  const clickMessage: Message = {
    id: "click",
    role: "user",
    content: "Show me the Team plan\n\nplan: team",
  };

  it("reaches a v0.9 agent as a log_a2ui_event tool call", async () => {
    const { input } = await runConfigured(
      { a2uiVersion: "0.9" },
      emptyRun,
      [...firstTurn, clickMessage],
      { copilotkit: { ui: envelope(action) } },
    );

    const [call, result] = input.messages.slice(-2);
    const toolCall = (
      call as { toolCalls: { function: { name: string; arguments: string } }[] }
    ).toolCalls[0]!;
    expect(toolCall.function.name).toBe("log_a2ui_event");
    expect(JSON.parse(toolCall.function.arguments)).toMatchObject({
      name: "choose",
      surfaceId: "plans",
      context: { plan: "team" },
    });
    expect(result).toMatchObject({ role: "tool" });
    expect(input.messages.some((message) => message.id === "click")).toBe(
      false,
    );
  });

  it("reaches a 1.0 agent as the visible user message", async () => {
    const { input } = await runConfigured(
      undefined,
      emptyRun,
      [...firstTurn, clickMessage],
      { copilotkit: { ui: envelope(action) } },
    );

    expect(input.messages.at(-1)).toMatchObject({ id: "click" });
    expect(input.forwardedProps).not.toHaveProperty("a2uiAction");
  });

  it("keeps the click message in the stored thread", async () => {
    // The in-memory store is shared by every runner in the process.
    const threadId = `a2ui-click-${crypto.randomUUID()}`;
    const agent = new ScriptedAgent();
    const runtime = runtimeWith({ a2uiVersion: "0.9" }, agent);
    const response = await handleRunAgent({
      runtime,
      agentId: "default",
      request: new Request("http://localhost/agent/default/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId,
          runId: "run-1",
          state: {},
          messages: [...firstTurn, clickMessage],
          tools: [],
          context: [],
          forwardedProps: { copilotkit: { ui: envelope(action) } },
        }),
      }),
    });
    expect(response.status).toBe(200);
    await response.text();

    // The agent got the v0.9 action instead of the click message ...
    const agentMessages = agent.inputs[0]!.messages;
    expect(agentMessages.some((message) => message.id === "click")).toBe(false);
    expect(agentMessages.at(-1)).toMatchObject({ role: "tool" });

    // ... and the thread that the runtime stores still has it.
    // An anonymous run belongs to the anonymous owner, "".
    const stored = (runtime.runner as InMemoryAgentRunner).getThreadMessages(
      threadId,
      { ownerId: "" },
    );
    expect(stored.map((message) => message.id)).toEqual(["u1", "a1", "click"]);
  });
});
