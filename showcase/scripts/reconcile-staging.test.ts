import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyDebounce,
  DEFAULT_DEBOUNCE_THRESHOLD,
  pickNewestSuccessDigest,
  reconcileExitCode,
  reconcileStaging,
  selectLaggingServices,
  stagingReconcileServices,
} from "./reconcile-staging";
import type {
  DebounceCounts,
  RedeployReport,
  ReconcileDeps,
  ServiceDigestPair,
  UnconfirmedService,
} from "./reconcile-staging";
import { CI_BUILT_SERVICES, SERVICES } from "./railway-envs";
import { runRedeploy } from "./redeploy-env";

const DIGEST_A =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const DIGEST_B =
  "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

describe("selectLaggingServices (pure decision logic)", () => {
  it("returns [] when every service's deployed digest matches :latest", () => {
    const pairs: ServiceDigestPair[] = [
      {
        service: "showcase-ag2",
        repoName: "showcase-ag2",
        deployedDigest: DIGEST_A,
        latestDigest: DIGEST_A,
      },
      {
        service: "showcase-agno",
        repoName: "showcase-agno",
        deployedDigest: DIGEST_B,
        latestDigest: DIGEST_B,
      },
    ];
    expect(selectLaggingServices(pairs)).toEqual([]);
  });

  it("flags a service whose deployed digest lags :latest", () => {
    const pairs: ServiceDigestPair[] = [
      {
        service: "showcase-ag2",
        repoName: "showcase-ag2",
        deployedDigest: DIGEST_A,
        latestDigest: DIGEST_B,
      },
    ];
    expect(selectLaggingServices(pairs)).toEqual(["showcase-ag2"]);
  });

  it("does NOT flag a service whose deployed digest could not be resolved (null)", () => {
    // A null deployed digest means we could not read a SUCCESS deployment for
    // the service. Re-deploying on that ambiguous signal risks churn, so v1
    // treats an unresolved deployed digest as NOT lagging (skip, record).
    const pairs: ServiceDigestPair[] = [
      {
        service: "showcase-ag2",
        repoName: "showcase-ag2",
        deployedDigest: null,
        latestDigest: DIGEST_B,
      },
    ];
    expect(selectLaggingServices(pairs)).toEqual([]);
  });

  it("returns only the lagging subset, sorted", () => {
    const pairs: ServiceDigestPair[] = [
      {
        service: "showcase-mastra",
        repoName: "showcase-mastra",
        deployedDigest: DIGEST_A,
        latestDigest: DIGEST_B, // lags
      },
      {
        service: "showcase-agno",
        repoName: "showcase-agno",
        deployedDigest: DIGEST_A,
        latestDigest: DIGEST_A, // current
      },
      {
        service: "showcase-ag2",
        repoName: "showcase-ag2",
        deployedDigest: DIGEST_B,
        latestDigest: DIGEST_A, // lags
      },
    ];
    expect(selectLaggingServices(pairs)).toEqual([
      "showcase-ag2",
      "showcase-mastra",
    ]);
  });
});

describe("stagingReconcileServices", () => {
  it("returns staging services that float :latest (CI-built OR imageOf consumers), all real SSOT keys", () => {
    const list = stagingReconcileServices();
    expect(list.length).toBeGreaterThan(0);
    for (const name of list) {
      expect(Object.hasOwn(SERVICES, name)).toBe(true);
      expect(Object.hasOwn(SERVICES[name].environments, "staging")).toBe(true);
      // Every entry is EITHER a CI-built service OR an imageOf consumer — the
      // two sources that float staging :latest.
      const entry = SERVICES[name];
      expect(CI_BUILT_SERVICES.has(name) || entry.imageOf !== undefined).toBe(
        true,
      );
    }
  });

  it("INCLUDES imageOf consumers that declare staging (e.g. harness-workers) so their independent drift is detected", () => {
    // harness-workers runs the showcase-harness image on its own
    // serviceInstance (ciBuilt:false, imageOf:"harness") and floats staging
    // :latest — it can drift from harness (PR #5352 regression). It MUST be in
    // scope even though it is not CI-built.
    const list = stagingReconcileServices();
    expect(SERVICES["harness-workers"].imageOf).toBe("harness");
    expect(CI_BUILT_SERVICES.has("harness-workers")).toBe(false);
    expect(list).toContain("harness-workers");
  });
});

/**
 * Build a mocked ReconcileDeps over a fixed scope of services with a
 * per-service map of { deployed, latest } digests. redeploy + Slack are
 * vi.fn() spies so the test asserts the decision → action wiring without
 * any live network.
 */
