/// <reference path="../pb_data/types.d.ts" />
// Lock down `baseline.createRule`. The `1777700000_create_baseline.js`
// migration shipped with `createRule: ""` — empty-string in PB rule
// semantics means "any caller can create", which makes the collection
// publicly writable. The dashboard never creates baseline rows from the
// browser (status-writer + offline tooling do, both with admin auth), so
// `null` ("only admins") is the correct lockdown.
//
// Down: restore the original empty-string rule for legacy compatibility,
// matching the shape `create_baseline.js` left it in. This keeps
// up→down→up loops idempotent.
migrate(
  (db) => {
    const dao = new Dao(db);
    let c;
    try {
      c = dao.findCollectionByNameOrId("baseline");
    } catch {
      // Collection not present on this instance — nothing to lock down.
      return;
    }
    if (c.createRule === null) {
      return;
    }
    c.createRule = null;
    dao.saveCollection(c);
  },
  (db) => {
    const dao = new Dao(db);
    let c;
    try {
      c = dao.findCollectionByNameOrId("baseline");
    } catch {
      return;
    }
    if (c.createRule === "") {
      return;
    }
    c.createRule = "";
    dao.saveCollection(c);
  },
);
