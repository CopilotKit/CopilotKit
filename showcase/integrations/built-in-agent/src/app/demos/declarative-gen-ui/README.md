# Declarative Generative UI — A2UI Dynamic Schema (Built-in Agent)

Declarative Generative UI where the agent itself designs the component tree
at runtime. Unlike the fixed-schema variant, the LLM emits an arbitrary
A2UI v0.9 schema from the registered catalog every turn.

## Pattern

- **Frontend** registers a custom catalog (`Card`, `StatusBadge`, `Metric`,
  `InfoRow`, `PrimaryButton`, `PieChart`, `BarChart`) merged with the basic
  A2UI catalog. See `./a2ui/{catalog,definitions,renderers}.{ts,tsx}`.
- **Backend** (`src/lib/factory/a2ui-factory.ts`) owns a `generate_a2ui`
  tool. When the primary LLM calls it, the tool fires a _secondary_ LLM
  call (forced JSON-object output) that designs the surface tree and data
  using the registered catalog. The tool wraps the result in an
  `a2ui_operations` container.
- **Runtime** (`src/app/api/copilotkit-declarative-gen-ui/route.ts`) enables
  the A2UI middleware with `injectA2UITool: false` — the agent already owns
  the tool slot. The middleware still serialises the catalog into the
  agent's `input.context` (which the factory pipes into the secondary
  LLM's system prompt) and detects `a2ui_operations` in tool results.

## Why a secondary LLM call?

The primary LLM is small (gpt-4o-mini-class), conversational, and steered
to call `generate_a2ui` whenever a UI would help. A separate, structured
JSON call (gpt-4o, `response_format: json_object`) keeps the schema
generation deterministic and the chat reply short.

## Try it

```text
Show me a quick KPI dashboard with revenue, signups, and churn.
```

```text
Pie chart of sales by region.
```

## Reference

- Docs: https://docs.copilotkit.ai/integrations/langgraph/generative-ui/a2ui
- Source-of-truth: `showcase/integrations/langgraph-typescript/src/agent/a2ui-dynamic.ts`
