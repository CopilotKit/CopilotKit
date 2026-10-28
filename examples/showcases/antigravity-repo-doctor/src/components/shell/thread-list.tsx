"use client";

import { useEffect, useState } from "react";
import { useThreads } from "@copilotkit/react-core/v2";
import { Archive, Trash2, SquarePen } from "lucide-react";
import { AGENT_ID } from "@/lib/agent-id";
import { cn } from "@/lib/cn";
import { useWorkspace } from "@/lib/use-workspace";

function ago(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/** The first user message, on one line, cut at a word near 60 characters. */
export function titleFromMessages(messages: readonly unknown[]): string | null {
  const first = messages.find(
    (m): m is { role: "user"; content: string } =>
      typeof m === "object" &&
      m !== null &&
      (m as { role?: unknown }).role === "user" &&
      typeof (m as { content?: unknown }).content === "string",
  );
  const text = first?.content.replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (text.length <= 60) return text;
  const cut = text.slice(0, 60);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 30 ? cut.lastIndexOf(" ") : 60)}…`;
}

// Shared by the rail and the phone drawer, which both mount a ThreadList.
const named = new Set<string>();

/**
 * Names the open thread after its first message once Intelligence lists it.
 * Replaces the runtime's model-written titles (turned off in the route).
 */
function useNameActiveThread(
  threads: readonly { id: string; name?: string | null }[],
  activeThreadId: string,
  renameThread: (threadId: string, name: string) => Promise<unknown>,
) {
  const { messages } = useWorkspace();
  const title = titleFromMessages(messages);
  const unnamed = threads.some(
    (t) => t.id === activeThreadId && !t.name?.trim(),
  );
  useEffect(() => {
    if (!unnamed || !title || named.has(activeThreadId)) return;
    named.add(activeThreadId);
    renameThread(activeThreadId, title).catch((error: unknown) => {
      named.delete(activeThreadId);
      console.error("Could not name the conversation", error);
    });
  }, [unnamed, title, activeThreadId, renameThread]);
}

const iconButton =
  "flex size-8 flex-none items-center justify-center rounded-md text-faint transition-colors hover:bg-tint-2 hover:text-text";

/**
 * Conversations saved by CopilotKit Intelligence. Picking one reopens it with
 * its full history, including the approval cards' decisions, on any device.
 * Each row can be archived (hidden from the list) or deleted (second click
 * confirms). Removing the open conversation starts a new one.
 */
export function ThreadList({
  activeThreadId,
  onSelect,
  onNewThread,
}: {
  activeThreadId: string;
  onSelect: (threadId: string) => void;
  onNewThread: () => void;
}) {
  // Archived threads are left out of the list (includeArchived defaults to false).
  const {
    threads,
    isLoading,
    listError,
    archiveThread,
    deleteThread,
    renameThread,
  } = useThreads({
    agentId: AGENT_ID,
    limit: 50,
  });
  useNameActiveThread(threads, activeThreadId, renameThread);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const act = async (threadId: string, kind: "archive" | "delete") => {
    setActionError(null);
    setBusy(threadId);
    try {
      if (kind === "archive") await archiveThread(threadId);
      else {
        await deleteThread(threadId);
        // Its working files and saved copy in the bucket go too. Best effort:
        // the conversation itself is already gone.
        const removed = await fetch(
          `/api/workspaces/${encodeURIComponent(threadId)}`,
          { method: "DELETE" },
        )
          .then((r) => r.ok)
          .catch(() => false);
        if (!removed)
          console.error("Could not delete the conversation's working files");
      }
      setConfirming(null);
      if (threadId === activeThreadId) onNewThread();
    } catch (error) {
      console.error(`Could not ${kind} the conversation`, error);
      setActionError(
        kind === "archive"
          ? "Could not archive that conversation."
          : "Could not delete that conversation.",
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <nav
      className="scroll-thin flex min-h-0 flex-1 flex-col overflow-y-auto border-r border-line bg-surface"
      aria-label="Conversations"
    >
      <p className="eyebrow px-4 pt-4 pb-2">Conversations</p>
      {isLoading && <p className="px-4 text-[15.5px] text-faint">Loading</p>}
      {listError && (
        <p className="px-4 text-[15.5px] text-fail">
          Could not load conversations.
        </p>
      )}
      {actionError && (
        <p
          role="alert"
          className="mx-2 mb-1 rounded-lg bg-fail/10 px-2.5 py-1.5 text-[14px] text-fail"
        >
          {actionError}
        </p>
      )}
      {!isLoading && threads.length === 0 && (
        <p className="px-4 text-[15.5px] leading-relaxed text-faint">
          Saved conversations show up here.
        </p>
      )}
      <ul className="space-y-0.5 px-2 pb-4">
        {threads.map((thread) => {
          const active = thread.id === activeThreadId;
          const asking = confirming === thread.id;
          const pending = busy === thread.id;
          return (
            <li
              key={thread.id}
              className={cn(
                "group relative flex items-center rounded-lg transition-colors",
                active ? "bg-raised" : "hover:bg-tint-2",
              )}
              onMouseLeave={() => asking && setConfirming(null)}
            >
              <button
                type="button"
                onClick={() => onSelect(thread.id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-2 py-2 pl-2.5 pr-1 text-left text-[15.5px]",
                  active ? "text-text" : "text-dim hover:text-text",
                )}
              >
                <span className="min-w-0 flex-1 truncate">
                  {thread.name ?? "New conversation"}
                </span>
                <span className="flex-none text-[14px] text-faint tabular-nums">
                  {ago(thread.lastRunAt ?? thread.updatedAt)}
                </span>
              </button>
              {asking ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void act(thread.id, "delete")}
                  className="mr-1 h-8 flex-none rounded-md bg-fail/10 px-2.5 text-[14px] font-medium text-fail hover:bg-fail/20 disabled:opacity-60"
                >
                  {pending ? "Deleting" : "Delete?"}
                </button>
              ) : (
                // Shown on hover and keyboard focus; always shown on touch screens.
                <div className="mr-1 flex flex-none items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => void act(thread.id, "archive")}
                    aria-label={`Archive ${thread.name ?? "conversation"}`}
                    title="Archive"
                    className={iconButton}
                  >
                    <Archive className="size-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      setActionError(null);
                      setConfirming(thread.id);
                    }}
                    aria-label={`Delete ${thread.name ?? "conversation"}`}
                    title="Delete"
                    className={cn(iconButton, "hover:text-fail")}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="sticky bottom-0 mt-auto border-t border-line bg-surface p-3">
        <button
          type="button"
          onClick={onNewThread}
          data-testid="new-conversation"
          className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-line bg-panel px-3.5 text-[15.5px] font-medium text-text transition-colors hover:border-line-strong hover:bg-raised"
        >
          <SquarePen className="size-[18px]" aria-hidden />
          New conversation
        </button>
      </div>
    </nav>
  );
}
