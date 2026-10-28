# Reviewed browser composer transition

This record binds one staging runner transition to the immutable images in
`releases/browser-upgrade.json`. Dispatch the dedicated workflow from `main`
after this release is reviewed and merged. Scheduling stays off.

## Change and evidence

Source `6903d804df6857e7e92fd4547a2de573236350b3` fixes a cold-browser race:
the server-rendered textarea becomes visible before React hydration and runtime
discovery. The previous driver filled that textarea and pressed Enter immediately.
Hydration could clear the input without any agent request. The driver now prepares
the input until the real send control becomes enabled, clicks once, and retains
the existing captured-terminal-run requirement. It never retries submission.
All composer actions share one 90-second deadline and forward cancellation to
Playwright. Request admission checks cancellation before and after the awaited
pre-request hook, so cancelling a held hook cannot forward a late POST.

The exact public `@copilotkit/react-core@1.77.0` UI reproduced the empty composer
and absent POST with delayed hydration; the fixed driver produced one POST and
captured its thread and terminal event. Both framework browser regressions fail
with the previous driver and pass with this change. The source passed 142 smoke
tests, twelve browser tests, and independent review. Seven new browser regressions
cover blocked fill, missing send controls, covered buttons, deadline expiry, caller
cancellation, and a held pre-request hook; unblocking after rejection produces no
late POST. These local checks do not prove
live model output or Intelligence persistence.

Build [40726621354](https://github.com/CopilotKit/CopilotKit/actions/runs/40726621354)
provides the immutable candidate record. Provenance must verify that its packaged
source differs from baseline only in `browser/session.mjs` and
`driver.integration.mjs`. Application, native backend and inspector images,
private template, cleanup policy, persistent volume and attachment stay fixed.
Only the new runner image is approved by this record.

## Exact baseline

The baseline is source `b6f89b83d4b6dd4efd2a1bc04f999cf38ff7233b`, successful build
[39939536423](https://github.com/CopilotKit/CopilotKit/actions/runs/39939536423),
runner digest `08990847c406a71dd0424ae6f58e91bcaeee500b7e3a1a9d2d032e08f6d27b6f`,
and deployment `fe7e30b4-213a-403c-994b-40c1066274ce`. Read-only observation on
October 28 found this as the sole non-removed deployment, active/latest `SUCCESS`,
with the exact runtime, template, and resumed operation
`github-655515393-40551269953`. The runner was idle with scheduling disabled.
Volume `2a70e47d-85d4-4a8a-b17b-b6788c91b1c7` remained attached as
`f3187181-2fb7-4d3e-a9dc-c80eac894895` at `/data`.

Upgrade run 40551269953 remains failed at candidate acknowledgement; it is not a
verified ordinary baseline receipt. Current runtime/provider observations and the
immutable successful image build establish this release's baseline independently.
The failed receipt is preserved. A later externally dispatched single run,
40590065133 (`run-124bd0c2-1348-4fc8-8c98-00da8be229b7`), failed both browser
scenarios. Its final cleanup removed active resources but retained five detached
volumes awaiting provider deletion. Neither this transition nor empty inventory
establishes their physical deletion. All three original unknown-finality watches,
failed/overdue outcomes, journals and retention records remain intact.

## Execution and follow-up

The workflow repeats its full preflight. Any baseline identity, deployment,
operation, template, volume, watch or inventory mismatch refuses before drain.
A same-image drain closes admission. Only the bound baseline deployment may be
removed, once; independent exact `REMOVED` evidence and complete inventory precede
configuration. The candidate must reconcile ownership, retain all watch bindings,
and pass provider/runtime checks before resume. Read-only requests retry transient
route-readiness 404s within the existing deadline; mutations remain single attempts.

Never rerun an uncertain handoff, clear a fence manually, or rewrite a watch.
Download and reconcile its receipt. No automatic rollback or duplicate deployment
is provided. Fresh single Mastra/Strands validation follows only verified resume;
acceptance and crash-recovery runs follow only a passing single run.

`releases/staging.json` describes the same-image baseline after this transition.
The ordinary workflow refuses the current b6f baseline with that new record.
After verified upgrade success, its same-image path can establish an ordinary
baseline receipt; the dedicated upgrade receipt is not ordinary baseline authority.
