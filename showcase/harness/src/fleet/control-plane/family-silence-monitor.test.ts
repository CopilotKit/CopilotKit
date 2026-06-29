import { describe, it, expect } from "vitest";
import {
  createFamilySilenceMonitor,
  FAMILY_SILENCE_RULE_ID,
  FAMILY_SILENCE_EVAL_RULE_ID,
  SILENCE_ALERT_RATE_LIMIT_MS,
  SILENCE_PERIOD_MULTIPLIER,
  SILENCE_CONSECUTIVE_TICK_THRESHOLD,
} from "./family-silence-monitor.js";
import { FLEET_FAMILIES } from "./run-view.js";
import type {
  FamilySummaryEntry,
  FamilySummaryResponse,
  InflightState,
  RunBatch,
  WorkerView,
} from "./run-view.js";
import type { ProducerSchedule } from "./control-plane.js";
import type { JobProducer } from "./job-producer.js";
import type { AlertStateStore } from "../../storage/alert-state-store.js";
import type { AlertStateRecord, Logger } from "../../types/index.js";

/**
 * Pins the §9 family-silence monitor: the per-family once-per-period
 * evaluation gate over 15 s ticks, the 3×period silence alert with
 * inflight-aware last-attempt, the §5.2.1 null-lastSuccessAt fallback, boot
 * grace over BOTH alert classes, the two-presentation evaluation-failure
 * meta-alert, per-family 6 h rate limiting via the alert-state store, the
 * recovered one-shots, and the /health lastEvaluatedAt stamp. The summary is
 * a fake returning canned §5.2.1 shapes — no PB, no run-view internals.
 */

const SILENT_LOGGER: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

/** Hourly cron for every family — resolved period 1 h. */
const CRON = "0 * * * *";
const PERIOD = 3_600_000;
/** Fixed epoch base so every timestamp in these tests is explicit. */
const BASE = Date.UTC(2026, 0, 15);

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

const stubProducer = {
  start() {},
  async stop() {},
  async tick() {
    throw new Error("stub producer: tick not used");
  },
  isRunning: () => true,
} as unknown as JobProducer;

function makeSchedules(): ProducerSchedule[] {
  return FLEET_FAMILIES.map((fam) => ({
    scheduleId: fam.scheduleId,
    cron: CRON,
    producer: stubProducer,
  }));
}

function batch(over: Partial<RunBatch> = {}): RunBatch {
  return {
    runId: "run-1",
    triggered: false,
    enqueuedAt: iso(BASE - 120_000),
    finishedAt: iso(BASE - 60_000),
    durationMs: 60_000,
    outcome: "completed",
    jobs: { total: 2, done: 2, failed: 0, reclaimed: 0 },
    cells: null,
    redsIntroduced: null,
    redsCleared: null,
    errorSummary: null,
    commErrorKinds: [],
    ...over,
  };
}

function inflightState(over: Partial<InflightState> = {}): InflightState {
  return {
    runId: "run-2",
    triggered: false,
    enqueuedAt: iso(BASE - 60_000),
    elapsedMs: 60_000,
    stalled: false,
    jobs: { pending: 1, claimed: 0, running: 1, done: 0, failed: 0 },
    ...over,
  };
}

function entryFor(
  family: string,
  over: Partial<FamilySummaryEntry> = {},
): FamilySummaryEntry {
  const fam = FLEET_FAMILIES.find((f) => f.family === family);
  if (!fam) throw new Error(`unknown family ${family}`);
  return {
    family: fam.family,
    label: fam.label,
    probeKeyPrefix: fam.probeKeyPrefix,
    schedule: CRON,
    periodMs: PERIOD,
    nextRunAt: null,
    lastRun: null,
    inflight: null,
    lastSuccessAt: null,
    ...over,
  };
}

/** Every family healthy: succeeded a minute before `nowMs`. */
function healthyFamilies(nowMs: number): FamilySummaryEntry[] {
  return FLEET_FAMILIES.map((fam) =>
    entryFor(fam.family, {
      lastSuccessAt: iso(nowMs - 60_000),
      lastRun: batch({
        enqueuedAt: iso(nowMs - 120_000),
        finishedAt: iso(nowMs - 60_000),
      }),
    }),
  );
}

/** d6 silent (per `d6Over`), every other family healthy. */
function withD6(
  nowMs: number,
  d6Over: Partial<FamilySummaryEntry>,
): FamilySummaryEntry[] {
  return healthyFamilies(nowMs).map((entry) =>
    entry.family === "d6" ? entryFor("d6", d6Over) : entry,
  );
}

function response(
  families: FamilySummaryEntry[],
  workers: WorkerView[] = [],
): FamilySummaryResponse {
  return { families, workers };
}

/**
 * A worker strip entry whose `registeredAt` is the post-bounce drain signal
 * the grace window keys off. Only the fields the monitor reads are pinned;
 * the rest mirror a healthy online worker.
 */
