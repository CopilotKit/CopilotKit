/**
 * harness-workers-provisioning.test.ts — CI drift gate for harness-workers
 * worker-fleet provisioning fields (`effectiveReplicas`,
 * `BROWSER_POOL_MAX_CONTEXTS`).
 *
 * Style note: mirrors `verify-railway-image-refs.test.ts` — pure validators
 * against synthesized or committed-snapshot inputs, NO live Railway API calls.
 *
 * The drift gate works by comparing the SSOT EFFECTIVE replica count
 * (`effectiveReplicas`, declared in `railway-envs.ts`) against the value
 * committed to `railway-envs.generated.json` (a static snapshot, NOT a live
 * Railway API response). When the SSOT and the snapshot agree, the gate passes.
 * When they diverge (someone edited the SSOT but forgot to re-run
 * emit-railway-envs-json, or forgot to update the SSOT to match reality), the
 * gate fails.
 *
 * EFFECTIVE REPLICA COUNT: the gate watches `effectiveReplicas`, which models
 * `multiRegionConfig.us-west2.numReplicas` — the field Railway actually honors
 * to derive the live replica count for this single-region service. The
 * top-level `numReplicas` is a documented mirror only; watching it would gate
 * a field that does not drive reality.
 *
 * WORKER MODEL CONFIRMED: 1-worker-per-replica (NOT replicas × pool count).
 * `HARNESS_POOL_COUNT` is INFORMATIONAL ONLY — not a fork factor. The
 * authoritative worker count is `effectiveReplicas`. The authoritative
 * per-worker concurrency is `BROWSER_POOL_MAX_CONTEXTS`.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SERVICES, workerProvisioningFor } from "../railway-envs";
import type { WorkerProvisioning } from "../railway-envs";

const GENERATED_JSON_PATH = resolve(
  __dirname,
  "..",
  "railway-envs.generated.json",
);

/** Load the committed generated-JSON snapshot (never calls the Railway API). */
function loadGeneratedSnapshot(): {
  services: Array<{
    name: string;
    workerProvisioning?: {
      prod: WorkerProvisioning;
      staging: WorkerProvisioning;
    };
  }>;
} {
  return JSON.parse(readFileSync(GENERATED_JSON_PATH, "utf8"));
}

