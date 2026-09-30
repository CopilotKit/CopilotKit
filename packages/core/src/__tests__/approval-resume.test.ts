import { describe, expect, it } from "vitest";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type {
  BaseEvent,
  RunAgentInput,
  RunFinishedEvent,
  RunStartedEvent,
  TextMessageChunkEvent,
  ToolCallChunkEvent,
  CustomEvent,
} from "@ag-ui/client";
import { from, throwError } from "rxjs";
import { CopilotKitCore } from "../core";
import { createTool } from "./test-utils";
import { StateManager } from "../core/state-manager";

class ApprovalAgent extends AbstractAgent {
  inputs: RunAgentInput[] = [];
  history: BaseEvent[] = [];
  failNext = false;
  interruptNext = true;
  legacy = false;
  frontendToolNext = false;

  run(input: RunAgentInput) {
    this.inputs.push(input);
    if (this.failNext) {
      this.failNext = false;
      return throwError(() => new Error("start rejected"));
    }
    const start: RunStartedEvent = {
      type: EventType.RUN_STARTED,
      threadId: input.threadId,
      runId: input.runId,
      input,
    };
    const text: TextMessageChunkEvent = {
      type: EventType.TEXT_MESSAGE_CHUNK,
      messageId: `message-${input.runId}`,
      role: "assistant",
      delta: this.interruptNext ? "Approve?" : "Approved.",
    };
    const finish: RunFinishedEvent = {
      type: EventType.RUN_FINISHED,
      threadId: input.threadId,
      runId: input.runId,
      outcome:
        this.interruptNext && !this.legacy
          ? {
              type: "interrupt",
              interrupts: [
                { id: "approval-one", reason: "confirmation" },
                { id: "approval-two", reason: "confirmation" },
              ],
            }
          : { type: "success" },
    };
    const events: BaseEvent[] = [start, text];
    if (this.legacy && this.interruptNext)
      events.push({
        type: EventType.CUSTOM,
        name: "on_interrupt",
        value: "approve?",
      } satisfies CustomEvent);
    if (this.frontendToolNext) {
      const call: ToolCallChunkEvent = {
        type: EventType.TOOL_CALL_CHUNK,
        toolCallId: "frontend-call",
        toolCallName: "afterApproval",
        parentMessageId: `message-${input.runId}`,
        delta: "{}",
      };
      events.push(call);
      this.frontendToolNext = false;
    }
    this.interruptNext = false;
    events.push(finish);
    this.history.push(...events);
    return from(events);
  }

  protected connect() {
    return from(this.history);
  }
}

const resume: RunAgentInput["resume"] = [
  {
    interruptId: "approval-one",
    status: "resolved",
    payload: { approved: true },
  },
  { interruptId: "approval-two", status: "cancelled" },
];

function setup() {
  const core = new CopilotKitCore({});
  const agent = new ApprovalAgent({
    agentId: "approval",
    threadId: "thread-one",
  });
  core.addAgent__unsafe_dev_only({ id: "approval", agent });
  return { core, agent };
}

