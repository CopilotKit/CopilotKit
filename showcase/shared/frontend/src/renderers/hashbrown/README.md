# HashBrown Renderer Adapter

## How it works

HashBrown is a structured-output rendering library. Instead of the agent returning
free-form text or calling tools to emit UI, the agent's entire response is
constrained to a JSON schema derived from a **UI kit**.

### Flow

1. **Kit definition** -- `useSalesDashboardKit()` registers components (MetricCard,
   PieChart, BarChart, DealCard) and `Markdown` with `useUiKit`. Each component
   declares its props using HashBrown's `s` schema builder.

2. **Schema forwarding** -- The kit's schema is converted to JSON Schema via
   `s.toJsonSchema(kit.schema)` and forwarded to the agent through
   `useAgentContext({ description: "output_schema", value: ... })`. The agent
   runtime uses this to set `response_format`, forcing the LLM to produce valid
   structured output.

3. **Streaming parse** -- As the agent streams its response, `useJsonParser`
   incrementally parses the JSON. Components render progressively -- arrays
   declared with `s.streaming.array` populate items as they arrive.

4. **Render** -- `kit.render(value)` maps the parsed JSON tree to React components.

### Markdown escape hatch

The kit includes `exposeMarkdown()`, which lets the agent emit free-form text
alongside structured components. The agent wraps text in a `<Markdown>` node
within the JSON structure, and HashBrown renders it as rich Markdown.

### Constraint level

This approach has a **high** constraint level: the agent can only produce output
that matches the registered component schemas. This eliminates layout
hallucinations and guarantees type-safe props at render time.

## Usage

```tsx
import {
  HashBrownDashboard,
  useHashBrownMessageRenderer,
} from "./renderers/hashbrown";

function App() {
  const RenderMessage = useHashBrownMessageRenderer();

  return (
    <HashBrownDashboard>
      <CopilotChat RenderMessage={RenderMessage} />
    </HashBrownDashboard>
  );
}
```
