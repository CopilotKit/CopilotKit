/// <reference path="../pb_data/types.d.ts" />
//
// Add `status.written_by` — writer-identity stamping (anti-dual-writer
// hardening).
//
// Incident motivation: two harness schedulers (the legacy monolith and the
// new fleet control-plane) silently fought over the same `status` keys — the
// legacy scheduler wrote deterministic reds into d5: keys that the fleet
// aggregator overwrote green every cycle (the "flap comb"). Nothing in the
// data could attribute a row's state to the process that wrote it, so the
// dual-writer condition was invisible until an operator eyeballed the flap
// pattern.
//
// `written_by` carries the writing process's role+service identity (e.g.
// `legacy`, `fleet-cp`, `cli`), stamped by the status-writer chokepoint
// (harness/src/writers/status-writer.ts) on every durable state write. The
// writer also uses the PREVIOUS row's `written_by` to emit a structured WARN
// when a different writer flips a key green<->red within the fight window —
// observability only, no blocking.
//
// Additive + idempotent: optional text field, field-presence gate makes a
// re-run after a partial apply a no-op (mirrors the other fleet migrations).
// Rows CREATED before this migration (or created fresh by an old image)
// simply lack the field — the writer treats an absent previous `written_by`
// as unattributable and never warns on it. NOTE (round-6 A1, supersedes the
// round-5 A6iv wording): that is only true for creates. During the
// legacy/fleet coexistence window an old-image UPDATE of a row a new-image
// writer already stamped leaves the stale new-image stamp in place (PB
// updates only the fields provided) — and because the next new-image write
// then sees written_by === itself, the cross-writer flip detector is
// detection-BLIND for these same-identity flips (not merely mis-attributing
// them). Mitigated heuristically by the writer's in-memory self-write map
// (`status-writer.foreign-write-detected`), which catches the mutation
// within a process lifetime but not across restarts; the window closes for
// good when the legacy writer is decommissioned. The down migration drops
// the field.
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
        "[migration 1779990200] status collection missing — written_by NOT added; feature dark",
      );
      return;
    }

    // Add the field unless it already exists (idempotent re-apply) — return
    // early without saving so a re-run is a literal no-op.
    if (c.schema.getFieldByName("written_by")) {
      return;
    }
    c.schema.addField(
      new SchemaField({
        name: "written_by",
        type: "text",
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
    const field = c.schema.getFieldByName("written_by");
    if (field) {
      c.schema.removeField(field.id);
      dao.saveCollection(c);
    }
  },
);
