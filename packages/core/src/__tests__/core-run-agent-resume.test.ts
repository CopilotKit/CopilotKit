import { describe, expect, it, vi } from "vitest";
import { CopilotKitCore } from "../core/core";
import type { ResumeEntry } from "@ag-ui/client";

function makeAgent() {
  return {
    agentId: "agent-1",
    runAgent: vi.fn().mockResolvedValue({ result: undefined, newMessages: [] }),
    abortRun: vi.fn(),
    detachActiveRun: vi.fn().mockResolvedValue(undefined),
  } as any;
}

describe("CopilotKitCore.runAgent resume forwarding", () => {
  it("forwards a standard resume array to agent.runAgent", async () => {
    const core = new CopilotKitCore({});
    const agent = makeAgent();
    const resume: ResumeEntry[] = [
      { interruptId: "int-1", status: "resolved", payload: { approved: true } },
    ];

    await core.runAgent({ agent, resume });

    expect(agent.runAgent).toHaveBeenCalledTimes(1);
    expect(agent.runAgent.mock.calls[0][0]).toMatchObject({ resume });
  });

  it("omits resume from the agent call when not provided", async () => {
    const core = new CopilotKitCore({});
    const agent = makeAgent();

    await core.runAgent({ agent });

    expect(agent.runAgent).toHaveBeenCalledTimes(1);
    expect(agent.runAgent.mock.calls[0][0].resume).toBeUndefined();
  });

  it("forwards a caller-supplied runId to agent.runAgent", async () => {
    const core = new CopilotKitCore({});
    const agent = makeAgent();

    await core.runAgent({ agent, runId: "run-local-1" });

    expect(agent.runAgent).toHaveBeenCalledTimes(1);
    expect(agent.runAgent.mock.calls[0][0]).toMatchObject({
      runId: "run-local-1",
    });
  });
});
