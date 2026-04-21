/// <reference path="../pb_data/types.d.ts" />
// Drop `fail_count` from `status_history`. The 1776789000 recreate migration
// added this field, but status-writer never writes it on the history path
// (it lives on the `status` row, not per-history-tick). Result: every
// history row has `fail_count` = empty, which forces downstream consumers
// to treat undefined-vs-0 asymmetrically. Simpler to remove from the schema
// entirely than to wire a write-path that only ever writes 0.
//
// The `status` collection keeps `fail_count` — that's where flap counting
// genuinely lives.
migrate(
  (db) => {
    const dao = new Dao(db);
    let c;
    try {
      c = dao.findCollectionByNameOrId("status_history");
    } catch (e) {
      // Collection not present on this instance — nothing to drop.
      return;
    }
    const existing = c.schema.getFieldByName("fail_count");
    if (!existing) {
      return;
    }
    c.schema.removeField(existing.id);
    dao.saveCollection(c);
  },
  (db) => {
    const dao = new Dao(db);
    let c;
    try {
      c = dao.findCollectionByNameOrId("status_history");
    } catch (e) {
      return;
    }
    if (c.schema.getFieldByName("fail_count")) {
      return;
    }
    // Deterministic id (15 chars, PB convention) so repeated up/down
    // cycles don't mint a fresh random id per roll. Without an explicit
    // id, PB autogenerates one; the re-added field is schematically
    // equivalent but has a different id than pre-drop, which breaks
    // idempotency across rollback→reapply loops.
    c.schema.addField(
      new SchemaField({
        id: "shfailcount001",
        name: "fail_count",
        type: "number",
      }),
    );
    dao.saveCollection(c);
  },
);
