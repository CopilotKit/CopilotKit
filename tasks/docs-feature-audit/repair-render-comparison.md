# Local rendered repair comparison

This index compares the preserved repair baseline
`b0079629eae9445f82cae66baf674c091da971ad` with the active repair worktree.
It is delivery evidence only: it does not qualify a guide's runtime behavior.

## Local servers

| Source   | URL                     | Purpose                                                           |
| -------- | ----------------------- | ----------------------------------------------------------------- |
| Baseline | `http://127.0.0.1:3005` | Disposable checkout at `b0079629eae9445f82cae66baf674c091da971ad` |
| Current  | `http://127.0.0.1:3004` | Active repaired worktree                                          |

Both were queried as local-only applications. Screenshot capture blocked every
non-local browser request, including telemetry and embedded third-party assets.

## Captured page shells

All ten route/source combinations returned HTTP 200 with the expected title.
These screenshots prove docs-page delivery and changed text/code sections;
they do **not** prove an embedded example works. The capture intentionally
blocked all non-local origins, so externally configured iframe demos appear
empty and remote visual assets can be absent. Local Showcase origins must be
wired separately before using a browser capture as a demo-behavior proof.

| Route                                  | Baseline             | Current               | Evidence                                                                                                                                                                                      |
| -------------------------------------- | -------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/threads`                             | `Rich Threads`       | `Rich Threads`        | [baseline](/private/tmp/docs-feature-audit-render-evidence/baseline-threads.png) · [current](/private/tmp/docs-feature-audit-render-evidence/current-threads.png)                             |
| `/generative-ui/tool-rendering`        | `Tool Rendering`     | `Tool Rendering`      | [baseline](/private/tmp/docs-feature-audit-render-evidence/baseline-tool-rendering.png) · [current](/private/tmp/docs-feature-audit-render-evidence/current-tool-rendering.png)               |
| `/mastra/generative-ui/tool-rendering` | `Tool Rendering`     | `Tool Call Rendering` | [baseline](/private/tmp/docs-feature-audit-render-evidence/baseline-mastra-tool-rendering.png) · [current](/private/tmp/docs-feature-audit-render-evidence/current-mastra-tool-rendering.png) |
| `/google-adk/generative-ui/display`    | `Display components` | `Display components`  | [baseline](/private/tmp/docs-feature-audit-render-evidence/baseline-adk-display.png) · [current](/private/tmp/docs-feature-audit-render-evidence/current-adk-display.png)                     |
| `/google-adk/human-in-the-loop`        | `Human-in-the-Loop`  | `Human-in-the-Loop`   | [baseline](/private/tmp/docs-feature-audit-render-evidence/baseline-adk-hitl.png) · [current](/private/tmp/docs-feature-audit-render-evidence/current-adk-hitl.png)                           |

The machine-readable capture list is
`/private/tmp/docs-feature-audit-render-evidence/results.json`.

## Representation changes proved locally

- **C016:** baseline `/threads.mdx` contains a copied Rich Threads prompt.
  Current Markdown expands the canonical onboarding command and has no literal
  `RichThreadsSetupPrompt` component.
- **Mastra tool rendering:** baseline Markdown contains the copied
  `weatherInfo` example. Current Markdown contains the actual bundled
  `tool-rendering-agent` source region after the manifest highlight binding.
- **C002/C004 delivery:** the current Google ADK display and HITL routes, plus
  the Hashbrown and JSON Render root-guide routes in the current response
  probe, render without a missing-snippet marker. Redirect and source-binding
  tests are recorded in `repair-generation.md`.

## C002/C004 local response matrix

| Source / request                 | Baseline             | Current                                       | Final current representation                    |
| -------------------------------- | -------------------- | --------------------------------------------- | ----------------------------------------------- |
| ADK display legacy HTML          | 200 generic ADK page | 308 → `/google-adk/generative-ui/display`     | HTML 200, `Display components`                  |
| ADK display legacy `.mdx`        | 404                  | 308 → `/google-adk/generative-ui/display.mdx` | Markdown 200                                    |
| ADK interactive legacy HTML      | 200 generic ADK page | 308 → `/google-adk/human-in-the-loop`         | HTML 200, `Human-in-the-Loop`                   |
| ADK interactive legacy `.mdx`    | 404                  | 308 → `/google-adk/human-in-the-loop.mdx`     | Markdown 200                                    |
| Hashbrown root HTML / Markdown   | 200 / 200            | 200 / 200                                     | `BYOC — Hashbrown`, no missing-snippet marker   |
| JSON Render root HTML / Markdown | 200 / 200            | 200 / 200                                     | `BYOC — JSON Render`, no missing-snippet marker |

The old ADK checks cover `.mdx`; the generated redirect helper also has focused
tests for `.md`, so all three public representations are contract-checked.

## Commands

```sh
# Baseline data generation (disposable worktree only)
cd /private/tmp/adk013-baseline/showcase/shell-docs
npm run pretypecheck

# Current focused source/renderer validation
cd /Users/tylerslaton/.codex/worktrees/3715/CopilotKit
npm --prefix showcase/shell-docs test -- --run \
  src/lib/__tests__/rich-threads-setup-docs.test.ts \
  src/lib/__tests__/tool-rendering-docs.test.ts

# Local screenshots; this uses the repository's already-installed Playwright
# browser and aborts all non-local requests.
node /private/tmp/capture-docs-repair.mjs
```

The focused test command passed six checks after registry and demo-content
generation. The C016 assertion was red before the renderer ordering repair.
