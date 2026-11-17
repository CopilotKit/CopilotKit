# A2UI Fixed Schema

## What This Demo Shows

Some UI has a fixed design, and only its data changes. Here the component tree of a flight card is authored ahead of time. The agent streams only the flight data into the A2UI data model, and the catalog renders the card.

## How to Interact

1. Click the suggestion "Find SFO → JFK".
2. Look at the flight card: the route, the airline and the price come from the agent.
3. Click "Book flight". The button sends its A2UI action to the agent and changes to "Booked".

## Technical Details

- `a2ui/definitions.ts` declares the custom components with Zod schemas. A prop that the schema binds to a data-model path accepts a string or `{ path }`.
- `a2ui/renderers.tsx` renders the components with the primitives in `_components/`.
- `a2ui/catalog.ts` builds the catalog with `includeBasicCatalog: true`. The page gives it to `<CopilotKit a2ui={{ catalog }}>`.
- The authored flight schema is part of each agent backend, not of this folder.
- `page.tsx` loads the integration's settings from `src/integrations/<slug>/demos/a2ui-fixed-schema.ts`. google-adk sets `formatSelector: "template"`, so the page shows an A2UI Express or Direct JSON selector.

Reference: https://docs.copilotkit.ai/integrations/langgraph/generative-ui/a2ui/fixed-schema
