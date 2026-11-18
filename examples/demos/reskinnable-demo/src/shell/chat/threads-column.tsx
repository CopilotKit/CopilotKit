"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import { ChatInbox } from "./chat-inbox";
import { useChatInbox } from "./chat-inbox-context";

/** The rail's width inside its column, and the gap that separates it. */
export const THREADS_COLUMN_PX = 248;
const GAP_PX = 8;

/**
 * The thread rail as its own column, for a skin whose `layoutDefaults` set
 * `inboxPlacement: "column"`. ShellFrame puts it on the chat's outer edge. It
 * animates its width, so opening it pushes the chat and app across and the app
 * reflows narrower; nothing is drawn over the conversation.
 *
 * The rail stays mounted while closed so the slide shows real content both
 * ways. Closed, it is `inert` and hidden from assistive tech.
 */
export function ThreadsColumn({ side }: { side: "left" | "right" }) {
  const { isInboxOpen } = useChatInbox();
  const [showArchived, setShowArchived] = useState(false);
  return (
    <div
      data-testid="threads-column"
      data-open={isInboxOpen ? "true" : "false"}
      aria-hidden={isInboxOpen ? undefined : true}
      inert={!isInboxOpen}
      className="h-full shrink-0 overflow-hidden transition-[width] duration-200 ease-out motion-reduce:transition-none"
      style={{ width: isInboxOpen ? THREADS_COLUMN_PX + GAP_PX : 0 }}
    >
      <div
        className={cn("h-full", side === "right" ? "pl-2" : "pr-2")}
        style={{ width: THREADS_COLUMN_PX + GAP_PX }}
      >
        <div className="nw-panel-card h-full overflow-hidden border border-hairline bg-surface shadow-soft">
          <ChatInbox
            showArchived={showArchived}
            onShowArchivedChange={setShowArchived}
          />
        </div>
      </div>
    </div>
  );
}
