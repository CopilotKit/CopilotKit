import { computed, onScopeDispose, shallowRef, toValue, watch } from "vue";
import type { MaybeRefOrGetter, Ref } from "vue";
import { ɵThreadsController, ɵcreateThreadStore } from "@copilotkit/core";
import type { ɵThreadSummary } from "@copilotkit/core";
import { useCopilotKit } from "../providers/useCopilotKit";

/**
 * One thread as the hook returns it. This is core's thread summary, the same
 * type React and Angular expose, so the adapters cannot drift apart.
 */
export type Thread = ɵThreadSummary;

export interface UseThreadsInput {
  agentId: MaybeRefOrGetter<string>;
  includeArchived?: MaybeRefOrGetter<boolean | undefined>;
  limit?: MaybeRefOrGetter<number | undefined>;
  /**
   * When `false`, the hook clears the store context and issues no `/threads`
   * request — used by the drawer to skip fetching while unlicensed. Defaults
   * to `true`.
   */
  enabled?: MaybeRefOrGetter<boolean | undefined>;
}

export interface UseThreadsResult {
  threads: Ref<Thread[]>;
  isLoading: Ref<boolean>;
  error: Ref<Error | null>;
  /**
   * Genuine list-load/mutation errors only — excludes dev/config errors. Also
   * reports a runtime that refuses to list threads for a caller without
   * identity (no `identifyUser`).
   */
  listError: Ref<Error | null>;
  /**
   * Error from the most recent FAILED next-page (fetch-more) load, or `null`.
   * Tracked separately from {@link listError} so a paginated-load failure
   * shows an inline "couldn't load more" affordance while the loaded list
   * stays visible. Cleared when a fetch-more is retried or succeeds.
   */
  fetchMoreError: Ref<Error | null>;
  hasMoreThreads: Ref<boolean>;
  isFetchingMoreThreads: Ref<boolean>;
  isMutating: Ref<boolean>;
  fetchMoreThreads: () => void;
  refetchThreads: () => void;
  startNewThread: () => void;
  renameThread: (threadId: string, name: string) => Promise<void>;
  archiveThread: (threadId: string) => Promise<void>;
  unarchiveThread: (threadId: string) => Promise<void>;
  deleteThread: (threadId: string) => Promise<void>;
}

export function useThreads(input: UseThreadsInput): UseThreadsResult {
  const { copilotkit } = useCopilotKit();
  const readInput = () => ({
    core: copilotkit.value,
    agentId: toValue(input.agentId),
    includeArchived: toValue(input.includeArchived),
    limit: toValue(input.limit),
    enabled: toValue(input.enabled) ?? true,
  });

  // Core's ɵThreadsController owns the view model: thread projection, the
  // configuration errors, the gated and de-duplicated context dispatch, the
  // registry claim and the mutation guard. This composable feeds it and
  // projects its snapshot.
  const controller = new ɵThreadsController(
    ɵcreateThreadStore({ fetch: copilotkit.value.ɵruntimeFetch }),
    readInput(),
  );
  const snapshot = shallowRef(controller.getSnapshot());
  const unsubscribe = controller.subscribe(() => {
    snapshot.value = controller.getSnapshot();
  });
  const stop = controller.start();
  onScopeDispose(() => {
    stop();
    unsubscribe();
    controller.dispose();
  });

  watch(
    [
      readInput,
      () => copilotkit.value.runtimeUrl,
      () => copilotkit.value.runtimeConnectionStatus,
      () => copilotkit.value.ɵheadersGeneration,
      () => copilotkit.value.intelligence?.wsUrl,
      () => copilotkit.value.threadEndpoints?.list,
      () => copilotkit.value.threadEndpoints?.mutations,
    ],
    ([next]) => controller.update(next),
    { immediate: true },
  );

  return {
    threads: computed(() => snapshot.value.threads),
    isLoading: computed(() => snapshot.value.isLoading),
    error: computed(() => snapshot.value.error),
    listError: computed(() => snapshot.value.listError),
    fetchMoreError: computed(() => snapshot.value.fetchMoreError),
    hasMoreThreads: computed(() => snapshot.value.hasMoreThreads),
    isFetchingMoreThreads: computed(() => snapshot.value.isFetchingMoreThreads),
    isMutating: computed(() => snapshot.value.isMutating),
    fetchMoreThreads: controller.fetchMoreThreads,
    refetchThreads: controller.refetchThreads,
    startNewThread: controller.startNewThread,
    renameThread: controller.renameThread,
    archiveThread: controller.archiveThread,
    unarchiveThread: controller.unarchiveThread,
    deleteThread: controller.deleteThread,
  };
}
