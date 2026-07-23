"use client";

import {
  Archive,
  ArchiveRestore,
  BookOpen,
  Boxes,
  ChevronLeft,
  ChevronRight,
  Code2,
  ExternalLink,
  Filter,
  Info,
  Moon,
  Plus,
  Search,
  Sparkles,
  SquarePen,
  Sun,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useThreads } from "@copilotkit/react-core/v2";
import { useTheme } from "@/hooks/use-theme";
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

const DOC_LINKS: Array<{
  label: string;
  href: string;
  icon: typeof BookOpen;
  external?: boolean;
}> = [
  {
    label: "About this Kit",
    href: "/about",
    icon: Info,
    external: false,
  },
  {
    label: "CopilotKit Components",
    href: "/components",
    icon: Boxes,
    external: false,
  },
  {
    label: "Documentation",
    href: "https://docs.copilotkit.ai/",
    icon: BookOpen,
    external: true,
  },
  {
    label: "Intelligence Platform",
    href: "https://docs.copilotkit.ai/learn/intelligence-platform",
    icon: Sparkles,
    external: true,
  },
  {
    label: "Coding Agents",
    href: "https://docs.copilotkit.ai/coding-agents",
    icon: Code2,
    external: true,
  },
];

function formatRelativeTime(isoTimestamp: string): string {
  const timestamp = new Date(isoTimestamp);
  if (Number.isNaN(timestamp.getTime())) return "Recently";

  const diffMs = Date.now() - timestamp.getTime();
  const diffSec = Math.round(diffMs / 1000);
  const diffMin = Math.round(diffSec / 60);
  const diffHr = Math.round(diffMin / 60);
  const diffDay = Math.round(diffHr / 24);

  if (diffSec < 60) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay === 1) return "Yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;
  if (diffDay < 30) return `${Math.round(diffDay / 7)}w ago`;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(timestamp);
}

