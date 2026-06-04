# Bundle Size Tracking

## How it works — two tiers

### Tier 1: CI (compressed-size-action)

`static_bundle_size.yml` runs on every PR via `preactjs/compressed-size-action@v2.9.1`. It scans a glob (`packages/{...}/dist/**/*.{mjs,js,cjs}`), computes the gzip size of each matched file (the action's default compression; the workflow sets no `compression` input), and posts a PR comment showing per-file diffs. It has **no hard-fail** (Phase 1).

> **Fork PRs:** `pull_request` runs triggered from a fork receive a read-only `GITHUB_TOKEN`, so `compressed-size-action` cannot post or update the PR comment — it prints the size report to the job logs instead. The measurement still runs; only the comment is unavailable. This is an accepted Phase 1 limitation (the report is informational and there is no hard-fail). If the PR comment ever becomes a required signal, switch to a `pull_request_target` + `workflow_run` relay pattern so the comment is posted from a trusted context without exposing write tokens to fork code.

Key facts:

- Reports by **file path**, not by named entry — it does not read `.size-limit.json` at all.
- The action runs `build-script: build` (the root `build` script — `nx run-many -t build` over all `packages/**`) on both the PR branch and the base branch, then measures only the files matched by the `pattern` glob. The root `build` script is used (rather than a bundle-size-specific one) because the action must build the base branch too, and `build` exists on every branch. No separate build step is needed before the workflow triggers — the action handles both builds.
- PR comments show paths like `packages/react-core/dist/index.mjs (+1.2 kB gzip)`.

### The CopilotChat regression signal (job summary, not the PR comment)

The `copilotchat-import-size` job in `static_bundle_size.yml` measures what an app
importing `{ CopilotChat }` from `@copilotkit/react-core/v2` bundles, via
`packages/react-core/scripts/measure-copilotchat.mjs` (run locally with
`pnpm --filter @copilotkit/react-core size:headline`). It drives `esbuild`
directly — bundling `{ CopilotChat }` minified, with `react`/`react-dom` external
and CSS/fonts stubbed to `empty` (we measure JS) — and writes the total gzipped
JS to the GitHub **job summary**.

**This is a _relative_ regression signal, not a production figure.** Its absolute
value (currently ~3 MB gzip) is an esbuild number; a real consumer bundler
(Vite/Next/webpack) splits eager-vs-lazy differently and reports different
absolutes — the Notion "Header Embed Bundle Readout" measured ~386 kB _main
initial JS_ under Vite, with the shiki/mermaid language packs as separate
generated chunks. The script's worth is **consistency**: the same measurement
every PR, so a change that grows CopilotChat's JS shows up, and the number
collapses once OSS-122 moves the language packs to a CDN. A faithful _production_
headline (real Next 15 fixture + `@next/bundle-analyzer`) is OSS-122 Phase 0.

Why a custom script and not `size-limit`: CopilotChat pulls `katex`'s CSS, whose
`url()` font refs crash `@size-limit/esbuild` (which exposes no loader hook).
Driving esbuild directly lets us stub the CSS/font assets.

### Tier 2: Local dev (size-limit)

The four **bundled** packages (`core`, `react-core`, `react-ui`, `react-textarea`) each have a `.size-limit.json` at their root listing one or more named entries pointing at `dist/` paths. Run locally via:

```
pnpm --filter <pkg> size
```

The five unbundled packages (`shared`, `runtime-client-gql`, `web-inspector`, `voice`, `a2ui-renderer`) have no `.size-limit.json` and no `size` script — their sizes are tracked by the CI glob only.

> **Node version requirement:** `size-limit@12.1.0` requires Node 20, 22, or 24+ (`^20 || ^22 || >=24`). Running `pnpm --filter <pkg> size` on Node 18 will produce an `EBADENGINE` error.

## Where configuration lives

`.size-limit.json` files live at the root of each bundled package (`core`, `react-core`, `react-ui`, `react-textarea`) and are used exclusively by the local `size` script. They are not read by CI.

## Adding a new measurement

Only bundled packages support local size tracking. For unbundled packages, CI covers all chunk files via the glob; no local config is needed.

To add a measurement to a bundled package:

1. Add an entry to the package's `.size-limit.json`:
   ```json
   { "name": "my-package: MyExport", "path": "dist/index.mjs", "gzip": true }
   ```
2. Build the package first: `pnpm --filter <pkg> build`
3. Run locally: `pnpm --filter <pkg> size`
4. Commit the updated `.size-limit.json`.

Note: named entries appear in **local** size-limit output only. CI PR comments report by file path from the glob, not by these names.

> **Bundled vs. unbundled packages:** `@size-limit/file` reports accurate sizes for bundled packages (those that build a single-file bundle). For unbundled packages (those that emit re-export barrels with separate chunk files), `@size-limit/file` only counts the barrel file — the CI `compressed-size-action` glob covers all chunks correctly regardless.

## CI behavior (Phase 1 — current)

`static_bundle_size.yml` posts a comment with per-file gzip diffs on every PR. It has **no hard-fail**. Sizes today reflect pre-OSS-122 bloat; adding budget limits now would either lock in that bloat permanently or fail immediately on every PR. Neither is useful.

## Phase 2 — after OSS-122 (separate ticket, blocked)

Once OSS-122 has reduced the baseline:

1. Add `"limit"` fields to each `.size-limit.json` entry.
2. Add a size-limit step to the CI workflow (currently the workflow has no size-limit step — Phase 2 adds one, it does not flip an existing step).
3. PRs that regress past a limit will fail CI.

Do not add `"limit"` fields before OSS-122 lands.
