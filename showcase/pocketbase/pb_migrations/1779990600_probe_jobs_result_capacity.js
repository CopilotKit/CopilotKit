/// <reference path="../pb_data/types.d.ts" />
// A complete 42-cell canonical D5 result measured 106,703 UTF-8 bytes and
// exceeded the original 64 KiB limit. Retain every cell and proof field;
// bound the complete result at the existing status/history signal ceiling.
migrate(
  (db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("probe_jobs");
    const field = collection.schema.getFieldByName("result");
    if (!field || field.type !== "json") {
      throw new Error("Expected probe_jobs.result JSON field");
    }
    const maxSize = 2000000;
    if (field.options && field.options.maxSize >= maxSize) return;
    field.options.maxSize = maxSize;
    dao.saveCollection(collection);
  },
  () => {
    // Intentionally retain capacity on rollback: larger results may already
    // exist. Restoring 64 KiB would invalidate retained data and break writes.
    // Older application images read the same unchanged result JSON shape.
  },
);