function makeDeps(
  digests: Record<
    string,
    { deployed: string | null; latest: string } | { error: string }
  >,
  opts: { slackDelivers?: boolean; redeployReport?: RedeployReport } = {},
): {
  deps: ReconcileDeps;
  redeploySpy: ReturnType<typeof vi.fn>;
  slackSpy: ReturnType<typeof vi.fn>;
} {
  const services = Object.keys(digests);
  const slackDelivers = opts.slackDelivers ?? true;
  const redeploySpy = vi.fn(
    async (svcs: string[]) =>
      opts.redeployReport ?? {
        attempted: svcs.length,
        succeeded: svcs.length,
        failed: 0,
        // Default healthy path: every requested lagging service redeploys ok,
        // so each is positively confirmed remediated (per-service, not count).
        records: svcs.map((s) => ({ service: s, status: "ok" as const })),
      },
  );
  const slackSpy = vi.fn(async (_text: string) => slackDelivers);
  const deps: ReconcileDeps = {
    services,
    fetchDeployedDigest: async (serviceId: string) => {
      const name = Object.entries(SERVICES).find(
        ([, e]) => e.serviceId === serviceId,
      )?.[0];
      const d = name ? digests[name] : undefined;
      if (!d) throw new Error(`no fixture for serviceId ${serviceId}`);
      if ("error" in d) throw new Error(d.error);
      return d.deployed;
    },
    fetchLatestDigest: async (repoName: string) => {
      // The scope here uses agent services whose repoName === service name.
      const d = digests[repoName];
      if (!d) throw new Error(`no fixture for repo ${repoName}`);
      if ("error" in d) throw new Error(d.error);
      return d.latest;
    },
    redeployStaging: redeploySpy,
    postSlackAlert: slackSpy,
    log: () => {},
  };
  return { deps, redeploySpy, slackSpy };
}

describe("reconcileStaging (orchestration)", () => {
  it("LAGGING fixture → redeploys exactly the lagging service AND posts a Slack alert naming it", async () => {
    // showcase-ag2's deployed digest lags :latest; showcase-agno is current.
    const { deps, redeploySpy, slackSpy } = makeDeps({
      "showcase-ag2": { deployed: DIGEST_A, latest: DIGEST_B },
      "showcase-agno": { deployed: DIGEST_B, latest: DIGEST_B },
    });

    const summary = await reconcileStaging(deps);

    expect(summary.lagging).toEqual(["showcase-ag2"]);
    // (a) redeploy called once, scoped to EXACTLY the lagging service.
    expect(redeploySpy).toHaveBeenCalledTimes(1);
    expect(redeploySpy).toHaveBeenCalledWith(["showcase-ag2"]);
    // (b) Slack alert posted once, naming the lagging service.
    expect(slackSpy).toHaveBeenCalledTimes(1);
    expect(slackSpy.mock.calls[0][0]).toContain("showcase-ag2");
    expect(summary.redeployed).toBe(true);
    expect(summary.alerted).toBe(true);
  });

  it("MATCHED fixture → no redeploy and no Slack alert (no-op)", async () => {
    const { deps, redeploySpy, slackSpy } = makeDeps({
      "showcase-ag2": { deployed: DIGEST_A, latest: DIGEST_A },
      "showcase-agno": { deployed: DIGEST_B, latest: DIGEST_B },
    });

    const summary = await reconcileStaging(deps);

    expect(summary.lagging).toEqual([]);
    expect(redeploySpy).not.toHaveBeenCalled();
    expect(slackSpy).not.toHaveBeenCalled();
    expect(summary.redeployed).toBe(false);
    expect(summary.alerted).toBe(false);
  });

  it("a per-service digest-fetch error does not mask another service's real lag", async () => {
    const { deps, redeploySpy, slackSpy } = makeDeps({
      "showcase-ag2": { error: "GHCR 500" },
      "showcase-agno": { deployed: DIGEST_A, latest: DIGEST_B }, // lags
    });

    const summary = await reconcileStaging(deps);

    expect(summary.errors.map((e) => e.service)).toContain("showcase-ag2");
    expect(summary.lagging).toEqual(["showcase-agno"]);
    expect(redeploySpy).toHaveBeenCalledWith(["showcase-agno"]);
    expect(slackSpy).toHaveBeenCalledTimes(1);
  });

  // ── Finding 1: an unresolvable deployed digest is an ERROR, not "current" ──
  it("null deployed digest → recorded as an ERROR and NOT silently counted as up-to-date", async () => {
    const { deps, redeploySpy, slackSpy } = makeDeps({
      "showcase-ag2": { deployed: null, latest: DIGEST_B },
    });

    const summary = await reconcileStaging(deps);

    // Surfaced as an error (the header contract), not hidden.
    expect(summary.errors.map((e) => e.service)).toContain("showcase-ag2");
    // Not counted as a checked/current service and not redeployed.
    expect(summary.checked).toBe(0);
    expect(summary.lagging).toEqual([]);
    expect(redeploySpy).not.toHaveBeenCalled();
    // The single service could not be confirmed current ⇒ unconfirmed.
    expect(summary.unconfirmed.map((u) => u.service)).toContain("showcase-ag2");
    expect(slackSpy).toHaveBeenCalledTimes(1);
    expect(reconcileExitCode(summary)).not.toBe(0);
  });

  // ── Finding 2: nothing confirmed (all errored / checked===0) fails loud ────
  it("all-services-errored (checked===0) → Slack alert fired AND non-zero exit", async () => {
    const { deps, redeploySpy, slackSpy } = makeDeps({
      "showcase-ag2": { error: "Railway unreachable" },
      "showcase-agno": { error: "Railway unreachable" },
    });

    const summary = await reconcileStaging(deps);

    expect(summary.checked).toBe(0);
    // Both services are unconfirmed (neither could be checked).
    expect(summary.unconfirmed.map((u) => u.service).sort()).toEqual([
      "showcase-ag2",
      "showcase-agno",
    ]);
    // Fail loud: alert fired even though nothing was "lagging".
    expect(slackSpy).toHaveBeenCalledTimes(1);
    expect(redeploySpy).not.toHaveBeenCalled();
    // Scheduled run must go RED.
    expect(reconcileExitCode(summary)).not.toBe(0);
  });

  it("healthy no-op (nothing lagging, everything confirmed) → exit 0, no alert", async () => {
    const { deps, slackSpy } = makeDeps({
      "showcase-ag2": { deployed: DIGEST_A, latest: DIGEST_A },
      "showcase-agno": { deployed: DIGEST_B, latest: DIGEST_B },
    });

    const summary = await reconcileStaging(deps);

    expect(summary.unconfirmed).toEqual([]);
    expect(summary.emptyScope).toBe(false);
    expect(slackSpy).not.toHaveBeenCalled();
    expect(reconcileExitCode(summary)).toBe(0);
  });

  // ── Finding 4: alerted reflects ACTUAL delivery, not "we tried" ────────────
  it("Slack POST fails to deliver → summary.alerted === false", async () => {
    const { deps } = makeDeps(
      {
        "showcase-ag2": { deployed: DIGEST_A, latest: DIGEST_B }, // lags
        "showcase-agno": { deployed: DIGEST_B, latest: DIGEST_B },
      },
      { slackDelivers: false },
    );

    const summary = await reconcileStaging(deps);

    expect(summary.lagging).toEqual(["showcase-ag2"]);
    expect(summary.alerted).toBe(false);
    // A real lag whose alert never delivered must not report green.
    expect(reconcileExitCode(summary)).not.toBe(0);
  });

  // ── Finding 5: a partial redeploy failure must not report green ────────────
  it("partial redeploy failure (failed>0) → non-zero exit", async () => {
    const { deps } = makeDeps(
      {
        "showcase-ag2": { deployed: DIGEST_A, latest: DIGEST_B }, // lags
      },
      {
        redeployReport: {
          attempted: 1,
          succeeded: 0,
          failed: 1,
          records: [
            { service: "showcase-ag2", status: "error", error: "HTTP 500" },
          ],
        },
      },
    );

    const summary = await reconcileStaging(deps);

    expect(summary.lagging).toEqual(["showcase-ag2"]);
    expect(summary.redeployReport).toEqual({
      attempted: 1,
      succeeded: 0,
      failed: 1,
      records: [
        { service: "showcase-ag2", status: "error", error: "HTTP 500" },
      ],
    });
    // The failed lagging service is named unconfirmed (per-service).
    expect(summary.unconfirmed.map((u) => u.service)).toContain("showcase-ag2");
    expect(reconcileExitCode(summary)).not.toBe(0);
  });
});

