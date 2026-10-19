# Fresh source-to-fork proof — prepared, not authorized or executed

This variation tests the original runtime architecture with paced requests. It
requires a new, independently authorized project scope. Do not reuse the prior
canary project, its journal directory, or its unresolved parent-delete operation.
596 remains the sole live sequencer. Keep the runner schedule off.

## Exact scope and preconditions

- Arrange authorized workspace-admin cleanup of the prior canary project before
  requesting or executing another fresh project. Ran confirmed on October 19,
  2026 that only workspace admins can delete Railway projects. This explains the
  operational permission blocker; the discarded API error was not independently
  recovered. No Railway support investigation is required to explain it.
  Keep the old operation records and unresolved child intent intact.
  Do not create another project to bypass pending admin cleanup.
- One new disposable project in workspace `9cab81e9-4aa5-40cd-a484-3a585ca35c90`,
  named `pni605-canary-<12 hex>`. The sequencer records authorization, exact name,
  complete before-project IDs, create intent, response, and independent readback.
- Project creation is one separately journaled request, observing the current
  project-create rate limit. Lost/rejected responses stop; no alternate create.
- Supply its verified ID/name in a private copy of `fork-scope.example.json`.
  The `pni605-fork-isolation-canary` purpose explicitly selects this variation;
  the older scope continues to select two independent empty environments.
- Fresh project (at most ten minutes old), no services, volumes or instances,
  no protected project/environment IDs, a new private journal directory, and a
  maximum ten-minute probe lifetime. No image, repository, variables or model
  credentials; no deployments. Coordinate all other creation writers first.

## Bounded operation sequence

1. Read the project's live creation rate limit. Wait a complete window plus two
   seconds before each environment intent; persist the pacing reservation.
2. Create empty ephemeral source A (`skipInitialDeploys: true`), exactly once.
   Verify returned ID/name/project, creation time, ephemeral flag, null source,
   complete inventory and detailed environment readback with zero workloads.
3. After another full rate window plus two seconds, create ephemeral fork B with
   `sourceEnvironmentId` equal to A's verified ID, exactly once. Verify the
   response, complete inventory and detailed read all agree on B's ID, creation
   time and exact A lineage. Save `forkAcceptance` before any service request.
4. Create one inert service explicitly in B. Read all environments, including A
   and the original baseline. Require B to be its only membership. Fanout stops
   before configuration and preserves the membership evidence.
5. Set only B's start command to `echo pni605-inert-canary`. Verify instance
   readbacks, no source/repository, no deployment history, unchanged membership,
   and no other instance changes. This is configuration proof, not execution.
6. When every create/configure outcome is confirmed and ownership checks pass,
   delete the owned service, then B, then A; verify complete baseline restoration.
   Recheck exact lineage, creation time and empty workloads before deletion.
   Unknown outcomes stop and retain intent; never retry a failed delete.
7. Parent project retirement requires an authorized workspace admin, coordinated
   by the sequencer. Environment, service and volume deletion are distinct
   operations; project deletion permission does not establish their permissions.
   Do not assume a returned boolean or absence
   alone proves retirement. Require an exact tombstone and live-list absence;
   otherwise preserve the unresolved operation and stop without another delete.

## Admin cleanup handoff

The pending project is `pni605-canary-4c62a8d01b97`, ID
`a843d02e-df72-4161-93cc-2bebbba329b2`, in workspace
`9cab81e9-4aa5-40cd-a484-3a585ca35c90`. Its recorded creation time is
`2026-10-19T12:18:51.730Z`. Last inventory showed the original baseline and source
A, no services or volumes; the second environment-create outcome remains unknown.

Give the authorized workspace admin this exact identity and the existing
project-retirement receipt. Before deletion, the sequencer obtains a fresh
read-only inventory and confirms no unexpected workloads. Record the admin's
action separately from the prior unknown attempt, retain both original journals,
then verify project retirement by exact identity and current readback. Until
that evidence exists, project cleanup is pending, not complete. Do not resend the
old request or replace its unknown outcome with an inferred cancellation.

A suitable existing authorized scope is an alternative planning option, but this
script currently requires a fresh disposable project. It needs a separately
reviewed scope and ownership/preflight adaptation before use; do not bypass its
freshness check or reuse the failed probe journal.

## Invocation after authorization

```sh
node --import tsx tools/intelligence-smoke/rich-threads/lifecycle/railway/canary/cli.mjs run <NEW_PRIVATE_JOURNAL_DIR> <REVIEWED_FORK_SCOPE_JSON>
```

Record the exact script commit and scope digest before execution. Success needs
separate evidence for fork acceptance, service creation isolation, configuration
isolation, child cleanup and parent retirement. No result here substitutes for
the fresh Mastra/StrandsTS single or acceptance/crash tests. A stopped probe does
not authorize another project, retry, runner deployment, or unblock operation.