function workerView(registeredAtMs: number): WorkerView {
  return {
    workerId: "worker-railway-abc",
    health: "online",
    lastHeartbeatAt: iso(registeredAtMs),
    registeredAt: iso(registeredAtMs),
    currentJobId: null,
    capacity: { inUse: 0, available: 24, max: 24 },
  };
}

function makeFakeStore(): AlertStateStore & {
  rows: Map<string, AlertStateRecord>;
} {
  const rows = new Map<string, AlertStateRecord>();
  const key = (ruleId: string, dedupeKey: string) => `${ruleId}|${dedupeKey}`;
  return {
    rows,
    async get(ruleId, dedupeKey) {
      return rows.get(key(ruleId, dedupeKey)) ?? null;
    },
    async record(ruleId, dedupeKey, fields) {
      rows.set(key(ruleId, dedupeKey), {
        rule_id: ruleId,
        dedupe_key: dedupeKey,
        last_alert_at: fields.at,
        last_alert_hash: fields.hash,
        payload_preview: fields.preview,
      });
    },
    async getSet() {
      return { hash: null, at: null };
    },
    async putSet() {},
  };
}

function makeMonitor(opts: {
  get: () => Promise<FamilySummaryResponse>;
  bootAtMs?: number;
  store?: AlertStateStore;
}) {
  const posts: string[] = [];
  const counters = { summaryCalls: 0 };
  const store = opts.store ?? makeFakeStore();
  const monitor = createFamilySilenceMonitor({
    summary: {
      get: async () => {
        counters.summaryCalls += 1;
        return opts.get();
      },
    },
    schedules: makeSchedules(),
    alertStore: store,
    postAlert: async (text) => {
      posts.push(text);
    },
    bootAtMs: opts.bootAtMs ?? BASE,
    logger: SILENT_LOGGER,
  });
  return { monitor, posts, counters, store };
}

describe("family-silence monitor — evaluation gate", () => {
  it("evaluation runs at most once per family per resolved period despite 15s ticks", async () => {
    const { monitor, counters, posts } = makeMonitor({
      get: async () => response(healthyFamilies(BASE + PERIOD)),
    });
    // First post-grace tick: every family due (no prior evaluation).
    await monitor.tick(BASE + PERIOD);
    expect(counters.summaryCalls).toBe(1);
    // 15 s and 30 min later: inside every family's period — gated, no fetch.
    await monitor.tick(BASE + PERIOD + 15_000);
    await monitor.tick(BASE + PERIOD + 30 * 60_000);
    expect(counters.summaryCalls).toBe(1);
    // One full period later: due again — exactly one more shared fetch for
    // all four due families (cost bound: one fan-out per cycle, not four).
    await monitor.tick(BASE + 2 * PERIOD);
    expect(counters.summaryCalls).toBe(2);
    expect(posts).toEqual([]);
  });
});

