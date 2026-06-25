/// <reference path="../pb_data/types.d.ts" />
//
// Fleet result-flow columns on the pull-queue row.
//
// The worker (harness src/fleet/worker) computes a per-service `ServiceJobResult`
// and REPORTs it through the queue protocol (FleetQueueClient.report). The
// CONTROL-PLANE aggregator (src/fleet/control-plane/result-aggregator.ts) is the
// ONLY writer of the authoritative dashboard status + run-history — but it runs
// in a DIFFERENT process from the worker. So the worker's result must survive
// the worker->control-plane process boundary the same way the inbound payload
// does (1779989500): it lives on the `probe_jobs` row, not in memory.
//
//   - result            (json) : the serialized ServiceJobResult the worker
//                                 produced. Written by the queue-client at
//                                 report time, AFTER the claim-CAS release, so
//                                 it only ever rides on a terminal (done/failed)
//                                 row the worker still owned.
//   - result_processed  (bool) : the consume-once latch. The control-plane's
//                                 result-consumer loop polls terminal rows whose
//                                 result is present and result_processed = false,
//                                 calls aggregate(result) EXACTLY ONCE, then sets
//                                 result_processed = true so the same result is
//                                 never re-aggregated (no duplicate dashboard
//                                 writes / run-history rows).
//
// Why a bool latch and not "delete the row": the row is the audit/debug trail of
// the queue, and deleting it would race the sweeper + lose history. A processed
// flag is the minimal idempotency marker and indexes cleanly for the consumer's
// "unprocessed terminal" query.
//
// 64KB JSON ceiling matches the sibling `payload` column — a ServiceJobResult is
// a handful of fields plus one small entry per d6 cell, comfortably under cap.
//
// Additive + idempotent: presence-checks make a re-run after a partial apply a
// no-op (mirrors 1779989500_probe_jobs_add_payload.js). The down migration drops
// both columns but leaves the collection.
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
    if (!c.schema.getFieldByName("result")) {
      c.schema.addField(
        new SchemaField({
          name: "result",
          type: "json",
          options: { maxSize: 65536 },
        }),
      );
      changed = true;
    }
    if (!c.schema.getFieldByName("result_processed")) {
      c.schema.addField(
        new SchemaField({
          name: "result_processed",
          type: "bool",
        }),
      );
      changed = true;
    }
    // The consumer's hot query: "terminal rows with an unprocessed result".
    // Index result_processed so the scan stays cheap as the queue grows.
    //
    // Guard the index push by index-PRESENCE, NOT by the field-`changed`
    // flag. On a partial-apply recovery the field can already exist (added
    // by a prior run that crashed before saving the index) → `changed` is
    // false, but the index is still missing. Gating on `changed` would
    // then NEVER create the index, silently degrading the consumer to a
    // full-scan forever. Presence-checking (mirrors
    // 1779989900_probe_runs_add_job_id.js) makes the index creation
    // idempotent and independent of whether the field add ran this time.
    c.indexes = c.indexes || [];
    if (
      !c.indexes.some(
        (ix) => ix.indexOf("idx_probe_jobs_result_processed") !== -1,
      )
    ) {
      c.indexes.push(
        "CREATE INDEX IF NOT EXISTS idx_probe_jobs_result_processed ON probe_jobs (result_processed)",
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
    if (c.schema.getFieldByName("result")) {
      c.schema.removeField(c.schema.getFieldByName("result").id);
      changed = true;
    }
    if (c.schema.getFieldByName("result_processed")) {
      c.schema.removeField(c.schema.getFieldByName("result_processed").id);
      changed = true;
    }
    if (changed) {
      c.indexes = c.indexes.filter(
        (ix) => ix.indexOf("idx_probe_jobs_result_processed") === -1,
      );
      dao.saveCollection(c);
    }
  },
);
