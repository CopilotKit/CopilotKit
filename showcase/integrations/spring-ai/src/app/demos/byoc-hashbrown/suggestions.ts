/**
 * Pre-seeded suggestion prompts for the byoc-hashbrown demo on Spring AI.
 *
 * Each prompt is tuned to steer the agent toward emitting hashbrown-shaped
 * structured output that the renderer (MetricCard + PieChart + BarChart)
 * can progressively assemble via `@hashbrownai/react`'s `useUiKit` +
 * `useJsonParser`.
 */
export interface Suggestion {
  label: string;
  prompt: string;
}

export const BYOC_HASHBROWN_SUGGESTIONS: Suggestion[] = [
  {
    label: "Sales dashboard",
    prompt:
      "Show me a Q4 sales dashboard. Include a total-revenue metric card, a pie chart of revenue by segment, and a bar chart of monthly revenue.",
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
