/**
 * RED→GREEN gate for the 2026-06-17 Cloudflare-WAF-burst incident.
 *
 * On `main` (before this fix landed) the file proved the bugs:
 *   (a) `createServiceEnumerator` propagated the FIRST `429 / Cloudflare
 *       1015` from the discovery source — no retry, no cached-catalog
 *       fallback. A one-tick WAF burst zeroed out the dashboard.
 *   (b) `createFamilySilenceMonitor` posted the silence alert on the FIRST
 *       silent evaluation cycle — no consecutive-tick gate. A single bad
 *       tick on a stale `lastSuccessAt` paged every family at once.
 *
 * Under the fix the assertions invert: the enumerator rides out the burst
 * (retry + cache) and the silence monitor waits for three consecutive
 * silent cycles. This file keeps the exact surfaces that surfaced the bug
 * on main pinned green — a regression in either layer trips this gate.
 */
import { describe, it, expect } from "vitest";
import {
  createServiceEnumerator,
  D6_DISCOVERY_FILTER,
  D6_DRIVER_KIND,
} from "./catalog-enumerator.js";
import {
  createFamilySilenceMonitor,
  FAMILY_SILENCE_RULE_ID,
} from "./family-silence-monitor.js";
import { DiscoverySourceBackendError } from "../../probes/discovery/errors.js";
import { FLEET_FAMILIES } from "./run-view.js";
import type {
  FamilySummaryEntry,
  FamilySummaryResponse,
  RunBatch,
} from "./run-view.js";
import type { ProducerSchedule } from "./control-plane.js";
import type { JobProducer } from "./job-producer.js";
import type { AlertStateStore } from "../../storage/alert-state-store.js";
import type { Logger } from "../../types/index.js";
import type { DiscoverySource } from "../../probes/types.js";
import type { RailwayServiceInfo } from "../../probes/discovery/railway-services.js";

const SILENT_LOGGER: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

describe("RED→GREEN — Railway-GQL resilience (Change 1+2)", () => {
  it("a transient 429+CF-1015 burst is retried (3 attempts) before bubbling", async () => {
    let calls = 0;
    const source = {
      name: "railway-services",
      async enumerate(_ctx: unknown, _config: unknown) {
        calls += 1;
        throw new DiscoverySourceBackendError(
          "railway-services",
          "railway gql 429: error code: 1015 (rate limited)",
          429,
        );
      },
    } as unknown as DiscoverySource<RailwayServiceInfo>;
    const enumerate = createServiceEnumerator({
      source,
      env: {},
      fetchImpl: globalThis.fetch,
      logger: SILENT_LOGGER,
      driverKind: D6_DRIVER_KIND,
      probeKeyPrefix: "d6",
      filter: D6_DISCOVERY_FILTER,
      // Instant retry to keep the test millisecond-fast — production keeps
      // the SSOT 1s/4s/16s schedule (see ENUMERATE_RETRY_BACKOFF_MS).
      sleep: async () => {},
    });
    await expect(
      enumerate({ triggered: false, runId: "run-1" }),
    ).rejects.toBeInstanceOf(DiscoverySourceBackendError);
    // Post-fix: 1 initial attempt + 3 retries = 4 calls. The "no retry"
    // baseline (calls === 1) is the bug this gate prevents from
    // re-landing.
    expect(calls).toBe(4);
  });
});

describe("RED→GREEN — family-silence consecutive-tick gate (Change 3)", () => {
  const CRON = "0 * * * *";
  const PERIOD = 3_600_000;
  const BASE = Date.UTC(2026, 0, 15);

  function iso(ms: number) {
    return new Date(ms).toISOString();
  }
  function makeSchedules(): ProducerSchedule[] {
    const stubProducer = {
      start() {},
      async stop() {},
      async tick() {
        throw new Error("stub: tick not used");
      },
      isRunning: () => true,
    } as unknown as JobProducer;
    return FLEET_FAMILIES.map((fam) => ({
      scheduleId: fam.scheduleId,
      cron: CRON,
      producer: stubProducer,
    }));
  }
  function makeFakeStore(): AlertStateStore {
    const rows = new Map<string, unknown>();
    return {
      async get(ruleId, dedupeKey) {
        return (rows.get(`${ruleId}|${dedupeKey}`) as never) ?? null;
      },
      async record(ruleId, dedupeKey, fields) {
        rows.set(`${ruleId}|${dedupeKey}`, {
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
    } as AlertStateStore;
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
  function entryFor(
    family: string,
    over: Partial<FamilySummaryEntry> = {},
  ): FamilySummaryEntry {
    const fam = FLEET_FAMILIES.find((f) => f.family === family)!;
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

  it("a single silent evaluation tick DOES NOT post; three consecutive silent ticks DO", async () => {
    // lastSuccessAt pinned BEFORE BASE so every pre-warm tick observes
    // ≥4×period of silence — the elapsed-time gate fires on each tick and
    // the consecutive-tick counter is the only variable under test.
    const lastSuccessMs = BASE - 2 * PERIOD;
    const t1 = BASE + 2 * PERIOD;
    const t2 = BASE + 3 * PERIOD;
    const t3 = BASE + 4 * PERIOD;
    const families: FamilySummaryEntry[] = FLEET_FAMILIES.map((fam) =>
      fam.family === "d6"
        ? entryFor("d6", {
            lastSuccessAt: iso(lastSuccessMs),
            lastRun: batch({
              outcome: "failed",
              enqueuedAt: iso(lastSuccessMs - 120_000),
              finishedAt: iso(lastSuccessMs),
            }),
          })
        : entryFor(fam.family, {
            lastSuccessAt: iso(t3 - 60_000),
            lastRun: batch({
              enqueuedAt: iso(t3 - 120_000),
              finishedAt: iso(t3 - 60_000),
            }),
          }),
    );
    const body: FamilySummaryResponse = { families, workers: [] };
    const posts: string[] = [];
    const monitor = createFamilySilenceMonitor({
      summary: { get: async () => body },
      schedules: makeSchedules(),
      alertStore: makeFakeStore(),
      postAlert: async (text) => {
        posts.push(text);
      },
      bootAtMs: BASE,
      logger: SILENT_LOGGER,
    });
    await monitor.tick(t1);
    expect(posts).toEqual([]);
    await monitor.tick(t2);
    expect(posts).toEqual([]);
    await monitor.tick(t3);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toContain("worker family D6 all-pills silent");
    // Pin the rule-id to make the assertion grep-stable.
    expect(FAMILY_SILENCE_RULE_ID).toBe("family-silence");
  });
});
