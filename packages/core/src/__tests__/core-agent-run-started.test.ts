import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { CopilotKitCore } from "../core";
import { MockAgent } from "./test-utils";

// Regression test for the inspector losing AG-UI events during runs.
//
// `useAgent` runs a per-thread *clone* of the registry agent. Clones are not
// added to the registry, so `onAgentsChanged` never fires for them and any
// subscriber that only tracks registry agents (the inspector) never sees the
// instance that actually runs. `onAgentRunStarted` bridges that gap by
// notifying subscribers with the real run instance at the start of every run.
describe("CopilotKitCore onAgentRunStarted", () => {
  let core: CopilotKitCore;

  beforeEach(() => {
    core = new CopilotKitCore({});
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fires with the actual run instance (a per-thread clone not in the registry)", async () => {
    const registryAgent = new MockAgent({ agentId: "default" });
    core.addAgent__unsafe_dev_only({
      id: "default",
      agent: registryAgent as any,
    });

    // The per-thread clone useAgent would run — same agentId, separate instance,
    // never registered.
    const clone = registryAgent.clone();
    expect(clone).not.toBe(registryAgent);
    expect(core.agents["default"]).toBe(registryAgent);

    const onAgentRunStarted = vi.fn();
    core.subscribe({ onAgentRunStarted });

    await core.runAgent({ agent: clone as any });

    expect(onAgentRunStarted).toHaveBeenCalledTimes(1);
    expect(onAgentRunStarted).toHaveBeenCalledWith({
      copilotkit: core,
      agent: clone,
    });
  });

  it("does not re-notify on recursive follow-up runs within the same top-level run", async () => {
    const onAgentRunStarted = vi.fn();
    core.subscribe({ onAgentRunStarted });

    // A tool follow-up re-enters runAgent while the top-level run is still on
    // the stack; the run depth guard must keep the notification to once.
    const agent = new MockAgent({
      agentId: "default",
      runAgentCallback: () => {
        if (agent.runAgentCalls.length === 1) {
          void core.runAgent({ agent: agent as any });
        }
      },
    });

    await core.runAgent({ agent: agent as any });

    expect(agent.runAgentCalls.length).toBeGreaterThan(1);
    expect(onAgentRunStarted).toHaveBeenCalledTimes(1);
  });
});
