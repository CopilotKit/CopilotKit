/**
 * Tests that context entries with agentId are correctly scoped:
 * - Global context (no agentId) is forwarded to all agents
 * - Scoped context (with agentId) is only forwarded to the matching agent
 * - Both runAgent and connectAgent respect context scoping
 */
import { describe, it, expect, beforeEach } from "vitest";
import { CopilotKitCore } from "../core";
import { MockAgent } from "./test-utils";

class MockAgentWithConnect extends MockAgent {
  public connectAgentCalls: any[] = [];

  async detachActiveRun(): Promise<void> {}

  setMessages(_messages: any[]): void {
    this.messages = _messages;
  }

  setState(_state: any): void {}

  async connectAgent(input: any): Promise<{ newMessages: any[] }> {
    this.connectAgentCalls.push(input);
    return { newMessages: [] };
  }
}

describe("Context agentId scoping", () => {
  let core: CopilotKitCore;

  beforeEach(() => {
    core = new CopilotKitCore({});
  });

  it("runAgent receives global context (no agentId)", async () => {
    core.addContext({ description: "global", value: "shared" });

    const agent = new MockAgent({ newMessages: [], agentId: "agent-a" });
    core.addAgent__unsafe_dev_only({ id: "agent-a", agent: agent as any });

    await core.runAgent({ agent: agent as any });

    expect(agent.runAgentCalls).toHaveLength(1);
    expect(agent.runAgentCalls[0].context).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ description: "global", value: "shared" }),
      ]),
    );
  });

  it("runAgent receives context scoped to its agentId", async () => {
    core.addContext({
      description: "for agent-a",
      value: "a-data",
      agentId: "agent-a",
    });

    const agent = new MockAgent({ newMessages: [], agentId: "agent-a" });
    core.addAgent__unsafe_dev_only({ id: "agent-a", agent: agent as any });

    await core.runAgent({ agent: agent as any });

    expect(agent.runAgentCalls).toHaveLength(1);
    expect(agent.runAgentCalls[0].context).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          description: "for agent-a",
          value: "a-data",
        }),
      ]),
    );
  });

  it("runAgent does NOT receive context scoped to a different agentId", async () => {
    core.addContext({
      description: "for agent-b",
      value: "b-data",
      agentId: "agent-b",
    });

    const agent = new MockAgent({ newMessages: [], agentId: "agent-a" });
    core.addAgent__unsafe_dev_only({ id: "agent-a", agent: agent as any });

    await core.runAgent({ agent: agent as any });

    expect(agent.runAgentCalls).toHaveLength(1);
    expect(agent.runAgentCalls[0].context).toEqual([]);
  });

  it("runAgent receives global context but filters out other agents' context", async () => {
    core.addContext({ description: "global", value: "for-all" });
    core.addContext({
      description: "for agent-a",
      value: "a-only",
      agentId: "agent-a",
    });
    core.addContext({
      description: "for agent-b",
      value: "b-only",
      agentId: "agent-b",
    });

    const agentA = new MockAgent({ newMessages: [], agentId: "agent-a" });
    core.addAgent__unsafe_dev_only({ id: "agent-a", agent: agentA as any });

    const agentB = new MockAgent({ newMessages: [], agentId: "agent-b" });
    core.addAgent__unsafe_dev_only({ id: "agent-b", agent: agentB as any });

    await core.runAgent({ agent: agentA as any });
    await core.runAgent({ agent: agentB as any });

    // Agent A sees global + its own scoped context
    const agentAContext = agentA.runAgentCalls[0].context;
    expect(agentAContext).toHaveLength(2);
    expect(agentAContext).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ description: "global", value: "for-all" }),
        expect.objectContaining({
          description: "for agent-a",
          value: "a-only",
        }),
      ]),
    );

    // Agent B sees global + its own scoped context
    const agentBContext = agentB.runAgentCalls[0].context;
    expect(agentBContext).toHaveLength(2);
    expect(agentBContext).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ description: "global", value: "for-all" }),
        expect.objectContaining({
          description: "for agent-b",
          value: "b-only",
        }),
      ]),
    );
  });

  it("connectAgent respects context agentId scoping", async () => {
    core.addContext({ description: "global", value: "shared" });
    core.addContext({
      description: "for agent-a",
      value: "a-data",
      agentId: "agent-a",
    });
    core.addContext({
      description: "for agent-b",
      value: "b-data",
      agentId: "agent-b",
    });

    const agent = new MockAgentWithConnect({
      newMessages: [],
      agentId: "agent-a",
    });
    core.addAgent__unsafe_dev_only({ id: "agent-a", agent: agent as any });

    await core.connectAgent({ agent: agent as any });

    expect(agent.connectAgentCalls).toHaveLength(1);
    const ctx = agent.connectAgentCalls[0].context;
    expect(ctx).toHaveLength(2);
    expect(ctx).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ description: "global", value: "shared" }),
        expect.objectContaining({
          description: "for agent-a",
          value: "a-data",
        }),
      ]),
    );
    // Should NOT contain agent-b's context
    expect(ctx).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ description: "for agent-b" }),
      ]),
    );
  });

  it("scoped context does not include agentId in the forwarded payload", async () => {
    core.addContext({
      description: "scoped",
      value: "data",
      agentId: "agent-a",
    });

    const agent = new MockAgent({ newMessages: [], agentId: "agent-a" });
    core.addAgent__unsafe_dev_only({ id: "agent-a", agent: agent as any });

    await core.runAgent({ agent: agent as any });

    const ctx = agent.runAgentCalls[0].context;
    expect(ctx).toHaveLength(1);
    // The forwarded context should only have description + value (AG-UI Context shape)
    expect(ctx[0]).toEqual({ description: "scoped", value: "data" });
    expect(ctx[0]).not.toHaveProperty("agentId");
  });
});
