# Declarative UI: Hashbrown

## What This Demo Shows

In a chat, charts and metric cards usually appear only after the full answer arrives. With hashbrown, the agent streams its UI as structured JSON. The page renders each component as soon as its part of the JSON arrives.

## How to Interact

Click a suggestion, or ask for a sales view. For example:

- "Sales dashboard": a metric card, a pie chart and a bar chart.
- "Revenue by category": a pie chart.
- "Expense trend": a bar chart.

## Technical Details

- The page body is in `../_shared/hashbrown/`, because the byoc-hashbrown demo shows the same page.
- `HashBrownDashboard` registers the components (metric, pieChart, barChart, dealCard and Markdown) with `useUiKit` from `@hashbrownai/react`.
- The chat replaces its assistant message with `HashBrownRenderMessage`, which parses the stream with `useJsonParser`.
- `page.tsx` holds only the provider: the `declarative-hashbrown` runtime and the `declarative-hashbrown-demo` agent.
