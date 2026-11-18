import { afterEach, describe, expect, it, vi } from "vitest";
import { CopilotKitCore, CopilotKitCoreErrorCode } from "../../core/core";
import type { CopilotKitCoreSubscriber } from "../../core/core";
import { ɵThreadSwitchCoordinator } from "../thread-switch";
import { CursorAgent, deferred, flush } from "./session-test-agent";

/** The two core calls the coordinator makes, with a way to emit a core error. */
function createCore() {
  const subscribers = new Set<CopilotKitCoreSubscriber>();
  const stopped: string[] = [];
  const core: Pick<CopilotKitCore, "stopAgent" | "subscribe"> = {
    stopAgent: ({ agent }) => {
      stopped.push(agent.threadId ?? "");
    },
    subscribe: (subscriber) => {
      subscribers.add(subscriber);
      return { unsubscribe: () => subscribers.delete(subscriber) };
    },
  };
  const copilotkit = new CopilotKitCore({});
  const emitError = (
    code: CopilotKitCoreErrorCode,
    context: Record<string, string>,
  ) => {
    for (const subscriber of subscribers) {
      void subscriber.onError?.({
        copilotkit,
        error: new Error(code),
        code,
        context,
      });
    }
  };
  return { core, stopped, emitError };
}

function agentWithHistory(threadId: string) {
  const agent = new CursorAgent({ agentId: "chat", threadId });
  agent.setMessages([{ id: "m1", role: "user", content: "hi" }]);
  agent.setState({ step: 1 });
  agent.pendingInterrupts = [{ id: "i1", reason: "approval" }];
  return agent;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ɵThreadSwitchCoordinator.select", () => {
  it("pins the selected thread on the agent", () => {
    const threads = new ɵThreadSwitchCoordinator(createCore().core);
    const agent = new CursorAgent({ threadId: "old" });

    threads.select({ agent, threadId: "t1", explicit: true });

    expect(agent.threadId).toBe("t1");
  });

  it("returns the same selection when nothing changed, a new one after release", () => {
    const threads = new ɵThreadSwitchCoordinator(createCore().core);
    const agent = new CursorAgent();
    const input = { agent, threadId: "t1", explicit: true };

    const first = threads.select(input);
    const again = threads.select(input);
    first.release();
    const afterRelease = threads.select(input);

    expect(again).toBe(first);
    expect(afterRelease).not.toBe(first);
    expect(first.isCurrent).toBe(false);
    expect(afterRelease.isCurrent).toBe(true);
  });

  it("keeps the history on the first selection and on an explicit switch", async () => {
    const threads = new ɵThreadSwitchCoordinator(createCore().core);
    const agent = agentWithHistory("t1");

    threads.select({ agent, threadId: "t1", explicit: false });
    threads.select({ agent, threadId: "t2", explicit: true });
    await threads.whenTornDown();

    expect(agent.messages).toHaveLength(1);
    expect(agent.detachCount).toBe(0);
  });

  it("empties the agent after its run detaches on a switch to a fresh thread", async () => {
    const threads = new ɵThreadSwitchCoordinator(createCore().core);
    const agent = agentWithHistory("t1");
    const detach = deferred();
    agent.holdDetach(detach.promise);
    threads.select({ agent, threadId: "t1", explicit: true });

    threads.select({ agent, threadId: "fresh", explicit: false });
    // Cleared at once so the welcome screen shows, then again after the detach.
    expect(agent.messages).toEqual([]);
    agent.setMessages([{ id: "late", role: "assistant", content: "late" }]);
    detach.resolve();
    await threads.whenTornDown();

    expect(agent.messages).toEqual([]);
    expect(agent.state).toEqual({});
    expect(agent.pendingInterrupts).toEqual([]);
    expect(agent.clearedReplayCursors).toContain("t1");
    expect(agent.clearedReconnectCursors).toContain("t1");
  });

  it("does not empty the agent once the user moved on from the fresh thread", async () => {
    const threads = new ɵThreadSwitchCoordinator(createCore().core);
    const agent = agentWithHistory("t1");
    const detach = deferred();
    agent.holdDetach(detach.promise);
    threads.select({ agent, threadId: "t1", explicit: true });
    threads.select({ agent, threadId: "fresh", explicit: false });

    threads.select({ agent, threadId: "t3", explicit: true });
    agent.setMessages([{ id: "t3-message", role: "user", content: "t3" }]);
    detach.resolve();
    await threads.whenTornDown();

    expect(agent.messages).toEqual([
      { id: "t3-message", role: "user", content: "t3" },
    ]);
    // The discarded thread's cursor is still dropped.
    expect(agent.clearedReplayCursors).toContain("t1");
  });

  it("lets a superseded connect clear a snapshot it applied after the switch", async () => {
    const threads = new ɵThreadSwitchCoordinator(createCore().core);
    const agent = agentWithHistory("t1");
    const detach = deferred();
    agent.holdDetach(detach.promise);
    const explicit = threads.select({ agent, threadId: "t1", explicit: true });
    threads.select({ agent, threadId: "fresh", explicit: false });

    // The old thread's connect lands while the detach is still running.
    agent.setMessages([{ id: "stale", role: "user", content: "stale" }]);
    explicit.clearDiscardedBaseline();

    expect(agent.messages).toEqual([]);
    detach.resolve();
    await threads.whenTornDown();
  });

  it("stops the run when moving into an inspector override", () => {
    const { core, stopped } = createCore();
    const threads = new ɵThreadSwitchCoordinator(core);
    const agent = new CursorAgent();
    threads.select({ agent, threadId: "t1", explicit: true });

    threads.select({
      agent,
      threadId: "inspected",
      explicit: true,
      inspectorRequestId: "req-1",
    });

    expect(stopped).toEqual(["t1"]);
  });

  it("logs a failed detach instead of rejecting the teardown", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const threads = new ɵThreadSwitchCoordinator(createCore().core);
    const agent = agentWithHistory("t1");
    agent.holdDetach(Promise.reject(new Error("socket closed")));
    threads.select({ agent, threadId: "t1", explicit: true });

    threads.select({ agent, threadId: "fresh", explicit: false });
    await threads.whenTornDown();

    expect(consoleError).toHaveBeenCalledWith(
      "CopilotChat: detachActiveRun failed",
      new Error("socket closed"),
    );
    expect(agent.messages).toEqual([]);
  });
});