describe("family-silence monitor — silence alert", () => {
  it("a family silent past 3x period posts the silence alert with k cycles", async () => {
    // Change 3 (2026-06-17 Cloudflare-WAF-burst remediation): the silence
    // alert is gated on THREE consecutive silent evaluation cycles AND the
    // 3×period elapsed-time threshold. lastSuccessAt is pinned 2 periods
    // BEFORE BASE so every tick observes ≥4×period of silence — the
    // elapsed-time gate fires on every pre-warm tick, and the variable
    // under test is the consecutive-tick counter.
    const lastSuccessMs = BASE - 2 * PERIOD;
    const t1 = BASE + 2 * PERIOD; // 4×period since lastSuccess
    const t2 = BASE + 3 * PERIOD; // 5×period since lastSuccess
    const t3 = BASE + 4 * PERIOD; // 6×period since lastSuccess → "6 cycles"
    const { monitor, posts } = makeMonitor({
      get: async () =>
        response(
          withD6(t3, {
            lastSuccessAt: iso(lastSuccessMs),
            lastRun: batch({
              enqueuedAt: iso(lastSuccessMs - 120_000),
              finishedAt: iso(lastSuccessMs),
            }),
          }),
        ),
    });
    await monitor.tick(t1);
    expect(posts).toEqual([]);
    await monitor.tick(t2);
    expect(posts).toEqual([]);
    await monitor.tick(t3);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toContain("worker family D6 all-pills silent");
    expect(posts[0]).toContain(`no successful run since ${iso(lastSuccessMs)}`);
    expect(posts[0]).toContain("(6 cycles)");
    expect(posts[0]).toContain("last attempt: completed");
  });

  it("last attempt is inflight-aware: a stalled inflight batch posts stalled, never the prior completed lastRun outcome", async () => {
    // lastSuccessAt pinned BEFORE BASE so the elapsed-time gate fires on
    // every pre-warm tick (see Change-3 test above for the same idiom).
    const lastSuccessMs = BASE - 2 * PERIOD;
    const t1 = BASE + 2 * PERIOD;
    const t2 = BASE + 3 * PERIOD;
    const t3 = BASE + 4 * PERIOD;
    const { monitor, posts } = makeMonitor({
      get: async () =>
        response(
          withD6(t3, {
            lastSuccessAt: iso(lastSuccessMs),
            lastRun: batch({ outcome: "completed" }),
            inflight: inflightState({
              stalled: true,
              enqueuedAt: iso(t3 - PERIOD),
            }),
          }),
        ),
    });
    await monitor.tick(t1);
    await monitor.tick(t2);
    await monitor.tick(t3);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toContain("last attempt: stalled");
    expect(posts[0]).not.toContain("last attempt: completed");
  });

  it("an abandoned failed-plus-zombie batch reports stalled, never failed (no re-classification)", async () => {
    const lastSuccessMs = BASE - 2 * PERIOD;
    const t1 = BASE + 2 * PERIOD;
    const t2 = BASE + 3 * PERIOD;
    const t3 = BASE + 4 * PERIOD;
    const { monitor, posts } = makeMonitor({
      get: async () =>
        response(
          withD6(t3, {
            lastSuccessAt: iso(lastSuccessMs),
            // run-view already derived "stalled" by precedence (a failed job
            // plus a zombie pending job in an abandoned batch). The monitor
            // renders that value verbatim — never re-derives "failed".
            lastRun: batch({
              outcome: "stalled",
              jobs: { total: 3, done: 1, failed: 1, reclaimed: 0 },
            }),
          }),
        ),
    });
    await monitor.tick(t1);
    await monitor.tick(t2);
    await monitor.tick(t3);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toContain("last attempt: stalled");
    expect(posts[0]).not.toMatch(/last attempt: failed/);
  });

  it("null lastSuccessAt: never-succeeded family alerts off oldest batch enqueuedAt with the never-completed variant", async () => {
    // Oldest batch's enqueuedAt is BEFORE BASE so every tick observes
    // ≥4×period of silence (the elapsed-time gate fires on every pre-warm
    // tick; the consecutive-tick gate is the only thing delaying the post).
    const oldest = BASE - 2 * PERIOD;
    const t1 = BASE + 2 * PERIOD;
    const t2 = BASE + 3 * PERIOD;
    const t3 = BASE + 4 * PERIOD;
    const { monitor, posts } = makeMonitor({
      get: async () =>
        response(
          withD6(t3, {
            lastSuccessAt: null,
            lastRun: batch({
              outcome: "failed",
              enqueuedAt: iso(oldest),
              commErrorKinds: ["worker-crashed-mid-job"],
            }),
          }),
        ),
    });
    await monitor.tick(t1);
    await monitor.tick(t2);
    await monitor.tick(t3);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toContain(
      `has never completed a run since ${iso(oldest)}`,
    );
    expect(posts[0]).toContain("last attempt: failed (worker-crashed-mid-job)");
  });

  it("does not alert when the family runs every cycle with cell-level reds but no commError (chronic-reds, worker healthy)", async () => {
    // Regression for the D5/D6 family-silence false-alarm: the monitor reads
    // §5.2.1 `lastSuccessAt`, whose new semantic counts a batch where every
    // job reached a terminal state with no commError — i.e. cells red is
    // fine. Synthesize the dashboard's observed shape: lastSuccessAt is fresh
    // (one tick ago), lastRun outcome="failed" (chronic content reds), no
    // inflight. The silence banner must STAY SILENT.
    const now = BASE + 5 * PERIOD;
    const { monitor, posts } = makeMonitor({
      get: async () =>
        response(
          withD6(now, {
            lastSuccessAt: iso(now - PERIOD),
            lastRun: batch({
              outcome: "failed",
              enqueuedAt: iso(now - PERIOD - 120_000),
              finishedAt: iso(now - PERIOD),
              jobs: { total: 18, done: 1, failed: 17, reclaimed: 0 },
              cells: { total: 180, passed: 50, failed: 130 },
              commErrorKinds: [],
            }),
          }),
        ),
    });
    await monitor.tick(now);
    expect(posts).toEqual([]);
  });

  it("still alerts when the family STOPS emitting results entirely (real outage)", async () => {
    // Negative case to preserve: a real worker outage (lastSuccessAt very
    // stale, fresh inflight that's also stalled) must still trip the banner —
    // once the Change-3 consecutive-tick gate is satisfied.
    const lastSuccessMs = BASE - 2 * PERIOD;
    const t1 = BASE + 3 * PERIOD;
    const t2 = BASE + 4 * PERIOD;
    const t3 = BASE + 5 * PERIOD;
    const { monitor, posts } = makeMonitor({
      get: async () =>
        response(
          withD6(t3, {
            lastSuccessAt: iso(lastSuccessMs),
            lastRun: batch({
              outcome: "failed",
              enqueuedAt: iso(lastSuccessMs - 120_000),
              finishedAt: iso(lastSuccessMs),
              commErrorKinds: ["worker-crashed-mid-job"],
            }),
          }),
        ),
    });
    await monitor.tick(t1);
    await monitor.tick(t2);
    await monitor.tick(t3);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toContain("worker family D6 all-pills silent");
  });

  it("zero-batch family never alerts", async () => {
    const now = BASE + 10 * PERIOD;
    const { monitor, posts } = makeMonitor({
      get: async () =>
        response(
          withD6(now, {
            lastSuccessAt: null,
            lastRun: null,
            inflight: null,
          }),
        ),
    });
    await monitor.tick(now);
    expect(posts).toEqual([]);
  });
});

