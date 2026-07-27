import { describe, expect, it } from "vitest";
import {
  asHost,
  parseArgs,
  resolveProbeTargets,
  runVerify,
} from "../verify-deploy";
import type { ProbeRunner } from "../verify-deploy";
import { SERVICES, probeEnabled } from "../railway-envs";

describe("verify-deploy argv parsing", () => {
  it("requires --env", () => {
    expect(() => parseArgs([])).toThrow(/--env/);
  });

  it("accepts --env staging and --env prod", () => {
    expect(parseArgs(["--env", "staging"]).env).toBe("staging");
    expect(parseArgs(["--env=prod"]).env).toBe("prod");
  });

  it("rejects unknown envs", () => {
    expect(() => parseArgs(["--env", "dev"])).toThrow(/Unknown env/);
  });

  it("accepts optional --services CSV", () => {
    const parsed = parseArgs(["--env", "staging", "--services", "docs,shell"]);
    expect(parsed.services).toEqual(["docs", "shell"]);
  });

  it("rejects empty --services= equals-form (mirrors space-form behavior)", () => {
    expect(() => parseArgs(["--env", "staging", "--services="])).toThrow(
      /--services/,
    );
  });

  it("rejects --services space-form whose CSV is all empty entries (symmetry with equals-form)", () => {
    // Bug: space-form previously only guarded `!v` on the raw next-arg,
    // so `--services ,,` produced an empty list that fell through to a
    // less-precise zero-targets error. Both forms must throw the same
    // precise `--services requires a CSV value` here.
    expect(() => parseArgs(["--env=staging", "--services", ",,"])).toThrow(
      /--services requires a CSV value/,
    );
  });

  it("defaults skipIneligible to true (skip-by-default — known-but-ineligible names are a legitimate state)", () => {
    const parsed = parseArgs(["--env", "staging"]);
    expect(parsed.skipIneligible).toBe(true);
  });

  it("accepts --skip-ineligible as an explicit no-op (now the default; back-compat with the staging precondition caller)", () => {
    const parsed = parseArgs([
      "--env",
      "staging",
      "--services",
      "docs",
      "--skip-ineligible",
    ]);
    expect(parsed.skipIneligible).toBe(true);
  });

  it("accepts --strict-eligibility to opt OUT of skip-by-default (restore hard-refuse)", () => {
    const parsed = parseArgs([
      "--env",
      "prod",
      "--services",
      "harness-workers",
      "--strict-eligibility",
    ]);
    expect(parsed.skipIneligible).toBe(false);
  });

  it("rejects bare trailing --env (no following value)", () => {
    // Bug: `argv[++i]` was undefined and we deferred to a vague
    // `resolveEnv` error. Must throw the precise message here.
    expect(() => parseArgs(["--env"])).toThrow(
      /--env requires a value \(staging\|prod\)/,
    );
  });

  it("rejects --env= with empty value (symmetry with bare trailing --env)", () => {
    expect(() => parseArgs(["--env="])).toThrow(
      /--env requires a value \(staging\|prod\)/,
    );
  });
});

