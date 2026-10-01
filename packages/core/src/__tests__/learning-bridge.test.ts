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
import type { LearningConfig } from "../core/learning-bridge";

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
  constructor(threadId: string, initialMessages: Message[] = []) {
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

function createConfig(overrides: Partial<LearningConfig> = {}): LearningConfig {
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
  // Core tests run in Node; capture needs only these two browser globals here.
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("location", new URL("http://localhost/learning"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Core learning wiring", () => {
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

  it("adds assistant text only when agentText is on", async () => {
    const off = new CopilotKitCore({ learning: createConfig() });
    off.startTrajectory({ trajectoryId: "off" });
    await off.runAgent({ agent: new DealAgent("t-off") });
    const withoutText = valuesOf(drain(), "agent.message").find(
      (value) => value.role === "assistant",
    );

    batches = [];
    const on = new CopilotKitCore({
      learning: createConfig({
        capture: {
          clicks: false,
          navigation: false,
          network: false,
          agentText: true,
        },
      }),
    });
    on.startTrajectory({ trajectoryId: "on" });
    await on.runAgent({ agent: new DealAgent("t-on") });
    const withText = valuesOf(drain(), "agent.message").find(
      (value) => value.role === "assistant",
    );

    expect(withoutText).not.toHaveProperty("text");
    expect(withText).toMatchObject({ text: "Please approve." });
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
    return new LearningBridge(core, createConfig());
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
  });

  it("falls back to the single open Thread, then to null", () => {
    const bridge = createBridge();
    expect(bridge.enrich(targetIn({}))).toEqual({ threadId: null });

    bridge.registerOpenThread({ agentId: "default", threadId: "t-1" });
    bridge.registerOpenThread({ agentId: "default", threadId: "t-1" });
    expect(bridge.enrich(targetIn({}))).toEqual({ threadId: "t-1" });
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
  });
});
