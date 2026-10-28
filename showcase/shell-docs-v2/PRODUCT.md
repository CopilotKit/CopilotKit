# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **App developers** adding CopilotKit to an application. They work in one of several frontends (React, Angular, Vue, React Native, or the Slack and Microsoft Teams channels) and connect one of many agent backends (LangGraph, Mastra, CrewAI, PydanticAI, Google ADK, LlamaIndex, Agno, AWS Strands, Microsoft Agent Framework, AG2, the built-in agent, and others). Their job: get a working integration fast, then find the exact API, pattern, or fix they need while building.
- **AI coding agents** (Claude Code, Codex, Cursor, and similar) acting for those developers. They are first-class readers: they consume `llms.txt`, `llms-full.txt`, per-page markdown, and copy-to-agent prompts, and the docs must give them complete, correct, current instructions.
- **Intelligence evaluators**: teams and enterprise buyers deciding whether to adopt CopilotKit Intelligence (persistent threads, memory, learning) for production.

## Product Purpose

shell-docs-v2 is the from-scratch rebuild of docs.copilotkit.ai on the latest Fumadocs. It is a full replacement: once it reaches parity it takes over docs.copilotkit.ai, including the showcase-driven per-framework pages, the framework selector, and live demos. Success means a developer (or their coding agent) on any supported frontend and agent framework reaches a working integration and can find the next answer without leaving the docs.

## Positioning

CopilotKit is the enterprise agentic frontend stack for connecting any agent to any user: the layer between agents and their users across web, mobile, and team chat. CopilotKit is the company behind the AG-UI protocol. Its docs show features running live against the supported agent frameworks, using the same showcase code the showcase tests exercise.

## Operating Context

- Developers read the docs next to their editor and terminal, often while a coding agent works in the same repo; copy-paste commands, code, and agent prompts are part of the workflow.
- Docs pages are scoped by framework: the same feature is documented per agent backend and frontend, and readers switch frameworks without losing their place.
- Live demos and code samples come from the showcase (`showcase/integrations`, `showcase/shared`) and its generated registry, so a demo in the docs is the same code that the showcase tests exercise.
- AG-UI protocol docs are authored upstream in `ag-ui-protocol/ag-ui`, not here.

## Capabilities and Constraints

- **Fumadocs compliance is binding.** The site is built on stock Fumadocs (`fumadocs-core`, `fumadocs-ui` via `@fumadocs/base-ui`, `fumadocs-mdx`) and must stay upgradeable with minimal rewriting. Branding goes through Fumadocs' supported theming surface (its CSS variables, presets, layout options, and component props), not through forks, replacements, or overrides of Fumadocs components and behavior. Prefer Fumadocs' built-in components (Cards, Tabs, Callouts, Steps, TOC, search, page actions) over custom equivalents.
- Standalone npm app at `showcase/shell-docs-v2`, outside the pnpm workspace; dev server on port 3004.
- Ships Fumadocs' built-in Orama search, generated OG images, `llms.txt` / `llms-full.txt`, markdown negotiation (`*.md` URLs and `Accept: text/markdown`), an MCP server at `/api/mcp`, and an "Ask AI" chat built on CopilotKit, scoped to CopilotKit and AG-UI questions.
- To reach parity it must carry over from `showcase/shell-docs`: the showcase-driven per-framework docs, the framework selector, live demos, and the existing content in `showcase/shell-docs/src/content`.
- Not yet deployed or wired into CI; `showcase/shell-docs` still serves docs.copilotkit.ai.
- **Agent backends get their own URLs** (e.g. a Mastra section under its own path). Required for co-marketing with each framework partner.
- **Every agent backend is first-class to some degree.** How complete each one is comes from the showcase D6 results, not from a hand-kept tier list.
- **Frontends:** React, Vue, and React Native are fully functional, first-class frontends. React SPA is not a separate frontend; its content folds into the React docs. Angular stays. Slack and Teams are channels.
- **Intelligence** gets its own section, and its features are also spliced into the normal docs where they add value, so readers discover them in context.
- Undecided: URL structure (docs at `/` versus `/docs`), redirect strategy from current URLs, and the parity cut-over criteria.

## Brand Commitments

- The copilotkit.ai website ([CopilotKit/website](https://github.com/CopilotKit/website)) is the binding brand source: its official logo, type system, and design tokens are the identity of record. The docs must read as the same brand as copilotkit.ai.
- The website's own brand record applies: calm, technical, and precise; quiet delight from useful interaction feedback, not decoration; avoid generic AI-purple SaaS templates, dark terminal cosplay, noisy layouts, and vague claims.
- Product names: CopilotKit, CopilotKit Intelligence, AG-UI.
- **Content on white, chrome on the website's lilac-grey** (set by the docs owner, October 27 2026): everything a reader reads (the docs panel, the home page, cards, code) sits on white in light mode and ink in dark mode. The docs frame around the panel (sidebar, gutters, phone header) and the trays that hold card grids and menus take the website's own page color, `#ededf5` (`--new-background`). Brand color (lilac, mint) carries actions, state, wayfinding, and live moments on marks, never as a reading background. The only gradients are the website's own: its protocol-map stage around demos and card trays, and its lilac-to-mint accent on the home headline.
- Layout follows fumadocs.dev: Fumadocs' Spacious layout.

## Evidence on Hand

- Current docs content: `showcase/shell-docs/src/content` (docs, framework overviews, reference, snippets).
- Live demos and source: `showcase/integrations/*`, `showcase/shared`, and the generated showcase registry.
- Brand assets: CopilotKit mark in `src/components/copilotkit-mark.tsx` and `src/app/favicon.ico`; framework and partner logos in `showcase/shell-docs/public/logos`; product imagery in `showcase/shell-docs/public/images`; fonts and tokens in the CopilotKit/website repo.
- No usage statistics, testimonials, or customer quotes are recorded here; don't invent them.

## Product Principles

1. Working code first: every path leads to something the reader can run, and demos are the real showcase code.
2. Two kinds of reader: everything a human can read, a coding agent can fetch as complete, correct markdown.
3. One feature, every framework: readers on any supported frontend or agent backend get the same depth, and switching frameworks keeps their place.
4. Stay on Fumadocs: brand it through its supported theming surface so upgrades stay cheap and its accessibility, search, and navigation keep working.
5. One brand: the docs look and sound like copilotkit.ai.

## Accessibility & Inclusion

Matches the copilotkit.ai standard: WCAG AA contrast, visible focus states, semantic controls, keyboard operation, 44px touch targets, readable text at narrow widths, and reduced-motion alternatives for non-essential animation.
