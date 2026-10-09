import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readRailwayLifecycleEvidence } from "../harness/src/shared/railway-lifecycle-records";
import {
  computePromoteClosure,
  DISPOSABLE_LIFECYCLE_POLICY,
  ENV_ID_BY_NAME,
  PROJECT_ID,
  SERVICES,
  STAGING_ENV_ID,
} from "./railway-envs";
import emitted from "./railway-envs.generated.json";
import { reconcileExitCode, reconcileStaging } from "./reconcile-staging";
import { runRedeploy } from "./redeploy-env";
import {
  expectedPolicyFor,
  runAutoUpdatesGate,
  summarizeAutoUpdatesFailures,
} from "./verify-autoupdates";

const TEMP_NAME = "showcase-intelligence-disposable-fixture";
const TEMP_ID = "fixture-disposable-service-id";
const DIGEST = `sha256:${"a".repeat(64)}`;
const IMAGE = `ghcr.io/fixture/intelligence/api@${DIGEST}`;
const NOW = new Date("2026-10-08T12:15:00.000Z");
const ACTIVE = {
  schemaVersion: 1,
  runs: [
    {
      runId: "fixture-run",
      projectId: PROJECT_ID,
      environmentId: STAGING_ENV_ID,
      startedAt: "2026-10-08T12:00:00.000Z",
      expiresAt: "2026-10-08T12:45:00.000Z",
      phase: "ready",
      services: [{ name: TEMP_NAME, serviceId: TEMP_ID, expectedImage: IMAGE }],
      resources: [],
    },
  ],
};
const INTELLIGENCE_IDS = {
  "showcase-intelligence-api": "2cf17267-31c4-4e92-8270-5ad92bd7ad19",
  "showcase-intelligence-composite": "70b24c88-81a5-469d-ae57-3df0daea2b3c",
  "showcase-intelligence-gateway": "f2eec3fd-d841-481b-9a9d-c8fd94c27870",
  "showcase-intelligence-gateway-proxy": "12513b2b-e368-4f7a-8141-1c28ab4f6f09",
  "showcase-intelligence-postgres": "6c2d2998-e7ae-413d-997d-7277f9fd6e07",
  "showcase-intelligence-redis": "7b99fa95-2124-4d19-838a-652464e351da",
};