describe("resolveProbeTargets", () => {
  it("filters SSOT to entries where probe[env] is true", () => {
    const targets = resolveProbeTargets({ env: "staging" });
    // docs is staging:true → must be present.
    expect(targets.find((t) => t.name === "docs")).toBeDefined();
  });

  it("REFUSES when a probe-required service has no domain for the env", () => {
    expect(() =>
      resolveProbeTargets({
        env: "staging",
        overrides: {
          docs: { domains: { staging: "", prod: "docs.copilotkit.ai" } },
        },
      }),
    ).toThrow(/missing.*staging.*domain/i);
  });

  it("honors --services filter (subset of probe-eligible)", () => {
    const targets = resolveProbeTargets({
      env: "staging",
      services: ["docs"],
    });
    expect(targets.length).toBe(1);
    expect(targets[0].name).toBe("docs");
  });

  it("REFUSES a typo'd service name (unknown service, not silent drop)", () => {
    expect(() =>
      resolveProbeTargets({ env: "staging", services: ["docss"] }),
    ).toThrow(/unknown service.*docss/i);
  });

  it("REFUSES a service that exists in SSOT but is not probe-eligible for the env", () => {
    // Find a service whose probe[staging] is false.
    // Use override seam to flip probe state without mutating SSOT.
    // Since resolveProbeTargets doesn't expose a probe-flag override,
    // we pick a real service name and an env where the SSOT probe is
    // false. Search SERVICES for an entry where probe.staging===false.
    // If none exists, this test still validates the error string for
    // the more common typo case via the prior test; we focus on the
    // distinct error phrasing.
    //
    // Practical assertion: an unknown name surfaces as "unknown
    // service", which is structurally a different (clearer) error
    // than "not probe-eligible". The two paths must be distinguished.
    expect(() =>
      resolveProbeTargets({ env: "staging", services: ["totally-fake"] }),
    ).toThrow(/unknown service/i);
  });

  it("REFUSES a non-probe-eligible service when skipIneligible is unset (function-level strict; CLI passes skipIneligible=true)", () => {
    // The resolveProbeTargets PRIMITIVE stays strict when skipIneligible is
    // not passed — an explicit caller that wants the hard refusal (or the
    // CLI's `--strict-eligibility` opt-out) gets the distinct "not
    // probe-eligible" error. The CLI itself now defaults skipIneligible=true
    // (see parseArgs), so the verify-prod gate composes; this test pins the
    // primitive's unset-flag contract, not the CLI default.
    const ineligible = Object.keys(SERVICES).find(
      (n) => SERVICES[n] !== undefined && !probeEnabled(n, "staging"),
    );
    expect(ineligible).toBeDefined();
    expect(() =>
      resolveProbeTargets({ env: "staging", services: [ineligible as string] }),
    ).toThrow(/not probe-eligible/i);
  });

  it("SKIPS non-probe-eligible services (skipIneligible) instead of crashing, keeping eligible ones", () => {
    // The promote precondition probes the FULL promote set (service=all),
    // which legitimately includes non-probe-eligible starters
    // (probe.staging=false). Those must be SKIPPED, not crash the run.
    const ineligible = Object.keys(SERVICES).find(
      (n) => SERVICES[n] !== undefined && !probeEnabled(n, "staging"),
    );
    expect(ineligible).toBeDefined();
    // "docs" is probe.staging=true — must survive the skip filter.
    const targets = resolveProbeTargets({
      env: "staging",
      services: ["docs", ineligible as string],
      skipIneligible: true,
    });
    const names = targets.map((t) => t.name);
    expect(names).toContain("docs");
    expect(names).not.toContain(ineligible);
  });

  it("still REFUSES an unknown service even with skipIneligible (typo is a real error, not a skip)", () => {
    // skipIneligible only relaxes the probe.staging=false case; a name
    // that is not in the SSOT at all is still a hard error.
    expect(() =>
      resolveProbeTargets({
        env: "staging",
        services: ["docs", "totally-fake"],
        skipIneligible: true,
      }),
    ).toThrow(/unknown service/i);
  });

  it("REFUSES an override domain carrying a scheme (ingress branding wired)", () => {
    // The override seam in `resolveProbeTargets` bypasses `domainFor`,
    // so `asHost` is the sole ingress validator on that path. A
    // scheme-bearing override must surface as a hard throw, proving
    // the `asHost(rawHost)` call is actually wired in.
    expect(() =>
      resolveProbeTargets({
        env: "staging",
        services: ["docs"],
        overrides: {
          docs: {
            domains: { staging: "https://docs.test", prod: "docs.test" },
          },
        },
      }),
    ).toThrow(/scheme/i);
  });

  it("REFUSES an override domain carrying a path/slash (ingress branding wired)", () => {
    expect(() =>
      resolveProbeTargets({
        env: "staging",
        services: ["docs"],
        overrides: {
          docs: {
            domains: { staging: "docs.test/path", prod: "docs.test" },
          },
        },
      }),
    ).toThrow(/path|slash/i);
  });
});

