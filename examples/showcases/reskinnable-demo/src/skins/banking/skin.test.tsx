/**
 * WHICH PILLS BANKING INTERCEPTS — and, just as load-bearing, which it does not.
 *
 * One of the nine rides a real file into the composer, matched by STRING
 * EQUALITY inside `onSuggestionSelect`. The failure this guards is the quiet
 * one: an interception that stops firing does not throw, does not fail a
 * type-check and does not fail any other test — the pill falls through to the
 * shell's default send, the prompt goes out with no attachment, and the model
 * answers about a document nobody gave it.
 *
 * The harness pill is here for the OPPOSITE reason. It must keep falling
 * through, because `@ai-sdk/openai` accepts only images and `application/pdf` as
 * file parts and throws `UnsupportedFunctionalityError` on anything else. An
 * attempt to attach the statement CSV staged perfectly — chip queued, filename
 * printed, message sent — and then every run died with "'file part media type
 * text/csv' functionality not supported". Nothing below the composer knows that
 * rule, so this test is where it is written down.
 *
 * `suggestions.test.ts` guards the other half (that a pill carrying each
 * constant is still in the catalog).
 */
import { describe, expect, it, vi } from "vitest";

// The real send drives the LIVE composer through `@/shell/attach` — it locates a
// textarea, stages bytes into a hidden input, clicks send, and reports every
// failure through `window.alert`. None of that exists here, and these assertions
// are about WHICH pill is intercepted, not about that chain (which
// `shell/attach/stage-attachment.test.ts` owns end to end).
const sentQ2 = vi.fn(() => Promise.resolve(true));

// `importOriginal` keeps the REAL module constants, so a pill whose text drifts
// from them still fails this file. Only the DOM-driving functions are replaced.
vi.mock("@/skins/banking/attach-invoice", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    sendQ2WithInvoice: () => sentQ2(),
    attachInvoiceByHand: () => Promise.resolve(true),
  };
});

import banking from "@/skins/banking/skin";
import {
  EXPENSE_PILL_MESSAGE,
  Q2_REPORT_MESSAGE,
} from "@/skins/banking/suggestions";

const select = (message: string) =>
  banking.onSuggestionSelect?.({ title: "irrelevant", message }, 0);

describe("banking onSuggestionSelect", () => {
  it("claims the Q2 pill and stages the invoice", () => {
    // Claiming it (`true`) means the shell must NOT run its default send. That
    // is only honest because the staged path either sends WITH the file or
    // aborts loudly — never `true` plus silence.
    expect(select(Q2_REPORT_MESSAGE)).toBe(true);
    expect(sentQ2).toHaveBeenCalledTimes(1);
  });

  it("does NOT claim the harness pill — its statement cannot ride as a file part", () => {
    // Re-attaching the CSV here is the regression this exists to catch: it looks
    // right in the composer and fails at the model. If a statement must appear
    // on screen, it has to be a PDF rendering; the harness reads the CSV
    // server-side either way (`harness/csv.ts`).
    expect(select(EXPENSE_PILL_MESSAGE)).toBe(false);
  });

  it("leaves every other pill to the shell's default send", () => {
    // Including a message that merely CONTAINS the intercepted one: equality,
    // not `includes`, or an ordinary question quoting the pill would hijack the
    // composer.
    for (const message of [
      "Show the spending trend.",
      `${Q2_REPORT_MESSAGE} Also, cancel my card.`,
    ]) {
      expect(select(message)).toBe(false);
    }
  });
});
