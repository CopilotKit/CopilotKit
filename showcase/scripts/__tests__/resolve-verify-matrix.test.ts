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
  okCsvToCanonicalNames,
  parseSsotServices,
  resolveVerifyMatrix,
} from "../resolve-verify-matrix";
import type { SsotService } from "../resolve-verify-matrix";

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

  // ---------------------------------------------------------------------
  // FIX 3 — unknown eventName must throw rather than silently falling
  // through to the workflow_run intersection branch. A typo or unexpected
  // trigger today produces a SILENT skip (intersection of "" with probe-
  // eligible = empty → has_services=false) which is indistinguishable from
  // the legitimate "summary absent, nothing to verify" path.
  // ---------------------------------------------------------------------
  it("unknown eventName → throws with ::error:: annotation (fail-loud)", () => {
    expect(() =>
      resolveVerifyMatrix({
        eventName: "schedule",
        summaryPresent: "",
        okFromRedeploy: "",
        dispatchService: "",
        ssotServices: fixtureServices,
      }),
    ).toThrow(
      /::error::resolve-verify-matrix: unexpected eventName 'schedule'/,
    );
  });

  // ---------------------------------------------------------------------
  // FIX 7 — make the workflow_run boundary total. summaryPresent MUST be
  // exactly "true" or "false" on workflow_run (check-redeploy-summary
  // always sets one of the two). Any other value (including the empty
  // string from a future step-id-rename wiring break, or "True" from a
  // case-typo) used to fall through to the intersection branch and
  // silently emit has_services=false — indistinguishable from a
  // legitimate skip. Throw instead. workflow_dispatch ignores
  // summaryPresent and must NOT throw.
  // ---------------------------------------------------------------------
  it("workflow_run + summaryPresent='' → throws (boundary is total)", () => {
    expect(() =>
      resolveVerifyMatrix({
        eventName: "workflow_run",
        summaryPresent: "",
        okFromRedeploy: "",
        dispatchService: "",
        ssotServices: fixtureServices,
      }),
    ).toThrow(
      /::error::resolve-verify-matrix: workflow_run requires summary_present in \{true,false\}, got ''/,
    );
  });

  it("workflow_run + summaryPresent='True' (case typo) → throws", () => {
    expect(() =>
      resolveVerifyMatrix({
        eventName: "workflow_run",
        summaryPresent: "True",
        okFromRedeploy: "",
        dispatchService: "",
        ssotServices: fixtureServices,
      }),
    ).toThrow(
      /::error::resolve-verify-matrix: workflow_run requires summary_present in \{true,false\}, got 'True'/,
    );
  });

  it("workflow_dispatch ignores summaryPresent (any value) — does NOT throw on empty", () => {
    // workflow_dispatch path never reads summaryPresent; it must keep
    // working even when the wrapper passes the default "".
    const out = resolveVerifyMatrix({
      eventName: "workflow_dispatch",
      summaryPresent: "",
      okFromRedeploy: "",
      dispatchService: "all",
      ssotServices: fixtureServices,
    });
    expect(out.servicesCsv).toBe("svc-a,svc-b,svc-c,svc-d");
    expect(out.hasServices).toBe(true);
  });
});

// -------------------------------------------------------------------------
// FIX 4 — okCsvToCanonicalNames: trim tokens and report unmatched tokens.
// The redeploy-gate bash emits `join(",")` which produces no spaces today,
// but any future change to the bash (or a human-driven workflow_dispatch
// caller that hand-types a CSV) that adds spaces silently dropped tokens
// because `"a, b".split(",")` yields ["a", " b"] and " b" matches nothing.
// We trim before matching, and surface unknown tokens so the CLI wrapper
// can `::warning::` on SSOT/build drift (the function itself stays pure).
// -------------------------------------------------------------------------
describe("okCsvToCanonicalNames", () => {
  it("trims whitespace around tokens — 'svc-a, svc-c' == 'svc-a,svc-c'", () => {
    const a = okCsvToCanonicalNames("svc-a, svc-c", fixtureServices);
    const b = okCsvToCanonicalNames("svc-a,svc-c", fixtureServices);
    expect(Array.from(a.canonical).sort()).toEqual(["svc-a", "svc-c"]);
    expect(Array.from(b.canonical).sort()).toEqual(["svc-a", "svc-c"]);
    expect(a.dropped).toEqual([]);
    expect(b.dropped).toEqual([]);
  });

  it("reports tokens that match no SSOT service in `dropped`", () => {
    const out = okCsvToCanonicalNames(
      "svc-a,not-a-real-service,svc-b",
      fixtureServices,
    );
    expect(Array.from(out.canonical).sort()).toEqual(["svc-a", "svc-b"]);
    expect(out.dropped).toEqual(["not-a-real-service"]);
  });

  it("ignores empty tokens (e.g. trailing comma) without reporting them as dropped", () => {
    const out = okCsvToCanonicalNames("svc-a,,svc-b,", fixtureServices);
    expect(Array.from(out.canonical).sort()).toEqual(["svc-a", "svc-b"]);
    expect(out.dropped).toEqual([]);
  });
});

