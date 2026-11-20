# Product

## Platform

web

## Stack

TanStack Start (React 19, Vite) for the app and the CopilotKit runtime route. A Python Google ADK agent served over AG-UI. CopilotKit v2 workspace packages from the native generative UI branch (PR #7819). CopilotKit Intelligence (hosted) stores threads.

## Users

People who watch a CopilotKit demo, and the CopilotKit team members who run it: developers and technical buyers who want to see agent-driven generative UI working on real questions. In the demo they ask open research questions ("how has climate change affected us over time?") and read the answer.

## Product Purpose

A calm research desk where an agent answers questions in prose and, when a visual conveys the answer better, renders interface from CopilotKit's standard A2UI catalog: charts, tables, comparisons, forms. Success: a presenter can open the app, ask a natural question, and the audience sees UI appear because the agent judged it useful, then sees the A2UI behind it.

## Positioning

The interface is data. Every rendered surface can be wiped back to the A2UI JSON that produced it, in place, so the audience sees that the agent emitted a declarative description and the app rendered it with its own components and its own handlers.

## Operating Context

Live demos on a laptop or a projected screen, often to a room. Conversations are kept as Intelligence threads so a presenter can return to a prepared thread. The agent runs on Gemini; the presenter can switch models from the chat.

## Capabilities and Constraints

- Generative UI comes only from the agent's own judgment under its system prompt. Prompts in the demo ask research questions, never "render a chart".
- Rendering uses the standard catalog (`standardUI`) from `@copilotkit/react-core/v2/generative-ui`; no bespoke component catalog.
- Buttons the agent generates map to a fixed set of app handlers (save to notes, copy, open source, follow-up and similar).
- Threads: list on the left, each with an icon the agent picked for the conversation.
- Model picker in the chat. Default model for testing is `gemini-3.8-flash`; `gemini-4-argon` is selectable but kept off the default path to control cost.
- The A2UI view is a wipe slider over the rendered surface.
- Generative UI fades in subtly.

## Brand Commitments

- Solarized palette (Ethan Schoonover's sixteen colors), "comfortable": calm, elegant, research friendly, cohesive from the thread list to the generated components.
- Clean and calm to use. Nothing should feel forced or busy.

## Evidence on Hand

No real customer data. Research answers come from the model at demo time; any figures it states are model output and are not verified by the app.

## Product Principles

1. The agent decides when UI helps; the app never forces it.
2. Show the mechanism: the rendered UI and its A2UI are one thing seen two ways.
3. Calm over clever: reading comes first, chrome recedes.
4. One world from edge to edge: the generated components wear the same palette and type as the app around them.

## Accessibility & Inclusion

WCAG AA contrast for text on Solarized grounds (Solarized base tones need care at small sizes). Respect `prefers-reduced-motion` for the fade-in and the slider transition. Keyboard access for the thread list, model picker, and the slider.
