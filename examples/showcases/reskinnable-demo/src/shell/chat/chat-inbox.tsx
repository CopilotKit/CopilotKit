"use client";

import { Archive, PanelLeftClose, SquarePen, Trash2 } from "lucide-react";
import { useThreads } from "@copilotkit/react-core/v2";

import { cn } from "@/lib/utils";
import { useSkin } from "@/shell/skin-provider";
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
 * The thread rail, styled after ChatGPT's sidebar — the leftmost of the two
 * columns inside the chat card, with the conversation immediately to its right
 * across a hairline (see ChatPanel for how the two are composed).
 *
 * ChatGPT's sidebar is deliberately quiet: a flat grey field a step darker than
 * the conversation, no card borders or shadows, a plain "New chat" row rather
 * than a bordered button, sentence-case muted date headings, and selection
 * carried by a soft grey fill instead of a brand color. Row actions stay hidden
 * until hover. This surface therefore runs neutral greys, not Aurora violet.
 *
 * Visibility is NOT this component's concern: it fills a collapsible `Panel`
 * whose collapsed state the panel header's toggle drives, so the rail simply
 * renders and lets the parent size it to zero.
 */
export function ChatInbox({
  showArchived,
  onShowArchivedChange,
}: {
  showArchived: boolean;
  onShowArchivedChange: (next: boolean) => void;
}) {
  const skin = useSkin();
  const {
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
    agentId: skin.id,
    includeArchived: showArchived,
    limit: 20,
  });

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
      className={cn(
        // Fills its Panel: the parent owns width, collapsing and the divider, so
        // this no longer positions itself, reserves a rail width, or animates.
        "flex h-full min-h-0 w-full flex-col",
        // ChatGPT's sidebar: flat grey field, no shadow or blur. The hairline
        // against the conversation is drawn by the Separator, not here.
        "bg-[#f9f9f9] text-[#0d0d0d]",
        "dark:bg-[#171717] dark:text-[#ececec]",
      )}
    >
      {/* Top: collapse control, then "New chat" as a plain row (ChatGPT's
          sidebar has no bordered button — the row IS the affordance). */}
      <div className="flex items-center justify-end px-2 pt-2">
        <button
          type="button"
          aria-label="Collapse conversations"
          title="Collapse conversations"
          data-testid="chat-inbox-back"
          onClick={closeInbox}
          className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-lg text-[#5d5d5d] transition-colors hover:bg-[#ececec] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0d0d0d] dark:text-[#b4b4b4] dark:hover:bg-white/10 dark:focus-visible:ring-white"
        >
          <PanelLeftClose className="h-[17px] w-[17px]" />
        </button>
      </div>
      <div className="px-2 pb-1">
        <button
          type="button"
          data-testid="inbox-new-conversation"
          onClick={startNewConversation}
          className={cn(
            "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[0.8125rem] font-medium transition-colors",
            "text-[#0d0d0d] hover:bg-[#ececec] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0d0d0d]",
            "dark:text-[#ececec] dark:hover:bg-white/10 dark:focus-visible:ring-white",
          )}
        >
          <SquarePen className="h-4 w-4 flex-none" />
          New chat
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
                <p className="px-2 pb-1 pt-3 text-[0.6875rem] font-medium text-[#6e6e6e] dark:text-[#9b9b9b]">
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
                            // pr-2, not a reserved 3.5rem gutter for the hover
                            // actions: permanently reserving that space made
                            // every title truncate early and left a wide grey
                            // channel down the rail. The actions instead float
                            // over the title's tail on hover (with a matching
                            // fill behind them), which is what ChatGPT does.
                            "flex w-full items-center rounded-lg py-2 pl-2 pr-2 text-left text-[0.8125rem] transition-colors",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0d0d0d] dark:focus-visible:ring-white",
                            // ChatGPT carries selection with a grey fill, not a
                            // brand color or a weight change.
                            selected
                              ? "bg-[#e3e3e3] text-[#0d0d0d] dark:bg-white/15 dark:text-[#ececec]"
                              : "text-[#0d0d0d] hover:bg-[#ececec] dark:text-[#ececec] dark:hover:bg-white/10",
                            thread.archived && "opacity-60",
                          )}
                        >
                          <span
                            className={cn(
                              "truncate",
                              !thread.name &&
                                "text-[#6e6e6e] dark:text-[#9b9b9b]",
                            )}
                          >
                            {title}
                          </span>
                          {thread.archived && (
                            <span className="ml-1.5 flex-none rounded px-1 py-0.5 text-[0.5625rem] font-medium text-[#6e6e6e] dark:text-[#9b9b9b]">
                              Archived
                            </span>
                          )}
                        </button>
                        <div
                          className={cn(
                            "pointer-events-none absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 rounded-lg pl-3 opacity-0 transition-opacity",
                            "group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100",
                            // Opaque fill so the buttons stay legible where they
                            // overlap a long title. Matches the row's hover /
                            // selected fill so it reads as part of the row.
                            selected
                              ? "bg-[#e3e3e3] dark:bg-[#2b2b2b]"
                              : "bg-[#ececec] dark:bg-[#252525]",
                          )}
                        >
                          {!thread.archived && (
                            <button
                              type="button"
                              aria-label={`Archive ${title}`}
                              title="Archive"
                              onClick={() => handleArchive(thread.id)}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#5d5d5d] transition-colors hover:bg-[#dcdcdc] dark:text-[#b4b4b4] dark:hover:bg-white/15"
                            >
                              <Archive className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            aria-label={`Delete ${title}`}
                            title="Delete"
                            onClick={() => handleDelete(thread.id, title)}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#e02e2a] transition-colors hover:bg-[#e02e2a]/10"
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
                className="mt-1 inline-flex items-center justify-start rounded-lg px-2 py-2 text-[0.8125rem] font-medium text-[#5d5d5d] transition-colors hover:bg-[#ececec] disabled:opacity-60 dark:text-[#b4b4b4] dark:hover:bg-white/10"
              >
                {isFetchingMoreThreads ? "Loading…" : "Show more"}
              </button>
            )}
          </>
        )}
      </div>

      {/* Footer: archived toggle. Borderless like ChatGPT's account row. */}
      <label className="mx-2 mb-2 flex cursor-pointer select-none items-center gap-2 rounded-lg px-2 py-2 text-[0.75rem] font-medium text-[#5d5d5d] transition-colors hover:bg-[#ececec] dark:text-[#b4b4b4] dark:hover:bg-white/10">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(e) => onShowArchivedChange(e.target.checked)}
          className="h-3.5 w-3.5 accent-[#0d0d0d] dark:accent-white"
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