describe("family-silence monitor — post-bounce drain grace window", () => {
  // A NORMAL harness deploy rebuilds the shared `showcase-harness` image and
  // bounces the pool workers (PR #5715). After the bounce the workers
  // re-register (fresh `registered_at`), the producers re-arm, and each
  // family is mid-sweep — `lastSuccessAt` legitimately still points at the
  // PRE-bounce success and so reads stale against the 3×period silence gate.
  // Without a bounce-keyed grace this trips a FALSE silence alert during the
  // expected drain. The grace window is `BOUNCE_GRACE_PERIOD_MULTIPLIER`
  // (=2) × period since the freshest worker `registeredAt`: long enough for
  // the family to land its first post-bounce success, after which a still-
  // silent family is a GENUINE outage and alerts as before.

  it("RED→GREEN: a recent fleet bounce suppresses the silence alert during the drain window", async () => {
    // lastSuccessAt is 4×period stale (the elapsed-time gate fires), but the
    // freshest worker re-registered just before the first evaluated tick, so
    // every observed silent tick falls inside the 2×period bounce grace and
    // the consecutive-tick gate can never reach threshold.
    const lastSuccessMs = BASE - 2 * PERIOD;
    const t1 = BASE + 2 * PERIOD; // 4×period since lastSuccess
    const t2 = BASE + 3 * PERIOD;
    const t3 = BASE + 4 * PERIOD;
    // Bounce at t1 − 1 min: t1/t2/t3 are all inside t1 + 2×period grace.
    const bounceMs = t1 - 60_000;
    const { monitor, posts } = makeMonitor({
      get: async () =>
        response(
          withD6(t3, {
            lastSuccessAt: iso(lastSuccessMs),
            lastRun: batch({
              enqueuedAt: iso(lastSuccessMs - 120_000),
              finishedAt: iso(lastSuccessMs),
            }),
          }),
          [workerView(bounceMs)],
        ),
    });
    await monitor.tick(t1);
    await monitor.tick(t2);
    await monitor.tick(t3);
    expect(posts).toEqual([]);
  });

  it("GREEN: a genuinely silent family STILL alerts once the bounce grace has elapsed", async () => {
    // Same shape, but the bounce is OLD (well before lastSuccessAt) — the
    // family has had many full periods since the last (re)start to land a
    // success and has not, so this is a real outage and must still fire.
    const lastSuccessMs = BASE - 2 * PERIOD;
    const bounceMs = BASE - 10 * PERIOD; // ancient — grace long elapsed
    const t1 = BASE + 2 * PERIOD;
    const t2 = BASE + 3 * PERIOD;
    const t3 = BASE + 4 * PERIOD;
    const { monitor, posts } = makeMonitor({
      get: async () =>
        response(
          withD6(t3, {
            lastSuccessAt: iso(lastSuccessMs),
            lastRun: batch({
              enqueuedAt: iso(lastSuccessMs - 120_000),
              finishedAt: iso(lastSuccessMs),
            }),
          }),
          [workerView(bounceMs)],
        ),
    });
    await monitor.tick(t1);
    await monitor.tick(t2);
    await monitor.tick(t3);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toContain("worker family D6 all-pills silent");
    expect(posts[0]).toContain(`no successful run since ${iso(lastSuccessMs)}`);
  });

  it("GREEN: an empty worker strip (no bounce signal) preserves today's alerting", async () => {
    // Defensive: when no workers are registered (PB strip empty / pre-fix
    // payloads), there is no bounce instant to grace against, so the monitor
    // behaves exactly as before — a stale family still alerts.
    const lastSuccessMs = BASE - 2 * PERIOD;
    const t1 = BASE + 2 * PERIOD;
    const t2 = BASE + 3 * PERIOD;
    const t3 = BASE + 4 * PERIOD;
    const { monitor, posts } = makeMonitor({
      get: async () =>
        response(
          withD6(t3, {
            lastSuccessAt: iso(lastSuccessMs),
            lastRun: batch({
              enqueuedAt: iso(lastSuccessMs - 120_000),
              finishedAt: iso(lastSuccessMs),
            }),
          }),
          [],
        ),
    });
    await monitor.tick(t1);
    await monitor.tick(t2);
    await monitor.tick(t3);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toContain("worker family D6 all-pills silent");
  });
});

