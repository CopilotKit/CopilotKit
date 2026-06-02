/// <reference path="../pb_data/types.d.ts" />
// D6 neutral "no-evidence" state: append `"unknown"` to the `state` select
// enum on BOTH `status` and `status_history`, and append the neutral
// `"cleared"` transition to the `status_history.transition` enum.
//
// WHY THIS IS MANDATORY: the `state` field is a CLOSED PB `select` enum
// (see 1776789100_recreate_collections_v2.js: values ["green","red",
// "degraded"]). Without widening it, every status-writer success-path write
// carrying the new `state:"unknown"` value 400s (validation error) and
// fails-closed silently — the harness logs `pb_schema_error` and the cell
// never updates. Likewise the writer now emits `transition:"cleared"` for an
// unknown tick on the `status_history` row; that select enum must accept it
// or the history create 400s. See showcase/harness/src/types/index.ts
// (`State` / `Transition` unions) and src/writers/status-writer.ts.
//
// Append-only + idempotent: we only add the value if it's missing, so this
// is safe to re-apply on any instance regardless of whether an earlier
// migration revision already added it.
migrate(
  (db) => {
    const dao = new Dao(db);

    // Append `value` to the named select field's options.values iff absent.
    // Returns true when a change was made (so we only saveCollection on dirt).
    const appendEnumValue = (collectionName, fieldName, value) => {
      let c;
      try {
        c = dao.findCollectionByNameOrId(collectionName);
      } catch (e) {
        // Collection not present on this instance — nothing to widen.
        return false;
      }
      const field = c.schema.getFieldByName(fieldName);
      if (!field || field.type !== "select") return false;
      const opts = field.options || {};
      const values = Array.isArray(opts.values) ? opts.values.slice() : [];
      if (values.indexOf(value) !== -1) return false;
      values.push(value);
      field.options = Object.assign({}, opts, { values: values });
      dao.saveCollection(c);
      return true;
    };

    appendEnumValue("status", "state", "unknown");
    appendEnumValue("status_history", "state", "unknown");
    appendEnumValue("status_history", "transition", "cleared");
  },
  (db) => {
    const dao = new Dao(db);

    // Remove `value` from the named select field's options.values iff present.
    const removeEnumValue = (collectionName, fieldName, value) => {
      let c;
      try {
        c = dao.findCollectionByNameOrId(collectionName);
      } catch (e) {
        return false;
      }
      const field = c.schema.getFieldByName(fieldName);
      if (!field || field.type !== "select") return false;
      const opts = field.options || {};
      const values = Array.isArray(opts.values) ? opts.values.slice() : [];
      const idx = values.indexOf(value);
      if (idx === -1) return false;
      values.splice(idx, 1);
      field.options = Object.assign({}, opts, { values: values });
      dao.saveCollection(c);
      return true;
    };

    removeEnumValue("status", "state", "unknown");
    removeEnumValue("status_history", "state", "unknown");
    removeEnumValue("status_history", "transition", "cleared");
  },
);
