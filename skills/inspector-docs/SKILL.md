---
name: inspector-docs
description: >
  Keeps CopilotKit docs pointing at shipped Inspector panes so readers open
  the overlay. Use when adding, changing, renaming, or removing an Inspector
  pane, tab, or overlay action in @copilotkit/web-inspector, or when editing
  docs that mention Inspector. Don't use for Inspector UI polish that does
  not add a pane, for CLI or agent-prompt copy, or for unshipped Inspector
  ideas.
version: 1.0.1
---

# Inspector Docs Callouts

Inspector is the localhost overlay that shows Threads, Agents, and Learning.
Every shipped pane that a reader can use must have a docs pointer. The
pointer tells the reader to open Inspector and look at that pane.

## When To Use

Load this skill when:

- A pane, tab, or overlay action is added, renamed, or removed in Inspector
- A docs page teaches a feature that Inspector already shows
- A PR touches both Inspector source and product docs

Do not load it for icon, ping, layout, or copy-only Inspector changes that
do not add a pane. Those UI changes use `inspector-workbench`.

If the same change also edits Inspector UI, load `inspector-workbench` as
well and start the standalone lab.

## Procedures

### Procedure 1: Map a shipped pane to docs

1. Name the shipped pane using the label the reader sees in Inspector.
2. If mapping a pane, read `references/pane-map.md` before proceeding.
3. If the pane is not shipped, stop. Do not add a Callout.
4. If the map already has a page, open that page and confirm the Callout names this pane and what success looks like.
5. If the map has no page, add a Callout on the matching shared root docs page, or write `no page yet` in the map. Do not invent a page.
6. Update `references/pane-map.md` in the same change.

### Procedure 2: Remove a pane

1. If removing a pane, read `references/pane-map.md` before proceeding.
2. Remove the Callout from the mapped page.
3. Delete the map row.

### Procedure 3: Quickstart sanity-check step

The default web quickstart includes a numbered step after the first chat:

1. **Agents** then **Agent**: the agent is listed.
2. Send a chat message. **Agents** then **AG-UI Events**: events are moving.
3. **Threads**: unlocked, or locked with Enable Intelligence.

Angular uses the Angular step snippet, which links the Angular Inspector install page first. React Native and Channels do not get this step.

## Decision Tree

- Inspector pane added, renamed, or changed:
  - If the pane is not shipped: stop
  - Else: Procedure 1
- Inspector pane removed: Procedure 2
- Quickstart or first-run docs: Procedure 3
  - If a pane is also new: Procedure 1

## Red Flags

| Signal                                                                 | What it means                                        | Do instead                                                        |
| ---------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------- |
| Callout names Playground, Fork, emit events, or another unshipped idea | Docs would advertise work that is not in the overlay | Stop. Record the idea under Unshipped in `references/pane-map.md` |
| "Click the Inspector button" on React Native or Channels               | Those surfaces have no web overlay                   | Skip the Open Inspector step                                      |
| Callout names a pane the overlay does not show                         | The pointer is a lie                                 | Rewrite the Callout to a shipped pane, or remove it               |

## Error Handling

- **Pane is not shipped**: halt. Do not add a Callout for Playground, Fork, emit events, or other unshipped work.
- **No matching docs page**: record `no page yet` in the map. Do not create a new docs section unless the user asked for one.
- **Non-web surface** (React Native, Channels): do not add "click the Inspector button".
- **Callout names a pane the overlay does not show**: rewrite the Callout or remove it.
