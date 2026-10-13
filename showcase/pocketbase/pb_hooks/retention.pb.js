/// <reference path="../pb_data/types.d.ts" />
//
// Age-based retention for the append-only telemetry collections
// (cvdiag_events, diag_events, status_history, probe_runs).
// cvdiag_raw_byte_samples is NOT pruned here. It joins to cvdiag_events by
// `test_id`, not by a relation field, and only the cvdiag purge CLI cleans it.
// Deleting cvdiag_events rows here does not touch their samples.
//
// WHY IT LIVES HERE AND WORKS BY ROWID: none of these tables has an index
// leading with `created`, and building one on the production volume (tens of
// millions of rows) blocks PocketBase boot for as long as the build takes,
// because migrations run before `serve`. Every PB table is a SQLite rowid
// table, and rows only ever get rowid max+1 on insert, so rowid order follows
// insert order, which follows `created`. That lets us find the cutoff with a
// binary search of rowid point lookups (each one a rowid b-tree seek, no
// index needed) and delete from the bottom of the rowid range.
//
// `created` must be in PB's exact stored format, "YYYY-MM-DD HH:MM:SS.sssZ"
// with exactly 3 fraction digits. Only that format sorts as text in time
// order against the cutoff, so every check and the delete itself compare
// only values that match it. Any other value (empty, NULL, no fraction,
// other precision, ISO "T" form) is never deleted, and it does not block the
// table either: the probes treat its created as unknown and step past it to
// the next well-formed row. The first such row a pass finds in a table is
// logged with a WARN "malformed created at rowid N" line, so it can be fixed
// or removed by hand.
//
// The order assumption is checked before every delete, on well-formed rows
// only. The real check is 15 rows sampled evenly between the lowest rowid and
// the cutoff rowid: each must be older than the window. (The end points and
// the row just above the cutoff are fixed by the binary search itself, so they
// only catch rows changing during the pass.) The lowest row must also not be
// newer than the highest one by more than the skew allowance. When the lowest
// row is already inside the window, rows between it and the top are sampled
// too, so old rows stuck above a newer one are reported instead of passing as
// "nothing older". If any check fails, that table is skipped for the pass and
// an ERROR line is logged. We never guess. An error before the table loop
// starts is logged as "ERROR pass failed before the table loop".
// As a second guard, the delete itself also filters on `created` and its
// format, so a row inside the window is never deleted even if the sampling
// missed a disorder. (A VACUUM renumbers rowids but keeps their order, so it
// does not break this.)
//
// Deletes are raw SQL in small batches. Each batch is its own statement, so
// its own short transaction, on the app's single-connection write handle,
// which PB's own record writes also go through, and we sleep between batches.
// Normal API writes interleave between batches instead of waiting for the
// whole pass. Raw SQL means no record hooks or realtime events fire for the
// deleted rows; nothing depends on them for these collections (no relation or
// file fields point at them, and no hook listens for their deletes).
//
// Config (env on the pocketbase service):
//   Read once when the hooks load (a change needs a restart):
//   PB_RETENTION_ENABLED            unset/true/1/yes/on runs the job;
//                                   false/0/no/off disables it; any other
//                                   value also disables it, with an ERROR
//   PB_RETENTION_CRON               schedule, default every 5 minutes; an
//                                   invalid value logs an ERROR and uses the
//                                   default
//   Read at the start of every pass:
//   PB_RETENTION_<COLLECTION>_DAYS  window per table, default 30, 1..3650
//                                   (e.g. PB_RETENTION_STATUS_HISTORY_DAYS);
//                                   an invalid value skips that table with
//                                   an ERROR, it never falls back to 30
//   PB_RETENTION_MAX_ROWS_PER_PASS  per table per pass, default 50000; an
//                                   invalid value logs a WARN and uses it
//
// PB 0.22 JSVM constraints this file obeys (same as the other hooks): the
// cron callback is serialized and re-run in a pooled runtime that cannot see
// this file's top-level declarations, so everything the pass needs is defined
// inside the callback. No ES2020+ syntax.