describe("family-silence monitor — bounce-grace window edge (2×period boundary)", () => {
  // Pin the exact 2×period boundary of the bounce grace. The suppression
  // predicate is `nowMs - bounceMs < BOUNCE_GRACE_PERIOD_MULTIPLIER × period`
  // (strict <), evaluated per-tick against the freshest worker registration.
  //
  // To make this a GENUINE pin of the 2× term (not merely a "grace exists"
  // smoke test), the FINAL tick must straddle the 2×period edge while the
  // consecutive-silent counter has ALREADY been primed to threshold−1 by
  // earlier ticks — so the boundary tick is the deciding 3rd observation.
  // The earlier (priming) ticks see an ANCIENT bounce that is outside the
  // grace at ANY positive multiplier (so they bind identically whether the
  // term is 1, 2, or 3 and reliably advance the counter 1→2); the final tick
  // sees a FRESH bounce placed exactly 1 min inside 2×period. That asymmetry
  // is realistic: the old registration is the pre-deploy worker, and a fresh
  // image-rebuild bounce (PR #5715) re-registers the worker just before the
  // last observed tick. The bounce is always in the PAST of the tick that
  // reads it (positive elapsed), never future-dated.

  it("a bounce JUST INSIDE 2×period (deciding 3rd tick) suppresses the alert", async () => {
    // lastSuccessAt is 2×period before BASE so every tick observes ≥4×period
    // of silence — the elapsed-time gate fires on all three. t1/t2 read an
    // ancient bounce (10×period old → outside grace at any multiplier) and so
    // advance the consecutive-silent counter to 2. The fresh bounce served on
    // the t3 read sits 1 min inside the 2×period edge:
    //   t3 − freshBounceMs = 2×period − 60s.
    // At BOUNCE_GRACE_PERIOD_MULTIPLIER = 2 that is < 2×period → INSIDE →
    // the deciding 3rd tick is suppressed, the counter resets, no alert.
    // This is the load-bearing pin: mutate the multiplier to 1 and the same
    // 2×period − 60s elapsed becomes ≥ 1×period → OUTSIDE → the 3rd silent
    // tick posts the alert and this expectation flips RED.
    const lastSuccessMs = BASE - 2 * PERIOD;
    const t1 = BASE + 2 * PERIOD; // 4×period since lastSuccess
    const t2 = BASE + 3 * PERIOD; // 5×period
    const t3 = BASE + 4 * PERIOD; // 6×period
    const oldBounceMs = BASE - 10 * PERIOD; // ancient → outside grace always
    const freshBounceMs = t3 - (2 * PERIOD - 60_000); // 1 min inside 2×period
    const d6 = {
      lastSuccessAt: iso(lastSuccessMs),
      lastRun: batch({
        enqueuedAt: iso(lastSuccessMs - 120_000),
        finishedAt: iso(lastSuccessMs),
      }),
    };
    let call = 0;
    const { monitor, posts } = makeMonitor({
      // t1/t2 reads (calls 0,1) see the ancient pre-deploy registration; the
      // t3 read (call 2) sees the fresh post-bounce registration.
      get: async () => {
        const bounceMs = call++ < 2 ? oldBounceMs : freshBounceMs;
        return response(withD6(t3, d6), [workerView(bounceMs)]);
      },
    });
    await monitor.tick(t1);
    await monitor.tick(t2);
    await monitor.tick(t3);
    expect(posts).toEqual([]);
  });

  it("a bounce JUST OUTSIDE 2×period on every tick lets the alert fire", async () => {
    // Same shape, but the bounce is old enough that EVERY tick is past the
    // 2×period grace by ≥1 min: t1 - bounce = 2×period + 60s > 2×period →
    // outside on t1, and t2/t3 are even further out. With grace lapsed on all
    // three ticks the consecutive-silent counter reaches threshold and posts.
    const lastSuccessMs = BASE - 2 * PERIOD;
    const t1 = BASE + 2 * PERIOD;
    const t2 = BASE + 3 * PERIOD;
    const t3 = BASE + 4 * PERIOD;
    const bounceMs = t1 - (2 * PERIOD + 60_000);
    const { monitor, posts } = makeMonitor({
      get: async () =>
        response(
          withD6(t3, {
            lastSuccessAt: iso(lastSuccessMs),
            lastRun: batch({
              enqueuedAt: iso(lastSuccessMs - 120_000),
              finishedAt: iso(lastSuccessMs),
            }),
          }),
          [workerView(bounceMs)],
        ),
    });
    await monitor.tick(t1);
    await monitor.tick(t2);
    await monitor.tick(t3);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toContain("worker family D6 all-pills silent");
  });

  it("grace does NOT apply when the bounce predates last-success + 1 period (the family already succeeded after the bounce)", async () => {
    // Intent: the grace covers the post-bounce DRAIN — the gap before the
    // family lands its first success after a (re)start. If the family ALREADY
    // succeeded well after the bounce (lastSuccessAt is more than one period
    // newer than the bounce) the drain is over; a subsequent silence is a
    // GENUINE outage and the stale bounce must not re-grant grace. Here the
    // bounce is 5×period old while lastSuccessAt is only 2×period old — i.e.
    // lastSuccess is ~3 periods AFTER the bounce, comfortably past
    // last-success+1period — so the grace window (2×period since the OLD
    // bounce) has long elapsed and the alert fires.
    const bounceMs = BASE - 5 * PERIOD;
    const lastSuccessMs = BASE - 2 * PERIOD; // 3 periods after the bounce
    const t1 = BASE + 2 * PERIOD;
    const t2 = BASE + 3 * PERIOD;
    const t3 = BASE + 4 * PERIOD;
    const { monitor, posts } = makeMonitor({
      get: async () =>
        response(
          withD6(t3, {
            lastSuccessAt: iso(lastSuccessMs),
            lastRun: batch({
              enqueuedAt: iso(lastSuccessMs - 120_000),
              finishedAt: iso(lastSuccessMs),
            }),
          }),
          [workerView(bounceMs)],
        ),
    });
    await monitor.tick(t1);
    await monitor.tick(t2);
    await monitor.tick(t3);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toContain("worker family D6 all-pills silent");
  });
});

