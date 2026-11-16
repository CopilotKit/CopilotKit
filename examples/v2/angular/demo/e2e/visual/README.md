# Visual regression tests

Playwright screenshot tests for the Angular demo. Each spec opens a
`/visual/*` route that renders fixed UI states from hard-coded messages, so
no agent, runtime, or network request is involved. The spec also blocks every
request outside the dev server.

| Spec                 | Route                | Covers                                                                        |
| -------------------- | -------------------- | ----------------------------------------------------------------------------- |
| `tool-calls.spec.ts` | `/visual/tool-calls` | Running and completed tool calls (Lucide icons), expanded details, transcript |

## Run

```bash
cd examples/v2/angular/demo
pnpm exec playwright install chromium
pnpm run test:visual
```

The config starts `ng serve` on port 4300. Build the workspace packages the
demo imports first: `pnpm --filter "@copilotkit/angular-demo^..." run build`.

## Reference images

Images live in `baselines/` and are named per platform. CI runs on Linux and
compares against the `*-linux.png` images, which are the only ones committed.
Fonts render differently on macOS and Windows, so `pnpm run test:visual:update`
on those platforms writes local-only images (gitignored) for your own checks.

To change the committed images after an intended UI change:

1. Run the **test / visual / angular** workflow manually on your branch with
   `update_baselines` checked.
2. Download the `angular-visual-baselines` artifact and copy its `*-linux.png`
   files into `baselines/`.
3. Commit them. PNGs are stored with Git LFS, so `git lfs install` first.

When a CI run fails, the `angular-visual-diffs` artifact holds the expected,
actual, and diff images. For a new screenshot with no reference image yet, the
failing run writes one, and the same artifact carries it under `e2e/visual/baselines/`.

## Adding a state

Add the fixture to a `/visual/*` route under `src/app/routes/visual/` (or a new
route registered in `app.routes.ts`), then screenshot it from a spec here.
