/// <reference path="../pb_data/types.d.ts" />
// Fixed, admin-only atomic persistence for selected fleet observations.
// Transition calculation remains in status-writer. The receipt is checked
// before CAS so an old replay cannot overwrite a newer observation.
routerAdd(
  "POST",
  "/api/fleet/observations/apply",
  (c) => {
    // Helpers must be inside the handler: PB 0.22 pools isolated JS runtimes.
    const object = (v) =>
      v !== null && typeof v === "object" && !Array.isArray(v);
    const own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
    const fields = [
      "key",
      "dimension",
      "state",
      "signal",
      "observed_at",
      "transitioned_at",
      "fail_count",
      "first_failure_at",
      "written_by",
      "state_written_at",
    ];
    const historyFields = [
      "key",
      "dimension",
      "state",
      "transition",
      "signal",
      "observed_at",
    ];
    const allowed = (v, names) =>
      object(v) && Object.keys(v).every((k) => names.indexOf(k) !== -1);
    const same = (a, b) => {
      if (a === b) return true;
      if (Array.isArray(a) && Array.isArray(b))
        return a.length === b.length && a.every((v, i) => same(v, b[i]));
      if (!object(a) || !object(b)) return false;
      const keys = Object.keys(a);
      return (
        keys.length === Object.keys(b).length &&
        keys.every((k) => own(b, k) && same(a[k], b[k]))
      );
    };
    const fail = (status, code) =>
      c.json(status, { code: status, message: code, data: { code } });
    const data = $apis.requestInfo(c).data || {};
    if (
      typeof data.jobId !== "string" ||
      !/^[a-z0-9]{15}$/.test(data.jobId) ||
      typeof data.key !== "string" ||
      !/^d[56]:[^/]+\/.+/.test(data.key) ||
      data.key.length > 65536 ||
      typeof data.fingerprint !== "string" ||
      !/^[a-f0-9]{64}$/.test(data.fingerprint)
    )
      return fail(400, "invalid_identity");
    let response;
    let rejection;
    try {
      $app.dao().runInTransaction((dao) => {
        const save = (record, values) => {
          // DAO.saveRecord alone bypasses schema validation in PB 0.22.
          const form = new RecordUpsertForm($app, record);
          form.setDao(dao);
          form.loadData(values);
          form.submit();
        };
        const jobCollection = dao.findCollectionByNameOrId("probe_jobs");
        if (!jobCollection.schema.getFieldByName("result_observation_receipts"))
          throw new Error("Observation receipt schema missing");
        const jobs = dao.findRecordsByFilter(
          "probe_jobs",
          "id = {:id}",
          "",
          1,
          0,
          { id: data.jobId },
        );
        if (!jobs.length) {
          rejection = [404, "missing_job"];
          return;
        }
        const job = jobs[0];
        const receipts =
          JSON.parse(job.getString("result_observation_receipts") || "null") ||
          {};
        if (!object(receipts))
          throw new Error("Invalid stored observation receipts");
        if (own(receipts, data.key)) {
          const receipt = receipts[data.key];
          if (receipt.fingerprint !== data.fingerprint) {
            rejection = [409, "identity_conflict"];
            return;
          }
          response = { replay: true, outcome: receipt.outcome };
          return;
        }
        const status = data.status;
        const outcome = data.outcome;
        const basis = data.basis;
        if (
          !allowed(data.history, historyFields) ||
          data.history.key !== data.key ||
          !object(outcome) ||
          !object(outcome.value) ||
          JSON.stringify(outcome).length > 1024 ||
          ["write", "overlay", "history"].indexOf(data.route) === -1 ||
          (data.route === "overlay"
            ? outcome.kind !== "overlay"
            : outcome.kind !== "write") ||
          (data.route === "history" ? status !== null : !object(status)) ||
          (status !== null &&
            (!allowed(status.values, fields) ||
              ["upsert", "patch"].indexOf(status.mode) === -1)) ||
          (status !== null &&
            status.mode === "patch" &&
            !allowed(status.values, ["signal", "observed_at"])) ||
          (status !== null &&
            status.mode === "upsert" &&
            status.values.key !== data.key) ||
          (data.route === "overlay" && status.mode !== "patch") ||
          (basis !== null &&
            (!object(basis) ||
              typeof basis.id !== "string" ||
              !allowed(basis.fields, fields) ||
              Object.keys(basis.fields).length !== fields.length))
        ) {
          rejection = [400, "invalid_plan"];
          return;
        }
        const rows = dao.findRecordsByFilter(
          "status",
          "key = {:key}",
          "",
          1,
          0,
          { key: data.key },
        );
        const row = rows.length ? rows[0] : null;
        if (
          (basis === null && row !== null) ||
          (basis !== null &&
            (row === null ||
              row.id !== basis.id ||
              !fields.every((field) =>
                same(
                  field === "signal"
                    ? JSON.parse(row.getString(field) || "null")
                    : field === "fail_count"
                      ? row.getFloat(field)
                      : row.getString(field),
                  basis.fields[field],
                ),
              ) ||
              (basis.updated !== undefined &&
                row.getString("updated") !== basis.updated)))
        ) {
          rejection = [409, "basis_conflict"];
          return;
        }
        if (status !== null) {
          if (status.mode === "patch" && !row) {
            rejection = [409, "basis_conflict"];
            return;
          }
          const target =
            row || new Record(dao.findCollectionByNameOrId("status"));
          save(target, status.values);
        }
        const audit = new Record(
          dao.findCollectionByNameOrId("status_history"),
        );
        save(audit, data.history);
        receipts[data.key] = {
          fingerprint: data.fingerprint,
          route: data.route,
          outcome,
        };
        save(job, { result_observation_receipts: receipts });
        response = { replay: false, outcome };
      });
    } catch (error) {
      console.log("[fleet-observations] transaction failed", String(error));
      return fail(500, "persistence_failure");
    }
    if (rejection) return fail(rejection[0], rejection[1]);
    return c.json(200, response);
  },
  $apis.requireAdminAuth(),
);
