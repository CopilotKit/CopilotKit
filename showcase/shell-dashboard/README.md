# Showcase Dashboard

The Next.js entry point is `src/app/page.tsx`, which reads runtime configuration and renders `DashboardPage`.

- Coverage: `DashboardPage → FeatureGrid → UnifiedCell`. `page-stats.ts` computes the summary counts, and the shared cell model under `showcase/harness/src/shared/cell-model/` determines probe results.
- Baseline: `DashboardPage → BaselineTab`.
- Compatibility: `DashboardPage → CompatibilityTab`.
- Ops: `DashboardPage → WorkerRunsSection + StatusTab`.

Tests belong on these active paths or their shared components. Check imports from the app entry points before adding another renderer or editing an apparently parallel implementation.