(() => {
  const rawEnabled = String($os.getenv("PB_RETENTION_ENABLED") || "");
  const enabled = rawEnabled.trim().toLowerCase();
  if (["false", "0", "no", "off"].indexOf(enabled) !== -1) {
    console.log(
      "[pb-retention] disabled by PB_RETENTION_ENABLED=" + rawEnabled,
    );
    return;
  }
  if (["", "true", "1", "yes", "on"].indexOf(enabled) === -1) {
    // This job deletes data, so a value we cannot read turns it off.
    console.log(
      "[pb-retention] ERROR unrecognized PB_RETENTION_ENABLED=" +
        JSON.stringify(rawEnabled) +
        ", retention is disabled (use true/1/yes/on or false/0/no/off)",
    );
    return;
  }

  // cronAdd reports a bad expression with a Go panic that a JS try/catch
  // cannot catch: it aborts this whole file and no job is scheduled. So the
  // expression is checked here first, with the same rules as PB 0.22's
  // tools/cron NewSchedule (a macro, or exactly 5 single-space-separated
  // segments of `*`, `n`, `a-b`, `*/s` or `a-b/s` lists, within each
  // segment's range). The check may be stricter than PB, never looser.
  const validCron = (expr) => {
    const macros = [
      "@yearly",
      "@annually",
      "@monthly",
      "@weekly",
      "@daily",
      "@midnight",
      "@hourly",
    ];
    if (macros.indexOf(expr) !== -1) return true;
    const segments = expr.split(" ");
    if (segments.length !== 5) return false;
    const bounds = [
      [0, 59],
      [0, 23],
      [1, 31],
      [1, 12],
      [0, 6],
    ];
    const num = (s) => (/^\d{1,2}$/.test(s) ? Number(s) : NaN);
    for (let i = 0; i < 5; i++) {
      const min = bounds[i][0];
      const max = bounds[i][1];
      const parts = segments[i].split(",");
      for (let j = 0; j < parts.length; j++) {
        const stepParts = parts[j].split("/");
        if (stepParts.length > 2) return false;
        let step = 1;
        if (stepParts.length === 2) {
          step = num(stepParts[1]);
          if (!(step >= 1 && step <= max)) return false;
        }
        if (stepParts[0] === "*") continue;
        const range = stepParts[0].split("-");
        if (range.length === 1) {
          if (step !== 1) return false;
          const v = num(range[0]);
          if (!(v >= min && v <= max)) return false;
        } else if (range.length === 2) {
          const lo = num(range[0]);
          const hi = num(range[1]);
          if (!(lo >= min && lo <= max)) return false;
          if (!(hi >= lo && hi <= max)) return false;
        } else {
          return false;
        }
      }
    }
    return true;
  };

  const defaultCron = "*/5 * * * *";
  const rawCron = String($os.getenv("PB_RETENTION_CRON") || "");
  let cron = rawCron.trim();
  if (cron === "") {
    cron = defaultCron;
  } else if (!validCron(cron)) {
    console.log(
      "[pb-retention] ERROR invalid PB_RETENTION_CRON=" +
        JSON.stringify(rawCron) +
        ", using " +
        defaultCron,
    );
    cron = defaultCron;
  }
  cronAdd("pb_retention", cron, pbRetentionPass);
  console.log("[pb-retention] scheduled: " + cron);
})();

