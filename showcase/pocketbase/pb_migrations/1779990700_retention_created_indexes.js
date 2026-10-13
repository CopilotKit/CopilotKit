/// <reference path="../pb_data/types.d.ts" />
//
// Add a `created` index to `diag_events`, `status_history` and `cvdiag_events`
// so the harness retention job (harness/src/storage/pb-retention.ts) can
// range-scan the oldest expired rows. No existing index on these tables leads
// with `created`:
// - diag_events: idx_diag_events_run_id (run_id, created) and
//   idx_diag_events_boundary (boundary, created), from 1779990100.
// - cvdiag_events: its indexes lead with test_id, ts, slug or schema_version
//   (1779990200); retention cuts it by `created`, not by the free-text `ts`.
// - status_history: on an instance where 1745193700 created the collection
//   (every fresh volume), idx_sh_key_observed (key, ...),
//   idx_sh_dimension_observed (dimension, ...) and idx_sh_transition
//   (transition). The 1776789000/1776789100 reconciles do not touch the
//   indexes of an existing collection. Only where one of them created the
//   collection does it have idx_sh_key_observed and idx_sh_transition_partial
//   instead, both leading with `key`.
// So `created < cutoff ORDER BY created` would otherwise be a full table scan
// on every batch. (`probe_runs.started_at` is already indexed:
// idx_probe_runs_started.)
//
// WHY RAW SQL, NOT dao.saveCollection: in PB 0.22 saveCollection runs
// SyncRecordTableSchema, which DROPS AND REBUILDS EVERY index listed on the
// collection in one transaction. On the production volume (status_history is
// tens of millions of rows) that would rebuild every existing index at boot
// on a nearly-full disk. Instead we create ONLY the new index with
// `CREATE INDEX IF NOT EXISTS`, then append its definition to the
// collection's `indexes` metadata with a direct `_collections` update so the
// Admin UI and any later saveCollection know about it. Both steps are
// idempotent (IF NOT EXISTS + an exact index-name presence check), so a
// re-run is a no-op. The presence check compares whole index names: a
// substring check would treat e.g. `idx_sh_created_key` as `idx_sh_created`,
// skip the metadata append and leave SQLite and the metadata out of sync.
//
// Note: building the index on a large table is still a single CREATE INDEX
// inside this migration's transaction (boot blocks until it finishes and the
// WAL grows by roughly the index size). It is one narrow (created, rowid)
// index per table.
//
// goja (PB 0.22): no ES2020+ syntax (no optional chaining, nullish
// coalescing or numeric separators).
migrate(
  (db) => {
    const dao = new Dao(db);
    const targets = retentionIndexTargets();
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      let c;
      try {
        c = dao.findCollectionByNameOrId(target.collection);
      } catch (e) {
        // Only a genuine not-found may skip. Any other lookup error (a locked
        // or corrupt database, a broken _collections row) fails the migration
        // loudly instead of being reported as a missing collection.
        if (!isNotFound(e)) throw e;
        // The collection's create migration has a lower prefix and normally
        // runs first, so absence means it was dropped or never applied.
        // Nothing to index. Log so the gap is visible.
        console.log(
          "[migration 1779990700] " +
            target.collection +
            " missing — " +
            target.name +
            " NOT created",
        );
        continue;
      }
      const sql = retentionIndexSql(target);
      db.newQuery(sql).execute();
      const indexes = (c.indexes || []).slice();
      const present = indexes.some(function (ix) {
        return retentionIndexName(ix) === target.name;
      });
      if (!present) {
        indexes.push(sql);
        db.newQuery(
          "UPDATE `_collections` SET `indexes` = {:indexes} WHERE `id` = {:id}",
        )
          .bind({ indexes: JSON.stringify(indexes), id: c.id })
          .execute();
      }
    }
  },
  (db) => {
    const dao = new Dao(db);
    const targets = retentionIndexTargets();
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      db.newQuery("DROP INDEX IF EXISTS `" + target.name + "`").execute();
      let c;
      try {
        c = dao.findCollectionByNameOrId(target.collection);
      } catch (e) {
        if (!isNotFound(e)) throw e;
        continue;
      }
      const indexes = (c.indexes || []).filter(function (ix) {
        return retentionIndexName(ix) !== target.name;
      });
      db.newQuery(
        "UPDATE `_collections` SET `indexes` = {:indexes} WHERE `id` = {:id}",
      )
        .bind({ indexes: JSON.stringify(indexes), id: c.id })
        .execute();
    }
  },
);

// One entry per indexed collection. An applied migration never runs again, so
// a new target needs a new migration; adding it here only reaches fresh volumes.
function retentionIndexTargets() {
  return [
    {
      collection: "diag_events",
      name: "idx_diag_events_created",
      column: "created",
    },
    { collection: "status_history", name: "idx_sh_created", column: "created" },
    {
      collection: "cvdiag_events",
      name: "idx_cvdiag_events_created",
      column: "created",
    },
  ];
}

// findCollectionByNameOrId throws Go's sql.ErrNoRows ("sql: no rows in result
// set") when the collection does not exist. Anything else is a real failure.
function isNotFound(e) {
  return /no rows in result set/.test(String(e && e.message ? e.message : e));
}

function retentionIndexSql(target) {
  return (
    "CREATE INDEX IF NOT EXISTS `" +
    target.name +
    "` ON `" +
    target.collection +
    "` (`" +
    target.column +
    "`)"
  );
}

// The exact index name in a CREATE INDEX statement: the identifier after
// CREATE [UNIQUE] INDEX [IF NOT EXISTS], without its `, " or [] quoting.
function retentionIndexName(sql) {
  const m =
    /^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"[]?([^`"\]\s(]+)/i.exec(
      String(sql),
    );
  return m ? m[1] : "";
}
