import { AbstractAgent, EventType } from "@ag-ui/client";
import type {
  BaseEvent,
  Interrupt,
  Message,
  RunAgentInput,
} from "@ag-ui/client";
import { setImmediate } from "node:timers/promises";
import { ɵgetAgentInterruptState } from "../interrupt-state";
import { from } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { CopilotKitCore } from "../core";
import { createTool } from "./test-utils";

const frontendInterrupts: Interrupt[] = ["one", "two"].map((id) => ({
  id: `interrupt-${id}`,
  reason: "tool_call",
  toolCallId: id,
}));
const calls: Message[] = [
  {
    id: "assistant",
    role: "assistant",
    content: "",
    toolCalls: ["one", "two"].map((id) => ({
      id,
      type: "function",
      function: { name: "chart", arguments: "{}" },
    })),
  },
];

class FrontendInterruptAgent extends AbstractAgent {
  inputs: RunAgentInput[] = [];
  constructor(
    readonly interrupts = frontendInterrupts,
    readonly history = calls,
  ) {
    super({ agentId: "frontend", threadId: "thread" });
  }
  private replay(input: RunAgentInput): BaseEvent[] {
    return [
      {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      },
      {
        type: EventType.MESSAGES_SNAPSHOT,
        messages: structuredClone(this.history),
      },
      {
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
        outcome: { type: "interrupt", interrupts: this.interrupts },
      },
    ];
  }
  protected connect(input: RunAgentInput) {
    return from(this.replay(input));
  }
  run(input: RunAgentInput) {
    this.inputs.push(structuredClone(input));
    if (this.inputs.length === 1 && !input.resume)
      return from(this.replay(input));
    return from([
      {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      },
      {
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      },
    ]);
  }
}

function setup(
  agent = new FrontendInterruptAgent(),
  handler: (() => Promise<string>) | undefined = undefined,
  reconnectBehavior?: "resume-pending",
) {
  const core = new CopilotKitCore({});
  core.addAgent__unsafe_dev_only({ id: "frontend", agent });
  core.addTool(
    createTool({
      name: "chart",
      handler,
      followUp: true,
      reconnectBehavior,
    }),
  );
  return { core, agent };
}

function expectResults(input: RunAgentInput) {
  expect(input.resume).toEqual(
    frontendInterrupts.map((interrupt) => ({
      interruptId: interrupt.id,
      status: "resolved",
      payload: "",
    })),
  );
  expect(
    input.messages
      .filter((m) => m.role === "tool")
      .map((m) => [m.toolCallId, m.content]),
  ).toEqual([
    ["one", ""],
    ["two", ""],
  ]);
}

describe("frontend results satisfy only their own interrupts", () => {
  it.each([false, true])(
    "continues parallel frontend calls with their actual empty results (handler %s)",
    async (hasHandler) => {
      const handler = vi.fn(async () => "");
      const { core, agent } = setup(
        undefined,
        hasHandler ? handler : undefined,
      );
      await core.runAgent({ agent });
      expect(agent.inputs).toHaveLength(2);
      expectResults(agent.inputs[1]!);
      expect(handler).toHaveBeenCalledTimes(hasHandler ? 2 : 0);
    },
  );

  it.each(["human_approval", "tool_call"])(
    "keeps an unanswered %s child interrupt pending",
    async (reason) => {
      const child: Interrupt = {
        id: "child-question",
        reason,
        toolCallId: "child-call",
      };
      const { core, agent } = setup(
        new FrontendInterruptAgent([...frontendInterrupts, child]),
      );
      await core.runAgent({ agent });
      expect(agent.inputs).toHaveLength(1);
      expect(agent.pendingInterrupts).toEqual([...frontendInterrupts, child]);
      expect(agent.messages.filter((m) => m.role === "tool")).toHaveLength(2);
    },
  );

  it("reuses saved results after reload without invoking handlers again", async () => {
    const history: Message[] = [
      ...calls,
      ...["one", "two"].map((id) => ({
        id: `result-${id}`,
        role: "tool" as const,
        toolCallId: id,
        content: "",
      })),
    ];
    const handler = vi.fn(async () => "wrong");
    const { core, agent } = setup(
      new FrontendInterruptAgent(frontendInterrupts, history),
      handler,
    );
    await core.connectAgent({ agent });
    await vi.waitFor(() => expect(agent.inputs).toHaveLength(1));
    expectResults(agent.inputs[0]!);
    expect(handler).not.toHaveBeenCalled();
  });
});

function savedHistory(error?: string): Message[] {
  return [
    ...calls,
    ...["one", "two"].map((id) => ({
      id: `result-${id}`,
      role: "tool" as const,
      toolCallId: id,
      content: "",
      ...(id === "two" && error !== undefined ? { error } : {}),
    })),
  ];
}

