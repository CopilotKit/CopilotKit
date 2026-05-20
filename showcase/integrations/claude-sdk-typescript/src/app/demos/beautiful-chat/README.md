# Beautiful Chat

## What This Demo Shows

A polished, brand-themed chat surface running over the Claude Agent SDK backend. Soft radial gradients, a rounded card, blurred backdrop, and three seeded suggestion pills sit on top of the same default `agentic_chat` agent the canonical Agentic Chat demo uses.

This is a deliberately simplified port. The canonical langgraph-python version ships a full canvas (ExampleCanvas, GenerativeUIExamples, an A2UI demonstration catalog with per-tool renderers). Those parts depend on streaming-structured-output primitives the Claude SDK pass-through does not currently expose, so this cell ships the polished chat shell only.

## How to Interact

Try one of the seeded suggestion pills:

- **Plan a 3-day Tokyo trip** — open-ended planning over a real-world itinerary
- **Explain RAG like I'm 12** — pedagogical reasoning with an analogy constraint
- **Draft a launch email** — short structured marketing copy

Or just type a question. The agent is the same one powering Agentic Chat, so it will respond conversationally.

## Technical Details

- **Frontend-only port.** No new agent code. The cell points at the shared `/api/copilotkit` endpoint with `agent="agentic_chat"`.
- **Brand theme.** Inline gradients on the page wrapper, a `bg-white/70 backdrop-blur-sm` card, indigo + mint radial accents.
- **Suggestions.** `useConfigureSuggestions` registers three static suggestion pills with `available: "always"` so they re-appear after each turn.
- **Layout.** A `max-w-3xl` column with a sticky header and a flex-grow chat region.

## Building With This

If you're extending this demo or building something similar:

### Styling Inside the Chat

CopilotKit's chat content (`useRenderTool`, `useHumanInTheLoop`, `useFrontendTool`) renders inside the CopilotKit component tree. Use **inline styles** for any UI rendered inside the chat — Tailwind v4 may purge classes it can't see.

### Brand Theme on the Outside

Anything outside the chat (the page wrapper, the header, the card chrome) is regular Tailwind territory. The pattern here:

- A radial-gradient page background for soft depth
- A rounded card with translucency + backdrop-blur for the chat itself
- Heading typography in `tracking-tight font-semibold`

### Reusing the Default Agent

The polished surface deliberately runs on top of the existing `agentic_chat` agent so there's no duplicated agent wiring. If you want a different model, system prompt, or tool set under this UI, point `agent={...}` at a different registered agent and add a corresponding entry in `src/app/api/copilotkit/route.ts`.

See the full [Styling Guide](https://github.com/CopilotKit/CopilotKit/blob/main/showcase/STYLING-GUIDE.md) for more details.
