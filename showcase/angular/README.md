# Angular Showcase host

This is the single deployable Angular frontend used by Showcase. Backend and
feature identity comes from the generated frontend registry; runtime traffic
uses the same-origin proxy implemented in `server/`.

Use the repository workflows for browser and server validation. In particular,
`.github/workflows/test_showcase-frontend-matrix.yml` builds this host from the
packed Angular package graph and runs the complete deterministic matrix only on
draft pull requests or non-PR runs.

- [`ACCESSIBILITY.md`](./ACCESSIBILITY.md) defines the human WCAG 2.2 AA and
  screen-reader evidence required before release readiness can be claimed.
- [`performance-baseline.json`](./performance-baseline.json) records the
  production build baseline and budgets.
- Angular consumer guidance and public API contracts live under
  `showcase/shell-docs/src/content/reference/angular/`.

Production activation and public package publication are intentionally outside
this host's workflow.
