import { readFileSync } from "node:fs";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { RunAgentInput, BaseEvent } from "@ag-ui/client";
import { from } from "rxjs";
import type { Observable } from "rxjs";
import { expect, it } from "vitest";
import { CopilotKitCore } from "../core";

const snapshot = {
  version: 1,
  decisions: [
    {
      requestId: "a",
      toolCallId: "call-a",
      approved: false,
      status: "waiting",
    },
  ],
};
class SavedDecisionAgent extends AbstractAgent {
  snapshot: unknown = structuredClone(snapshot);
  run(input: RunAgentInput): Observable<BaseEvent> {
    return from([
      {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      },
      {
        type: EventType.CUSTOM,
        name: "cpki.approval_decisions",
        value: this.snapshot,
      },
      {
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      },
    ]);
  }
  protected connect(input: RunAgentInput): Observable<BaseEvent> {
    return this.run(input);
  }
}
function setup() {
  const agent = new SavedDecisionAgent({
    agentId: "default",
    threadId: "original",
  });
  const core = new CopilotKitCore({});
  core.addAgent__unsafe_dev_only({ id: "default", agent });
  return { agent, core };
}
it("retains connect replay for late subscribers without creating results or pending controls", async () => {
  const { agent, core } = setup();
  await core.connectAgent({ agent });
  expect(core.getApprovalDecisions("default", "original")).toEqual(snapshot);
  expect(core.getApprovalDecisions("default", "other")).toBeUndefined();
  expect(agent.messages).toEqual([]);
  expect(agent.pendingInterrupts).toEqual([]);
  const copy = core.getApprovalDecisions("default", "original");
  if (copy && !("error" in copy)) copy.decisions.length = 0;
  expect(core.getApprovalDecisions("default", "original")).toEqual(snapshot);
  core.removeAgent__unsafe_dev_only("default");
  expect(core.getApprovalDecisions("default", "original")).toBeUndefined();
});
it.each([
  { version: 99 },
  { version: 1, decisions: [...snapshot.decisions, ...snapshot.decisions] },
])("marks invalid decision snapshots unavailable", async (invalid) => {
  const { agent, core } = setup();
  agent.snapshot = invalid;
  await core.runAgent({ agent });
  expect(core.getApprovalDecisions("default", "original")).toEqual({
    error: true,
  });
});
it("clears with an explicit empty snapshot and keeps another thread isolated", async () => {
  const { agent, core } = setup();
  await core.connectAgent({ agent });
  agent.threadId = "other";
  agent.snapshot = { version: 1, decisions: [] };
  await core.connectAgent({ agent });
  expect(core.getApprovalDecisions("default", "other")).toEqual({
    version: 1,
    decisions: [],
  });
  expect(core.getApprovalDecisions("default", "original")).toEqual(snapshot);
  agent.threadId = "original";
  await core.connectAgent({ agent });
  expect(core.getApprovalDecisions("default", "original")).toEqual({
    version: 1,
    decisions: [],
  });
});

it("captures decisions from agents supplied at construction", async () => {
  const agent = new SavedDecisionAgent({
    agentId: "default",
    threadId: "original",
  });
  const core = new CopilotKitCore({
    agents__unsafe_dev_only: { default: agent },
  });
  await core.connectAgent({ agent });
  expect(core.getApprovalDecisions("default", "original")).toEqual(snapshot);
});

it("replays the captured PNI-725 host decision while only B stays actionable", async () => {
  class HostCaptureAgent extends SavedDecisionAgent {
    run(): Observable<BaseEvent> {
      const data = readFileSync(
        new URL(
          "./fixtures/partial-approvals/native-waiting.sse",
          import.meta.url,
        ),
        "utf8",
      );
      return from(
        data
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map((line) => JSON.parse(line.slice(6))),
      );
    }
  }
  const agent = new HostCaptureAgent({
    agentId: "default",
    threadId: "thread-original",
  });
  const core = new CopilotKitCore({
    agents__unsafe_dev_only: { default: agent },
  });
  await core.connectAgent({ agent });
  expect(core.getApprovalDecisions("default", "thread-original")).toEqual({
    version: 1,
    decisions: [
      {
        requestId: "ficc_call-a",
        toolCallId: "call-a",
        approved: true,
        status: "waiting",
      },
    ],
  });
  expect(agent.pendingInterrupts.map((i) => i.id)).toEqual(["ficc_call-b"]);
  expect(agent.messages.filter((m) => m.role === "tool")).toEqual([]);
});

it("does not leak saved decisions when a registry ID is reused by a different agent", async () => {
  const { agent, core } = setup();
  await core.connectAgent({ agent });
  const replacement = new SavedDecisionAgent({
    agentId: "default",
    threadId: "original",
  });
  core.setAgents__unsafe_dev_only({ default: replacement });
  expect(core.getApprovalDecisions("default", "original")).toBeUndefined();
});
