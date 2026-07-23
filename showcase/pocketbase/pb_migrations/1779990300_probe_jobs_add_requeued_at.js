/// <reference path="../pb_data/types.d.ts" />
//
// Reclaimable-leases re-anchor column on the pull-queue row (worker
// reclamation, layer a — proposal §4.1).
//
//   - requeued_at (date, nullable): stamped by the fleet-claim.pb.js RELEASE
//                   CAS on EVERY pending re-queue (the sweeper reclaiming an
//                   expired-lease orphan back to claimable). It re-anchors the
//                   stale-age clock so the queue-client's reaper ages a
//                   reclaimed row off `requeued_at` instead of the
//                   renewal-immune system `created`. That dissolves the old
//                   long-expired carve-out's honesty bind (re-queueing a
//                   `created`-stale row used to emit a "back in flight" signal
//                   the next sweep falsified by claim-deleting it), letting the
//                   carve-out RE-CLAIM an orphaned in-flight row up to
//                   MAX_RECLAIM_ATTEMPTS (driven by the existing reclaim_count
//                   column, migration 1779990200) instead of dropping it.
//
// Nullable with NO backfill: a pre-migration / never-reclaimed row has an
// absent `requeued_at`, which the reaper's `staleAgeAnchorMs` falls back to
// `created` for — pre-migration row parity. Stamping in the PB hook (not the
// worker) keeps a ZERO worker-code dependency: the hook is the single
// transactional choke point all releases already pass through (§8 rollout).
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
    if (!c.schema.getFieldByName("requeued_at")) {
      c.schema.addField(
        new SchemaField({
          name: "requeued_at",
          type: "date",
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
    const f = c.schema.getFieldByName("requeued_at");
    if (f) {
      c.schema.removeField(f.id);
      dao.saveCollection(c);
    }
  },
);
