# Bundle Size Tracking

## How it works — three tiers

### Tier 1: CI (compressed-size-action)

`static_bundle_size.yml` runs on every PR via `preactjs/compressed-size-action` (pinned by commit SHA, currently `2.10.0`). It scans a glob (`packages/{...}/dist/**/*.{mjs,js,cjs}`), computes the gzip size of each matched file (the action's default compression; the workflow sets no `compression` input), and posts a PR comment showing per-file diffs. It has **no hard-fail** (Phase 1).

> **Fork PRs:** `pull_request` runs triggered from a fork receive a read-only `GITHUB_TOKEN`, so `compressed-size-action` cannot post or update the PR comment — it prints the size report to the job logs instead. The measurement still runs; only the comment is unavailable. This is an accepted Phase 1 limitation (the report is informational and there is no hard-fail). If the PR comment ever becomes a required signal, switch to a `pull_request_target` + `workflow_run` relay pattern so the comment is posted from a trusted context without exposing write tokens to fork code.

Key facts:

- Reports by **file path**, not by named entry — it does not read `.size-limit.json` at all.
- The action runs `build-script: build` (the root `build` script — `nx run-many -t build` over all `packages/**`) on both the PR branch and the base branch, then measures only the files matched by the `pattern` glob. The root `build` script is used (rather than a bundle-size-specific one) because the action must build the base branch too, and `build` exists on every branch. No separate build step is needed before the workflow triggers — the action handles both builds.
- PR comments show paths like `packages/react-core/dist/index.mjs (+1.2 kB gzip)`.

`react-native` joined the glob in the render-tool convergence (2026-08-06),
bringing the glob to **10** packages; its `dist/` was previously unmeasured.
Separately, `pnpm --filter @copilotkit/react-native size:headless`
(`packages/react-native/scripts/measure-headless.mjs`, run as the last step of the
`copilotchat-import-size` job) esbuild-bundles the lean import surface of
`@copilotkit/react-native/headless` — deps and all, with `react`/`react-native`
external — and writes the gzipped total to the job summary. Like `size:headline`
it is a cross-PR relative signal, not a Metro figure, and it does not hard-fail.
No `limit` fields — see Phase 2.

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

The other **six** packages in the CI glob have no `.size-limit.json` and no `size` script (4 + 6 is the 10 packages the workflow's `pattern` covers):

- `shared`, `runtime-client-gql`, `web-inspector`, `voice`, `a2ui-renderer` — unbundled (they emit re-export barrels with separate chunk files); tracked by the CI glob only.
- `react-native` — multi-entry with every runtime dep external, so the glob measures each entry plus its shared chunks. It has no size-limit config either, but it does ship a bespoke `size:headless` script (`scripts/measure-headless.mjs`, an esbuild signal rather than size-limit — see Tier 1 above), run in CI and locally via `pnpm --filter @copilotkit/react-native size:headless`.

> **Node version requirement:** `size-limit@12.1.0` requires Node 20, 22, or 24+ (`^20 || ^22 || >=24`). Running `pnpm --filter <pkg> size` on Node 18 will produce an `EBADENGINE` error.

### Tier 3: Structural assertions (hard-fail)

Two checks hard-fail because they assert _structure_, not a byte threshold — no
baseline to maintain, and no conflict with the Phase 2 freeze on `limit` fields:

1. `pnpm --filter @copilotkit/react-core size:assert-headless`
   (`packages/react-core/scripts/assert-headless-purity.mjs`) — reads the **four**
   built React-Native-reachable entry files (`dist/v2/headless.mjs` / `.cjs` and
   `dist/v2/context.mjs` / `.cjs`) and fails if the text of any of them contains
   `shiki`, `mermaid`, `cytoscape`, `katex` or `streamdown`. Both entries are
   guarded because `@copilotkit/react-native` imports both. Runs in
   `static_bundle_size.yml` — the step there is named after `/v2/headless` only,
   but the script covers `/v2/context` as well.
2. `packages/react-native/src/__tests__/headless-entry-surface.test.ts` — walks
   the relative-import graph of this package's own `src/`, from both
   `src/headless.ts` and `src/index.ts`, and fails if a reached module imports a
   react-core entry other than `/v2/headless` or `/v2/context`, imports the heavy
   render stack directly, or (headless entry only) pulls the optional native
   chat/attachment peer deps. Runs in the normal test job.

**What they cover, and what they don't.** Between them the two checks catch the
two shapes of the #4893 regression that are cheap to detect statically:
react-native importing the fat `@copilotkit/react-core/v2` entry, and the heavy
render stack being _inlined_ into the lean react-core entries. Neither check
follows a dependency edge past the files it reads:

- The purity script is a **substring scan of four emitted files**. It sees only
  what rolldown inlined into them. `headless` and `context` are built with
  `react`, `@copilotkit/core`, `@copilotkit/shared`, `@ag-ui/*`, `rxjs`, `zod` and
  `uuid` **external** (`packages/react-core/tsdown.config.ts`), so a heavy dep
  arriving transitively through one of those would not appear in the scanned text
  and would pass. The one external edge that _is_ covered is
  `@copilotkit/react-core/v2/context` — and only because `context.mjs` / `.cjs`
  are enumerated as targets in their own right, not because the scan traverses.
  Being a plain substring match, it also only checks the `.mjs` / `.cjs` outputs
  (not the UMD builds or the declarations), and a forbidden name in a comment or
  an unrelated identifier fails it.
- The RN test reads only `.ts` / `.tsx` files under `packages/react-native/src/`.
  It records bare specifiers but never resolves them, so it cannot see anything
  inside `node_modules`.

A regression that reaches an RN bundle through a transitive dependency of an
externalized package is therefore caught by neither. The `size:headless` esbuild
signal (Tier 1) is what makes such a regression's _magnitude_ visible, after the
fact and without hard-failing.

## Where configuration lives

`.size-limit.json` files live at the root of each bundled package (`core`, `react-core`, `react-ui`, `react-textarea`) and are used exclusively by the local `size` script. They are not read by CI.

## Adding a new measurement

Only bundled packages support local size tracking **via size-limit**. For the other six packages in the glob, CI covers all chunk files; no local config is needed. Where a specific consumer-facing import needs a number, the pattern is a bespoke esbuild script rather than a `.size-limit.json` — `react-core`'s `size:headline` and `react-native`'s `size:headless` are the two existing examples.

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
