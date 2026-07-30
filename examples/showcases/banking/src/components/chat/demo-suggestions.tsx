"use client";

import { useCallback } from "react";
import { useAgent } from "@copilotkit/react-core/v2";
import type { Suggestion } from "@copilotkit/core";
import { cn } from "@/lib/utils";
import { IDENTITY } from "@/lib/identity";
import { stageInvoiceAttachment } from "./attach-invoice";

/**
 * Custom suggestion view (the `suggestionView` slot of the docked
 * `CopilotSidebar`). It has two jobs:
 *
 * 1. Own the EMPTY conversation. CopilotChatView only renders its centered
 *    welcome screen when `hasExplicitThreadId` is false and this demo always
 *    pins a threadId, so without this the pills sit at the top of a tall void.
 *    See the isEmptyConversation branch below.
 *
 * 2. Take over what a click DOES, because the built-in suggestion path only
 *    re-sends the pill's `message` as plain text (`handleSelectSuggestion` in
 *    CopilotChat), which is wrong for one pill:
 *
 *   • "Prep the Q2 spend report" is the multimodal beat: it must ride a real
 *     PDF attachment so the model reads the invoice. The suggestion path drops
 *     attachments entirely, so this pill instead drives the REAL composer —
 *     it stages the bundled invoice into the attachment queue (a real PDF chip
 *     appears), types the request, and clicks send. That routes through the
 *     composer's onSubmitInput, which consumes the attachment AND handles the
 *     frontend-tool result round-trip + Intelligence run lifecycle correctly
 *     (a hand-rolled runAgent leaves createReport's result dangling and the
 *     Intelligence gateway then fails the run). gpt-5.4 reads the invoice and
 *     folds its figures into the filed report + charts via createReport's
 *     `additions`.
 *
 * Every other pill is a plain send, delegated to the framework's own
 * `onSelectSuggestion` so it behaves exactly like a normal suggestion click.
 *
 * The pill→behavior mapping is keyed off the pill `message` text (the demo owns
 * those strings in wrapper.tsx), so it stays correct regardless of pill order.
 */

/** Must match PILL.q2Report.message in wrapper.tsx. */
export const Q2_REPORT_MESSAGE =
  "Prepare a Q2 spend report for the board: summarize spend against budgets, call out anything over limit or pending, and file it as a report.";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Set a React-controlled textarea's value so its onChange fires. */
function setTextareaValue(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Drive the real composer: stage the invoice, type the Q2 request, click send.
 * Uses the composer's own submit path so attachments are consumed and the run
 * completes cleanly.
 */
async function sendQ2WithInvoice() {
  const staged = await stageInvoiceAttachment();
  // Let the built-in attachment handler finish base64-encoding the file so the
  // composer's send is not blocked by an "uploading" attachment.
  if (staged) await wait(500);

  const textarea = document.querySelector<HTMLTextAreaElement>(
    'textarea[data-testid="copilot-chat-textarea"]',
  );
  if (!textarea) return;
  setTextareaValue(textarea, Q2_REPORT_MESSAGE);
  await wait(60);

  const sendButton = document.querySelector<HTMLButtonElement>(
    'button[data-testid="copilot-send-button"]',
  );
  sendButton?.click();
}

// ChatGPT's prompt chips: neutral hairline outline on the conversation's own
// white, grey fill on hover. No brand color — this surface is ChatGPT, not Aurora.
const PILL_CLASS =
  "inline-flex items-center rounded-full border border-[#e3e3e3] bg-white px-3 py-1.5 text-[0.8125rem] text-[#0d0d0d] transition-colors hover:bg-[#f4f4f4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0d0d0d] dark:border-white/15 dark:bg-transparent dark:text-[#ececec] dark:hover:bg-white/10 dark:focus-visible:ring-white";

export function DemoSuggestionsView({
  suggestions,
  onSelectSuggestion,
}: {
  suggestions: Suggestion[];
  loadingIndexes?: ReadonlyArray<number>;
  onSelectSuggestion?: (suggestion: Suggestion, index: number) => void;
}) {
  // Empty-conversation detection. CopilotChatView only renders its centered
  // welcome screen when `hasExplicitThreadId` is false, and this demo always
  // pins a threadId — so on a fresh thread the SDK falls back to the normal
  // layout and these pills land at the top of an empty message list, leaving a
  // tall void above the composer. We own that space instead: when there are no
  // messages yet, this slot becomes a proper ChatGPT-style empty state
  // (centered greeting with the pills beneath it).
  const { agent } = useAgent({ agentId: "default" });
  const isEmptyConversation = (agent?.messages?.length ?? 0) === 0;

  const handleClick = useCallback(
    (suggestion: Suggestion, index: number) => {
      // Ignore clicks while a run is in flight. A second click sends a second
      // message over the top of the first, which showed up live as the same
      // prompt twice and left the previous run's tool call without a result —
      // and Intelligence then fails the whole thread with "Tool result is
      // missing for tool call ...". Cheaper to drop the extra click than to
      // recover a poisoned thread mid-demo.
      if (agent?.isRunning) return;

      // Q2 report rides a real PDF attachment (multimodal).
      if (suggestion.message === Q2_REPORT_MESSAGE) {
        void sendQ2WithInvoice();
        return;
      }
      // Everything else: the framework's normal suggestion send.
      onSelectSuggestion?.(suggestion, index);
    },
    [onSelectSuggestion, agent],
  );

  if (!suggestions.length) return null;

  const pills = suggestions.map((suggestion, index) => (
    <button
      key={`${suggestion.title}-${index}`}
      type="button"
      data-testid={`demo-suggestion-${index}`}
      onClick={() => handleClick(suggestion, index)}
      disabled={agent?.isRunning}
      className={cn(PILL_CLASS, agent?.isRunning && "opacity-50")}
    >
      {suggestion.title}
    </button>
  ));

  if (isEmptyConversation) {
    return (
      <div
        data-testid="demo-suggestions"
        // Owns the empty conversation: fills the height the SDK would have given
        // its welcome screen, so the greeting reads as centered instead of the
        // pills clinging to the top of a void.
        className="flex min-h-[58vh] flex-col items-center justify-center gap-5 px-3"
      >
        <div className="flex max-w-[22rem] flex-col items-center gap-2 text-center">
          <h2 className="text-[1.375rem] font-semibold tracking-tight text-[#0d0d0d] dark:text-[#ececec]">
            What can I help with?
          </h2>
          <p className="text-[0.8125rem] leading-relaxed text-[#6e6e6e] dark:text-[#b4b4b4]">
            {IDENTITY.greeting}
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">{pills}</div>
      </div>
    );
  }

  return (
    <div
      data-testid="demo-suggestions"
      className="flex flex-wrap gap-2 px-1 py-1"
    >
      {pills}
    </div>
  );
}

export default DemoSuggestionsView;
