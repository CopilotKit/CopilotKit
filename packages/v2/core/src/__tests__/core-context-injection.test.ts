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
