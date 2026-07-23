/// <reference path="../pb_data/types.d.ts" />
//
// PER-REPLICA ATTRIBUTION for `resource_snapshots`.
//
// WHY this migration exists: the durable forensic gauge history
// (`1779989300_create_resource_snapshots.js`) was minted when the harness ran
// as a SINGLE process (the legacy `boot()` path) — one writer, so every row was
// implicitly "the harness". The harness now runs as a FLEET: a control-plane
// plus N (≈6) worker REPLICAS, each with its OWN long-lived chromium
// `BrowserPool` and its own snapshot writer. Without a worker stamp, all
// replicas' rows interleave anonymously in one collection and a post-wedge
// query can no longer tell WHICH replica's pool was approaching the cgroup
// `pids.max` ceiling — defeating the whole point of the durable trail on a
// multi-replica deploy.
//
// FIX: add a nullable `worker_id` text column carrying the SAME stable id the
// worker stamps on `workers.worker_id` and `probe_jobs.claimed_by`
// (`worker-${HOSTNAME}`), so resource snapshots JOIN to the roster + the claim
// history on one value. NULLABLE on purpose: the legacy single-process
// `boot()` path has no worker identity and writes rows with `worker_id` as an
// empty string (`""`), so a query can cleanly separate fleet-replica rows
// (worker_id present) from a legacy single-process row (worker_id == "") — same
// present-vs-unavailable discipline the gauge columns already use.
//
// INDEX: a composite `(worker_id, observed_at DESC)` so the common per-replica
// lookback ("the last N snapshots for worker-X around the wedge") is a single
// indexed scan, and the writer's per-replica ring prune (each replica prunes
// only ITS OWN rows — see resource-snapshot-writer.ts SINGLE→MULTI-WRITER note)
// lists its oldest rows cheaply.
migrate(
  (db) => {
    const dao = new Dao(db);
    let c;
    try {
      c = dao.findCollectionByNameOrId("resource_snapshots");
    } catch {
      // The base collection isn't present (migrations run in order, so this
      // should not happen) — nothing to alter. Fail soft like the create
      // migration's idempotency guards rather than throwing on a fresh DB.
      return;
    }
    // Idempotency: re-running after a partial apply must be a no-op. Add the
    // field only when absent (mirrors 1779989900_probe_runs_add_job_id.js).
    if (!c.schema.getFieldByName("worker_id")) {
      c.schema.addField(
        new SchemaField({
          name: "worker_id",
          type: "text",
          // Nullable: the legacy single-process boot() path has no worker
          // identity and writes rows with worker_id as an empty string ("");
          // only fleet replicas stamp a real `worker-${HOSTNAME}` value.
          required: false,
        }),
      );
    }
    // Per-replica lookback + per-replica ring-prune key. IF NOT EXISTS + a
    // presence-gate so a re-apply doesn't push a duplicate clause.
    c.indexes = c.indexes || [];
    const idxSql =
      "CREATE INDEX IF NOT EXISTS idx_resource_snapshots_worker " +
      "ON resource_snapshots (worker_id, observed_at DESC)";
    if (
      !c.indexes.some(
        (ix) => ix.indexOf("idx_resource_snapshots_worker") !== -1,
      )
    ) {
      c.indexes.push(idxSql);
    }
    dao.saveCollection(c);
  },
  (db) => {
    const dao = new Dao(db);
    let c;
    try {
      c = dao.findCollectionByNameOrId("resource_snapshots");
    } catch {
      return;
    }
    // Drop the index first, then the field (mirrors the down migration idiom).
    if (c.indexes) {
      c.indexes = c.indexes.filter(
        (ix) => ix.indexOf("idx_resource_snapshots_worker") === -1,
      );
    }
    const field = c.schema.getFieldByName("worker_id");
    if (field) {
      c.schema.removeField(field.id);
    }
    dao.saveCollection(c);
  },
);
