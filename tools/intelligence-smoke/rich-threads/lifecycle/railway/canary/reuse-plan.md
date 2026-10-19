# Existing private project: paced source-to-fork proof

Ran authorized assessing and reusing this existing project on October 19, 2026.
596 remains sole live sequencer. No new project, shared Showcase change, schedule
enablement, or whole-project deletion is part of this probe.

## Admission and preserved ownership

Use `reuse-scope.json`, which pins project `a843d02e-df72-4161-93cc-2bebbba329b2`.
Keep its original `project-journal.json`, `probe/journal.json`, and
`project-retirement.json` unchanged. Reuse source A
`5f09c966-4c75-4642-a162-2fe22c3cb53c` as an existing baseline resource, along with
default environment `addf2003-bbb0-4b33-a49e-c42c54688d36`. Do not transfer their
cleanup ownership into the new probe. The unknown old request for
`pni605-c761e7aa-b` remains tracked by its original pending intent.

Before admission, review fresh complete CLI inventory and project deletion state.
The user-confirmed admin-only permission constraint, current disabled-delete UI
with no scheduled-deletion warning, and active exact-project readback can support
an attributed operational assessment that deletion is inactive. This is not
reconstruction of the discarded API error or transaction-finality proof. Pending,
scheduled, or still-unknown imminent deletion risk blocks provisioning.

Write a private admission file after review with this schema (hashes are SHA-256
of exact file bytes, not canonicalized JSON):

```json
{
  "version": 1,
  "kind": "pni605-existing-project-reuse",
  "authorization": "ran-2026-10-19-reuse-existing-project",
  "projectId": "a843d02e-df72-4161-93cc-2bebbba329b2",
  "projectName": "pni605-canary-4c62a8d01b97",
  "workspaceId": "9cab81e9-4aa5-40cd-a484-3a585ca35c90",
  "reviewedAt": "REPLACE_WITH_REVIEW_TIME_ISO",
  "expiresAt": "REPLACE_WITH_EXPIRATION_ISO",
  "deletion": {
    "status": "inactive",
    "evidencePath": "/absolute/path/to/reviewed-deletion-assessment.json",
    "sha256": "REPLACE_WITH_RAW_EVIDENCE_HASH"
  },
  "prior": {
    "projectSha256": "REPLACE_WITH_RAW_PROJECT_JOURNAL_HASH",
    "probeSha256": "REPLACE_WITH_RAW_PROBE_JOURNAL_HASH",
    "retirementSha256": "REPLACE_WITH_RAW_RETIREMENT_JOURNAL_HASH"
  }
}
```

The review must be no older than five minutes at start; admission expires within
fifteen minutes of review. The probe's ten-minute deadline is shortened to the
admission deadline when needed. The new journal stores the admission and original
records, with their hashes. Before each write, revalidate immutable evidence and
original records, complete inventory, source identity/creation time/lineage, and
absence of the old unresolved name or unexpected resources. A late old environment
stops writes for reconciliation; absence never cancels its original intent.

## Bounded execution

```sh
node --import tsx tools/intelligence-smoke/rich-threads/lifecycle/railway/canary/cli.mjs reuse <NEW_PRIVATE_ROOT> tools/intelligence-smoke/rich-threads/lifecycle/railway/canary/reuse-scope.json <ORIGINAL_ISOLATED_CANARY_ROOT> <PRIVATE_ADMISSION_JSON>
```

Use a new sibling journal directory, for example `isolated-canary/reuse-probe-1`.
The original root contains the three preserved journals listed above. Ordinary
restart cannot reuse the new directory; inspect it before any further action.

1. Confirm the exact project remains active and the known baseline/source are
   empty, with no services/volumes. Do not recreate source A.
2. Pace one new fork request using the live environment-create limit plus a
   two-second cushion. Its unique new name differs from the old unknown name;
   this is a new source-to-fork request, not a replay of that old empty request.
3. Verify returned ID, complete inventory and detailed readback agree on exact
   project/name/time, ephemeral flag, and lineage to A before creating a service.
4. Create one inert service in the new fork, verify its only membership is that
   fork, then set and read back only its inert start command. No image, repository,
   variables, deployment, model call, volume, or domain is created.
5. Cleanup deletes only the new confirmed service and fork, with fresh ownership
   checks and no retries. Admission expiry prevents new provisioning but does not
   itself prevent narrowly owned cleanup. Immutable evidence, source identity and
   old-intent watch checks still apply during cleanup. Verify restoration of the
   two-environment baseline; source A remains owned by the original journal.

Record fork acceptance, service/configuration isolation, new-child cleanup,
unchanged original journals, and the still-pending old intent separately. Source A
cleanup requires a separate ownership-preserving handoff; whole-project cleanup
remains an authorized admin action. Neither is falsely reported complete by
baseline restoration. The fresh framework single, acceptance and crash-recovery
tests remain separate live milestones after this proof and release review.