describe("approval resume identity", () => {
  it.each([undefined, "caller-new-id"])(
    "keeps empty-state history together with fresh wire ID %s",
    async (runId) => {
      const { core, agent } = setup();
      await core.runAgent({ agent, runId: "original" });
      await core.runAgent({ agent, resume, ...(runId ? { runId } : {}) });
      const resumed = agent.inputs[1]!;
      expect(resumed.runId).not.toBe("original");
      if (runId) expect(resumed.runId).toBe("caller-new-id");
      expect(resumed.resume).toEqual(resume);
      expect(
        core.getRunIdForMessage(
          "approval",
          "thread-one",
          `message-${resumed.runId}`,
        ),
      ).toBe("original");
      expect(agent.messages.map((message) => message.content)).toEqual([
        "Approve?",
        "Approved.",
      ]);
    },
  );

  it("restores logical associations from real saved run inputs", async () => {
    const { core, agent } = setup();
    await core.runAgent({ agent, runId: "original" });
    await core.runAgent({ agent, resume, runId: "successor" });
    const restored = setup();
    restored.agent.history = agent.history;
    await restored.core.connectAgent({ agent: restored.agent });
    expect(
      restored.core.getRunIdForMessage(
        "approval",
        "thread-one",
        "message-successor",
      ),
    ).toBe("original");
    expect(restored.agent.messages.map((message) => message.content)).toEqual([
      "Approve?",
      "Approved.",
    ]);
  });

  it("retains pending identity after a rejected start", async () => {
    const { core, agent } = setup();
    await core.runAgent({ agent, runId: "original" });
    agent.failNext = true;
    expect(await core.runAgent({ agent, resume })).toEqual({
      result: undefined,
      newMessages: [],
    });
    await core.runAgent({ agent, resume, runId: "retry" });
    expect(
      core.getRunIdForMessage("approval", "thread-one", "message-retry"),
    ).toBe("original");
  });

  it("does not group a different interrupt set with the previous run", async () => {
    const { core, agent } = setup();
    await core.runAgent({ agent, runId: "original" });
    await core.runAgent({
      agent,
      resume: [{ interruptId: "other", status: "cancelled" }],
      runId: "unrelated",
    });
    expect(agent.inputs).toHaveLength(1);
    expect(
      core.getRunIdForMessage("approval", "thread-one", "message-unrelated"),
    ).toBeUndefined();
  });

  it("does not carry interrupted identity to another thread", async () => {
    const { core, agent } = setup();
    await core.runAgent({ agent, runId: "original" });
    agent.threadId = "thread-two";
    await core.runAgent({ agent, resume, runId: "other-thread" });
    expect(
      core.getRunIdForMessage("approval", "thread-two", "message-other-thread"),
    ).toBe("other-thread");
  });
  it.each([undefined, { approved: true }])(
    "keeps legacy resume history with payload %s",
    async (payload) => {
      const { core, agent } = setup();
      agent.legacy = true;
      await core.runAgent({ agent, runId: "legacy-original" });
      await core.runAgent({
        agent,
        forwardedProps: { command: { resume: payload } },
        runId: "legacy-new",
      });
      expect(agent.inputs[1]?.runId).toBe("legacy-new");
      expect(
        core.getRunIdForMessage("approval", "thread-one", "message-legacy-new"),
      ).toBe("legacy-original");
    },
  );

  it("groups repeated approval cycles but separates the next ordinary run", async () => {
    const { core, agent } = setup();
    await core.runAgent({ agent, runId: "original" });
    agent.interruptNext = true;
    await core.runAgent({ agent, resume, runId: "second" });
    await core.runAgent({ agent, resume, runId: "third" });
    await core.runAgent({ agent, runId: "ordinary" });
    expect(agent.inputs.map((input) => input.runId)).toEqual([
      "original",
      "second",
      "third",
      "ordinary",
    ]);
    expect(
      core.getRunIdForMessage("approval", "thread-one", "message-second"),
    ).toBe("original");
    expect(
      core.getRunIdForMessage("approval", "thread-one", "message-third"),
    ).toBe("original");
    expect(
      core.getRunIdForMessage("approval", "thread-one", "message-ordinary"),
    ).toBe("ordinary");
  });

  it.each(["thread", "agent", "replacement"])(
    "clears interrupted history after %s cleanup",
    async (cleanup) => {
      const { core, agent } = setup();
      const state = new StateManager(core);
      state.subscribeToAgent(agent);
      await core.runAgent({ agent, runId: "original" });
      if (cleanup === "thread")
        state.clearThreadState("approval", "thread-one");
      if (cleanup === "agent") state.clearAgentState("approval");
      if (cleanup === "replacement")
        state.subscribeToAgent(
          new ApprovalAgent({ agentId: "approval", threadId: "thread-one" }),
        );
      await agent.runAgent({ resume, runId: "after-cleanup" });
      expect(
        state.getRunIdForMessage(
          "approval",
          "thread-one",
          "message-after-cleanup",
        ),
      ).toBe(cleanup === "replacement" ? undefined : "after-cleanup");
    },
  );
  it("resumes an interrupted run restored after reload", async () => {
    const original = setup();
    await original.core.runAgent({ agent: original.agent, runId: "original" });
    const { core, agent } = setup();
    agent.history = original.agent.history;
    agent.interruptNext = false;
    await core.connectAgent({ agent });
    await core.runAgent({ agent, resume, runId: "after-reload" });
    expect(agent.inputs[0]?.resume).toEqual(resume);
    expect(
      core.getRunIdForMessage("approval", "thread-one", "message-after-reload"),
    ).toBe("original");
  });

  it("keeps a frontend follow-up after approval in the same logical run", async () => {
    const { core, agent } = setup();
    core.addTool(
      createTool({
        name: "afterApproval",
        handler: async () => "done",
        followUp: true,
      }),
    );
    await core.runAgent({ agent, runId: "original" });
    agent.frontendToolNext = true;
    await core.runAgent({ agent, resume, runId: "resumed" });
    expect(agent.inputs).toHaveLength(3);
    const followUp = agent.inputs[2]!;
    expect(followUp.runId).not.toBe("resumed");
    expect(followUp.runId).not.toBe("original");
    expect(
      core.getRunIdForMessage(
        "approval",
        "thread-one",
        `message-${followUp.runId}`,
      ),
    ).toBe("original");
    expect(agent.messages.filter((message) => message.role === "tool")).toEqual(
      [
        expect.objectContaining({
          toolCallId: "frontend-call",
          content: "done",
        }),
      ],
    );
  });
});
