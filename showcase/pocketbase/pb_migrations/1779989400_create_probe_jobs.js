/// <reference path="../pb_data/types.d.ts" />
//
// Fleet pull-queue: one row per queued probe invocation. Workers pull
// (CLAIM) pending rows, renew a lease while running, then release on
// completion/failure. Distinct from `probe_runs` (run-level history) and
// `status`/`status_history` (per-result state machine) — this collection
// is the work queue the fleet's workers race over.
//
// ── ATOMIC-CLAIM INVARIANT (R2, proven empirically) ──────────────────
// The harness authenticates to PB as a SUPERUSER, and superuser writes
// BYPASS collection updateRules. A spike against PB 0.22.21 with 20
// concurrent claimers showed:
//   - superuser naive PATCH:           20/20 "win"  (rules bypassed)
//   - worker-auth rule-guarded PATCH:  4–10 winners (rule admission is
//                                      NOT transactional with the write —
//                                      multiple claimers pass the
//                                      `status = "pending"` check then all
//                                      write)
//   - JSVM routerAdd + runInTransaction CAS: EXACTLY 1 winner, every run
// So the ONLY mechanism that yields exactly-one-winner is a server-side
// compare-and-set inside a DB transaction (this hook, see
// pb_hooks/fleet-claim.pb.js). The updateRule below is therefore set to
// `null` (superuser/endpoint-only) — workers MUST go through the
// transactional endpoints, never a direct PATCH.
//
// Field semantics (mirrored in harness src/fleet/job-claim.ts):
//   - probe_key       : probe/service identifier this job runs.
//   - status          : pending|claimed|running|done|failed.
//   - claimed_by      : worker id that won the claim (empty while pending).
//   - lease_expires_at: ISO timestamp; the claim/lease is valid until this
//                       moment. A reaper (or any claimer) may reclaim a
//                       row whose lease has expired even if status is
//                       claimed/running — see the endpoint's expiry path.
//   - version         : monotonic counter bumped on every successful
//                       state transition; lets callers detect they were
//                       superseded (lease stolen) without a full re-read.
migrate(
  (db) => {
    const dao = new Dao(db);
    // Idempotency: skip when the collection already exists (mirrors the
    // probe_runs presence-gate pattern). PB JSVM has no typed
    // ErrCollectionNotFound, so catch broadly.
    try {
      dao.findCollectionByNameOrId("probe_jobs");
      return;
    } catch (e) {
      // Not present — fall through to create.
    }
    const c = new Collection({
      name: "probe_jobs",
      type: "base",
      schema: [
        { name: "probe_key", type: "text", required: true },
        {
          name: "status",
          type: "select",
          required: true,
          options: {
            values: ["pending", "claimed", "running", "done", "failed"],
            maxSelect: 1,
          },
        },
        { name: "claimed_by", type: "text" },
        { name: "lease_expires_at", type: "date" },
        { name: "version", type: "number", options: { min: 0 } },
      ],
      indexes: [
        // Primary pull pattern: "find a pending job" — served by the
        // status index without a sort step.
        "CREATE INDEX IF NOT EXISTS idx_probe_jobs_status ON probe_jobs (status)",
        // Reaper pattern: "find expired leases" scans claimed/running rows
        // by lease_expires_at.
        "CREATE INDEX IF NOT EXISTS idx_probe_jobs_lease ON probe_jobs (lease_expires_at)",
      ],
      // Authed read so a worker (or the dashboard) can enumerate the queue.
      // Writes are endpoint-only: createRule/updateRule/deleteRule = null.
      // Claims/renews/releases go through the transactional JSVM endpoints
      // (pb_hooks/fleet-claim.pb.js) which are the ONLY atomically-safe
      // path given the superuser-bypass invariant documented above.
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });
    dao.saveCollection(c);
  },
  (db) => {
    const dao = new Dao(db);
    // Narrowed: a real deleteCollection failure must propagate. Absent →
    // nothing to do.
    let c;
    try {
      c = dao.findCollectionByNameOrId("probe_jobs");
    } catch (e) {
      return;
    }
    dao.deleteCollection(c);
  },
);
