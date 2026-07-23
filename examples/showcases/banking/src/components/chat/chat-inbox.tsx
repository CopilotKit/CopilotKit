"use client";

import type { CSSProperties } from "react";
import { Archive, ArrowLeft, Inbox, Plus, Trash2 } from "lucide-react";
import { useThreads } from "@copilotkit/react-core/v2";

import { cn } from "@/lib/utils";
import { useChatInbox } from "./chat-inbox-context";

const UNTITLED_LABEL = "New conversation";

/**
 * Inbox-style conversation list that paints over the docked chat panel's chat
 * area. It is rendered as a sibling of the `CopilotSidebar` (not inside the
 * chat view) so it can cover the full panel without being clipped, and is
 * positioned to exactly overlap the docked panel on the right edge.
 *
 * Visibility is driven by two pieces of shared state:
 *  - `isInboxOpen` from {@link useChatInbox} (toggled by the panel header), and
 *  - `panelOpen` passed by the parent (the sidebar's modal-open state),
 * so the inbox only shows while the panel itself is open.
 */
export function ChatInbox({
  panelOpen,
  showArchived,
  onShowArchivedChange,
  width,
}: {
  panelOpen: boolean;
  showArchived: boolean;
  onShowArchivedChange: (next: boolean) => void;
  width: number;
}) {
  const {
    isInboxOpen,
    closeInbox,
    selectedThreadId,
    selectConversation,
    startNewConversation,
  } = useChatInbox();

  const {
    threads,
    isLoading,
    archiveThread,
    deleteThread,
    hasMoreThreads,
    isFetchingMoreThreads,
    fetchMoreThreads,
  } = useThreads({
    agentId: "default",
    includeArchived: showArchived,
    limit: 20,
  });

  const visible = isInboxOpen && panelOpen;

  const handleArchive = (id: string) => {
    if (id === selectedThreadId) startNewConversation();
    Promise.resolve(archiveThread(id)).catch((err: unknown) => {
      console.error("Unable to archive conversation", err);
    });
  };

  const handleDelete = (id: string, title: string) => {
    if (!window.confirm(`Delete "${title}"? This cannot be undone.`)) return;
    if (id === selectedThreadId) startNewConversation();
    Promise.resolve(deleteThread(id)).catch((err: unknown) => {
      console.error("Unable to delete conversation", err);
    });
  };

  return (
    <aside
      data-testid="chat-inbox"
      aria-label="Conversations"
      aria-hidden={!visible}
      style={{ "--inbox-width": `${width}px` } as CSSProperties}
      className={cn(
        "fixed top-0 right-0 z-[1300] flex h-[100dvh] max-h-screen w-full flex-col",
        "w-full md:w-[var(--inbox-width)]",
        "border-l border-hairline bg-surface text-ink shadow-lift",
        "transition-[opacity,transform] duration-200 ease-out",
        visible
          ? "translate-x-0 opacity-100"
          : "pointer-events-none translate-x-2 opacity-0",
      )}
    >
      {/* Inbox header — mirrors the panel header height so it sits flush. */}
      <header className="flex h-[68px] flex-shrink-0 items-center justify-between gap-2 border-b border-hairline px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-indigo dark:text-brand-violet">
            <Inbox className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold leading-tight tracking-tight text-ink">
              Conversations
            </p>
            <p className="truncate text-xs leading-tight text-ink-muted">
              {threads.length}{" "}
              {threads.length === 1 ? "conversation" : "conversations"}
            </p>
          </div>
        </div>
        <button
          type="button"
          aria-label="Back to chat"
          title="Back to chat"
          data-testid="chat-inbox-back"
          onClick={closeInbox}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-brand-soft hover:text-brand-indigo focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface dark:hover:text-brand-violet"
        >
          <ArrowLeft className="h-[18px] w-[18px]" />
        </button>
      </header>

      {/* New conversation + archived toggle. */}
      <div className="flex items-center gap-2 px-4 pb-2 pt-3">
        <button
          type="button"
          data-testid="inbox-new-conversation"
          onClick={startNewConversation}
          className="brand-gradient inline-flex flex-1 items-center justify-center gap-2 rounded-full px-3 py-2.5 text-sm font-semibold text-surface shadow-[0_8px_20px_hsl(252_83%_60%/0.28)] transition-transform hover:-translate-y-0.5 hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          <Plus className="h-4 w-4" />
          New conversation
        </button>
      </div>
      <label className="flex cursor-pointer select-none items-center gap-2 px-4 pb-2 text-xs font-medium text-ink-muted">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(e) => onShowArchivedChange(e.target.checked)}
          className="h-3.5 w-3.5 accent-[hsl(var(--brand))]"
        />
        Show archived
      </label>

      {/* List. */}
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2.5 pb-4 pt-1">
        {isLoading && threads.length === 0 ? (
          <InboxEmpty
            title="Loading conversations…"
            message="Fetching your recent conversations."
          />
        ) : threads.length === 0 ? (
          <InboxEmpty
            title="No conversations yet"
            message="Start a new conversation to chat with the copilot."
          />
        ) : (
          <>
            {threads.map((thread) => {
              const title = thread.name ?? UNTITLED_LABEL;
              const selected = thread.id === selectedThreadId;
              return (
                <div
                  key={thread.id}
                  data-testid="inbox-thread-row"
                  className="group relative"
                >
                  <button
                    type="button"
                    aria-current={selected ? "true" : undefined}
                    onClick={() => selectConversation(thread.id)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-2xl py-2.5 pl-3 pr-[5.5rem] text-left transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
                      selected
                        ? "bg-brand-soft shadow-[inset_0_0_0_1px_hsl(var(--brand)/0.25)]"
                        : "hover:bg-brand-soft/60",
                      thread.archived && "opacity-60",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "h-8 w-1 flex-none rounded-full",
                        selected
                          ? "bg-gradient-to-b from-brand-violet to-brand-indigo"
                          : "bg-hairline",
                      )}
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span
                        className={cn(
                          "flex items-center gap-1.5 truncate text-sm font-semibold tracking-tight",
                          thread.name
                            ? selected
                              ? "text-brand-indigo dark:text-brand-violet"
                              : "text-ink"
                            : "font-medium text-ink-muted",
                        )}
                      >
                        <span className="truncate">{title}</span>
                        {thread.archived && (
                          <span className="flex-none rounded-full bg-surface-muted px-1.5 py-0.5 text-[0.6rem] font-semibold text-ink-muted">
                            Archived
                          </span>
                        )}
                      </span>
                      <span className="truncate text-xs text-ink-muted">
                        {formatRelativeTime(
                          thread.lastRunAt ?? thread.updatedAt,
                        )}
                      </span>
                    </span>
                  </button>
                  <div className="pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
                    {!thread.archived && (
                      <button
                        type="button"
                        aria-label={`Archive ${title}`}
                        title="Archive"
                        onClick={() => handleArchive(thread.id)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-brand-soft hover:text-brand-indigo focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:hover:text-brand-violet"
                      >
                        <Archive className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label={`Delete ${title}`}
                      title="Delete"
                      onClick={() => handleDelete(thread.id, title)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full text-negative transition-colors hover:bg-negative-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
            {hasMoreThreads && (
              <button
                type="button"
                disabled={isFetchingMoreThreads}
                onClick={() => fetchMoreThreads?.()}
                className="mt-1 inline-flex w-full items-center justify-center rounded-xl border border-hairline bg-surface-muted px-3 py-2 text-sm font-semibold text-ink-muted transition-colors hover:border-brand/30 hover:bg-brand-soft hover:text-brand-indigo disabled:opacity-60 dark:hover:text-brand-violet"
              >
                {isFetchingMoreThreads ? "Loading…" : "Load more"}
              </button>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

function InboxEmpty({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="flex max-w-[15rem] flex-col items-start gap-2 rounded-2xl border border-hairline bg-surface-muted/90 p-4">
        <p className="text-sm font-bold text-ink">{title}</p>
        <p className="text-xs leading-relaxed text-ink-muted">{message}</p>
      </div>
    </div>
  );
}

/**
 * Compact relative timestamp ("just now", "3h ago", "2d ago", or a date).
 */
function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "Updated recently";
  const diffMs = Date.now() - then;
  const sec = Math.round(diffMs / 1000);
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(then);
}

export default ChatInbox;