function pbRetentionPass() {
  const TABLES = [
    "cvdiag_events",
    "diag_events",
    "status_history",
    "probe_runs",
  ];
  const DEFAULT_DAYS = 30;
  const DEFAULT_MAX_ROWS = 50000;
  const BATCH = 1000;
  const PAUSE_MS = 50;
  // Sized to end well inside the default 5-minute schedule. With a shorter
  // PB_RETENTION_CRON, a pass can outlast the interval, and only the lock
  // below stops the next one from overlapping it.
  const PASS_BUDGET_MS = 4 * 60 * 1000;
  const SAMPLES = 16;
  // Rows are not inserted in strict `created` order: concurrent writers stamp
  // `created` before they get a rowid, and production shows backward steps of
  // up to 0.26 s. The order checks allow this much skew. The delete itself
  // still filters strictly on `created`.
  const SKEW_MS = 5000;
  // PB's exact stored datetime format. DATE_GLOB is the same rule in SQL:
  // a GLOB with no `*` matches the whole value, so the length is fixed too.
  const DATE_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  const DATE_GLOB =
    "[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] " +
    "[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z";
  const LOCK_KEY = "pb_retention_lock";

  const log = (line) => console.log("[pb-retention] " + line);

  const now = Date.now();
  // Overlap guard. The lock holds "<expiry ms>:<owner token>". It expires so
  // that a pass which died without its finally cannot block retention for
  // good, and only the pass whose token is still in it may release it, so a
  // stalled pass that finishes after its lock expired cannot clear a newer
  // pass's lock. The get-then-set is not atomic; PB starts one run of this
  // job per tick, so two passes do not start at the same instant.
  const store = $app.store();
  const held = String(store.get(LOCK_KEY) || "");
  if (held !== "" && Number(held.split(":")[0]) > now) {
    log("previous pass still running, skipping this one");
    return;
  }
  const lock = now + PASS_BUDGET_MS + 30000 + ":" + $security.randomString(16);
  store.set(LOCK_KEY, lock);

  try {
    let maxRows = DEFAULT_MAX_ROWS;
    const rawMax = String($os.getenv("PB_RETENTION_MAX_ROWS_PER_PASS") || "");
    if (rawMax.trim() !== "") {
      const n = Number(rawMax.trim());
      if (/^\d+$/.test(rawMax.trim()) && n >= 1 && n <= 10000000) {
        maxRows = n;
      } else {
        // Only throughput changes, not what gets deleted, so a default is safe.
        log(
          "WARN PB_RETENTION_MAX_ROWS_PER_PASS=" +
            JSON.stringify(rawMax) +
            " is not an integer in 1..10000000, using " +
            DEFAULT_MAX_ROWS,
        );
      }
    }
    const deadline = now + PASS_BUDGET_MS;
    const readDb = $app.dao().db();
    const writeDb = $app.dao().nonconcurrentDB();

    // Rotate the starting table so a deep backlog in one cannot starve the
    // others when the pass budget runs out.
    const turn = Number(store.get("pb_retention_turn") || 0);
    store.set("pb_retention_turn", turn + 1);

    for (let t = 0; t < TABLES.length; t++) {
      const table = TABLES[(turn + t) % TABLES.length];
      const started = Date.now();
      let deleted = 0;
      let cutoff = "";
      let cut = null;
      const progress = () =>
        " deleted=" +
        deleted +
        " cutoff=" +
        JSON.stringify(cutoff) +
        " cutoff_rowid=" +
        cut +
        " elapsed_ms=" +
        (Date.now() - started);
      try {
        const daysVar = "PB_RETENTION_" + table.toUpperCase() + "_DAYS";
        const rawDays = String($os.getenv(daysVar) || "");
        let days = DEFAULT_DAYS;
        if (rawDays.trim() !== "") {
          days = Number(rawDays.trim());
          if (!/^\d+$/.test(rawDays.trim()) || days < 1 || days > 3650) {
            // A wrong window deletes rows the operator meant to keep, so
            // skip the table instead of falling back to the default.
            log(
              "ERROR table=" +
                table +
                " skipped: " +
                daysVar +
                "=" +
                JSON.stringify(rawDays) +
                " is not an integer in 1..3650",
            );
            continue;
          }
        }
        // PB stores datetimes as "YYYY-MM-DD HH:MM:SS.sssZ", which sorts as
        // text in time order (given exactly 3 fraction digits, see DATE_RE).
        const fmt = (ms) => new Date(ms).toISOString().replace("T", " ");
        cutoff = fmt(now - days * 86400000);
        const cutoffLate = fmt(now - days * 86400000 + SKEW_MS);
        const cutoffEarly = fmt(now - days * 86400000 - SKEW_MS);

        // A row with a malformed created is never deleted (the DELETE filters
        // on the format) and never blocks the table: the probes step past it
        // to the next well-formed row, as if its created were unknown. The
        // first one found is logged once per pass with a WARN.
        let malformed = false;
        const noteMalformed = (m) => {
          if (malformed) return;
          malformed = true;
          log(
            "WARN table=" +
              table +
              " malformed created at rowid " +
              m.rid +
              ": " +
              JSON.stringify(m.created) +
              " (kept; it is never deleted and the order checks skip it)",
          );
        };
        const probe = (where, params) => {
          const m = new DynamicModel({ rid: 0, created: "" });
          try {
            readDb
              .newQuery(
                "SELECT rowid AS rid, COALESCE(created, '') AS created FROM `" +
                  table +
                  "` " +
                  where,
              )
              .bind(params)
              .one(m);
          } catch (e) {
            if (/no rows in result set/.test(String(e))) return null;
            throw e;
          }
          return { rid: m.rid, created: m.created };
        };
        // DATE_GLOB and DATE_RE are the same rule, so this only fires if
        // they ever stop agreeing.
        const wellFormed = (m) => {
          if (m && !DATE_RE.test(m.created)) {
            throw new Error(
              "DATE_GLOB matched rowid " +
                m.rid +
                " but DATE_RE did not: " +
                JSON.stringify(m.created),
            );
          }
          return m;
        };
        // First well-formed row with rowid >= r, or null.
        const at = (r) => {
          const m = probe("WHERE rowid >= {:r} ORDER BY rowid LIMIT 1", {
            r: r,
          });
          if (!m || DATE_RE.test(m.created)) return m;
          noteMalformed(m);
          return wellFormed(
            probe(
              "WHERE rowid >= {:r} AND created GLOB {:glob} ORDER BY rowid LIMIT 1",
              { r: r, glob: DATE_GLOB },
            ),
          );
        };
        // Last well-formed row, or null.
        const last = () => {
          const m = probe("ORDER BY rowid DESC LIMIT 1", {});
          if (!m || DATE_RE.test(m.created)) return m;
          noteMalformed(m);
          return wellFormed(
            probe("WHERE created GLOB {:glob} ORDER BY rowid DESC LIMIT 1", {
              glob: DATE_GLOB,
            }),
          );
        };
        // Allows SKEW_MS of backward step between two rows' created.
        const plusSkew = (created) =>
          fmt(Date.parse(created.replace(" ", "T")) + SKEW_MS);

        let orderError = "";
        let empty = false;
        let top = null;
        const first = at(-9007199254740991);
        if (!first) {
          empty = true;
        } else {
          top = last();
          if (first.created > plusSkew(top.created)) {
            orderError =
              "first rowid " +
              first.rid +
              " " +
              first.created +
              " is newer than last rowid " +
              top.rid +
              " " +
              top.created;
          } else if (first.created >= cutoff) {
            // The lowest row is inside the window. Old rows can still sit
            // above it if order is broken, so sample up to the top.
            for (let i = 1; i < SAMPLES && orderError === ""; i++) {
              const r = at(
                first.rid + Math.floor(((top.rid - first.rid) * i) / SAMPLES),
              );
              if (r && r.created < cutoffEarly) {
                orderError =
                  "first rowid " +
                  first.rid +
                  " " +
                  first.created +
                  " is inside the window but rowid " +
                  r.rid +
                  " above it has created " +
                  r.created +
                  ", older than " +
                  cutoffEarly;
              }
            }
            if (orderError === "") empty = true;
          } else {
            // Largest well-formed rowid whose created is older than the
            // cutoff. Invariant: `lo` is a row older than the cutoff; the
            // first well-formed row at or above `hi` is not.
            let above = null;
            if (top.created < cutoff) {
              cut = top.rid;
            } else {
              let lo = first.rid;
              let hi = top.rid;
              while (hi - lo > 1) {
                const mid = lo + Math.floor((hi - lo) / 2);
                const r = at(mid);
                if (r.created < cutoff) lo = r.rid;
                else hi = mid;
              }
              cut = lo;
              above = at(cut + 1);
            }

            // By construction of the search, `above` and the i=0 and
            // i=SAMPLES samples already passed; they only fail if rows
            // change during the pass. The interior samples are the check.
            if (above && !(above.created >= cutoffEarly)) {
              orderError =
                "row above cutoff rowid " +
                above.rid +
                " has created " +
                above.created +
                ", expected >= " +
                cutoffEarly;
            }
            for (let i = 0; i <= SAMPLES && orderError === ""; i++) {
              const r = at(
                first.rid + Math.floor(((cut - first.rid) * i) / SAMPLES),
              );
              if (!r || r.rid > cut || !(r.created < cutoffLate)) {
                orderError =
                  "sampled rowid " +
                  (r ? r.rid : "none") +
                  " below cutoff rowid " +
                  cut +
                  " has created " +
                  (r ? r.created : "none") +
                  ", expected < " +
                  cutoffLate;
              }
            }
          }
        }
        if (orderError !== "") {
          log(
            "ERROR table=" +
              table +
              " skipped: rowid order does not follow created, " +
              orderError,
          );
          continue;
        }
        if (empty) {
          log(
            "table=" +
              table +
              " deleted=0 window_days=" +
              days +
              " (nothing older than " +
              cutoff +
              ")",
          );
          continue;
        }

        let stop = "";
        for (;;) {
          if (deleted >= maxRows) {
            stop = "row cap";
            break;
          }
          if (Date.now() >= deadline) {
            stop = "time cap";
            break;
          }
          const res = writeDb
            .newQuery(
              "DELETE FROM `" +
                table +
                "` WHERE rowid IN (SELECT rowid FROM `" +
                table +
                "` WHERE rowid <= {:cut} AND created < {:cutoff}" +
                " AND created GLOB {:glob} ORDER BY rowid LIMIT {:n})",
            )
            .bind({
              cut: cut,
              cutoff: cutoff,
              glob: DATE_GLOB,
              n: Math.min(BATCH, maxRows - deleted),
            })
            .execute();
          const n = res.rowsAffected();
          deleted += n;
          if (n === 0) break;
          sleep(PAUSE_MS);
        }
        // Runs once per table, after its drain. PASSIVE is best effort: it
        // lets later writes reuse the WAL, it does not shrink the file, and
        // it may not finish while readers are active. A failure here does not
        // undo the deletes, so it gets its own WARN.
        let ckpt = "";
        if (deleted > 0) {
          try {
            writeDb.newQuery("PRAGMA wal_checkpoint(PASSIVE)").execute();
          } catch (e) {
            ckpt = " WARN wal_checkpoint failed: " + String(e);
          }
        }
        log(
          "table=" +
            table +
            progress() +
            " window_days=" +
            days +
            (stop ? " stopped_at=" + stop : "") +
            ckpt,
        );
      } catch (e) {
        log(
          "ERROR table=" +
            table +
            " pass failed:" +
            progress() +
            " " +
            String(e),
        );
      }
    }
  } catch (e) {
    // Each table's errors are caught inside the loop, so this is a failure
    // before it (env, store or db handles). Log it; the lock is still
    // released below.
    log("ERROR pass failed before the table loop: " + String(e));
  } finally {
    if (String(store.get(LOCK_KEY) || "") === lock) store.remove(LOCK_KEY);
  }
}