function formatAbsoluteTime(isoTimestamp: string): string {
  const timestamp = new Date(isoTimestamp);
  if (Number.isNaN(timestamp.getTime())) return "";
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

  const [searchQuery, setSearchQuery] = useState("");

  const { setTheme } = useTheme();
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    const update = () => {
      setResolvedTheme(
        document.documentElement.classList.contains("dark") ? "dark" : "light",
      );
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);
  const toggleTheme = () => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  };

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

  // Client-side search over already-loaded threads. This only filters what
  // has been paginated in (20 threads per page); older threads are invisible
  // until the user clicks "Load more". A backend search endpoint would be
  // needed for full-corpus search — not currently exposed by the CopilotKit
  // runtime.
  const trimmedQuery = searchQuery.trim().toLowerCase();
  const filteredThreads = trimmedQuery
    ? displayThreads.filter((t) =>
        (t.name ?? "").toLowerCase().includes(trimmedQuery),
      )
    : displayThreads;
  const isSearching = trimmedQuery.length > 0;

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
            aria-label="New chat"
            className={styles.iconButton}
            type="button"
            onClick={() => onThreadChange(undefined)}
          >
            <SquarePen size={18} />
          </button>
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
        <div aria-hidden className={styles.ambientGlow} />

        <div className={styles.drawerSurface}>
          <div className={styles.brandRow}>
            <img
              alt="CopilotKit"
              className={styles.brandLogo}
              src="/copilotkit-logo.svg"
            />
            <button
              aria-label="Collapse threads drawer"
              className={styles.iconButton}
              type="button"
              onClick={() => setIsOpen(false)}
            >
              <ChevronLeft size={18} />
            </button>
          </div>

          <nav aria-label="Primary" className={styles.navList}>
            <button
              className={styles.navItem}
              type="button"
              onClick={() => onThreadChange(undefined)}
            >
              <SquarePen aria-hidden size={16} />
              <span>New chat</span>
            </button>
            <div className={cx(styles.navItem, styles.searchRow)}>
              <Search aria-hidden size={16} />
              <input
                aria-label="Search threads"
                className={styles.searchInput}
                placeholder="Search threads"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </nav>

          <nav aria-label="Resources" className={styles.navList}>
            {DOC_LINKS.map(({ label, href, icon: Icon, external = true }) => (
              <a
                key={href}
                className={styles.navItem}
                href={href}
                {...(external
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
              >
                <Icon aria-hidden size={16} />
                <span>{label}</span>
                {external ? (
                  <ExternalLink
                    aria-hidden
                    className={styles.navItemExternal}
                    size={12}
                  />
                ) : null}
              </a>
            ))}
          </nav>

          <div className={styles.sectionHeader}>
            <span className={styles.sectionLabel}>Threads</span>
            <div className={styles.sectionActions}>
              <button
                aria-label={
                  showArchived ? "Hide archived threads" : "Show archived threads"
                }
                aria-pressed={showArchived}
                className={cx(
                  styles.iconButton,
                  styles.sectionActionButton,
                  showArchived && styles.iconButtonActive,
                )}
                type="button"
                onClick={() => setShowArchived((v) => !v)}
              >
                <Filter size={14} />
              </button>
              <button
                aria-label="New chat"
                className={cx(styles.iconButton, styles.sectionActionButton)}
                type="button"
                onClick={() => onThreadChange(undefined)}
              >
                <Plus size={14} />
              </button>
            </div>
          </div>

          <div className={styles.drawerContent}>
            {error ? (
              <div className={styles.emptyState}>
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
            ) : isInitialLoading ? (
              <div
                aria-busy="true"
                aria-label="Loading threads"
                className={styles.loadingList}
                role="status"
              >
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className={styles.loadingRow}>
                    <span className={styles.loadingTitleBar} />
                    <span className={styles.loadingMetaBar} />
                  </div>
                ))}
              </div>
            ) : filteredThreads.length === 0 ? (
              <div className={styles.emptyState}>
                <p className={styles.emptyMessage}>
                  {isSearching
                    ? `No threads match "${searchQuery.trim()}".`
                    : showArchived
                      ? "No archived threads."
                      : "No threads yet. Start a new chat to begin."}
                </p>
                {isSearching && hasMoreThreads && (
                  <button
                    className={styles.loadMoreButton}
                    disabled={isFetchingMoreThreads}
                    type="button"
                    onClick={fetchMoreThreads}
                  >
                    {isFetchingMoreThreads
                      ? "Loading older threads…"
                      : "Search older threads"}
                  </button>
                )}
              </div>
            ) : (
              <div className={styles.threadList}>
                {filteredThreads.map((thread) => {
                  const hasTitle = thread.name !== null;
                  const title = thread.name ?? UNTITLED_THREAD_LABEL;
                  const stamp = thread.lastRunAt ?? thread.updatedAt;

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
                          <span
                            className={styles.threadMeta}
                            title={formatAbsoluteTime(stamp)}
                          >
                            {formatRelativeTime(stamp)}
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
                            )}
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
                    {isFetchingMoreThreads ? "Loading…" : "Load more"}
                  </button>
                )}
              </div>
            )}
          </div>

          <div className={styles.drawerFooter}>
            <a
              className={cx(styles.navItem, styles.navItemFlex)}
              href="https://www.copilotkit.ai/"
              rel="noopener noreferrer"
              target="_blank"
            >
              <img
                alt=""
                aria-hidden
                className={styles.navItemMark}
                src="/copilotkit-logo-mark.svg"
              />
              <span>copilotkit.ai</span>
              <ExternalLink
                aria-hidden
                className={styles.navItemExternal}
                size={12}
              />
            </a>
            <button
              aria-label={
                resolvedTheme === "dark"
                  ? "Switch to light mode"
                  : "Switch to dark mode"
              }
              className={styles.iconButton}
              type="button"
              onClick={toggleTheme}
            >
              {resolvedTheme === "dark" ? (
                <Sun size={16} />
              ) : (
                <Moon size={16} />
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
