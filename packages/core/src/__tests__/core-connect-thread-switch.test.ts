import type { AbstractAgent } from "@ag-ui/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotKitCore } from "../core";

/**
 * Tests for RunHandler.connectAgent's thread-switch detection. The
 * orchestrator gates `setMessages([])` + `setState({})` + replay-cursor
 * clear on the agent's threadId actually changing between successive
 * connectAgent calls. Same-thread churn re-connects must preserve
 * local state so the gateway can resume from `lastSeenEventId` instead
 * of forcing a full historical replay.
 */

class StubAgent {
  public agentId: string;
  public threadId: string | undefined;
  public messages: unknown[] = [{ id: "preexisting" }];
  public state: Record<string, unknown> = { hello: "world" };

  public setMessagesSpy = vi.fn();
  public setStateSpy = vi.fn();
  public detachActiveRunSpy = vi.fn();
  public connectAgentSpy = vi.fn();
  public clearReplayCursorSpy = vi.fn();

  constructor(agentId: string, threadId?: string) {
    this.agentId = agentId;
    this.threadId = threadId;
  }

  setMessages(messages: unknown[]) {
    this.setMessagesSpy(messages);
    this.messages = messages;
  }
  setState(state: Record<string, unknown>) {
    this.setStateSpy(state);
    this.state = state;
  }
  async detachActiveRun() {
    this.detachActiveRunSpy();
  }
  async connectAgent() {
    this.connectAgentSpy();
    return { newMessages: [] };
  }
  clearReplayCursor(threadId: string) {
    this.clearReplayCursorSpy(threadId);
  }
  // Surfaces consumed by core.connectAgent / processAgentResult.
  subscribe() {
    return { unsubscribe() {} };
  }
}

describe("CopilotKitCore.connectAgent — thread-switch detection", () => {
  let core: CopilotKitCore;

  beforeEach(() => {
    core = new CopilotKitCore({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a same-thread churn re-connect does NOT clear messages, state, or the replay cursor", async () => {
    const agent = new StubAgent("test", "thread-A");

    await core.connectAgent({ agent: agent as unknown as AbstractAgent });
    expect(agent.setMessagesSpy).toHaveBeenCalledTimes(1);
    expect(agent.setStateSpy).toHaveBeenCalledTimes(1);
    expect(agent.clearReplayCursorSpy).toHaveBeenCalledTimes(1);

    // Pretend the chat re-fired its connect effect on the same thread
    // (effect-dep churn — agent.threadId hasn't changed). Reset mocks
    // and call again.
    agent.setMessagesSpy.mockClear();
    agent.setStateSpy.mockClear();
    agent.clearReplayCursorSpy.mockClear();
    await core.connectAgent({ agent: agent as unknown as AbstractAgent });

    expect(agent.setMessagesSpy).not.toHaveBeenCalled();
    expect(agent.setStateSpy).not.toHaveBeenCalled();
    expect(agent.clearReplayCursorSpy).not.toHaveBeenCalled();

    // The connect itself still fires every time — we always tear down
    // and re-establish the socket so the runtime can recover from
    // transient disconnects.
    expect(agent.connectAgentSpy).toHaveBeenCalledTimes(2);
    expect(agent.detachActiveRunSpy).toHaveBeenCalledTimes(2);
  });

  it("switching to a different thread DOES clear messages, state, and the replay cursor", async () => {
    const agentA = new StubAgent("test", "thread-A");
    const agentB = new StubAgent("test", "thread-B");

    await core.connectAgent({ agent: agentA as unknown as AbstractAgent });
    expect(agentA.setMessagesSpy).toHaveBeenCalledTimes(1);
    expect(agentA.clearReplayCursorSpy).toHaveBeenCalledWith("thread-A");

    await core.connectAgent({ agent: agentB as unknown as AbstractAgent });
    expect(agentB.setMessagesSpy).toHaveBeenCalledTimes(1);
    expect(agentB.clearReplayCursorSpy).toHaveBeenCalledWith("thread-B");
  });

  it("A → B → A switches reset state on every transition", async () => {
    const agentA = new StubAgent("test", "thread-A");
    const agentB = new StubAgent("test", "thread-B");

    await core.connectAgent({ agent: agentA as unknown as AbstractAgent });
    await core.connectAgent({ agent: agentB as unknown as AbstractAgent });

    // Returning to thread A must reset and ask for a full replay (the
    // local state was wiped when we switched to B).
    agentA.setMessagesSpy.mockClear();
    agentA.setStateSpy.mockClear();
    agentA.clearReplayCursorSpy.mockClear();
    await core.connectAgent({ agent: agentA as unknown as AbstractAgent });

    expect(agentA.setMessagesSpy).toHaveBeenCalledTimes(1);
    expect(agentA.setStateSpy).toHaveBeenCalledTimes(1);
    expect(agentA.clearReplayCursorSpy).toHaveBeenCalledWith("thread-A");
  });

  it("agents without a clearReplayCursor method (non-Intelligence runtimes) are still handled cleanly on switch", async () => {
    const agent = new StubAgent("test", "thread-A");
    // Simulate an HttpAgent-style runtime that doesn't expose clearReplayCursor.
    delete (agent as unknown as { clearReplayCursor?: unknown })
      .clearReplayCursor;

    await expect(
      core.connectAgent({ agent: agent as unknown as AbstractAgent }),
    ).resolves.toBeDefined();
    expect(agent.setMessagesSpy).toHaveBeenCalledTimes(1);
  });
});
