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
// Endpoints (all POST, JSON body, superuser/worker auth required):
//   /api/fleet/claim    { jobId, workerId, leaseSeconds }
//                       → { claimed: bool, job? }   exactly-one-winner CAS
//   /api/fleet/renew    { jobId, workerId, leaseSeconds }
//                       → { renewed: bool, job? }   only the lease holder
//   /api/fleet/release  { jobId, workerId, status }  status: done|failed|pending
//                       → { released: bool, job? }   only the lease holder

routerAdd("POST", "/api/fleet/claim", (c) => {
  const RUNNING_STATES = ["claimed", "running"];
  const leaseExpiryIso = (leaseSeconds) => {
    const secs = leaseSeconds && leaseSeconds > 0 ? leaseSeconds : 30;
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

  let claimed = false;
  let view = null;
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
    if (!reclaimable) return;

    rec.set("status", "claimed");
    rec.set("claimed_by", workerId);
    rec.set("lease_expires_at", leaseExpiryIso(leaseSeconds));
    rec.set("version", (rec.get("version") || 0) + 1);
    txDao.saveRecord(rec);
    claimed = true;
    view = jobView(rec);
  });

  return c.json(
    200,
    claimed ? { claimed: true, job: view } : { claimed: false },
  );
});

routerAdd("POST", "/api/fleet/renew", (c) => {
  const RUNNING_STATES = ["claimed", "running"];
  const leaseExpiryIso = (leaseSeconds) => {
    const secs = leaseSeconds && leaseSeconds > 0 ? leaseSeconds : 30;
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

  let renewed = false;
  let view = null;
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

  return c.json(
    200,
    renewed ? { renewed: true, job: view } : { renewed: false },
  );
});

routerAdd("POST", "/api/fleet/release", (c) => {
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
  const target = data.status || "done";
  if (!jobId || !workerId) {
    return c.json(400, { error: "jobId and workerId are required" });
  }
  if (["done", "failed", "pending"].indexOf(target) === -1) {
    return c.json(400, { error: "status must be done|failed|pending" });
  }

  let released = false;
  let view = null;
  $app.dao().runInTransaction((txDao) => {
    let rec;
    try {
      rec = txDao.findRecordById("probe_jobs", jobId);
    } catch {
      return;
    }
    // Only the current lease holder may release, and only while the row is in a
    // running state.
    if (RUNNING_STATES.indexOf(rec.get("status")) === -1) return;
    if (rec.get("claimed_by") !== workerId) return;
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
    // reclaims 0, no worker-crashed-mid-job comm error is ever synthesized). The
    // claimed_by match above still authorizes it, and re-queue to pending is
    // always safe: it just resets the row to claimable.
    if (target !== "pending" && leaseExpired(rec)) return;

    rec.set("status", target);
    if (target === "pending") {
      // Re-queue: drop ownership so it's claimable again.
      rec.set("claimed_by", "");
      rec.set("lease_expires_at", null);
    }
    rec.set("version", (rec.get("version") || 0) + 1);
    txDao.saveRecord(rec);
    released = true;
    view = jobView(rec);
  });

  return c.json(
    200,
    released ? { released: true, job: view } : { released: false },
  );
});
