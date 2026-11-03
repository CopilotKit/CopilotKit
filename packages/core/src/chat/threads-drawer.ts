import type { ɵThreadSummary } from "../threads-controller";

/**
 * Threads drawer binding shared by React, Vue and Angular
 * `CopilotThreadsDrawer`: the row shape, the element's loading and license
 * props, focus return to the chat input, and the drawer actions.
 *
 * Internal (`ɵ`): framework packages use it, and it can change in any release.
 */

/** The fields the drawer element renders for a thread row. */
export interface ɵDrawerThread {
  id: string;
  name: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
}

/** Narrow a thread to the fields the drawer element renders. */
export function ɵtoDrawerThread({
  id,
  name,
  archived,
  createdAt,
  updatedAt,
  lastRunAt,
}: Omit<ɵThreadSummary, "agentId">): ɵDrawerThread {
  return {
    id,
    name,
    archived,
    createdAt,
    updatedAt,
    ...(lastRunAt !== undefined ? { lastRunAt } : {}),
  };
}

/**
 * The element's `loading` and `licensed` props. While the license is still
 * pending, the drawer shows its loading state and never the locked view, so a
 * licensed drawer does not flash the upgrade prompt.
 */
export function ɵgetThreadsDrawerElementProps({
  loading,
  licensed,
  licensePending,
}: {
  loading: boolean;
  licensed: boolean;
  licensePending: boolean;
}) {
  return {
    loading: loading || licensePending,
    licensed: licensed || licensePending,
  };
}

/** Chat view containers, as React, Vue and Angular render them. */
const CHAT_CONTAINER_SELECTOR = [
  '[data-testid="copilot-chat"]',
  '[data-testid="copilot-chat-view"]',
  "copilot-chat-view",
].join(", ");

/** Chat input textareas, as React, Vue and Angular render them. */
const CHAT_INPUT_SELECTOR = [
  '[data-testid="copilot-chat-textarea"]',
  '[data-testid="copilot-chat-input-textarea"]',
  "textarea[copilotChatTextarea]",
].join(", ");

/**
 * The chat input to focus after a thread is picked. Looks inside the nearest
 * chat view around `origin` first, so a page with several chats focuses this
 * drawer's chat, then anywhere in the document. `null` without a DOM or an
 * input.
 */
export function ɵfindChatInput(origin: Element | null) {
  if (typeof document === "undefined") return null;
  const container = origin?.closest?.(CHAT_CONTAINER_SELECTOR);
  const scoped = container?.querySelector<HTMLElement>(CHAT_INPUT_SELECTOR);
  return scoped ?? document.querySelector<HTMLElement>(CHAT_INPUT_SELECTOR);
}

/** The thread-list operations a drawer uses (from `useThreads`). */
export interface ɵThreadsDrawerThreads {
  startNewThread(): void;
  archiveThread(threadId: string): Promise<void>;
  unarchiveThread(threadId: string): Promise<void>;
  deleteThread(threadId: string): Promise<void>;
  fetchMoreThreads(): void;
  refetchThreads(): void;
}

/** The chat configuration parts a drawer uses. */
export interface ɵThreadsDrawerConfig {
  threadId?: string;
  setActiveThreadId?: (
    threadId: string,
    options?: { explicit?: boolean },
  ) => void;
  startNewThread?: () => void;
}

/** App callbacks that replace the default thread switching. */
export interface ɵThreadsDrawerCallbacks {
  onThreadSelect?: (threadId: string) => void;
  onNewThread?: () => void;
}

/**
 * The drawer's actions. Getters read the latest values at call time, so an
 * adapter can create the actions once.
 *
 * - Picking a row calls `onThreadSelect`, or makes it the explicit active
 *   thread, then focuses the chat input.
 * - A new thread resets the list's selection and calls `onNewThread`, or
 *   starts a new chat thread.
 * - Deleting the active thread starts a new thread once the delete lands.
 * - Retry reloads the next page for a fetch-more failure, else the list.
 * - Failed mutations are logged, not thrown: the element shows the state.
 */
export function ɵcreateThreadsDrawerActions({
  getThreads,
  getConfig,
  getCallbacks,
  getElement,
}: {
  getThreads: () => ɵThreadsDrawerThreads;
  getConfig: () => ɵThreadsDrawerConfig | null;
  getCallbacks: () => ɵThreadsDrawerCallbacks;
  getElement: () => Element | null;
}) {
  const logFailure = (operation: string) => (error: unknown) => {
    console.error(`CopilotThreadsDrawer: ${operation} failed`, error);
  };

  const newThread = () => {
    getThreads().startNewThread();
    const { onNewThread } = getCallbacks();
    if (onNewThread) {
      onNewThread();
      return;
    }
    getConfig()?.startNewThread?.();
  };

  return {
    selectThread: (threadId: string) => {
      const { onThreadSelect } = getCallbacks();
      if (onThreadSelect) {
        onThreadSelect(threadId);
      } else {
        getConfig()?.setActiveThreadId?.(threadId, { explicit: true });
      }
      ɵfindChatInput(getElement())?.focus();
    },
    newThread,
    archive: (threadId: string) => {
      void getThreads()
        .archiveThread(threadId)
        .catch(logFailure("archiveThread"));
    },
    unarchive: (threadId: string) => {
      void getThreads()
        .unarchiveThread(threadId)
        .catch(logFailure("unarchiveThread"));
    },
    remove: (threadId: string) => {
      const wasActive = threadId === getConfig()?.threadId;
      void getThreads()
        .deleteThread(threadId)
        .then(() => {
          if (wasActive) newThread();
        })
        .catch(logFailure("deleteThread"));
    },
    retry: (scope: string) => {
      if (scope === "fetch-more") {
        getThreads().fetchMoreThreads();
        return;
      }
      getThreads().refetchThreads();
    },
    refetch: () => getThreads().refetchThreads(),
    loadMore: () => getThreads().fetchMoreThreads(),
  };
}
