/**
 * Tests that context registered via addContext (i.e. useCopilotReadable / useAgentContext)
 * is forwarded to the agent on both the runAgent and connectAgent paths.
 *
 * Regression for #3150: connectAgent was missing the context parameter that
 * runAgent already had, so useCopilotReadable context never reached the backend
 * on the initial CopilotChat connection.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { CopilotKitCore } from "../core";
import { MockAgent } from "./test-utils";

/**
 * Extends MockAgent with a connectAgent implementation so we can verify
 * that context is forwarded through the connectAgent path.
 */
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

describe("Context injection into agent input (#3150)", () => {
  let core: CopilotKitCore;

  beforeEach(() => {
    core = new CopilotKitCore({});
  });

  it("runAgent forwards context from ContextStore to agent", async () => {
    core.addContext({ description: "User name", value: "Alice" });
    core.addContext({ description: "Theme", value: "dark" });

    const agent = new MockAgent({ newMessages: [] });
    core.addAgent__unsafe_dev_only({ id: "test", agent: agent as any });

    await core.runAgent({ agent: agent as any });

    expect(agent.runAgentCalls).toHaveLength(1);
    expect(agent.runAgentCalls[0].context).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ description: "User name", value: "Alice" }),
        expect.objectContaining({ description: "Theme", value: "dark" }),
      ]),
    );
  });

  it("connectAgent forwards context from ContextStore to agent", async () => {
    core.addContext({ description: "User name", value: "Bob" });

    const agent = new MockAgentWithConnect({ newMessages: [] });
    core.addAgent__unsafe_dev_only({ id: "test", agent: agent as any });

    await core.connectAgent({ agent: agent as any });

    expect(agent.connectAgentCalls).toHaveLength(1);
    expect(agent.connectAgentCalls[0].context).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ description: "User name", value: "Bob" }),
      ]),
    );
  });

  it("connectAgent passes empty context array when no context is registered", async () => {
    const agent = new MockAgentWithConnect({ newMessages: [] });
    core.addAgent__unsafe_dev_only({ id: "test", agent: agent as any });

    await core.connectAgent({ agent: agent as any });

    expect(agent.connectAgentCalls).toHaveLength(1);
    expect(agent.connectAgentCalls[0].context).toEqual([]);
  });
});

describe("Per-agent context scoping (#5369)", () => {
  let core: CopilotKitCore;

  beforeEach(() => {
    core = new CopilotKitCore({});
  });

  it("runAgent forwards agent-scoped context only to runs of the listed agents", async () => {
    core.addContext({ description: "Global", value: "everyone" });
    core.addContext({
      description: "A2UI catalog",
      value: "schema",
      agentIds: ["a2ui_agent", "other_a2ui_agent"],
    });

    const a2uiAgent = new MockAgent({ newMessages: [] });
    const plainAgent = new MockAgent({ newMessages: [] });
    core.addAgent__unsafe_dev_only({
      id: "a2ui_agent",
      agent: a2uiAgent as any,
    });
    core.addAgent__unsafe_dev_only({
      id: "plain_agent",
      agent: plainAgent as any,
    });

    await core.runAgent({ agent: a2uiAgent as any });
    await core.runAgent({ agent: plainAgent as any });

    expect(a2uiAgent.runAgentCalls[0].context).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ description: "Global", value: "everyone" }),
        expect.objectContaining({
          description: "A2UI catalog",
          value: "schema",
        }),
      ]),
    );
    expect(plainAgent.runAgentCalls[0].context).toEqual([
      expect.objectContaining({ description: "Global", value: "everyone" }),
    ]);
  });

  it("strips the agentIds scoping metadata from the context sent to the agent", async () => {
    core.addContext({
      description: "A2UI catalog",
      value: "schema",
      agentIds: ["test"],
    });

    const agent = new MockAgent({ newMessages: [] });
    core.addAgent__unsafe_dev_only({ id: "test", agent: agent as any });

    await core.runAgent({ agent: agent as any });

    expect(agent.runAgentCalls[0].context).toEqual([
      { description: "A2UI catalog", value: "schema" },
    ]);
  });

  it("connectAgent applies the same per-agent filtering", async () => {
    core.addContext({ description: "Global", value: "everyone" });
    core.addContext({
      description: "A2UI catalog",
      value: "schema",
      agentIds: ["someone_else"],
    });

    const agent = new MockAgentWithConnect({ newMessages: [] });
    core.addAgent__unsafe_dev_only({ id: "test", agent: agent as any });

    await core.connectAgent({ agent: agent as any });

    expect(agent.connectAgentCalls[0].context).toEqual([
      { description: "Global", value: "everyone" },
    ]);
  });

  it("an empty agentIds array means the context is sent to no agent", async () => {
    core.addContext({ description: "Nobody", value: "hidden", agentIds: [] });

    const agent = new MockAgent({ newMessages: [] });
    core.addAgent__unsafe_dev_only({ id: "test", agent: agent as any });

    await core.runAgent({ agent: agent as any });

    expect(agent.runAgentCalls[0].context).toEqual([]);
  });
});