describe("family-silence monitor — boot grace", () => {
  it("boot grace (1x period) suppresses the silence alert AND the meta-alert failing-since clock", async () => {
    // (a) silence alert suppressed inside the grace window.
    const silent = makeMonitor({
      get: async () =>
        response(
          withD6(BASE + PERIOD / 2, {
            lastSuccessAt: iso(BASE - 4 * PERIOD),
            lastRun: batch(),
          }),
        ),
      bootAtMs: BASE,
    });
    await silent.monitor.tick(BASE + PERIOD / 2);
    expect(silent.posts).toEqual([]);

    // (b) the meta-alert failing-since clock starts at grace END, not at the
    // first in-grace failure: failure from t=+10s, but no meta-alert until
    // MORE than one period past grace end (BASE + PERIOD).
    const failing = makeMonitor({
      get: async () => {
        throw new Error("pb down");
      },
      bootAtMs: BASE,
    });
    await failing.monitor.tick(BASE + 10_000); // in grace — clock NOT started here
    await failing.monitor.tick(BASE + 1.5 * PERIOD); // 0.5 period past grace end
    expect(failing.posts).toEqual([]);
    await failing.monitor.tick(BASE + 2.5 * PERIOD); // 1.5 periods past grace end
    expect(failing.posts).toHaveLength(1);
    expect(failing.posts[0]).toContain(
      `worker-run telemetry evaluation failing since ${iso(BASE + PERIOD)}`,
    );
  });
});

describe("family-silence monitor — evaluation-failure meta-alert", () => {
  it("meta-alert clock starts from a degraded-200 family entry carrying history_unavailable, not only from a thrown projection", async () => {
    const { monitor, posts } = makeMonitor({
      get: async () =>
        response(withD6(BASE + PERIOD, { error: "history_unavailable" })),
      bootAtMs: BASE,
    });
    await monitor.tick(BASE + PERIOD); // post-grace; clock starts
    expect(posts).toEqual([]);
    await monitor.tick(BASE + 2 * PERIOD + 1_000); // >1 period of failure
    expect(posts).toHaveLength(1);
    expect(posts[0]).toContain("worker-run telemetry evaluation failing since");
    expect(posts[0]).toContain("family silence cannot be assessed");
  });

  it("meta-alert posts after >1 period of consecutive evaluation failure; recovered one-shot on next success", async () => {
    let healthy = false;
    const { monitor, posts } = makeMonitor({
      get: async () => {
        if (!healthy) throw new Error("pb down");
        return response(healthyFamilies(BASE + 4 * PERIOD));
      },
      bootAtMs: BASE,
    });
    await monitor.tick(BASE + PERIOD); // failing — clock starts (post-grace)
    await monitor.tick(BASE + 2 * PERIOD); // exactly 1 period — NOT >1, no post
    expect(posts).toEqual([]);
    await monitor.tick(BASE + 3 * PERIOD); // 2 periods of failure — posts
    expect(posts).toHaveLength(1);
    expect(posts[0]).toContain("worker-run telemetry evaluation failing since");

    healthy = true;
    await monitor.tick(BASE + 4 * PERIOD);
    expect(posts).toHaveLength(2);
    expect(posts[1]).toContain("worker-run telemetry evaluation recovered");
    // One-shot: stays recovered, no repeat.
    await monitor.tick(BASE + 5 * PERIOD);
    expect(posts).toHaveLength(2);
  });
});

