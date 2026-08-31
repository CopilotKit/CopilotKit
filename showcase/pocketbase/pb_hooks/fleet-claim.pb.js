/// <reference path="../pb_data/types.d.ts" />
//
// Fleet job-claim transactional endpoints (PB 0.22).
//
// WHY THIS EXISTS: the harness authenticates to PB as a SUPERUSER, and
// superuser writes BYPASS collection updateRules — so a rule-guarded PATCH
// (`status = "pending"`) is NOT atomically enforced. An empirical spike
// (20 concurrent claimers) confirmed a rule-guarded worker PATCH yields
// 4–10 winners, while these routerAdd + runInTransaction compare-and-set
// endpoints yield EXACTLY ONE winner every time. SQLite serializes write
// transactions, so the read-compare-write below is atomic across callers.
//
// IMPLEMENTATION NOTE (PB 0.22 JSVM gotcha): routerAdd handler callbacks
// are serialized and re-executed inside a POOLED goja runtime that does
// NOT have this file's module-top-level `function` declarations in scope.
// Referencing a top-level helper from inside a handler throws
// "X is not defined" at request time. Therefore every helper a handler
// needs is defined INSIDE that handler's closure. (Verified against
// PB 0.22.21 — the "leaseExpiryIso is not defined" failure mode.)
//
// Endpoints (all POST, JSON body, superuser auth ENFORCED server-side via the
// `$apis.requireAdminAuth()` middleware on each routerAdd — PB 0.22's JSVM
// superuser-auth echo middleware; a middleware-less routerAdd handler is
// PUBLIC. The harness client (job-claim.ts) authenticates as superuser and
// retries once on 401, so enforcement is compat-safe):
//   /api/fleet/claim    { jobId, workerId, leaseSeconds }
//                       → { claimed: bool, job?, alreadyHeld? }
//                         exactly-one-winner CAS; alreadyHeld:true marks a
//                         re-claim by the CURRENT holder on a live lease
//                         (timeout-after-commit retry idempotency)
//   /api/fleet/renew    { jobId, workerId, leaseSeconds }
//                       → { renewed: bool, job? }   only the lease holder
//   /api/fleet/release  { jobId, workerId, status }  status: done|failed|pending
//                       (status REQUIRED — no default)
//                       → { released: bool, job?, reason? }  only the holder