describe("harness-workers provisioning SSOT", () => {
  it("harness-workers declares workerProvisioning in the SSOT", () => {
    const prodProv = workerProvisioningFor("harness-workers", "prod");
    const stagingProv = workerProvisioningFor("harness-workers", "staging");
    expect(prodProv).not.toBeUndefined();
    expect(stagingProv).not.toBeUndefined();
  });

  it("prod effectiveReplicas = 6 (parity achieved — B-reconcile scaled prod 3 → 6, 2026-06-26)", () => {
    // multiRegionConfig.us-west2.numReplicas is the field Railway honors.
    // Verified live: deploy.multiRegionConfig = {"us-west2":{"numReplicas":6}}.
    const prov = workerProvisioningFor("harness-workers", "prod");
    expect(prov?.effectiveReplicas).toBe(6);
  });

  it("staging effectiveReplicas = 6 (multiRegionConfig.us-west2.numReplicas, verified live)", () => {
    // Verified live: deploy.multiRegionConfig = {"us-west2":{"numReplicas":6}}.
    const prov = workerProvisioningFor("harness-workers", "staging");
    expect(prov?.effectiveReplicas).toBe(6);
  });

  it("top-level numReplicas mirrors effectiveReplicas in both envs (6 / 6)", () => {
    // Single-region service: the top-level numReplicas is a documented mirror of
    // the effective per-region count, not an authoritative knob.
    const prodProv = workerProvisioningFor("harness-workers", "prod");
    const stagingProv = workerProvisioningFor("harness-workers", "staging");
    expect(prodProv?.numReplicas).toBe(6);
    expect(stagingProv?.numReplicas).toBe(6);
    expect(prodProv?.numReplicas).toBe(prodProv?.effectiveReplicas);
    expect(stagingProv?.numReplicas).toBe(stagingProv?.effectiveReplicas);
  });

  it("BROWSER_POOL_MAX_CONTEXTS = 40 for both envs (per-worker concurrency, not a fleet total)", () => {
    const prodProv = workerProvisioningFor("harness-workers", "prod");
    const stagingProv = workerProvisioningFor("harness-workers", "staging");
    expect(prodProv?.BROWSER_POOL_MAX_CONTEXTS).toBe(40);
    expect(stagingProv?.BROWSER_POOL_MAX_CONTEXTS).toBe(40);
  });

  it("overlapSeconds = 45 for both envs (deploy-rollover capacity floor, layer c)", () => {
    // RAILWAY_DEPLOYMENT_OVERLAP_SECONDS — keep the old deployment serving until
    // the new one is Active so the capacity floor holds across a rollover (no
    // staleness dip). See showcase/RAILWAY.md "Deploy rollover".
    const prodProv = workerProvisioningFor("harness-workers", "prod");
    const stagingProv = workerProvisioningFor("harness-workers", "staging");
    expect(prodProv?.overlapSeconds).toBe(45);
    expect(stagingProv?.overlapSeconds).toBe(45);
  });

  it("drainingSeconds = 180 for both envs (graceful-drain window, ≥ PLATFORM_STOP_GRACE_MS)", () => {
    // RAILWAY_DEPLOYMENT_DRAINING_SECONDS — the SIGTERM→SIGKILL window. Sized to
    // host the shipped composed worker-drain budget (layer b: 3s deregister cap +
    // 90s finish-and-report grace + teardown remainder, all < PLATFORM_STOP_GRACE_MS
    // = 180s). See showcase/RAILWAY.md "Deploy rollover".
    const prodProv = workerProvisioningFor("harness-workers", "prod");
    const stagingProv = workerProvisioningFor("harness-workers", "staging");
    expect(prodProv?.drainingSeconds).toBe(180);
    expect(stagingProv?.drainingSeconds).toBe(180);
  });

  it("HARNESS_POOL_COUNT is recorded as informational only — NOT used as a fork factor", () => {
    // The worker boots 1 process per replica (keyed on HOSTNAME). HARNESS_POOL_COUNT
    // is forwarded to each worker as a control-plane hint but NEVER forks additional
    // worker processes. The authoritative worker count is numReplicas.
    const prodProv = workerProvisioningFor("harness-workers", "prod");
    const stagingProv = workerProvisioningFor("harness-workers", "staging");
    // Presence is optional; assert its value only when set.
    if (prodProv?.HARNESS_POOL_COUNT !== undefined) {
      expect(typeof prodProv.HARNESS_POOL_COUNT).toBe("number");
    }
    if (stagingProv?.HARNESS_POOL_COUNT !== undefined) {
      expect(typeof stagingProv.HARNESS_POOL_COUNT).toBe("number");
    }
  });

  it("workerProvisioningFor returns undefined for non-worker services", () => {
    // Only harness-workers carries this field; every other service returns undefined.
    expect(workerProvisioningFor("harness", "prod")).toBeUndefined();
    expect(workerProvisioningFor("aimock", "prod")).toBeUndefined();
    expect(workerProvisioningFor("pocketbase", "staging")).toBeUndefined();
  });
});

