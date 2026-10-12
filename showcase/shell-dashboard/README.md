# Showcase Dashboard

The Next.js entry point is `src/app/page.tsx`, which reads runtime configuration and renders `DashboardPage`.

- Coverage: `DashboardPage → FeatureGrid → UnifiedCell`. `page-stats.ts` computes the summary counts, and the shared cell model under `showcase/harness/src/shared/cell-model/` determines probe results.
- Baseline: `DashboardPage → BaselineTab`.
- Compatibility: `DashboardPage → CompatibilityTab`.
- Ops: `DashboardPage → WorkerRunsSection + StatusTab`.

Tests belong on these active paths or their shared components. Check imports from the app entry points before adding another renderer or editing an apparently parallel implementation.

## Verification

The dashboard is a standalone npm application with its own `package-lock.json`.
It is intentionally excluded from the root pnpm workspace and has no Nx targets.
Use the sequence below for standalone dashboard verification, including its
workspace-based data generators. Other workspace tasks continue to use Nx.
Adding the dashboard to the workspace would change its
dependency setup rather than fix a missing test command.

The [dashboard unit CI job](../../.github/workflows/test_unit-showcase.yml) defines
the dependency installation, generated-data preparation, typecheck, and unit
suite. The [Dockerfile](./Dockerfile) also builds Next after data generation.
Use a current Node.js 22 release, as the dashboard CI does, and the pnpm version
pinned in the root `package.json`. From the repository root, prepare and check the
application in this order:

```sh
pnpm install --frozen-lockfile --ignore-scripts
cd showcase/shell-dashboard
npm ci --ignore-scripts
cd ../scripts
pnpm exec tsx generate-registry.ts
pnpm exec tsx probe-docs.ts
cd ../shell-dashboard
npm exec -- tsc --noEmit
npm exec -- vitest run \
  --exclude 'tests/visual/**' \
  --exclude 'node_modules/**' \
  --exclude 'tests/**/*.spike.test.ts'
npm exec -- next build
```

The two package managers serve different packages: pnpm installs the workspace
and its generators; npm installs the standalone dashboard. Keep
`npm ci --ignore-scripts`: the dashboard's `postinstall` otherwise runs
`npm install` in `showcase/scripts`, replacing dependencies just installed there
by pnpm.

Generate the data before typechecking or testing. Some modules import the
generated JSON when they load, so a missing file can prevent a test from even
reaching its assertions. These files are gitignored; regenerate them when their
inputs change. `probe-docs.ts` makes network requests. After preparation, the
direct checks above avoid repeating that generation through `pretest` or
`prebuild` on every invocation.

The three unit-test exclusions match CI. Keep all three: Vitest's command-line
exclusions replace the configured list rather than extending it. Visual tests
and the excluded integration spikes are separate from this unit gate; run the
relevant additional checks when the change affects those paths.

For a smaller iteration, select the relevant test files while retaining the
exclusions. Before handing off an application change, run the unit gate,
typecheck, and build above, and inspect the affected dashboard view. Use the
[verification scope](../AGENTS.md#verification-scope-for-dashboard-changes) to
decide when real integration probes or comparisons with stored probe results are
also needed. For instructions-only changes, verify the instructions and links
against their sources and check formatting.