routerAdd(
  "POST",
  "/api/fleet/claim",
  (c) => {
    const RUNNING_STATES = ["claimed", "running"];
    // CLAMP leaseSeconds: the body is caller-supplied JSON, so a non-numeric /
    // non-positive value (string, null, NaN) falls to the 30s default, and a
    // huge value is capped at 3600s (1h) so a malformed caller can never wedge
    // a row behind a multi-day lease the sweeper would wait out. NaN > 0 is
    // false, so garbage routes to the default without an isFinite dependency.
    // FLOOR at 1s too: n > 0 admits e.g. 0.001 — a 1ms lease that is expired
    // before the response lands, making every claim instantly stealable and
    // every renew a thrash loop.
    const leaseExpiryIso = (leaseSeconds) => {
      const n = typeof leaseSeconds === "number" ? leaseSeconds : NaN;
      const secs = n > 0 ? Math.max(1, Math.min(n, 3600)) : 30;
      return new Date(Date.now() + secs * 1000).toISOString();
    };
    // A claimed/running row is reclaimable once its lease has elapsed. Empty
    // / unparseable lease is treated as expired (never let a row wedge the
    // queue forever because of a malformed timestamp).
    const leaseExpired = (rec) => {
      const raw = rec.get("lease_expires_at");
      if (!raw) return true;
      // PB stores dates as "2006-01-02 15:04:05.000Z" (space separator).
      // goja's Date.parse is strict and returns NaN for the space form
      // (unlike V8/Node, which accept it) — so normalize the space to the
      // ISO "T" separator before parsing. Without this every lease parses
      // to NaN and is wrongly treated as expired, letting any caller steal
      // a live claim. (Verified against PB 0.22.21 / goja.)
      //
      // ANCHOR the replacement to the date/time boundary
      // ("YYYY-MM-DD ") so we ONLY rewrite the canonical PB shape. A bare
      // String.replace(" ", "T") rewrites the FIRST space anywhere, which
      // would coerce a malformed/non-standard value into something that
      // parses, silently treating a LIVE claim as expired and defeating the
      // exactly-one-winner CAS. An odd shape must fall through to NaN →
      // expired-by-policy is intentional (never wedge the queue), but only
      // because the value genuinely failed to parse, not because we mangled
      // it into a parseable one.
      const t = Date.parse(String(raw).replace(/^(\d{4}-\d{2}-\d{2}) /, "$1T"));
      if (isNaN(t)) return true;
      return t <= Date.now();
    };
    const jobView = (rec) => ({
      id: rec.id,
      probe_key: rec.get("probe_key"),
      status: rec.get("status"),
      claimed_by: rec.get("claimed_by"),
      lease_expires_at: rec.get("lease_expires_at"),
      version: rec.get("version"),
    });

    const data = $apis.requestInfo(c).data || {};
    const jobId = data.jobId;
    const workerId = data.workerId;
    const leaseSeconds = data.leaseSeconds;
    if (!jobId || !workerId) {
      return c.json(400, { error: "jobId and workerId are required" });
    }
    // A non-string workerId (a JSON number) would COERCE into the text
    // claimed_by column on write — but the holder renews/releases with the
    // string form, so `claimed_by !== workerId` never matches again and the
    // row wedges until lease expiry. Reject the type up front.
    if (typeof workerId !== "string") {
      return c.json(400, { error: "workerId must be a string" });
    }
    // Same class for jobId (consistency with the workerId guard): `!jobId`
    // admits a truthy non-string (a JSON number/object) that would otherwise
    // ride into findRecordById on the dao's coercion behavior. 400 up front.
    if (typeof jobId !== "string") {
      return c.json(400, { error: "jobId must be a string" });
    }

    let claimed = false;
    let alreadyHeld = false;
    let view = null;
    // Wrap runInTransaction in try/catch so a thrown saveRecord (e.g. DB
    // constraint, transient sqlite error) does NOT escape the handler as
    // HTTP 500 — the worker client contract expects {claimed:false} on
    // refusal, and a 500 makes the worker retry-storm without backoff or
    // mis-classify the refusal class. The transaction itself rolls back on
    // throw, so DB state is consistent; we reset the JS-side flags here
    // because they may have been set inside the callback BEFORE the throw
    // (no rollback semantics for JS-side variables).
    try {
      $app.dao().runInTransaction((txDao) => {
        let rec;
        try {
          rec = txDao.findRecordById("probe_jobs", jobId);
        } catch {
          return; // unknown job → claimed stays false
        }
        const status = rec.get("status");
        // Claimable if pending, OR if its prior claim's lease has expired
        // (steal the lease from a dead worker). Terminal states never reclaim.
        const reclaimable =
          status === "pending" ||
          (RUNNING_STATES.indexOf(status) !== -1 && leaseExpired(rec));
        // Run-metadata (§4.2): capture WHICH branch won BEFORE mutating the
        // record. An expired-lease steal (claimed/running + lease elapsed) is
        // one of the two reclaim choke points and must bump reclaim_count; a
        // plain pending claim must not.
        const wasExpiredSteal =
          RUNNING_STATES.indexOf(status) !== -1 && leaseExpired(rec);
        if (!reclaimable) {
          // TIMEOUT-AFTER-COMMIT IDEMPOTENCY: a claim that COMMITTED whose
          // response was lost is retried by the SAME worker — the row is now
          // claimed by THIS workerId with a live lease, which is not
          // reclaimable, so a plain refusal would make the retry abandon a row
          // it actually holds (claimed-but-orphaned until lease expiry). Answer
          // the truth instead: the caller holds it. claimed:true so the client
          // treats it as a win; alreadyHeld marks the re-claim (informational —
          // the existing lease/expiry is RETAINED, not extended; the holder's
          // heartbeat renews it on its normal cadence).
          if (
            RUNNING_STATES.indexOf(status) !== -1 &&
            rec.get("claimed_by") === workerId &&
            !leaseExpired(rec)
          ) {
            claimed = true;
            alreadyHeld = true;
            view = jobView(rec);
          }
          return;
        }

        rec.set("status", "claimed");
        rec.set("claimed_by", workerId);
        rec.set("lease_expires_at", leaseExpiryIso(leaseSeconds));
        rec.set("version", (rec.get("version") || 0) + 1);
        // claimed_at is stamped on EVERY winning claim — it deliberately
        // restamps on a re-claim/steal, so the derived queue latency
        // (claimed_at − created) measures the LAST claim (§5.2.1 corollary).
        rec.set("claimed_at", new Date().toISOString());
        if (wasExpiredSteal) {
          rec.set("reclaim_count", (rec.get("reclaim_count") || 0) + 1);
        }
        txDao.saveRecord(rec);
        claimed = true;
        view = jobView(rec);
      });
    } catch {
      // Transaction threw (commit failure, saveRecord exception, etc.).
      // Reset JS-side flags — they may have been set inside the callback
      // before the throw, but the DB rolled back, so the documented refusal
      // shape is the truthful answer.
      claimed = false;
      alreadyHeld = false;
      view = null;
    }

    // No object-spread (goja compat caution): build the body imperatively.
    const body = claimed ? { claimed: true, job: view } : { claimed: false };
    if (alreadyHeld) body.alreadyHeld = true;
    return c.json(200, body);
  },
  $apis.requireAdminAuth(),
);