describe("harness-workers provisioning drift gate (SSOT vs generated JSON snapshot)", () => {
  /**
   * This is the CI drift gate. It compares the SSOT-declared `numReplicas`
   * values against the committed `railway-envs.generated.json` snapshot.
   *
   * If someone edits `railway-envs.ts` (SSOT) but forgets to regenerate the
   * JSON, OR edits the JSON directly without updating the SSOT, this test
   * catches the drift.
   *
   * The comparison source is the COMMITTED JSON SNAPSHOT — NOT a live Railway
   * API call. This is intentional: live API calls are inappropriate for a unit
   * test (flaky, requires auth, slow). The snapshot is updated by running:
   *   npx tsx showcase/scripts/emit-railway-envs-json.ts
   */
  it("SSOT prod effectiveReplicas matches committed generated JSON snapshot", () => {
    const snapshot = loadGeneratedSnapshot();
    const snapshotEntry = snapshot.services.find(
      (s) => s.name === "harness-workers",
    );
    expect(
      snapshotEntry,
      "harness-workers missing from railway-envs.generated.json",
    ).not.toBeUndefined();

    const ssotProd = workerProvisioningFor("harness-workers", "prod");
    expect(
      ssotProd,
      "harness-workers prod workerProvisioning missing from SSOT",
    ).not.toBeUndefined();

    const snapshotProdReplicas =
      snapshotEntry?.workerProvisioning?.prod?.effectiveReplicas;
    expect(
      snapshotProdReplicas,
      "workerProvisioning.prod.effectiveReplicas missing from generated JSON snapshot",
    ).not.toBeUndefined();

    expect(ssotProd?.effectiveReplicas).toBe(snapshotProdReplicas);
  });

  it("SSOT staging effectiveReplicas matches committed generated JSON snapshot", () => {
    const snapshot = loadGeneratedSnapshot();
    const snapshotEntry = snapshot.services.find(
      (s) => s.name === "harness-workers",
    );
    expect(
      snapshotEntry,
      "harness-workers missing from railway-envs.generated.json",
    ).not.toBeUndefined();

    const ssotStaging = workerProvisioningFor("harness-workers", "staging");
    expect(
      ssotStaging,
      "harness-workers staging workerProvisioning missing from SSOT",
    ).not.toBeUndefined();

    const snapshotStagingReplicas =
      snapshotEntry?.workerProvisioning?.staging?.effectiveReplicas;
    expect(
      snapshotStagingReplicas,
      "workerProvisioning.staging.effectiveReplicas missing from generated JSON snapshot",
    ).not.toBeUndefined();

    expect(ssotStaging?.effectiveReplicas).toBe(snapshotStagingReplicas);
  });

  it("SSOT prod BROWSER_POOL_MAX_CONTEXTS matches committed generated JSON snapshot", () => {
    const snapshot = loadGeneratedSnapshot();
    const snapshotEntry = snapshot.services.find(
      (s) => s.name === "harness-workers",
    );
    const ssotProd = workerProvisioningFor("harness-workers", "prod");
    expect(ssotProd?.BROWSER_POOL_MAX_CONTEXTS).toBe(
      snapshotEntry?.workerProvisioning?.prod?.BROWSER_POOL_MAX_CONTEXTS,
    );
  });

  it("SSOT staging BROWSER_POOL_MAX_CONTEXTS matches committed generated JSON snapshot", () => {
    const snapshot = loadGeneratedSnapshot();
    const snapshotEntry = snapshot.services.find(
      (s) => s.name === "harness-workers",
    );
    const ssotStaging = workerProvisioningFor("harness-workers", "staging");
    expect(ssotStaging?.BROWSER_POOL_MAX_CONTEXTS).toBe(
      snapshotEntry?.workerProvisioning?.staging?.BROWSER_POOL_MAX_CONTEXTS,
    );
  });

  it("SSOT prod overlapSeconds matches committed generated JSON snapshot", () => {
    const snapshot = loadGeneratedSnapshot();
    const snapshotEntry = snapshot.services.find(
      (s) => s.name === "harness-workers",
    );
    const ssotProd = workerProvisioningFor("harness-workers", "prod");
    expect(
      snapshotEntry?.workerProvisioning?.prod?.overlapSeconds,
      "workerProvisioning.prod.overlapSeconds missing from generated JSON snapshot",
    ).not.toBeUndefined();
    expect(ssotProd?.overlapSeconds).toBe(
      snapshotEntry?.workerProvisioning?.prod?.overlapSeconds,
    );
  });

  it("SSOT staging overlapSeconds matches committed generated JSON snapshot", () => {
    const snapshot = loadGeneratedSnapshot();
    const snapshotEntry = snapshot.services.find(
      (s) => s.name === "harness-workers",
    );
    const ssotStaging = workerProvisioningFor("harness-workers", "staging");
    expect(
      snapshotEntry?.workerProvisioning?.staging?.overlapSeconds,
      "workerProvisioning.staging.overlapSeconds missing from generated JSON snapshot",
    ).not.toBeUndefined();
    expect(ssotStaging?.overlapSeconds).toBe(
      snapshotEntry?.workerProvisioning?.staging?.overlapSeconds,
    );
  });

  it("SSOT prod drainingSeconds matches committed generated JSON snapshot", () => {
    const snapshot = loadGeneratedSnapshot();
    const snapshotEntry = snapshot.services.find(
      (s) => s.name === "harness-workers",
    );
    const ssotProd = workerProvisioningFor("harness-workers", "prod");
    expect(
      snapshotEntry?.workerProvisioning?.prod?.drainingSeconds,
      "workerProvisioning.prod.drainingSeconds missing from generated JSON snapshot",
    ).not.toBeUndefined();
    expect(ssotProd?.drainingSeconds).toBe(
      snapshotEntry?.workerProvisioning?.prod?.drainingSeconds,
    );
  });

  it("SSOT staging drainingSeconds matches committed generated JSON snapshot", () => {
    const snapshot = loadGeneratedSnapshot();
    const snapshotEntry = snapshot.services.find(
      (s) => s.name === "harness-workers",
    );
    const ssotStaging = workerProvisioningFor("harness-workers", "staging");
    expect(
      snapshotEntry?.workerProvisioning?.staging?.drainingSeconds,
      "workerProvisioning.staging.drainingSeconds missing from generated JSON snapshot",
    ).not.toBeUndefined();
    expect(ssotStaging?.drainingSeconds).toBe(
      snapshotEntry?.workerProvisioning?.staging?.drainingSeconds,
    );
  });
});

