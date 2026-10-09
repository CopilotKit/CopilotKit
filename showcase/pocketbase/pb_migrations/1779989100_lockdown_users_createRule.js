/// <reference path="../pb_data/types.d.ts" />
// Lockdown: users.createRule was "" (empty string), allowing anonymous
// signup. The dashboard never exposes a signup flow — operators reuse the
// PocketBase superuser credentials via the PbAuthPrompt component, so
// admin-only create is the correct posture.
//
// Verified anonymous-signup vulnerability on prod via curl on 2026-05-28:
//   POST /api/collections/users/records -> 200 (an anon-probe user was
//   created and removed). After this migration, the same request returns
//   403.
//
// list/view/update/delete rules remain "id = @request.auth.id" so a
// signed-in user can still see and edit their own record.
migrate(
  (db) => {
    const dao = new Dao(db);
    const c = dao.findCollectionByNameOrId("users");
    c.createRule = null;
    dao.saveCollection(c);
  },
  (db) => {
    const dao = new Dao(db);
    const c = dao.findCollectionByNameOrId("users");
    c.createRule = "";
    dao.saveCollection(c);
  },
);
