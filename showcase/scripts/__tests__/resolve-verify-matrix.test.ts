/**
 * resolve-verify-matrix.test.ts — covers the pure resolver that decides
 * which services the post-redeploy verify probe should target.
 *
 * The resolver replaces the inline bash+jq block in
 * .github/workflows/showcase_deploy.yml's `resolve-matrix` job ("Build
 * verify matrix from SSOT" step). The bash had produced two confirmed
 * bugs across prior CR rounds, so the logic was extracted to a pure
 * function with parity tests against the OLD behavior PLUS a new test
 * for the Issue A fix:
 *
 *   workflow_run + summary_present=true + ok_services empty (all errored)
 *   → has_services=false (skip verify). The previous bash fell through
 *   to the full probe-eligible fleet, gratuitously probing all services
 *   against stale `:latest` on a redeploy where everything errored. The
 *   workflow still reds via `enforce-redeploy-gate` (independent of this
 *   matrix), so skipping verify here is correct.
 *
 * Cases (mirrors the decision table in the resolver JSDoc):
 *   1. workflow_dispatch + 'all' → full probe-eligible set, has_services=true.
 *   2. workflow_dispatch + specific in-SSOT service → just that service.
 *   3. workflow_dispatch + unknown service → throws (preserves bash).
 *   4. workflow_run + summary_present=false → has_services=false.
 *   5. workflow_run + summary_present=true + ok empty → has_services=false. [FIX]
 *   6. workflow_run + summary_present=true + ok=[a,c] → intersection.
 *   7. ok contains a non-probe-eligible service → excluded.
 */
import { describe, expect, it } from "vitest";
import {
  resolveVerifyMatrix,
  type SsotService,
} from "../resolve-verify-matrix";

// Fixture SSOT services: a mix of probe.staging=true and false, with
// both `name` and `dispatchName` populated so the intersection logic
// can be exercised against either spelling.
const fixtureServices: SsotService[] = [
  {
    name: "svc-a",
    dispatchName: "dispatch-a",
    probe: { staging: true },
  },
  {
    name: "svc-b",
    dispatchName: "dispatch-b",
    probe: { staging: true },
  },
  {
    name: "svc-c",
    dispatchName: "dispatch-c",
    probe: { staging: true },
  },
  {
    name: "svc-d",
    dispatchName: "dispatch-d",
    probe: { staging: true },
  },
  // probe.staging=false → never in the probe-eligible set.
  {
    name: "svc-noprobe-1",
    dispatchName: "dispatch-noprobe-1",
    probe: { staging: false },
  },
  {
    name: "svc-noprobe-2",
    dispatchName: null,
    probe: { staging: false },
  },
];

