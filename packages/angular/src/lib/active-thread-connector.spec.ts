import {
  EnvironmentInjector,
  createEnvironmentInjector,
  runInInjectionContext,
  signal,
} from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { test, expect, vi } from "vitest";
import { HttpAgent } from "@ag-ui/client";
import {
  injectChatConfiguration,
  provideCopilotChatConfiguration,
} from "./chat-configuration";
import type { AgentStore } from "./agent";
import { connectActiveThread } from "./active-thread-connector";

/**
 * Builds a fake agent + agent-store signal and wires the connector under an
 * injection context with a real {@link CopilotChatConfiguration}.
 *
 * @returns The config service, the fake agent, and the connect spy.
 */
function setup() {
  const fake = {
    agent: {
      threadId: "t0",
      messages: [{ id: "m1" }] as { id: string }[],
      setMessages: vi.fn((arr: { id: string }[]) => {
        fake.agent.messages = arr;
      }),
      detachActiveRun: vi.fn(() => Promise.resolve()),
    },
  };

  const connect = vi.fn();

  TestBed.configureTestingModule({
    providers: [provideCopilotChatConfiguration()],
  });

  const config = TestBed.runInInjectionContext(() => {
    const cfg = injectChatConfiguration();
    const agentStore = signal(fake as never) as unknown as () => AgentStore;
    connectActiveThread(cfg, agentStore, connect);
    return cfg;
  });

  return { config, fake, connect };
}

test("explicit switch connects the agent to the picked thread", async () => {
  const { config, fake, connect } = setup();

  config.setActiveThreadId("picked-1");
  TestBed.flushEffects();
  await Promise.resolve();

  expect(fake.agent.threadId).toBe("picked-1");
  expect(connect).toHaveBeenCalledWith(
    expect.objectContaining({ agent: fake.agent }),
  );
});

test("initial mount does not clear messages", async () => {
  const { fake, connect } = setup();

  TestBed.flushEffects();
  await Promise.resolve();

  expect(fake.agent.setMessages).not.toHaveBeenCalled();
  expect(fake.agent.messages).toEqual([{ id: "m1" }]);
  expect(connect).not.toHaveBeenCalled();
});

test("an explicit switch detaches the prior in-flight run on re-run", async () => {
  const { config, fake } = setup();

  config.setActiveThreadId("picked-1");
  TestBed.flushEffects();
  await Promise.resolve();

  expect(fake.agent.detachActiveRun).not.toHaveBeenCalled();

  config.setActiveThreadId("picked-2");
  TestBed.flushEffects();
  await Promise.resolve();

  expect(fake.agent.detachActiveRun).toHaveBeenCalledTimes(1);
});

test("destroying the injector detaches the connected run", async () => {
  const fake = {
    agent: {
      threadId: "t0",
      messages: [{ id: "m1" }] as { id: string }[],
      setMessages: vi.fn(),
      detachActiveRun: vi.fn(() => Promise.resolve()),
    },
  };
  const connect = vi.fn();
  TestBed.configureTestingModule({
    providers: [provideCopilotChatConfiguration()],
  });
  const parent = TestBed.inject(EnvironmentInjector);
  const childInjector = createEnvironmentInjector([], parent);
  const config = runInInjectionContext(childInjector, () => {
    const cfg = injectChatConfiguration();
    const agentStore = signal(fake as never) as unknown as () => AgentStore;
    connectActiveThread(cfg, agentStore, connect);
    return cfg;
  });

  config.setActiveThreadId("picked-1");
  TestBed.flushEffects();
  await Promise.resolve();

  childInjector.destroy();

  expect(fake.agent.detachActiveRun).toHaveBeenCalledTimes(1);
});

test("a genuine new-thread transition clears messages and skips connect", async () => {
  const { config, fake } = setup();

  config.setActiveThreadId("picked");
  TestBed.flushEffects();
  await Promise.resolve();

  config.startNewThread();
  TestBed.flushEffects();
  await Promise.resolve();

  expect(fake.agent.setMessages).toHaveBeenCalledWith([]);
  expect(fake.agent.messages).toEqual([]);
});

/**
 * Builds a fake agent + agent-store signal and wires the connector with
 * explicit cursor hooks and a caller-supplied connect implementation.
 *
 * @param connect - The connect implementation under test.
 * @returns The config service, the fake agent, the connect spy, and the
 *   `onConnectStart`/`onConnectSettle` hook spies.
 */
function setupWithHooks(connect: (params: { agent: unknown }) => unknown) {
  const fake = {
    agent: {
      threadId: "t0",
      messages: [{ id: "m1" }] as { id: string }[],
      setMessages: vi.fn((arr: { id: string }[]) => {
        fake.agent.messages = arr;
      }),
      detachActiveRun: vi.fn(() => Promise.resolve()),
    },
  };

  const onConnectStart = vi.fn();
  const onConnectSettle = vi.fn();

  TestBed.configureTestingModule({
    providers: [provideCopilotChatConfiguration()],
  });

  const config = TestBed.runInInjectionContext(() => {
    const cfg = injectChatConfiguration();
    const agentStore = signal(fake as never) as unknown as () => AgentStore;
    connectActiveThread(cfg, agentStore, connect as never, {
      onConnectStart,
      onConnectSettle,
    });
    return cfg;
  });

  return { config, fake, onConnectStart, onConnectSettle };
}

