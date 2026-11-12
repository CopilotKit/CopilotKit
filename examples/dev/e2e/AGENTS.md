# Examples E2E (Playwright) — Notes for Agents & Future Devs

This folder contains an end-to-end (e2e) smoke test harness for the dev apps under `examples/dev/`.

The goals are:

- Provide a consistent way to smoke-test an app locally and in CI.
- Keep tests lightweight and stable (avoid flakiness, avoid requiring real API keys).

## How the harness works

### Selecting which app to run

This suite intentionally runs **one app at a time**.

- The active app is selected via the `EXAMPLE` environment variable.
- If `EXAMPLE` is not set, it defaults to `react-demo` (`examples/dev/by-frontend/react/demo`).

The Playwright config (`playwright.config.ts`) uses an explicit path map (`EXAMPLE_PATHS`) to set `webServer.cwd` to the chosen app and starts it with `pnpm dev`.

### Why each spec has `const EXAMPLE = process.env.EXAMPLE ?? "react-demo";`

Each spec file is **gated** so that when you run the suite for one app:

- The matching specs run.
- All other specs skip.

This makes it easy to run a CI matrix (one job per app) while keeping all tests in one folder.

## Local setup

The target app is a pnpm workspace member, so install from the repo root and build the CopilotKit packages first:

- `pnpm install`
- `pnpm build`

Then install the harness (it has its own lockfile) from `examples/dev/e2e`:

- `pnpm install`
- `pnpm exec playwright install chromium`

### Run the suite

From `examples/dev/e2e`:

- `EXAMPLE=react-demo pnpm test`

## Test layout

- Tests live under `tests/<example>/`.
- `tests/react-demo/` covers the popup layout and the dark-mode CSS scoping regression (#2920) on the demo's `/popup` page.

## Writing smoke tests (guidelines)

Keep smoke tests:

- **Stable**: prefer `getByRole` / `getByTestId` selectors and obvious headings/buttons.
- **Cheap**: do not rely on LLM outputs.
- **Non-invasive**: avoid sending chat messages or triggering expensive background work.

Gate every spec with `test.skip(EXAMPLE !== "<example>", ...)`.

## CI (GitHub Actions)

Workflow: `.github/workflows/test_e2e-public-examples.yml`

Key CI behaviors:

- Installs the workspace dependencies and builds CopilotKit.
- Installs `examples/dev/e2e` deps and Playwright Chromium.
- Uses `pnpm install --frozen-lockfile` for deterministic installs.
- Uploads Playwright output (`test-results` and `playwright-report`) when a job fails.

## Common issues / debugging

- "`next: command not found`": the app's `node_modules` are missing; run `pnpm install` from the repo root.
- Next.js dev warnings about cross-origin (`allowedDevOrigins`): currently treated as warnings; tests can still pass.

## Adding a new app

1. Ensure the app can be started via `pnpm dev`.
2. Add it to `EXAMPLE_PATHS` in `playwright.config.ts`.
3. Add specs under `tests/<example>/`.
4. Run locally: `EXAMPLE=<example> pnpm test`
5. Add the app to the CI matrix in `.github/workflows/test_e2e-public-examples.yml`.
