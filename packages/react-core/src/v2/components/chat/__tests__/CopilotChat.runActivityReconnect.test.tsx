import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { AbstractAgent } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import type * as CopilotKitCoreModule from "@copilotkit/core";
import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkit/core";
import type {
  ThreadRunActivityNotification,
  ɵThreadStore,
} from "@copilotkit/core";
import type { Observable } from "rxjs";
import { EMPTY, Subscription } from "rxjs";
import { CopilotKitContext, EMPTY_SET } from "../../../context";
import { CopilotChat } from "../CopilotChat";

const coreMocks = vi.hoisted(() => ({
  createThreadStore: vi.fn(),
}));

vi.mock("@copilotkit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof CopilotKitCoreModule>();
  return {
    ...actual,
    ɵcreateThreadStore: coreMocks.createThreadStore,
  };
});

afterEach(() => {
  coreMocks.createThreadStore.mockReset();
  cleanup();
});

vi.mock("../CopilotChatView", () => {
  const CopilotChatView = (props: {
    onSubmitMessage?: (value: string) => void;
  }) => (
    <button
      data-testid="mock-copilot-chat-submit"
      onClick={() => props.onSubmitMessage?.("hello")}
      type="button"
    >
      submit
    </button>
  );
  return {
    CopilotChatView,
    default: CopilotChatView,
  };
});

type ConnectCall = {
  agent: TestAgent;
  agentId?: string;
  threadId?: string;
};

type RunCall = {
  agent: TestAgent;
  runId?: string;
};

type TestCoreOptions = {
  runtimeConnectionStatus?: CopilotKitCoreRuntimeConnectionStatus;
  intelligence?: { wsUrl: string };
  threadEndpoints?: { realtimeMetadata?: boolean; list?: boolean };
  deferInitialConnect?: boolean;
  registeredStore?: RunActivityStore | null;
};

type RunActivityStore = Pick<ɵThreadStore, "subscribeToRunActivity"> & {
  emit(notification: ThreadRunActivityNotification): void;
  setContext: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
};

class TestAgent extends AbstractAgent {
  detachActiveRunCalls = 0;

  connect(_input: RunAgentInput): Observable<BaseEvent> {
    return EMPTY;
  }

  async detachActiveRun(): Promise<void> {
    this.detachActiveRunCalls += 1;
  }

  run(_input: RunAgentInput): Observable<BaseEvent> {
    return EMPTY;
  }
}

function createDeferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function createRunActivityStore(): RunActivityStore {
  const callbacks = new Set<
    (notification: ThreadRunActivityNotification) => void
  >();
  return {
    setContext: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    subscribeToRunActivity(callback) {
      callbacks.add(callback);
      return new Subscription(() => {
        callbacks.delete(callback);
      });
    },
    emit(notification) {
      callbacks.forEach((callback) => callback(notification));
    },
  };
}

function createTestCore(
  agent: TestAgent,
  store: RunActivityStore,
  options: TestCoreOptions = {},
) {
  const secondaryAgent = new TestAgent();
  secondaryAgent.agentId = "secondary";
  const agents = { [DEFAULT_AGENT_ID]: agent, secondary: secondaryAgent };
  const connectAgentCalls: ConnectCall[] = [];
  const connectDeferrals: Array<ReturnType<typeof createDeferred>> = [];
  const runAgentCalls: RunCall[] = [];
  const runDeferrals: Array<ReturnType<typeof createDeferred>> = [];
  const connectAgent = vi.fn((call: ConnectCall) => {
    connectAgentCalls.push({
      agent: call.agent,
      agentId: call.agent.agentId,
      threadId: call.agent.threadId,
    });
    const deferred = connectDeferrals.shift();
    return deferred ? deferred.promise : Promise.resolve();
  });
  const runAgent = vi.fn((call: RunCall) => {
    runAgentCalls.push({
      agent: call.agent,
      runId: call.runId,
    });
    call.agent.isRunning = true;
    const deferred = runDeferrals.shift();
    const promise = deferred ? deferred.promise : Promise.resolve();
    return promise.finally(() => {
      call.agent.isRunning = false;
    });
  });
  const core = {
    agents,
    applyHeadersToAgent: vi.fn(),
    connectAgent,
    defaultThrottleMs: undefined,
    getAgent: vi.fn(
      (agentId: string) => agents[agentId as keyof typeof agents],
    ),
    clearSuggestions: vi.fn(),
    getSuggestions: vi.fn(() => ({ isLoading: false, suggestions: [] })),
    getThreadStore: vi.fn(() =>
      options.registeredStore === null
        ? undefined
        : (options.registeredStore ?? store),
    ),
    headers: {},
    intelligence: options.intelligence,
    // Mirrors `CopilotKitCore.ɵgetMetadataSocket(joinToken)`: the shared
    // credential-agnostic socket while a realtime `wsUrl` is known, else
    // undefined. The standalone run-activity store here is a vi.fn mock that
    // never consumes the socket; the standalone test below asserts only that the
    // chat threaded a `getMetadataSocket` provider (a function) into the
    // dispatched context, not this return value.
    ɵgetMetadataSocket: vi.fn((_joinToken: string) =>
      options.intelligence?.wsUrl ? { ɵmetadataSocketStub: true } : undefined,
    ),
    registerThreadStore: vi.fn(),
    runtimeConnectionStatus:
      options.runtimeConnectionStatus ??
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    runtimeTransport: "auto",
    runtimeUrl: "https://runtime.example",
    subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
    subscribeToAgentWithOptions: vi.fn(() => ({ unsubscribe: vi.fn() })),
    reloadSuggestions: vi.fn(),
    runAgent,
    threadEndpoints: options.threadEndpoints ?? { realtimeMetadata: true },
    unregisterThreadStore: vi.fn(),
  };

  return {
    connectAgent,
    connectAgentCalls,
    connectDeferrals,
    core,
    runAgent,
    runAgentCalls,
    runDeferrals,
  };
}

