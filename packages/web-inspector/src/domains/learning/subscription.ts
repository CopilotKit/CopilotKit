import {
  ɵselectMemories,
  ɵselectMemoriesAvailable,
  ɵselectMemoriesError,
  ɵselectMemoriesIsLoading,
  ɵselectMemoriesRealtimeStatus,
} from "@copilotkit/core";
import type { CopilotKitCore } from "@copilotkit/core";
import type { LearningState } from "./state.js";

type LearningCore = {
  getMemoryStore?: CopilotKitCore["getMemoryStore"];
};

export type LearningSubscriptionActions = Readonly<{
  projectError: (error: Error) => void;
  requestUpdate: () => void;
}>;

export function ensureLearningSubscription(
  state: LearningState,
  core: LearningCore | null,
  actions: LearningSubscriptionActions,
): void {
  if (state.memorySubscribed || !core) return;

  if (typeof core.getMemoryStore !== "function") {
    state.memoryStoreUnsupported = true;
    state.memoriesAvailable = false;
    actions.requestUpdate();
    return;
  }

  state.memorySubscribed = true;
  state.memoryStoreUnsupported = false;

  const memoryStore = core.getMemoryStore();
  const snapshot = memoryStore.getState();
  state.memories = ɵselectMemories(snapshot);
  state.memoriesLoading = ɵselectMemoriesIsLoading(snapshot);
  state.memoriesError = ɵselectMemoriesError(snapshot);
  state.memoriesAvailable = ɵselectMemoriesAvailable(snapshot);
  state.memoriesRealtimeStatus = ɵselectMemoriesRealtimeStatus(snapshot);

  const subscriptions = [
    memoryStore.select(ɵselectMemories).subscribe((memories) => {
      state.memories = memories;
      actions.requestUpdate();
    }),
    memoryStore.select(ɵselectMemoriesIsLoading).subscribe((isLoading) => {
      state.memoriesLoading = isLoading;
      actions.requestUpdate();
    }),
    memoryStore.select(ɵselectMemoriesError).subscribe((error) => {
      state.memoriesError = error;
      if (error) actions.projectError(error);
      actions.requestUpdate();
    }),
    memoryStore.select(ɵselectMemoriesAvailable).subscribe((available) => {
      state.memoriesAvailable = available;
      actions.requestUpdate();
    }),
    memoryStore
      .select(ɵselectMemoriesRealtimeStatus)
      .subscribe((realtimeStatus) => {
        state.memoriesRealtimeStatus = realtimeStatus;
        actions.requestUpdate();
      }),
  ];
  state.memoryUnsubscribe = () => {
    for (const subscription of subscriptions) subscription.unsubscribe();
  };
  actions.requestUpdate();
}
