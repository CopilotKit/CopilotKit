"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

/**
 * Shared controller for the docked chat panel's conversation inbox.
 *
 * The panel (a `CopilotSidebar`) and the inbox overlay live in two different
 * parts of the tree: the inbox + new-conversation buttons live INSIDE the
 * sidebar's header slot, while the inbox overlay is rendered as a sibling of
 * the sidebar (so it can cover the panel without being clipped by the chat
 * view). This context bridges them — and carries the thread actions from
 * `useThreadSelection` so the header and the inbox rows can switch / start
 * conversations and collapse the inbox in one place.
 */
export interface ChatInboxContextValue {
  isInboxOpen: boolean;
  openInbox: () => void;
  closeInbox: () => void;
  toggleInbox: () => void;
  /** The chat's active thread id (from useThreadSelection). */
  selectedThreadId: string;
  /** Load an existing conversation, then return to the chat view. */
  selectConversation: (id: string) => void;
  /** Start a fresh conversation, then return to the chat view. */
  startNewConversation: () => void;
}

const ChatInboxContext = createContext<ChatInboxContextValue | null>(null);

export interface ChatInboxProviderProps {
  children: React.ReactNode;
  selectedThreadId: string;
  onSelectThread: (id: string) => void;
  onCreateThread: () => void;
  /** Whether the rail starts open (a skin can default it closed). */
  initialOpen?: boolean;
  /** localStorage key that remembers the open/closed choice (per skin). */
  persistKey?: string;
}

export function ChatInboxProvider({
  children,
  selectedThreadId,
  onSelectThread,
  onCreateThread,
  initialOpen = true,
  persistKey,
}: ChatInboxProviderProps) {
  // The thread rail is PERSISTENT (ChatGPT-style): it shows alongside the
  // conversation whenever the panel is open, and the header toggle merely
  // collapses/expands it. So it defaults OPEN and selecting/creating a thread
  // does NOT close it — you keep the list in view like ChatGPT.
  // With a persistKey (a skin with layoutDefaults) the open/closed choice is
  // remembered per skin; otherwise it starts at initialOpen every load.
  const [isInboxOpen, setOpenState] = useState<boolean>(() => {
    if (!persistKey || typeof window === "undefined") return initialOpen;
    try {
      const v = window.localStorage.getItem(persistKey);
      return v === null ? initialOpen : v === "open";
    } catch {
      return initialOpen;
    }
  });
  const setIsInboxOpen = useCallback(
    (next: boolean | ((open: boolean) => boolean)) =>
      setOpenState((open) => {
        const value = typeof next === "function" ? next(open) : next;
        if (persistKey) {
          try {
            window.localStorage.setItem(persistKey, value ? "open" : "closed");
          } catch {
            // Storage blocked: the toggle still works for this page view.
          }
        }
        return value;
      }),
    [persistKey],
  );

  const value = useMemo<ChatInboxContextValue>(
    () => ({
      isInboxOpen,
      openInbox: () => setIsInboxOpen(true),
      closeInbox: () => setIsInboxOpen(false),
      toggleInbox: () => setIsInboxOpen((open) => !open),
      selectedThreadId,
      selectConversation: (id: string) => onSelectThread(id),
      startNewConversation: () => onCreateThread(),
    }),
    [
      isInboxOpen,
      setIsInboxOpen,
      selectedThreadId,
      onSelectThread,
      onCreateThread,
    ],
  );

  return (
    <ChatInboxContext.Provider value={value}>
      {children}
    </ChatInboxContext.Provider>
  );
}

/**
 * Access the panel inbox controller. Returns a safe no-op fallback when used
 * outside the provider so a stray render never throws.
 */
export function useChatInbox(): ChatInboxContextValue {
  const ctx = useContext(ChatInboxContext);
  if (ctx) return ctx;
  return {
    isInboxOpen: false,
    openInbox: () => {},
    closeInbox: () => {},
    toggleInbox: () => {},
    selectedThreadId: "",
    selectConversation: () => {},
    startNewConversation: () => {},
  };
}

export default ChatInboxContext;
