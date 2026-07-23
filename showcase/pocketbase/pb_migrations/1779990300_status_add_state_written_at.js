/// <reference path="../pb_data/types.d.ts" />
//
// Add `status.state_written_at` — timestamp of the last DURABLE STATE write.
//
// Motivation: the cross-writer flip detection (anti-dual-writer hardening,
// see 1779990200_status_add_written_by.js) originally windowed on the
// previous row's `observed_at`. But the status-writer's error path refreshes
// `observed_at` WITHOUT restamping `written_by` — the timestamp and the
// attribution decouple. Writer A's months-old durable state plus any
// writer's recent error tick made writer B's legitimate flip look like a
// recent "fight", violating the feature's own guarantee that months-stale
// handoffs stay silent.
//
// `state_written_at` is stamped by the status-writer chokepoint
// (harness/src/writers/status-writer.ts) ONLY on the durable-state upsert —
// the same write that stamps `written_by` — so the flip window now measures
// the age of the attributed state, not the last observation. Rows written
// before this migration (or by an old image) lack the field; the writer
// falls back to `observed_at` for them, which is conservative (a legacy row
// can still false-positive on the error-tick scenario until its next
// durable write stamps the field).
//
// Additive + idempotent: optional date field (same type as the other
// `status` timestamps — observed_at / transitioned_at), field-presence gate
// makes a re-run after a partial apply a no-op (mirrors the other fleet
// migrations). The down migration drops the field.
migrate(
  (db) => {
    const dao = new Dao(db);
    let c;
    try {
      c = dao.findCollectionByNameOrId("status");
    } catch {
      // The base collection isn't present yet — the create migration (lower
      // unix prefix) runs first; if it somehow hasn't, this is a no-op rather
      // than a hard failure (sibling convention). PB still marks this
      // migration applied, so log loudly: without this line the feature
      // would go permanently dark with zero signal.
      console.log(
        "[migration 1779990300] status collection missing — state_written_at NOT added; feature dark",
      );
      return;
    }

    // Add the field unless it already exists (idempotent re-apply) — return
    // early without saving so a re-run is a literal no-op.
    if (c.schema.getFieldByName("state_written_at")) {
      return;
    }
    c.schema.addField(
      new SchemaField({
        name: "state_written_at",
        type: "date",
        required: false,
      }),
    );

    dao.saveCollection(c);
  },
  (db) => {
    const dao = new Dao(db);
    let c;
    try {
      c = dao.findCollectionByNameOrId("status");
    } catch {
      return;
    }
    // Idempotency symmetry with the up path (round-9 #9): only save when
    // the field was actually present — a re-run after the field is already
    // gone is a literal no-op instead of a gratuitous save.
    const field = c.schema.getFieldByName("state_written_at");
    if (field) {
      c.schema.removeField(field.id);
      dao.saveCollection(c);
    }
  },
);
