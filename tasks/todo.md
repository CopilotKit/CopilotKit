# Multiple-container skill delivery implementation plan

> Use subagent-driven-development for the independent language implementation task and review. Keep edits in the assigned directories.

**Goal:** Consume published skills from several containers without breaking existing SDK or CLI callers.
**Architecture:** Retain each single-container cache, compose immutable invocation snapshots, and expose mutually exclusive configuration forms.
**Tech stack:** TypeScript, Python, C#, Nx, Vitest, pytest, .NET tests.

- [x] TypeScript core and adapters: add failing tests in `packages/runtime/src/v2/runtime/intelligence-platform/__tests__/skill-registry.test.ts`; add the exclusive options union in `skill-registry/config.ts`; compose registries in `skill-registry/registry.ts`; keep immutable snapshots and qualified names; export source types; exercise BuiltInAgent, Mastra, and LangGraph consumers. Run `pnpm nx test @copilotkit/runtime` with the focused paths, and the adapters' test/build targets.
- [x] Python and .NET: implement the same contract in `packages/intelligence-delivery-python-core/src/_delivery/` and `packages/intelligence-agent-framework-dotnet/src/`; expose it through Python adapters; add and run focused tests first; update package READMEs. Preserve ownership, cancellation, and disposal semantics.
- [x] CLI: in the Intelligence worktree, extend `apps/cli/src/commands/skills-download.ts`, command parsing, and `services/learning-skills-download.ts`. Add failing command and extraction tests before implementation. Run CLI Nx test, lint, typecheck, build and available e2e checks.
- [x] Documentation: update `showcase/shell-docs/src/content/docs/intelligence/learned-skills.mdx`, relevant SDK reference, overview, README and CLI docs. Describe pins, mutually exclusive fields, legacy environment precedence, qualified names and all-or-nothing failure behavior. Run existing docs checks.
- [x] Review and deliver: review specification compliance, then code quality, fix findings, run focused regression tests and builds, inspect diffs, commit logical changes and push draft PRs. Do not merge or publish packages.
