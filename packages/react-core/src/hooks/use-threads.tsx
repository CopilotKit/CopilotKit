import { useCopilotKit } from "../context";
import { ɵThreadsController, ɵcreateThreadStore } from "@copilotkit/core";
import type { ɵThreadSummary } from "@copilotkit/core";
import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * A conversation thread managed by CopilotKit Intelligence.
 *
 * Each thread has a unique `id`, an optional human-readable `name`, and
 * ISO-8601 `createdAt` and `updatedAt` timestamps. `lastRunAt` is the time of
 * the most recent agent run, absent when the thread has never run; prefer it
 * over `updatedAt` for "last activity", since rename and archive do not bump
 * it. The shape is core's thread summary, which Angular also exposes.
 */
export type Thread = ɵThreadSummary;

/**
 * Configuration for the {@link useThreads} hook.
 *
 * Thread operations are scoped to the runtime-authenticated user and the
 * provided agent on CopilotKit Intelligence.
 */
export interface UseThreadsInput {
  /** The ID of the agent whose threads to list and manage. */
  agentId: string;
  /** When `true`, archived threads are included in the list. Defaults to `false`. */
  includeArchived?: boolean;
  /** Maximum number of threads to fetch per page. When set, enables cursor-based pagination. */
  limit?: number;
  /**
   * When `false`, the hook stays inert: no runtime context is dispatched, so
   * NO thread-list fetch or realtime subscription is issued. Used by gated
   * surfaces (e.g. an unlicensed `<CopilotThreadsDrawer>`) that must not touch the
   * network until the gate opens. Defaults to `true`.
   *
   * Flipping `enabled` back to `true` resumes normal fetching on the next
   * effect run; mutations are likewise short-circuited while disabled.
   */
  enabled?: boolean;
}

/**
 * Return value of the {@link useThreads} hook.
 *
 * The `threads` array is kept in sync with the platform via a realtime
 * WebSocket subscription (when available) and is sorted most-recently-updated
 * first. Mutations reject with an `Error` if the platform request fails.
 */
export interface UseThreadsResult {
  /**
   * Threads for the current user/agent pair, sorted by most recently
   * updated first. Updated in realtime when the platform pushes metadata
   * events. Includes archived threads only when `includeArchived` is set.
   */
  threads: Thread[];
  /**
   * `true` while the initial thread list is being fetched from the platform.
   * Subsequent realtime updates do not re-enter the loading state.
   */
  isLoading: boolean;
  /**
   * The most recent error from fetching threads or executing a mutation,
   * or `null` when there is no error. Reset to `null` on the next
   * successful fetch.
   *
   * This channel folds together developer/config errors (missing runtime URL,
   * runtime without thread endpoints) and genuine list-load/mutation failures.
   * End-user surfaces that must not leak config errors should prefer
   * {@link listError}, which excludes the config/runtime-setup errors.
   */
  error: Error | null;
  /**
   * The most recent genuine list-load or mutation error from the platform, or
   * `null`. Unlike {@link error}, this EXCLUDES developer/config errors (a
   * missing runtime URL, or a runtime that does not advertise thread
   * endpoints), so an end-user surface can render it directly without leaking
   * a developer-facing configuration message into the UI. It does report a
   * runtime that refuses to list threads because the caller has no identity
   * (no `identifyUser`), since the list cannot load until that is set.
   */
  listError: Error | null;
  /**
   * The error from the most recent FAILED next-page (fetch-more) load, or
   * `null`. Tracked separately from {@link listError} so a paginated-load
   * failure surfaces an inline "couldn't load more" affordance while the
   * already-loaded list stays visible. Cleared when a fetch-more is retried or
   * succeeds.
   */
  fetchMoreError: Error | null;
  /**
   * `true` when there are more threads available to fetch via
   * {@link fetchMoreThreads}. Only meaningful when `limit` is set.
   */
  hasMoreThreads: boolean;
  /**
   * `true` while a subsequent page of threads is being fetched.
   */
  isFetchingMoreThreads: boolean;
  /**
   * `true` while at least one thread mutation (rename, archive, unarchive,
   * delete) is awaiting a server response. Mutations apply optimistically, so
   * this is primarily useful for disabling controls or showing a subtle
   * in-flight indicator.
   */
  isMutating: boolean;
  /**
   * Fetch the next page of threads. No-op when {@link hasMoreThreads} is
   * `false` or a fetch is already in progress.
   */
  fetchMoreThreads: () => void;
  /**
   * Re-fetch the thread list from the platform without clearing the current
   * list. Backs the drawer's error-state Retry and the Active/All filter
   * refetch. No-op until the runtime is connected.
   */
  refetchThreads: () => void;
  /**
   * Reset to a fresh, non-explicit client-side thread so the welcome screen
   * shows. Lazy creation: no row appears in {@link threads} until the new
   * thread's first run persists server-side.
   */
  startNewThread: () => void;
  /**
   * Rename a thread on the platform.
   * Resolves when the server confirms the update; rejects on failure.
   */
  renameThread: (threadId: string, name: string) => Promise<void>;
  /**
   * Archive a thread on the platform.
   * Archived threads are excluded from subsequent list results.
   * Resolves when the server confirms the update; rejects on failure.
   */
  archiveThread: (threadId: string) => Promise<void>;
  /**
   * Restore a previously archived thread on the platform.
   * The thread re-appears in default (non-archived) list results.
   * Resolves when the server confirms the update; rejects on failure.
   */
  unarchiveThread: (threadId: string) => Promise<void>;
  /**
   * Permanently delete a thread from the platform.
   * This is irreversible. Resolves when the server confirms deletion;
   * rejects on failure.
   */
  deleteThread: (threadId: string) => Promise<void>;
}

