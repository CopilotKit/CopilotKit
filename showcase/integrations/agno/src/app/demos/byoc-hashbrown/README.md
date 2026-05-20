# BYOC: Hashbrown

## What This Demo Shows

Streaming structured output rendered via `@hashbrownai/react`'s `useUiKit`

- `useJsonParser`. The Agno agent emits a single JSON object shaped like
  the hashbrown UI-kit envelope (`{ "ui": [...] }`), and the frontend
  renderer parses progressively and assembles MetricCard / PieChart /
  BarChart / DealCard / Markdown components from the agent's output.

## Technical Details

- Runtime: `src/app/api/copilotkit-byoc-hashbrown/route.ts` — dedicated
  endpoint, no bleed into the default runtime.
- Agent: `src/agents/byoc_hashbrown_agent.py` — heavy system prompt that
  steers the LLM toward the hashbrown envelope shape.
- Renderer: `hashbrown-renderer.tsx` — registers the kit components and
  swaps CopilotChat's assistant message slot for a hashbrown-rendered
  variant.
