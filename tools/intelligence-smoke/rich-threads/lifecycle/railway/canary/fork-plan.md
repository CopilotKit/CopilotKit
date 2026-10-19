# Fresh source-to-fork proof — prepared, not authorized or executed

This variation tests the original runtime architecture with paced requests. It
requires a new, independently authorized project scope. Do not reuse the prior
canary project, its journal directory, or its unresolved parent-delete operation.
596 remains the sole live sequencer. Keep the runner schedule off.

## Exact scope and preconditions

- Resolve the prior canary parent's disposition through provider-confirmed status
  before requesting or executing another fresh project. Keep its unresolved child
  intent intact; confirmation of parent retirement is not child cancellation.
  This prepared variation does not authorize accumulating diagnostic resources.
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
7. Parent project retirement is a separately reviewed sequencer operation with
   provider-supported semantics. Do not assume a returned boolean or absence
   alone proves retirement. Require an exact tombstone and live-list absence;
   otherwise preserve the unresolved operation and stop without another delete.

## Invocation after authorization

```sh
node --import tsx tools/intelligence-smoke/rich-threads/lifecycle/railway/canary/cli.mjs run <NEW_PRIVATE_JOURNAL_DIR> <REVIEWED_FORK_SCOPE_JSON>
```

Record the exact script commit and scope digest before execution. Success needs
separate evidence for fork acceptance, service creation isolation, configuration
isolation, child cleanup and parent retirement. No result here substitutes for
the fresh Mastra/StrandsTS single or acceptance/crash tests. A stopped probe does
not authorize another project, retry, runner deployment, or unblock operation.
