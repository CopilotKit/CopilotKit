# QA: Tool Rendering (Reasoning Chain) — Claude Agent SDK (Python)

> Stub — authored for column completeness. This is a testing-kind demo
> (see `kind: "testing"` in `showcase/shared/feature-registry.json`) and
> does not warrant a full manual checklist.

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy; `ANTHROPIC_API_KEY` set. The cell uses the shared
  `/api/copilotkit` runtime with agent `tool-rendering-reasoning-chain`,
  mapped to the FastAPI `POST /tool-rendering-reasoning-chain` endpoint
  (`src/agents/tool_rendering_reasoning_chain_agent.py`)

## Test Steps

- [ ] Navigate to /demos/tool-rendering-reasoning-chain
- [ ] Click the "Flights + destination weather" pill ("Find flights from SFO to JFK and show me the weather there.") and verify reasoning blocks interleave with sequential tool cards — `search_flights` → `FlightListCard`, `get_weather` → `WeatherCard`
- [ ] Click "Compare two stocks" or "Chain of dice rolls" and verify the backend-only tools (`get_stock_price`, `roll_dice`) fall through to `CustomCatchallRenderer` via `useDefaultRenderTool`
- [ ] Verify reasoning tokens stream into the custom `ReasoningBlock` slot alongside the tool cards in the same message view

## Expected Results

- Page loads without errors
- Reasoning tokens and tool-call cards render side-by-side in a single sequential chain, each tool matched to its typed renderer
