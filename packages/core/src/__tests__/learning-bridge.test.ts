import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, Message, RunAgentInput } from "@ag-ui/client";
import type {
  LearningBatch,
  LearningEvent,
  LearningSink,
} from "@copilotkit/learning";
import { from } from "rxjs";
import { CopilotKitCore } from "../core";
import { LearningBridge } from "../core/learning-bridge";
import type { LegacyLearningConfig } from "../core/learning-bridge";
import { TrajectoryConnection } from "../core/trajectory-connection";

const ASSISTANT_WITH_TOOL: Message = {
  id: "m-assistant",
  role: "assistant",
  content: "Deal deal-7 is ready.",
  toolCalls: [
    {
      id: "tc-1",
      type: "function",
      function: { name: "approveDeal", arguments: "{}" },
    },
  ],
};

class DealAgent extends AbstractAgent {
  constructor(
    threadId: string,
    initialMessages: Message[] = [],
    private readonly serverResult = false,
  ) {
    super({ agentId: "default", threadId, initialMessages });
  }

  run(input: RunAgentInput) {
    const events: BaseEvent[] = [
      {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      },
      {
        type: EventType.TEXT_MESSAGE_START,
        messageId: "m-reply",
        role: "assistant",
      },
      {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: "m-reply",
        delta: "Please approve.",
      },
      { type: EventType.TEXT_MESSAGE_END, messageId: "m-reply" },
      {
        type: EventType.TOOL_CALL_START,
        toolCallId: "tc-9",
        toolCallName: "approveDeal",
        parentMessageId: "m-reply",
      },
      { type: EventType.TOOL_CALL_ARGS, toolCallId: "tc-9", delta: "{}" },
      { type: EventType.TOOL_CALL_END, toolCallId: "tc-9" },
      {
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      },
    ];
    if (this.serverResult) {
      events.splice(events.length - 1, 0, {
        type: EventType.TOOL_CALL_RESULT,
        messageId: "m-tool-result",
        toolCallId: "tc-9",
        content: "approved",
      });
    }
    return from(events);
  }
}

function targetIn(attributes: Record<string, string>) {
  return {
    closest: (selector: string) => {
      const name = selector.slice(1, -1);
      const value = attributes[name];
      return value === undefined
        ? null
        : { getAttribute: (key: string) => attributes[key] ?? null };
    },
  };
}

let batches: LearningBatch[] = [];

function createConfig(
  overrides: Partial<LegacyLearningConfig> = {},
): LegacyLearningConfig {
  const sink: LearningSink = (batch) => {
    batches.push(batch);
  };
  return {
    sink,
    capture: { clicks: false, navigation: false, network: false },
    ...overrides,
  };
}

function drain() {
  window.dispatchEvent(new Event("pagehide"));
  return batches.flatMap((batch) => batch.events);
}

function valuesOf(events: LearningEvent[], name: string) {
  return events
    .filter((event) => event.name === name)
    .map((event) => event.value);
}