function renderChatWithCore(options: TestCoreOptions = {}) {
  const agent = new TestAgent();
  agent.agentId = DEFAULT_AGENT_ID;
  const store = createRunActivityStore();
  const core = createTestCore(agent, store, options);
  const initialConnect = options.deferInitialConnect
    ? createDeferred()
    : undefined;
  if (initialConnect) {
    core.connectDeferrals.push(initialConnect);
  }
  const rendered = render(
    <CopilotKitContext.Provider
      value={{
        copilotkit: core.core as never,
        executingToolCallIds: EMPTY_SET,
      }}
    >
      <CopilotChat threadId="thread-current" welcomeScreen={false} />
    </CopilotKitContext.Provider>,
  );

  return { agent, initialConnect, store, ...core, ...rendered };
}

async function settleInitialConnect(
  rendered: ReturnType<typeof renderChatWithCore>,
) {
  await waitFor(() => {
    expect(rendered.connectAgent).toHaveBeenCalledTimes(1);
  });
  rendered.connectAgent.mockClear();
  rendered.connectAgentCalls.length = 0;
}

function emitRunActivity(store: RunActivityStore, threadId = "thread-current") {
  act(() => {
    store.emit({
      type: "thread_run_activity",
      threadId,
      eventType: "run_finished",
    });
  });
}

function connectCallThreadIds(calls: ConnectCall[]): Array<string | undefined> {
  return calls.map((call) => call.threadId);
}

test("thread_run_activity for the current explicit Intelligence thread triggers connectAgent", async () => {
  const rendered = renderChatWithCore({
    intelligence: { wsUrl: "wss://intelligence.example/client" },
    threadEndpoints: { realtimeMetadata: true },
  });
  await settleInitialConnect(rendered);

  emitRunActivity(rendered.store);

  await waitFor(() => {
    expect(rendered.connectAgent).toHaveBeenCalledTimes(1);
  });
  expect(rendered.connectAgentCalls[0]?.agent).toBe(rendered.agent);
});

test("standalone explicit Intelligence chat subscribes to run activity without a registered useThreads store", async () => {
  const standaloneStore = createRunActivityStore();
  coreMocks.createThreadStore.mockReturnValue(standaloneStore);
  const rendered = renderChatWithCore({
    intelligence: { wsUrl: "wss://intelligence.example/client" },
    threadEndpoints: { list: true, realtimeMetadata: true },
    registeredStore: null,
  });
  await settleInitialConnect(rendered);

  // Verifies the react-side wiring at CopilotChat.tsx: when the chat owns the
  // standalone run-activity store it dispatches a context that threads a
  // `getMetadataSocket` provider (a live closure over `core.ɵgetMetadataSocket`),
  // so the store can re-resolve the shared metadata socket. We assert only that
  // a function was threaded, not its return value.
  await waitFor(() => {
    expect(standaloneStore.setContext).toHaveBeenCalledWith(
      expect.objectContaining({ getMetadataSocket: expect.any(Function) }),
    );
  });

  emitRunActivity(standaloneStore);

  await waitFor(() => {
    expect(rendered.connectAgent).toHaveBeenCalledTimes(1);
  });
  expect(rendered.connectAgentCalls[0]?.agent).toBe(rendered.agent);
  expect(rendered.core.registerThreadStore).not.toHaveBeenCalled();
});

