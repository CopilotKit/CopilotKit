"use client";

import {
  Archive,
  ArchiveRestore,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  Rows3,
  Search,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useThreads } from "@copilotkit/react-core/v2";
import type { AgentId } from "@/components/agent-selector";
import styles from "./threads-drawer.module.css";

export interface ThreadsDrawerProps {
  threadId: string | undefined;
  /**
   * Fires when the user picks a thread (or clears the selection). Receives
   * the thread's owning `agentId` so the parent can flip the active agent
   * to match — threads are partitioned per-agent on the Intelligence
   * platform, so opening a thread that belongs to a different agent must
   * also switch the agent.
   */
  onThreadChange: (threadId: string | undefined, agentId?: AgentId) => void;
  /**
   * Called when the user explicitly clicks one of the "New thread" buttons
   * (the collapsed-drawer "+" or the in-drawer header button). Distinct
   * from `onThreadChange(undefined)` — which is also used by the delete
   * flow to drop the active selection — so the parent can do additional
   * work on a true new-conversation event (e.g. minting a fresh threadId
   * UUID, resetting layout mode to "chat").
   */
  onNewThread?: () => void;
  /**
   * Threads the user has "touched" this session that may or may not exist
   * on the Intelligence platform yet (or ever — hardcoded ADK chips skip
   * runAgent entirely). The drawer merges these with the server lists and
   * synthesizes a placeholder row for any id not already covered, so the
   * Dashboard Designer "Build the dashboard" flow shows up in the drawer
   * immediately on chip click instead of being invisible.
   */
  localThreadEntries?: Map<string, { agentId: AgentId; updatedAt: string }>;
}

interface DrawerThread {
  id: string;
  agentId: AgentId;
  name: string | null;
  updatedAt: string;
  archived: boolean;
  lastRunAt?: string;
}

const AGENT_LABELS: Record<AgentId, string> = {
  langgraph: "Cowork",
  adk: "Dashboard Designer",
  mastra: "Engineering Agent",
};

const THREAD_ENTRY_ANIMATION_MS = 420;
const TITLE_ANIMATION_MS = 360;
const UNTITLED_THREAD_LABEL = "New thread";
const RUNTIME_BASE_PATH = "/api/copilotkit";

// The BFF's thread-name handler writes this string when LLM-driven title
// generation fails (aimock has no fixture for the title prompt, so all three
// attempts return invalid). Detect it on the client and swap in an
// agent-flavoured default after a short beat so the drawer never shows the
// raw fallback to demo viewers.
const PLATFORM_FALLBACK_TITLE = "Untitled";
const TITLE_REBRAND_DELAY_MS = 700;

const AGENT_DEFAULT_TITLES: Record<AgentId, string> = {
  langgraph: "Plan Backlog from image",
  adk: "Build dashboard from backlog",
  mastra: "Engineering session",
};

