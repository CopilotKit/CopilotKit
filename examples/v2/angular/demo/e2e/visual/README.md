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

Images live in `baselines/<spec file name>/` (for example
`baselines/tool-calls.spec.ts/`) and are named per platform. CI runs on Linux and
compares against the `*-linux.png` images, which are the only ones committed.
Fonts render differently on macOS and Windows, so `pnpm run test:visual:update`
on those platforms writes local-only images (gitignored) for your own checks.

To change the committed images after an intended UI change:

1. Run the **test / visual / angular** workflow manually on your branch with
   `update_baselines` checked.
2. Download the `angular-visual-baselines` artifact and copy its contents into
   `baselines/`, keeping the per-spec folders (the artifact's
   `tool-calls.spec.ts/` folder becomes `baselines/tool-calls.spec.ts/`).
3. Commit them. PNGs are stored with Git LFS, so `git lfs install` first.

When a CI run fails, the `angular-visual-diffs` artifact holds the expected,
actual, and diff images. For a new screenshot with no reference image yet, the
failing run writes one, and the same artifact carries it under
`e2e/visual/baselines/<spec file name>/`. That artifact is rooted at the demo
folder, so copy its `e2e/visual/baselines/` folder over the one in the demo.

The manual run needs a branch in this repository. From a fork, take the images
from the failing run on your pull request instead: new screenshots as described
above, and for a changed screenshot the `*-actual.png` under `test-results/`,
renamed to the reference image's name.

## Adding a state

Add the fixture to a `/visual/*` route under `src/app/routes/visual/` (or a new
route registered in `app.routes.ts`), then screenshot it from a spec here.
