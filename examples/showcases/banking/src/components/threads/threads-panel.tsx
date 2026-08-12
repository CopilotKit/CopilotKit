import { useState } from "react";
import { useThreads } from "@copilotkit/react-core/v2";
import { ThreadsDrawer } from "./threads-drawer";
import type { DrawerThread } from "./threads-drawer";

export interface ThreadsPanelProps {
  agentId: string;
  /** The chat's current thread id (from useThreadSelection). */
  selectedThreadId: string;
  onSelectThread: (id: string) => void;
  onCreateThread: () => void;
  /**
   * Called when the currently-selected thread is archived or deleted,
   * so the parent can start a fresh conversation instead of pointing the
   * chat at a thread that no longer exists.
   */
  onSelectedThreadRemoved: () => void;
}

/**
 * Live threads list for the chat sidebar. Wraps the SDK `useThreads`
 * hook (per-user, scoped by the runtime's resolved identity) and feeds
 * the controlled `ThreadsDrawer`. Drawer starts collapsed (a rail) so
 * the chat keeps its width until the user opens it.
 */
export function ThreadsPanel({
  agentId,
  selectedThreadId,
  onSelectThread,
  onCreateThread,
  onSelectedThreadRemoved,
}: ThreadsPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const {
    threads,
    archiveThread,
    deleteThread,
    hasMoreThreads,
    isFetchingMoreThreads,
    fetchMoreThreads,
  } = useThreads({ agentId, includeArchived: showArchived, limit: 20 });

  const handleArchive = (id: string): void => {
    if (id === selectedThreadId) onSelectedThreadRemoved();
    Promise.resolve(archiveThread(id)).catch((err: unknown) => {
      console.error("Unable to archive thread", err);
    });
  };

  const handleDelete = (id: string): void => {
    if (id === selectedThreadId) onSelectedThreadRemoved();
    Promise.resolve(deleteThread(id)).catch((err: unknown) => {
      console.error("Unable to delete thread", err);
    });
  };

  return (
    <ThreadsDrawer
      threads={threads as readonly DrawerThread[]}
      selectedThreadId={selectedThreadId}
      isOpen={isOpen}
      showArchived={showArchived}
      hasNextPage={Boolean(hasMoreThreads)}
      isFetchingNextPage={Boolean(isFetchingMoreThreads)}
      onOpenChange={setIsOpen}
      onSelectThread={onSelectThread}
      onArchiveThread={handleArchive}
      onDeleteThread={handleDelete}
      onCreateThread={onCreateThread}
      onShowArchivedChange={setShowArchived}
      onLoadMore={() => fetchMoreThreads?.()}
    />
  );
}

export default ThreadsPanel;
