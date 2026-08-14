"use client";

import { useState } from "react";
import { CopilotChat } from "@copilotkit/react-core/v2";
import type { CopilotChatProps } from "@copilotkit/react-core/v2";

import { useSkin } from "@/shell/skin-provider";
import { ChatPanelHeader } from "./chat-panel-header";
import { ChatInbox } from "./chat-inbox";
import { useChatInbox } from "./chat-inbox-context";
import { DemoSuggestionsView } from "./demo-suggestions";

/**
 * The chat cluster: the thread rail beside the conversation inside ONE card,
 * divided by a hairline with no gap.
 *
 * The rail is a FIXED-WIDTH element, not a resizable panel. It began as a nested
 * panel group, which made the assistant column's minimum a compound of rail +
 * conversation and produced a cascade of consequences: a breakpoint derived from
 * the floors, a collapsed-state minimum that switched, and a chat that could be
 * widened but not narrowed. It also fought v4's collapse API three ways — a
 * persisted `0` restored forever, `expand()` restoring that same `0`, and
 * `resize()` ignored while collapsed. A plain fixed-width div has none of that:
 * the rail is either there at its natural width or it is not.
 *
 * When the card itself gets narrow the rail hides automatically via a container
 * query (see `.nw-chat-rail` in globals.css), so dragging the assistant down to
 * its 250px floor gives the whole card to the conversation instead of squeezing it
 * behind a rail. The header toggle is the explicit control; the container query is
 * only a floor guard.
 *
 * `.nw-chat` scopes this subtree's markdown typography (see globals.css). Removing
 * that class silently reverts assistant messages to the library's default prose
 * styling, with no error and no failing test.
 */
export function ChatPanel({ threadId }: { threadId: string }) {
  const skin = useSkin();
  const [showArchived, setShowArchived] = useState(false);
  const { isInboxOpen } = useChatInbox();

  return (
    <div className="nw-chat nw-chat-cluster flex h-full min-h-0">
      {isInboxOpen && (
        <div className="nw-chat-rail min-h-0 shrink-0 border-r border-hairline">
          <ChatInbox
            showArchived={showArchived}
            onShowArchivedChange={setShowArchived}
          />
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ChatPanelHeader />
        <div className="min-h-0 flex-1">
          <CopilotChat
            agentId={skin.id}
            threadId={threadId}
            // Custom suggestion pills, registered via useConfigureSuggestions.
            // This slot owns the empty-state layout and routes each click
            // through the active skin first (skin.onSuggestionSelect). A skin
            // intercepts only the pills that must ride a real file into the
            // composer — banking claims two, the Q2 invoice and the offsite
            // statement — and every other pill takes the framework's normal
            // send path.
            suggestionView={
              DemoSuggestionsView as CopilotChatProps["suggestionView"]
            }
            // Multimodal attachments: a user can drop a PDF (e.g. a vendor
            // invoice), a CSV (e.g. a card statement) or an image into the
            // composer. With no custom onUpload the built-in handler
            // base64-encodes the file and sends it as a document part on the
            // message, so the model can read it — which also means a turn
            // carrying an attachment arrives as multimodal PARTS rather than a
            // string, and anything matching on message text has to handle both.
            attachments={{
              enabled: true,
              // `text/csv` rides alongside the PDF and image kinds because a
              // statement or an export is a document a user would reasonably hand
              // the assistant. Note the composer filters on this string: a kind
              // missing here is dropped by `processFiles` with no chip and no
              // error, which is why `stageAttachment` treats "no chip appeared"
              // as a named failure rather than a no-op.
              accept: "application/pdf,text/csv,image/*",
              maxSize: 20 * 1024 * 1024,
            }}
            // Drop the "AI can make mistakes…" line under the composer.
            input={{ showDisclaimer: false }}
            labels={{
              modalHeaderTitle:
                skin.identity.assistantName ?? skin.identity.brand,
              welcomeMessageText:
                skin.identity.greeting ?? skin.identity.tagline,
            }}
          />
        </div>
      </div>
    </div>
  );
}

export default ChatPanel;
