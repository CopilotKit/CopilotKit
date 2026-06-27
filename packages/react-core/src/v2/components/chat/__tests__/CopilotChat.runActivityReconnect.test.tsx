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
import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkit/core";
import type {
  ThreadRunActivityNotification,
  ɵThreadStore,
} from "@copilotkit/core";
import type { Observable } from "rxjs";
import { EMPTY, Subscription } from "rxjs";
import { CopilotKitContext, EMPTY_SET } from "../../../context";
import { CopilotChat } from "../CopilotChat";

afterEach(() => {
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
};

type RunActivityStore = Pick<ɵThreadStore, "subscribeToRunActivity"> & {
  emit(notification: ThreadRunActivityNotification): void;
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
    getThreadStore: vi.fn(() => store),
    headers: {},
    intelligence: options.intelligence,
    runtimeConnectionStatus:
      options.runtimeConnectionStatus ??
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    runtimeTransport: "auto",
    runtimeUrl: undefined,
    subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
    subscribeToAgentWithOptions: vi.fn(() => ({ unsubscribe: vi.fn() })),
    reloadSuggestions: vi.fn(),
    runAgent,
    threadEndpoints: options.threadEndpoints ?? { realtimeMetadata: true },
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

  return { agent, store, ...core, ...rendered };
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

test("thread_run_activity from a same-agent different run reconnects while a local run is active", async () => {
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

  await waitFor(() => {
    expect(rendered.connectAgent).toHaveBeenCalledTimes(1);
  });

  await act(async () => {
    activeRun.resolve();
    await activeRun.promise;
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

test("multiple thread_run_activity notifications during an in-flight connect queue exactly one follow-up reconnect", async () => {
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
  emitRunActivity(rendered.store);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(rendered.connectAgent).toHaveBeenCalledTimes(1);

  await act(async () => {
    activeConnect.resolve();
    await activeConnect.promise;
  });

  await waitFor(() => {
    expect(rendered.connectAgent).toHaveBeenCalledTimes(2);
  });
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