/**
 * React hook for listing and managing CopilotKit Intelligence threads.
 *
 * On mount the hook fetches the thread list for the runtime-authenticated user
 * and the given `agentId`. When CopilotKit Intelligence exposes a WebSocket
 * URL, it also opens a realtime subscription so the `threads` array stays
 * current without polling — thread creates, renames, archives, and deletes
 * from any client are reflected immediately.
 *
 * Mutation methods (`renameThread`, `archiveThread`, `unarchiveThread`,
 * `deleteThread`) return promises that resolve once the platform confirms the
 * operation and reject with an `Error` on failure.
 *
 * @param input - Agent identifier and optional list controls.
 * @returns Thread list state and stable mutation callbacks.
 *
 * @example
 * ```tsx
 * import { useThreads } from "@copilotkit/react-core";
 *
 * function ThreadList() {
 *   const { threads, isLoading, renameThread, deleteThread } = useThreads({
 *     agentId: "agent-1",
 *   });
 *
 *   if (isLoading) return <p>Loading…</p>;
 *
 *   return (
 *     <ul>
 *       {threads.map((t) => (
 *         <li key={t.id}>
 *           {t.name ?? "Untitled"}
 *           <button onClick={() => renameThread(t.id, "New name")}>Rename</button>
 *           <button onClick={() => deleteThread(t.id)}>Delete</button>
 *         </li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
 */
export function useThreads({
  agentId,
  includeArchived,
  limit,
  enabled = true,
}: UseThreadsInput): UseThreadsResult {
  const { copilotkit } = useCopilotKit();

  // Core's ɵThreadsController owns the view model: thread projection, the
  // configuration errors, the gated and de-duplicated context dispatch, the
  // registry claim and the mutation guard. This hook feeds it and renders it.
  const [controller] = useState(
    () =>
      new ɵThreadsController(
        ɵcreateThreadStore({ fetch: copilotkit.ɵruntimeFetch }),
        { core: copilotkit, agentId, includeArchived, limit, enabled },
      ),
  );
  const {
    threads,
    isLoading,
    error,
    listError,
    fetchMoreError,
    hasMoreThreads,
    isFetchingMoreThreads,
    isMutating,
  } = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getServerSnapshot,
  );

  useEffect(() => controller.start(), [controller]);

  useEffect(() => {
    controller.update({
      core: copilotkit,
      agentId,
      includeArchived,
      limit,
      enabled,
    });
  }, [
    controller,
    copilotkit,
    agentId,
    includeArchived,
    limit,
    enabled,
    copilotkit.runtimeUrl,
    copilotkit.runtimeConnectionStatus,
    copilotkit.ɵheadersGeneration,
    copilotkit.intelligence?.wsUrl,
    copilotkit.threadEndpoints?.list,
    copilotkit.threadEndpoints?.mutations,
  ]);

  const {
    fetchMoreThreads,
    refetchThreads,
    startNewThread,
    renameThread,
    archiveThread,
    unarchiveThread,
    deleteThread,
  } = controller;

  return {
    threads,
    isLoading,
    error,
    listError,
    fetchMoreError,
    hasMoreThreads,
    isFetchingMoreThreads,
    isMutating,
    fetchMoreThreads,
    refetchThreads,
    startNewThread,
    renameThread,
    archiveThread,
    unarchiveThread,
    deleteThread,
  };
}
