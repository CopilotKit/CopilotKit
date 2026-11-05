import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput, ResumeEntry } from "@ag-ui/client";
import { of } from "rxjs";
import { describe, expect, it } from "vitest";
import { CopilotKitCore } from "../core";
import { ɵcontinueNativeApproval } from "../native-approval-continuation";
class NativeAgent extends AbstractAgent {
  inputs: RunAgentInput[] = [];
  pending = ["one", "two"];
  run(input: RunAgentInput) {
    this.inputs.push(input);
    this.pending = this.pending.filter(
      (id) => !input.resume?.some((r) => r.interruptId === id),
    );
    const events: BaseEvent[] = [
      {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      },
      {
        type: EventType.MESSAGES_SNAPSHOT,
        messages: [
          {
            id: "calls",
            role: "assistant",
            toolCalls: ["one", "two"].map((id) => ({
              id: `call-${id}`,
              type: "function",
              function: { name: "protected", arguments: "{}" },
            })),
          },
        ],
      },
      {
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
        outcome: this.pending.length
          ? {
              type: "interrupt",
              interrupts: this.pending.map((id) => ({
                id,
                reason: "tool_call",
                toolCallId: `call-${id}`,
                metadata: { "ag-ui:tool-execution": "server" },
              })),
            }
          : { type: "success" },
      },
    ];
    return of(...events);
  }
}
const choice = (id: string): ResumeEntry => ({
  interruptId: id,
  status: "resolved",
  payload: { approved: id === "one" },
});
async function setup() {
  const core = new CopilotKitCore({});
  const agent = new NativeAgent({
    agentId: "test",
    allowPartialNativeApprovals: true,
  });
  core.addAgent__unsafe_dev_only({ id: "test", agent });
  await core.runAgent({ agent });
  return {
    agent,
    core,
    run: (response: ResumeEntry) =>
      core.runAgent({ agent, nativeApprovalContinuation: [response] }),
  };
}
describe("durable individual native decisions", () => {
  it("sends each real choice immediately and serializes rapid responses without tool messages", async () => {
    const { agent, run } = await setup();
    const first = ɵcontinueNativeApproval(agent, choice("one"), run);
    const second = ɵcontinueNativeApproval(agent, choice("two"), run);
    await Promise.all([first, second]);
    expect(agent.inputs.slice(1).map((i) => i.resume)).toEqual([
      [choice("one")],
      [choice("two")],
    ]);
    expect(agent.inputs.slice(1).map((i) => i.messages)).toEqual([[], []]);
    expect(agent.pendingInterrupts).toEqual([]);
    expect(agent.messages.some((m) => m.role === "tool")).toBe(false);
  });
  it("retains default and frontend handling", async () => {
    const { agent, run } = await setup();
    agent.allowPartialNativeApprovals = false;
    expect(ɵcontinueNativeApproval(agent, choice("one"), run)).toBeUndefined();
    agent.allowPartialNativeApprovals = true;
    agent.pendingInterrupts[0]!.metadata = {};
    expect(ɵcontinueNativeApproval(agent, choice("one"), run)).toBeUndefined();
    expect(agent.inputs).toHaveLength(1);
  });
  it("rejects a queued choice after a thread switch", async () => {
    const { agent, run } = await setup();
    const pending = ɵcontinueNativeApproval(agent, choice("one"), run);
    agent.threadId = "different";
    await expect(pending).rejects.toThrow(/current pending batch/);
    expect(agent.inputs).toHaveLength(1);
  });
  it("rejects duplicate queued decisions after authoritative acceptance", async () => {
    const { agent, run } = await setup();
    const first = ɵcontinueNativeApproval(agent, choice("one"), run);
    const duplicate = ɵcontinueNativeApproval(agent, choice("one"), run);
    const rejected = expect(duplicate).rejects.toThrow(/current pending batch/);
    await first;
    await rejected;
    expect(agent.inputs).toHaveLength(2);
  });
  it("captures an immutable choice and rejects revocation before dispatch", async () => {
    const { agent, run } = await setup();
    const response = choice("one");
    const first = ɵcontinueNativeApproval(agent, response, run);
    response.payload = { approved: false };
    await first;
    expect(agent.inputs[1]?.resume).toEqual([choice("one")]);
    const second = ɵcontinueNativeApproval(agent, choice("two"), run);
    agent.allowPartialNativeApprovals = false;
    await expect(second).rejects.toThrow(/current pending batch/);
    expect(agent.inputs).toHaveLength(2);
  });
});
