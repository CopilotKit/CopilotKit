import {
  Archive,
  ChevronLeft,
  ChevronRight,
  Plus,
  Rows3,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import styles from "./threads-drawer.module.css";

/**
 * Minimal thread shape needed by the demo drawer.
 */
export interface DrawerThread {
  id: string;
  name: string | null;
  updatedAt: string;
  archived: boolean;
}

/**
 * Controlled props for the demo threads drawer.
 */
export interface ThreadsDrawerProps {
  threads: readonly DrawerThread[];
  selectedThreadId?: string;
  isOpen: boolean;
  showArchived: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  emptyMessage?: string;
  newThreadLabel?: string;
  onOpenChange: (nextOpen: boolean) => void;
  onSelectThread: (threadId: string) => void;
  onArchiveThread: (threadId: string) => void;
  onDeleteThread: (threadId: string) => void | Promise<void>;
  onCreateThread: () => void;
  onShowArchivedChange: (showArchived: boolean) => void;
  onLoadMore: () => void;
}

const THREAD_ENTRY_ANIMATION_MS = 420;
const TITLE_ANIMATION_MS = 360;
const UNTITLED_THREAD_LABEL = "New thread";

/**
 * Returns a human-readable timestamp for a thread row.
 */
function formatThreadTimestamp(updatedAt: string): string {
  const timestamp = new Date(updatedAt);

  if (Number.isNaN(timestamp.getTime())) {
    return "Updated recently";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

/**
 * Merges class names while ignoring falsy values.
 */
function joinClassNames(
  ...classNames: Array<string | false | undefined>
): string {
  return classNames.filter(Boolean).join(" ");
}

/**
 * Controlled demo drawer for browsing and selecting threads.
 */
export function ThreadsDrawer({
  threads,
  selectedThreadId,
  isOpen,
  showArchived,
  hasNextPage,
  isFetchingNextPage,
  emptyMessage = "Create a thread to start a fresh conversation.",
  newThreadLabel = "New thread",
  onOpenChange,
  onSelectThread,
  onArchiveThread,
  onDeleteThread,
  onCreateThread,
  onShowArchivedChange,
  onLoadMore,
}: ThreadsDrawerProps) {
  const hasMountedRef = useRef(false);
  const previousThreadIdsRef = useRef<Set<string>>(new Set());
  const previousNamesRef = useRef<Map<string, string | null>>(new Map());
  const entryTimeoutsRef = useRef<Map<string, number>>(new Map());
  const titleTimeoutsRef = useRef<Map<string, number>>(new Map());
  const [enteringThreadIds, setEnteringThreadIds] = useState<
    Record<string, true>
  >({});
  const [revealedTitleIds, setRevealedTitleIds] = useState<
    Record<string, true>
  >({});

  useEffect(() => {
    const entryTimeouts = entryTimeoutsRef.current;
    const titleTimeouts = titleTimeoutsRef.current;

    return () => {
      entryTimeouts.forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });

      titleTimeouts.forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
    };
  }, []);

  useEffect(() => {
    const nextThreadIds = new Set(threads.map((thread) => thread.id));

    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      previousThreadIdsRef.current = nextThreadIds;
      previousNamesRef.current = new Map(
        threads.map((thread) => [thread.id, thread.name]),
      );
      return;
    }

    const addedThreadIds = threads
      .filter((thread) => !previousThreadIdsRef.current.has(thread.id))
      .map((thread) => thread.id);

    if (addedThreadIds.length > 0) {
      setEnteringThreadIds((currentState) => {
        const nextState = { ...currentState };

        for (const threadId of addedThreadIds) {
          nextState[threadId] = true;

          const existingTimeoutId = entryTimeoutsRef.current.get(threadId);
          if (existingTimeoutId !== undefined) {
            window.clearTimeout(existingTimeoutId);
          }

          const timeoutId = window.setTimeout(() => {
            setEnteringThreadIds((state) => {
              const updatedState = { ...state };
              delete updatedState[threadId];
              return updatedState;
            });
            entryTimeoutsRef.current.delete(threadId);
          }, THREAD_ENTRY_ANIMATION_MS);

          entryTimeoutsRef.current.set(threadId, timeoutId);
        }

        return nextState;
      });
    }

    const renamedThreadIds = threads
      .filter((thread) => {
        const previousName = previousNamesRef.current.get(thread.id) ?? null;
        return previousName === null && thread.name !== null;
      })
      .map((thread) => thread.id);

    if (renamedThreadIds.length > 0) {
      setRevealedTitleIds((currentState) => {
        const nextState = { ...currentState };

        for (const threadId of renamedThreadIds) {
          nextState[threadId] = true;

          const existingTimeoutId = titleTimeoutsRef.current.get(threadId);
          if (existingTimeoutId !== undefined) {
            window.clearTimeout(existingTimeoutId);
          }

          const timeoutId = window.setTimeout(() => {
            setRevealedTitleIds((state) => {
              const updatedState = { ...state };
              delete updatedState[threadId];
              return updatedState;
            });
            titleTimeoutsRef.current.delete(threadId);
          }, TITLE_ANIMATION_MS);

          titleTimeoutsRef.current.set(threadId, timeoutId);
        }

        return nextState;
      });
    }

    previousThreadIdsRef.current = nextThreadIds;
    previousNamesRef.current = new Map(
      threads.map((thread) => [thread.id, thread.name]),
    );
  }, [threads]);

  if (!isOpen) {
    return (
      <aside
        aria-label="Threads drawer"
        className={joinClassNames(styles.drawer, styles.drawerClosed)}
      >
        <div className={styles.collapsedRail}>
          <button
            aria-label="Open threads drawer"
            className={styles.iconButton}
            type="button"
            onClick={() => onOpenChange(true)}
          >
            <ChevronRight size={18} />
          </button>
          <button
            aria-label="Create thread"
            className={styles.iconButton}
            type="button"
            onClick={onCreateThread}
          >
            <Plus size={18} />
          </button>
          <Rows3 aria-hidden size={18} />
        </div>
      </aside>
    );
  }

  return (
    <aside
      aria-label="Threads drawer"
      className={joinClassNames(styles.drawer, styles.drawerOpen)}
    >
      <div className={styles.drawerSurface}>
        <div className={styles.drawerHeader}>
          <div className={styles.drawerHeaderMain}>
            <h2 className={styles.drawerTitle}>Threads</h2>
            <p className={styles.drawerSubtitle}>
              {threads.length}{" "}
              {threads.length === 1 ? "conversation" : "conversations"}
            </p>
          </div>
          <div className={styles.headerActions}>
            <button
              aria-label="Create thread"
              className={styles.newThreadButton}
              type="button"
              onClick={onCreateThread}
            >
              <Plus size={16} />
              <span>{newThreadLabel}</span>
            </button>
            <button
              aria-label="Collapse threads drawer"
              className={styles.iconButton}
              type="button"
              onClick={() => onOpenChange(false)}
            >
              <ChevronLeft size={18} />
            </button>
          </div>
        </div>

        <div className={styles.filterBar}>
          <label className={styles.toggleLabel}>
            <input
              checked={showArchived}
              className={styles.toggleCheckbox}
              type="checkbox"
              onChange={(e) => onShowArchivedChange(e.target.checked)}
            />
            <span>Show archived</span>
          </label>
        </div>

        <div className={styles.drawerContent}>
          {threads.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyCard}>
                <p className={styles.emptyTitle}>No threads yet</p>
                <p className={styles.emptyMessage}>{emptyMessage}</p>
              </div>
            </div>
          ) : (
            <div className={styles.threadList}>
              {threads.map((thread) => {
                const hasGeneratedTitle = thread.name !== null;
                const title = thread.name ?? UNTITLED_THREAD_LABEL;
                const confirmDeleteMessage = `Delete "${title}"? This cannot be undone.`;

                return (
                  <div key={thread.id} className={styles.threadRow}>
                    <button
                      aria-current={
                        selectedThreadId === thread.id ? "page" : undefined
                      }
                      className={joinClassNames(
                        styles.threadItem,
                        selectedThreadId === thread.id &&
                          styles.threadItemSelected,
                        enteringThreadIds[thread.id] &&
                          styles.threadItemAnimatingIn,
                        thread.archived && styles.threadItemArchived,
                      )}
                      type="button"
                      onClick={() => onSelectThread(thread.id)}
                    >
                      <span aria-hidden className={styles.threadAccent} />
                      <span className={styles.threadBody}>
                        <span
                          className={joinClassNames(
                            styles.threadTitle,
                            !hasGeneratedTitle && styles.threadTitlePlaceholder,
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
                        <span className={styles.threadMeta}>
                          {formatThreadTimestamp(thread.updatedAt)}
                        </span>
                      </span>
                    </button>
                    <div className={styles.threadActions}>
                      {!thread.archived && (
                        <button
                          aria-label={`Archive ${title}`}
                          className={joinClassNames(
                            styles.iconButton,
                            styles.threadActionButton,
                          )}
                          type="button"
                          onClick={() => onArchiveThread(thread.id)}
                        >
                          <Archive size={16} />
                        </button>
                      )}
                      <button
                        aria-label={`Delete ${title}`}
                        className={joinClassNames(
                          styles.iconButton,
                          styles.threadActionButton,
                          styles.deleteButton,
                        )}
                        type="button"
                        onClick={() => {
                          if (!window.confirm(confirmDeleteMessage)) {
                            return;
                          }

                          onDeleteThread(thread.id);
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                );
              })}
              {hasNextPage && (
                <button
                  className={styles.loadMoreButton}
                  disabled={isFetchingNextPage}
                  type="button"
                  onClick={onLoadMore}
                >
                  {isFetchingNextPage ? "Loading…" : "Load more"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

export default ThreadsDrawer;