function formatThreadTimestamp(updatedAt: string): string {
  const timestamp = new Date(updatedAt);
  if (Number.isNaN(timestamp.getTime())) return "Updated recently";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

function cx(...classNames: Array<string | false | undefined>): string {
  return classNames.filter(Boolean).join(" ");
}

export default function ThreadsDrawer({
  threadId,
  onThreadChange,
  onNewThread,
  localThreadEntries,
}: ThreadsDrawerProps) {
  // Use `onNewThread` if the parent provided one (it does the full
  // new-conversation reset). Fall back to the older onThreadChange(undefined)
  // path for callers that haven't migrated yet.
  const handleNewThread = () =>
    onNewThread ? onNewThread() : onThreadChange(undefined);
  const [showArchived, setShowArchived] = useState(false);
  const [isOpen, setIsOpen] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    agentId: AgentId;
    title: string;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const deleteTriggerRef = useRef<HTMLElement | null>(null);

  // Threads on the Intelligence platform are partitioned by (userId, agentId)
  // and `useThreads` only queries one partition per call. To present a single
  // unified thread list across both agents, we open one store per agent and
  // merge them client-side; each row carries its `agentId` so mutations are
  // routed back to the correct store.
  const langgraphResult = useThreads({
    agentId: "langgraph",
    includeArchived: showArchived,
    limit: 20,
  });
  const adkResult = useThreads({
    agentId: "adk",
    includeArchived: showArchived,
    limit: 20,
  });

  // Threads whose null/"Untitled" server name has been swapped client-side
  // for an agent-specific default ("Plan Backlog from image", "Build
  // dashboard from backlog"). Hoisted above the `threads` useMemo so the
  // filter below can keep these rows visible after they stop being the
  // active thread — without this, swapping agents (which rotates threadId)
  // would drop the previous conversation from the drawer because the
  // server still has name === null and our `t.name !== null` gate fails.
  const [rebrandedTitleIds, setRebrandedTitleIds] = useState<
    Record<string, true>
  >({});

  const threads = useMemo<DrawerThread[]>(() => {
    // Intelligence platform's WS join code is per-user, not per-(user,agent):
    // both `useThreads({agentId: "langgraph"})` and `useThreads({agentId:
    // "adk"})` get the same `joinCode` from /threads, subscribe to the same
    // `user_meta:<joinCode>` Phoenix topic, and so a thread upsert pushed for
    // *any* agent shows up in *both* stores. Without dedupe + agentId
    // disambiguation, a single Cowork thread renders twice in the drawer
    // (once as "Cowork", once as "Dashboard Designer") immediately after the
    // first message lands.
    //
    // Each thread carries its real partition in `t.agentId` (forwarded from
    // the REST response and the WS payload), so dedupe by id and trust the
    // thread's own agentId instead of the partition the hook was scoped to.
    const seen = new Set<string>();
    const merged: DrawerThread[] = [];
    for (const t of [...langgraphResult.threads, ...adkResult.threads]) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      // Defensive: ignore threads with an agentId we don't know how to label
      // (e.g. legacy "default" partition rows). They'd render with a broken
      // agent badge and route mutations to the wrong store.
      if (t.agentId !== "langgraph" && t.agentId !== "adk") continue;
      merged.push({
        id: t.id,
        agentId: t.agentId as AgentId,
        name: t.name,
        archived: t.archived,
        updatedAt: t.updatedAt,
        ...(t.lastRunAt !== undefined ? { lastRunAt: t.lastRunAt } : {}),
      });
    }
    // Synthesize rows for client-only threads — hardcoded ADK chips never
    // call runAgent, so the Intelligence platform never persists a row.
    // Without this the Dashboard Designer "Build the dashboard" flow is
    // invisible in the drawer even though the conversation is live in the
    // chat panel. We treat these synthesized rows as name=null so they
    // flow through the rebrand pipeline → agent-specific default title.
    if (localThreadEntries) {
      for (const [id, entry] of localThreadEntries) {
        if (seen.has(id)) continue;
        seen.add(id);
        merged.push({
          id,
          agentId: entry.agentId,
          name: null,
          archived: false,
          updatedAt: entry.updatedAt,
        });
      }
    }
    // Drawer shows a thread iff it's the currently active one OR it has a
    // (real or client-rebranded) name, so real conversations from history
    // stay visible while phantom rows drop out.
    //
    // Phantoms we exclude:
    //   - Agent-swap / New-thread minted UUIDs that never received a run
    //     (no name, no lastRunAt) — purely client-side artifacts.
    //   - Pre-existing rows from earlier sessions where BFF
    //     thread-name-generation ran 3× ephemeral runs per user message
    //     against random throwaway threadIds (now disabled at the runtime
    //     via `generateThreadNames: false` in apps/bff/src/server.ts).
    //     Those legacy rows still sit in the Intelligence platform DB
    //     with a lastRunAt but no name — we deliberately do *not* let
    //     `lastRunAt !== undefined` rescue them.
    //
    // HomePage pre-mints threadId on mount, so the user's actual active
    // thread always passes via `t.id === threadId` even before the first
    // message lands.
    //
    // `rebrandedTitleIds[t.id]` keeps client-side-rebranded threads in
    // view after they stop being active (e.g. user sends "Plan next
    // sprint" on Cowork → 700ms rebrand fires → user swaps to Designer:
    // the Cowork row should stay in the list because the user "named"
    // it implicitly by sending a message, even though the server still
    // has name === null).
    const filtered = merged.filter(
      (t) => t.id === threadId || t.name !== null || rebrandedTitleIds[t.id],
    );
    filtered.sort((a, b) => {
      const aTs = new Date(a.lastRunAt ?? a.updatedAt).getTime();
      const bTs = new Date(b.lastRunAt ?? b.updatedAt).getTime();
      return bTs - aTs;
    });
    return filtered;
  }, [
    langgraphResult.threads,
    adkResult.threads,
    threadId,
    rebrandedTitleIds,
    localThreadEntries,
  ]);

  const resultFor = useCallback(
    (id: AgentId) => (id === "adk" ? adkResult : langgraphResult),
    [langgraphResult, adkResult],
  );

  const error = langgraphResult.error ?? adkResult.error;
  const isLoading = langgraphResult.isLoading || adkResult.isLoading;
  const hasMoreThreads =
    langgraphResult.hasMoreThreads || adkResult.hasMoreThreads;
  const isFetchingMoreThreads =
    langgraphResult.isFetchingMoreThreads || adkResult.isFetchingMoreThreads;
  const fetchMoreThreads = useCallback(() => {
    if (langgraphResult.hasMoreThreads) langgraphResult.fetchMoreThreads();
    if (adkResult.hasMoreThreads) adkResult.fetchMoreThreads();
  }, [langgraphResult, adkResult]);

  const renameThread = useCallback(
    (id: string, agentForThread: AgentId, name: string) =>
      resultFor(agentForThread).renameThread(id, name),
    [resultFor],
  );
  const archiveThread = useCallback(
    (id: string, agentForThread: AgentId) =>
      resultFor(agentForThread).archiveThread(id),
    [resultFor],
  );
  const deleteThread = useCallback(
    (id: string, agentForThread: AgentId) =>
      resultFor(agentForThread).deleteThread(id),
    [resultFor],
  );

  const restoreThread = useCallback(
    async (id: string, agentForThread: AgentId) => {
      const response = await fetch(
        `${RUNTIME_BASE_PATH}/threads/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId: agentForThread, archived: false }),
        },
      );
      if (!response.ok) {
        throw new Error(
          `Restore failed: ${response.status} ${response.statusText}`,
        );
      }
    },
    [],
  );

  const hasMountedRef = useRef(false);
  const hasLoadedOnceRef = useRef(false);
  const stableThreadsRef = useRef<DrawerThread[]>(threads);
  const previousThreadIdsRef = useRef<Set<string>>(new Set());
  const previousNamesRef = useRef<Map<string, string | null>>(new Map());
  const entryTimeoutsRef = useRef<Map<string, number>>(new Map());
  const titleTimeoutsRef = useRef<Map<string, number>>(new Map());

  if (!isLoading) {
    hasLoadedOnceRef.current = true;
    stableThreadsRef.current = threads;
  }
  const displayThreads: DrawerThread[] =
    isLoading && hasLoadedOnceRef.current ? stableThreadsRef.current : threads;
  const [enteringThreadIds, setEnteringThreadIds] = useState<
    Record<string, true>
  >({});
  const [revealedTitleIds, setRevealedTitleIds] = useState<
    Record<string, true>
  >({});
  // `rebrandedTitleIds` is declared above the `threads` useMemo so the
  // drawer's filter can keep client-side-rebranded rows visible after
  // they stop being the active thread. Only the timeouts ref lives here.
  const rebrandTimeoutsRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    // Capture the (stable-identity) timeout maps. Each ref holds a single Map
    // for the component's lifetime — only ever mutated via set/delete, never
    // reassigned — so reading `.current` here is equivalent to reading it in
    // the cleanup, and the cleanup still clears whatever timers are live at
    // unmount. Capturing also satisfies react-hooks/exhaustive-deps.
    const entryTimeouts = entryTimeoutsRef.current;
    const titleTimeouts = titleTimeoutsRef.current;
    const rebrandTimeouts = rebrandTimeoutsRef.current;
    return () => {
      for (const timeoutId of entryTimeouts.values()) {
        window.clearTimeout(timeoutId);
      }
      for (const timeoutId of titleTimeouts.values()) {
        window.clearTimeout(timeoutId);
      }
      for (const timeoutId of rebrandTimeouts.values()) {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);

  // Watch for threads that need their first real title and schedule a
  // rebrand → agent-specific default. The 700ms delay lets the user clock
  // the placeholder/"Untitled" state for a beat so the swap reads as the
  // copilot retitling the thread, not a typo.
  //
  // Triggers on either:
  //   - name === null: the new default now that BFF title-gen is off
  //     (`generateThreadNames: false` in apps/bff/src/server.ts). The
  //     Intelligence platform also doesn't return `lastRunAt` on threads,
  //     so we can't gate on "has been run" — instead we rely on the
  //     drawer's filter, which keeps null-named threads in view only when
  //     they're the *active* thread. So a null name in `threads` here
  //     already implies "the user's current conversation."
  //   - name === "Untitled": the BFF's thread-name fallback (only happens
  //     when generateThreadNames is left on; kept for legacy threads
  //     carried over from before the flag flipped).
  useEffect(() => {
    if (isLoading) return;
    for (const thread of threads) {
      const needsRebrand =
        thread.name === null || thread.name === PLATFORM_FALLBACK_TITLE;
      if (!needsRebrand) continue;
      if (rebrandedTitleIds[thread.id]) continue;
      if (rebrandTimeoutsRef.current.has(thread.id)) continue;
      const id = thread.id;
      const tid = window.setTimeout(() => {
        rebrandTimeoutsRef.current.delete(id);
        // Replay the existing blur/translate reveal animation so the
        // rebrand reads as the title "morphing" into its new shape.
        setRevealedTitleIds((s) => ({ ...s, [id]: true }));
        setRebrandedTitleIds((s) => ({ ...s, [id]: true }));
        const existing = titleTimeoutsRef.current.get(id);
        if (existing !== undefined) window.clearTimeout(existing);
        const clearTid = window.setTimeout(() => {
          setRevealedTitleIds((s) => {
            const updated = { ...s };
            delete updated[id];
            return updated;
          });
          titleTimeoutsRef.current.delete(id);
        }, TITLE_ANIMATION_MS);
        titleTimeoutsRef.current.set(id, clearTid);
      }, TITLE_REBRAND_DELAY_MS);
      rebrandTimeoutsRef.current.set(id, tid);
    }
  }, [threads, isLoading, rebrandedTitleIds]);

  useEffect(() => {
    // Skip diffing while the store is refetching (e.g. after a filter change
    // clears the list). Otherwise every thread would be treated as newly
    // added once the new page lands.
    if (isLoading) return;

    const nextThreadIds = new Set(threads.map((t) => t.id));

    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      previousThreadIdsRef.current = nextThreadIds;
      previousNamesRef.current = new Map(threads.map((t) => [t.id, t.name]));
      return;
    }

    const addedThreadIds = threads
      .filter((t) => !previousThreadIdsRef.current.has(t.id))
      .map((t) => t.id);

    if (addedThreadIds.length > 0) {
      setEnteringThreadIds((current) => {
        const next = { ...current };
        for (const id of addedThreadIds) {
          next[id] = true;
          const existing = entryTimeoutsRef.current.get(id);
          if (existing !== undefined) window.clearTimeout(existing);
          const tid = window.setTimeout(() => {
            setEnteringThreadIds((s) => {
              const updated = { ...s };
              delete updated[id];
              return updated;
            });
            entryTimeoutsRef.current.delete(id);
          }, THREAD_ENTRY_ANIMATION_MS);
          entryTimeoutsRef.current.set(id, tid);
        }
        return next;
      });
    }

    const renamedThreadIds = threads
      .filter((t) => {
        // Only reveal when an already-tracked thread's name transitions from
        // null → named. Threads appearing for the first time (e.g. on a
        // filter switch) already have their final name and should not trigger
        // the title reveal animation — that would layer a blur/translateY
        // onto the row's enter animation and produce a visible jitter.
        if (!previousNamesRef.current.has(t.id)) return false;
        const prev = previousNamesRef.current.get(t.id) ?? null;
        if (prev !== null || t.name === null) return false;
        // Skip the reveal for the platform's "Untitled" fallback — the
        // rebrand effect below schedules its own reveal once the swap to
        // the agent-specific default lands, so animating the bare "Untitled"
        // first would just stack two blur reveals back-to-back.
        if (t.name === PLATFORM_FALLBACK_TITLE) return false;
        return true;
      })
      .map((t) => t.id);

    if (renamedThreadIds.length > 0) {
      setRevealedTitleIds((current) => {
        const next = { ...current };
        for (const id of renamedThreadIds) {
          next[id] = true;
          const existing = titleTimeoutsRef.current.get(id);
          if (existing !== undefined) window.clearTimeout(existing);
          const tid = window.setTimeout(() => {
            setRevealedTitleIds((s) => {
              const updated = { ...s };
              delete updated[id];
              return updated;
            });
            titleTimeoutsRef.current.delete(id);
          }, TITLE_ANIMATION_MS);
          titleTimeoutsRef.current.set(id, tid);
        }
        return next;
      });
    }

    previousThreadIdsRef.current = nextThreadIds;
    previousNamesRef.current = new Map(threads.map((t) => [t.id, t.name]));
  }, [threads, isLoading]);

  const isInitialLoading = isLoading && !hasLoadedOnceRef.current;
  if (error) {
    console.error("Unable to load threads", error);
  }

  const resolveDisplayTitle = useCallback(
    (thread: DrawerThread): string => {
      // Once we've marked a thread as rebranded, swap in the agent-specific
      // default regardless of whether the platform stored null or the
      // "Untitled" fallback at the time of the swap.
      if (rebrandedTitleIds[thread.id]) {
        if (thread.name === null || thread.name === PLATFORM_FALLBACK_TITLE) {
          return AGENT_DEFAULT_TITLES[thread.agentId];
        }
      }
      return thread.name ?? UNTITLED_THREAD_LABEL;
    },
    [rebrandedTitleIds],
  );

  const filteredDisplayThreads: DrawerThread[] = searchQuery
    ? displayThreads.filter((t) =>
        resolveDisplayTitle(t)
          .toLowerCase()
          .includes(searchQuery.toLowerCase()),
      )
    : displayThreads;

  if (!isOpen) {
    return (
      <aside
        aria-label="Threads drawer"
        className={cx(styles.drawer, styles.drawerClosed)}
      >
        <div className={styles.collapsedRail}>
          <button
            aria-label="Open threads drawer"
            className={styles.iconButton}
            type="button"
            onClick={() => setIsOpen(true)}
          >
            <ChevronRight size={18} />
          </button>
          <button
            aria-label="Create thread"
            className={styles.iconButton}
            type="button"
            onClick={handleNewThread}
          >
            <Plus size={18} />
          </button>
          <Rows3
            aria-hidden
            size={18}
            style={{ color: "var(--muted-foreground)" }}
          />
        </div>
      </aside>
    );
  }

  const closeDeleteDialog = () => {
    setPendingDelete(null);
    const trigger = deleteTriggerRef.current;
    deleteTriggerRef.current = null;
    trigger?.focus?.();
  };

  return (
    <>
      <aside
        aria-label="Threads drawer"
        className={cx(styles.drawer, styles.drawerOpen)}
      >
        <div className={styles.drawerSurface}>
          <div className={styles.drawerHeader}>
            <div className={styles.drawerHeaderMain}>
              <h2 className={styles.drawerTitle}>
                {showArchived ? "Archived" : "Threads"}
              </h2>
            </div>
            <div className={styles.headerActions}>
              {!showArchived && (
                <button
                  aria-label="Create thread"
                  className={styles.newThreadButton}
                  type="button"
                  onClick={handleNewThread}
                >
                  <Plus size={14} />
                  <span>New thread</span>
                </button>
              )}
              <button
                aria-label="Collapse threads drawer"
                className={styles.iconButton}
                type="button"
                onClick={() => setIsOpen(false)}
              >
                <ChevronLeft size={18} />
              </button>
            </div>
          </div>

          <div className={styles.searchBar}>
            <Search size={13} className={styles.searchIcon} aria-hidden />
            <input
              type="search"
              placeholder="Search threads"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={styles.searchInput}
              aria-label="Search threads"
            />
          </div>

          <div className={styles.drawerContent}>
            {error ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyCard}>
                  <p className={styles.emptyTitle}>
                    Couldn&rsquo;t load threads
                  </p>
                  <p className={styles.emptyMessage}>
                    The thread list failed to load. Try reloading the page.
                  </p>
                  <button
                    className={styles.loadMoreButton}
                    type="button"
                    onClick={() => window.location.reload()}
                  >
                    Reload
                  </button>
                </div>
              </div>
            ) : isInitialLoading ? (
              <div
                aria-busy="true"
                aria-label="Loading threads"
                className={styles.loadingList}
                role="status"
              >
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className={styles.loadingRow}>
                    <span className={styles.loadingAccent} />
                    <span className={styles.loadingBody}>
                      <span className={styles.loadingTitleBar} />
                      <span className={styles.loadingMetaBar} />
                    </span>
                  </div>
                ))}
              </div>
            ) : filteredDisplayThreads.length === 0 ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyCard}>
                  <p className={styles.emptyTitle}>
                    {searchQuery
                      ? "No matches"
                      : showArchived
                        ? "No archived threads"
                        : "No threads yet"}
                  </p>
                  <p className={styles.emptyMessage}>
                    {searchQuery
                      ? `Nothing matches "${searchQuery}". Try a different query.`
                      : showArchived
                        ? "Threads you archive show up here."
                        : "Create a thread to start a fresh conversation."}
                  </p>
                </div>
              </div>
            ) : (
              <div className={styles.threadList}>
                {filteredDisplayThreads.map((thread) => {
                  const hasTitle = thread.name !== null;
                  const title = resolveDisplayTitle(thread);
                  const isRenaming = renamingId === thread.id;

                  return (
                    <div key={thread.id} className={styles.threadRow}>
                      <button
                        aria-current={
                          threadId === thread.id ? "page" : undefined
                        }
                        className={cx(
                          styles.threadItem,
                          threadId === thread.id && styles.threadItemSelected,
                          enteringThreadIds[thread.id] &&
                            styles.threadItemAnimatingIn,
                          thread.archived && styles.threadItemArchived,
                        )}
                        type="button"
                        onClick={() =>
                          onThreadChange(thread.id, thread.agentId)
                        }
                      >
                        <span aria-hidden className={styles.threadAccent} />
                        <span className={styles.threadBody}>
                          {isRenaming ? (
                            <input
                              autoFocus
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              onBlur={() => {
                                const trimmed = renameValue.trim();
                                if (trimmed && trimmed !== title) {
                                  renameThread(
                                    thread.id,
                                    thread.agentId,
                                    trimmed,
                                  ).catch((err: unknown) =>
                                    console.error("Rename failed", err),
                                  );
                                }
                                setRenamingId(null);
                                setRenameValue("");
                              }}
                              onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === "Enter") {
                                  (e.currentTarget as HTMLInputElement).blur();
                                } else if (e.key === "Escape") {
                                  setRenamingId(null);
                                  setRenameValue("");
                                }
                              }}
                              className={styles.renameInput}
                              aria-label="Rename thread"
                            />
                          ) : (
                            <span
                              className={cx(
                                styles.threadTitle,
                                !hasTitle && styles.threadTitlePlaceholder,
                                revealedTitleIds[thread.id] &&
                                  styles.threadTitleAnimated,
                              )}
                            >
                              {title}
                              {thread.archived && (
                                <span className={styles.archivedBadge}>
                                  Archived
                                </span>
                              )}
                            </span>
                          )}
                          <span className={styles.threadMeta}>
                            {AGENT_LABELS[thread.agentId]}
                            {" · "}
                            {formatThreadTimestamp(
                              thread.lastRunAt ?? thread.updatedAt,
                            )}
                          </span>
                        </span>
                      </button>
                      <div className={styles.threadActions}>
                        <button
                          aria-label={`Rename ${title}`}
                          className={cx(
                            styles.iconButton,
                            styles.threadActionButton,
                            styles.tooltip,
                          )}
                          data-tooltip="Rename thread"
                          type="button"
                          onClick={() => {
                            setRenamingId(thread.id);
                            setRenameValue(thread.name ?? "");
                          }}
                        >
                          <Pencil size={14} />
                        </button>
                        {thread.archived ? (
                          <button
                            aria-label={`Restore ${title}`}
                            className={cx(
                              styles.iconButton,
                              styles.threadActionButton,
                              styles.tooltip,
                            )}
                            data-tooltip="Restore thread"
                            type="button"
                            onClick={() => {
                              restoreThread(thread.id, thread.agentId).catch(
                                (err: unknown) => {
                                  console.error(
                                    "Unable to restore thread",
                                    err,
                                  );
                                },
                              );
                            }}
                          >
                            <ArchiveRestore size={14} />
                          </button>
                        ) : (
                          <button
                            aria-label={`Archive ${title}`}
                            className={cx(
                              styles.iconButton,
                              styles.threadActionButton,
                              styles.tooltip,
                            )}
                            data-tooltip="Archive thread"
                            type="button"
                            onClick={() => {
                              if (threadId === thread.id)
                                onThreadChange(undefined);
                              archiveThread(thread.id, thread.agentId).catch(
                                (err: unknown) => {
                                  console.error(
                                    "Unable to archive thread",
                                    err,
                                  );
                                },
                              );
                            }}
                          >
                            <Archive size={14} />
                          </button>
                        )}
                        <button
                          aria-label={`Delete ${title}`}
                          className={cx(
                            styles.iconButton,
                            styles.threadActionButton,
                            styles.deleteButton,
                            styles.tooltip,
                          )}
                          data-tooltip="Delete thread"
                          type="button"
                          onClick={(e) => {
                            deleteTriggerRef.current = e.currentTarget;
                            setPendingDelete({
                              id: thread.id,
                              agentId: thread.agentId,
                              title,
                            });
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
                {hasMoreThreads && (
                  <button
                    className={styles.loadMoreButton}
                    disabled={isFetchingMoreThreads}
                    type="button"
                    onClick={fetchMoreThreads}
                  >
                    {isFetchingMoreThreads ? "Loading\u2026" : "Load more"}
                  </button>
                )}
              </div>
            )}
          </div>

          <div className={styles.drawerFooter}>
            <button
              className={styles.footerLink}
              type="button"
              onClick={() => {
                setShowArchived((v) => !v);
                setSearchQuery("");
              }}
            >
              {showArchived ? (
                <>
                  <ChevronLeft size={13} />
                  <span>Back to active</span>
                </>
              ) : (
                <>
                  <Archive size={13} />
                  <span>Show archived</span>
                </>
              )}
            </button>
          </div>
        </div>
      </aside>
      {pendingDelete && (
        <ConfirmDialog
          confirmLabel="Delete"
          description={`Delete "${pendingDelete.title}"? This cannot be undone.`}
          destructive
          title="Delete thread"
          onCancel={closeDeleteDialog}
          onConfirm={() => {
            const { id, agentId: agentForThread } = pendingDelete;
            closeDeleteDialog();
            if (threadId === id) onThreadChange(undefined);
            deleteThread(id, agentForThread).catch((err: unknown) => {
              console.error("Unable to delete thread", err);
            });
          }}
        />
      )}
    </>
  );
}

interface ConfirmDialogProps {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className={styles.dialogOverlay}
      role="presentation"
      onClick={onCancel}
    >
      <div
        aria-describedby={descId}
        aria-labelledby={titleId}
        aria-modal="true"
        className={styles.dialog}
        role="dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className={styles.dialogTitle} id={titleId}>
          {title}
        </h3>
        <p className={styles.dialogDescription} id={descId}>
          {description}
        </p>
        <div className={styles.dialogActions}>
          <button
            autoFocus
            className={cx(styles.dialogButton, styles.dialogButtonSecondary)}
            type="button"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            className={cx(
              styles.dialogButton,
              destructive
                ? styles.dialogButtonDestructive
                : styles.dialogButtonPrimary,
            )}
            type="button"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
