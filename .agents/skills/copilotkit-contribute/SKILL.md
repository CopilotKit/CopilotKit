---
name: copilotkit-contribute
description: >
  Use when contributing to the CopilotKit open-source project — forking,
  cloning, setting up the monorepo, creating branches, running tests, and
  submitting pull requests against CopilotKit/CopilotKit.
---

# Contributing to CopilotKit

> **Important:** CopilotKit's internal v2 packages use the `@copilotkit/*` namespace. The public API that users install is `@copilotkit/*`. When contributing, you work with `@copilotkit/*` source but users never see that namespace.

## Live Documentation (MCP)

This plugin includes an MCP server (`copilotkit-docs`) that provides `search-docs` and `search-code` tools for querying live CopilotKit documentation and source code.

- **Claude Code:** Auto-configured by the plugin's `.mcp.json` -- no setup needed.
- **Codex:** Requires manual configuration. See the [copilotkit-debug skill](../copilotkit-debug/SKILL.md#mcp-setup) for setup instructions.

## Workflow

1. **Fork and clone** the CopilotKit/CopilotKit repository.
2. **Install dependencies** with `pnpm install` (requires pnpm v9.x and Node 20+).
3. **Build once** with `pnpm build` to bootstrap all packages.
4. **Create a branch** using the naming convention: `feat/<ISSUE>-<name>`, `fix/<ISSUE>-<name>`, or `docs/<ISSUE>-<name>`.
5. **Develop** with `pnpm dev` (watches all packages) or target a specific package with `nx run @copilotkit/<pkg>:dev`.
6. **Write and run tests** with `nx run @copilotkit/<pkg>:test`. All v2 packages use Vitest.
7. **Lint and format** with `pnpm run lint --fix && pnpm run format`.
8. **Commit** using conventional commit format: `<type>(<scope>): <subject>` (enforced by commitlint).
9. **Push and open a PR** against the `main` branch. CI builds all packages and publishes preview packages via pkg-pr-new.

## Before Opening a PR

- Reach out to the maintainers first for any significant work (file an issue or ask on Discord).
- Run `pnpm run test` to verify all tests pass.
- Run `pnpm run build` to verify the full build succeeds.
- Run `pnpm run check-prettier` to verify formatting.
- Ensure commit messages follow the `<type>(<scope>): <subject>` format.

## Quick Reference

| Task | Command |
|---|---|
| Install dependencies | `pnpm install` |
| Build all packages | `pnpm build` |
| Dev mode (all) | `pnpm dev` |
| Dev mode (v2 only) | `pnpm dev:next` |
| Run all tests | `pnpm run test` |
| Run v2 tests only | `pnpm test:next` |
| Run single package tests | `nx run @copilotkit/core:test` |
| Test with coverage | `pnpm run test:coverage` |
| Lint | `pnpm run lint` |
| Format | `pnpm run format` |
| Check formatting | `pnpm run check-prettier` |
| Type check | `pnpm run check-types` |
| Package quality checks | `pnpm run check:packages` |
| Dependency graph | `pnpm run graph` |

## Key Architecture Points

- V2 (`@copilotkit/*`) is the real implementation. V1 (`@copilotkit/*`) wraps V2.
- New features always go in V2 packages under `packages/v2/`.
- Communication between frontend and runtime uses the AG-UI protocol (SSE-based events).
- The monorepo uses Nx for task orchestration and pnpm workspaces.

## Reference Documents

- [Contribution Guide](references/contribution-guide.md) — full onboarding walkthrough
- [Repo Structure](references/repo-structure.md) — package layout and architecture
- [Testing Guide](references/testing-guide.md) — Vitest setup, running tests, coverage
- [PR Guidelines](references/pr-guidelines.md) — CI checks, review process, expectations
