import type { Suggestion } from "@/shell/skin-contract";

/**
 * The eight banking demo suggestion pills (registered by the shell,
 * available:"always"). Ordered to walk the copilot's capabilities end to end:
 *   1. show a chart
 *   2. change a card PIN (entered in an interactive card IN the chat)
 *   3. ask about the elements on the current screen
 *   4. the 10 most expensive charges (navigate + stack-rank)
 *   5. generate + file the Q2 report
 *   6. apply a preference it ALREADY learned (memory, automatic)
 *   7. handle a suspicious charge via a recalled procedure
 *   8. approve the over-limit AWS charge (learns something NEW)
 *
 * The Q2 report message is matched by string equality to trigger the
 * bundled-invoice staging, so it lives here as `Q2_REPORT_MESSAGE` and the
 * pill below reuses it. `./skin.tsx` imports the same constant for its
 * `onSuggestionSelect` check, so there is exactly ONE copy of the string and
 * the two cannot drift apart. (The shell's shell/chat/demo-suggestions.tsx
 * only delegates to skin.onSuggestionSelect; it knows nothing about Q2.)
 */

/**
 * The Q2 pill's message, shared with `./skin.tsx`. Defined in this data module
 * rather than in the skin so a unit test can import it without pulling the
 * skin's whole client component graph — and so the pill and the matcher are
 * literally the same value.
 */
export const Q2_REPORT_MESSAGE =
  "Prepare a Q2 spend report for the board: summarize spend against budgets, call out anything over limit or pending, and file it as a report.";

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
];