// -------------------------------------------------------------------------
// FIX 1 — parseSsotServices: validate the SSOT shape rather than blindly
// casting JSON.parse() output. A truncated/drifted SSOT (emitter crashed
// mid-write, or schema renamed) parses but silently shrinks/empties the
// probe-eligible set → real redeploys go unverified, or verify is skipped
// on a real redeploy. We refuse the ambiguity and throw with a
// ::error::-prefixed message.
// -------------------------------------------------------------------------
describe("parseSsotServices", () => {
  it("accepts a well-formed SSOT and returns the services array", () => {
    const raw = {
      services: [
        { name: "svc-a", dispatchName: null, probe: { staging: true } },
        {
          name: "svc-b",
          dispatchName: "dispatch-b",
          probe: { staging: false },
        },
      ],
    };
    const out = parseSsotServices(raw, "test-path");
    expect(out).toHaveLength(2);
    expect(out[0].name).toBe("svc-a");
    expect(out[1].probe.staging).toBe(false);
  });

  it("throws when `services` is not an array", () => {
    expect(() =>
      parseSsotServices({ services: { not: "an array" } }, "test-path"),
    ).toThrow(/::error::SSOT test-path malformed: `services` is not an array/);
  });

  it("throws when `services` is an empty array (emitter crashed mid-write)", () => {
    expect(() => parseSsotServices({ services: [] }, "test-path")).toThrow(
      /::error::SSOT test-path malformed: `services` is empty/,
    );
  });

  it("throws when a service entry has no `name`", () => {
    expect(() =>
      parseSsotServices(
        {
          services: [
            { name: "svc-a", dispatchName: null, probe: { staging: true } },
            { dispatchName: null, probe: { staging: true } },
          ],
        },
        "test-path",
      ),
    ).toThrow(
      /::error::SSOT test-path malformed: services\[1\] missing `name`/,
    );
  });

  it("throws when `probe` is missing", () => {
    expect(() =>
      parseSsotServices(
        {
          services: [{ name: "svc-a", dispatchName: null }],
        },
        "test-path",
      ),
    ).toThrow(
      /::error::SSOT test-path malformed: services\[0\] \(svc-a\) missing `probe`/,
    );
  });

  it("accepts a missing `dispatchName` (live SSOT has services without one, e.g. pocketbase) and normalizes to null", () => {
    const out = parseSsotServices(
      {
        services: [
          { name: "svc-a", probe: { staging: true } },
          { name: "svc-b", dispatchName: null, probe: { staging: true } },
          {
            name: "svc-c",
            dispatchName: "dispatch-c",
            probe: { staging: true },
          },
        ],
      },
      "test-path",
    );
    expect(out[0].dispatchName).toBeNull();
    expect(out[1].dispatchName).toBeNull();
    expect(out[2].dispatchName).toBe("dispatch-c");
  });

  it("throws when `dispatchName` is set to a non-string non-null value", () => {
    expect(() =>
      parseSsotServices(
        {
          services: [
            { name: "svc-a", dispatchName: 42, probe: { staging: true } },
          ],
        },
        "test-path",
      ),
    ).toThrow(
      /::error::SSOT test-path malformed: services\[0\] \(svc-a\) `dispatchName` must be string, null, or absent/,
    );
  });

  it("throws when `probe.staging` is not a boolean", () => {
    expect(() =>
      parseSsotServices(
        {
          services: [
            {
              name: "svc-a",
              dispatchName: null,
              probe: { staging: "true" },
            },
          ],
        },
        "test-path",
      ),
    ).toThrow(
      /::error::SSOT test-path malformed: services\[0\] \(svc-a\) `probe.staging` is not boolean/,
    );
  });
});
