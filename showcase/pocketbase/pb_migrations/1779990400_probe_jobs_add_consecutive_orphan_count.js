/// <reference path="../pb_data/types.d.ts" />
//
// Consecutive-orphan counter column on the pull-queue row (reclaimable-leases
// cap fix, P1-A).
//
//   - consecutive_orphan_count (number, nullable): the number of CONSECUTIVE
//                   sweeper re-queues that have NOT been followed by a terminal
//                   done|failed release. Bumped ONLY by the fleet-claim.pb.js
//                   RELEASE CAS on a pending re-queue (the sweeper reclaim
//                   path); reset to 0 on every terminal release (done|failed).
//                   NOT bumped by the claim CAS's expired-lease steal branch.
//
// WHY A SEPARATE COLUMN: the existing `reclaim_count` column is a LIFETIME
// tally (dashboard diagnostic: `reclaim_count > 0` → `jobs.reclaimed`). Using
// it for the MAX_RECLAIM_ATTEMPTS cap means a healthy long-lived job that
// accrues benign peer steals over its lifetime can exhaust its 3-budget, so a
// LATER unrelated orphan of that job gets claim-DELETED instead of reclaimed.
// `consecutive_orphan_count` scopes the budget to CONSECUTIVE re-orphans so
// only a poison job (re-orphans every run without ever completing) hits the
// cap, while `reclaim_count` is left as the intact lifetime diagnostic.
//
// Nullable with NO backfill: a pre-migration row has an absent field, which
// the reaper treats as 0 consecutive orphans (never re-orphaned under the new
// semantics → conservative re-queue, not delete). Stamping in the PB hook
// (not the worker) keeps a ZERO worker-code dependency (§8 rollout ordering).
//
// Additive + idempotent: the presence-check makes a re-run after a partial
// apply a no-op (mirrors 1779990200_probe_jobs_add_run_metadata.js). The down
// migration drops the field but leaves the collection.
migrate(
  (db) => {
    const dao = new Dao(db);
    let c;
    try {
      c = dao.findCollectionByNameOrId("probe_jobs");
    } catch {
      // Base collection not present yet (S0 create runs first, lower prefix).
      // No-op rather than a hard failure.
      return;
    }
    if (!c.schema.getFieldByName("consecutive_orphan_count")) {
      c.schema.addField(
        new SchemaField({
          name: "consecutive_orphan_count",
          type: "number",
          options: { min: 0 },
        }),
      );
      dao.saveCollection(c);
    }
  },
  (db) => {
    const dao = new Dao(db);
    let c;
    try {
      c = dao.findCollectionByNameOrId("probe_jobs");
    } catch {
      return;
    }
    const f = c.schema.getFieldByName("consecutive_orphan_count");
    if (f) {
      c.schema.removeField(f.id);
      dao.saveCollection(c);
    }
  },
);
