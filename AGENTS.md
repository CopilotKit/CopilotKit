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

## Users We Optimize For

CopilotKit work should think about two users at once:

- **dev-user**: the developer who writes application code using CopilotKit infrastructure, SDKs, APIs, docs, and examples for their own app.
- **end-user**: the person using our customer's application after that dev-user builds with CopilotKit.

Optimize deeply for both. API design, docs, examples, test coverage, and error messages serve dev-users. Runtime behavior, UI defaults, accessibility, reliability, and performance serve end-users. When tradeoffs appear, name which user is affected and choose deliberately.

## Essentials

- **Nx monorepo** — always run tasks through `nx` (`nx run`, `nx run-many`, `nx affected`), never the underlying tooling directly.
- **Flat package structure** — All packages live under `packages/` with the `@copilotkit/` scope. Some packages have `v1/` and `v2/` internal directories for backward compatibility, but they're a single published package.
- **Simplicity** — prefer the simplest correct solution. For non-trivial changes, consider if there's a cleaner approach before committing.
- **Worktrees** — always work in a git worktree for isolation. See [Git & PRs](.claude/docs/git.md) for the full workflow.

## Dev-User-Visible API Design

Before writing implementation code for a new dev-user-visible function, hook, component, prop, config key, CLI command, or package export:

1. Show the proposed dev-user-facing code snippets first. This is about product surface area, not internal implementation.
2. If multiple names, argument shapes, or architectural placements are reasonable, propose a few options with tradeoffs and a recommendation.
3. Include the common happy path snippet and at least one realistic advanced/customization snippet when the API is not trivial.
4. Call out what the name implies. Avoid names that conflate different concepts, especially registration vs. resolution, configuration vs. execution, and frontend-only vs. runtime behavior.
5. Do not start implementation until the API surface has been reviewed or the user has already clearly approved it.

APIs matter a lot. Treat the snippet a dev-user writes as the product.

## Showcase-First Product Work

CopilotKit uses showcase as the proving ground for product work. In this monorepo, the source lives under `showcase/`; in other contexts, showcase may be a private CopilotKit org repo. If you have access, use it. If you do not have access, do the local work you can and call out the limitation.

When adding a feature, add or update a showcase row for that feature. Start with one complete implementation in the LangGraph Python / LangChain Deep Agents column. Once that implementation works well, use parallel subagents to port the row across the other columns.

Showcase work is not just app code. Include everything the showcase row requires: end-to-end tests, documentation code chunk highlights, example data, fixture updates, and any docs snippets that will be lifted into public docs.

Work in tight loops:

1. Code the feature.
2. Run the showcase locally or on staging.
3. Actually use it in the browser: click around, type into the app, trigger the agent, inspect the rendered UI, and exercise realistic depth rather than a shallow smoke test.
4. Fix what the real usage reveals.

All showcase validation should happen against the staging showcase environment. Promoting showcase changes to production is a separate explicit step.

The `showcase/AGENTS.md` file contains the local showcase methodology. Read it when working under `showcase/`.

## Deprecation Playbook

When deprecating a dev-user-visible API, do the migration work in the same change unless the user explicitly scopes it down:

1. Add the replacement API first and keep the deprecated API as a compatibility alias or wrapper when possible.
2. Add JSDoc `@deprecated` annotations that name the replacement, the version, and the migration docs link.
3. Add runtime warnings for application-side usage when feasible. Warnings should point to the replacement API, the new docs page, the migration guide, and include a concise before/after snippet when space permits.
4. Add a codemod for mechanical migrations. Cover unaliased imports, aliased imports, re-exports, already-migrated no-ops, unrelated-code no-ops, and idempotency.
5. Update the old docs page or section with a prominent deprecation notice at the top. Use a shared deprecation component when the docs app has one, so deprecation notes look consistent.
6. Create or update the new docs page for the replacement API and link the old page, new page, and migration guide together.
7. Update tutorials, reference docs, showcase snippets, and code highlights so new dev-users do not learn deprecated APIs.

## Reference (read when relevant to your task)

- [Architecture & Packages](.claude/docs/architecture.md) — V2/V1 package roles, request lifecycle, core concepts (AG-UI, ProxiedAgent, AgentRunner, tools, context, multi-agent)
- [Hook Development](.claude/docs/hooks.md) — checklist for creating new hooks (docs, tests, JSDoc)
- [Workflow & Process](.claude/docs/workflow.md) — when to plan, when to fix autonomously, verification, self-improvement loop, this should be your default mindset when working on any task
- [Git & PRs](.claude/docs/git.md) — worktree workflow, branching, creating PRs
