import { describe, expect, it } from "vitest";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type {
  BaseEvent,
  RunAgentInput,
  RunFinishedEvent,
  RunStartedEvent,
  TextMessageChunkEvent,
} from "@ag-ui/client";
import { from } from "rxjs";
import { CopilotKitCore } from "../core";
import {
  MockAgent,
  createAssistantMessage,
  createToolCallMessage,
  createTool,
} from "./test-utils";

const requestIdOf = (input: { forwardedProps?: Record<string, unknown> }) =>
  input.forwardedProps?.__copilotkitRequestId;

/** Pauses its first run on an approval, then succeeds. */
class ApprovalAgent extends AbstractAgent {
  inputs: RunAgentInput[] = [];
  interruptNext = true;

  run(input: RunAgentInput) {
    this.inputs.push(input);
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
      outcome: this.interruptNext
        ? {
            type: "interrupt",
            interrupts: [{ id: "approval", reason: "confirmation" }],
          }
        : { type: "success" },
    };
    this.interruptNext = false;
    const events: BaseEvent[] = [start, text, finish];
    return from(events);
  }
}

const resume: RunAgentInput["resume"] = [
  { interruptId: "approval", status: "resolved", payload: { approved: true } },
];

function setupFollowUpAgent() {
  const core = new CopilotKitCore({});
  core.addTool(createTool({ name: "browserTool", followUp: true }));
  const agent = new MockAgent({
    newMessages: [createToolCallMessage("browserTool")],
  });
  core.addAgent__unsafe_dev_only({ id: "test", agent: agent as any });
  agent.runAgentCallback = () => {
    if (agent.runAgentCalls.length === 2) {
      agent.setNewMessages([createAssistantMessage({ content: "Done" })]);
    }
  };
  return { core, agent };
}

describe("CopilotKitCore.runAgent request id", () => {
  it("sends a request id with a new run", async () => {
    const core = new CopilotKitCore({});
    const agent = new MockAgent({ agentId: "test" });
    core.addAgent__unsafe_dev_only({ id: "test", agent: agent as any });

    await core.runAgent({ agent: agent as any });

    const requestId = requestIdOf(agent.runAgentCalls[0]);
    expect(typeof requestId).toBe("string");
    expect(requestId).not.toBe("");
  });

  it("sends a new request id for each new user request", async () => {
    const core = new CopilotKitCore({});
    const agent = new MockAgent({ agentId: "test" });
    core.addAgent__unsafe_dev_only({ id: "test", agent: agent as any });

    await core.runAgent({ agent: agent as any });
    await core.runAgent({ agent: agent as any });

    expect(requestIdOf(agent.runAgentCalls[1])).not.toBe(
      requestIdOf(agent.runAgentCalls[0]),
    );
  });

  it("reuses the request id for a frontend tool follow-up run", async () => {
    const { core, agent } = setupFollowUpAgent();

    await core.runAgent({ agent: agent as any });

    expect(agent.runAgentCalls).toHaveLength(2);
    expect(requestIdOf(agent.runAgentCalls[0])).toEqual(expect.any(String));
    expect(requestIdOf(agent.runAgentCalls[1])).toBe(
      requestIdOf(agent.runAgentCalls[0]),
    );
  });

  it("starts a new request id after a follow-up chain ends", async () => {
    const { core, agent } = setupFollowUpAgent();

    await core.runAgent({ agent: agent as any });
    await core.runAgent({ agent: agent as any });

    expect(requestIdOf(agent.runAgentCalls[2])).not.toBe(
      requestIdOf(agent.runAgentCalls[0]),
    );
  });

  it("sends a new request id for another agent's run that starts during a chain", async () => {
    const core = new CopilotKitCore({});
    const other = new MockAgent({ agentId: "other" });
    core.addAgent__unsafe_dev_only({ id: "other", agent: other as any });
    core.addTool(
      createTool({
        name: "startsOtherAgent",
        handler: async () => {
          await core.runAgent({ agent: other as any });
          return "started";
        },
      }),
    );
    const agent = new MockAgent({
      agentId: "test",
      newMessages: [createToolCallMessage("startsOtherAgent")],
    });
    core.addAgent__unsafe_dev_only({ id: "test", agent: agent as any });

    await core.runAgent({ agent: agent as any });

    expect(other.runAgentCalls).toHaveLength(1);
    expect(requestIdOf(other.runAgentCalls[0])).toEqual(expect.any(String));
    expect(requestIdOf(other.runAgentCalls[0])).not.toBe(
      requestIdOf(agent.runAgentCalls[0]),
    );
  });

  it("sends a new request id for a new run of the same agent during its chain", async () => {
    const core = new CopilotKitCore({});
    const agent = new MockAgent({
      agentId: "test",
      newMessages: [createToolCallMessage("waitsForUser")],
    });
    core.addAgent__unsafe_dev_only({ id: "test", agent: agent as any });
    agent.runAgentCallback = () => {
      if (agent.runAgentCalls.length === 1) return;
      agent.setNewMessages([createAssistantMessage({ content: "Done" })]);
    };
    core.addTool(
      createTool({
        name: "waitsForUser",
        // The user sends a new message while the tool waits for input.
        handler: async () => {
          await core.runAgent({ agent: agent as any });
          return "answered";
        },
      }),
    );

    await core.runAgent({ agent: agent as any });

    expect(requestIdOf(agent.runAgentCalls[1])).toEqual(expect.any(String));
    expect(requestIdOf(agent.runAgentCalls[1])).not.toBe(
      requestIdOf(agent.runAgentCalls[0]),
    );
  });

  it("reuses the request id when an approval resumes the paused run", async () => {
    const core = new CopilotKitCore({});
    const agent = new ApprovalAgent({
      agentId: "approval",
      threadId: "thread-one",
    });
    core.addAgent__unsafe_dev_only({ id: "approval", agent });

    await core.runAgent({ agent });
    await core.runAgent({ agent, resume });

    expect(agent.inputs).toHaveLength(2);
    expect(requestIdOf(agent.inputs[0]!)).toEqual(expect.any(String));
    expect(requestIdOf(agent.inputs[1]!)).toBe(requestIdOf(agent.inputs[0]!));
  });

  it("starts a new request id for a new message after an approval resume", async () => {
    const core = new CopilotKitCore({});
    const agent = new ApprovalAgent({
      agentId: "approval",
      threadId: "thread-one",
    });
    core.addAgent__unsafe_dev_only({ id: "approval", agent });

    await core.runAgent({ agent });
    await core.runAgent({ agent, resume });
    await core.runAgent({ agent });

    expect(requestIdOf(agent.inputs[2]!)).not.toBe(
      requestIdOf(agent.inputs[0]!),
    );
  });
});