beforeEach(() => {
  batches = [];
  // Core tests run in Node; supply the browser metadata used by page capture.
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("location", new URL("http://localhost/learning"));
  vi.stubGlobal("document", { title: "Learning", referrer: "" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Core learning wiring", () => {
  it.each([
    { learningContainerIds: [] },
    { learningContainerIds: ["private-container"] },
  ])(
    "warns about authenticated container options without forwarding them: $learningContainerIds",
    async ({ learningContainerIds }) => {
      const trajectoryId = "10000000-0000-4000-8000-000000000001";
      const start = vi
        .spyOn(TrajectoryConnection.prototype, "start")
        .mockResolvedValue({ status: "started", trajectoryId });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const config = {};
      const core = new CopilotKitCore({ learning: config });

      await expect(
        core.startTrajectory({ trajectoryId, learningContainerIds }),
      ).resolves.toEqual({ status: "started", trajectoryId });

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(
          "learningContainerIds is supported only with a custom sink",
        ),
      );
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("does not assign Learning Containers"),
      );
      expect(JSON.stringify(warn.mock.calls)).not.toContain(
        "private-container",
      );
      expect(start).toHaveBeenCalledWith(trajectoryId, config);
    },
  );

  it("preserves custom-sink container options without warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const core = new CopilotKitCore({ learning: createConfig() });
    await core.startTrajectory({
      trajectoryId: "legacy-trajectory",
      learningContainerIds: ["legacy-container"],
    });
    core.stopTrajectory();

    expect(batches[0]?.learningContainerIds).toEqual(["legacy-container"]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("can enable learning after construction and track subsequent agent activity", async () => {
    const core = new CopilotKitCore({});
    core.registerOpenThread({ agentId: "default", threadId: "t-late" });
    core.setLearningConfig(createConfig());
    core.startTrajectory({ trajectoryId: "traj-late" });
    await core.runAgent({ agent: new DealAgent("t-late") });

    const events = drain();
    expect(core.trajectoryId).toBe("traj-late");
    expect(valuesOf(events, "thread.linked")).toContainEqual(
      expect.objectContaining({ threadId: "t-late", reason: "start" }),
    );
    expect(valuesOf(events, "agent.run")).toContainEqual(
      expect.objectContaining({ threadId: "t-late", phase: "started" }),
    );
    core.stopTrajectory();
  });

  it("keeps the active config and applies updated settings to the next capture", () => {
    const nextBatches: LearningBatch[] = [];
    const core = new CopilotKitCore({ learning: createConfig() });
    core.startTrajectory({ trajectoryId: "first" });
    core.setLearningConfig(
      createConfig({
        sink: (batch) => {
          nextBatches.push(batch);
        },
        beforeSend: (event) => (event.name === "page" ? null : event),
      }),
    );

    core.emitTrajectoryEvent("app.first", {});
    core.stopTrajectory();
    expect(
      batches.flatMap((batch) => batch.events.map((event) => event.name)),
    ).toEqual(["page", "app.first"]);
    expect(nextBatches).toEqual([]);

    core.startTrajectory({ trajectoryId: "second" });
    core.emitTrajectoryEvent("app.second", {});
    core.stopTrajectory();
    expect(nextBatches).toHaveLength(1);
    expect(nextBatches[0]?.trajectoryId).toBe("second");
    expect(nextBatches[0]?.events.map((event) => event.name)).toEqual([
      "app.second",
    ]);
  });

  it("notifies actual capture changes and stops when learning is removed", () => {
    const core = new CopilotKitCore({ learning: createConfig() });
    const changed = vi.fn();
    core.subscribe({ onTrajectoryChanged: changed });
    core.startTrajectory({ trajectoryId: "traj-1" });
    core.startTrajectory({ trajectoryId: "traj-1" });
    core.setLearningConfig(undefined);
    core.emitTrajectoryEvent("app.after-stop", {});
    core.stopTrajectory();

    expect(core.trajectoryId).toBeNull();
    expect(changed.mock.calls.map(([event]) => event.trajectoryId)).toEqual([
      "traj-1",
      null,
    ]);
    expect(valuesOf(drain(), "app.after-stop")).toEqual([]);
  });

  it("continues sequence numbers across restarts and config changes before beforeSend", () => {
    const seen: number[] = [];
    const beforeSend = (event: LearningEvent) => {
      seen.push(event.value.seq as number);
      return event.name === "app.filtered" ? null : event;
    };
    const core = new CopilotKitCore({
      learning: createConfig({ beforeSend }),
    });
    core.startTrajectory({ trajectoryId: "same" });
    core.emitTrajectoryEvent("app.filtered", {});
    core.stopTrajectory();
    core.startTrajectory({ trajectoryId: "same" });
    core.emitTrajectoryEvent("app.kept", {});
    core.setLearningConfig(undefined);
    core.setLearningConfig(createConfig({ beforeSend }));
    core.startTrajectory({ trajectoryId: "another" });
    core.stopTrajectory();

    expect(seen).toEqual([1, 2, 3, 4, 5]);
    expect(drain().map((event) => event.value.seq)).toEqual([1, 3, 4, 5]);
    expect(batches.map((batch) => batch.trajectoryId)).toEqual([
      "same",
      "same",
      "another",
    ]);
  });

  it("links a Thread once when StrictMode registers it twice", () => {
    const core = new CopilotKitCore({ learning: createConfig() });
    core.startTrajectory({ trajectoryId: "traj-1" });

    core
      .registerOpenThread({ agentId: "default", threadId: "t-1" })
      .unregister();
    core.registerOpenThread({ agentId: "default", threadId: "t-1" });

    expect(
      valuesOf(drain(), "thread.linked").map((value) => value.reason),
    ).toEqual(["open"]);
  });

  it("adds the open Thread to outcome events and rejects built-in names", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const core = new CopilotKitCore({ learning: createConfig() });
    core.registerOpenThread({ agentId: "default", threadId: "t-1" });
    core.startTrajectory({ trajectoryId: "traj-1" });

    core.emitTrajectoryEvent("deal.approved", { dealId: "deal-1" });
    core.emitTrajectoryEvent("click", {});

    expect(valuesOf(drain(), "deal.approved")).toEqual([
      { threadId: "t-1", dealId: "deal-1", seq: 3 },
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("does not capture CopilotKit's own telemetry requests", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => new Response(null, { status: 202 })),
    );
    const core = new CopilotKitCore({
      learning: createConfig({
        capture: { clicks: false, navigation: false, network: true },
      }),
    });
    core.startTrajectory({ trajectoryId: "traj-1" });

    await fetch("https://telemetry.copilotkit.ai/ingest", { method: "POST" });
    await fetch("https://api.example.com/deals/7");

    await vi.waitFor(() =>
      expect(valuesOf(drain(), "network").map((value) => value.origin)).toEqual(
        ["https://api.example.com"],
      ),
    );
    core.stopTrajectory();
  });

  it("links the open Thread at start and on a switch", () => {
    const agent = new DealAgent("t-1", [ASSISTANT_WITH_TOOL]);
    const core = new CopilotKitCore({
      agents__unsafe_dev_only: { default: agent },
      learning: createConfig(),
    });

    const registration = core.registerOpenThread({
      agentId: "default",
      threadId: "t-1",
    });
    core.startTrajectory({ trajectoryId: "traj-1" });
    registration.update("t-2");

    expect(valuesOf(drain(), "thread.linked")).toEqual([
      {
        threadId: "t-1",
        agentId: "default",
        hasMessages: true,
        reason: "start",
        seq: 2,
      },
      {
        threadId: "t-2",
        agentId: "default",
        hasMessages: false,
        reason: "switch",
        seq: 3,
      },
    ]);
  });

  it("captures run, message, and tool lifecycle with ids, including an untracked clone", async () => {
    const core = new CopilotKitCore({
      learning: createConfig(),
      tools: [
        {
          name: "approveDeal",
          handler: async () => "approved",
          followUp: false,
        },
      ],
    });
    core.startTrajectory({ trajectoryId: "traj-1" });

    await core.runAgent({ agent: new DealAgent("t-5") });
    const events = drain();

    expect(
      valuesOf(events, "agent.run").map((value) => [
        value.phase,
        value.threadId,
      ]),
    ).toEqual([
      ["started", "t-5"],
      ["finished", "t-5"],
    ]);
    expect(
      valuesOf(events, "tool.call").map((value) => [
        value.phase,
        value.toolName,
        value.threadId,
        value.messageId,
      ]),
    ).toEqual([
      ["started", "approveDeal", "t-5", "m-reply"],
      ["executing", "approveDeal", "t-5", "m-reply"],
      ["completed", "approveDeal", "t-5", "m-reply"],
    ]);
    expect(valuesOf(events, "tool.call").at(-1)).toMatchObject({
      outcome: "ok",
    });
    expect(
      valuesOf(events, "agent.message").find(
        (value) => value.role === "assistant",
      ),
    ).toMatchObject({
      messageId: "m-reply",
      threadId: "t-5",
      textLength: "Please approve.".length,
    });
  });

  it("includes full message text by default and honors agentText false", async () => {
    const off = new CopilotKitCore({
      learning: createConfig({
        capture: {
          clicks: false,
          navigation: false,
          network: false,
          agentText: false,
        },
      }),
    });
    off.startTrajectory({ trajectoryId: "off" });
    await off.runAgent({ agent: new DealAgent("t-off") });
    const withoutText = valuesOf(drain(), "agent.message").find(
      (value) => value.role === "assistant",
    );
    off.stopTrajectory();

    batches = [];
    const fullText = "Complete answer. ".repeat(300);
    const agent = new DealAgent("t-on");
    const on = new CopilotKitCore({
      learning: createConfig(),
      agents__unsafe_dev_only: { default: agent },
    });
    on.startTrajectory({ trajectoryId: "on" });
    agent.addMessages([
      { id: "user-full", role: "user", content: fullText },
      { id: "assistant-full", role: "assistant", content: fullText },
      {
        id: "tool-full",
        role: "tool",
        toolCallId: "tc-full",
        content: fullText,
      },
    ]);
    await vi.waitFor(() =>
      expect(valuesOf(drain(), "agent.message")).toHaveLength(3),
    );
    const messages = valuesOf(drain(), "agent.message");

    expect(withoutText).not.toHaveProperty("text");
    expect(messages.map((value) => value.role)).toEqual([
      "user",
      "assistant",
      "tool",
    ]);
    for (const message of messages)
      expect(message).toMatchObject({
        text: fullText,
        textLength: fullText.length,
      });
    on.stopTrajectory();
  });

  it("stops emitting after stopTrajectory", async () => {
    const core = new CopilotKitCore({ learning: createConfig() });
    core.startTrajectory({ trajectoryId: "traj-1" });
    drain();
    batches = [];

    core.stopTrajectory();
    await core.runAgent({ agent: new DealAgent("t-6") });

    expect(drain()).toEqual([]);
  });

  it("reports learning configuration independently of capture state", () => {
    const core = new CopilotKitCore({ learning: createConfig() });
    const changed = vi.fn();
    const unsubscribe = core.ɵsubscribeToLearningConfigured(changed);
    expect(core.ɵlearningConfigured).toBe(true);

    core.startTrajectory({ trajectoryId: "traj-1" });
    core.stopTrajectory();
    core.setLearningConfig(createConfig({ ignoreUrls: ["/other"] }));
    expect(changed).not.toHaveBeenCalled();
    expect(core.ɵlearningConfigured).toBe(true);

    core.setLearningConfig(undefined);
    expect(core.ɵlearningConfigured).toBe(false);
    core.setLearningConfig(undefined);
    core.setLearningConfig(createConfig());
    expect(core.ɵlearningConfigured).toBe(true);
    expect(changed).toHaveBeenCalledTimes(2);

    unsubscribe();
    core.setLearningConfig(undefined);
    expect(changed).toHaveBeenCalledTimes(2);
    expect(new CopilotKitCore({}).ɵlearningConfigured).toBe(false);
  });

  it("warns and captures nothing without the learning option", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const core = new CopilotKitCore({});

    core.startTrajectory({ trajectoryId: "traj-1" });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(drain()).toEqual([]);
  });
});

describe("click attribution", () => {
  function createBridge() {
    const agent = new DealAgent("t-1", [ASSISTANT_WITH_TOOL]);
    const core = new CopilotKitCore({
      agents__unsafe_dev_only: { default: agent },
    });
    const bridge = new LearningBridge(core, createConfig());
    bridge.start({ trajectoryId: "traj-clicks" });
    return bridge;
  }

  it("uses the clicked message and tool call when the click is inside one", () => {
    const bridge = createBridge();

    expect(
      bridge.enrich(
        targetIn({
          "data-message-id": "m-assistant",
          "data-tool-call-id": "tc-1",
        }),
      ),
    ).toEqual({
      threadId: "t-1",
      agentId: "default",
      messageId: "m-assistant",
      runId: null,
      toolCallId: "tc-1",
      toolName: "approveDeal",
      toolStatus: "inProgress",
    });
    bridge.stop();
  });

  it("falls back to the single open Thread, then to null", () => {
    const bridge = createBridge();
    expect(bridge.enrich(targetIn({}))).toEqual({ threadId: null });

    bridge.registerOpenThread({ agentId: "default", threadId: "t-1" });
    bridge.registerOpenThread({ agentId: "default", threadId: "t-1" });
    expect(bridge.enrich(targetIn({}))).toEqual({ threadId: "t-1" });
    bridge.stop();
  });

  it("reports ambiguity instead of guessing when two Threads are open", () => {
    const bridge = createBridge();
    bridge.registerOpenThread({ agentId: "default", threadId: "t-1" });
    const second = bridge.registerOpenThread({
      agentId: "sidebar",
      threadId: "t-2",
    });

    expect(bridge.enrich(targetIn({}))).toEqual({
      threadId: null,
      threadAmbiguity: { reason: "multiple-open", candidates: ["t-1", "t-2"] },
    });

    second.unregister();
    expect(bridge.enrich(targetIn({}))).toEqual({ threadId: "t-1" });
    bridge.stop();
  });
});

describe("capture subscription lifecycle", () => {
  it("releases legacy tracking when switching to authenticated capture", async () => {
    const trajectoryId = "10000000-0000-4000-8000-000000000002";
    let authenticatedId: string | null = null;
    const start = vi
      .spyOn(TrajectoryConnection.prototype, "start")
      .mockImplementation(async () => {
        authenticatedId = trajectoryId;
        return { status: "started", trajectoryId };
      });
    vi.spyOn(
      TrajectoryConnection.prototype,
      "trajectoryId",
      "get",
    ).mockImplementation(() => authenticatedId);
    const stop = vi
      .spyOn(TrajectoryConnection.prototype, "stop")
      .mockImplementation(() => {
        authenticatedId = null;
      });
    const agent = new DealAgent("t-legacy", [ASSISTANT_WITH_TOOL]);
    const core = new CopilotKitCore({
      agents__unsafe_dev_only: { default: agent },
    });
    const subscribeCore = vi.spyOn(core, "subscribe");
    const subscribeAgent = vi.spyOn(agent, "subscribe");
    const bridge = new LearningBridge(core, createConfig());
    await bridge.start({ trajectoryId: "legacy" });
    const legacySubscriber = subscribeCore.mock.calls[0]![0];
    const unsubscribeCore = vi.spyOn(
      subscribeCore.mock.results[0]!.value,
      "unsubscribe",
    );
    const unsubscribeAgent = vi.spyOn(
      subscribeAgent.mock.results[0]!.value,
      "unsubscribe",
    );
    expect(
      bridge.enrich(targetIn({ "data-message-id": "m-assistant" })),
    ).toMatchObject({ threadId: "t-legacy" });
    stop.mockClear();

    bridge.setConfig({});
    await expect(bridge.start({ trajectoryId })).resolves.toEqual({
      status: "started",
      trajectoryId,
    });
    expect(unsubscribeCore).toHaveBeenCalledOnce();
    expect(unsubscribeAgent).toHaveBeenCalledOnce();
    expect(
      bridge.enrich(targetIn({ "data-message-id": "m-assistant" })),
    ).toEqual({ threadId: null });
    batches = [];

    // A Core callback already in flight must not reattach legacy tracking.
    const clone = new DealAgent("t-authenticated", [ASSISTANT_WITH_TOOL]);
    const subscribeClone = vi.spyOn(clone, "subscribe");
    await legacySubscriber.onAgentRunStarted?.({
      copilotkit: core,
      agent: clone,
    });
    expect(subscribeClone).not.toHaveBeenCalled();
    await core.runAgent({ agent: clone });
    bridge.registerOpenThread({
      agentId: "default",
      threadId: "t-authenticated",
    });
    expect(drain()).toEqual([]);
    expect(subscribeCore).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledOnce();
    expect(stop).not.toHaveBeenCalled();
    expect(bridge.trajectoryId).toBe(trajectoryId);
    bridge.stop();
  });

  it("subscribes only while active and reattaches current Core agents after stop", () => {
    const agent = new DealAgent("t-1", [ASSISTANT_WITH_TOOL]);
    const core = new CopilotKitCore({
      agents__unsafe_dev_only: { default: agent },
    });
    const subscribeCore = vi.spyOn(core, "subscribe");
    const subscribeAgent = vi.spyOn(agent, "subscribe");
    const bridge = new LearningBridge(core, createConfig());
    const target = targetIn({ "data-message-id": "m-assistant" });

    expect(subscribeCore).not.toHaveBeenCalled();
    expect(subscribeAgent).not.toHaveBeenCalled();
    expect(bridge.enrich(target)).toEqual({ threadId: null });

    bridge.start({ trajectoryId: "same" });
    bridge.start({ trajectoryId: "same" });
    expect(subscribeCore).toHaveBeenCalledTimes(1);
    expect(subscribeAgent).toHaveBeenCalledTimes(1);
    expect(bridge.enrich(target)).toMatchObject({ messageId: "m-assistant" });
    const unsubscribeCore = vi.spyOn(
      subscribeCore.mock.results[0]!.value,
      "unsubscribe",
    );
    const unsubscribeAgent = vi.spyOn(
      subscribeAgent.mock.results[0]!.value,
      "unsubscribe",
    );

    bridge.stop();
    bridge.stop();
    expect(unsubscribeCore).toHaveBeenCalledTimes(1);
    expect(unsubscribeAgent).toHaveBeenCalledTimes(1);
    expect(bridge.enrich(target)).toEqual({ threadId: null });

    bridge.start({ trajectoryId: "same" });
    expect(subscribeCore).toHaveBeenCalledTimes(2);
    expect(subscribeAgent).toHaveBeenCalledTimes(2);
    expect(bridge.enrich(target)).toMatchObject({ messageId: "m-assistant" });
    bridge.setConfig(undefined);
    expect(bridge.enrich(target)).toEqual({ threadId: null });
  });

  it("does not retain per-thread clones across stopped capture", async () => {
    const core = new CopilotKitCore({});
    const bridge = new LearningBridge(core, createConfig());
    const clone = new DealAgent("t-clone");
    const target = targetIn({ "data-message-id": "m-reply" });

    await core.runAgent({ agent: clone });
    expect(bridge.enrich(target)).toEqual({ threadId: null });
    bridge.start({ trajectoryId: "same" });
    await core.runAgent({ agent: clone });
    expect(bridge.enrich(target)).toMatchObject({ threadId: "t-clone" });
    bridge.stop();
    batches = [];

    await core.runAgent({ agent: clone });
    expect(drain()).toEqual([]);
    expect(bridge.enrich(target)).toEqual({ threadId: null });
    bridge.start({ trajectoryId: "same" });
    expect(bridge.enrich(target)).toEqual({ threadId: null });
    await core.runAgent({ agent: clone });
    expect(valuesOf(drain(), "agent.run").map((value) => value.phase)).toEqual([
      "started",
      "finished",
    ]);
    bridge.stop();
  });

  it.each(["client", "server"])(
    "releases completed %s tool-call origins while preserving click attribution",
    async (execution) => {
      const agent = new DealAgent("t-clone", [], execution === "server");
      const subscribeAgent = vi.spyOn(agent, "subscribe");
      const core = new CopilotKitCore({
        tools: [
          {
            name: "approveDeal",
            handler: async () => {
              const onResult = subscribeAgent.mock.calls
                .map(([subscriber]) => subscriber.onToolCallResultEvent)
                .find((callback) => callback !== undefined);
              expect(onResult).toBeTypeOf("function");
              // A streamed result may precede the local execution-end callback.
              await onResult?.({
                event: {
                  type: EventType.TOOL_CALL_RESULT,
                  toolCallId: "tc-9",
                  messageId: "m-tool-result",
                  content: "approved",
                },
                agent,
                messages: agent.messages,
                state: agent.state,
                input: {
                  threadId: agent.threadId,
                  runId: "run-result",
                  messages: [],
                  state: {},
                  tools: [],
                  context: [],
                  forwardedProps: {},
                },
              });
              return "approved";
            },
            followUp: false,
          },
        ],
      });
      const subscribeCore = vi.spyOn(core, "subscribe");
      const bridge = new LearningBridge(core, createConfig());
      bridge.start({ trajectoryId: "same" });
      const subscriber = subscribeCore.mock.calls[0]![0];
      await core.runAgent({ agent });

      expect(valuesOf(drain(), "tool.call").at(-1)).toMatchObject({
        phase: execution === "client" ? "completed" : "started",
        ...(execution === "client" ? { outcome: "ok" } : {}),
        threadId: "t-clone",
        messageId: "m-reply",
      });
      expect(
        bridge.enrich(
          targetIn({
            "data-message-id": "m-reply",
            "data-tool-call-id": "tc-9",
          }),
        ),
      ).toMatchObject({
        threadId: "t-clone",
        toolCallId: "tc-9",
        toolStatus: "complete",
      });

      // A later execution with the same ID must not inherit a completed call's origin.
      await subscriber.onToolExecutionStart?.({
        copilotkit: core,
        toolCallId: "tc-9",
        agentId: "default",
        toolName: "approveDeal",
        args: {},
      });
      expect(valuesOf(drain(), "tool.call").at(-1)).toMatchObject({
        phase: "executing",
        threadId: null,
      });
      bridge.stop();
    },
  );
});
