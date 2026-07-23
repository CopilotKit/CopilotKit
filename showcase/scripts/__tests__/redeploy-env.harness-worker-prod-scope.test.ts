import { describe, expect, it } from "vitest";
import { expandImageConsumers } from "../redeploy-env";
import { SERVICES } from "../railway-envs";

// Regression: the prod `harness-workers` fleet worker runs the shared
// `showcase-harness` image (`imageOf: "harness"`) but had NO `prod` env entry
// in the SSOT. `expandImageConsumers` is env-aware — a consumer only joins an
// env's redeploy scope if it declares that env — so a rebuilt
// `showcase-harness:latest` bounced the prod control-plane but SILENTLY SKIPPED
// the prod worker, leaving it on a stale image (a 1-demo `registry.json` for
// `ms-agent-harness-dotnet` → missing `UI` badge → `D0`). This test exercises
// the REAL expansion against the REAL SSOT and asserts the prod worker enters
// the prod harness redeploy scope.
//
// Verified prod worker identity (Railway, READ-ONLY GraphQL):
//   serviceId  c2aa8a0b-350e-4b76-8541-3012dfac41d0
//   prod env   b14919f4-6417-429f-848d-c6ae2201e04f
//   instanceId 7c48ee43-6df4-457b-b977-10f1f1ac1680
const PROD_WORKER_SERVICE_ID = "c2aa8a0b-350e-4b76-8541-3012dfac41d0";

describe("harness redeploy-scope expansion (imageOf: harness) — prod worker", () => {
  it("includes harness-workers in the PROD redeploy scope when showcase-harness rebuilds", () => {
    // The image-rebuild scope for `showcase-harness:latest` starts at its
    // builder SSOT key, `harness`. The redeploy script expands this with
    // env-aware imageOf consumers before redeploying.
    const scope = expandImageConsumers(["harness"], "prod");

    // The prod worker MUST be pulled in so a rebuild bounces it off its stale
    // image. (RED before the SSOT backfill: the worker declares only `staging`,
    // so the env filter at redeploy-env.ts:278 drops it from the prod scope.)
    expect(scope).toContain("harness-workers");

    // And it must resolve to the real prod worker service.
    const worker = SERVICES["harness-workers"];
    expect(worker.serviceId).toBe(PROD_WORKER_SERVICE_ID);
    expect(Object.hasOwn(worker.environments, "prod")).toBe(true);
  });

  it("still includes harness-workers in the STAGING redeploy scope (no regression)", () => {
    const scope = expandImageConsumers(["harness"], "staging");
    expect(scope).toContain("harness-workers");
  });
});