// ── R2 invariant: a run is green ONLY when EVERY in-scope staging service was
// positively confirmed current. Any service NOT confirmed current — for ANY
// reason — drives a Slack alert AND a non-zero exit. These cases prove the
// holes the scattered special-cases left open. ─────────────────────────────
describe("reconcileStaging invariant (green ⇔ every service confirmed current)", () => {
  // The A16 + A19 cases exercise the REAL `runRedeploy`, which honors
  // $REDEPLOY_SUMMARY_JSON (writing a real artifact file via fs.writeFileSync)
  // and streams per-service progress to process.stdout — so under CI (where
  // that env var is set) an unguarded call writes a real file and spams the
  // terminal. Mirror redeploy-env.test.ts's guard: delete the artifact env
  // vars (undefined removes them) and silence process.stdout. Restored in
  // afterEach. (The mocked-redeploy cases in this block are unaffected.)
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv("REDEPLOY_SUMMARY_JSON", undefined);
    vi.stubEnv("GITHUB_STEP_SUMMARY", undefined);
    stdoutWriteSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutWriteSpy.mockRestore();
    // mockRestore does NOT undo stubEnv — unstub explicitly so the stub never
    // leaks into another test file under fork reuse.
    vi.unstubAllEnvs();
  });

  it("redeploy drops a lagging service (record present for only one) → non-zero + alert names the dropped one", async () => {
    // Two services lag, but the redeploy reported a per-service record for only
    // ONE of them (showcase-agno was silently dropped/skipped). Per-service
    // matching flags the missing one; the old count-compare could not.
    const { deps, slackSpy } = makeDeps(
      {
        "showcase-ag2": { deployed: DIGEST_A, latest: DIGEST_B }, // lags
        "showcase-agno": { deployed: DIGEST_A, latest: DIGEST_B }, // lags
      },
      {
        redeployReport: {
          attempted: 1,
          succeeded: 1,
          failed: 0,
          records: [{ service: "showcase-ag2", status: "ok" }],
        },
      },
    );

    const summary = await reconcileStaging(deps);

    expect(summary.lagging).toEqual(["showcase-ag2", "showcase-agno"]);
    // Fail loud: the dropped lagging service is NOT confirmed current, by name.
    expect(summary.unconfirmed.map((u) => u.service)).toContain(
      "showcase-agno",
    );
    expect(summary.unconfirmed.map((u) => u.service)).not.toContain(
      "showcase-ag2",
    );
    expect(reconcileExitCode(summary)).not.toBe(0);
    expect(slackSpy).toHaveBeenCalledTimes(1);
  });

  it("null deployed digest on an otherwise-healthy fleet → non-zero + alert (not silent)", async () => {
    // One service is current; one has an unresolvable deployed digest (no
    // SUCCESS deployment / window miss). The old code recorded the null as an
    // error but only failed loud when EVERYTHING errored (systemic) — so a
    // single null on a healthy fleet read green.
    const { deps, slackSpy } = makeDeps({
      "showcase-ag2": { deployed: DIGEST_A, latest: DIGEST_A }, // current
      "showcase-agno": { deployed: null, latest: DIGEST_B }, // unresolvable
    });

    const summary = await reconcileStaging(deps);

    expect(reconcileExitCode(summary)).not.toBe(0);
    expect(slackSpy).toHaveBeenCalledTimes(1);
  });

  it("null/empty GHCR :latest on an otherwise-healthy fleet → non-zero + alert", async () => {
    const { deps, slackSpy } = makeDeps({
      "showcase-ag2": { deployed: DIGEST_A, latest: DIGEST_A }, // current
      "showcase-agno": { deployed: DIGEST_B, latest: "" }, // GHCR :latest empty
    });

    const summary = await reconcileStaging(deps);

    expect(reconcileExitCode(summary)).not.toBe(0);
    expect(slackSpy).toHaveBeenCalledTimes(1);
  });

  it("empty in-scope set (checked===0) → non-zero + alert (checked nothing is NOT green)", async () => {
    const { deps, slackSpy } = makeDeps({});

    const summary = await reconcileStaging(deps);

    expect(summary.checked).toBe(0);
    expect(reconcileExitCode(summary)).not.toBe(0);
    expect(slackSpy).toHaveBeenCalledTimes(1);
  });

  // ── A16: dropped-lag detection must NOT be defeated by imageOf expansion ────
  it("A16: REAL imageOf expansion inflates `attempted`, but a dropped lagging service is still caught per-service", async () => {
    // Two services lag: `harness` and `showcase-ag2`. The remediation redeploy
    // actually forwards ONLY `harness` to the REAL runRedeploy — which, through
    // REAL imageOf expansion, pulls in `harness-workers`, so `attempted` = 2.
    // `showcase-ag2` is genuinely dropped and never remediated. Because
    // expansion inflated `attempted` to 2 (= lagging.length), the OLD
    // `attempted < lagging.length` count-compare (2 < 2 = false) read GREEN.
    // Per-service matching against the real `records` catches the drop.
    const redeployedServiceIds: string[] = [];
    const fakeRedeploy = async (serviceId: string) => {
      redeployedServiceIds.push(serviceId);
      return { ok: true as const };
    };

    const deps: ReconcileDeps = {
      services: ["harness", "showcase-ag2"],
      // Both lag: deployed=A, latest=B.
      fetchDeployedDigest: async () => DIGEST_A,
      fetchLatestDigest: async () => DIGEST_B,
      redeployStaging: async (_lagging) => {
        // SIMULATE THE DROP: only `harness` reaches the real redeploy path
        // (showcase-ag2 is dropped), but REAL runRedeploy still expands
        // `harness` → `harness` + `harness-workers`, inflating `attempted`.
        const summary = await runRedeploy({
          env: "staging",
          services: ["harness"],
          redeploy: fakeRedeploy,
          appendSummary: () => {},
        });
        return {
          attempted: summary.attempted,
          succeeded: summary.succeeded,
          failed: summary.failed,
          records: summary.records,
        };
      },
      postSlackAlert: async () => true,
      log: () => {},
    };

    const summary = await reconcileStaging(deps);

    expect(summary.lagging).toEqual(["harness", "showcase-ag2"]);
    // REAL expansion: only `harness` was forwarded, yet `attempted` = 2 because
    // `harness-workers` (imageOf: harness) joined — NOT a hardcoded count.
    expect(summary.redeployReport?.attempted).toBe(2);
    expect(redeployedServiceIds).toHaveLength(2);
    // `attempted` (2) is NOT < lagging.length (2): the old count-compare can't
    // fire — yet the dropped lagging service must still be flagged.
    expect(summary.redeployReport!.attempted).not.toBeLessThan(
      summary.lagging.length,
    );
    // Per-service: the dropped lagging service is named unconfirmed.
    expect(summary.unconfirmed.map((u) => u.service)).toContain("showcase-ag2");
    // `harness` WAS remediated (and its consumer), so it is NOT unconfirmed.
    expect(summary.unconfirmed.map((u) => u.service)).not.toContain("harness");
    expect(reconcileExitCode(summary)).not.toBe(0);

    // Guard proof: the REAL runRedeploy ran but wrote NO artifact file (the
    // $REDEPLOY_SUMMARY_JSON env was deleted, so its fs.writeFileSync path is
    // skipped) and its per-service stdout progress was intercepted by the spy
    // instead of spamming the terminal.
    expect(process.env.REDEPLOY_SUMMARY_JSON).toBeUndefined();
    expect(stdoutWriteSpy).toHaveBeenCalled();
  });

  // ── A19: an already-CURRENT expansion consumer's incidental redeploy failure
  // must NOT fail the run (only genuinely-lagging services do). ──────────────
  it("A19: an ALREADY-CURRENT imageOf consumer whose INCIDENTAL expansion redeploy FAILS does not fail the run", async () => {
    // `harness` lags :latest (deployed=A, latest=B). `harness-workers`
    // (imageOf: harness) is ALREADY CURRENT (deployed=B === latest=B). The
    // remediation forwards ONLY the lagging `harness` to the REAL runRedeploy,
    // which through REAL imageOf expansion also redeploys `harness-workers`.
    // That INCIDENTAL redeploy of the already-current consumer FAILS. Because
    // `harness-workers` was positively confirmed current at check time, its
    // failed incidental redeploy must NOT mark it unconfirmed — the run stays
    // GREEN (the genuinely-lagging `harness` was itself remediated ok). The
    // pre-A19 code flagged ANY failed non-lagging service and failed the run.
    const HARNESS_ID = SERVICES["harness"].serviceId;
    const WORKERS_ID = SERVICES["harness-workers"].serviceId;

    const fakeRedeploy = async (serviceId: string) => {
      // The already-current consumer's incidental expansion redeploy fails; the
      // genuinely-lagging producer redeploys ok.
      if (serviceId === WORKERS_ID) {
        return {
          ok: false as const,
          error: "incidental expansion redeploy HTTP 500",
        };
      }
      return { ok: true as const };
    };

    const deps: ReconcileDeps = {
      services: ["harness", "harness-workers"],
      fetchDeployedDigest: async (serviceId: string) => {
        if (serviceId === HARNESS_ID) return DIGEST_A; // lags :latest
        if (serviceId === WORKERS_ID) return DIGEST_B; // already current
        throw new Error(`unexpected serviceId ${serviceId}`);
      },
      // Both track the showcase-harness image, whose :latest is DIGEST_B.
      fetchLatestDigest: async () => DIGEST_B,
      redeployStaging: async (lagging) => {
        // Only the lagging `harness` reaches the real redeploy path; REAL
        // runRedeploy expands it to also redeploy `harness-workers`.
        const summary = await runRedeploy({
          env: "staging",
          services: lagging,
          redeploy: fakeRedeploy,
          appendSummary: () => {},
        });
        return {
          attempted: summary.attempted,
          succeeded: summary.succeeded,
          failed: summary.failed,
          records: summary.records,
        };
      },
      postSlackAlert: async () => true,
      log: () => {},
    };

    const summary = await reconcileStaging(deps);

    // Only `harness` lagged; `harness-workers` was current at check time.
    expect(summary.lagging).toEqual(["harness"]);
    // REAL expansion pulled the already-current consumer into the redeploy, and
    // its incidental redeploy FAILED (proving the failure surface is real).
    const workersRec = summary.redeployReport?.records.find(
      (r) => r.service === "harness-workers",
    );
    expect(workersRec).toEqual({
      service: "harness-workers",
      status: "error",
      error: "incidental expansion redeploy HTTP 500",
    });
    // A19: the already-current consumer is NOT marked unconfirmed by its failed
    // incidental redeploy, and `harness` was remediated ok — so nothing is
    // unconfirmed and the run is GREEN.
    expect(summary.unconfirmed.map((u) => u.service)).not.toContain(
      "harness-workers",
    );
    expect(summary.unconfirmed).toEqual([]);
    expect(reconcileExitCode(summary)).toBe(0);
  });

  // ── A17: a remediation redeploy that THROWS still alerts + exits non-zero ───
  it("A17: remediation redeploy THROWS → Slack alert fires AND non-zero exit (every lagging service unconfirmed)", async () => {
    const { deps, slackSpy } = makeDeps({
      "showcase-ag2": { deployed: DIGEST_A, latest: DIGEST_B }, // lags
      "showcase-agno": { deployed: DIGEST_B, latest: DIGEST_A }, // lags
    });
    // Override the redeploy to throw (e.g. token expiry, unreachable Railway).
    deps.redeployStaging = vi.fn(async () => {
      throw new Error("Railway redeploy exploded");
    });

    const summary = await reconcileStaging(deps);

    expect(summary.lagging).toEqual(["showcase-ag2", "showcase-agno"]);
    // Every lagging service is unconfirmed because remediation never returned.
    expect(summary.unconfirmed.map((u) => u.service).sort()).toEqual([
      "showcase-ag2",
      "showcase-agno",
    ]);
    // The invariant: any unconfirmed ⇒ alert AND non-zero — BOTH must happen
    // even when the redeploy itself throws.
    expect(slackSpy).toHaveBeenCalledTimes(1);
    expect(summary.alerted).toBe(true);
    expect(reconcileExitCode(summary)).not.toBe(0);
  });

  it("all-current → exit 0 and NO alert (green only when truly all-confirmed)", async () => {
    const { deps, slackSpy } = makeDeps({
      "showcase-ag2": { deployed: DIGEST_A, latest: DIGEST_A },
      "showcase-agno": { deployed: DIGEST_B, latest: DIGEST_B },
    });

    const summary = await reconcileStaging(deps);

    expect(reconcileExitCode(summary)).toBe(0);
    expect(slackSpy).not.toHaveBeenCalled();
  });
});