describe("family-silence monitor — rate limiting + recovered one-shot", () => {
  function silentD6At(now: number): FamilySummaryEntry[] {
    return withD6(now, {
      lastSuccessAt: iso(BASE - 4 * PERIOD),
      lastRun: batch({ outcome: "failed" }),
    });
  }

  it("alerts rate-limited to one per family per 6h via the alert-state store; recovered one-shot on next successful batch", async () => {
    // Change 3: the silence alert posts on the THIRD consecutive silent
    // tick, so the pre-warm advances through two non-posting ticks before
    // the third posts and seeds the durable rate-limit row.
    let nowRef = BASE + 2 * PERIOD;
    let recovered = false;
    const { monitor, posts, store } = makeMonitor({
      get: async () =>
        recovered
          ? response(healthyFamilies(nowRef))
          : response(silentD6At(nowRef)),
    });

    await monitor.tick(nowRef); // silent tick 1 — counter=1, no post
    expect(posts).toEqual([]);
    nowRef = BASE + 3 * PERIOD;
    await monitor.tick(nowRef); // silent tick 2 — counter=2, no post
    expect(posts).toEqual([]);
    nowRef = BASE + 4 * PERIOD;
    await monitor.tick(nowRef); // silent tick 3 — counter=3, posts
    expect(posts).toHaveLength(1);
    // The post is recorded into the alert-state store under the §9 keying.
    const row = await store.get(FAMILY_SILENCE_RULE_ID, "d6");
    expect(row?.last_alert_at).toBe(iso(BASE + 4 * PERIOD));

    // Every period for the next 5 hours: still silent, still suppressed.
    for (let i = 1; i <= 5; i += 1) {
      nowRef = BASE + (4 + i) * PERIOD;
      await monitor.tick(nowRef);
    }
    expect(posts).toHaveLength(1);

    // Past the 6 h window: posts again — the counter is well past threshold,
    // so the rate limit (not the consecutive-tick gate) is the only suppressor.
    nowRef = BASE + 4 * PERIOD + SILENCE_ALERT_RATE_LIMIT_MS + 60_000;
    await monitor.tick(nowRef);
    expect(posts).toHaveLength(2);

    // Recovered one-shot on the next successful batch — exactly once.
    recovered = true;
    nowRef += PERIOD;
    await monitor.tick(nowRef);
    expect(posts).toHaveLength(3);
    expect(posts[2]).toContain("worker family D6 all-pills recovered");
    nowRef += PERIOD;
    await monitor.tick(nowRef);
    expect(posts).toHaveLength(3);
  });

  it("a pre-seeded alert-state row suppresses across a monitor restart (durable rate limit)", async () => {
    // Drive past the consecutive-tick gate so the only suppressor left is
    // the durable rate-limit row this test is pinning.
    const t1 = BASE + 2 * PERIOD;
    const t2 = BASE + 3 * PERIOD;
    const t3 = BASE + 4 * PERIOD;
    const store = makeFakeStore();
    await store.record(FAMILY_SILENCE_RULE_ID, "d6", {
      at: iso(t3 - 3_600_000), // 1 h ago — inside the 6 h window
      hash: "seeded",
      preview: "seeded",
    });
    const { monitor, posts } = makeMonitor({
      get: async () => response(silentD6At(t3)),
      store,
    });
    await monitor.tick(t1);
    await monitor.tick(t2);
    await monitor.tick(t3);
    expect(posts).toEqual([]);
  });

  it("the meta-alert is rate-limited under its own rule id", async () => {
    const now = BASE + 3 * PERIOD;
    const store = makeFakeStore();
    await store.record(FAMILY_SILENCE_EVAL_RULE_ID, "d6", {
      at: iso(now - 3_600_000),
      hash: "seeded",
      preview: "seeded",
    });
    const { monitor, posts } = makeMonitor({
      get: async () => response(withD6(now, { error: "history_unavailable" })),
      bootAtMs: BASE - 10 * PERIOD,
      store,
    });
    await monitor.tick(now - 2 * PERIOD); // clock starts
    await monitor.tick(now); // >1 period failing, but rate-limited by the seed
    expect(posts).toEqual([]);
  });
});

describe("family-silence monitor — lastEvaluatedAt", () => {
  it("lastEvaluatedAt() advances on every evaluation cycle", async () => {
    const { monitor } = makeMonitor({
      get: async () => response(healthyFamilies(BASE + PERIOD)),
    });
    expect(monitor.lastEvaluatedAt()).toBeNull();
    await monitor.tick(BASE + PERIOD);
    expect(monitor.lastEvaluatedAt()).toBe(BASE + PERIOD);
    // Gated tick (nothing due): the stamp does NOT advance — it tracks
    // evaluation cycles, not raw ticks.
    await monitor.tick(BASE + PERIOD + 15_000);
    expect(monitor.lastEvaluatedAt()).toBe(BASE + PERIOD);
    await monitor.tick(BASE + 2 * PERIOD);
    expect(monitor.lastEvaluatedAt()).toBe(BASE + 2 * PERIOD);
  });

  it("lastEvaluatedAt() advances even when the evaluation fails (the stamp tracks liveness, not success)", async () => {
    const { monitor } = makeMonitor({
      get: async () => {
        throw new Error("pb down");
      },
    });
    await monitor.tick(BASE + PERIOD);
    expect(monitor.lastEvaluatedAt()).toBe(BASE + PERIOD);
  });
});

