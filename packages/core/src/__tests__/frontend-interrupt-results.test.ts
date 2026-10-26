import { AbstractAgent, EventType } from "@ag-ui/client";
import type {
  BaseEvent,
  Interrupt,
  Message,
  RunAgentInput,
} from "@ag-ui/client";
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
) {
  const core = new CopilotKitCore({});
  core.addAgent__unsafe_dev_only({ id: "frontend", agent });
  core.addTool(
    createTool({
      name: "chart",
      handler,
      followUp: true,
      reconnectBehavior: "resume-pending",
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
