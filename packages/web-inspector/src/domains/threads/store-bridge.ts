import {
  createInspectorThreadRequestId,
  emitInspectorStopViewing,
  emitInspectorViewThread,
  isInspectorThreadBridgeEnabled,
  onInspectorActiveThread,
  onInspectorViewThreadResult,
  ɵcreateThreadStore,
  ɵselectThreads,
  ɵselectThreadsError,
  ɵselectThreadsIsLoading,
} from "@copilotkit/core";
import type { CopilotKitCore, ɵThread, ɵThreadStore } from "@copilotkit/core";
import { selectActiveThreads } from "./selectors.js";
import type { ThreadsState } from "./state.js";

const THREAD_LIST_DEBOUNCE_MS = 300;

type ThreadStoreStatus = Readonly<{
  error: Error | null;
  isLoading: boolean;
}>;

export type ThreadStoreBridgeActions = {
  endpointsAvailable: () => boolean;
  reconcileSelection: () => void;
  onThreadsChanged: () => void;
  requestUpdate: () => void;
};

export function createThreadStoreStatusSelector(): (
  state: ReturnType<ɵThreadStore["getState"]>,
) => ThreadStoreStatus {
  let previousError: Error | null | undefined;
  let previousIsLoading: boolean | undefined;
  let previousStatus: ThreadStoreStatus | undefined;

  return (state) => {
    const error = ɵselectThreadsError(state);
    const isLoading = ɵselectThreadsIsLoading(state);
    if (
      previousStatus &&
      previousError === error &&
      previousIsLoading === isLoading
    ) {
      return previousStatus;
    }
    previousError = error;
    previousIsLoading = isLoading;
    previousStatus = { error, isLoading };
    return previousStatus;
  };
}

export function rebuildFlattenedThreads(state: ThreadsState): void {
  state.threads = selectActiveThreads(state.threadsByAgent, "all-agents");
}

export function subscribeToThreadStore(
  state: ThreadsState,
  agentId: string,
  store: ɵThreadStore,
  actions: ThreadStoreBridgeActions,
): void {
  if (!actions.endpointsAvailable()) return;
  if (state.threadStoreSubscriptions.has(agentId)) return;
  const capabilityGeneration = state.threadCapabilityGeneration;
  const isCurrent = () =>
    capabilityGeneration === state.threadCapabilityGeneration &&
    actions.endpointsAvailable();
  const threadsSub = store.select(ɵselectThreads).subscribe((threads) => {
    if (!isCurrent()) return;
    state.threadsByAgent.set(agentId, threads);
    rebuildFlattenedThreads(state);
    actions.onThreadsChanged();
    actions.reconcileSelection();
    actions.requestUpdate();
  });
  const statusSub = store
    .select(createThreadStoreStatusSelector())
    .subscribe(({ error, isLoading }) => {
      if (!isCurrent()) return;
      if (error) {
        state.threadsErrorByAgent.set(agentId, error);
      } else if (!isLoading) {
        state.threadsErrorByAgent.delete(agentId);
      }
      state.threadsLoadingByAgent.set(agentId, isLoading);
      actions.requestUpdate();
    });
  state.threadStoreSubscriptions.set(agentId, () => {
    threadsSub.unsubscribe();
    statusSub.unsubscribe();
  });

  if (!isCurrent()) return;
  const initialState = store.getState();
  state.threadsByAgent.set(agentId, ɵselectThreads(initialState));
  const isLoading = ɵselectThreadsIsLoading(initialState);
  state.threadsLoadingByAgent.set(agentId, isLoading);
  const error = ɵselectThreadsError(initialState);
  if (error) {
    state.threadsErrorByAgent.set(agentId, error);
  } else if (!isLoading) {
    state.threadsErrorByAgent.delete(agentId);
  }
  rebuildFlattenedThreads(state);
  actions.onThreadsChanged();
  actions.reconcileSelection();
}

export function teardownThreadStoreSubscriptions(
  state: ThreadsState,
  onThreadsChanged: () => void,
): void {
  for (const unsubscribe of state.threadStoreSubscriptions.values()) {
    unsubscribe();
  }
  state.threadStoreSubscriptions.clear();
  state.threadsByAgent.clear();
  state.threadsErrorByAgent.clear();
  state.threadsLoadingByAgent.clear();
  state.threads = [];
  onThreadsChanged();
}

export function ensureOwnedThreadStore(
  state: ThreadsState,
  core: CopilotKitCore | null,
  agentId: string,
  subscribe: (agentId: string, store: ɵThreadStore) => void,
  endpointsAvailable: boolean,
): void {
  if (!endpointsAvailable || !core?.runtimeUrl) return;
  if (state.ownedThreadStores.has(agentId) || core.getThreadStore(agentId)) {
    return;
  }
  const runtimeFetch =
    typeof core.ɵruntimeFetch === "function"
      ? core.ɵruntimeFetch
      : globalThis.fetch;
  const store = ɵcreateThreadStore({ fetch: runtimeFetch });
  store.start();
  store.setContext({
    runtimeUrl: core.runtimeUrl,
    headers: { ...core.headers },
    wsUrl: core.intelligence?.wsUrl,
    agentId,
  });
  state.ownedThreadStores.set(agentId, store);
  subscribe(agentId, store);
  core.registerThreadStore(agentId, store);
}

function sendOwnedThreadRefresh(
  state: ThreadsState,
  agentId: string,
  store: ɵThreadStore,
  sentAt: number,
): void {
  state.threadRefreshLastSentAt.set(agentId, sentAt);
  store.refresh();
}

