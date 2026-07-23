/// <reference path="../pb_data/types.d.ts" />
// Lockdown: baseline.updateRule was "" (empty string) — any anonymous
// HTTP client could PATCH baseline rows, including silently flipping
// status cells from "works" to "impossible" and rewriting the
// updated_by/updated_at audit fields.
//
// The dashboard's edit flow already gates writes behind PbAuthPrompt,
// which calls pb.collection("_superusers").authWithPassword(...) before
// any pb.collection("baseline").update(...) call. With this change,
// operators still edit baseline cells exactly the same way — the only
// difference is that the request now requires the admin JWT the prompt
// already provides.
//
// Verified on prod via curl on 2026-05-28:
//   Before: PATCH /api/collections/baseline/records/<id> {} -> 200
//   After:  PATCH /api/collections/baseline/records/<id> {} -> 403
//
// list/view/create/delete already nulled or "" by the create-baseline
// migration; only updateRule is tightened here.
migrate(
  (db) => {
    const dao = new Dao(db);
    const c = dao.findCollectionByNameOrId("baseline");
    c.updateRule = null;
    dao.saveCollection(c);
  },
  (db) => {
    const dao = new Dao(db);
    const c = dao.findCollectionByNameOrId("baseline");
    c.updateRule = "";
    dao.saveCollection(c);
  },
);
