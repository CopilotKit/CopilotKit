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

# Preventing low-quality code: proposed implementation plan

**Status:** Research and proposed policy; analysis configuration has not been changed.
**Goal:** Make common correctness and maintenance failures fail verification regardless of the author, model, or skill used. Static analysis enforces specific properties; it cannot prove that a design is useful or that a safety comment is true.

## Findings from the repository and anti-slop

- `.oxlintrc.json` already loads custom JavaScript rules, but the correctness and suspicious categories are warnings. `package.json` runs `oxlint .` without denying warnings; `.github/workflows/static_quality.yml` invokes that script.
- `packages/tsconfig/base.json` enables strict mode, but `packages/runtime/tsconfig.json`, `packages/sdk-js/tsconfig.json`, and `packages/a2ui-renderer/tsconfig.json` explicitly disable it. `packages/typescript-config/base.json` already enables `noUncheckedIndexedAccess`; the older shared base does not. These are two separate configuration families.
- CI already checks types and published packages. Extend these checks instead of creating a competing verification system. The static-quality workflow ignores changes confined to `examples/**`; separately verify coverage of every area we decide to enforce.
- Nx build targets currently do not depend on lint or their own type checks. Type checks depend on dependency builds. Nx cache inputs must include shared analysis configs and custom rule code so policy changes invalidate previous results.
- Anti-slop is MIT-licensed vendored source, with rule tests, rather than an official npm dependency. Its generic rules use AST and lexical scope analysis, not cross-file TypeScript type information.
- The repo lockfile resolves Oxlint to `1.58.0`; upstream anti-slop currently develops against Oxlint and `@oxlint/plugins` `1.78.0`. Compatibility with our locked version needs execution, not an assumption.
- Current Oxlint type-aware documentation requires TypeScript 7. Our root and core packages declare TypeScript 5. Do not bundle a compiler migration into the initial policy change. Test a compatible pinned Oxlint/type-aware combination or use a narrowly scoped typescript-eslint supplement if necessary; retain the existing compiler checks.
- No dependency installation, lint scan, type-check run, or upstream rule execution was performed during this planning task. Nx MCP tools and local node_modules were unavailable. Findings are from config/source inspection and upstream documentation; violation totals and performance are unmeasured.

Sources reviewed on October 9, 2026:

- [anti-slop README, installation, rule descriptions, and analysis limits](https://github.com/dmmulroy/anti-slop)
- [Upstream dependency versions](https://github.com/dmmulroy/anti-slop/blob/main/package.json)
- [Assertion-chain implementation](https://github.com/dmmulroy/anti-slop/blob/main/src/rules/no-chained-type-assertions.ts)
- [Widen-then-assert implementation](https://github.com/dmmulroy/anti-slop/blob/main/src/rules/no-widen-then-assert.ts)
- [Safety-comment implementation](https://github.com/dmmulroy/anti-slop/blob/main/src/rules/require-safety-comment-for-type-assertion.ts)
- [Oxlint type-aware setup and compatibility](https://oxc.rs/docs/guide/usage/linter/type-aware.html)
- [Oxlint warning and suppression flags](https://oxc.rs/docs/guide/usage/linter/cli.html)
- [Promise handling rule and options](https://typescript-eslint.io/rules/no-floating-promises/)

## 1. Implement strict static analysis

- [ ] Inventory effective lint configs, TypeScript options, analysis targets, source/test inclusion, and CI coverage across packages, examples, showcase, and native runtimes. Read local AGENTS instructions before work in each area. Keep shell-dashboard outside Nx under its standalone verification contract. Produce diagnostics grouped by rule and package, and measure time/memory.
- [ ] Vendor selected generic anti-slop source, tests, licenses, and provenance under a repository tooling directory. Pin the upstream SHA and matching Oxlint/plugin versions. Test compatibility with the existing custom plugin on the CI Node version; upgrade Oxlint separately if needed. Do not install the agent skill merely to turn on every rule.
- [ ] Pilot `no-chained-type-assertions`, `no-widen-then-assert`, and `no-object-parameters` as errors. The last rule bans the uninformative TypeScript `object` type, not normal typed options objects. Add `no-reduce-accumulator-copy` with native `oxc/no-accumulating-spread`. Evaluate assertion safety comments against actual SDK cases before enforcing them; require the specific invariant and its evidence, not a generic reassurance.
- [ ] Add a compatible type-aware pass for unsafe assignments/calls/member access/arguments/returns, floating promises, misused promises, and exhaustive switches over closed unions. Reject explicit `any` in migrated production code. Configure promise checking so `void promise` alone does not bypass rejection handling; support reviewed background-task helpers that handle errors.
- [ ] Enable `strict`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes` project by project. Start with a representative current SDK/frontend package and runtime v2 scope; inspect SDK v1/v2 ownership before choosing the SDK scope. Shared v1/v2 packages may need a separate check config during migration. Cover tests with a check config when production configs exclude them. Keep consumer-facing types compatible and validate declarations with existing package checks.
- [ ] Expose analysis through Nx targets and one verification entry point, with the same policy in local hooks and CI. Run fast syntax lint before expensive builds. Wire supported build/release paths to verification without dependency cycles. Declaration builds needed for downstream type analysis may run first; standalone transpilers can still emit code, so the enforceable promise is rejection by supported verification/merge/release paths.
- [ ] Run the full strict scope with zero warnings and errors. For legacy scope, record only reviewed existing diagnostics in a baseline; reject new findings and new files with violations. Match stable diagnostic fingerprints with multiplicity, not just total counts or changed lines. Prevent baseline growth and remove resolved entries. Prefer small migrations over a permanent baseline system.
- [ ] Add pass/fail fixtures for adopted rules, runtime boundaries, malformed-input tests, public generics, and legitimate optional-field omission. Verify policy-only edits invalidate Nx caches; newly introduced files and cross-file changes are checked; fork PRs get the same gate; failed checks cannot be treated as success.
- [ ] Make an always-reported aggregate verification check required in the repository ruleset. Confirm the ruleset remotely rather than assuming a workflow job is required. Policy/config changes must trigger the complete governed scope. Preserve existing checks for non-TS languages; anti-slop only covers JS/TS.

Initial anti-slop exclusions: retain `unknown`, open metadata dictionaries, and runtime type narrowing at untrusted/plugin boundaries. Skip blanket bans on module mocking, `filter().map()`, conditional empty-object spread, and names containing `shape`; do not add another spacing policy alongside oxfmt. Reconsider only with repository-specific evidence and fixtures. `unknown` is often the correct alternative to `any`; parsing or narrowing establishes trust.

**Acceptance:** Representative invalid fixtures fail; representative valid SDK boundaries pass; strict scopes have zero findings; legacy findings cannot grow; verification fails reliably in CI and supported build/release commands; shared-rule changes cannot reuse stale cached results.

## 2. Enforce architecture as the repository grows

- [ ] Define the permitted dependency directions for frontend, runtime, shared code, agents, and adapters using the actual project graph. Enforce resolved import boundaries, including aliases and dynamic imports where statically resolvable; reject cross-package source deep imports, accidental v2 imports of deprecated internals, new cycles, and undeclared dependencies. Keep reviewed compatibility bridges explicit.
- [ ] Keep untrusted JSON/SSE/tool payload validation in named boundary modules using existing validators. Use domain/event types after validation. Static checks can enforce known entry points and banned assertion patterns; behavioral tests must prove validation and error semantics.
- [ ] Pilot unused export/file/dependency analysis on published packages. Configure package exports, dynamic registration, generated code, and documented consumer APIs as roots before blocking removals. Count actual dead code, not merely exports unused inside the monorepo.
- [ ] Build a custom rule only after identifying a repeatable failure and specifying its safe alternative. Give every rule failing fixtures, valid exceptions, a rationale, an owner, and a remediation message. Avoid function-length or abstraction-count limits that incentivize meaningless helper extraction.

## 3. Prevent easy bypasses

- [ ] Reject new `@ts-ignore` and `@ts-nocheck` in governed code. Require a description for `@ts-expect-error`; retain deliberate negative type tests. Require named-rule, line-scoped lint suppressions with a concrete reason; report unused suppressions. Allow malformed-input tests through explicit reviewed exceptions rather than exempting every test file.
- [ ] Add CODEOWNERS review for analysis configs, vendored rules, baselines, scope manifests, and quality workflows. Configure required code-owner review in repository rulesets; CODEOWNERS alone does not enforce it. Prevent broad disables, unreviewed ignores, and silent strictness downgrades through policy validation.
- [ ] Treat validation scopes as explicit policy. Generated/vendor code exemptions must be narrow and reproducible; handwritten code cannot become exempt merely by adding a generated marker. Scanning needs to detect newly added packages/files.
- [ ] Keep warning/error policy and suppression budgets visible. Track baseline reduction, suppression growth, CI duration, false positives, and repeated escaped defects. Do not use arbitrary lint counts as a proxy for software quality.

## 4. Make agent instructions and review reinforce the rules

- [ ] Update AGENTS and relevant skills to name the verification command, safe alternatives, and exception policy after enforcement exists. Add examples of preserving precise types and handling boundary input. Avoid maintaining a second prose-only rulebook that conflicts with executable policy.
- [ ] Require review evidence for behavior changes: the problem, the smallest correct change, an observable before/after result, and relevant regression checks. Ask reviewers to challenge speculative abstractions, silent error fallbacks, duplicated validators, and tests that only mirror implementation.
- [ ] Turn recurring escaped defects into deterministic rules where possible, and behavioral/contract tests where syntax cannot express the invariant. Reassess rules that produce frequent justified suppressions.

Suggested implementation slices: (1) compatibility pilot, vendored selected rules and rule tests; (2) strict verification gate, coverage and bypass protection; (3) one package migration with type-aware checks; (4) remaining package migrations; (5) dependency-boundary and dead-code checks. Each slice gets a semantic commit and validation; source fixes and their regression tests stay together. Do not mix a TypeScript major upgrade or broad cleanup into the initial gate.

## Executed anti-slop audit — October 9, 2026

- [x] Pin upstream to `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b`; audit all 18 generic rules plus native `oxc/no-accumulating-spread`. All 19 checks trigger. Product source matches fetched main `3cddb360660503325b24564820c78a2ad7ee1843`.
- [x] Review 14,671 tracked JS/TS/Vue paths: 14,666 traversed directly, five traversal skips rechecked using content copies with zero findings. Result: 121,772 diagnostic occurrences in 9,270 files, with no parse-error diagnostics. Spacing and missing assertion comments account for 104,720 occurrences (86%). These counts are not bug counts.
- [x] Compare full scans with matching Oxlint/plugin versions 1.58.0 and 1.78.0: identical findings by rule, path, line, column and message. Upstream tests pass at 1.78.0; 23 non-CLI rule-test files pass at 1.58.0. Direct `.ts` loading fails on CI's Node 20 major; a bundled `.mjs` entry passes a four-file smoke test on Node 20.20.2 (103 expected findings). Full scans ran on Node 24.11.0. Full bundled-plugin CI verification remains necessary.
- [x] Test additive installation using a temporary copy of the current lint config: 123,118 anti-slop findings plus 5,131 existing warnings. Shared showcase symlink aliases account for 1,346 extra anti-slop findings, so the decision report uses tracked-source counts.
- [x] Execute eight isolated blind-spot fixtures: explicit/inferred `any`, floating promises, incomplete union switches, compiler suppressions, empty catches, deep imports and unproven safety comments pass every generic rule. Separate syntax-rule scan: 3,917 explicit-any occurrences, 271 banned/insufficiently described compiler suppressions, 15 empty blocks and zero debugger statements. No full repository type-aware or compiler audit was run.
- [x] Inspect representative source and execute the extracted transcription-response guard: it accepts unknown enum strings and a string-valued `retryable`, despite its declared enum/optional-boolean contract. This confirms a local validation mismatch; end-to-end effects were not tested and no product fix was applied.
- [x] Build an interactive decision report with exact combined rule/scope counts, all 19 rule tradeoffs, source excerpts, eight code cases and eight executed gap cases; preserve full diagnostics, CSVs and execution metadata with the report. Verify interactions, unique-file counting, rule navigation and responsive layout in a headless browser.

**Revised recommendation:** Start with assertion chains, widen-then-assert, reducer copies and accumulator spreads. Those four checks produce 117 findings in package source excluding tests/fixtures/setup and explicit `v1-deprecated` directories, versus 16,960 findings for all 19 checks in the same scope. This scope is not synonymous with v2 or published code. Adapt unknown/dictionary/reflection policies at SDK seams; skip blanket style/naming/mocking/conditional-omission bans. Add compatible type-aware checks, strict compiler coverage, architecture checks, behavioral tests and required CI enforcement alongside the selected rules. No lint policy or compiler configuration has been changed.