describe("family-silence monitor — constants", () => {
  it("pins the §9 threshold + keying constants consumers rely on", () => {
    expect(SILENCE_PERIOD_MULTIPLIER).toBe(3);
    expect(SILENCE_ALERT_RATE_LIMIT_MS).toBe(6 * 3_600_000);
    expect(SILENCE_CONSECUTIVE_TICK_THRESHOLD).toBe(3);
    expect(FAMILY_SILENCE_RULE_ID).toBe("family-silence");
    expect(FAMILY_SILENCE_EVAL_RULE_ID).toBe("family-silence-eval");
  });
});

/**
 * RED-GREEN gate for Change 3 of the 2026-06-17 Cloudflare-WAF-burst incident
 * fix: the silence alert must require THREE consecutive failed evaluation
 * cycles before firing, layered ON TOP of the existing 3×period elapsed-time
 * gate. On main today, a single cycle with `lastSuccessAt > 3×period` posts
 * the alert immediately — the failure mode the incident exposed (one bad
 * tick on a stale `lastSuccessAt` paged every family at once). Post-fix the
 * counter delays the alert to the 3rd silent cycle.
 *
 * The §9 6 h rate limit + boot-grace + meta-alert paths must be unaffected.
 */
describe("family-silence monitor — consecutive-silent-tick gate (Change 3)", () => {
  it("does NOT alert on the first or second silent tick — only the third (RED on main: alerts on tick #1)", async () => {
    // Boot was 4×PERIOD ago so the boot-grace window (1×period) is closed
    // before tick 1. lastSuccessAt = 4×PERIOD ago, so the 3×period
    // elapsed-time gate is satisfied on every tick — the variable under
    // test is the new consecutive-tick gate.
    const bootMs = BASE;
    const t1 = BASE + 2 * PERIOD;
    const t2 = t1 + PERIOD;
    const t3 = t2 + PERIOD;

    const { monitor, posts } = makeMonitor({
      get: async () =>
        response(
          withD6(t3, {
            lastSuccessAt: iso(BASE - 2 * PERIOD),
            lastRun: batch({
              outcome: "failed",
              enqueuedAt: iso(BASE - 2 * PERIOD - 120_000),
              finishedAt: iso(BASE - 2 * PERIOD),
            }),
          }),
        ),
      bootAtMs: bootMs,
    });

    // Tick 1: counter increments to 1 (post-grace, elapsed-time gate
    // satisfied) — NO alert yet.
    await monitor.tick(t1);
    expect(posts).toEqual([]);

    // Tick 2: counter increments to 2 — still NO alert.
    await monitor.tick(t2);
    expect(posts).toEqual([]);

    // Tick 3: counter reaches the threshold (3) — alert posts.
    await monitor.tick(t3);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toContain("worker family D6 all-pills silent");
  });

  it("a healthy tick between two silent ticks resets the counter — alert needs THREE more silent ticks in a row", async () => {
    // Counter discipline: ANY healthy cycle resets the counter. This pins
    // the consecutive-run semantic explicitly: a family that flaps silent
    // → healthy → silent does NOT carry the prior silent count forward.
    const bootMs = BASE;
    const t1 = BASE + 2 * PERIOD; // silent
    const t2 = t1 + PERIOD; // HEALTHY (reset)
    const t3 = t2 + PERIOD; // silent again
    const t4 = t3 + PERIOD; // silent
    const t5 = t4 + PERIOD; // silent → alert

    let phase: "silent" | "healthy" = "silent";
    const { monitor, posts } = makeMonitor({
      get: async () => {
        if (phase === "healthy") {
          return response(healthyFamilies(t2));
        }
        // Use t5 here so cycles arithmetic stays stable on the final tick.
        const lastSucc = iso(BASE - 2 * PERIOD);
        return response(
          withD6(t5, {
            lastSuccessAt: lastSucc,
            lastRun: batch({
              outcome: "failed",
              enqueuedAt: iso(BASE - 2 * PERIOD - 120_000),
              finishedAt: iso(BASE - 2 * PERIOD),
            }),
          }),
        );
      },
      bootAtMs: bootMs,
    });

    phase = "silent";
    await monitor.tick(t1);
    expect(posts).toEqual([]);

    phase = "healthy";
    await monitor.tick(t2);
    expect(posts).toEqual([]);

    phase = "silent";
    await monitor.tick(t3);
    expect(posts).toEqual([]);
    await monitor.tick(t4);
    expect(posts).toEqual([]);
    await monitor.tick(t5);
    expect(posts).toHaveLength(1);
  });
});
