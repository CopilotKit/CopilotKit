/**
 * Pre-seeded suggestion prompts for the byoc-hashbrown demo.
 */
export interface Suggestion {
  label: string;
  prompt: string;
}

export const BYOC_HASHBROWN_SUGGESTIONS: Suggestion[] = [
  {
    label: "Sales dashboard",
    prompt:
      "Show me a Q4 sales dashboard. Include a total-revenue metric card (with trend), a pie chart of revenue by segment, and a bar chart of monthly revenue trend.",
  },
  {
    label: "Revenue by category",
    prompt:
      "Break down Q4 revenue by product category as a pie chart. Include at least four segments with realistic sample values.",
  },
  {
    label: "Expense trend",
    prompt:
      "Show me monthly operating expenses for the last six months as a bar chart with one bar per month.",
  },
];
