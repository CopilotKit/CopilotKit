---
name: copilotkit
description: Use when building with CopilotKit — setup, development, integrations, debugging, upgrading, or contributing. Routes to the appropriate specialized skill based on the task.
user_invocable: true
argument_hint: "<task>"
---

Route to the appropriate sub-skill based on the user's task. If the task is ambiguous, ask one clarifying question before routing.

## Quickstart (default path)

If the user wants to add CopilotKit to their project, or the request is general/unclear, route here:

**[copilotkit-setup](skills/copilotkit-setup/SKILL.md)** — Install packages, configure the runtime, wire up the provider, get a working chat UI.

## Routing Table

| Task | Sub-skill |
|------|-----------|
| Initial setup, installation, adding CopilotKit to a project | [copilotkit-setup](skills/copilotkit-setup/SKILL.md) |
| Building features — frontend tools, shared state, generative UI, actions | [copilotkit-develop](skills/copilotkit-develop/SKILL.md) |
| Connecting agent frameworks — LangGraph, CrewAI, Mastra, Pydantic AI, etc. | [copilotkit-integrations](skills/copilotkit-integrations/SKILL.md) |
| Debugging errors, fixing runtime issues, troubleshooting | [copilotkit-debug](skills/copilotkit-debug/SKILL.md) |
| Upgrading versions, migrating between APIs | [copilotkit-upgrade](skills/copilotkit-upgrade/SKILL.md) |
| AG-UI protocol — building custom backends, event streaming, debugging protocol issues | [copilotkit-agui](skills/copilotkit-agui/SKILL.md) |
| Contributing to the CopilotKit repo | [copilotkit-contribute](skills/copilotkit-contribute/SKILL.md) |
| Update/refresh these skills, skills seem stale or wrong | [copilotkit-self-update](skills/copilotkit-self-update/SKILL.md) |

## MCP Documentation Server

The `copilotkit-docs` MCP server at `mcp.copilotkit.ai/mcp` provides live documentation search. Use its tools for up-to-date reference material:

- `search-docs` — search CopilotKit documentation by topic
- `search-code` — search CopilotKit source code and examples
- `search-ag-ui-docs` — search AG-UI protocol documentation
- `search-ag-ui-code` — search AG-UI TypeScript SDK source

Prefer MCP lookups over hardcoded knowledge when answering specific API or configuration questions.
