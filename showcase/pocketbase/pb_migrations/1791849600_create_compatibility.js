/// <reference path="../pb_data/types.d.ts" />
migrate(
  (db) => {
    const dao = new Dao(db);
    try {
      dao.findCollectionByNameOrId("compatibility");
      return;
    } catch {
      // Fresh environment: create the same saved-result collection.
    }
    dao.saveCollection(
      new Collection({
        name: "compatibility",
        type: "base",
        schema: [
          { name: "key", type: "text", required: true },
          { name: "snapshot", type: "json", options: { maxSize: 750000 } },
          {
            name: "source_commits",
            type: "json",
            options: { maxSize: 100000 },
          },
          { name: "last_attempt_at", type: "date", required: true },
          {
            name: "last_attempt_status",
            type: "select",
            required: true,
            options: { values: ["success", "failed"], maxSelect: 1 },
          },
          { name: "error", type: "text" },
          { name: "run_url", type: "url" },
        ],
        indexes: [
          "CREATE UNIQUE INDEX idx_compatibility_key ON compatibility (key)",
        ],
        listRule: "",
        viewRule: "",
        createRule: null,
        updateRule: null,
        deleteRule: null,
      }),
    );
  },
  (db) => {
    const dao = new Dao(db);
    let collection;
    try {
      collection = dao.findCollectionByNameOrId("compatibility");
    } catch {
      return; // Already absent.
    }
    dao.deleteCollection(collection);
  },
);
