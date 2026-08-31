/// <reference path="../pb_data/types.d.ts" />
//
// Fleet pull-queue payload column. The S0 collection migration
// (1779989400_create_probe_jobs.js) shaped `probe_jobs` for the row-level
// CLAIM primitive (probe_key/status/claimed_by/lease_expires_at/version) —
// the atomic compare-and-set that decides exactly-one-winner. It deliberately
// carries NO job body, because the claim CAS only needs the lifecycle columns.
//
// The control-plane ↔ worker QUEUE layer (harness src/fleet/queue-client.ts,
// implementing FleetQueueClient over S0's JobClaimClient) needs the row to
// also carry the per-service WORK to run: the serialized `ServiceJobPayload`
// (probeKey/serviceSlug/driverKind/cellIds/driverInputs/meta). The
// control-plane WRITES it at enqueue time and the worker READS it back after
// it wins the claim — it must survive the enqueue→claim process boundary, so
// it lives on the row, not in memory. This migration adds that one JSON column
// without disturbing the claim-CAS schema S0 owns.
//
// JSON (not text): the payload is a structured object the worker re-hydrates
// into a typed ServiceJobPayload; a JSON column lets PB store/return it as an
// object rather than a string the client must double-encode. 64KB ceiling
// matches resource_snapshots.per_browser — a per-service payload is a handful
// of small fields plus optional cell-id/driver-input lists, comfortably under
// the cap.
//
// Additive + idempotent: a presence-check on the field makes a re-run after a
// partial apply a no-op (mirrors the collection-presence gate in the create
// migrations). The down migration drops the column but leaves the collection.
migrate(
  (db) => {
    const dao = new Dao(db);
    let c;
    try {
      c = dao.findCollectionByNameOrId("probe_jobs");
    } catch (e) {
      // The base collection isn't present yet — nothing to extend. The S0
      // create migration runs first (lower unix prefix); if it somehow has
      // not, this is a no-op rather than a hard failure.
      return;
    }
    // Idempotency: skip when the column already exists.
    if (c.schema.getFieldByName("payload")) {
      return;
    }
    c.schema.addField(
      new SchemaField({
        name: "payload",
        type: "json",
        options: { maxSize: 65536 },
      }),
    );
    dao.saveCollection(c);
  },
  (db) => {
    const dao = new Dao(db);
    let c;
    try {
      c = dao.findCollectionByNameOrId("probe_jobs");
    } catch (e) {
      return;
    }
    if (!c.schema.getFieldByName("payload")) {
      return;
    }
    c.schema.removeField(c.schema.getFieldByName("payload").id);
    dao.saveCollection(c);
  },
);