describe("permanent fleet lifecycle isolation", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "railway-fleet-"));
    const path = join(directory, "runs.json");
    vi.stubEnv("REDEPLOY_SUMMARY_JSON", undefined);
    vi.stubEnv("SHOWCASE_DISPOSABLE_RUN_RECORDS_FILE", path);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await writeFile(path, JSON.stringify(ACTIVE));
    // Only this test policy approves the fictitious image; the committed
    // approval list stays empty. The real reader validates the fixture.
    const evidence = await readRailwayLifecycleEvidence(
      path,
      { ...DISPOSABLE_LIFECYCLE_POLICY, approvedImages: [IMAGE] },
      NOW,
    );
    expect(evidence.status).toBe("valid");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("redeploys the permanent default fleet and expands explicit image consumers", async () => {
    const redeploy = vi.fn(async () => ({ ok: true as const }));
    const result = await runRedeploy({
      env: "staging",
      redeploy,
      appendSummary: () => {},
    });
    expect(result.exitCode).toBe(0);
    expect(result.attempted).toBe(42);
    expect(redeploy).toHaveBeenCalledWith(
      SERVICES["harness-workers"].serviceId,
      STAGING_ENV_ID,
    );
    expect(redeploy).not.toHaveBeenCalledWith(TEMP_ID, expect.anything());
    for (const id of Object.values(INTELLIGENCE_IDS)) {
      expect(redeploy).not.toHaveBeenCalledWith(id, expect.anything());
    }

    redeploy.mockClear();
    await runRedeploy({
      env: "staging",
      services: ["showcase-harness"],
      redeploy,
      appendSummary: () => {},
    });
    expect(redeploy.mock.calls).toEqual([
      [SERVICES.harness.serviceId, STAGING_ENV_ID],
      [SERVICES["harness-workers"].serviceId, STAGING_ENV_ID],
    ]);
  });

  it.each([TEMP_NAME, TEMP_ID, "unrecorded-disposable"])(
    "rejects explicit target %s before any deployment",
    async (target) => {
      const redeploy = vi.fn(async () => ({ ok: true as const }));
      await expect(
        runRedeploy({
          env: "staging",
          services: ["harness", target],
          redeploy,
          appendSummary: () => {},
        }),
      ).rejects.toThrow(/Unknown service/);
      expect(redeploy).not.toHaveBeenCalled();
      expect(() => computePromoteClosure(["harness", target])).toThrow(
        /unknown service/,
      );
    },
  );

  it("reconciles permanent drift without reading or redeploying a temporary service", async () => {
    const fetchDeployedDigest = vi.fn(async (id: string) =>
      id === SERVICES.harness.serviceId ? `sha256:${"b".repeat(64)}` : DIGEST,
    );
    const redeploy = vi.fn(async () => ({ ok: true as const }));
    const postSlackAlert = vi.fn(async () => true);
    const result = await reconcileStaging({
      fetchDeployedDigest,
      fetchLatestDigest: async () => DIGEST,
      redeployStaging: (services) =>
        runRedeploy({
          env: "staging",
          services,
          redeploy,
          appendSummary: () => {},
        }),
      postSlackAlert,
      log: () => {},
    });
    expect(reconcileExitCode(result)).toBe(0);
    expect(result.checked).toBe(42);
    expect(result.lagging).toEqual(["harness"]);
    expect(redeploy.mock.calls).toEqual([
      [SERVICES.harness.serviceId, STAGING_ENV_ID],
      [SERVICES["harness-workers"].serviceId, STAGING_ENV_ID],
    ]);
    expect(fetchDeployedDigest).not.toHaveBeenCalledWith(
      TEMP_ID,
      expect.anything(),
    );
    for (const id of Object.values(INTELLIGENCE_IDS)) {
      expect(fetchDeployedDigest).not.toHaveBeenCalledWith(
        id,
        expect.anything(),
      );
    }
  });

  it("refuses an explicitly scoped temporary reconcile before service reads or deployment", async () => {
    const fetchDeployedDigest = vi.fn(async () => DIGEST);
    const fetchLatestDigest = vi.fn(async () => DIGEST);
    const redeployStaging = vi.fn();
    const result = await reconcileStaging({
      services: [TEMP_NAME],
      fetchDeployedDigest,
      fetchLatestDigest,
      redeployStaging,
      postSlackAlert: async () => true,
      log: () => {},
    });
    expect(reconcileExitCode(result)).toBe(1);
    expect(result.errors).toEqual([
      { service: TEMP_NAME, error: "not an SSOT service key" },
    ]);
    expect(fetchDeployedDigest).not.toHaveBeenCalled();
    expect(fetchLatestDigest).not.toHaveBeenCalled();
    expect(redeployStaging).not.toHaveBeenCalled();
  });

  it("ignores temporary and unmanaged live auto-update settings while checking permanent services", async () => {
    const fetchEnvConfig = vi.fn(async (environmentId: string) => {
      const env = Object.keys(ENV_ID_BY_NAME).find(
        (name) => ENV_ID_BY_NAME[name] === environmentId,
      )!;
      return {
        services: Object.fromEntries([
          ...Object.values(SERVICES).map((entry) => [
            entry.serviceId,
            {
              source: {
                autoUpdates:
                  expectedPolicyFor(entry, env) === "disabled"
                    ? null
                    : { type: "minor" },
              },
            },
          ]),
          [TEMP_ID, { source: { autoUpdates: { type: "minor" } } }],
        ]),
      };
    });
    const result = await runAutoUpdatesGate({
      services: SERVICES,
      envIds: ENV_ID_BY_NAME,
      fetchEnvConfig,
    });
    expect(summarizeAutoUpdatesFailures(result).shouldFail).toBe(false);
    expect(result.checked).toBeGreaterThan(0);
    expect(result.skipped).toBe(0);
    expect(result.violations).toEqual([]);
    expect(fetchEnvConfig.mock.calls.map(([id]) => id).sort()).toEqual(
      Object.values(ENV_ID_BY_NAME).sort(),
    );
  });

  it.each(["empty", "invalid"] as const)(
    "%s records cannot enroll a target or block the default fleet",
    async (state) => {
      const path = process.env.SHOWCASE_DISPOSABLE_RUN_RECORDS_FILE!;
      await writeFile(
        path,
        state === "empty"
          ? JSON.stringify({ schemaVersion: 1, runs: [] })
          : "{malformed",
      );
      const evidence = await readRailwayLifecycleEvidence(
        path,
        DISPOSABLE_LIFECYCLE_POLICY,
        NOW,
      );
      expect(evidence.status).toBe(state === "empty" ? "valid" : "invalid");
      const redeploy = vi.fn(async () => ({ ok: true as const }));
      const result = await runRedeploy({
        env: "staging",
        redeploy,
        appendSummary: () => {},
      });
      expect(result.exitCode).toBe(0);
      expect(result.attempted).toBe(42);
      expect(redeploy).not.toHaveBeenCalledWith(TEMP_ID, expect.anything());
      redeploy.mockClear();
      await expect(
        runRedeploy({
          env: "staging",
          services: ["harness", TEMP_NAME],
          redeploy,
          appendSummary: () => {},
        }),
      ).rejects.toThrow(/Unknown service/);
      expect(redeploy).not.toHaveBeenCalled();
      expect(computePromoteClosure(Object.keys(SERVICES))).toEqual(
        emitted.closure,
      );
      expect(Object.keys(SERVICES)).toHaveLength(49);
    },
  );

  it("keeps static Intelligence identities and the emitted permanent closure unchanged", () => {
    expect(Object.keys(SERVICES)).toHaveLength(49);
    expect(Object.hasOwn(SERVICES, TEMP_NAME)).toBe(false);
    expect(DISPOSABLE_LIFECYCLE_POLICY.approvedImages).toEqual([]);
    for (const [name, id] of Object.entries(INTELLIGENCE_IDS)) {
      expect(SERVICES[name]).toMatchObject({
        serviceId: id,
        ciBuilt: false,
        gateValidated: false,
        gateIgnore: true,
        autoUpdates: { staging: "unmanaged" },
        environments: { staging: { probe: false } },
      });
    }
    const closure = computePromoteClosure(Object.keys(SERVICES));
    expect(closure).toEqual(emitted.closure);
    expect(closure.services.map(({ name }) => name)).toContain(
      "harness-workers",
    );
    expect(closure.services.map(({ name }) => name)).toContain("aimock");
    expect(
      [...closure.services, ...closure.skipped].map(({ name }) => name),
    ).not.toContain(TEMP_NAME);
    expect(emitted.services.map(({ name }) => name)).not.toContain(TEMP_NAME);
  });
});