// ── Finding 3: newest-SUCCESS selection is deterministic (createdAt desc) ────
describe("pickNewestSuccessDigest", () => {
  it("chooses the newest SUCCESS by createdAt even when edges arrive out of order", () => {
    const edges = [
      {
        node: {
          id: "old",
          status: "SUCCESS",
          meta: { imageDigest: DIGEST_A },
          createdAt: "2026-07-01T00:00:00.000Z",
        },
      },
      {
        node: {
          id: "new",
          status: "SUCCESS",
          meta: { imageDigest: DIGEST_B },
          createdAt: "2026-07-19T00:00:00.000Z",
        },
      },
      {
        node: {
          id: "mid",
          status: "SUCCESS",
          meta: { imageDigest: DIGEST_A },
          createdAt: "2026-07-10T00:00:00.000Z",
        },
      },
    ];
    // Newest by createdAt is the "new" edge → DIGEST_B, regardless of order.
    expect(pickNewestSuccessDigest(edges)).toBe(DIGEST_B);
  });

  it("ignores non-SUCCESS deployments even when they are newer", () => {
    const edges = [
      {
        node: {
          id: "failed-newer",
          status: "FAILED",
          meta: { imageDigest: DIGEST_B },
          createdAt: "2026-07-20T00:00:00.000Z",
        },
      },
      {
        node: {
          id: "success-older",
          status: "SUCCESS",
          meta: { imageDigest: DIGEST_A },
          createdAt: "2026-07-01T00:00:00.000Z",
        },
      },
    ];
    expect(pickNewestSuccessDigest(edges)).toBe(DIGEST_A);
  });

  // ── A18: an unparseable createdAt must never win "newest" ──────────────────
  it("A18: an unparseable createdAt on a SUCCESS deployment never wins 'newest' — the valid newest digest is chosen", () => {
    // The invalid-timestamp edge is listed FIRST. Under the old comparator
    // (`new Date(b).getTime() - new Date(a).getTime()`) the subtraction yields
    // NaN, the sort leaves order undefined, and the NaN edge can remain at
    // index 0 → the WRONG (DIGEST_B) digest is selected. NaN-safe ordering
    // sorts the invalid timestamp to the bottom so the valid SUCCESS wins.
    const edges = [
      {
        node: {
          id: "nan-createdAt",
          status: "SUCCESS",
          meta: { imageDigest: DIGEST_B },
          createdAt: "not-a-real-date",
        },
      },
      {
        node: {
          id: "valid",
          status: "SUCCESS",
          meta: { imageDigest: DIGEST_A },
          createdAt: "2026-07-01T00:00:00.000Z",
        },
      },
    ];
    expect(pickNewestSuccessDigest(edges)).toBe(DIGEST_A);
  });

  it("prefers a valid newer SUCCESS over an unparseable one regardless of input order", () => {
    // Same invariant with the valid edge first — the invalid one must still
    // never be selected.
    const edges = [
      {
        node: {
          id: "valid-newer",
          status: "SUCCESS",
          meta: { imageDigest: DIGEST_A },
          createdAt: "2026-07-19T00:00:00.000Z",
        },
      },
      {
        node: {
          id: "nan-createdAt",
          status: "SUCCESS",
          meta: { imageDigest: DIGEST_B },
          createdAt: "",
        },
      },
    ];
    expect(pickNewestSuccessDigest(edges)).toBe(DIGEST_A);
  });

  it("returns null when there is no SUCCESS deployment", () => {
    const edges = [
      {
        node: {
          id: "building",
          status: "BUILDING",
          meta: { imageDigest: DIGEST_A },
          createdAt: "2026-07-20T00:00:00.000Z",
        },
      },
    ];
    expect(pickNewestSuccessDigest(edges)).toBeNull();
  });
});

