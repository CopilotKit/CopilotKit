"use client";

import {
  Archive,
  ChevronLeft,
  ChevronRight,
  Plus,
  Rows3,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
}

const THREAD_ENTRY_ANIMATION_MS = 420;
const TITLE_ANIMATION_MS = 360;
const UNTITLED_THREAD_LABEL = "New thread";

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
  }, [threads]);

  if (isLoading) return null;
  if (error) {
    console.error("Unable to load threads", error);
    return null;
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

  return (
    <aside
      aria-label="Threads drawer"
      className={cx(styles.drawer, styles.drawerOpen)}
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
          <label className={styles.toggleLabel}>
            <input
              checked={showArchived}
              className={styles.toggleCheckbox}
              type="checkbox"
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            <span>Show archived</span>
          </label>
        </div>

        <div className={styles.drawerContent}>
          {threads.length === 0 ? (
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
              {threads.map((thread) => {
                const hasTitle = thread.name !== null;
                const title = thread.name ?? UNTITLED_THREAD_LABEL;
                const confirmMsg = `Delete "${title}"? This cannot be undone.`;

                return (
                  <div key={thread.id} className={styles.threadRow}>
                    <button
                      aria-current={threadId === thread.id ? "page" : undefined}
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
                          {formatThreadTimestamp(thread.updatedAt)}
                        </span>
                      </span>
                    </button>
                    <div className={styles.threadActions}>
                      {!thread.archived && (
                        <button
                          aria-label={`Archive ${title}`}
                          className={cx(
                            styles.iconButton,
                            styles.threadActionButton,
                          )}
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
                        )}
                        type="button"
                        onClick={() => {
                          if (!window.confirm(confirmMsg)) return;
                          if (threadId === thread.id) onThreadChange(undefined);
                          deleteThread(thread.id).catch((err: unknown) => {
                            console.error("Unable to delete thread", err);
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
      </div>
    </aside>
  );
}
