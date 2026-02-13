# Examples E2E (Playwright) — Notes for Agents & Future Devs

This folder contains an end-to-end (e2e) smoke test harness for the repository’s `examples/`.

The goals are:

- Provide a consistent way to smoke-test examples locally and in CI.
- Support multiple example “shapes” (Next-only vs hybrid examples that also have an agent).
- Keep tests lightweight and stable (avoid flakiness, avoid requiring real API keys).

## How the harness works

### Selecting which example to run

This suite intentionally runs **one example at a time**.

- The active example is selected via the `EXAMPLE` environment variable.
- If `EXAMPLE` is not set, it defaults to `form-filling`.

The Playwright config (`playwright.config.ts`) uses `EXAMPLE` to:

- Set the `webServer.cwd` to the chosen example directory (`examples/v1/${EXAMPLE}`).
- Choose the `webServer.command` used to start the app.

### Why each spec has `const EXAMPLE = process.env.EXAMPLE ?? "form-filling";`

Each spec file is **gated** so that when you run the suite for one example:

- The matching spec runs.
- All other specs skip.

This makes it easy to run a CI matrix (one job per example) while keeping all tests in one folder.

## Example types

### Next.js-only examples

These can be started with:

- `pnpm dev`

### Hybrid examples (UI + agent)

Some examples have a Python agent that can be run alongside the UI.

For e2e smoke tests we typically only need the UI to boot, so the Playwright config treats these as “hybrid”:

- `travel`
- `research-canvas`

For hybrid examples the `webServer.command` is:

- `pnpm dev:ui`

This avoids starting the Python agent during UI-only smoke tests.

## Local setup

### Install Playwright harness deps

From `examples/e2e`:

- `pnpm install`
- `pnpm exec playwright install --with-deps chromium`

### Install the example’s deps

Each example has its own `package.json`.

Install deps in the example directory you want to test, e.g.:

- `cd examples/v1/travel && pnpm install`

Notes:

- If an example has a `postinstall` that requires non-Node tooling (e.g. Python `uv`), you may want to run `pnpm install --ignore-scripts` for CI-like behavior.

### Run a single example

From `examples/e2e`:

- `EXAMPLE=form-filling pnpm test`
- `EXAMPLE=travel pnpm test`
- `EXAMPLE=research-canvas pnpm test`
- `EXAMPLE=chat-with-your-data pnpm test`
- `EXAMPLE=state-machine pnpm test`

When `EXAMPLE` is set, you should see `1 passed` and the other example specs `skipped`.

## Test layout

- Tests live under `tests/v1.x/`.
- Each example gets a single smoke spec (minimal assertions).

Examples:

- `tests/v1.x/form-filling.spec.ts`
- `tests/v1.x/travel.spec.ts`

## Writing smoke tests (guidelines)

Keep smoke tests:

- **Stable**: prefer `getByRole` selectors and obvious headings/buttons.
- **Cheap**: do not rely on LLM outputs.
- **Non-invasive**: avoid sending chat messages or triggering expensive background work.

Patterns used:

- Gate the spec:
  - `test.skip(EXAMPLE !== "<example>", ...)`
- Prefer:
  - `await expect(page).toHaveTitle(/.../)`
  - `await expect(page.getByRole("heading", { name: "..." })).toBeVisible()`

If an example auto-opens Copilot UI / triggers calls, prefer adding a query param to disable it (e.g. `travel` uses `/?copilotOpen=false`).

## CI (GitHub Actions)

Workflow:

- `.github/workflows/e2e_examples.yml`

It runs a matrix of:

- `form-filling`
- `travel`
- `research-canvas`
- `chat-with-your-data`
- `state-machine`

Key CI behaviors:

- Installs `examples/e2e` deps and Playwright Chromium.
- Installs the selected example’s deps.
- Uses `pnpm install --frozen-lockfile` for deterministic installs.
- For `research-canvas`, installs with `--ignore-scripts` to avoid requiring Python tooling just to run UI smoke tests.

Artifacts:

- Always uploads Playwright output (`test-results` and `playwright-report`) for debugging.

## Common issues / debugging

- "`next: command not found`": the selected example’s `node_modules` are missing; run `pnpm install` in that example directory.
- "module not found" for a transitive dep (e.g. `shiki`): add it explicitly to the example’s dependencies and reinstall.
- Next.js dev warnings about cross-origin (`allowedDevOrigins`): currently treated as warnings; tests can still pass.

## Adding a new example

1. Ensure the example can be started via `pnpm dev` (Next-only) or `pnpm dev:ui` (hybrid).
2. Add a new spec under `tests/v1.x/<example>.spec.ts`.
3. Run locally:
   - `EXAMPLE=<example> pnpm test`
4. Add the example name to the CI matrix in:
   - `.github/workflows/e2e_examples.yml`
