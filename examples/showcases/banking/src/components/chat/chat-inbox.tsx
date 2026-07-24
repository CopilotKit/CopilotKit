"use client";

import type { CSSProperties } from "react";
import { Archive, PanelRightClose, Plus, Trash2 } from "lucide-react";
import { useThreads } from "@copilotkit/react-core/v2";

import { cn } from "@/lib/utils";
import { useChatInbox } from "./chat-inbox-context";

const UNTITLED_LABEL = "New chat";
const BUCKET_ORDER = [
  "Today",
  "Yesterday",
  "Previous 7 Days",
  "Older",
] as const;
type Bucket = (typeof BUCKET_ORDER)[number];

/**
 * Persistent, ChatGPT-style thread rail docked to the LEFT of the conversation
 * (so the whole chat experience stays on the right edge). New-chat button on
 * top, the conversation list grouped by recency, hover archive/delete, and a
 * collapse control. Rendered as a sibling of the `CopilotSidebar` and offset by
 * the conversation's width so the two sit flush.
 *
 * Visible when the panel is open AND the rail is expanded (`isInboxOpen`); the
 * panel header's toggle collapses/expands it.
 */
export function ChatInbox({
  panelOpen,
  showArchived,
  onShowArchivedChange,
  width,
  offset,
}: {
  panelOpen: boolean;
  showArchived: boolean;
  onShowArchivedChange: (next: boolean) => void;
  width: number;
  offset: number;
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

  // Group newest-first threads into recency buckets (ChatGPT-style headings).
  const grouped = new Map<Bucket, typeof threads>();
  for (const thread of threads) {
    const b = bucketFor(thread.lastRunAt ?? thread.updatedAt);
    if (!grouped.has(b)) grouped.set(b, []);
    grouped.get(b)!.push(thread);
  }

  return (
    <aside
      data-testid="chat-inbox"
      aria-label="Conversations"
      aria-hidden={!visible}
      style={
        {
          "--rail-width": `${width}px`,
          right: `${offset}px`,
        } as CSSProperties
      }
      className={cn(
        "fixed top-0 z-[1200] hidden h-[100dvh] max-h-screen w-[var(--rail-width)] flex-col md:flex",
        "border-r border-hairline bg-surface-muted/70 text-ink backdrop-blur",
        "transition-[opacity,transform] duration-200 ease-out",
        visible
          ? "translate-x-0 opacity-100"
          : "pointer-events-none translate-x-3 opacity-0",
      )}
    >
      {/* Top: New chat + collapse */}
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <button
          type="button"
          data-testid="inbox-new-conversation"
          onClick={startNewConversation}
          className="inline-flex flex-1 items-center gap-2 rounded-xl border border-hairline bg-surface px-3 py-2.5 text-sm font-semibold text-ink shadow-soft transition-colors hover:border-brand/40 hover:bg-brand-soft hover:text-brand-indigo focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:hover:text-brand-violet"
        >
          <Plus className="h-4 w-4" />
          New chat
        </button>
        <button
          type="button"
          aria-label="Collapse conversations"
          title="Collapse conversations"
          data-testid="chat-inbox-back"
          onClick={closeInbox}
          className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-brand-soft hover:text-brand-indigo focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:hover:text-brand-violet"
        >
          <PanelRightClose className="h-[18px] w-[18px]" />
        </button>
      </div>

      {/* List */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-3">
        {isLoading && threads.length === 0 ? (
          <RailEmpty title="Loading…" message="Fetching your conversations." />
        ) : threads.length === 0 ? (
          <RailEmpty
            title="No conversations yet"
            message="Start a new chat with the copilot."
          />
        ) : (
          <>
            {BUCKET_ORDER.filter((b) => grouped.has(b)).map((bucket) => (
              <div key={bucket} className="mb-1">
                <p className="px-2 pb-1 pt-2 text-[0.68rem] font-semibold uppercase tracking-wide text-ink-muted">
                  {bucket}
                </p>
                <div className="flex flex-col gap-0.5">
                  {grouped.get(bucket)!.map((thread) => {
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
                            "flex w-full items-center rounded-lg py-2 pl-2.5 pr-[4.25rem] text-left text-sm transition-colors",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                            selected
                              ? "bg-brand-soft font-semibold text-brand-indigo dark:text-brand-violet"
                              : "text-ink hover:bg-surface",
                            thread.archived && "opacity-60",
                          )}
                        >
                          <span
                            className={cn(
                              "truncate",
                              !thread.name && "text-ink-muted",
                            )}
                          >
                            {title}
                          </span>
                          {thread.archived && (
                            <span className="ml-1.5 flex-none rounded-full bg-surface-muted px-1.5 py-0.5 text-[0.55rem] font-semibold uppercase text-ink-muted">
                              Arch
                            </span>
                          )}
                        </button>
                        <div className="pointer-events-none absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
                          {!thread.archived && (
                            <button
                              type="button"
                              aria-label={`Archive ${title}`}
                              title="Archive"
                              onClick={() => handleArchive(thread.id)}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-brand-soft hover:text-brand-indigo dark:hover:text-brand-violet"
                            >
                              <Archive className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            aria-label={`Delete ${title}`}
                            title="Delete"
                            onClick={() => handleDelete(thread.id, title)}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-negative transition-colors hover:bg-negative-soft"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {hasMoreThreads && (
              <button
                type="button"
                disabled={isFetchingMoreThreads}
                onClick={() => fetchMoreThreads?.()}
                className="mx-2 mt-1 inline-flex items-center justify-center rounded-lg px-3 py-2 text-xs font-semibold text-ink-muted transition-colors hover:bg-surface hover:text-brand-indigo disabled:opacity-60 dark:hover:text-brand-violet"
              >
                {isFetchingMoreThreads ? "Loading…" : "Show more"}
              </button>
            )}
          </>
        )}
      </div>

      {/* Footer: archived toggle */}
      <label className="flex cursor-pointer select-none items-center gap-2 border-t border-hairline px-3 py-2.5 text-xs font-medium text-ink-muted">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(e) => onShowArchivedChange(e.target.checked)}
          className="h-3.5 w-3.5 accent-[hsl(var(--brand))]"
        />
        Show archived
      </label>
    </aside>
  );
}

function RailEmpty({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-5">
      <div className="flex max-w-[15rem] flex-col items-start gap-1.5 rounded-xl border border-hairline bg-surface/80 p-3.5">
        <p className="text-sm font-bold text-ink">{title}</p>
        <p className="text-xs leading-relaxed text-ink-muted">{message}</p>
      </div>
    </div>
  );
}

/** Recency bucket for a ChatGPT-style grouped list. */
function bucketFor(iso: string): Bucket {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "Older";
  const now = new Date();
  const startToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const day = 86_400_000;
  if (then >= startToday) return "Today";
  if (then >= startToday - day) return "Yesterday";
  if (then >= startToday - 7 * day) return "Previous 7 Days";
  return "Older";
}

export default ChatInbox;
