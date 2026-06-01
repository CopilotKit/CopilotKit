# QA: Tool Rendering (Reasoning Chain) — LangGraph (Python)

> Stub — authored for column completeness. This is a testing-kind demo
> (see `kind: "testing"` in feature-registry.json) and does not warrant a
> full manual checklist.

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy

## Test Steps

- [ ] Navigate to /demos/tool-rendering-reasoning-chain
- [ ] Send a multi-tool prompt (e.g. "What's the weather in Tokyo?") and verify reasoning blocks interleave with sequential tool cards (`WeatherCard`, `FlightListCard`, or the custom catchall)
- [ ] Verify reasoning tokens stream into the custom `ReasoningBlock` slot alongside the tool cards in the same message view

## Expected Results

- Page loads without errors
- Reasoning tokens and tool-call cards render side-by-side in a single sequential chain, each tool matched to its typed renderer
