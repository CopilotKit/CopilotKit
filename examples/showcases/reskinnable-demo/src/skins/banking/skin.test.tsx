/**
 * WHICH PILLS BANKING INTERCEPTS.
 *
 * Two of the nine ride a real file into the composer, and both are matched by
 * STRING EQUALITY inside `onSuggestionSelect`. The failure this guards is the
 * quiet one: an interception that stops firing does not throw, does not fail a
 * type-check and does not fail any other test — the pill simply falls through to
 * the shell's default send, the prompt goes out with no attachment, and the
 * model answers about a document nobody gave it.
 *
 * `suggestions.test.ts` guards the other half (that a pill carrying each
 * constant is still in the catalog). Together they close the loop: the constant
 * exists on a pill, and the pill is routed to its file.
 */
import { describe, expect, it, vi } from "vitest";

// The real sends drive the LIVE composer through `@/shell/attach` — they locate
// a textarea, stage bytes into a hidden input, click send, and report every
// failure through `window.alert`. None of that exists here, and these assertions
// are about WHICH pill is intercepted, not about that chain (which
// `shell/attach/stage-attachment.test.ts` owns end to end).
const sentQ2 = vi.fn(() => Promise.resolve(true));
const sentStatement = vi.fn(() => Promise.resolve(true));

vi.mock("@/skins/banking/attach-invoice", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    sendQ2WithInvoice: () => sentQ2(),
    attachInvoiceByHand: () => Promise.resolve(true),
  };
});

// `importOriginal` keeps the REAL module constants, so a pill whose text drifts
// from them still fails this file. Only the DOM-driving functions are replaced.
vi.mock("@/skins/banking/attach-statement", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    sendExpensesWithStatement: () => sentStatement(),
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
    expect(select(Q2_REPORT_MESSAGE)).toBe(true);
    expect(sentQ2).toHaveBeenCalledTimes(1);
    expect(sentStatement).not.toHaveBeenCalled();
  });

  it("claims the expense pill and stages the statement", () => {
    // Claiming it (`true`) means the shell must NOT run its default send. That
    // is only honest because the staged path either sends WITH the file or
    // aborts loudly — never `true` plus silence.
    expect(select(EXPENSE_PILL_MESSAGE)).toBe(true);
    expect(sentStatement).toHaveBeenCalledTimes(1);
  });

  it("leaves every other pill to the shell's default send", () => {
    // Including a message that merely CONTAINS an intercepted one: equality, not
    // `includes`, or an ordinary question quoting the pill would hijack the
    // composer.
    for (const message of [
      "Show the spending trend.",
      `Why did "${EXPENSE_PILL_MESSAGE}" fail last time?`,
      `${Q2_REPORT_MESSAGE} Also, cancel my card.`,
    ]) {
      expect(select(message)).toBe(false);
    }
  });

  it("routes each intercepted pill to its OWN file, not just to some file", () => {
    // The two interceptions sit in one `if`/`if` chain and are one copy-paste
    // apart from both calling the same sender — which would attach a PDF for the
    // statement beat and look almost right on stage.
    sentQ2.mockClear();
    sentStatement.mockClear();
    select(EXPENSE_PILL_MESSAGE);
    expect(sentQ2).not.toHaveBeenCalled();
    expect(sentStatement).toHaveBeenCalledTimes(1);
  });
});
