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
- **Flat package structure** — All packages live under `packages/` with the `@copilotkit/` scope. Some packages have `v1/` and `v2/` internal directories for backward compatibility, but they're a single published package.
- **Simplicity** — prefer the simplest correct solution. For non-trivial changes, consider if there's a cleaner approach before committing.
- **Worktrees** — always work in a git worktree for isolation. See [Git & PRs](.claude/docs/git.md) for the full workflow.

## Private Agent Instructions

Individual developers may optionally create a `private-agents.md` file at the repo root. This file is gitignored and not shared with the team -- it contains personal agent instructions, workflow overrides, or context that applies only to that developer's work. If `private-agents.md` exists, read it and follow its instructions (they take precedence over the defaults in this file where they conflict).

## Internal Skills

The team maintains shared AI agent skills at [CopilotKit/internal-skills](https://github.com/CopilotKit/internal-skills). If installed as a Claude Code plugin, these skills are available automatically. Key skills relevant to this repo:

- **copilotkit-ui-theme** — CopilotCloud visual design system (colors, typography, glass effects, blur circles). Use when building any UI that should look like an official CopilotKit product.
- **copilotkit-branding** — Brand rules, logos, and visual identity guidelines.
- **copilotkit-dev-workflow** — Internal dev workflow conventions for this monorepo.
- **cr-loop** — Automated code review and fix loop.

If you need a skill and don't have the plugin installed, clone the repo and read the relevant `skills/<name>/SKILL.md` directly.

## Reference (read when relevant to your task)

- [Architecture & Packages](.claude/docs/architecture.md) — V2/V1 package roles, request lifecycle, core concepts (AG-UI, ProxiedAgent, AgentRunner, tools, context, multi-agent)
- [Hook Development](.claude/docs/hooks.md) — checklist for creating new hooks (docs, tests, JSDoc)
- [Workflow & Process](.claude/docs/workflow.md) — when to plan, when to fix autonomously, verification, self-improvement loop, this should be your default mindset when working on any task
- [Git & PRs](.claude/docs/git.md) — worktree workflow, branching, creating PRs
