"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import type { Suggestion } from "@copilotkit/core";
import { cn } from "@/lib/utils";
import { stageInvoiceAttachment } from "./attach-invoice";

/**
 * Custom suggestion view (the `suggestionView` slot of the docked
 * `CopilotSidebar`). It renders the SAME seven demo pills that
 * `useConfigureSuggestions` registers, but takes over what each click DOES —
 * the built-in suggestion path only re-sends the pill's `message` as plain
 * text (`handleSelectSuggestion` in CopilotChat), which is wrong for two pills:
 *
 *   • "Change my card PIN" must happen IN THE APP (the cards page's own PIN
 *     dialog), never as a chat/agent round-trip — so this pill NAVIGATES to
 *     `/?operation=change-pin` and lets the page open its dialog. Nothing is
 *     typed into the copilot.
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

/** Must match PILL.changePin.message in wrapper.tsx. */
export const CHANGE_PIN_MESSAGE = "I want to change the PIN on my Visa card.";
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

const PILL_CLASS =
  "inline-flex items-center rounded-full border border-hairline bg-surface px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-brand-soft hover:text-brand-indigo dark:hover:text-brand-violet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

export function DemoSuggestionsView({
  suggestions,
  onSelectSuggestion,
}: {
  suggestions: Suggestion[];
  loadingIndexes?: ReadonlyArray<number>;
  onSelectSuggestion?: (suggestion: Suggestion, index: number) => void;
}) {
  const router = useRouter();

  const handleClick = useCallback(
    (suggestion: Suggestion, index: number) => {
      // #3 — change PIN happens in the app UI, not the agent pane.
      if (suggestion.message === CHANGE_PIN_MESSAGE) {
        router.push("/?operation=change-pin");
        return;
      }
      // #6 — Q2 report rides a real PDF attachment (multimodal).
      if (suggestion.message === Q2_REPORT_MESSAGE) {
        void sendQ2WithInvoice();
        return;
      }
      // Everything else: the framework's normal suggestion send.
      onSelectSuggestion?.(suggestion, index);
    },
    [router, onSelectSuggestion],
  );

  if (!suggestions.length) return null;

  return (
    <div
      data-testid="demo-suggestions"
      className="flex flex-wrap gap-2 px-1 py-1"
    >
      {suggestions.map((suggestion, index) => (
        <button
          key={`${suggestion.title}-${index}`}
          type="button"
          data-testid={`demo-suggestion-${index}`}
          onClick={() => handleClick(suggestion, index)}
          className={cn(PILL_CLASS)}
        >
          {suggestion.title}
        </button>
      ))}
    </div>
  );
}

export default DemoSuggestionsView;
