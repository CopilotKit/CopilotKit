import type { Suggestion } from "@/shell/skin-contract";

/**
 * The nine banking demo suggestion pills (registered by the shell,
 * available:"always"). Ordered to walk the copilot's capabilities end to end:
 *   1. show a chart
 *   2. change a card PIN (entered in an interactive card IN the chat)
 *   3. ask about the elements on the current screen
 *   4. the 10 most expensive charges (navigate + stack-rank)
 *   5. generate + file the Q2 report
 *   6. apply a preference it ALREADY learned (memory, automatic)
 *   7. handle a suspicious charge via a recalled procedure
 *   8. approve the over-limit AWS charge (learns something NEW)
 *   9. hand it a personal card statement and let a MULTI-MINUTE agentic run
 *      research every merchant and file the reimbursable charges
 *
 * TWO of these messages are matched by STRING EQUALITY rather than by index, so
 * both live here as exported constants and the pills below reuse them:
 *   - `Q2_REPORT_MESSAGE` — `./skin.tsx`'s `onSuggestionSelect` matches it to
 *     stage the bundled invoice attachment and drive the real composer.
 *   - `EXPENSE_PILL_MESSAGE` — the long-running harness beat's router matches it
 *     to route the run at the harness arm rather than the classic agent.
 * Declaring each ONCE means there is no second copy to drift from, and
 * `./suggestions.test.ts` asserts each one is still carried by exactly one pill
 * (nothing else notices a dropped or retitled pill: the matcher would simply
 * never fire and the beat would go missing silently). The shell's
 * shell/chat/demo-suggestions.tsx only delegates to skin.onSuggestionSelect; it
 * knows nothing about either message.
 */

/**
 * The Q2 pill's message, shared with `./skin.tsx`. Defined in this data module
 * rather than in the skin so a unit test can import it without pulling the
 * skin's whole client component graph — and so the pill and the matcher are
 * literally the same value.
 */
export const Q2_REPORT_MESSAGE =
  "Prepare a Q2 spend report for the board: summarize spend against budgets, call out anything over limit or pending, and file it as a report.";

/**
 * The long-running harness pill's message, shared with Arm C's router. Lives
 * here for the same reason `Q2_REPORT_MESSAGE` does: the router matches it by
 * string equality, so there must be exactly one copy of the string in the tree.
 */
export const EXPENSE_PILL_MESSAGE =
  "Here's my personal card statement from the Austin offsite — work out " +
  "which charges are reimbursable and file them.";

export const bankingSuggestions: Suggestion[] = [
  {
    title: "Show the spending trend",
    message: "Show me the spending trend over time.",
  },
  {
    title: "Change my card PIN",
    message: "I want to change the PIN on my Visa card.",
  },
  {
    title: "What's on my screen?",
    message:
      "Look at the page I'm on right now and tell me what's on screen — the key elements and the figures shown.",
  },
  {
    title: "Show me the 10 most expensive charges",
    message: "Show me the 10 most expensive charges.",
  },
  {
    title: "Prep the Q2 spend report",
    message: Q2_REPORT_MESSAGE,
  },
  {
    title: "Summarize our spend",
    message: "Summarize our spend so far.",
  },
  {
    title: "I don't recognize the Delta charge",
    message:
      "I don't recognize the Delta Airlines charge on my card. Handle it.",
  },
  {
    title: "Approve the $15,000 AWS charge",
    message: "Approve the $15,000 AWS charge.",
  },
  {
    title: "Sort out my offsite expenses",
    message: EXPENSE_PILL_MESSAGE,
  },
];