// ── applyDebounce: the pure consecutive-cycle decision ──────────────────────
const u = (service: string, reason = "x"): UnconfirmedService => ({
  service,
  reason,
});

describe("applyDebounce (pure consecutive-cycle debounce)", () => {
  it("DEFAULT_DEBOUNCE_THRESHOLD is 2 (a single blip is silent; persistence pages within ~30 min)", () => {
    expect(DEFAULT_DEBOUNCE_THRESHOLD).toBe(2);
  });

  it("threshold 1 = no debounce: every unconfirmed service is immediately pageable", () => {
    const { nextCounts, pageable } = applyDebounce({
      unconfirmed: [u("a"), u("b")],
      priorCounts: {},
      threshold: 1,
    });
    expect(pageable.map((p) => p.service).sort()).toEqual(["a", "b"]);
    expect(nextCounts).toEqual({ a: 1, b: 1 });
  });

  it("threshold 2, first cycle: increments to 1 and pages NOTHING (below threshold)", () => {
    const { nextCounts, pageable } = applyDebounce({
      unconfirmed: [u("a")],
      priorCounts: {},
      threshold: 2,
    });
    expect(pageable).toEqual([]);
    expect(nextCounts).toEqual({ a: 1 });
  });

  it("threshold 2, second consecutive cycle: reaches 2 and PAGES", () => {
    const { nextCounts, pageable } = applyDebounce({
      unconfirmed: [u("a")],
      priorCounts: { a: 1 },
      threshold: 2,
    });
    expect(pageable.map((p) => p.service)).toEqual(["a"]);
    expect(nextCounts).toEqual({ a: 2 });
  });

  it("a service that clears is reset (absent from nextCounts), not carried forward", () => {
    // `a` was unconfirmed last cycle (count 1) but is NOT unconfirmed now → its
    // count resets. `b` is newly unconfirmed → 1.
    const { nextCounts, pageable } = applyDebounce({
      unconfirmed: [u("b")],
      priorCounts: { a: 1 },
      threshold: 2,
    });
    expect(nextCounts).toEqual({ b: 1 });
    expect(pageable).toEqual([]);
  });

  it("counts one consecutive cycle per service even with multiple reasons, and keeps all reasons once pageable", () => {
    const { nextCounts, pageable } = applyDebounce({
      unconfirmed: [u("a", "reason-1"), u("a", "reason-2")],
      priorCounts: { a: 1 },
      threshold: 2,
    });
    // ONE increment for the service (2, not 3) despite two entries…
    expect(nextCounts).toEqual({ a: 2 });
    // …and once pageable, BOTH reasons are retained.
    expect(pageable).toEqual([u("a", "reason-1"), u("a", "reason-2")]);
  });
});

