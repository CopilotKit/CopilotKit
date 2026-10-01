import type { Suggestion } from "@/shell/skin-contract";

/**
 * In demo order. 1 fails (no skill yet); after a reviewer publishes the
 * learned skill, 1 succeeds and 2 shows it generalizes to another report.
 */
export const ledgerlineSuggestions: Suggestion[] = [
  {
    title: "Approve Priya's offsite report",
    message:
      "Approve Priya Raman's Q3 team offsite expense report and reimburse her.",
  },
  {
    title: "Approve Marcus's summit dinner",
    message:
      "Approve Marcus Lee's platform team summit dinner report and reimburse him.",
  },
  {
    title: "What's waiting on me?",
    message: "Which expense reports are waiting for my approval?",
  },
];