export function refreshOwnedThreadStore(
  state: ThreadsState,
  agentId: string,
  endpointsAvailable: boolean,
): void {
  if (!endpointsAvailable) return;
  const store = state.ownedThreadStores.get(agentId);
  if (!store) return;
  const now = Date.now();
  const lastSentAt = state.threadRefreshLastSentAt.get(agentId) ?? 0;
  const waitMs = THREAD_LIST_DEBOUNCE_MS - (now - lastSentAt);
  if (waitMs <= 0) {
    sendOwnedThreadRefresh(state, agentId, store, now);
    return;
  }
  if (state.threadRefreshTrailingTimers.has(agentId)) return;
  state.threadRefreshTrailingTimers.set(
    agentId,
    setTimeout(() => {
      state.threadRefreshTrailingTimers.delete(agentId);
      const current = state.ownedThreadStores.get(agentId);
      if (current) {
        sendOwnedThreadRefresh(state, agentId, current, Date.now());
      }
    }, waitMs),
  );
}

export function cancelThreadRefreshDebounce(state: ThreadsState): void {
  for (const timer of state.threadRefreshTrailingTimers.values()) {
    clearTimeout(timer);
  }
  state.threadRefreshTrailingTimers.clear();
}

export function updateOwnedThreadStoreHeaders(
  state: ThreadsState,
  core: CopilotKitCore | null,
  headers: Readonly<Record<string, string>>,
  endpointsAvailable: boolean,
): void {
  if (!endpointsAvailable || !core?.runtimeUrl) return;
  for (const [agentId, store] of state.ownedThreadStores) {
    store.setContext({
      runtimeUrl: core.runtimeUrl,
      headers: { ...headers },
      wsUrl: core.intelligence?.wsUrl,
      agentId,
    });
  }
}

export function removeOwnedThreadStore(
  state: ThreadsState,
  core: CopilotKitCore | null,
  agentId: string,
): void {
  const store = state.ownedThreadStores.get(agentId);
  if (!store) return;
  state.ownedThreadStores.delete(agentId);
  store.stop();
  if (core?.getThreadStore(agentId) === store) {
    core.unregisterThreadStore(agentId);
  }
}

export function teardownOwnedThreadStores(
  state: ThreadsState,
  core: CopilotKitCore | null,
): void {
  const stores = Array.from(state.ownedThreadStores);
  state.ownedThreadStores.clear();
  for (const [agentId, store] of stores) {
    store.stop();
    if (core?.getThreadStore(agentId) === store) {
      core.unregisterThreadStore(agentId);
    }
  }
}

export function subscribeToInspectorThreadBridge(
  state: ThreadsState,
  requestUpdate: () => void,
): void {
  unsubscribeFromInspectorThreadBridge(state);
  if (!isInspectorThreadBridgeEnabled()) return;
  state.inspectorBridgeUnsubscribers.push(
    onInspectorActiveThread((payload) => {
      if (payload.requestId !== state.activeViewInAppRequestId) return;
      state.inAppThreadId = payload.threadId;
      state.inAppAgentId = payload.agentId;
      state.inAppSource = payload.source;
      if (payload.source === "app") {
        state.activeViewInAppRequestId = null;
        state.viewInAppError = null;
      }
      requestUpdate();
    }),
    onInspectorViewThreadResult((payload) => {
      if (payload.requestId !== state.activeViewInAppRequestId) return;
      if (payload.ok) {
        state.viewInAppError = null;
        state.inAppThreadId = payload.threadId;
        state.inAppAgentId = payload.agentId;
        state.inAppSource = "override";
      } else {
        state.activeViewInAppRequestId = null;
        state.inAppThreadId = null;
        state.inAppAgentId = null;
        state.inAppSource = null;
        state.viewInAppError =
          "The app could not load that thread. The previous chat is back.";
      }
      requestUpdate();
    }),
  );
}

export function unsubscribeFromInspectorThreadBridge(
  state: ThreadsState,
): void {
  for (const unsubscribe of state.inspectorBridgeUnsubscribers) {
    unsubscribe();
  }
  state.inspectorBridgeUnsubscribers = [];
}

export function getViewInAppMode(
  state: ThreadsState,
  thread: ɵThread | null,
  isExample: boolean,
): "hidden" | "view" | "stop" {
  if (!isInspectorThreadBridgeEnabled() || !thread || isExample) {
    return "hidden";
  }
  return state.activeViewInAppRequestId &&
    state.inAppSource === "override" &&
    state.inAppThreadId === thread.id
    ? "stop"
    : "view";
}

export function viewThreadInApp(state: ThreadsState, thread: ɵThread): void {
  if (state.activeViewInAppRequestId && state.inAppAgentId) {
    emitInspectorStopViewing({
      requestId: state.activeViewInAppRequestId,
      agentId: state.inAppAgentId,
    });
  }
  state.viewInAppError = null;
  const requestId = createInspectorThreadRequestId();
  state.activeViewInAppRequestId = requestId;
  const handled = emitInspectorViewThread({
    requestId,
    threadId: thread.id,
    agentId: thread.agentId,
  });
  if (!handled) {
    state.activeViewInAppRequestId = null;
    state.inAppThreadId = null;
    state.inAppAgentId = null;
    state.inAppSource = null;
    state.viewInAppError = "No official chat for this agent is on the page.";
  }
}

export function stopViewingThreadInApp(state: ThreadsState): boolean {
  const requestId = state.activeViewInAppRequestId;
  const agentId = state.inAppAgentId;
  if (!requestId || !agentId) return false;
  state.viewInAppError = null;
  emitInspectorStopViewing({ requestId, agentId });
  return true;
}