describe("harness-workers provisioning with injected test data", () => {
  /**
   * This test injects a synthetic SSOT entry and confirms the accessor
   * returns the correct fields. It does NOT modify the real SERVICES map
   * beyond the sentinel, which is removed in the finally block.
   */

  it("transient injected SSOT entry: workerProvisioningFor returns correct values", () => {
    // Inject a synthetic harness-workers-like entry and confirm the accessor
    // returns the correct fields. Remove the injection in the finally block.
    const sentinel = "__test-workers-sentinel__";
    const mockProv = {
      prod: {
        effectiveReplicas: 5,
        numReplicas: 5,
        BROWSER_POOL_MAX_CONTEXTS: 20,
      },
      staging: {
        effectiveReplicas: 10,
        numReplicas: 10,
        BROWSER_POOL_MAX_CONTEXTS: 20,
      },
    };
    (
      SERVICES as Record<
        string,
        {
          serviceId: string;
          environments: Record<string, unknown>;
          probeDriver: string;
          ciBuilt: boolean;
          gateValidated: boolean;
          workerProvisioning?: {
            prod: WorkerProvisioning;
            staging: WorkerProvisioning;
          };
        }
      >
    )[sentinel] = {
      serviceId: "00000000-0000-0000-0000-000000000099",
      ciBuilt: false,
      gateValidated: false,
      probeDriver: "harness",
      environments: {
        prod: {
          instanceId: "11111111-1111-1111-1111-111111111111",
          probe: false,
        },
        staging: {
          instanceId: "22222222-2222-2222-2222-222222222222",
          probe: false,
        },
      },
      workerProvisioning: mockProv,
    };
    try {
      const prodProv = workerProvisioningFor(sentinel, "prod");
      const stagingProv = workerProvisioningFor(sentinel, "staging");
      expect(prodProv?.effectiveReplicas).toBe(5);
      expect(stagingProv?.effectiveReplicas).toBe(10);
      expect(prodProv?.numReplicas).toBe(5);
      expect(prodProv?.BROWSER_POOL_MAX_CONTEXTS).toBe(20);
    } finally {
      delete (SERVICES as Record<string, unknown>)[sentinel];
    }
  });
});
