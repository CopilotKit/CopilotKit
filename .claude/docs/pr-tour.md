# PR Tour Workflow

When a PR touches showcase rows, demos, D5/D6 fixtures, dashboard behavior, or docs, the PR must include deterministic tour artifacts that make a Loom review straightforward.

## Dashboard Matrix Tour

1. Generate the base report:

   ```bash
   npm --prefix showcase/scripts run pr-tour -- --base origin/main --head HEAD
   ```

2. If the branch contains broad inherited churn, scope the report to the rows intentionally changed by the PR:

   ```bash
   npm --prefix showcase/scripts run pr-tour -- --base origin/main --head HEAD --rows row-a,row-b
   ```

3. Include the generated dashboard link in the PR body. The dashboard supports row filtering through:

   ```text
   http://localhost:3002/?rows=row-a,row-b#matrix:links,depth,health,parity
   ```

4. In the PR body, list rows, columns, and cells using dashboard order. If all listed rows changed across all listed columns, say that instead of dumping every cell.

## Showcase Video Tour

For showcase-impacting PRs, generate one video per changed topic row whenever the relevant local shell/demo services are available:

```bash
npm --prefix showcase/scripts run pr-tour-videos -- --mode showcase --rows row-a,row-b
```

For this PR's tool-rendering family, the standard command is:

```bash
npm --prefix showcase/scripts run pr-tour-videos -- --mode showcase --preset tool-rendering
```

The recorder:

- creates one `.webm` per row/topic under `.artifacts/pr-tour-videos/`;
- starts each topic video with a title slide;
- opens the row-filtered dashboard view;
- for every changed dashboard column, opens the showcase preview, starts a fresh preview for each prompt, clicks each suggestion pill as a real visible interaction, and sends one custom prompt that is not a pill;
- opens the shell code view for that same row/column and uses `?file=...&lines=...` to highlight the relevant code lines.

Use a smoke run before a full pass:

```bash
npm --prefix showcase/scripts run pr-tour-videos -- --mode showcase --preset tool-rendering --smoke
```

Use `--columns slug-a,slug-b` when a PR only affects specific framework columns or when some changed columns are not locally interactive. Use `--prompt-limit 1` only for smoke/debug output; never attach or present prompt-limited recordings as the review videos. Full PR tour videos must visibly exercise every relevant suggestion pill plus the custom prompt. If a non-smoke showcase recording cannot find an interactive demo iframe or submit a prompt, the recorder should fail rather than silently turning the tour into page navigation.

When a deployed shell preview is unavailable or stale for a changed row, run the integration app locally and point the recorder at it:

```bash
npm --prefix showcase/scripts run pr-tour-videos -- --mode showcase --rows row-a --columns langgraph-fastapi --direct-preview-base langgraph-fastapi=http://localhost:3102
```

For direct local previews, the recorder sets `X-AIMock-Context` to the column slug so deterministic D6 fixtures match the same way they do in the showcase E2E path. Non-smoke recordings must fail if the clicked/typed prompt text never appears in the transcript or if the chat shows an internal-error banner; a video that only shows loaded pages is not an acceptable PR tour artifact.

If the video script cannot record because a local dependency is down, keep the deterministic plan output in the PR and state the missing service:

```bash
npm --prefix showcase/scripts run pr-tour-videos -- --mode plan --rows row-a,row-b
```

## Docs Video Tour

For docs-impacting PRs, generate a docs walkthrough video:

```bash
npm --prefix showcase/scripts run pr-tour-videos -- --mode docs
```

The docs recorder creates one `.webm` under `.artifacts/pr-tour-videos/`, starts with a title slide, opens each changed docs page, and programmatically selects the changed heading/text when a deterministic needle is known.

When the default docs URL list is too broad or too narrow, pass exact URLs:

```bash
npm --prefix showcase/scripts run pr-tour-videos -- --mode docs --docs-urls http://localhost:3003/generative-ui/tool-rendering/custom,http://localhost:3003/generative-ui/tool-rendering/catch-all
```

## PR Body Requirements

Every showcase/docs PR body should have a `PR Tour` section in the PR description itself, not as a follow-up PR comment, with:

- the row-filtered dashboard link;
- changed showcase rows, columns, and cells;
- embedded video attachments and the exact commit SHA they were recorded from;
- changed docs URLs for the Loom path;
- the exact `pr-tour` / `pr-tour-videos` commands run.

Prefer embedded GitHub video players in the PR description. GitHub embeds videos when they are uploaded through the PR description editor and appear as `https://github.com/user-attachments/assets/...` URLs in the body. Raw release-asset `.webm` links and `<video>` HTML do not render inline in GitHub-flavored Markdown; use release assets only as a fallback when the browser attachment flow is unavailable, and say so in the PR description.

When using release assets as the fallback, upload a thumbnail PNG beside each video and put a screenshot-linked table in the PR description:

```md
| Tour       | Video                                                                                                                                    |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Demo topic | [![Demo topic](https://github.com/org/repo/releases/download/tag/demo.png)](https://github.com/org/repo/releases/download/tag/demo.webm) |
```

This makes the PR visibly reviewable even though GitHub may download the release `.webm` instead of opening it inline.

When a sufficiently major change lands after the video was recorded, regenerate or replace the videos and update the PR description with the new commit SHA. Do not hide fresh walkthroughs in PR comments; reviewers should find the current tour from the description.

Prefer improving these scripts over hand-writing tour details. The goal is repeatability: the next agent should be able to regenerate the same tour from the PR diff and explicit row scope.
