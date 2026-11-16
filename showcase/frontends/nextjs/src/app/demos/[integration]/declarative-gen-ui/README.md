# Declarative Generative UI (A2UI)

## What This Demo Shows

A business question in a plain chat gets a text answer. Here the agent answers with a dashboard instead. It composes A2UI components from a catalog that the page registers.

The agent plays a sales analyst for the fictional company Vantage Threads.

## How to Interact

Click a suggestion, or ask a sales question. For example:

- "Show me my sales dashboard for this quarter."
- "How are our sales reps performing against quota?"
- "Are any accounts or pipeline deals at risk this quarter?"
- "Pull up the details on our biggest account."

## Technical Details

- The catalog is in `../_shared/a2ui-sales-dashboard/`: Zod definitions, React renderers and `createCatalog(...)`. The a2ui-recovery demo uses the same catalog.
- The page gives the catalog to the provider with `<CopilotKit a2ui={{ catalog }}>`. The A2UI middleware puts the catalog schema into the agent's context.
- `useSalesAnalystContext` gives the agent the sales dataset and the composition rules as agent context.
- `page.tsx` is a server component. It loads the integration's settings from `src/integrations/<slug>/demos/declarative-gen-ui.ts` and gives them to `demo.tsx`.
- The settings pick the A2UI protocol of the catalog (`catalogProtocol`) and a format selector (`formatSelector`). google-adk uses protocol 1.0 and the A2UI Express selector.

Reference: https://docs.copilotkit.ai/integrations/langgraph/generative-ui/a2ui
