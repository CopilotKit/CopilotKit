"use client";

import { MessagesSquare, SquarePen, X } from "lucide-react";
import { useCopilotChatConfiguration } from "@copilotkit/react-core/v2";

import { cn } from "@/lib/utils";
import { IDENTITY } from "@/lib/identity";
import { useChatInbox } from "./chat-inbox-context";

/**
 * Custom header for the docked chat panel, supplied to `CopilotSidebar` via its
 * `header` slot. It renders INSIDE the sidebar's own
 * `CopilotChatConfigurationProvider`, so `useCopilotChatConfiguration()` is the
 * live handle for the panel — `setModalOpen(false)` collapses the panel and the
 * change propagates up to the wrapper-level provider the inbox overlay reads.
 *
 * Layout: a small violet→indigo brand chip + the assistant title on the left,
 * and three actions on the right — open the conversation inbox, start a new
 * conversation, and close the panel.
 */
export function ChatPanelHeader() {
  const configuration = useCopilotChatConfiguration();
  const { isInboxOpen, toggleInbox, startNewConversation } = useChatInbox();

  const title = configuration?.labels.modalHeaderTitle ?? IDENTITY.assistant;

  const closePanel = () => configuration?.setModalOpen?.(false);

  return (
    <header
      data-testid="chat-panel-header"
      className="flex h-[68px] flex-shrink-0 items-center justify-between gap-2 border-b border-hairline bg-surface/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-surface/80"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="brand-gradient flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl text-surface shadow-[0_6px_16px_hsl(252_83%_60%/0.4)]">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className="h-5 w-5"
            aria-hidden="true"
          >
            <path
              d="M4 13.5L9 7l4 4.5L20 4"
              stroke="white"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="20" cy="4" r="2" fill="white" />
          </svg>
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold leading-tight tracking-tight text-ink">
            {title}
          </p>
          <p className="truncate text-xs leading-tight text-ink-muted">
            {IDENTITY.brand}
          </p>
        </div>
      </div>

      <div className="flex flex-shrink-0 items-center gap-1">
        <HeaderIconButton
          label={isInboxOpen ? "Back to chat" : "Conversations"}
          active={isInboxOpen}
          onClick={toggleInbox}
          testId="chat-inbox-toggle"
        >
          <MessagesSquare className="h-[18px] w-[18px]" />
        </HeaderIconButton>
        <HeaderIconButton
          label="New conversation"
          onClick={startNewConversation}
          testId="chat-header-new-conversation"
        >
          <SquarePen className="h-[18px] w-[18px]" />
        </HeaderIconButton>
        <HeaderIconButton
          label="Close chat"
          onClick={closePanel}
          testId="chat-header-close"
        >
          <X className="h-[18px] w-[18px]" />
        </HeaderIconButton>
      </div>
    </header>
  );
}

function HeaderIconButton({
  label,
  onClick,
  active = false,
  testId,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      data-testid={testId}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
        active
          ? "bg-brand-soft text-brand-indigo dark:text-brand-violet"
          : "text-ink-muted hover:bg-brand-soft hover:text-brand-indigo dark:hover:text-brand-violet",
      )}
    >
      {children}
    </button>
  );
}

export default ChatPanelHeader;
