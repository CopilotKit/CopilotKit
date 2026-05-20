/**
 * Suggestion prompts for the byoc-json-render demo. Matches the
 * langgraph-python reference verbatim so the two showcases can be
 * compared side-by-side.
 */

export interface Suggestion {
  label: string;
  prompt: string;
}

export const BYOC_JSON_RENDER_SUGGESTIONS: Suggestion[] = [
  {
    label: "Sales dashboard",
    prompt: "Show me the sales dashboard with metrics and a revenue chart",
  },
  {
    label: "Revenue by category",
    prompt: "Break down revenue by category as a pie chart",
  },
  {
    label: "Expense trend",
    prompt: "Show me monthly expenses as a bar chart",
  },
];