test("thread_run_activity does not reconnect for non-Intelligence runtime info", async () => {
  const rendered = renderChatWithCore({
    intelligence: undefined,
    threadEndpoints: { realtimeMetadata: true },
  });
  await settleInitialConnect(rendered);

  emitRunActivity(rendered.store);

  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(rendered.connectAgent).not.toHaveBeenCalled();
});

test("thread_run_activity for another thread does not reconnect", async () => {
  const rendered = renderChatWithCore({
    intelligence: { wsUrl: "wss://intelligence.example/client" },
    threadEndpoints: { realtimeMetadata: true },
  });
  await settleInitialConnect(rendered);

  emitRunActivity(rendered.store, "thread-other");

  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(rendered.connectAgent).not.toHaveBeenCalled();
});

test("thread_run_activity from the local active run does not reconnect the originating chat", async () => {
  const rendered = renderChatWithCore({
    intelligence: { wsUrl: "wss://intelligence.example/client" },
    threadEndpoints: { realtimeMetadata: true },
  });
  await settleInitialConnect(rendered);
  const activeRun = createDeferred();
  rendered.runDeferrals.push(activeRun);
  rendered.connectAgent.mockClear();
  rendered.connectAgentCalls.length = 0;

  fireEvent.click(screen.getByTestId("mock-copilot-chat-submit"));
  await waitFor(() => {
    expect(rendered.runAgent).toHaveBeenCalledTimes(1);
  });
  expect(typeof rendered.runAgentCalls[0]?.runId).toBe("string");

  act(() => {
    rendered.store.emit({
      type: "thread_run_activity",
      threadId: "thread-current",
      agentId: DEFAULT_AGENT_ID,
      runId: rendered.runAgentCalls[0]?.runId,
      eventType: "RUN_FINISHED",
    });
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(rendered.connectAgent).not.toHaveBeenCalled();

  await act(async () => {
    activeRun.resolve();
    await activeRun.promise;
  });
});

test("delayed terminal thread_run_activity from the settled local run does not reconnect the originating chat", async () => {
  const rendered = renderChatWithCore({
    intelligence: { wsUrl: "wss://intelligence.example/client" },
    threadEndpoints: { realtimeMetadata: true },
  });
  await settleInitialConnect(rendered);
  const activeRun = createDeferred();
  rendered.runDeferrals.push(activeRun);
  rendered.connectAgent.mockClear();
  rendered.connectAgentCalls.length = 0;

  fireEvent.click(screen.getByTestId("mock-copilot-chat-submit"));
  await waitFor(() => {
    expect(rendered.runAgent).toHaveBeenCalledTimes(1);
  });
  const localRunId = rendered.runAgentCalls[0]?.runId;
  expect(typeof localRunId).toBe("string");

  await act(async () => {
    activeRun.resolve();
    await activeRun.promise;
  });

  act(() => {
    rendered.store.emit({
      type: "thread_run_activity",
      threadId: "thread-current",
      agentId: DEFAULT_AGENT_ID,
      runId: localRunId,
      eventType: "RUN_FINISHED",
    });
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(rendered.connectAgent).not.toHaveBeenCalled();
});

test("thread_run_activity from a same-agent different run waits for the local run to finish", async () => {
  const rendered = renderChatWithCore({
    intelligence: { wsUrl: "wss://intelligence.example/client" },
    threadEndpoints: { realtimeMetadata: true },
  });
  await settleInitialConnect(rendered);
  const activeRun = createDeferred();
  rendered.runDeferrals.push(activeRun);
  rendered.connectAgent.mockClear();
  rendered.connectAgentCalls.length = 0;

  fireEvent.click(screen.getByTestId("mock-copilot-chat-submit"));
  await waitFor(() => {
    expect(rendered.runAgent).toHaveBeenCalledTimes(1);
  });
  expect(typeof rendered.runAgentCalls[0]?.runId).toBe("string");

  act(() => {
    rendered.store.emit({
      type: "thread_run_activity",
      threadId: "thread-current",
      agentId: DEFAULT_AGENT_ID,
      runId: "run-remote",
      eventType: "RUN_FINISHED",
    });
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(rendered.connectAgent).not.toHaveBeenCalled();

  await act(async () => {
    activeRun.resolve();
    await activeRun.promise;
  });

  await waitFor(() => {
    expect(rendered.connectAgent).toHaveBeenCalledTimes(1);
  });
});

test("thread_run_activity from a same-agent different run waits for an external active run to finish", async () => {
  const rendered = renderChatWithCore({
    intelligence: { wsUrl: "wss://intelligence.example/client" },
    threadEndpoints: { realtimeMetadata: true },
  });
  await settleInitialConnect(rendered);
  const activeExternalRun = createDeferred();
  rendered.runDeferrals.push(activeExternalRun);

  const externalRunPromise = rendered.core.runAgent({
    agent: rendered.agent,
    runId: "external-run",
  });
  expect(rendered.agent.isRunning).toBe(true);

  act(() => {
    rendered.store.emit({
      type: "thread_run_activity",
      threadId: "thread-current",
      agentId: DEFAULT_AGENT_ID,
      runId: "run-remote",
      eventType: "RUN_FINISHED",
    });
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(rendered.connectAgent).not.toHaveBeenCalled();

  await act(async () => {
    activeExternalRun.resolve();
    await externalRunPromise;
  });

  await waitFor(() => {
    expect(rendered.connectAgent).toHaveBeenCalledTimes(1);
  });
});

test("thread_run_activity for another agent on the same thread does not reconnect", async () => {
  const rendered = renderChatWithCore({
    intelligence: { wsUrl: "wss://intelligence.example/client" },
    threadEndpoints: { realtimeMetadata: true },
  });
  await settleInitialConnect(rendered);

  act(() => {
    rendered.store.emit({
      type: "thread_run_activity",
      threadId: "thread-current",
      agentId: "secondary",
      runId: "run-secondary",
      eventType: "RUN_FINISHED",
    });
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(rendered.connectAgent).not.toHaveBeenCalled();
});

test("thread_run_activity still reconnects a passive chat when another device runs", async () => {
  const rendered = renderChatWithCore({
    intelligence: { wsUrl: "wss://intelligence.example/client" },
    threadEndpoints: { realtimeMetadata: true },
  });
  await settleInitialConnect(rendered);

  act(() => {
    rendered.store.emit({
      type: "thread_run_activity",
      threadId: "thread-current",
      agentId: DEFAULT_AGENT_ID,
      runId: "run-remote",
      eventType: "RUN_FINISHED",
    });
  });

  await waitFor(() => {
    expect(rendered.connectAgent).toHaveBeenCalledTimes(1);
  });
});

test("multiple thread_run_activity notifications during initial connect queue exactly one follow-up reconnect", async () => {
  const rendered = renderChatWithCore({
    deferInitialConnect: true,
    intelligence: { wsUrl: "wss://intelligence.example/client" },
    threadEndpoints: { realtimeMetadata: true },
  });

  await waitFor(() => {
    expect(rendered.connectAgent).toHaveBeenCalledTimes(1);
  });

  emitRunActivity(rendered.store);
  emitRunActivity(rendered.store);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(rendered.connectAgent).toHaveBeenCalledTimes(1);

  await act(async () => {
    rendered.initialConnect?.resolve();
    await rendered.initialConnect?.promise;
  });

  await waitFor(() => {
    expect(rendered.connectAgent).toHaveBeenCalledTimes(2);
  });
});

test("thread_run_activity notifications during an in-flight wake reconnect do not trigger a redundant same-generation reconnect", async () => {
  const rendered = renderChatWithCore({
    intelligence: { wsUrl: "wss://intelligence.example/client" },
    threadEndpoints: { realtimeMetadata: true },
  });
  await settleInitialConnect(rendered);
  const activeWakeReconnect = createDeferred();
  rendered.connectDeferrals.push(activeWakeReconnect);

  emitRunActivity(rendered.store);

  await waitFor(() => {
    expect(rendered.connectAgent).toHaveBeenCalledTimes(1);
  });

  emitRunActivity(rendered.store);
  emitRunActivity(rendered.store);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(rendered.connectAgent).toHaveBeenCalledTimes(1);

  await act(async () => {
    activeWakeReconnect.resolve();
    await activeWakeReconnect.promise;
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(rendered.connectAgent).toHaveBeenCalledTimes(1);
});

test("terminal thread_run_activity for a run already covered by a wake reconnect does not reconnect again", async () => {
  const rendered = renderChatWithCore({
    intelligence: { wsUrl: "wss://intelligence.example/client" },
    threadEndpoints: { realtimeMetadata: true },
  });
  await settleInitialConnect(rendered);
  const activeWakeReconnect = createDeferred();
  rendered.connectDeferrals.push(activeWakeReconnect);

  act(() => {
    rendered.store.emit({
      type: "thread_run_activity",
      threadId: "thread-current",
      agentId: DEFAULT_AGENT_ID,
      runId: "run-remote",
      eventType: "RUN_STARTED",
    });
  });

  await waitFor(() => {
    expect(rendered.connectAgent).toHaveBeenCalledTimes(1);
  });

  await act(async () => {
    activeWakeReconnect.resolve();
    await activeWakeReconnect.promise;
  });

  act(() => {
    rendered.store.emit({
      type: "thread_run_activity",
      threadId: "thread-current",
      agentId: DEFAULT_AGENT_ID,
      runId: "run-remote",
      eventType: "RUN_FINISHED",
    });
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(rendered.connectAgent).toHaveBeenCalledTimes(1);
});

test("queued thread_run_activity reconnect is discarded on unmount", async () => {
  const rendered = renderChatWithCore({
    intelligence: { wsUrl: "wss://intelligence.example/client" },
    threadEndpoints: { realtimeMetadata: true },
  });
  await settleInitialConnect(rendered);
  const activeConnect = createDeferred();
  rendered.connectDeferrals.push(activeConnect);

  emitRunActivity(rendered.store);
  await waitFor(() => {
    expect(rendered.connectAgent).toHaveBeenCalledTimes(1);
  });
  emitRunActivity(rendered.store);
  rendered.unmount();

  await act(async () => {
    activeConnect.resolve();
    await activeConnect.promise;
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(rendered.connectAgent).toHaveBeenCalledTimes(1);
});

test("in-flight thread_run_activity reconnect is detached on unmount", async () => {
  const rendered = renderChatWithCore({
    intelligence: { wsUrl: "wss://intelligence.example/client" },
    threadEndpoints: { realtimeMetadata: true },
  });
  await settleInitialConnect(rendered);
  const detachCallsBeforeReconnect = rendered.agent.detachActiveRunCalls;
  const activeConnect = createDeferred();
  rendered.connectDeferrals.push(activeConnect);

  emitRunActivity(rendered.store);
  await waitFor(() => {
    expect(rendered.connectAgent).toHaveBeenCalledTimes(1);
  });
  rendered.unmount();

  expect(rendered.agent.detachActiveRunCalls).toBe(
    detachCallsBeforeReconnect + 2,
  );

  await act(async () => {
    activeConnect.resolve();
    await activeConnect.promise;
  });
});

test("queued thread_run_activity reconnect is discarded on thread change", async () => {
  const rendered = renderChatWithCore({
    intelligence: { wsUrl: "wss://intelligence.example/client" },
    threadEndpoints: { realtimeMetadata: true },
  });
  await settleInitialConnect(rendered);
  const activeConnect = createDeferred();
  rendered.connectDeferrals.push(activeConnect);

  emitRunActivity(rendered.store);
  await waitFor(() => {
    expect(rendered.connectAgent).toHaveBeenCalledTimes(1);
  });
  emitRunActivity(rendered.store);
  rendered.rerender(
    <CopilotKitContext.Provider
      value={{
        copilotkit: rendered.core as never,
        executingToolCallIds: EMPTY_SET,
      }}
    >
      <CopilotChat threadId="thread-next" welcomeScreen={false} />
    </CopilotKitContext.Provider>,
  );

  await act(async () => {
    activeConnect.resolve();
    await activeConnect.promise;
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(rendered.connectAgent).toHaveBeenCalledTimes(2);
  expect(connectCallThreadIds(rendered.connectAgentCalls)).toEqual([
    "thread-current",
    "thread-next",
  ]);
});

test("queued thread_run_activity reconnect is discarded on agent change", async () => {
  const rendered = renderChatWithCore({
    intelligence: { wsUrl: "wss://intelligence.example/client" },
    threadEndpoints: { realtimeMetadata: true },
  });
  await settleInitialConnect(rendered);
  const activeConnect = createDeferred();
  rendered.connectDeferrals.push(activeConnect);

  emitRunActivity(rendered.store);
  await waitFor(() => {
    expect(rendered.connectAgent).toHaveBeenCalledTimes(1);
  });
  emitRunActivity(rendered.store);
  rendered.rerender(
    <CopilotKitContext.Provider
      value={{
        copilotkit: rendered.core as never,
        executingToolCallIds: EMPTY_SET,
      }}
    >
      <CopilotChat
        agentId="secondary"
        threadId="thread-current"
        welcomeScreen={false}
      />
    </CopilotKitContext.Provider>,
  );

  await act(async () => {
    activeConnect.resolve();
    await activeConnect.promise;
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(rendered.connectAgent).toHaveBeenCalledTimes(2);
  expect(rendered.connectAgentCalls.map((call) => call.agentId)).toEqual([
    DEFAULT_AGENT_ID,
    "secondary",
  ]);
  expect(connectCallThreadIds(rendered.connectAgentCalls)).toEqual([
    "thread-current",
    "thread-current",
  ]);
});
