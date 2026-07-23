/**
 * Tests for healthcheck-path resolution during provisioning in
 * `deploy-to-railway.ts` (`resolveProvisionHealthcheck`).
 *
 * Contract under test: `healthcheckPathFor` returns undefined for TWO distinct
 * reasons, and conflating them wedges deploys:
 *
 *   1. The service is NOT tracked in the SSOT at all (brand-new/unknown
 *      service this script is onboarding) → fall back to the agent-class
 *      default `/api/health`.
 *   2. The service IS tracked but deliberately has a null/omitted
 *      healthcheckPath (dashboard, docs, dojo, webhooks, pocketbase) → it has
 *      no HTTP health endpoint, so the healthcheck MUST be omitted. Forcing
 *      `/api/health` onto it yields a 404 that wedges the deploy (the bug this
 *      test guards against).
 *
 * Pure SSOT lookups — no network I/O, no aimock (no LLM surface here).
 */

import { describe, it, expect } from "vitest";
import { resolveProvisionHealthcheck } from "../deploy-to-railway";

describe("resolveProvisionHealthcheck", () => {
  it("OMITS the healthcheck for a TRACKED service with a null healthcheckPath (docs)", () => {
    // RED before fix: `healthcheckPathFor("docs") ?? "/api/health"` wrongly
    // returned "/api/health" for this tracked-null service.
    expect(resolveProvisionHealthcheck("docs")).toEqual({ kind: "omit" });
  });

  it("OMITS the healthcheck for other tracked-null services (dashboard, dojo, webhooks, pocketbase)", () => {
    for (const svc of ["dashboard", "dojo", "webhooks", "pocketbase"]) {
      expect(resolveProvisionHealthcheck(svc)).toEqual({ kind: "omit" });
    }
  });

  it("SETS the SSOT healthcheckPath verbatim for a tracked service that defines one (aimock → /health)", () => {
    expect(resolveProvisionHealthcheck("aimock")).toEqual({
      kind: "set",
      path: "/health",
    });
  });

  it("SETS /api/health for a tracked agent service (showcase-langgraph-python)", () => {
    expect(resolveProvisionHealthcheck("showcase-langgraph-python")).toEqual({
      kind: "set",
      path: "/api/health",
    });
  });

  it("FALLS BACK to /api/health for an UNTRACKED brand-new service", () => {
    expect(resolveProvisionHealthcheck("totally-new-unknown-service")).toEqual({
      kind: "set",
      path: "/api/health",
    });
  });

  it("does NOT treat inherited Object.prototype keys as tracked services", () => {
    // Own-property semantics: "constructor"/"toString" are not SSOT members,
    // so they take the untracked fallback rather than resolving to a prototype.
    for (const key of ["constructor", "toString", "hasOwnProperty"]) {
      expect(resolveProvisionHealthcheck(key)).toEqual({
        kind: "set",
        path: "/api/health",
      });
    }
  });
});