test("N1: a rejecting connect does not raise an unhandled rejection and still settles the cursor", async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (event: PromiseRejectionEvent) => {
    unhandled.push(event.reason);
  };
  globalThis.addEventListener?.("unhandledrejection", onUnhandled);

  const { config, onConnectStart, onConnectSettle } = setupWithHooks(() =>
    Promise.reject(new Error("connect failed")),
  );

  config.setActiveThreadId("picked-1", { explicit: true });
  TestBed.flushEffects();

  // Flush microtasks so the connect promise and its caught/finally chain run.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  expect(onConnectStart).toHaveBeenCalledTimes(1);
  expect(onConnectSettle).toHaveBeenCalledTimes(1);
  expect(unhandled).toEqual([]);

  globalThis.removeEventListener?.("unhandledrejection", onUnhandled);
});

test("N2: a superseded connect does not settle the cursor; the live connect does", async () => {
  let resolveFirst: (() => void) | undefined;
  let resolveSecond: (() => void) | undefined;
  const deferreds: Array<Promise<void>> = [
    new Promise<void>((resolve) => {
      resolveFirst = resolve;
    }),
    new Promise<void>((resolve) => {
      resolveSecond = resolve;
    }),
  ];
  let call = 0;
  const connect = vi.fn(() => deferreds[call++]);

  const { config, onConnectSettle } = setupWithHooks(connect);

  config.setActiveThreadId("picked-1", { explicit: true });
  TestBed.flushEffects();
  await Promise.resolve();

  // Second explicit thread supersedes the first connect before it settles.
  config.setActiveThreadId("picked-2", { explicit: true });
  TestBed.flushEffects();
  await Promise.resolve();

  // Settle the FIRST (now superseded) connect: its settle must be suppressed.
  resolveFirst?.();
  await Promise.resolve();
  await Promise.resolve();
  expect(onConnectSettle).not.toHaveBeenCalled();

  // Settle the SECOND (live) connect: its settle fires.
  resolveSecond?.();
  await Promise.resolve();
  await Promise.resolve();
  expect(onConnectSettle).toHaveBeenCalledTimes(1);
});

test("N3: cleanup detaches the connected run", async () => {
  const fake = {
    agent: {
      threadId: "t0",
      messages: [{ id: "m1" }] as { id: string }[],
      setMessages: vi.fn(),
      detachActiveRun: vi.fn(() => Promise.resolve()),
    },
  };
  const connect = vi.fn(() => Promise.resolve());

  TestBed.configureTestingModule({
    providers: [provideCopilotChatConfiguration()],
  });
  const parent = TestBed.inject(EnvironmentInjector);
  const childInjector = createEnvironmentInjector([], parent);
  const config = runInInjectionContext(childInjector, () => {
    const cfg = injectChatConfiguration();
    const agentStore = signal(fake as never) as unknown as () => AgentStore;
    connectActiveThread(cfg, agentStore, connect as never);
    return cfg;
  });

  config.setActiveThreadId("picked-1", { explicit: true });
  TestBed.flushEffects();
  await Promise.resolve();

  childInjector.destroy();

  expect(fake.agent.detachActiveRun).toHaveBeenCalledTimes(1);
});

test("N3: cleanup aborts the agent's AbortController for an HttpAgent", async () => {
  const abort = vi.fn();
  // A minimal HttpAgent: the connector sets `agent.abortController` only when
  // `agent instanceof HttpAgent`, so use a real instance with a stubbed
  // controller to assert the abort fires on teardown.
  const agent = new HttpAgent({ url: "http://localhost/agent" });
  agent.abortController = { abort } as never;
  const detachSpy = vi
    .spyOn(agent, "detachActiveRun")
    .mockResolvedValue(undefined);

  const fake = { agent };
  const connect = vi.fn(() => Promise.resolve());

  TestBed.configureTestingModule({
    providers: [provideCopilotChatConfiguration()],
  });
  const parent = TestBed.inject(EnvironmentInjector);
  const childInjector = createEnvironmentInjector([], parent);
  const config = runInInjectionContext(childInjector, () => {
    const cfg = injectChatConfiguration();
    const agentStore = signal(fake as never) as unknown as () => AgentStore;
    connectActiveThread(cfg, agentStore, connect as never);
    return cfg;
  });

  config.setActiveThreadId("picked-1", { explicit: true });
  TestBed.flushEffects();
  await Promise.resolve();

  childInjector.destroy();

  // The connector replaced `agent.abortController` with its own per-run
  // controller before connecting; assert it aborted on teardown and detached.
  expect(detachSpy).toHaveBeenCalledTimes(1);
  expect(agent.abortController?.signal.aborted).toBe(true);
});
