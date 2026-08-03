"use client";

import { createContext, useContext, useMemo, useState } from "react";

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
}

export function ChatInboxProvider({
  children,
  selectedThreadId,
  onSelectThread,
  onCreateThread,
}: ChatInboxProviderProps) {
  // The thread rail is PERSISTENT (ChatGPT-style): it shows alongside the
  // conversation whenever the panel is open, and the header toggle merely
  // collapses/expands it. So it defaults OPEN and selecting/creating a thread
  // does NOT close it — you keep the list in view like ChatGPT.
  const [isInboxOpen, setIsInboxOpen] = useState(true);

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
    [isInboxOpen, selectedThreadId, onSelectThread, onCreateThread],
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
