/// <reference path="../pb_data/types.d.ts" />
//
// Run-metadata columns on the pull-queue row (run visibility, spec §4.2).
//
// These five columns make a job row self-describing for the run-view
// projection (control-plane src/fleet/control-plane/run-view.ts) without
// JSON-path scans over `payload` or trusting the last-write-wins `result`
// column. Each column has exactly ONE writer:
//
//   - run_id        (text, indexed): denormalized by the queue-client's
//                     `enqueue` (CP side) from `payload.meta.runId` — groups
//                     the N per-service jobs of one producer tick into one
//                     run batch behind an indexed filter.
//   - family        (text, indexed): stamped by the queue-client's `enqueue`
//                     from the producer's family id (`EnqueueJobInput.family`,
//                     §5.1 registry) — per-family listing without
//                     prefix-parsing `probe_key`. Absent on the input →
//                     column stays empty (pre-P2 row parity).
//   - claimed_at    (date): stamped by the fleet-claim.pb.js CLAIM CAS inside
//                     the winning transaction, on EVERY winning claim — so it
//                     restamps on a re-claim/lease-steal, and the derived
//                     queue latency (`claimed_at − created`) measures the
//                     LAST claim (§5.2.1 corollary).
//   - finished_at   (date): stamped by the fleet-claim.pb.js RELEASE CAS on a
//                     terminal target (done|failed) only. The sweeper's
//                     re-queue (target "pending") leaves it null.
//   - reclaim_count (number): incremented by fleet-claim.pb.js inside BOTH
//                     reclaim choke points — the claim CAS when it wins via
//                     the expired-lease steal branch, and the release CAS
//                     when the sweeper re-queues an expired row to pending.
//                     The durable per-job reclaim tally: it survives the
//                     last-write-wins overwrite of `result` and the
//                     restamping of `claimed_at` (§5.2.1 `jobs.reclaimed`).
//
// Stamping claimed_at/finished_at in the PB hook (not the worker) keeps a
// ZERO worker-code dependency: the hook is the single transactional choke
// point all claims/releases already pass through, so an old worker image
// against a new hook gets the columns for free (§8 rollout ordering).
//
// Additive + idempotent: presence-checks make a re-run after a partial apply
// a no-op (mirrors 1779989700_probe_jobs_add_result.js). Index pushes are
// guarded by index-PRESENCE, not the field-`changed` latch, so a
// partial-apply recovery still creates a missing index. The down migration
// drops the five fields + two indexes but leaves the collection.
migrate(
  (db) => {
    const dao = new Dao(db);
    let c;
    try {
      c = dao.findCollectionByNameOrId("probe_jobs");
    } catch (e) {
      // Base collection not present yet (S0 create runs first, lower prefix).
      // No-op rather than a hard failure.
      return;
    }
    let changed = false;
    if (!c.schema.getFieldByName("run_id")) {
      c.schema.addField(
        new SchemaField({
          name: "run_id",
          type: "text",
        }),
      );
      changed = true;
    }
    if (!c.schema.getFieldByName("family")) {
      c.schema.addField(
        new SchemaField({
          name: "family",
          type: "text",
        }),
      );
      changed = true;
    }
    if (!c.schema.getFieldByName("claimed_at")) {
      c.schema.addField(
        new SchemaField({
          name: "claimed_at",
          type: "date",
        }),
      );
      changed = true;
    }
    if (!c.schema.getFieldByName("finished_at")) {
      c.schema.addField(
        new SchemaField({
          name: "finished_at",
          type: "date",
        }),
      );
      changed = true;
    }
    if (!c.schema.getFieldByName("reclaim_count")) {
      c.schema.addField(
        new SchemaField({
          name: "reclaim_count",
          type: "number",
          options: { min: 0 },
        }),
      );
      changed = true;
    }
    // Hot read patterns: "all jobs of one run batch" (run_id) and "newest
    // rows of one family" (family). Guard each index push by index-PRESENCE,
    // NOT the field-`changed` flag — on a partial-apply recovery the field
    // can already exist while the index is still missing (the 1779989700
    // gotcha), and gating on `changed` would then never create it.
    c.indexes = c.indexes || [];
    if (!c.indexes.some((ix) => ix.indexOf("idx_probe_jobs_run_id") !== -1)) {
      c.indexes.push(
        "CREATE INDEX IF NOT EXISTS idx_probe_jobs_run_id ON probe_jobs (run_id)",
      );
      changed = true;
    }
    if (!c.indexes.some((ix) => ix.indexOf("idx_probe_jobs_family") !== -1)) {
      c.indexes.push(
        "CREATE INDEX IF NOT EXISTS idx_probe_jobs_family ON probe_jobs (family)",
      );
      changed = true;
    }
    if (changed) {
      dao.saveCollection(c);
    }
  },
  (db) => {
    const dao = new Dao(db);
    let c;
    try {
      c = dao.findCollectionByNameOrId("probe_jobs");
    } catch (e) {
      return;
    }
    let changed = false;
    const names = [
      "run_id",
      "family",
      "claimed_at",
      "finished_at",
      "reclaim_count",
    ];
    for (const name of names) {
      const f = c.schema.getFieldByName(name);
      if (f) {
        c.schema.removeField(f.id);
        changed = true;
      }
    }
    if (changed) {
      c.indexes = (c.indexes || []).filter(
        (ix) =>
          ix.indexOf("idx_probe_jobs_run_id") === -1 &&
          ix.indexOf("idx_probe_jobs_family") === -1,
      );
      dao.saveCollection(c);
    }
  },
);
