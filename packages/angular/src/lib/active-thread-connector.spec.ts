import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, test, expect, vi } from "vitest";
import {
  injectChatConfiguration,
  provideCopilotChatConfiguration,
} from "./chat-configuration";
import type { AgentStore } from "./agent";
import { connectActiveThread } from "./active-thread-connector";

function makeFakeAgent() {
  const agent = {
    threadId: "t0",
    messages: [{ id: "m1" }] as { id: string }[],
    setMessages: vi.fn((arr: { id: string }[]) => {
      agent.messages = arr;
    }),
  };
  return agent;
}

function createConnectorFixture() {
  const agent = makeFakeAgent();
  const disposes: ReturnType<typeof vi.fn>[] = [];
  const connect = vi.fn(() => {
    const dispose = vi.fn();
    disposes.push(dispose);
    return { dispose };
  });

  TestBed.configureTestingModule({
    teardown: { destroyAfterEach: true },
    providers: [provideCopilotChatConfiguration()],
  });

  const agentStore = signal({ agent } as unknown as AgentStore);
  const config = TestBed.runInInjectionContext(() => {
    const cfg = injectChatConfiguration();
    connectActiveThread(cfg, agentStore, connect);
    return cfg;
  });

  return { config, agent, agentStore, connect, disposes };
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
      expect(agent.messages).toEqual([{ id: "m1" }]);
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
      agentStore.set({ agent: second } as unknown as AgentStore);
      TestBed.tick();
      expect(first.setMessages).not.toHaveBeenCalled();
      expect(second.setMessages).not.toHaveBeenCalled();
      expect(connect).not.toHaveBeenCalled();
    });
  });

  describe("connection cleanup", () => {
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
