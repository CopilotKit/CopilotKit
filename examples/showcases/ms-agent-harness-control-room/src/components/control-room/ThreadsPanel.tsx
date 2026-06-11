"use client";

/**
 * Intelligence threads panel for the showcase sidebar.
 *
 * Lists the shared demo user's conversations for the control room agent,
 * with resume, new-thread, rename, archive, and delete. Rendered only when
 * the runtime reports Intelligence mode (see useIntelligenceEnabled), and
 * styled to match the Generative UI catalog surface so the two sidebar
 * tabs read as one cockpit.
 */

import { formatDistanceToNow } from "date-fns";
import {
  Archive,
  Check,
  MessageSquare,
  MessagesSquare,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import { useAgent, useCopilotKit, useThreads } from "@copilotkit/react-core/v2";
import type { Thread } from "@copilotkit/react-core/v2";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useControlRoomLocal } from "@/hooks/use-control-room-state";
import { CONTROL_ROOM_AGENT_NAME } from "@/lib/control-room-agent";
import { cn } from "@/lib/utils";

const UNTITLED_THREAD_LABEL = "New conversation";
const DELETE_CONFIRM_TIMEOUT_MS = 3_000;

/**
 * True once the runtime's /info reports Intelligence mode. Same gate the
 * CopilotKit chat internals use for Intelligence-only affordances.
 */
export function useIntelligenceEnabled(): boolean {
  const { copilotkit } = useCopilotKit();
  return copilotkit.intelligence !== undefined;
}

function formatLastActivity(thread: Thread): string {
  const iso = thread.lastRunAt ?? thread.updatedAt;
  const timestamp = new Date(iso);
  if (Number.isNaN(timestamp.getTime())) return "recently";
  return formatDistanceToNow(timestamp, { addSuffix: true });
}

export function ThreadsPanel({ className }: { className?: string }) {
  const { localState, setActiveThreadId, startFreshThread } =
    useControlRoomLocal();
  // updates: [] — we only need the agent instance to detach in-flight
  // runs on switch, not re-renders on its activity.
  const { agent } = useAgent({
    agentId: CONTROL_ROOM_AGENT_NAME,
    updates: [],
  });
  const {
    threads,
    isLoading,
    error,
    hasMoreThreads,
    isFetchingMoreThreads,
    fetchMoreThreads,
    renameThread,
    archiveThread,
    deleteThread,
  } = useThreads({ agentId: CONTROL_ROOM_AGENT_NAME, limit: 20 });

  const activeThreadId = localState.activeThreadId;

  /**
   * Detach any in-flight run before changing conversations. Without the
   * detach, the old run's stream keeps applying to the shared agent and
   * collides with the next thread's connect replay ("Cannot send
   * 'RUN_STARTED' while a run is still active"). Detaching only drops the
   * client subscription — in Intelligence mode the run continues
   * server-side and its output lands in its (durable) thread.
   */
  const detachActiveRun = async () => {
    await agent.detachActiveRun().catch(() => {});
  };

  const switchThread = async (threadId: string) => {
    if (threadId === activeThreadId) return;
    await detachActiveRun();
    setActiveThreadId(threadId);
  };

  const startNewThread = async () => {
    await detachActiveRun();
    // Fresh conversations skip /connect, so nothing else clears the shared
    // agent — wipe messages/state the same way core's connect path does on
    // a fresh restore. Without this the previous thread's content leaks
    // into the new chat (and suppresses the welcome screen).
    agent.setMessages([]);
    agent.setState({});
    // Clear the departed thread's replay cursor too. Fresh chats never
    // /connect, so core's last-connected pointer still names that thread;
    // revisiting it would look like same-thread churn and resume from the
    // cursor mid-stream onto the wiped state instead of replaying fully.
    const proxied = agent as unknown as {
      clearReplayCursor?: (threadId: string) => void;
    };
    if (activeThreadId && typeof proxied.clearReplayCursor === "function") {
      proxied.clearReplayCursor(activeThreadId);
    }
    startFreshThread();
  };

  const removeThread = async (
    threadId: string,
    action: (id: string) => Promise<void>,
  ) => {
    await action(threadId);
    if (activeThreadId === threadId) {
      void startNewThread();
    }
  };

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="cr-catalog-surface relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="cr-catalog-controls shrink-0 px-4 pb-3 pt-4">
          <div className="flex h-7 min-w-0 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="grid size-5 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"
                aria-hidden
              >
                <MessagesSquare className="size-3.5" />
              </span>
              <span className="truncate text-sm font-semibold tracking-tight">
                Conversations
              </span>
              {!isLoading && threads.length > 0 ? (
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium tabular-nums leading-none text-muted-foreground">
                  {threads.length}
                </span>
              ) : null}
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="icon-sm"
                  onClick={() => void startNewThread()}
                  className="cr-brand-gradient-control size-7 shrink-0 rounded-lg border-transparent text-white shadow-none hover:text-white"
                  aria-label="Start a new conversation"
                >
                  <Plus className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>New thread</TooltipContent>
            </Tooltip>
          </div>
        </div>
        <Separator className="cr-catalog-rule shrink-0" />
        <div className="cr-catalog-scroll-region relative min-h-0 flex-1">
          {/*
            Radix wraps scroll content in an inline-styled
            `min-width:100%; display:table` div that sizes to content,
            letting wide rows push the cards past the panel edge instead
            of truncating. Force it to behave like a block that fills the
            viewport (important beats the inline style).
          */}
          <ScrollArea className="h-full [&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]>div]:!w-full [&_[data-slot=scroll-area-viewport]>div]:!min-w-0">
            <div className="space-y-2.5 px-4 pb-7 pt-3">
              {error ? (
                <div
                  className="cr-catalog-card rounded-2xl border p-4 text-sm text-destructive"
                  role="alert"
                >
                  Couldn&apos;t load conversations: {error.message}
                </div>
              ) : null}
              {isLoading ? <ThreadListSkeleton /> : null}
              {!isLoading && !error && threads.length === 0 ? (
                <div className="cr-catalog-card flex flex-col items-center gap-2 rounded-2xl border px-5 py-8 text-center">
                  <span
                    className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary"
                    aria-hidden
                  >
                    <MessageSquare className="size-4" />
                  </span>
                  <p className="text-sm font-medium">No conversations yet</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Send a message in the workstream to start the first one.
                  </p>
                </div>
              ) : null}
              {threads.map((thread) => (
                <ThreadCard
                  key={thread.id}
                  thread={thread}
                  active={thread.id === activeThreadId}
                  onSelect={() => void switchThread(thread.id)}
                  onRename={(name) => renameThread(thread.id, name)}
                  onArchive={() => removeThread(thread.id, archiveThread)}
                  onDelete={() => removeThread(thread.id, deleteThread)}
                />
              ))}
              {hasMoreThreads ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full rounded-xl"
                  disabled={isFetchingMoreThreads}
                  onClick={fetchMoreThreads}
                >
                  {isFetchingMoreThreads ? "Loading…" : "Load more"}
                </Button>
              ) : null}
            </div>
          </ScrollArea>
          <div className="cr-catalog-fade-bottom pointer-events-none absolute inset-x-0 bottom-0 z-10 h-7" />
        </div>
      </div>
    </div>
  );
}

