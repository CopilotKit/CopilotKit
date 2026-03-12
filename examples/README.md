# CopilotKit Examples

This directory contains 73 consolidated demo repositories showcasing CopilotKit integrations, canvas apps, showcases, starter templates, and experiments.

Each example is a self-contained project. To get started:

```bash
GIT_LFS_SKIP_SMUDGE=1 git clone <repo-url>
cd examples/<category>/<name>
# Follow the example's own README for setup instructions
```

> **Note:** The `v1/` and `v2/` directories at the top level are legacy workspace examples from earlier CopilotKit releases and are not part of the consolidated demo set.

---

## Integrations (17)

Framework integration starters demonstrating CopilotKit with various agent frameworks.

| Example | Description |
|---------|-------------|
| [langgraph-python](./integrations/langgraph-python/) | Starter template for building AI agents using LangGraph (Python) and CopilotKit |
| [langgraph-js](./integrations/langgraph-js/) | Starter template for building AI agents using LangGraph (JS) with Turborepo monorepo |
| [langgraph-fastapi](./integrations/langgraph-fastapi/) | Starter template for building AI agents using LangGraph with FastAPI and Poetry |
| [mastra](./integrations/mastra/) | Starter template for building AI agents using Mastra and CopilotKit |
| [crewai-flows](./integrations/crewai-flows/) | Starter template for building AI agents using CrewAI Flows (uv-based) |
| [llamaindex](./integrations/llamaindex/) | Starter template with a LlamaIndex investment analyst agent |
| [pydantic-ai](./integrations/pydantic-ai/) | Starter template with a PydanticAI investment analyst agent |
| [ms-agent-framework-python](./integrations/ms-agent-framework-python/) | CopilotKit with Microsoft Agent Framework (Python/FastAPI, AG-UI protocol) |
| [ms-agent-framework-dotnet](./integrations/ms-agent-framework-dotnet/) | CopilotKit with Microsoft Agent Framework (.NET/C#, AG-UI protocol) |
| [strands-python](./integrations/strands-python/) | Starter template with a Strands investment analyst agent |
| [mcp-apps](./integrations/mcp-apps/) | Integration of MCP Apps with CopilotKit using Three.js |
| [adk](./integrations/adk/) | Starter template using Google ADK with an investment analyst agent |
| [agent-spec](./integrations/agent-spec/) | Starter for Agent Spec with A2UI-powered frontend tool rendering |
| [a2a-a2ui](./integrations/a2a-a2ui/) | Starter for A2UI + A2A with a restaurant finder agent (Gemini/ADK) |
| [agno](./integrations/agno/) | Starter template using Agno with an investment analyst agent |
| [crewai-crews](./integrations/crewai-crews/) | Starter template for building AI agents using CrewAI Crews |
| [a2a-middleware](./integrations/a2a-middleware/) | Multi-agent starter with A2A Protocol and AG-UI Protocol (LangGraph + ADK) |

## Canvas (7)

AI-powered canvas applications with visual card interfaces, real-time state sync, and HITL workflows.

| Example | Description |
|---------|-------------|
| [langgraph-python](./canvas/langgraph-python/) | AG-UI canvas starter with LangGraph — interactive cards with real-time AI sync |
| [llamaindex](./canvas/llamaindex/) | AG-UI canvas starter with LlamaIndex — visual cards, multi-step planning, HITL |
| [llamaindex-composio](./canvas/llamaindex-composio/) | Hackathon starter with LlamaIndex, CopilotKit, and Composio (Google Sheets integration) |
| [pydantic-ai](./canvas/pydantic-ai/) | AG-UI canvas starter with PydanticAI — visual cards, planning, HITL |
| [mastra](./canvas/mastra/) | AG-UI canvas starter with Mastra — interactive cards with real-time AI sync |
| [gemini](./canvas/gemini/) | Open Gemini Canvas — post generator and stack analyzer agents (Gemini + LangGraph) |
| [mastra-pm](./canvas/mastra-pm/) | AG-UI + Mastra workshop — shared state, multiple clients, generative UI |

## Showcases (29)

Full-featured demo applications highlighting CopilotKit capabilities in real-world scenarios.

| Example | Description |
|---------|-------------|
| [banking](./showcases/banking/) | Banking app demo with authorization, multiple operations, and generative UI |
| [presentation](./showcases/presentation/) | PowerPoint-like web app built with CopilotKit |
| [deep-agents](./showcases/deep-agents/) | Deep research assistant with planning, memory/files, and generative UI (Tavily) |
| [deep-agents-job-search](./showcases/deep-agents-job-search/) | Job application assistant — resume parsing, skill extraction, DeepAgents orchestration |
| [generative-ui](./showcases/generative-ui/) | Generative UI for agentic apps — AG-UI protocol showcase |
| [generative-ui-playground](./showcases/generative-ui-playground/) | Playground for static GenUI, MCP Apps, and A2UI generative UI types |
| [mcp-apps](./showcases/mcp-apps/) | MCP Apps demo — airline booking, hotel booking, investment simulator, kanban board |
| [research-canvas](./showcases/research-canvas/) | ANA (Agent Native Application) — research canvas with Tavily search and LangGraph |
| [crewai-enterprise](./showcases/crewai-enterprise/) | CopilotKit + CrewAI Enterprise integration |
| [mcp-demo](./showcases/mcp-demo/) | Working Memory — MCP server-client integration for project management (Linear) |
| [agui](./showcases/agui/) | AG-UI protocol demo with LangGraph agent backend |
| [strands-file-analyzer](./showcases/strands-file-analyzer/) | AI-powered document analysis with Strands Agents and Amazon Bedrock |
| [microsoft-kanban](./showcases/microsoft-kanban/) | Kanban board demo with CopilotKit + Microsoft Agent Framework (.NET, AG-UI) |
| [multi-page](./showcases/multi-page/) | Multi-page Remix app with CopilotKit |
| [crm](./showcases/crm/) | CRM app with AI-powered autocompleting email composer |
| [campaign-manager](./showcases/campaign-manager/) | PowerPoint-like campaign management web app |
| [chat-sso](./showcases/chat-sso/) | CopilotKit chat with WorkOS SSO authentication |
| [orca](./showcases/orca/) | Cisco CopilotKit demo — PR and repository analytics dashboard |
| [pydantic-ai-todos](./showcases/pydantic-ai-todos/) | AI-powered todo board with PydanticAI (Todo, In-Progress, Done columns) |
| [scene-creator](./showcases/scene-creator/) | Scene creator with LangGraph + Gemini 3 — AI-generated characters and backgrounds |
| [adk-dashboard](./showcases/adk-dashboard/) | Generative canvas with Google ADK — metrics, charts, and real-time data |
| [langgraph-js-support-agents](./showcases/langgraph-js-support-agents/) | Multi-agent telecom support system with intent, lookup, reply, and escalation agents |
| [multi-agent-canvas](./showcases/multi-agent-canvas/) | Open Multi-Agent Canvas — manage multiple agents (travel, research, MCP) in one chat |
| [chatkit-studio](./showcases/chatkit-studio/) | Open ChatKit Studio — explore and build embeddable chat experiences |
| [enterprise-brex](./showcases/enterprise-brex/) | Enterprise banking demo with authorization, operations, and generative UI |
| [autotale](./showcases/autotale/) | Next.js application with CopilotKit integration |
| [a2a-travel](./showcases/a2a-travel/) | A2A + AG-UI multi-agent travel demo (LangGraph + Google ADK) |
| [spreadsheet](./showcases/spreadsheet/) | AI-powered Excel-like spreadsheet web app |
| [todo](./showcases/todo/) | Simple todo app built with CopilotKit |

## Starters (7)

Minimal starter templates for getting up and running quickly.

| Example | Description |
|---------|-------------|
| [textarea](./starters/textarea/) | Basic Next.js starter with CopilotKit textarea integration |
| [todos-app](./starters/todos-app/) | Basic Next.js starter with CopilotKit todo functionality |
| [coagents-langgraph](./starters/coagents-langgraph/) | CoAgents starter with Python and JavaScript LangGraph agents |
| [coagents-crewai-flows](./starters/coagents-crewai-flows/) | CoAgents starter with CrewAI Flows (Python) |
| [llamaindex-hitl](./starters/llamaindex-hitl/) | Human-in-the-Loop demo with LlamaIndex — essay drafting with accept/reject workflow |
| [enterprise-runner](./starters/enterprise-runner/) | Enterprise runtime with PostgreSQL storage, Redis caching, and agent state recovery |
| [react-vite-agent](./starters/react-vite-agent/) | Agentic incident response platform with React, TypeScript, and CopilotKit |

## Experiments (13)

Experimental and in-progress projects — prototypes, hackathon projects, and internal explorations.

| Example | Description |
|---------|-------------|
| [angular-vnext](./experiments/angular-vnext/) | CopilotKit vnext_experimental Angular demo |
| [v1.50](./experiments/v1.50/) | CloudPlot — AI-powered AWS infrastructure architect with LangGraph |
| [a2ui-private](./experiments/a2ui-private/) | A2UI restaurant finder experiment (Gemini) |
| [llamaindex-composio-hackathon](./experiments/llamaindex-composio-hackathon/) | Full-stack AI story generation with LlamaIndex and Composio |
| [vnext-pydantic](./experiments/vnext-pydantic/) | VNext playground with direct Pydantic AI agent connection |
| [jupyter-notebook](./experiments/jupyter-notebook/) | Jupyter notebook environment for developing LangGraph agents |
| [deep-agent-experiments](./experiments/deep-agent-experiments/) | CopilotKit deep agent integration experiments |
| [crew-flow-ent-dojo](./experiments/crew-flow-ent-dojo/) | Agent Wire Protocol Dojo — interactive demo viewer for CopilotKit agents |
| [crew-flow-cpk-temp](./experiments/crew-flow-cpk-temp/) | CrewAI Flow + CopilotKit temp project |
| [ag2-feature-viewer](./experiments/ag2-feature-viewer/) | Agent Wire Protocol Dojo — demo viewer with dark/light theme support |
| [expo-playground](./experiments/expo-playground/) | Expo (React Native) playground for CopilotKit |
| [find-the-bug](./experiments/find-the-bug/) | CopilotKit debugging exercise / interview challenge |
| [cuddly-fortnight](./experiments/cuddly-fortnight/) | Next.js experimental project |
