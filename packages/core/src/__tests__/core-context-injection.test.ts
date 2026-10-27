/**
 * Tests that context registered via addContext (i.e. useCopilotReadable / useAgentContext)
 * is forwarded to the agent on both the runAgent and connectAgent paths.
 *
 * Regression for #3150: connectAgent was missing the context parameter that
 * runAgent already had, so useCopilotReadable context never reached the backend
 * on the initial CopilotChat connection.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Subject } from "rxjs";
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

describe("Per-thread context scoping and stable upserts", () => {
  let core: CopilotKitCore;

  beforeEach(() => {
    core = new CopilotKitCore({});
  });

  function agentOnThread(id: string, threadId: string | undefined) {
    const agent = new MockAgentWithConnect({ newMessages: [] });
    agent.threadId = threadId;
    core.addAgent__unsafe_dev_only({ id, agent: agent as any });
    return agent;
  }

  it("forwards a thread-scoped entry only to runs of that thread", async () => {
    core.addContext({ description: "Global", value: "everyone" });
    core.upsertContext("widget", {
      description: "Widget state",
      value: "selected: lyon",
      agentIds: ["test"],
      threadId: "thread-a",
    });
    const agent = agentOnThread("test", "thread-a");

    await core.runAgent({ agent: agent as any });
    agent.threadId = "thread-b";
    await core.runAgent({ agent: agent as any });

    expect(agent.runAgentCalls[0].context).toEqual([
      { description: "Global", value: "everyone" },
      { description: "Widget state", value: "selected: lyon" },
    ]);
    expect(agent.runAgentCalls[1].context).toEqual([
      { description: "Global", value: "everyone" },
    ]);
  });

  it("never forwards a thread-scoped entry to a consumer without a thread id", () => {
    core.upsertContext("widget", {
      description: "Widget state",
      value: "x",
      threadId: "thread-a",
    });

    expect(core.getContextForAgent("test")).toEqual([]);
    expect(core.getContextForAgent("test", "thread-a")).toEqual([
      { description: "Widget state", value: "x" },
    ]);
  });

  it("connectAgent filters on the connected thread too", async () => {
    core.upsertContext("widget", {
      description: "Widget state",
      value: "x",
      threadId: "thread-a",
    });
    const agent = agentOnThread("test", "thread-b");

    await core.connectAgent({ agent: agent as any });

    expect(agent.connectAgentCalls[0].context).toEqual([]);
  });

  it("an upsert replaces the entry stored under the same id", async () => {
    const agent = agentOnThread("test", "thread-a");
    core.upsertContext("widget", {
      description: "Widget state",
      value: "first",
      threadId: "thread-a",
    });
    core.upsertContext("widget", {
      description: "Widget state",
      value: "second",
      threadId: "thread-a",
    });

    await core.runAgent({ agent: agent as any });

    expect(agent.runAgentCalls[0].context).toEqual([
      { description: "Widget state", value: "second" },
    ]);
    expect(Object.keys(core.context)).toEqual(["widget"]);
  });

  it("an identical upsert does not notify subscribers", async () => {
    const onContextChanged = vi.fn();
    core.subscribe({ onContextChanged });
    const entry = { description: "Widget state", value: "same" };

    core.upsertContext("widget", entry);
    core.upsertContext("widget", { ...entry });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onContextChanged).toHaveBeenCalledTimes(1);
  });

  it("removing an unknown id does not notify subscribers", async () => {
    const onContextChanged = vi.fn();
    core.subscribe({ onContextChanged });

    core.removeContext("missing");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onContextChanged).not.toHaveBeenCalled();
  });

  it("a thread deletion for one agent keeps an entry shared with another agent for that other agent", () => {
    const deletions = new Subject<string>();
    core.upsertContext("shared", {
      description: "Shared",
      value: "x",
      agentIds: ["A", "B"],
      threadId: "thread-a",
    });
    core.registerThreadStore("A", {
      subscribeToThreadDeletions: (callback: (id: string) => void) =>
        deletions.subscribe(callback),
    } as any);

    deletions.next("thread-a");

    expect(core.getContextForAgent("A", "thread-a")).toEqual([]);
    expect(core.getContextForAgent("B", "thread-a")).toEqual([
      { description: "Shared", value: "x" },
    ]);
    core.unregisterThreadStore("A");
  });

  it("a thread deletion reported by the registered thread store drops that thread's entries only", async () => {
    const deletions = new Subject<string>();
    core.upsertContext("deleted-thread", {
      description: "Gone",
      value: "x",
      agentIds: ["test"],
      threadId: "thread-a",
    });
    core.upsertContext("other-thread", {
      description: "Kept",
      value: "y",
      agentIds: ["test"],
      threadId: "thread-b",
    });
    core.upsertContext("other-agent", {
      description: "Other agent",
      value: "z",
      agentIds: ["someone_else"],
      threadId: "thread-a",
    });
    core.addContext({ description: "Global", value: "everyone" });
    core.registerThreadStore("test", {
      subscribeToThreadDeletions: (callback: (id: string) => void) =>
        deletions.subscribe(callback),
    } as any);

    deletions.next("thread-a");

    expect(
      Object.values(core.context).map((entry) => entry.description),
    ).toEqual(["Kept", "Other agent", "Global"]);

    // Once unregistered, the store's deletions no longer reach the core.
    core.unregisterThreadStore("test");
    deletions.next("thread-b");
    expect(Object.keys(core.context)).toContain("other-thread");
  });
});