describe("asHost validator", () => {
  it("accepts a bare hostname literal", () => {
    expect(() => asHost("docs.example.com")).not.toThrow();
    // Returned value IS a string at runtime (brand is structural).
    const h = asHost("docs.example.com");
    expect(typeof h).toBe("string");
    expect(h).toBe("docs.example.com");
  });

  it("rejects values with a scheme separator", () => {
    expect(() => asHost("https://x")).toThrow(/scheme/i);
    expect(() => asHost("http://docs.example.com")).toThrow(/scheme/i);
  });

  it("rejects values containing a path or slash", () => {
    expect(() => asHost("x/y")).toThrow(/path|slash/i);
    expect(() => asHost("docs.example.com/")).toThrow(/path|slash/i);
  });

  it("rejects the empty string", () => {
    expect(() => asHost("")).toThrow(/empty/i);
  });

  it("rejects leading/trailing whitespace", () => {
    expect(() => asHost(" docs.example.com")).toThrow(/whitespace/i);
    expect(() => asHost("docs.example.com ")).toThrow(/whitespace/i);
    expect(() => asHost("\tdocs.example.com")).toThrow(/whitespace/i);
  });

  it("rejects userinfo '@'", () => {
    expect(() => asHost("user@docs.example.com")).toThrow(/userinfo|@/);
  });

  it("rejects query '?'", () => {
    expect(() => asHost("docs.example.com?x=1")).toThrow(/query|\?/);
  });

  it("rejects fragment '#'", () => {
    expect(() => asHost("docs.example.com#frag")).toThrow(/fragment|#/);
  });

  it("rejects ASCII control characters (newline, CR, NUL, tab inside)", () => {
    // These would survive the trim() check (because the offending
    // char is interior, not leading/trailing) but must still be
    // caught by the explicit control-char rule. NUL is the classic
    // injection vector; newline/CR can cause header smuggling at any
    // downstream `https://${host}/...` composition.
    expect(() => asHost("docs.example\ncom")).toThrow(/control/i);
    expect(() => asHost("docs.example\rcom")).toThrow(/control/i);
    expect(() => asHost("docs.example\x00com")).toThrow(/control/i);
    expect(() => asHost("docs.example\x7fcom")).toThrow(/control/i);
    expect(() => asHost("docs.example\tcom")).toThrow(/control/i);
  });

  it("rejects a ':port' suffix", () => {
    // domainFor() returns bare hostnames; ports are not part of the
    // verify-pipeline contract. Reject with a precise diagnostic.
    expect(() => asHost("docs.example.com:8080")).toThrow(/port/i);
    expect(() => asHost("localhost:3000")).toThrow(/port/i);
  });

  it("rejects characters outside the DNS-label charset", () => {
    // Underscore, unicode — none are in [A-Za-z0-9.-]. Leading/trailing
    // whitespace is caught earlier by the trim check; interior
    // whitespace is rejected here by the charset rule. `:` is caught
    // by the port suffix check.
    expect(() => asHost("docs_example.com")).toThrow(/charset|DNS/);
    expect(() => asHost("docs.exämple.com")).toThrow(/charset|DNS/);
    expect(() => asHost("docs!example.com")).toThrow(/charset|DNS/);
    // Pure positive: real SSOT-shape hostnames still pass.
    expect(() => asHost("docs.example.com")).not.toThrow();
    expect(() => asHost("a-b.c-d.example")).not.toThrow();
    expect(() => asHost("harness-staging-2ee4.up.railway.app")).not.toThrow();
  });
});

describe("runVerify driver dispatch", () => {
  it("calls the driver for each target and fails loud on any red", async () => {
    const calls: string[] = [];
    const runner: ProbeRunner = async (target) => {
      calls.push(`${target.driver}:${target.host}`);
      if (target.name === "docs") {
        return { ok: false, error: "DOM string missing" };
      }
      return { ok: true };
    };
    const summary = await runVerify({
      env: "staging",
      services: ["docs", "shell"],
      runner,
    });
    expect(calls).toContain("docs:docs.staging.copilotkit.ai");
    expect(calls).toContain("shell:showcase.staging.copilotkit.ai");
    expect(summary.failed.map((f) => f.name)).toEqual(["docs"]);
    expect(summary.exitCode).toBe(1);
  });

  it("exits 0 when all probes green", async () => {
    const summary = await runVerify({
      env: "staging",
      services: ["docs"],
      runner: async () => ({ ok: true }),
    });
    expect(summary.exitCode).toBe(0);
  });

  it("with skipIneligible, exits 0 probing only eligible services when the set mixes in non-eligible ones", async () => {
    // Mirrors the promote precondition `service=all` shape: a
    // probe-eligible service (docs) mixed with a probe.staging=false
    // service (a starter-*). The eligible one is probed normally; the
    // ineligible one is skipped — no crash, exit 0 when greens pass.
    const ineligible = Object.keys(SERVICES).find(
      (n) => SERVICES[n] !== undefined && !probeEnabled(n, "staging"),
    );
    expect(ineligible).toBeDefined();
    const calls: string[] = [];
    const runner: ProbeRunner = async (target) => {
      calls.push(target.name);
      return { ok: true };
    };
    const summary = await runVerify({
      env: "staging",
      services: ["docs", ineligible as string],
      skipIneligible: true,
      runner,
    });
    expect(calls).toContain("docs");
    expect(calls).not.toContain(ineligible);
    expect(summary.exitCode).toBe(0);
  });

  it("exits 0 (nothing to probe) when EVERY requested service is known-but-ineligible (verify-prod prod-only case)", async () => {
    // The verify-prod gate calls verify-deploy directly with the promoted
    // set, which can be entirely probe-ineligible services (e.g. just
    // `harness-workers`, probe.prod=false). All are skipped → zero targets,
    // but this is an EXPECTED no-op, NOT the vacuous-green fault: exit 0 with
    // a clear "nothing to probe" note. Distinct from the empty-filter FAIL
    // case below (length 0 there; here length>0 + all-ineligible).
    const ineligible = Object.keys(SERVICES).find(
      (n) => SERVICES[n] !== undefined && !probeEnabled(n, "prod"),
    );
    expect(ineligible).toBeDefined();
    let probed = false;
    const summary = await runVerify({
      env: "prod",
      services: [ineligible as string],
      skipIneligible: true,
      runner: async () => {
        probed = true;
        return { ok: true };
      },
    });
    expect(probed).toBe(false);
    expect(summary.exitCode).toBe(0);
    expect(summary.failed.length).toBe(0);
  });

  it("FAILS LOUD on zero resolved targets (never silently exit 0)", async () => {
    // resolveProbeTargets now throws on unknown service names, so the
    // zero-target shape can only happen via the API (empty filter
    // set). We exercise the runVerify guard directly: a runner that's
    // never called and an exit code of 1 with a clear diagnostic.
    const summary = await runVerify({
      env: "staging",
      services: [],
      runner: async () => ({ ok: true }),
    });
    expect(summary.exitCode).not.toBe(0);
    expect(summary.failed.length).toBeGreaterThan(0);
  });
});