// ── reconcileStaging debounce: single-cycle blips are silenced, persistence
// still pages (drives the SHIPPED function through the digest-resolver boundary,
// not a reimplemented decision). ────────────────────────────────────────────
describe("reconcileStaging debounce (single-cycle blip silent, persistence pages)", () => {
  /**
   * Build deps whose deployed-digest resolver returns null for `service` (the
   * exact harness-workers mid-redeploy race), with the debounce wired to an
   * in-memory `state` object that persists between cycles like actions/cache.
   */
  function makeBlipDeps(
    service: string,
    state: { counts: DebounceCounts },
    slackCalls: string[],
    threshold = DEFAULT_DEBOUNCE_THRESHOLD,
  ): ReconcileDeps {
    const serviceId = SERVICES[service].serviceId;
    return {
      services: [service],
      // GENUINE BOUNDARY: deployed digest resolves to null for one cycle.
      fetchDeployedDigest: async (id: string) =>
        id === serviceId ? null : DIGEST_A,
      fetchLatestDigest: async () => DIGEST_B,
      redeployStaging: async (svcs) => ({
        attempted: svcs.length,
        succeeded: svcs.length,
        failed: 0,
        records: svcs.map((s) => ({ service: s, status: "ok" as const })),
      }),
      postSlackAlert: async (text: string) => {
        slackCalls.push(text);
        return true;
      },
      debounceThreshold: threshold,
      loadDebounceState: async () => state.counts,
      saveDebounceState: async (counts) => {
        state.counts = counts;
      },
      log: () => {},
    };
  }

  it("SINGLE-cycle null deployed digest (the race) → NO page, exit 0, count carried at 1", async () => {
    const state = { counts: {} as DebounceCounts };
    const slackCalls: string[] = [];
    const summary = await reconcileStaging(
      makeBlipDeps("harness-workers", state, slackCalls),
    );

    // The raw invariant still SEES it (surfaced for logging)…
    expect(summary.unconfirmed.map((s) => s.service)).toContain(
      "harness-workers",
    );
    // …but it is debounced: nothing pageable, no Slack, green exit.
    expect(summary.pageableUnconfirmed).toEqual([]);
    expect(slackCalls).toEqual([]);
    expect(summary.alerted).toBe(false);
    expect(reconcileExitCode(summary)).toBe(0);
    // State advanced to 1 so a second consecutive cycle will trip the threshold.
    expect(state.counts).toEqual({ "harness-workers": 1 });
  });

  it("TWO consecutive null-digest cycles → PAGES on the 2nd, exit non-zero (persistent drift not silenced)", async () => {
    const state = { counts: {} as DebounceCounts };

    const slack1: string[] = [];
    const s1 = await reconcileStaging(
      makeBlipDeps("harness-workers", state, slack1),
    );
    expect(slack1).toEqual([]);
    expect(reconcileExitCode(s1)).toBe(0);

    const slack2: string[] = [];
    const s2 = await reconcileStaging(
      makeBlipDeps("harness-workers", state, slack2),
    );
    // 2nd consecutive cycle reaches the threshold → pages + fails loud.
    expect(s2.pageableUnconfirmed.map((p) => p.service)).toContain(
      "harness-workers",
    );
    expect(slack2).toHaveLength(1);
    expect(slack2[0]).toContain("harness-workers");
    expect(s2.alerted).toBe(true);
    expect(reconcileExitCode(s2)).not.toBe(0);
  });

  it("a blip that CLEARS on the next cycle never pages and resets the counter", async () => {
    const state = { counts: {} as DebounceCounts };

    // Cycle 1: null-digest blip → debounced, count 1.
    const slack1: string[] = [];
    await reconcileStaging(makeBlipDeps("harness-workers", state, slack1));
    expect(slack1).toEqual([]);
    expect(state.counts).toEqual({ "harness-workers": 1 });

    // Cycle 2: the service is now healthy (deployed === latest) → all-current.
    const serviceId = SERVICES["harness-workers"].serviceId;
    const slack2: string[] = [];
    const s2 = await reconcileStaging({
      services: ["harness-workers"],
      fetchDeployedDigest: async (id: string) =>
        id === serviceId ? DIGEST_B : DIGEST_A,
      fetchLatestDigest: async () => DIGEST_B,
      redeployStaging: async (svcs) => ({
        attempted: svcs.length,
        succeeded: svcs.length,
        failed: 0,
        records: svcs.map((sv) => ({ service: sv, status: "ok" as const })),
      }),
      postSlackAlert: async (text: string) => {
        slack2.push(text);
        return true;
      },
      debounceThreshold: DEFAULT_DEBOUNCE_THRESHOLD,
      loadDebounceState: async () => state.counts,
      saveDebounceState: async (counts) => {
        state.counts = counts;
      },
      log: () => {},
    });

    expect(s2.unconfirmed).toEqual([]);
    expect(slack2).toEqual([]);
    expect(reconcileExitCode(s2)).toBe(0);
    // Counter reset — the blip left no residue.
    expect(state.counts).toEqual({});
  });

  it("REGRESSION: a PERSISTENT stale digest whose remediation keeps FAILING pages on the 2nd cycle (real drift is not silenced)", async () => {
    // harness-workers is genuinely LAGGING (deployed !== latest) and its
    // remediation redeploy FAILS every cycle — the PR #5352 stale-image class.
    // This must NOT be silenced by the debounce: it persists, so it pages on the
    // 2nd consecutive cycle.
    const serviceId = SERVICES["harness-workers"].serviceId;
    const state = { counts: {} as DebounceCounts };
    const makeLagDeps = (slackCalls: string[]): ReconcileDeps => ({
      services: ["harness-workers"],
      fetchDeployedDigest: async (id: string) =>
        id === serviceId ? DIGEST_A : DIGEST_B, // lags :latest
      fetchLatestDigest: async () => DIGEST_B,
      redeployStaging: async () => ({
        attempted: 1,
        succeeded: 0,
        failed: 1,
        records: [
          { service: "harness-workers", status: "error", error: "HTTP 500" },
        ],
      }),
      postSlackAlert: async (text: string) => {
        slackCalls.push(text);
        return true;
      },
      debounceThreshold: DEFAULT_DEBOUNCE_THRESHOLD,
      loadDebounceState: async () => state.counts,
      saveDebounceState: async (counts) => {
        state.counts = counts;
      },
      log: () => {},
    });

    // Cycle 1: lagging + failed remediation → unconfirmed, but still debounced
    // (below threshold). Remediation was ATTEMPTED (self-heal not gated).
    const slack1: string[] = [];
    const s1 = await reconcileStaging(makeLagDeps(slack1));
    expect(s1.lagging).toEqual(["harness-workers"]);
    expect(s1.unconfirmed.map((x) => x.service)).toContain("harness-workers");
    expect(s1.pageableUnconfirmed).toEqual([]);
    // A lag fired the informational alert-AND-remediate notice even on cycle 1,
    // but the fail-loud "unconfirmed" page is debounced → exit stays 0.
    expect(reconcileExitCode(s1)).toBe(0);

    // Cycle 2: still lagging + still failing → persists → pages + fails loud.
    const slack2: string[] = [];
    const s2 = await reconcileStaging(makeLagDeps(slack2));
    expect(s2.pageableUnconfirmed.map((p) => p.service)).toContain(
      "harness-workers",
    );
    expect(slack2).toHaveLength(1);
    expect(reconcileExitCode(s2)).not.toBe(0);
  });

  it("in-scope set is not narrowed by the debounce (harness-workers still reconciled)", () => {
    // The debounce changes WHEN a verdict pages, never WHICH services are in
    // scope — harness-workers (the imageOf consumer) must remain reconciled.
    expect(stagingReconcileServices()).toContain("harness-workers");
  });
});
