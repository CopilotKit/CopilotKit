# Reviewed browser framework transition

This record authorizes exactly one staging runner transition after this PR is reviewed and merged. It does not authorize a live run, relax the ordinary compatibility guard, or activate scheduling.

- Baseline source: `855fb75ec8fd5bfbd0102ffe83765fe03a3953fb`, deployment `27f7ec23-6b79-429f-9574-90da478b3985`, runner digest `fd82c29daf293aa0e59c77d7678ff0df45a769c9802109976d94a5b09b37227e`.
- Candidate source: `b6f89b83d4b6dd4efd2a1bc04f999cf38ff7233b`, build [39939536423](https://github.com/CopilotKit/CopilotKit/actions/runs/39939536423), runner digest `08990847c406a71dd0424ae6f58e91bcaeee500b7e3a1a9d2d032e08f6d27b6f`.
- Runtime changes: add the selected framework to the browser URL and permit adoption of the exact authorized same-image drained checkpoint. The other two changed manifest inputs are their browser and startup regression tests. Adoption requires the matching operation ID, drained status, baseline identities, template and watch binding; existing stopped-owner and crash-replay checks still apply. Both old and new build artifacts are independently validated; any other input difference refuses the handoff.
- Existing application, native backend, inspector images, private template, cleanup policy, persistent volume and attachment remain fixed. No additional build candidate is approved.

The prior installer run39914784012 ended failed after candidate provider success. It is **not** treated as a verified baseline receipt. The release instead binds the exact currently observed deployment and runtime to its immutable successful build39913816663; both provider and runner must independently agree at execution time. The failed handoff receipt remains failed.

Dispatch `intelligence-browser-upgrade.yml` from `main` after human merge. It uses existing GitHub Actions credentials and the same deployment concurrency lock. A same-image drain closes admission first. All historical failed receipts and immutable watch bindings must agree before removal and again before resume. Only the bound deployment may be removed, once; independent exact `REMOVED` evidence, complete inventory, and retained-volume checks precede configuration. The replacement receives an exact upgrade authorization and must reconcile ownership before resume. The script verifies the new deployment, mounted volume, template, watch bindings and original failed receipts before reopening admissions.

Never rerun a failed/uncertain handoff. Download its receipt and reconcile the exact recorded operation before any further mutation. No automatic rollback, duplicate deployment, manual unblock, or watch rewrite is provided.

`releases/staging.json` describes the same-image baseline after this transition. The ordinary main deploy workflow refuses the old855 baseline; use only the dedicated reviewed workflow for the transition. Following verified success, run the ordinary main workflow once with this same-image record to establish a receipt accepted by the normal release generator; the dedicated upgrade receipt is deliberately not accepted as ordinary baseline authority. Subsequent compatible updates can use that ordinary receipt. Retained provider-deletion expectations continue independently of this deployment.

This PR is deployment approval only. #7709 still needs a fresh single Mastra/Strands run with browser/source/persistence evidence, then acceptance and crash recovery. Unit tests and successful image builds are not that proof.

## Baseline reconciliation on October 26

Railway records deployment `27f7ec23-6b79-429f-9574-90da478b3985` as a redeploy created at `2026-10-24T23:21:48.191Z`, using the same immutable baseline image. The previous deployment `5816a613-4b0a-425f-ae82-f6a44ed53a42` is `REMOVED`, updated at `2026-10-24T23:22:01.618Z`. This establishes the replacement history, not a new deployment approval or finality for any retained create request.

Read-only preflight found the replacement as the sole non-removed deployment, with active and latest both `SUCCESS` and configured image equal to the baseline. The live runtime still reports source `855fb75ec8fd5bfbd0102ffe83765fe03a3953fb`, the bound template and resumed operation `github-655515393-39914784012`, no active work, scheduling disabled, and all three retained watch bindings unchanged. Volume `2a70e47d-85d4-4a8a-b17b-b6788c91b1c7` remains attached as `f3187181-2fb7-4d3e-a9dc-c80eac894895` at `/data`.

This correction changes only the reviewed removal deployment ID and its CLI guard. Baseline/candidate images, build provenance, operation binding, template, watches, and volume constraints remain fixed. The workflow must repeat its full preflight after this correction is reviewed and merged. Any further replacement, including one using the same image, refuses before drain; there is no automatic selection of the latest deployment.
