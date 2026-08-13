# Bundle Size Tracking

## How it works — three tiers

### Tier 1: CI (compressed-size-action)

`static_bundle_size.yml` runs on every PR via `preactjs/compressed-size-action` (pinned by commit SHA, currently `2.10.0`). It scans a glob (`packages/{...}/dist/**/*.{mjs,js,cjs}`), computes the gzip size of each matched file (the action's default compression; the workflow sets no `compression` input), and posts a PR comment showing per-file diffs. This step has **no hard-fail** — no size threshold of any kind (Phase 1). Other steps in the same workflow do fail; see [CI behavior](#ci-behavior-phase-1--current).

> **Fork PRs:** `pull_request` runs triggered from a fork receive a read-only `GITHUB_TOKEN`, so `compressed-size-action` cannot post or update the PR comment — it prints the size report to the job logs instead. The measurement still runs; only the comment is unavailable. This is an accepted Phase 1 limitation (the report is informational and carries no size threshold). If the PR comment ever becomes a required signal, switch to a `pull_request_target` + `workflow_run` relay pattern so the comment is posted from a trusted context without exposing write tokens to fork code.

Key facts:

- Reports by **file path**, not by named entry — it does not read `.size-limit.json` at all.
- The action runs `build-script: build` (the root `build` script — `nx run-many -t build` over all `packages/**`) on both the PR branch and the base branch, then measures only the files matched by the `pattern` glob. The root `build` script is used (rather than a bundle-size-specific one) because the action must build the base branch too, and `build` exists on every branch. No separate build step is needed before the workflow triggers — the action handles both builds.
- PR comments show paths like `packages/react-core/dist/index.mjs (+1.2 kB gzip)`.

`react-native` joined the glob in the render-tool convergence (2026-08-06),
bringing the glob to **10** packages; its `dist/` was previously unmeasured.
Separately, `pnpm --filter @copilotkit/react-native size:headless`
(`packages/react-native/scripts/measure-headless.mjs`, run as the last step of the
`copilotchat-import-size` job) esbuild-bundles the lean import surface of
`@copilotkit/react-native/headless` — deps and all, with `react`, `react-native`
and `react-dom` external — and writes the gzipped total (~92 kB today) to the job
summary. Like `size:headline` it is a cross-PR relative signal, not a Metro
figure, and it enforces **no size budget**. It is not silent, though: it exits
non-zero on three paths, because the printed number is evidence for a bundle
claim.

- The package is not built — `assertBuilt` checks `dist/headless.mjs` before
  esbuild runs, so you get "run the build" instead of a raw resolution stack.
- esbuild fails — errors are re-thrown with context and both errors and warnings
  are formatted to stderr (`logLevel: "silent"` stops esbuild printing them
  itself, so the script must).
- The total is 0, or under `MIN_PLAUSIBLE_BYTES` (8 kB, ~11x below today's
  figure) — a plausibility **floor**, not a budget. A collapsed total means
  everything got externalized or the dist is empty/stubbed; "0.0 kB" read as a
  spectacular improvement is the worst way for this to break.

`size:headline` has the same zero-output guard. So a _broken measurement_ fails
the job; only a size _threshold_ is absent — no `limit` fields, see Phase 2.

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
- `react-native` — multi-entry with every runtime dep external, so the glob measures each entry plus its shared chunks. It has no size-limit config either, but it does ship a bespoke `size:headless` script (`scripts/measure-headless.mjs`, an esbuild signal rather than size-limit — see Tier 1 above, including the three paths on which it exits non-zero), run in CI and locally via `pnpm --filter @copilotkit/react-native size:headless`.

> **Node version requirement:** `size-limit@12.1.0` requires Node 20, 22, or 24+ (`^20 || ^22 || >=24`). Running `pnpm --filter <pkg> size` on Node 18 will produce an `EBADENGINE` error.

### Tier 3: Structural assertions (hard-fail)

Two checks hard-fail because they assert _structure_, not a byte threshold — no
baseline to maintain, and no conflict with the Phase 2 freeze on `limit` fields:

1. `pnpm --filter @copilotkit/react-core size:assert-headless`
   (`packages/react-core/scripts/assert-headless-purity.mjs`) — asserts the
   **resolved module graph** of the four built React-Native-reachable entry files
   (`dist/v2/headless.mjs` / `.cjs` and `dist/v2/context.mjs` / `.cjs`) and fails
   if `shiki`, `mermaid`, `cytoscape`, `katex` or `streamdown` is anywhere in it.
   Both entries are guarded because `@copilotkit/react-native` imports both. Runs
   in `static_bundle_size.yml` — the step there is named after `/v2/headless`
   only, but the script asserts `/v2/context` as well. Mechanically:

   - It bundles each entry with **esbuild** (`bundle: true`, `write: false`,
     `metafile: true`; `react` / `react-dom` and the JSX runtimes external;
     CSS and font assets on the `empty` loader, which still records them as graph
     inputs so a CSS-only leak is caught) and reads `metafile.inputs` — every file
     esbuild had to load (hundreds of modules; the count is printed per entry on
     success). Matching runs on those
     **resolved paths**, never on file contents, so the walk follows relative
     chunk edges, `exports`-map subpaths, extensions and pnpm symlinks on into
     `node_modules`.
   - `packageNameFor` maps each input to its npm package using the **last**
     `node_modules/` segment (so pnpm's
     `.pnpm/zod@3.25.76/node_modules/zod/lib/index.mjs` yields `zod`, not
     `.pnpm`), and `isForbiddenPackage` matches anchored at the start of that
     **package name** — catching the family a dep ships as (`@shikijs/langs`,
     `cytoscape-fcose`) without matching a file that merely mentions the word.
   - Specifiers left **external** resolve to no graph input, so they are collected
     separately from each input's `imports[].external` and matched too.
   - It fails loudly rather than quietly: an edge esbuild cannot resolve throws
     (an unresolvable edge hides a whole subgraph, so it must never read as
     clean), a graph that does not contain its own entry throws ("the scan
     measured nothing"), and esbuild warnings matching `will not be bundled` or
     `could not be resolved` fail the gate instead of being logged. Other esbuild
     warnings print but are non-fatal — third-party code warns for reasons that
     say nothing about #4893.
   - The one place it still reads **text** is to find `import(…)` / `require(…)` /
     `require.resolve(…)` calls whose argument is not a string literal — the one
     edge shape a bundler genuinely cannot see through — and only in the graph's
     first-party files. Comments are stripped first (a single
     comment/string/template alternation, so a `//` inside a string and a quote
     inside a comment are each consumed by the other branch), which is why a
     documented counter-example naming a banned dep no longer trips it.
   - Negative tests: `packages/react-core/scripts/__tests__/assert-headless-purity.test.mjs`,
     run by `pnpm --filter @copilotkit/react-core test:scripts` (chained from that
     package's `test`). They cover both directions — a forbidden dep reached only
     through a relative chunk edge, a forbidden dep left external, an unresolvable
     edge, an unanalyzable loader call, and banned tokens present only in comments
     and strings, which must **pass**.
2. `packages/react-native/src/__tests__/headless-entry-surface.test.ts` — walks
   the relative-import graph of this package's own `src/`, from both
   `src/headless.ts` and `src/index.ts`, and fails if a reached module imports a
   react-core entry other than `/v2/headless` or `/v2/context`, imports the heavy
   render stack directly, or (headless entry only) pulls the optional native
   chat/attachment peer deps. It extracts static `import`/`export … from`, bare
   side-effect `import "x"`, `import()` and `require()`/`require.resolve()` —
   Metro follows the lazy forms too — strips comments with the same
   comment/string/template alternation the purity gate uses, reports a
   non-literal loader argument as unanalyzable rather than ignoring it, and fails
   loudly on a local edge it cannot resolve. Runs in the normal test job.

**What they cover.** Between them the two checks catch both shapes of the #4893
regression: react-native importing the fat `@copilotkit/react-core/v2` entry (the
RN import-graph test), and the heavy render stack being reachable from the lean
react-core entries — whether rolldown _inlined_ it or it arrives _transitively_
(the purity gate's graph walk). The transitive hole the earlier substring scan had
is closed: react-core's own build leaves `@copilotkit/core`,
`@copilotkit/shared`, `@ag-ui/*`, `rxjs`, `zod` and `uuid` external
(`packages/react-core/tsdown.config.ts`), but the purity gate re-bundles with only
`react` / `react-dom` external, so all of those are resolved and walked.

**What they still don't — known limitations.** The gate is a real graph
assertion, not a complete one. Documented rather than glossed, because a doc that
claims a gate is airtight is how the last round of this went wrong:

- **A non-literal loader argument is only partly detected.** The detector matches
  `import(` / `require(` / `require.resolve(` and then inspects only the **first
  character** after the paren; anything beginning with `"`, `'` or a backtick is
  treated as a static literal and skipped. So `` import(`stream${n}`) `` and
  `import("zo" + n)` — a template literal or a concatenation that merely _starts_
  with a quote — read as analyzable while hiding their target.
- **`__require(…)` is not matched.** The pattern is anchored with `\b` before
  `require`, and there is no word boundary inside `__require`, so rolldown's
  emitted CJS-interop form escapes the unanalyzable-call check entirely.
- **String literals are not stripped before that text scan** (only comments are),
  so import-shaped text inside a string — `const doc = "require(x)"` — can
  false-positive and fail the gate on code that links nothing.
- **Workspace-sibling `dist` counts as first-party.** esbuild resolves pnpm
  symlinks to real paths, so `@copilotkit/core` enters the graph as
  `../core/dist/index.mjs`, with no `node_modules/` segment. Two consequences:
  those files _are_ text-scanned for unanalyzable loader calls (a third-party
  dynamic `require` that a sibling's bundler inlined can therefore fail this
  gate), and `packageNameFor` returns `null` for them, so a forbidden dep
  **inlined into a sibling's built output** contributes no package name and is
  invisible to the forbidden-list match.
- **Only the four `.mjs` / `.cjs` entries are targets.** UMD builds, declaration
  files and any other emitted artifact are not asserted.
- **Family matching over-reaches slightly**: `packageName.startsWith("@" + dep)`
  is what catches `@shikijs/*` and `@mermaid-js/*`, and it would equally match an
  unrelated scope such as `@katex-something/x`. A deliberate trade in the
  false-positive direction, not an exact match.
- **The RN test resolves nothing.** It reads only `.ts` / `.tsx` files under
  `packages/react-native/src/`, records bare specifiers without resolving them,
  and so sees nothing inside `node_modules`. Direct-import shape is its job; the
  transitive one is the purity gate's.

The `size:headless` esbuild signal (Tier 1) remains what makes a regression's
_magnitude_ visible — including for anything that slips through the holes above,
since it bundles the real RN entry rather than reasoning about it.

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

`static_bundle_size.yml` posts a comment with per-file gzip diffs on every PR, and that comment carries **no size threshold**. Sizes today reflect pre-OSS-122 bloat; adding budget limits now would either lock in that bloat permanently or fail immediately on every PR. Neither is useful.

"No hard-fail" is about _thresholds only_ — the workflow does have failing steps. The `copilotchat-import-size` job fails on the #4893 structural assertion (`size:assert-headless`, Tier 3) and on either esbuild script reporting a broken measurement (`size:headline` on zero output; `size:headless` on an unbuilt package, an esbuild error, or a total under the plausibility floor).

## Phase 2 — after OSS-122 (separate ticket, blocked)

Once OSS-122 has reduced the baseline:

1. Add `"limit"` fields to each `.size-limit.json` entry.
2. Add a size-limit step to the CI workflow (currently the workflow has no size-limit step — Phase 2 adds one, it does not flip an existing step).
3. PRs that regress past a limit will fail CI.

Do not add `"limit"` fields before OSS-122 lands.
