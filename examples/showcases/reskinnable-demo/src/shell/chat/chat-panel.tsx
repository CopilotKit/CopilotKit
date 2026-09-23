"use client";

import { useState } from "react";
import { CopilotChat } from "@copilotkit/react-core/v2";
import { SubagentFilteredAssistantMessage } from "@/shell/subagents/subagent-message-filter";
import type { CopilotChatProps } from "@copilotkit/react-core/v2";

import { useSkin } from "@/shell/skin-provider";
import {
  COMPOSER_ACCEPT,
  COMPOSER_MAX_SIZE,
  reportUploadFailure,
  uploadAttachment,
} from "@/shell/attach";
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
            // Route a SUBAGENT's narration to whatever surface the skin uses for
            // it (banking: a CLI console) instead of inlining it in the
            // conversation. Inert for a skin whose agent has no subagents — the
            // suppression set is keyed by `subagentRunId` and stays empty. See
            // `shell/subagents/subagent-message-filter.tsx`.
            messageView={{ assistantMessage: SubagentFilteredAssistantMessage }}
            // Custom suggestion pills: the eight registered via
            // useConfigureSuggestions. This slot owns the empty-state layout and
            // routes each click through the active skin first
            // (skin.onSuggestionSelect). Banking intercepts ONLY the Q2-report
            // pill, which rides a real PDF attachment so the model reads the
            // invoice; every other pill takes the framework's normal send path.
            suggestionView={
              DemoSuggestionsView as CopilotChatProps["suggestionView"]
            }
            // Multimodal attachments: officers can drop a PDF (e.g. a vendor
            // invoice), an image, or a spreadsheet into the composer.
            //
            // PDFs and images ride as-is — the built-in handler base64-encodes
            // them into a document part the model reads directly. Spreadsheets
            // cannot: the pinned `@ai-sdk/openai@3` converter rejects every media
            // type but `image/*` and `application/pdf`, and an .xlsx therefore
            // kills the run rather than degrading. `uploadAttachment` renders one
            // into a readable document first; see `shell/attach/upload-attachment.ts`.
            //
            // `onUploadFailed` is wired for the case the framework otherwise
            // treats as a silent no-op: a file that fails `accept`/`maxSize`, or a
            // sheet that cannot be parsed, is DROPPED with no trace, which on
            // stage reads as a dead click rather than as a rejected file.
            attachments={{
              enabled: true,
              accept: COMPOSER_ACCEPT,
              maxSize: COMPOSER_MAX_SIZE,
              onUpload: uploadAttachment,
              onUploadFailed: reportUploadFailure,
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
