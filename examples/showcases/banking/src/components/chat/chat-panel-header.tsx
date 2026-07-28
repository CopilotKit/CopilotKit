"use client";

import { MessagesSquare, Paperclip, SquarePen, X } from "lucide-react";
import { useCopilotChatConfiguration } from "@copilotkit/react-core/v2";

import { stageInvoiceAttachment } from "./attach-invoice";
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
      // ChatGPT's top bar is nearly invisible: no border, no fill, no branded
      // chip — just the model/assistant name at small weight on the same white
      // as the conversation, with icon actions on the right. Kept borderless so
      // the conversation reads as one continuous surface.
      className="flex h-[52px] flex-shrink-0 items-center justify-between gap-2 bg-transparent px-3"
    >
      <p className="min-w-0 truncate px-1 text-[0.9375rem] font-medium text-[#0d0d0d] dark:text-[#ececec]">
        {title}
      </p>

      <div className="flex flex-shrink-0 items-center gap-1">
        <HeaderIconButton
          label="Attach Q2 invoice"
          onClick={() => void stageInvoiceAttachment()}
          testId="chat-header-attach-invoice"
        >
          <Paperclip className="h-[18px] w-[18px]" />
        </HeaderIconButton>
        <HeaderIconButton
          label={isInboxOpen ? "Hide conversations" : "Show conversations"}
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
        // Neutral greys, matching ChatGPT's header icon buttons.
        "inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0d0d0d] dark:focus-visible:ring-white",
        active
          ? "bg-[#ececec] text-[#0d0d0d] dark:bg-white/15 dark:text-[#ececec]"
          : "text-[#5d5d5d] hover:bg-[#ececec] dark:text-[#b4b4b4] dark:hover:bg-white/10",
      )}
    >
      {children}
    </button>
  );
}

export default ChatPanelHeader;