routerAdd(
  "POST",
  "/api/fleet/renew",
  (c) => {
    const RUNNING_STATES = ["claimed", "running"];
    // CLAMP leaseSeconds: the body is caller-supplied JSON, so a non-numeric /
    // non-positive value (string, null, NaN) falls to the 30s default, and a
    // huge value is capped at 3600s (1h) so a malformed caller can never wedge
    // a row behind a multi-day lease the sweeper would wait out. NaN > 0 is
    // false, so garbage routes to the default without an isFinite dependency.
    // FLOOR at 1s too: n > 0 admits e.g. 0.001 — a 1ms lease that is expired
    // before the response lands, making every claim instantly stealable and
    // every renew a thrash loop.
    const leaseExpiryIso = (leaseSeconds) => {
      const n = typeof leaseSeconds === "number" ? leaseSeconds : NaN;
      const secs = n > 0 ? Math.max(1, Math.min(n, 3600)) : 30;
      return new Date(Date.now() + secs * 1000).toISOString();
    };
    const leaseExpired = (rec) => {
      const raw = rec.get("lease_expires_at");
      if (!raw) return true;
      // PB stores dates as "2006-01-02 15:04:05.000Z" (space separator).
      // goja's Date.parse is strict and returns NaN for the space form
      // (unlike V8/Node, which accept it) — so normalize the space to the
      // ISO "T" separator before parsing. Without this every lease parses
      // to NaN and is wrongly treated as expired, letting any caller steal
      // a live claim. (Verified against PB 0.22.21 / goja.)
      //
      // ANCHOR the replacement to the date/time boundary
      // ("YYYY-MM-DD ") so we ONLY rewrite the canonical PB shape. A bare
      // String.replace(" ", "T") rewrites the FIRST space anywhere, which
      // would coerce a malformed/non-standard value into something that
      // parses, silently treating a LIVE claim as expired and defeating the
      // exactly-one-winner CAS. An odd shape must fall through to NaN →
      // expired-by-policy is intentional (never wedge the queue), but only
      // because the value genuinely failed to parse, not because we mangled
      // it into a parseable one.
      const t = Date.parse(String(raw).replace(/^(\d{4}-\d{2}-\d{2}) /, "$1T"));
      if (isNaN(t)) return true;
      return t <= Date.now();
    };
    const jobView = (rec) => ({
      id: rec.id,
      probe_key: rec.get("probe_key"),
      status: rec.get("status"),
      claimed_by: rec.get("claimed_by"),
      lease_expires_at: rec.get("lease_expires_at"),
      version: rec.get("version"),
    });

    const data = $apis.requestInfo(c).data || {};
    const jobId = data.jobId;
    const workerId = data.workerId;
    const leaseSeconds = data.leaseSeconds;
    if (!jobId || !workerId) {
      return c.json(400, { error: "jobId and workerId are required" });
    }
    // A non-string workerId (a JSON number) would COERCE into the text
    // claimed_by column on write — but the holder renews/releases with the
    // string form, so `claimed_by !== workerId` never matches again and the
    // row wedges until lease expiry. Reject the type up front.
    if (typeof workerId !== "string") {
      return c.json(400, { error: "workerId must be a string" });
    }
    // Same class for jobId (consistency with the workerId guard): `!jobId`
    // admits a truthy non-string (a JSON number/object) that would otherwise
    // ride into findRecordById on the dao's coercion behavior. 400 up front.
    if (typeof jobId !== "string") {
      return c.json(400, { error: "jobId must be a string" });
    }

    let renewed = false;
    let view = null;
    // Wrap runInTransaction in try/catch so a thrown saveRecord does NOT
    // escape as HTTP 500 — worker clients expect {renewed:false} on refusal.
    // The transaction rolls back on throw, so we reset JS-side flags to
    // match the rolled-back DB state.
    try {
      $app.dao().runInTransaction((txDao) => {
        let rec;
        try {
          rec = txDao.findRecordById("probe_jobs", jobId);
        } catch {
          return;
        }
        const status = rec.get("status");
        // Only the current lease holder may renew, and only while the row is
        // still in a running state and the lease has NOT yet expired. If the
        // lease already expired the holder lost it (another worker may have
        // stolen it) — renew must fail so the original worker stops.
        if (RUNNING_STATES.indexOf(status) === -1) return;
        if (rec.get("claimed_by") !== workerId) return;
        if (leaseExpired(rec)) return;

        // Promote claimed → running on first renew so the lifecycle is visible.
        rec.set("status", "running");
        rec.set("lease_expires_at", leaseExpiryIso(leaseSeconds));
        rec.set("version", (rec.get("version") || 0) + 1);
        txDao.saveRecord(rec);
        renewed = true;
        view = jobView(rec);
      });
    } catch {
      renewed = false;
      view = null;
    }

    return c.json(
      200,
      renewed ? { renewed: true, job: view } : { renewed: false },
    );
  },
  $apis.requireAdminAuth(),
);

