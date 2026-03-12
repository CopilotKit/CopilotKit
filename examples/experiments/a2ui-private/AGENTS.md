# Repository Guidelines

## Project Structure & Module Organization
The monorepo uses pnpm workspaces managed by Turborepo. Front-end code lives in `apps/web` (Next.js 15 app with Tailwind assets in `app`, `public`, and `tailwind.config.ts`). Shared UI primitives are implemented in `packages/a2ui/src`; the compiled output in `packages/a2ui/dist` is generated and should not be edited directly. Python-based agent samples reside under `apps/a2a_samples`, orchestrated with `uv`, while `original_a2ui_source` preserves Google’s original A2UI dump—treat it as read-only documentation of their reference app, useful when comparing how we adapted pieces into this React monorepo.

## Build, Test, and Development Commands
Run `pnpm install` once, then `pnpm dev` for all workspace dev servers (Next.js watches on port 3000). Use `pnpm --filter web dev` for an isolated UI session and `pnpm --filter a2a-samples dev` to launch the restaurant finder agent (requires `GEMINI_API_KEY` in `apps/a2a_samples/a2ui_restaurant_finder/.env`). Build artifacts with `pnpm build`; `pnpm --filter web lint` and `pnpm --filter web check-types` gate merges, while `pnpm sync:python` keeps the Python virtualenv aligned.

## Coding Style & Naming Conventions
TypeScript and modern React are mandatory in `apps/web`; prefer function components and colocate UI logic in `app/components`. Follow Prettier's defaults (two-space indentation, single quotes) by running `pnpm format` before commits. Component files use PascalCase (e.g., `AgentPanel.tsx`); hooks and utilities use camelCase in `*.ts`. The shared ESLint preset (`packages/eslint-config`) enforces `turbo/no-undeclared-env-vars`, so surface new env variables via typed helpers.

## Testing Guidelines
There is no bundled unit-test runner yet, so treat linting and type-checking as minimum CI gates. When adding logic, include targeted checks: for UI, add stories or smoke tests under `apps/web/app` and document manual verification steps in the PR; for agents, prefer lightweight contract tests that exercise handlers via `uv run python -m a2ui_restaurant_finder`. Keep test fixtures (JSON, mock responses) alongside the code they exercise to match existing samples.

## Commit & Pull Request Guidelines
Existing history uses short imperative subjects ("Add themed a2ui surface"); continue that pattern and reference issues in the footer as needed. Each PR should state scope, testing evidence, and any UI screenshots or terminal output that prove the agent path. Link design docs and flag follow-ups; ensure CI (`pnpm build`) is green before requesting review.

## Security & Configuration
Never commit `.env` files or API keys; use `.env.local` for web and `.env` inside sample agents. Document any new secrets in `README.md` and expose through `turbo.json` inputs if needed so pipelines remain deterministic.
