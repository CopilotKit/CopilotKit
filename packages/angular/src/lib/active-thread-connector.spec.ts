import { DestroyRef, inject, signal } from "@angular/core";
import { AbstractAgent } from "@ag-ui/client";
import { EMPTY } from "rxjs";
import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, test, expect, vi } from "vitest";
import {
  injectChatConfiguration,
  provideCopilotChatConfiguration,
} from "./chat-configuration";
import { AgentStore } from "./agent";
import { connectActiveThread } from "./active-thread-connector";

function makeFakeAgent() {
  class TestAgent extends AbstractAgent {
    cursors = new Map<string, string>();
    clearReplayCursor(threadId: string) {
      this.cursors.delete(threadId);
    }
    run() {
      return EMPTY;
    }
  }
  const agent = new TestAgent({
    threadId: "t0",
    initialMessages: [{ id: "m1", role: "user", content: "hello" }],
  });
  vi.spyOn(agent, "setMessages");
  return agent;
}

function makeStore(agent: AbstractAgent) {
  return TestBed.runInInjectionContext(
    () =>
      new AgentStore(agent, inject(DestroyRef), (target, subscriber) =>
        target.subscribe(subscriber),
      ),
  );
}

function createConnectorFixture() {
  const agent = makeFakeAgent();
  const disposes: ReturnType<typeof vi.fn>[] = [];
  const connectedCursors: (string | null)[] = [];
  const connect = vi.fn(() => {
    connectedCursors.push(agent.cursors.get(agent.threadId) ?? null);
    const dispose = vi.fn();
    disposes.push(dispose);
    return { dispose };
  });

  TestBed.configureTestingModule({
    teardown: { destroyAfterEach: true },
    providers: [provideCopilotChatConfiguration()],
  });

  const agentStore = signal(makeStore(agent));
  const config = TestBed.runInInjectionContext(() => {
    const cfg = injectChatConfiguration();
    connectActiveThread(cfg, agentStore, connect);
    return cfg;
  });

  return { config, agent, agentStore, connect, disposes, connectedCursors };
}

describe("connectActiveThread", () => {
  let context: ReturnType<typeof createConnectorFixture>;
  beforeEach(() => {
    TestBed.resetTestingModule();
    context = createConnectorFixture();
  });
  afterEach(() => TestBed.resetTestingModule());

  describe("thread transitions", () => {
    test("explicit switch pins the thread and opens a connect for the agent", () => {
      const { config, agent, connect } = context;

      config.setActiveThreadId("picked-1");
      TestBed.tick();

      expect(agent.threadId).toBe("picked-1");
      expect(connect).toHaveBeenCalledTimes(1);
      expect(connect).toHaveBeenCalledWith(agent);
    });

    test("initial mount does not clear messages and does not connect", () => {
      const { agent, connect } = context;

      TestBed.tick();

      expect(agent.setMessages).not.toHaveBeenCalled();
      expect(agent.messages).toEqual([
        { id: "m1", role: "user", content: "hello" },
      ]);
      expect(connect).not.toHaveBeenCalled();
    });

    test("a genuine new-thread transition clears messages and skips connect", () => {
      const { config, agent, connect } = context;

      config.setActiveThreadId("picked");
      TestBed.tick();

      config.startNewThread();
      TestBed.tick();

      expect(agent.setMessages).toHaveBeenCalledWith([]);
      expect(agent.messages).toEqual([]);
      expect(connect).toHaveBeenCalledTimes(1);
    });

    test("an agent-store swap on the same fresh thread does not clear messages", () => {
      const { agent: first, agentStore, connect } = context;
      const second = makeFakeAgent();
      TestBed.tick();
      agentStore.set(makeStore(second));
      TestBed.tick();
      expect(first.setMessages).not.toHaveBeenCalled();
      expect(second.setMessages).not.toHaveBeenCalled();
      expect(connect).not.toHaveBeenCalled();
    });
  });

  describe("connection cleanup", () => {
    test("a state-only fresh reset invalidates only the saved thread cursor", () => {
      const { config, agent, connect } = context;
      config.setActiveThreadId("saved");
      TestBed.tick();
      agent.setMessages([]);
      agent.setState({ saved: true });
      agent.pendingInterrupts = [{ id: "approval-A", reason: "confirmation" }];
      agent.cursors.set("saved", "last-event");
      agent.cursors.set("other", "keep-other");
      config.startNewThread();
      TestBed.tick();
      expect(agent.state).toEqual({});
      expect(agent.pendingInterrupts).toEqual([]);
      expect(agent.cursors.get("saved")).toBeUndefined();
      expect(agent.cursors.get("other")).toBe("keep-other");
      expect(connect).toHaveBeenCalledTimes(1);
    });
    test.each(["saved", "other", "via-fresh"])(
      "waits for old teardown before connecting %s",
      async (target) => {
        const { config, agent, connect, disposes, connectedCursors } = context;
        config.setActiveThreadId("saved");
        TestBed.tick();
        let release = () => {};
        const detached = new Promise<void>((resolve) => {
          release = resolve;
        });
        disposes[0].mockImplementation(() => detached);
        agent.cursors.set("saved", "old-event");
        config.startNewThread();
        TestBed.tick();
        if (target === "via-fresh") {
          config.startNewThread();
          TestBed.tick();
        }
        const destination = target === "via-fresh" ? "saved" : target;
        config.setActiveThreadId(destination);
        TestBed.tick();
        expect(connect).toHaveBeenCalledTimes(1);
        agent.cursors.set("saved", "late-event");
        release();
        await detached;
        await Promise.resolve();
        await Promise.resolve();
        TestBed.tick();
        expect(connect).toHaveBeenCalledTimes(2);
        expect(connectedCursors).toEqual([null, null]);
        agent.setState({ current: true });
        agent.pendingInterrupts = [
          { id: "approval-new", reason: "confirmation" },
        ];
        await Promise.resolve();
        expect(agent.state).toEqual({ current: true });
        expect(agent.pendingInterrupts).toEqual([
          { id: "approval-new", reason: "confirmation" },
        ]);
      },
    );

    test("supports the direct Intelligence cursor on an empty thread", () => {
      const { config, agent } = context;
      Object.defineProperty(agent, "clearReplayCursor", { value: undefined });
      Object.defineProperty(agent, "clearReconnectCursor", {
        value: (threadId: string) => agent.cursors.delete(threadId),
      });
      config.setActiveThreadId("saved");
      TestBed.tick();
      agent.setMessages([]);
      agent.cursors.set("saved", "old-event");
      config.startNewThread();
      TestBed.tick();
      expect(agent.cursors.get("saved")).toBeUndefined();
    });
    test("a second explicit switch disposes the prior connect and opens a new one", () => {
      const { config, connect, disposes } = context;

      config.setActiveThreadId("picked-1");
      TestBed.tick();

      expect(disposes[0]).not.toHaveBeenCalled();

      config.setActiveThreadId("picked-2");
      TestBed.tick();

      expect(connect).toHaveBeenCalledTimes(2);
      expect(disposes[0]).toHaveBeenCalledTimes(1);
      expect(disposes[1]).not.toHaveBeenCalled();
    });

    test("destroying the injector disposes the live connect", () => {
      const { config, disposes } = context;
      config.setActiveThreadId("picked-1");
      TestBed.tick();
      TestBed.resetTestingModule();
      expect(disposes[0]).toHaveBeenCalledOnce();
    });
  });
});
