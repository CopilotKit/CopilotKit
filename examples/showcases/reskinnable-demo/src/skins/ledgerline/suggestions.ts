import type { Suggestion } from "@/shell/skin-contract";

/**
 * In demo order. 1 fails (no skill yet) and Maya clears the exceptions by hand
 * on the Card close board; after a reviewer publishes the learned skill, 2
 * shows it on a different card (Marcus's four) and hands over the review card.
 */
export const ledgerlineSuggestions: Suggestion[] = [
  {
    title: "Close out Priya's September card",
    message:
      "Close out September for Priya Raman's Visa ending 4417. Receipts are matched; clear the exceptions so it is ready to close.",
  },
  {
    title: "Close out Marcus's September card",
    message:
      "Close out September for Marcus Lee's Visa ending 8820. Receipts are matched; clear the exceptions so it is ready to close.",
  },
  {
    title: "What's left for September close?",
    message: "What's left for the September card close?",
  },
];