describe("resolveVerifyMatrix", () => {
  it("workflow_dispatch + 'all' → full probe-eligible set, sorted, has_services=true", () => {
    const out = resolveVerifyMatrix({
      eventName: "workflow_dispatch",
      summaryPresent: "",
      okFromRedeploy: "",
      dispatchService: "all",
      ssotServices: fixtureServices,
    });
    // The bash emits `jq -r '.services[] | select(.probe.staging == true) | .name' | sort -u`.
    // Probe-eligible names: svc-a, svc-b, svc-c, svc-d. Sorted+dedup'd, CSV.
    expect(out.servicesCsv).toBe("svc-a,svc-b,svc-c,svc-d");
    expect(out.hasServices).toBe(true);
  });

  it("workflow_dispatch + empty dispatch input (defaults to 'all') → full probe-eligible set", () => {
    const out = resolveVerifyMatrix({
      eventName: "workflow_dispatch",
      summaryPresent: "",
      okFromRedeploy: "",
      dispatchService: "",
      ssotServices: fixtureServices,
    });
    expect(out.servicesCsv).toBe("svc-a,svc-b,svc-c,svc-d");
    expect(out.hasServices).toBe(true);
  });

  it("workflow_dispatch + specific in-SSOT service (by name) → just that service", () => {
    const out = resolveVerifyMatrix({
      eventName: "workflow_dispatch",
      summaryPresent: "",
      okFromRedeploy: "",
      dispatchService: "svc-b",
      ssotServices: fixtureServices,
    });
    expect(out.servicesCsv).toBe("svc-b");
    expect(out.hasServices).toBe(true);
  });

  it("workflow_dispatch + specific in-SSOT service (by dispatchName) → resolves to canonical name", () => {
    const out = resolveVerifyMatrix({
      eventName: "workflow_dispatch",
      summaryPresent: "",
      okFromRedeploy: "",
      dispatchService: "dispatch-c",
      ssotServices: fixtureServices,
    });
    expect(out.servicesCsv).toBe("svc-c");
    expect(out.hasServices).toBe(true);
  });

  it("workflow_dispatch + unknown service → throws (preserves bash error/exit behavior)", () => {
    // The bash printed `::error::Unknown service '$DISPATCH_SERVICE' (not
    // an SSOT key or dispatch_name)` and `exit 1`. The resolver mirrors
    // this by throwing; the CLI wrapper converts the throw into a non-zero
    // process exit with the same `::error::` annotation.
    expect(() =>
      resolveVerifyMatrix({
        eventName: "workflow_dispatch",
        summaryPresent: "",
        okFromRedeploy: "",
        dispatchService: "totally-not-a-real-service",
        ssotServices: fixtureServices,
      }),
    ).toThrow(/Unknown service 'totally-not-a-real-service'/);
  });

  it("workflow_run + summary_present=false → has_services=false (nothing was redeployed)", () => {
    const out = resolveVerifyMatrix({
      eventName: "workflow_run",
      summaryPresent: "false",
      okFromRedeploy: "",
      dispatchService: "",
      ssotServices: fixtureServices,
    });
    expect(out.servicesCsv).toBe("");
    expect(out.hasServices).toBe(false);
  });

  // ---------------------------------------------------------------------
  // Issue A fix — write this FIRST and watch it RED against a naive
  // implementation that falls through to the full probe-eligible fleet
  // when OK_FROM_REDEPLOY is empty. The old bash collapsed (summary-
  // present, all-errored) with (summary-absent / dispatch-fleet) and
  // probed every service against stale :latest. The workflow already
  // reds via `enforce-redeploy-gate` when redeploy_red=true, so this
  // matrix should yield has_services=false in the all-errored case.
  // ---------------------------------------------------------------------
  it("workflow_run + summary_present=true + ok empty → has_services=false (Issue A fix)", () => {
    const out = resolveVerifyMatrix({
      eventName: "workflow_run",
      summaryPresent: "true",
      okFromRedeploy: "",
      dispatchService: "",
      ssotServices: fixtureServices,
    });
    expect(out.servicesCsv).toBe("");
    expect(out.hasServices).toBe(false);
  });

  it("workflow_run + summary_present=true + ok=[svc-a,svc-c] → csv = sorted intersection with probe-eligible", () => {
    const out = resolveVerifyMatrix({
      eventName: "workflow_run",
      summaryPresent: "true",
      okFromRedeploy: "svc-a,svc-c",
      dispatchService: "",
      ssotServices: fixtureServices,
    });
    expect(out.servicesCsv).toBe("svc-a,svc-c");
    expect(out.hasServices).toBe(true);
  });

  it("workflow_run + ok uses dispatchName aliases → resolved to canonical names in CSV", () => {
    // The redeploy summary CSV may carry dispatch_names (the build matrix
    // identifier) rather than SSOT keys. The bash mapped via
    // `select(.name == $r or .dispatchName == $r) | .name` → canonical.
    const out = resolveVerifyMatrix({
      eventName: "workflow_run",
      summaryPresent: "true",
      okFromRedeploy: "dispatch-a,dispatch-c",
      dispatchService: "",
      ssotServices: fixtureServices,
    });
    expect(out.servicesCsv).toBe("svc-a,svc-c");
    expect(out.hasServices).toBe(true);
  });

  it("workflow_run + ok contains a non-probe-eligible service → excluded from CSV", () => {
    // svc-noprobe-1 has probe.staging=false; even if it redeployed OK
    // it must not appear in the verify matrix because we have no probe
    // driver for it.
    const out = resolveVerifyMatrix({
      eventName: "workflow_run",
      summaryPresent: "true",
      okFromRedeploy: "svc-a,svc-noprobe-1,svc-d",
      dispatchService: "",
      ssotServices: fixtureServices,
    });
    expect(out.servicesCsv).toBe("svc-a,svc-d");
    expect(out.hasServices).toBe(true);
  });

  it("workflow_run + ok intersection collapses to empty → has_services=false", () => {
    // Every OK service is non-probe-eligible. Old bash would have emitted
    // services_csv='' and has_services=false here too (it set has_services
    // off the CSV emptiness), so this is a parity case.
    const out = resolveVerifyMatrix({
      eventName: "workflow_run",
      summaryPresent: "true",
      okFromRedeploy: "svc-noprobe-1,svc-noprobe-2",
      dispatchService: "",
      ssotServices: fixtureServices,
    });
    expect(out.servicesCsv).toBe("");
    expect(out.hasServices).toBe(false);
  });

  it("workflow_run + ok with duplicates → dedup'd in CSV", () => {
    const out = resolveVerifyMatrix({
      eventName: "workflow_run",
      summaryPresent: "true",
      okFromRedeploy: "svc-a,svc-a,dispatch-a,svc-b",
      dispatchService: "",
      ssotServices: fixtureServices,
    });
    expect(out.servicesCsv).toBe("svc-a,svc-b");
    expect(out.hasServices).toBe(true);
  });
});
