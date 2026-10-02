import type { Suggestion } from "@/shell/skin-contract";

/**
 * In demo order. 1 fails (no skill yet) and Maya matches the receipts by hand
 * on the Card close board; after a reviewer publishes the learned skill, 2
 * shows it on a different card (Marcus's five) and hands over the review card.
 */
export const ledgerlineSuggestions: Suggestion[] = [
  {
    title: "Match my 6 unmatched card transactions",
    message:
      "Match the 6 unmatched card transactions on Priya Raman's Visa ending 4417 to their receipts for the September close.",
  },
  {
    title: "Match Marcus's unmatched transactions",
    message:
      "Match the unmatched card transactions on Marcus Lee's Visa ending 8820 to their receipts for the September close.",
  },
  {
    title: "What's left for September close?",
    message: "What's left for the September card close?",
  },
];