function ThreadListSkeleton() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-[58px] animate-pulse rounded-2xl border border-border/50 bg-muted/30"
        />
      ))}
    </>
  );
}

function ThreadCard({
  thread,
  active,
  onSelect,
  onRename,
  onArchive,
  onDelete,
}: {
  thread: Thread;
  active: boolean;
  onSelect: () => void;
  onRename: (name: string) => Promise<void>;
  onArchive: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Disarm the delete confirmation if it isn't clicked again promptly.
  useEffect(() => {
    if (!confirmingDelete) return undefined;
    const t = setTimeout(
      () => setConfirmingDelete(false),
      DELETE_CONFIRM_TIMEOUT_MS,
    );
    return () => clearTimeout(t);
  }, [confirmingDelete]);

  const runAction = async (action: () => Promise<void>) => {
    setBusy(true);
    setActionError(null);
    try {
      await action();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  };

  const submitRename = async () => {
    const name = draftName.trim();
    setEditing(false);
    if (!name || name === thread.name) return;
    await runAction(() => onRename(name));
  };

  if (editing) {
    return (
      <div className="cr-catalog-card cr-catalog-card-active flex items-center gap-1.5 rounded-2xl border p-2.5">
        <Input
          autoFocus
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submitRename();
            if (e.key === "Escape") setEditing(false);
          }}
          className="h-8 flex-1 rounded-lg text-sm"
          aria-label="Thread name"
          placeholder="Conversation name"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Save name"
          onClick={() => void submitRename()}
        >
          <Check className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Cancel rename"
          onClick={() => setEditing(false)}
        >
          <X className="size-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "cr-catalog-card group relative flex min-w-0 items-center gap-2.5 rounded-2xl border p-3 transition-colors",
        active && "cr-catalog-card-active",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        aria-current={active ? "true" : undefined}
        title={active ? "Current conversation" : "Open this conversation"}
      >
        <span
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-lg transition-colors",
            active
              ? "bg-primary text-primary-foreground"
              : "bg-primary/10 text-primary",
          )}
          aria-hidden
        >
          <MessageSquare className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium leading-snug">
            {thread.name ?? UNTITLED_THREAD_LABEL}
          </span>
          <span className="block truncate text-xs leading-snug text-muted-foreground">
            {formatLastActivity(thread)}
          </span>
          {actionError ? (
            <span className="block truncate text-[11px] leading-snug text-destructive">
              {actionError}
            </span>
          ) : null}
        </span>
      </button>
      <div className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Rename conversation"
              disabled={busy}
              onClick={() => {
                setDraftName(thread.name ?? "");
                setEditing(true);
              }}
            >
              <Pencil className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Rename</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Archive conversation"
              disabled={busy}
              onClick={() => void runAction(onArchive)}
            >
              <Archive className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Archive</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant={confirmingDelete ? "destructive" : "ghost"}
              size="icon-sm"
              aria-label={
                confirmingDelete
                  ? "Confirm delete conversation"
                  : "Delete conversation"
              }
              disabled={busy}
              onClick={() => {
                if (!confirmingDelete) {
                  setConfirmingDelete(true);
                  return;
                }
                setConfirmingDelete(false);
                void runAction(onDelete);
              }}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {confirmingDelete ? "Click again to delete" : "Delete"}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
