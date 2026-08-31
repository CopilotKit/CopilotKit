import { describe, it, expect } from "vitest";
import {
  selectDriftProbeKind,
  OPS_PROD_DRIFT_KIND,
  OPS_STAGING_DRIFT_KIND,
} from "./ops-drift-routing.js";

/**
 * Ops-surface drift routing (plan U11 / spec §7.3).
 *
 * The Ops surface must use the CROSS-ENV pin-drift probe
 * (`pin_drift_cross_env`, U6's driver) as the authoritative drift signal
 * for PROD services, and the `:latest`-drift probe (`image_drift`) only
 * for STAGING. Before this routing the Ops surface treated pinned prod as
 * `:latest`-drift — image-drift's `pinnedExpected` neutralization renders
 * prod GREEN by SUPPRESSING the signal rather than verifying prod is
 * running what it was promoted to. These tests pin the routing so a future
 * edit that re-points prod at `:latest`-drift (the lie) fails CI.
 */
describe("selectDriftProbeKind — prod→cross-env-pin-drift, staging→:latest-drift", () => {
  it("routes a production env to the CROSS-ENV pin-drift kind", () => {
    expect(selectDriftProbeKind({ SHOWCASE_ENV: "production" })).toBe(
      "pin_drift_cross_env",
    );
  });

  it("routes a staging env to the :latest image-drift kind", () => {
    expect(selectDriftProbeKind({ SHOWCASE_ENV: "staging" })).toBe(
      "image_drift",
    );
  });

  it("resolves prod from Railway's injected RAILWAY_ENVIRONMENT_NAME", () => {
    expect(
      selectDriftProbeKind({ RAILWAY_ENVIRONMENT_NAME: "production" }),
    ).toBe("pin_drift_cross_env");
  });

  it("resolves staging from Railway's injected RAILWAY_ENVIRONMENT_NAME", () => {
    expect(selectDriftProbeKind({ RAILWAY_ENVIRONMENT_NAME: "staging" })).toBe(
      "image_drift",
    );
  });

  it("prefers the explicit SHOWCASE_ENV override over RAILWAY_ENVIRONMENT_NAME", () => {
    // A prod harness deployed with an explicit staging override must route
    // as staging — the override wins, mirroring image-drift's isProductionEnv.
    expect(
      selectDriftProbeKind({
        SHOWCASE_ENV: "staging",
        RAILWAY_ENVIRONMENT_NAME: "production",
      }),
    ).toBe("image_drift");
  });

  it("is case-insensitive on the env-name match (Production → prod routing)", () => {
    expect(selectDriftProbeKind({ SHOWCASE_ENV: "Production" })).toBe(
      "pin_drift_cross_env",
    );
  });

  it("defaults a non-production env (unknown / unset) to :latest-drift", () => {
    // Only a genuine production label routes to cross-env pin-drift; an
    // unset or unrecognised env is NOT prod, so it falls to the staging
    // `:latest`-drift path (never the prod cross-env path on a guess).
    expect(selectDriftProbeKind({})).toBe("image_drift");
    expect(selectDriftProbeKind({ SHOWCASE_ENV: "unknown" })).toBe(
      "image_drift",
    );
  });

  it("exposes the two routed kinds as named constants matching the driver kinds", () => {
    expect(OPS_PROD_DRIFT_KIND).toBe("pin_drift_cross_env");
    expect(OPS_STAGING_DRIFT_KIND).toBe("image_drift");
  });
});