describe("review regressions", () => {
  it.each(["failed", ""])(
    "does not automatically resume a saved failure %j alongside success",
    async (error) => {
      const handler = vi.fn(async () => "wrong");
      const { core, agent } = setup(
        new FrontendInterruptAgent(frontendInterrupts, savedHistory(error)),
        handler,
      );
      await core.connectAgent({ agent });
      await setImmediate();
      expect(agent.inputs).toHaveLength(0);
      expect(handler).not.toHaveBeenCalled();
      expect(agent.messages).toEqual(savedHistory(error));
    },
  );

  it("does not resume a saved failure alone", async () => {
    const history = savedHistory("stopped").filter(
      (m) => m.role !== "tool" || m.toolCallId === "two",
    );
    const handler = vi.fn(async () => "wrong");
    const { core, agent } = setup(
      new FrontendInterruptAgent([frontendInterrupts[1]!], history),
      handler,
    );
    await core.connectAgent({ agent });
    await setImmediate();
    expect(agent.inputs).toHaveLength(0);
    expect(handler).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "leaves an unanswered passive call intact (placeholder %s)",
    async (placeholder) => {
      const history: Message[] = placeholder
        ? [
            ...calls,
            {
              id: "placeholder",
              role: "tool",
              toolCallId: "one",
              content: "Forwarded to client",
            },
          ]
        : calls;
      const handler = vi.fn(async () => "wrong");
      const { core, agent } = setup(
        new FrontendInterruptAgent(frontendInterrupts, history),
        handler,
      );
      await core.connectAgent({ agent });
      await setImmediate();
      expect(agent.inputs).toHaveLength(0);
      expect(handler).not.toHaveBeenCalled();
      expect(agent.messages).toEqual(history);
    },
  );

  it.each(["reconnect", "thread", "manual"])(
    "discards a delayed restoration superseded by %s",
    async (replacement) => {
      const { core, agent } = setup(
        new FrontendInterruptAgent(frontendInterrupts, savedHistory()),
        vi.fn(async () => "wrong"),
      );
      const releases: (() => void)[] = [];
      const scheduler = vi
        .spyOn(core, "waitForPendingFrameworkUpdates")
        .mockImplementation(
          () => new Promise<void>((resolve) => releases.push(resolve)),
        );
      await core.connectAgent({ agent });
      await vi.waitFor(() => expect(releases).toHaveLength(1));
      if (replacement === "reconnect") {
        await core.connectAgent({ agent });
        await vi.waitFor(() => expect(releases).toHaveLength(2));
      } else if (replacement === "thread") {
        agent.threadId = "other-thread";
      } else {
        await core.runAgent({
          agent,
          resume: frontendInterrupts.map((i) => ({
            interruptId: i.id,
            status: "resolved",
            payload: "",
          })),
        });
      }
      for (const release of releases) release();
      await setImmediate();
      expect(agent.inputs).toHaveLength(replacement === "thread" ? 0 : 1);
      scheduler.mockRestore();
    },
  );

  it("keeps a stopped live HITL chain paused after reconnect", async () => {
    const history = structuredClone(calls);
    const agent = new FrontendInterruptAgent(
      structuredClone(frontendInterrupts),
      history,
    );
    const core = new CopilotKitCore({});
    core.addAgent__unsafe_dev_only({ id: "frontend", agent });
    const handler = vi.fn(
      (_args, context) =>
        new Promise<string>((_resolve, reject) => {
          context.signal.addEventListener(
            "abort",
            () => reject(new Error("Stopped")),
            { once: true },
          );
        }),
    );
    core.addTool(
      createTool({
        name: "chart",
        type: "human-in-the-loop",
        handler,
        followUp: true,
      }),
    );
    const running = core.runAgent({ agent });
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    core.stopAgent({ agent });
    await running;
    expect(agent.inputs).toHaveLength(1);
    const stopped = structuredClone(agent.messages);
    expect(stopped).toContainEqual(
      expect.objectContaining({
        role: "tool",
        toolCallId: "one",
        error: "Stopped",
      }),
    );
    // Reconnect the completed/failed call only; no new unanswered work.
    agent.interrupts.splice(1);
    const assistant = stopped.find((m) => m.role === "assistant");
    if (assistant?.role === "assistant")
      assistant.toolCalls = assistant.toolCalls?.slice(0, 1);
    history.splice(0, history.length, ...stopped);
    await core.connectAgent({ agent });
    await setImmediate();
    expect(agent.inputs).toHaveLength(1);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(agent.messages).toEqual(stopped);
  });

  it.each(["resolved", "cancelled"] as const)(
    "retains an early %s approval until the frontend completes",
    async (status) => {
      let finish!: (value: string) => void;
      const result = new Promise<string>((resolve) => {
        finish = resolve;
      });
      const approval: Interrupt = { id: "approval", reason: "approval" };
      const { core, agent } = setup(
        new FrontendInterruptAgent([...frontendInterrupts, approval]),
        () => result,
      );
      const run = core.runAgent({ agent });
      await vi.waitFor(() => expect(agent.pendingInterrupts).toHaveLength(3));
      const state = ɵgetAgentInterruptState(agent);
      expect(
        status === "resolved"
          ? state.resolve("allow", "approval", agent.messages)
          : state.cancel("approval", agent.messages),
      ).toEqual({ kind: "waiting" });
      finish("");
      await run;
      expect(agent.inputs).toHaveLength(2);
      expect(agent.inputs[1]!.resume?.at(-1)).toEqual({
        interruptId: "approval",
        status,
        ...(status === "resolved" ? { payload: "allow" } : {}),
      });
      expect(
        agent.inputs[1]!.messages.filter((m) => m.role === "tool"),
      ).toHaveLength(2);
    },
  );
});

it("starts a fresh batch for a new run even when interrupt IDs are reused", async () => {
  const { core, agent } = setup();
  await core.runAgent({ agent });
  expect(agent.inputs).toHaveLength(2);
  agent.inputs.length = 0;
  agent.setMessages([]);
  await core.runAgent({ agent });
  expect(agent.inputs).toHaveLength(2);
  expectResults(agent.inputs[1]!);
});
