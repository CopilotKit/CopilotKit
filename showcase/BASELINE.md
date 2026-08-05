# Showcase baseline probe — PNI-188

**This file is temporary and must never be merged.**

It exists only so that the comment-triggered Showcase workflows have a pull request to
attach to. Both `showcase / eval` and `test / e2e / showcase / on-demand` are reachable
only via `issue_comment` on a PR, or via `workflow_dispatch` that requires a PR number,
so a baseline run needs a PR even though nothing is being changed.

Dependencies are deliberately untouched. Showcase stays on the published AG-UI packages
it already pins (`@ag-ui/client|core|encoder@0.0.57`), because PNI-188 measures the
protocol the way a real consumer consumes it.

The PR carrying this file is closed, not merged, once the runs have been recorded on
PNI-188.
