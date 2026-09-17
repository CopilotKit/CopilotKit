/// <reference path="../pb_data/types.d.ts" />
// Selected observation receipts share the authoritative job's lifetime.
// The 2 MiB cap permits compact outcomes for a 64 KiB worker result without
// duplicating signals. Exceeding it must fail the entire apply transaction.
migrate(
  (db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("probe_jobs");
    if (collection.schema.getFieldByName("result_observation_receipts")) return;
    collection.schema.addField(
      new SchemaField({
        name: "result_observation_receipts",
        type: "json",
        options: { maxSize: 2097152 },
      }),
    );
    dao.saveCollection(collection);
  },
  (db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("probe_jobs");
    const field = collection.schema.getFieldByName(
      "result_observation_receipts",
    );
    if (!field) return;
    collection.schema.removeField(field.id);
    dao.saveCollection(collection);
  },
);
