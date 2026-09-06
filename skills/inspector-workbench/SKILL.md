---
name: inspector-workbench
description: >
  Runs Inspector UI work on the standalone Threads state lab so the agent
  can see the overlay. Use when a CopilotKit employee asks an agent to
  fix, polish, add, or debug Inspector UI, chrome, panes, overlay actions,
  launcher, Home, Threads, Playground, Memory, or any visual behavior in
  @copilotkit/web-inspector. Don't use for docs-only Callout updates (load
  inspector-docs), runtime or core changes with no Inspector UI, showcase
  cell work, or reading Inspector as a consumer inside an app.
version: 1.0.0
---

# Inspector Workbench

The Inspector overlay is a visual product. Code that compiles is not proof.
The agent must run the standalone workbench and look at screenshots after
each visual change.

This skill does not replace `inspector-docs`. If a pane is added, renamed,
or removed, load `inspector-docs` as well.

## When To Use

Load this skill at the start of any task that changes
`packages/web-inspector` UI, chrome, or overlay behavior.

Do not load it for docs-only Callout work. Do not load it for showcase
cells. If the host app is the bug (z-index against host CSS, CopilotChat
layout), use that host, then still take screenshots.

## Default host

The default host is the standalone Threads state lab:

- Command, from the repo root: `nx run @copilotkit/web-inspector:dev:standalone`
- URL: `http://127.0.0.1:5177/?scenario=pro-enabled-existing&reset=1`
- The lab mounts the real `cpk-web-inspector` and opens the overlay.

Do not start a showcase app, an example app, or Storybook as the default
host. Those are slower and hide Inspector-only faults.

The Nx target runs Vite and the CSS watch together. Do not run Vite alone.
Do not run `pnpm --filter @copilotkit/web-inspector run dev`. That watch
serves consumers, not this lab.

## Procedures

### Procedure 1: Start the workbench

1. If the change adds, renames, or removes a pane, load `inspector-docs` too.
2. From the repo root, start `nx run @copilotkit/web-inspector:dev:standalone`.
3. Wait until `http://127.0.0.1:5177` serves.
4. Open the browser tool this session has (Playwright MCP, Claude browser, or Codex computer use).
5. Go to `http://127.0.0.1:5177/?scenario=pro-enabled-existing&reset=1`.
6. If the bug is an empty, locked, error, or unread state, pick that scenario in the lab dropdown, then reload.
7. Wait until the overlay is open on Home or Threads. The lab clicks the launcher.
8. Take a baseline screenshot. Look at it before any edit.

### Procedure 2: Edit, screenshot, look

1. Edit Inspector source under `packages/web-inspector/src`.
2. Wait for Vite to reload the lab.
3. If the page did not pick up the change, reload the lab URL, then wait for the overlay.
4. Take a screenshot of the pane that must change.
5. If the browser tool writes a file, write it under `.inspector-workbench/<task>/`. Never write a PNG at the repo root.
6. Look at the screenshot. If the change is not visible, the work is not done.
7. Repeat steps 1–6 after every visual change.
8. If layout or the collapsed rail is in scope, take a second screenshot at a narrow viewport.
9. If theme or contrast is in scope, take light and dark screenshots.

Unit tests still belong in the same change. Screenshots do not replace tests.

### Procedure 3: Stop the workbench

1. After the Inspector task is done, stop the `dev:standalone` process tree.
2. Do not leave Vite or the CSS watch running.
3. Do not commit files under `.inspector-workbench/`.
4. Do not commit PNG files at the repo root.

## Decision Tree

- Inspector UI, chrome, overlay, launcher, or pane visuals:
  - Start: Procedure 1
  - While editing: Procedure 2
  - After the task: Procedure 3
  - If a pane is added, renamed, or removed: also load `inspector-docs`
- Docs Callout only: stop. Load `inspector-docs` instead.
- Bug exists only inside a host app: use that host, then still follow Procedure 2 screenshots.
- Runtime or core change with no Inspector UI: this skill does not apply.

## Red Flags

| Signal                                              | What it means                        | Do instead                                            |
| --------------------------------------------------- | ------------------------------------ | ----------------------------------------------------- |
| Showcase, example, or Storybook is the first server | The agent skipped the workbench      | Stop that server. Run Procedure 1                     |
| No screenshot after a visual edit                   | The agent is guessing from CSS       | Take a screenshot. Look at it                         |
| PNG files at the repo root (`inspector-open.png`)   | The screenshot path is wrong         | Write under `.inspector-workbench/<task>/`            |
| "The CSS looks correct, so the UI is done"          | Overlay bugs do not show in source   | Screenshot the lab. Fix what the image shows          |
| Vite started without the Nx target                  | CSS watch is missing                 | Use `nx run @copilotkit/web-inspector:dev:standalone` |
| Port 5178 or a random port                          | The lab pins 5177                    | Free 5177. Do not pick another port                   |
| Workbench still running after the task              | Watchers leak memory on this machine | Run Procedure 3                                       |
| Pane added with no `inspector-docs` pass            | Docs Callout will drift              | Load `inspector-docs` in the same change              |

## Error Handling

- **Port 5177 is in use**: stop the leftover Inspector workbench on that port, then retry Procedure 1. Do not pick another port. The lab uses `strictPort`.
- **No browser tool in this session**: tell the user the session cannot see Inspector. Do not guess visual results from CSS or unit tests alone.
- **Lab is blank or the overlay is closed**: wait for boot. Then screenshot the lab console Runtime line. If Runtime is not connected, fix the lab before UI edits.
- **Screenshot does not show the intended change**: do not claim done. Reload, screenshot again, then fix the source.
- **HMR did not apply a source edit**: reload `http://127.0.0.1:5177` with the same scenario query. Then screenshot.
- **Need a closed launcher or unread halo**: open `http://127.0.0.1:5177/?scenario=pro-enabled-existing&replay-notification=1`.
- **Any unexpected error**: halt and surface the raw error. Do not switch to a showcase app to work around the lab.
