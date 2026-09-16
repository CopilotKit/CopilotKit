"use client";

import { MessagesSquare, SquarePen } from "lucide-react";

import { cn } from "@/lib/utils";
import { useSkin } from "@/shell/skin-provider";
import { useChatInbox } from "./chat-inbox-context";

/**
 * Header for the chat cluster. Rendered as an ordinary sibling above
 * `CopilotChat` — the inline chat has no `header` slot, since that is a modal
 * concern.
 *
 * Layout: the assistant title on the left, and actions on the right — open the
 * conversation inbox, and start a new conversation.
 *
 * CONVERSATION-scoped actions only. The shell controls — which skin is mounted,
 * which side the assistant docks on, and whether it is showing — all live in the
 * selector card at the top of the column. That is why this component has no
 * dependency on the layout context at all.
 */
export function ChatPanelHeader() {
  const skin = useSkin();
  const { isInboxOpen, toggleInbox, startNewConversation } = useChatInbox();

  /**
   * Read the SKIN, not `useCopilotChatConfiguration().labels.modalHeaderTitle`.
   *
   * While this was `CopilotSidebar`'s `header` slot it rendered INSIDE the chat's
   * own configuration provider, so the `labels` we passed reached it. As a sibling
   * of the inline chat it reads the wrapper-level provider instead, whose
   * `modalHeaderTitle` is the framework default "CopilotKit Chat" — non-null, so it
   * won the `??` chain and every skin's header showed that instead of its assistant
   * name. This header is skin chrome now, so the skin is the source of truth.
   */
  const title = skin.identity.assistantName ?? skin.identity.brand;

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
        {/* Skin-contributed actions (e.g. banking's Q2 invoice paperclip),
            drawn BEFORE the shell's own inbox / new / close controls. */}
        {skin.chatHeaderActions?.map((action, i) => {
          const Icon = action.icon;
          return (
            <HeaderIconButton
              key={`${action.label}-${i}`}
              label={action.label}
              onClick={action.onClick}
              testId="chat-header-skin-action"
            >
              <Icon className="h-[18px] w-[18px]" />
            </HeaderIconButton>
          );
        })}
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
