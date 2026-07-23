# A2UI — Fixed Schema (Built-in Agent)

Declarative Generative UI with a fixed component tree. The frontend authors
the schema (a JSON tree of A2UI components); the in-process tanstack agent
only streams _data_ into the data model via a single `display_flight` tool.

## Pattern

- **Frontend** registers a custom catalog (`Title`, `Airport`, `Arrow`,
  `AirlineBadge`, `PriceTag`, plus a stateful `Button` override) merged with
  the basic A2UI catalog (`Card`, `Column`, `Row`, `Text`).
  See `./a2ui/{catalog,definitions,renderers}.{ts,tsx}`.
- **Backend** (`src/lib/factory/a2ui-fixed-schema-factory.ts`) defines a
  `display_flight` TanStack tool that returns an `a2ui_operations` container
  with three ops: `createSurface`, `updateComponents` (the inlined schema),
  `updateDataModel` (the user's flight values).
- **Runtime** (`src/app/api/copilotkit-a2ui-fixed-schema/route.ts`) enables
  the A2UI middleware with `injectA2UITool: false` — the agent owns its own
  emitter, so the runtime's auto-injected `render_a2ui` tool would only
  duplicate the slot.

## How it differs from `declarative-gen-ui` (dynamic schema)

Dynamic schema lets the LLM emit _any_ component tree it likes from the
registered catalog. Fixed schema pins the tree ahead of time and lets the
LLM only fill in data — strictly typed, predictable, no second LLM call.

## Try it

```text
Find me a flight from SFO to JFK on United for $289.
```

The agent calls `display_flight(...)`, which streams the flight card with
"Book flight" stateful button.

## Reference

- Docs: https://docs.copilotkit.ai/integrations/langgraph/generative-ui/a2ui/fixed-schema
- Source-of-truth: `showcase/integrations/langgraph-python/src/agents/a2ui_fixed.py`
