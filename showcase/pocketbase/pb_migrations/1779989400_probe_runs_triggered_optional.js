/// <reference path="../pb_data/types.d.ts" />
// Make `probe_runs.triggered` NOT required on ALREADY-MIGRATED instances.
//
// WHY A SEPARATE ALTER MIGRATION: PocketBase records each applied migration
// and NEVER re-runs an edited file. The create migration
// (1777165230_create_probe_runs.js) was corrected to declare `triggered` as
// `required:false`, but that only takes effect on a FRESH database that has
// not yet run 1777165230. Any PB instance that already applied the original
// (`required:true`) create — local dev DBs and staging — keeps the old
// required flag forever unless a NEW migration re-alters the live collection.
//
// THE BUG THIS UNBLOCKS: PocketBase v0.22 validates `required:true` with
// ozzo-validation's `validation.Required`, which treats a field's ZERO VALUE
// as empty. For a bool the zero value is `false`, so a required bool REJECTS
// every write carrying `false` with `validation_required`. `triggered` is
// `false` for every SCHEDULED run (the common case), so a required `triggered`
// 400s every scheduled probe's `probe_runs` insert and blocks all run/result
// persistence — the dashboard never sees d6-all-pills-e2e (LGP) results. The
// writer (run-history.ts start()) always sends an explicit boolean, so a bool
// is never genuinely absent and requiring it buys no integrity.
//
// Idempotent: only flips the flag when it is currently `true`, so this is safe
// to re-apply on any instance (including a fresh DB where the create migration
// already set it to `false`). The down-migration restores `required:true` to
// mirror the original create schema.
migrate(
  (db) => {
    const dao = new Dao(db);

    let c;
    try {
      c = dao.findCollectionByNameOrId("probe_runs");
    } catch {
      // Collection not present on this instance — nothing to alter. The
      // create migration runs first on a fresh DB, so this only trips on an
      // instance that has never had probe_runs at all.
      return;
    }

    const field = c.schema.getFieldByName("triggered");
    if (!field || field.type !== "bool") return;
    if (field.required !== true) return; // already optional — no-op

    field.required = false;
    dao.saveCollection(c);
  },
  (db) => {
    const dao = new Dao(db);

    let c;
    try {
      c = dao.findCollectionByNameOrId("probe_runs");
    } catch {
      return;
    }

    const field = c.schema.getFieldByName("triggered");
    if (!field || field.type !== "bool") return;
    if (field.required === true) return; // already required — no-op

    field.required = true;
    dao.saveCollection(c);
  },
);
