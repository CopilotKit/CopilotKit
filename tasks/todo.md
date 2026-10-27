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

## Workspace Learning SDK

The user authorizes the complete workspace Learning delivery and its stacked preview workflow.
Use the verified #7966 head as the parent, per that workflow, after fetching current remote refs.

- [x] Add typed discovery, run, candidate, review, and evidence methods to `CopilotKitIntelligence`.
- [x] Reuse the existing credential configuration and platform error type; keep backend errors redacted on these new methods.
- [x] Validate response contracts, preserve cancellation, bound request time, and avoid automatic write retries.
- [x] Prove the methods with regression tests and verify runtime checks/build.
- [ ] Document server authority and API use; open a draft companion above #7966 and register native stack membership.

API usability review: discovery returns stable IDs and names with an explicit next cursor.
Run admission and completion are separate; callers can read bounded run history.
Candidate detail exposes files and supporting Insights before an explicit review action.
Evidence preserves missing-source states. Project authority comes from server credentials,
not browser identity. Every method accepts cancellation and uses the same error type.
Writes are never retried automatically; callers reconcile state after a lost response.
Existing Skill delivery APIs remain the source for published content.

Validation: `NX_DAEMON=false pnpm nx test @copilotkit/runtime -- src/v2/runtime/intelligence-platform/__tests__`
passed 227 tests in 11 files, including six new management tests.
`NX_DAEMON=false pnpm nx run @copilotkit/runtime:check-types` and
`NX_DAEMON=false pnpm nx run @copilotkit/runtime:check-dts` passed (the latter builds the package).
Changed-file `pnpm exec oxlint` passed with no warnings or errors.
Docs examples and limits were checked against both SDK and companion API source.
Live backend acceptance remains a separate preview-delivery gate.
