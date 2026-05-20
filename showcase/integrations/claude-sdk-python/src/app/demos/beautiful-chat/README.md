# Beautiful Chat

## What This Demo Shows

A polished, brand-themed chat surface built on top of the shared Claude Agent SDK backend. It demonstrates how far you can take the look-and-feel of a CopilotKit chat with **pure frontend dressing** — no extra runtime config, no special agent, no declarative-generative-ui catalog.

## How to Interact

- Pick one of the seeded suggestion pills ("Plan a 3-day Tokyo trip", "Explain RAG like I'm 12", "Draft a launch email"), or type your own prompt.
- The right-side panel is a static decorative read-out (a sparkline + intent breakdown). It does not react to chat traffic — it's there to show how a flagship chat cell can sit alongside ambient app UI.

## Technical Details

- **Runtime**: this cell uses the shared `/api/copilotkit` endpoint. The agent ID `beautiful-chat` is registered alongside the other shared-agent names (`agentic_chat`, `tool-rendering`, etc.) in `src/app/api/copilotkit/route.ts`.
- **Backend**: the same default Claude agent the agentic-chat cell uses (`src/agents/agent.py`). No bespoke prompt or tools.
- **Cosmetic layer**: lives entirely in `page.tsx` — gradient background, brand fonts (Inter), seeded `useConfigureSuggestions`, and a hand-rolled SVG side panel.

## Simplified vs Canonical

The langgraph-python version of this demo ships a much larger surface — `ExampleCanvas`, `useGenerativeUIExamples`, an A2UI declarative-generative-ui catalog of charts and cards that the agent can drive directly. Those features depend on streaming-structured-output primitives (A2UI tool envelope, dynamic schema injection) that the claude-sdk-python integration does not currently expose to the showcase.

This port keeps the polished chat shell and treats the dynamic canvas as out-of-scope. If you want the full version, see the langgraph-python `beautiful-chat` cell.

## Building With This

If you're building a real product chat surface, this is a good template:

1. Pick the agent backend you actually want.
2. Add a layout-level wrapper around `<CopilotChat />` with your brand background, max-width, and rounded card chrome.
3. Seed `useConfigureSuggestions` with the prompts that match your domain.
4. Decorate the rest of the page with whatever ambient UI makes sense — the chat surface is fully self-contained and won't fight your layout.
