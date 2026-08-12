/// <reference path="../pb_data/types.d.ts" />
//
// Add `probe_runs.job_id` + a partial-unique index so the fleet aggregator can
// dedupe a RE-PROCESSED result into a true no-op.
//
// The control-plane result-consumer aggregates a worker result, then latches
// `probe_jobs.result_processed = true`. If that latch write fails (or the
// process crashes before it), the SAME job's result is re-handed to the
// aggregator next tick. Re-aggregating is NOT free: status-writer bumps
// fail_count again (inflating the dashboard's "red for N" counter), appends a
// spurious status_history row, and re-emits status.changed; run-history mints a
// DUPLICATE probe_runs row. So at-least-once corrupts flap counts + history for
// non-green services.
//
// The aggregator (result-aggregator.ts) now stamps the originating fleet job id
// onto its run row and looks it up (run-history.ts `findByJobId`) BEFORE doing
// any work: a TERMINAL row for the job → skip entirely; a still-RUNNING row →
// resume on the same row instead of minting a duplicate. This migration adds
// the column the dedup keys on, plus a UNIQUE index that is PARTIAL — it only
// constrains rows with a NON-EMPTY job_id. The legacy in-process probe-invoker
// writes job_id = "" (no fleet job), and many such rows must coexist, so a
// blanket unique index would (incorrectly) reject the second empty-id row. The
// `WHERE job_id != ''` clause scopes uniqueness to real fleet jobs.
//
// Additive + idempotent: a field-presence gate makes a re-run after a partial
// apply a no-op (mirrors the other fleet migrations). The index uses
// IF NOT EXISTS for the same reason. The down migration drops both.
migrate(
  (db) => {
    const dao = new Dao(db);
    let c;
    try {
      c = dao.findCollectionByNameOrId("probe_runs");
    } catch (e) {
      // The base collection isn't present yet — the create migration (lower
      // unix prefix) runs first; if it somehow hasn't, this is a no-op rather
      // than a hard failure.
      return;
    }

    // Add the field unless it already exists (idempotent re-apply).
    if (!c.schema.getFieldByName("job_id")) {
      c.schema.addField(
        new SchemaField({
          name: "job_id",
          type: "text",
          required: false,
        }),
      );
    }

    // Partial-unique index: uniqueness only over real (non-empty) fleet job
    // ids, so the legacy job_id="" in-process rows coexist freely.
    c.indexes = c.indexes || [];
    const idxSql =
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_probe_runs_job_id " +
      "ON probe_runs (job_id) WHERE job_id != ''";
    if (!c.indexes.some((ix) => ix.indexOf("idx_probe_runs_job_id") !== -1)) {
      c.indexes.push(idxSql);
    }

    dao.saveCollection(c);
  },
  (db) => {
    const dao = new Dao(db);
    let c;
    try {
      c = dao.findCollectionByNameOrId("probe_runs");
    } catch (e) {
      return;
    }
    // Drop the index first, then the field.
    if (c.indexes) {
      c.indexes = c.indexes.filter(
        (ix) => ix.indexOf("idx_probe_runs_job_id") === -1,
      );
    }
    const field = c.schema.getFieldByName("job_id");
    if (field) {
      c.schema.removeField(field.id);
    }
    dao.saveCollection(c);
  },
);
