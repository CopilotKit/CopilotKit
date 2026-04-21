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
    c.schema.addField(
      new SchemaField({ name: "fail_count", type: "number" }),
    );
    dao.saveCollection(c);
  },
);
