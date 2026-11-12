# CopilotKit Examples

This directory contains 64 examples, grouped by what you want to do with them:

- **[Starters](#starters-26)** — pick your agent framework and start building.
- **[Demos](#demos-33)** — full applications that show CopilotKit in a real-world scenario.
- **[Templates](#templates-5)** — pick a surface or use case (Slack, Teams, Flutter, a shop, a custom chat UI) and start from there.
- **[Dev](#dev)** — small apps the CopilotKit team uses to develop and test the packages in this repo.

Each example is a self-contained project. To get started:

```bash
GIT_LFS_SKIP_SMUDGE=1 git clone https://github.com/CopilotKit/CopilotKit.git
cd CopilotKit/examples/<category>/<name>
# Follow the example's own README for setup instructions
```

Starters, demos, and the `shadcn` and `claude-managed-agents-flutter` templates install published `@copilotkit/*` packages from npm, so each one runs on its own. The other templates, the `generative-ui-playground` demo, and every app under `dev/` are members of the repo's pnpm workspace and build against the local packages.

---

## Starters (26)

Framework starters demonstrating CopilotKit with each supported agent framework. Starter parity tooling lives in [`starters/_parity/`](./starters/_parity/).

| Example                                                            | Description                                                                          |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| [langgraph-python](./starters/langgraph-python/)                   | Starter template for building AI agents using LangGraph (Python) and CopilotKit      |
| [langgraph-js](./starters/langgraph-js/)                           | Starter template for building AI agents using LangGraph (JS) with Turborepo monorepo |
| [langgraph-fastapi](./starters/langgraph-fastapi/)                 | Starter template for building AI agents using LangGraph with FastAPI and Poetry      |
| [mastra](./starters/mastra/)                                       | Starter template for building AI agents using Mastra and CopilotKit                  |
| [crewai-flows](./starters/crewai-flows/)                           | Starter template for building AI agents using CrewAI Flows (uv-based)                |
| [crewai-crews](./starters/crewai-crews/)                           | Starter template for building AI agents using CrewAI Crews                           |
| [llamaindex](./starters/llamaindex/)                               | Starter template with a LlamaIndex investment analyst agent                          |
| [pydantic-ai](./starters/pydantic-ai/)                             | Starter template with a PydanticAI investment analyst agent                          |
| [openai-agents-python](./starters/openai-agents-python/)           | Starter template using the OpenAI Agents SDK (Python) with a proverbs agent          |
| [ms-agent-framework-python](./starters/ms-agent-framework-python/) | CopilotKit with Microsoft Agent Framework (Python/FastAPI, AG-UI protocol)           |
| [ms-agent-framework-dotnet](./starters/ms-agent-framework-dotnet/) | CopilotKit with Microsoft Agent Framework (.NET/C#, AG-UI protocol)                  |
| [strands-python](./starters/strands-python/)                       | Starter template with a Strands investment analyst agent                             |
| [strands-typescript](./starters/strands-typescript/)               | Starter template using AWS Strands (TypeScript), AG-UI, and CopilotKit               |
| [mcp-apps](./starters/mcp-apps/)                                   | Integration of MCP Apps with CopilotKit using Three.js                               |
| [adk](./starters/adk/)                                             | Starter template using Google ADK with an investment analyst agent                   |
| [adk-angular](./starters/adk-angular/)                             | Angular starter with a Node runtime and Python Google ADK agent                      |
| [antigravity](./starters/antigravity/)                             | Starter template using Google Antigravity with an AG-UI FastAPI agent                |
| [agentcore](./starters/agentcore/)                                 | AWS Bedrock AgentCore starter with LangGraph or Strands and generative UI            |
| [agent-spec](./starters/agent-spec/)                               | Starter for Agent Spec with A2UI-powered frontend tool rendering                     |
| [a2a-a2ui](./starters/a2a-a2ui/)                                   | Starter for A2UI + A2A with a restaurant finder agent (Gemini/ADK)                   |
| [agno](./starters/agno/)                                           | Starter template using Agno with an investment analyst agent                         |
| [a2a-middleware](./starters/a2a-middleware/)                       | Multi-agent starter with A2A Protocol and AG-UI Protocol (LangGraph + ADK)           |
| [claude-sdk-python](./starters/claude-sdk-python/)                 | Starter template using the Claude Agent SDK (Python) and CopilotKit                  |
| [claude-sdk-typescript](./starters/claude-sdk-typescript/)         | Starter template using the Claude Agent SDK (TypeScript) and CopilotKit              |
| [claude-managed-agents](./starters/claude-managed-agents/)         | Beautiful Chat starter with Claude Managed Agents and Intelligence Skills            |
| [omnara](./starters/omnara/)                                       | Beautiful Chat starter with Omnara agents and Intelligence threads                   |

## Demos (33)

Full-featured demo applications highlighting CopilotKit capabilities in real-world scenarios.

### Current demos (25)

| Example                                                             | Description                                                                                                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| [a2ui-pdf-analyst](./demos/a2ui-pdf-analyst/)                       | PDF analyst that builds fixed or dynamic A2UI surfaces from document data                                           |
| [a2ui-playground](./demos/a2ui-playground/)                         | Chat-first A2UI 1.0 playground: watch Gemini write Express line by line, with macros, skills and evals              |
| [arcade-tools](./demos/arcade-tools/)                               | Built-in Agent with authenticated Arcade Gmail and news tools plus inline OAuth UI                                  |
| [claude-managed-agents](./demos/claude-managed-agents/)             | Hosted Claude Managed Agent over AG-UI with an interactive growth chart                                             |
| [daytona-runcode](./demos/daytona-runcode/)                         | Built-in Agent that runs Python, TypeScript, and JavaScript in isolated Daytona sandboxes                           |
| [reskinnable-demo](./demos/reskinnable-demo/)                       | Runtime-reskinnable demo — banking and airline skins over one shell, agent and all                                  |
| [presentation](./demos/presentation/)                               | PowerPoint-like web app built with CopilotKit                                                                       |
| [deep-agents-finance-erp](./demos/deep-agents-finance-erp/)         | Finance ERP assistant with multi-agent analysis, dashboards, and HITL approvals                                     |
| [deep-agents-job-search](./demos/deep-agents-job-search/)           | Job application assistant — resume parsing, skill extraction, DeepAgents orchestration                              |
| [generative-ui](./demos/generative-ui/)                             | Generative UI for agentic apps — AG-UI protocol guide (README, diagrams, and PDF)                                   |
| [grok-generative-ui](./demos/grok-generative-ui/)                   | grok-4.6 searches X server-side, then composes the dashboard from real components                                   |
| [research-canvas](./demos/research-canvas/)                         | ANA (Agent Native Application) — research canvas with Tavily search and LangGraph                                   |
| [multi-page](./demos/multi-page/)                                   | Multi-page Remix app with CopilotKit                                                                                |
| [open-mcp-client](./demos/open-mcp-client/)                         | MCP App builder that uses Mastra to provision E2B sandboxes                                                         |
| [oracle-agent-memory](./demos/oracle-agent-memory/)                 | Travel concierge with Agent Spec, Oracle Agent Memory, generative UI, and HITL                                      |
| [orca](./demos/orca/)                                               | Cisco CopilotKit demo — PR and repository analytics dashboard                                                       |
| [pydantic-ai-todos](./demos/pydantic-ai-todos/)                     | AI-powered todo board with PydanticAI (Todo, In-Progress, Done columns)                                             |
| [adk-dashboard](./demos/adk-dashboard/)                             | Generative canvas with Google ADK — metrics, charts, and real-time data                                             |
| [langgraph-js-support-agents](./demos/langgraph-js-support-agents/) | Multi-agent telecom support system with intent, lookup, reply, and escalation agents                                |
| [enterprise-brex](./demos/enterprise-brex/)                         | Enterprise banking demo with authorization, operations, and generative UI                                           |
| [spreadsheet](./demos/spreadsheet/)                                 | AI-powered Excel-like spreadsheet web app                                                                           |
| [todo](./demos/todo/)                                               | Simple todo app built with CopilotKit                                                                               |
| [strands-crm](./demos/strands-crm/)                                 | Enterprise sales CRM — dashboard, pipeline, products, quotes, reports & agentic canvas (TypeScript Strands + AG-UI) |
| [manufact-mcp-apps](./demos/manufact-mcp-apps/)                     | Built-in Agent rendering an MCP App built with Manufact's mcp-use SDK (inline Leaflet map)                          |
| [antigravity-repo-doctor](./demos/antigravity-repo-doctor/)         | Google Antigravity agent that fixes failing CI and proves the fix, with approval cards, a diff card and A2UI tests  |

### Retired hosted demos (8)

These legacy demos are being retired from the hosted demo catalog. Their source remains available for historical reference and local use. A source link below does not imply a maintained live deployment.

| Source                                                        | Description                                                                        |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [deep-agents](./demos/deep-agents/)                           | Deep research assistant with planning, memory/files, and generative UI (Tavily)    |
| [generative-ui-playground](./demos/generative-ui-playground/) | Playground for static GenUI, MCP Apps, and A2UI generative UI types                |
| [mcp-apps](./demos/mcp-apps/)                                 | MCP Apps demo — airline booking, hotel booking, investment simulator, kanban board |
| [strands-file-analyzer](./demos/strands-file-analyzer/)       | AI-powered document analysis with Strands Agents and Amazon Bedrock                |
| [microsoft-kanban](./demos/microsoft-kanban/)                 | Kanban board demo with CopilotKit + Microsoft Agent Framework (.NET, AG-UI)        |
| [scene-creator](./demos/scene-creator/)                       | Scene creator with LangGraph + Gemini 3 — AI-generated characters and backgrounds  |
| [chatkit-studio](./demos/chatkit-studio/)                     | Open ChatKit Studio — explore and build embeddable chat experiences                |
| [a2a-travel](./demos/a2a-travel/)                             | A2A + AG-UI multi-agent travel demo (LangGraph + Google ADK)                       |

## Templates (5)

Starting points organized by surface or use case rather than by agent framework.

| Example                                                                     | Description                                                                                    |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [claude-managed-agents-flutter](./templates/claude-managed-agents-flutter/) | Flutter chat app with a local Node runtime, Claude Managed Agents, and CopilotKit Intelligence |
| [generative-ui-shop](./templates/generative-ui-shop/)                       | React Router shop whose assistant renders products into areas of the page, outside the chat    |
| [shadcn](./templates/shadcn/)                                               | Custom CopilotKit chat UI built with ShadCN-style primitives, a frontend tool, and HITL        |
| [slack](./templates/slack/)                                                 | `@copilotkit/channels` on-call triage bot for Slack, Discord, and WhatsApp                     |
| [teams](./templates/teams/)                                                 | `@copilotkit/channels` Microsoft Teams bot backed by a CopilotKit Built-in Agent               |

## Dev

Apps the CopilotKit team uses to develop and test the packages in this repo. Each one is a pnpm workspace member that builds against the local packages, so run `pnpm install` and `pnpm build` from the repo root first.

### By frontend (5)

| Example                                         | Description                                                                            |
| ----------------------------------------------- | -------------------------------------------------------------------------------------- |
| [angular](./dev/by-frontend/angular/)           | Angular demo app, its demo server, and the Angular Storybook                           |
| [react](./dev/by-frontend/react/)               | React demo app (chat, popup, sidebar, generative UI, MCP Apps) and the React Storybook |
| [react-native](./dev/by-frontend/react-native/) | React Native demo app                                                                  |
| [react-router](./dev/by-frontend/react-router/) | React Router (framework mode) app                                                      |
| [vue](./dev/by-frontend/vue/)                   | Vue demo app, the Vue Storybook, and the Vite inspector plugin playground              |

### By backend (8)

| Example                                                  | Description                                                 |
| -------------------------------------------------------- | ----------------------------------------------------------- |
| [cf-workers](./dev/by-backend/cf-workers/)               | CopilotKit runtime on Cloudflare Workers                    |
| [deno](./dev/by-backend/deno/)                           | CopilotKit runtime on Deno                                  |
| [elysia](./dev/by-backend/elysia/)                       | CopilotKit runtime on Elysia                                |
| [express](./dev/by-backend/express/)                     | CopilotKit runtime on Express                               |
| [hono](./dev/by-backend/hono/)                           | CopilotKit runtime on Hono                                  |
| [next-pages-router](./dev/by-backend/next-pages-router/) | Minimal Next.js Pages Router client for the Express runtime |
| [node](./dev/by-backend/node/)                           | CopilotKit runtime on a plain Node.js `http` server         |
| [node-express](./dev/by-backend/node-express/)           | CopilotKit runtime on Express with a server-side tool       |

### By feature (1)

| Example                                          | Description                                                                  |
| ------------------------------------------------ | ---------------------------------------------------------------------------- |
| [a2ui-markdown](./dev/by-feature/a2ui-markdown/) | Next.js app where the agent renders interactive A2UI surfaces inline in chat |

### End-to-end tests

[`dev/e2e/`](./dev/e2e/) is a Playwright harness that boots one dev app at a time and runs its smoke specs. See its [AGENTS.md](./dev/e2e/AGENTS.md).
