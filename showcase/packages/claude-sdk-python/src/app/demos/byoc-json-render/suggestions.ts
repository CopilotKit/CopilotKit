/**
 * Suggestion prompts for the byoc-json-render demo.
 *
 * These match the byoc-hashbrown demo's prompts verbatim so the two
 * demos can be compared side-by-side.
 */

export interface Suggestion {
  /** Short label shown on the pill. */
  label: string;
  /** Full prompt text sent to the agent when the pill is clicked. */
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
