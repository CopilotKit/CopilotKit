"use client";

import {
  Archive,
  ArchiveRestore,
  ChevronLeft,
  ChevronRight,
  Plus,
  Rows3,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useThreads } from "@copilotkit/react-core/v2";
import styles from "./threads-drawer.module.css";

export interface ThreadsDrawerProps {
  agentId: string;
  threadId: string | undefined;
  onThreadChange: (threadId: string | undefined) => void;
}

interface DrawerThread {
  id: string;
  name: string | null;
  updatedAt: string;
  archived: boolean;
  lastRunAt?: string;
}

const THREAD_ENTRY_ANIMATION_MS = 420;
const TITLE_ANIMATION_MS = 360;
const UNTITLED_THREAD_LABEL = "New thread";
const RUNTIME_BASE_PATH = "/api/copilotkit";

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
  agentId,
  threadId,
  onThreadChange,
}: ThreadsDrawerProps) {
  const [showArchived, setShowArchived] = useState(false);
  const [isOpen, setIsOpen] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const deleteTriggerRef = useRef<HTMLElement | null>(null);

  const {
    threads,
    archiveThread,
    deleteThread,
    error,
    isLoading,
    hasMoreThreads,
    isFetchingMoreThreads,
    fetchMoreThreads,
  } = useThreads({
    agentId,
    includeArchived: showArchived,
    limit: 20,
  });

  const restoreThread = useCallback(
    async (id: string) => {
      const response = await fetch(
        `${RUNTIME_BASE_PATH}/threads/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId, archived: false }),
        },
      );
      if (!response.ok) {
        throw new Error(
          `Restore failed: ${response.status} ${response.statusText}`,
        );
      }
    },
    [agentId],
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

  useEffect(() => {
    return () => {
      for (const timeoutId of entryTimeoutsRef.current.values()) {
        window.clearTimeout(timeoutId);
      }
      for (const timeoutId of titleTimeoutsRef.current.values()) {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);

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
        return prev === null && t.name !== null;
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
            onClick={() => onThreadChange(undefined)}
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
              <h2 className={styles.drawerTitle}>Threads</h2>
            </div>
            <div className={styles.headerActions}>
              <button
                aria-label="Create thread"
                className={styles.newThreadButton}
                type="button"
                onClick={() => onThreadChange(undefined)}
              >
                <Plus size={14} />
                <span>New thread</span>
              </button>
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

          <div className={styles.filterBar}>
            <div
              aria-label="Thread filter"
              className={styles.segmented}
              role="tablist"
            >
              <button
                aria-selected={!showArchived}
                className={cx(
                  styles.segmentedOption,
                  !showArchived && styles.segmentedOptionActive,
                )}
                role="tab"
                type="button"
                onClick={() => setShowArchived(false)}
              >
                Active
              </button>
              <button
                aria-selected={showArchived}
                className={cx(
                  styles.segmentedOption,
                  showArchived && styles.segmentedOptionActive,
                )}
                role="tab"
                type="button"
                onClick={() => setShowArchived(true)}
              >
                All
              </button>
            </div>
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
            ) : displayThreads.length === 0 ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyCard}>
                  <p className={styles.emptyTitle}>No threads yet</p>
                  <p className={styles.emptyMessage}>
                    Create a thread to start a fresh conversation.
                  </p>
                </div>
              </div>
            ) : (
              <div className={styles.threadList}>
                {displayThreads.map((thread) => {
                  const hasTitle = thread.name !== null;
                  const title = thread.name ?? UNTITLED_THREAD_LABEL;

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
                        onClick={() => onThreadChange(thread.id)}
                      >
                        <span aria-hidden className={styles.threadAccent} />
                        <span className={styles.threadBody}>
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
                          <span className={styles.threadMeta}>
                            {formatThreadTimestamp(
                              thread.lastRunAt ?? thread.updatedAt,
                            )}
                          </span>
                        </span>
                      </button>
                      <div className={styles.threadActions}>
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
                              restoreThread(thread.id).catch((err: unknown) => {
                                console.error("Unable to restore thread", err);
                              });
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
                              archiveThread(thread.id).catch((err: unknown) => {
                                console.error("Unable to archive thread", err);
                              });
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
                            setPendingDelete({ id: thread.id, title });
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
            const { id } = pendingDelete;
            closeDeleteDialog();
            if (threadId === id) onThreadChange(undefined);
            deleteThread(id).catch((err: unknown) => {
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