describe("ɵThreadSwitchCoordinator connections", () => {
  it("waits for the connection, then reports ready", async () => {
    const threads = new ɵThreadSwitchCoordinator(createCore().core);
    const agent = new CursorAgent({ agentId: "chat" });
    const selection = threads.select({ agent, threadId: "t1", explicit: true });
    const connect = deferred();
    threads.trackConnection(selection, () => connect.promise);

    let result: string | undefined;
    void threads.waitForConnection(selection).then((r) => (result = r));
    await flush();
    expect(result).toBeUndefined();
    connect.resolve();
    await flush();

    expect(result).toBe("ready");
  });

  it("reports failed when core reports a connect failure for the thread", async () => {
    const { core, emitError } = createCore();
    const threads = new ɵThreadSwitchCoordinator(core);
    const agent = new CursorAgent({ agentId: "chat" });
    const selection = threads.select({ agent, threadId: "t1", explicit: true });

    await threads.trackConnection(selection, async () => {
      emitError(CopilotKitCoreErrorCode.AGENT_CONNECT_FAILED, {
        agentId: "chat",
        threadId: "t1",
      });
    });

    expect(await threads.waitForConnection(selection)).toBe("failed");
  });

  it("reports failed when the connect throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const threads = new ɵThreadSwitchCoordinator(createCore().core);
    const agent = new CursorAgent({ agentId: "chat" });
    const selection = threads.select({ agent, threadId: "t1", explicit: true });

    await threads.trackConnection(selection, async () => {
      throw new Error("404");
    });

    expect(await threads.waitForConnection(selection)).toBe("failed");
  });

  it("reports stale when the user switched threads while waiting", async () => {
    const threads = new ɵThreadSwitchCoordinator(createCore().core);
    const agent = new CursorAgent({ agentId: "chat" });
    const selection = threads.select({ agent, threadId: "t1", explicit: true });
    const connect = deferred();
    threads.trackConnection(selection, () => connect.promise);

    const waiting = threads.waitForConnection(selection);
    threads.select({ agent, threadId: "t2", explicit: true });
    connect.resolve();

    expect(await waiting).toBe("stale");
  });

  it("makes a connect wait for the reset of a fresh-thread switch", async () => {
    const threads = new ɵThreadSwitchCoordinator(createCore().core);
    const agent = agentWithHistory("t1");
    const detach = deferred();
    agent.holdDetach(detach.promise);
    threads.select({ agent, threadId: "t1", explicit: true });
    threads.select({ agent, threadId: "fresh", explicit: false });

    let tornDown = false;
    void threads.whenTornDown().then(() => (tornDown = true));
    await flush();
    expect(tornDown).toBe(false);
    expect(threads.isTornDown).toBe(false);
    detach.resolve();
    await flush();

    expect(tornDown).toBe(true);
    expect(threads.isTornDown).toBe(true);
  });
});