routerAdd(
  "POST",
  "/api/fleet/release",
  (c) => {
    const RUNNING_STATES = ["claimed", "running"];
    // A claimed/running row's lease is elapsed once its expiry timestamp has
    // passed. Empty / unparseable lease is treated as expired (mirrors claim +
    // renew). Defined INSIDE the handler closure — PB 0.22's pooled goja runtime
    // does NOT see module-top-level declarations from a handler (the
    // "X is not defined" gotcha documented at the top of this file).
    const leaseExpired = (rec) => {
      const raw = rec.get("lease_expires_at");
      if (!raw) return true;
      // PB stores dates as "2006-01-02 15:04:05.000Z" (space separator). goja's
      // Date.parse is strict and returns NaN for the space form, so normalize the
      // space to the ISO "T" separator before parsing — ANCHORED to the date/time
      // boundary so we only rewrite the canonical PB shape (a bare replace would
      // coerce a malformed value into something parseable, defeating the CAS).
      const t = Date.parse(String(raw).replace(/^(\d{4}-\d{2}-\d{2}) /, "$1T"));
      if (isNaN(t)) return true;
      return t <= Date.now();
    };
    const jobView = (rec) => ({
      id: rec.id,
      probe_key: rec.get("probe_key"),
      status: rec.get("status"),
      claimed_by: rec.get("claimed_by"),
      lease_expires_at: rec.get("lease_expires_at"),
      version: rec.get("version"),
    });

    const data = $apis.requestInfo(c).data || {};
    const jobId = data.jobId;
    const workerId = data.workerId;
    // status is REQUIRED — the old `|| "done"` fallback silently FINISHED a
    // job whose caller omitted (or sent an empty) status, masking a protocol
    // bug as success. Validate it exactly like jobId/workerId.
    const target = data.status;
    if (!jobId || !workerId) {
      return c.json(400, { error: "jobId and workerId are required" });
    }
    // A non-string workerId (a JSON number) would COERCE into the text
    // claimed_by column on write — but the holder renews/releases with the
    // string form, so `claimed_by !== workerId` never matches again and the
    // row wedges until lease expiry. Reject the type up front.
    if (typeof workerId !== "string") {
      return c.json(400, { error: "workerId must be a string" });
    }
    // Same class for jobId (consistency with the workerId guard): `!jobId`
    // admits a truthy non-string (a JSON number/object) that would otherwise
    // ride into findRecordById on the dao's coercion behavior. 400 up front.
    if (typeof jobId !== "string") {
      return c.json(400, { error: "jobId must be a string" });
    }
    if (!target) {
      return c.json(400, {
        error: "status is required (done|failed|pending)",
      });
    }
    if (["done", "failed", "pending"].indexOf(target) === -1) {
      return c.json(400, { error: "status must be done|failed|pending" });
    }

    let released = false;
    let view = null;
    // REFUSAL REASON (threaded to the client on released:false). The caller's
    // retry truthfulness depends on one distinction: a row that is TERMINAL
    // UNDER THE CALLER'S OWN workerId can only mean the caller's earlier
    // release COMMITTED and the response was lost (timeout-after-commit) — a
    // terminal release retains claimed_by, and no other worker can set it.
    // The client (queue-client report()) uses that to proceed to its result
    // write instead of falsely declaring the result discarded.
    //   refused_terminal_same_holder — row done|failed with claimed_by ===
    //     workerId (the caller's own committed release; result still writable)
    //   refused_lease_live           — pending-target (sweeper) release on a
    //     still-live lease (the TOCTOU close below; holder is alive)
    //   refused_not_holder           — everything else (unknown row, another
    //     holder, or a terminal-target release on an already-expired lease —
    //     the caller is no longer the EFFECTIVE holder)
    let reason = null;
    // Wrap runInTransaction in try/catch so a thrown saveRecord does NOT
    // escape as HTTP 500 — worker clients expect {released:false, reason}
    // on refusal. The transaction rolls back on throw; reset JS-side flags
    // to match. Use refused_not_holder as the conservative reason for an
    // unexpected throw (treats the caller as no-longer-effective-holder,
    // which is the same class the client already handles defensively).
    try {
      $app.dao().runInTransaction((txDao) => {
        let rec;
        try {
          rec = txDao.findRecordById("probe_jobs", jobId);
        } catch {
          reason = "refused_not_holder";
          return;
        }
        // Only the current lease holder may release, and only while the row is in a
        // running state.
        const status = rec.get("status");
        if (RUNNING_STATES.indexOf(status) === -1) {
          reason =
            (status === "done" || status === "failed") &&
            rec.get("claimed_by") === workerId
              ? "refused_terminal_same_holder"
              : "refused_not_holder";
          return;
        }
        if (rec.get("claimed_by") !== workerId) {
          reason = "refused_not_holder";
          return;
        }
        // The lease-expiry gate applies ONLY to TERMINAL targets (done|failed). If
        // the lease already expired the holder LOST it (the sweeper may have
        // re-queued it, or another worker may have stolen the claim) — letting a
        // stale worker clobber terminal state would violate the exactly-one-winner
        // invariant. Mirror renew's holder-lost-it semantics: reject the terminal
        // release so the stale worker stops. (`claimed_by` unchanged is NOT
        // sufficient — a stolen-then-released race can transiently match; the lease
        // check is the authoritative gate for terminal writes.)
        //
        // But target === "pending" is the SWEEPER's re-queue (queue-client
        // sweepExpired calls releaseJob(jobId, claimed_by, "pending") on EXPIRED
        // rows on behalf of a crashed worker). That path operates on expired leases
        // BY DESIGN, so it must be allowed to proceed even when leaseExpired is
        // true — gating it here makes REQ-B crash reclamation inert (the sweeper
        // reclaims 0, no worker-reclaimed-pending comm error is ever synthesized). The
        // claimed_by match above still authorizes it, and re-queue to pending is
        // always safe: it just resets the row to claimable.
        if (target !== "pending" && leaseExpired(rec)) {
          // Expired lease on a terminal-target release: the caller is no longer
          // the EFFECTIVE holder (the claim is stealable/swept), so this is the
          // not-holder class, not the committed-terminal class.
          reason = "refused_not_holder";
          return;
        }
        // TOCTOU close (the sweepers' list→release race): a "pending" release is
        // a SWEEPER re-queueing an EXPIRED lease on behalf of its lapsed holder —
        // but the sweeper decided "expired" from a LISTED SNAPSHOT. If the holder
        // RENEWED between that list and this release, `claimed_by` still matches
        // and an unguarded release would yank a LIVE, just-renewed job back to
        // pending (duplicate execution + a false worker-reclaimed-pending comm
        // error on the dashboard). Re-check expiry HERE, at release time, inside
        // the same transaction: a still-live lease means the holder is alive —
        // refuse, and the sweeper's released:false path skips the row (it retries
        // on a later sweep once the lease has truly lapsed). This also guards
        // fleet-health's reclaim of a heartbeat-stale worker whose job loop is
        // still renewing: a renewing worker is alive, so refusal is correct
        // there too. leaseExpired stays byte-equivalent to the client's anchored
        // parse, so both sides agree on what "expired" means.
        if (target === "pending" && !leaseExpired(rec)) {
          reason = "refused_lease_live";
          return;
        }

        rec.set("status", target);
        if (target === "pending") {
          // Re-queue: drop ownership so it's claimable again. The (expired)
          // lease_expires_at is RETAINED — claim admits pending rows regardless
          // of lease, and the stale value now serves as the row's
          // "last in flight" marker: the queue-client's stale-pending sweep
          // skips re-queued rows whose lease is recent, so a long-running job
          // that out-lived its family's expiry window gets an actual re-run
          // instead of being claim-deleted off its original `created` age.
          rec.set("claimed_by", "");
          // Run-metadata (§4.2): the sweeper re-queue is the second reclaim
          // choke point (the first is the claim CAS's expired-lease steal) —
          // bump the durable per-job lifetime reclaim tally. finished_at
          // deliberately stays untouched (null until a TERMINAL release): a
          // re-queued job has not finished.
          rec.set("reclaim_count", (rec.get("reclaim_count") || 0) + 1);
          // CONSECUTIVE-ORPHAN CAP (§4.2, reclaimable-leases): bump the
          // per-job CONSECUTIVE re-orphan counter — distinct from the lifetime
          // `reclaim_count`. The sweeper re-queue path is the ONLY writer; the
          // claim CAS's expired-lease steal does NOT bump this counter, so a
          // healthy long-lived job that accrues peer steals does NOT exhaust
          // the MAX_RECLAIM_ATTEMPTS budget. The queue-client reads this field
          // (not `reclaim_count`) for the deletion gate.
          rec.set(
            "consecutive_orphan_count",
            (rec.get("consecutive_orphan_count") || 0) + 1,
          );
          // RECLAIMABLE-LEASES re-anchor (§4.2, layer a): stamp the re-queue
          // time so the queue-client's stale-age math ages this row off
          // `requeued_at` (not the renewal-immune `created`). This re-anchor is
          // what lets the lease-phase carve-out RE-CLAIM a stale-aged orphan
          // instead of claim-deleting it: the next sweep measures the row as
          // young again, so its "back in flight" signal is not falsified.
          rec.set("requeued_at", new Date().toISOString());
        } else {
          // Run-metadata (§4.2): terminal release (done|failed) stamps the
          // finish time so run duration (finished_at − claimed_at) is readable
          // without parsing the `result` JSON.
          rec.set("finished_at", new Date().toISOString());
          // CONSECUTIVE-ORPHAN CAP: reset the consecutive counter on every
          // terminal release so that a LATER re-orphan of this job starts with
          // a fresh budget. The lifetime `reclaim_count` is NOT reset — it
          // remains as the dashboard diagnostic for "this job was ever reclaimed".
          rec.set("consecutive_orphan_count", 0);
        }
        rec.set("version", (rec.get("version") || 0) + 1);
        txDao.saveRecord(rec);
        released = true;
        view = jobView(rec);
      });
    } catch {
      released = false;
      view = null;
      reason = "refused_not_holder";
    }

    return c.json(
      200,
      released
        ? { released: true, job: view }
        : { released: false, reason: reason },
    );
  },
  $apis.requireAdminAuth(),
);
