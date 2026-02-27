<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- You have access to the Nx MCP server and its tools, use them to help the user
- When answering questions about the repository, use the `nx_workspace` tool first to gain an understanding of the workspace architecture where applicable.
- When working in individual projects, use the `nx_project_details` mcp tool to analyze and understand the specific project structure and dependencies
- For questions around nx configuration, best practices or if you're unsure, use the `nx_docs` tool to get relevant, up-to-date docs. Always use this instead of assuming things about nx configuration
- If the user needs help with an Nx configuration or project graph error, use the `nx_workspace` tool to get any errors
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.

<!-- nx configuration end-->

# CopilotKit

AI agent framework with three layers: **Frontend** (React/Angular/Vanilla) → **Runtime** (Express/Hono) → **Agent** (LangGraph/CrewAI/BuiltIn/Custom), communicating via the AG-UI protocol (event-based SSE).

## Essentials

- **Nx monorepo** — always run tasks through `nx` (`nx run`, `nx run-many`, `nx affected`), never the underlying tooling directly.
- **V1 wraps V2** — V2 (`@copilotkitnext/`) is the real implementation. V1 (`@copilotkit/`) is the public compatibility layer that delegates to V2. Build new features in V2 first. Add V1 wrappers only if backward compatibility is needed.
- **Simplicity** — prefer the simplest correct solution. For non-trivial changes, consider if there's a cleaner approach before committing.
- **Worktrees** — always work in a git worktree for isolation. See [Git & PRs](.claude/docs/git.md) for the full workflow.

## Reference (read when relevant to your task)

- [Architecture & Packages](.claude/docs/architecture.md) — V2/V1 package roles, request lifecycle, core concepts (AG-UI, ProxiedAgent, AgentRunner, tools, context, multi-agent)
- [Hook Development](.claude/docs/hooks.md) — checklist for creating new hooks (docs, tests, JSDoc)
- [Workflow & Process](.claude/docs/workflow.md) — when to plan, when to fix autonomously, verification, self-improvement loop, this should be your default mindset when working on any task
- [Git & PRs](.claude/docs/git.md) — worktree workflow, branching, creating PRs
