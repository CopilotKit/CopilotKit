import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
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

vi.mock("../CopilotChatView", () => {
  const CopilotChatView = () => <div data-testid="mock-copilot-chat-view" />;
  return {
    CopilotChatView,
    default: CopilotChatView,
  };
});

type ConnectCall = {
  agent: TestAgent;
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
  connect(_input: RunAgentInput): Observable<BaseEvent> {
    return EMPTY;
  }

  async detachActiveRun(): Promise<void> {}

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
  const connectAgent = vi.fn((call: ConnectCall) => {
    connectAgentCalls.push(call);
    const deferred = connectDeferrals.shift();
    return deferred ? deferred.promise : Promise.resolve();
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
    threadEndpoints: options.threadEndpoints ?? { realtimeMetadata: true },
  };

  return {
    connectAgent,
    connectAgentCalls,
    connectDeferrals,
    core,
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
});
