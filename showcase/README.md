# Showcase Platform

## Testing

### Per-package E2E via `/test-aimock <slug>`

The showcase runs a full aimock-backed Playwright E2E suite for a single package on demand. Other CI gates (`showcase_validate.yml`, template drift, etc.) only cover unit tests and structural checks — they won't catch a broken demo render or a fixture regression. Use `/test-aimock` when your PR changes `showcase/packages/<slug>/**` (or touches shared code that a package consumes) and you want end-to-end confirmation before merge.

**How to trigger**

Comment on the PR with:

```
/test-aimock <slug>
```

Example:

```
/test-aimock langgraph-python
```

The `<slug>` must match a directory under `showcase/packages/` (e.g. `langgraph-python`, `langgraph-typescript`, `agno`, `crewai-crews`, `mastra`, `pydantic-ai`, `spring-ai`, etc.). If no slug is provided, the workflow defaults to `langgraph-python`.

**What happens**

The workflow ([`.github/workflows/showcase_aimock-e2e.yml`](../.github/workflows/showcase_aimock-e2e.yml)) checks out the PR HEAD, boots `@copilotkit/aimock` against `showcase/aimock/feature-parity.json`, installs the package (plus its Python agent if present), starts the dev server, runs `npx playwright test` inside the package, uploads the Playwright report as an artifact, and posts a `success`/`failure` comment back on the PR with a link to the run.

**Permissions**

Anyone with permission to comment on the PR can fire the trigger — there's no maintainer-only gate. The workflow always runs against the PR's HEAD SHA, so a stale or abusive comment will still re-run against the latest code. It can also be invoked manually via **Actions → Showcase: Aimock E2E Tests → Run workflow** (`workflow_dispatch`) with a slug input.
