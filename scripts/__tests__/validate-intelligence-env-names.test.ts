import { describe, expect, it } from "vitest";
import {
  findViolations,
  managedUrlEnvFileAssignment,
  managedUrlFallback,
} from "../validate-intelligence-env-names.js";

/**
 * `CopilotKitIntelligence` resolves `apiUrl`/`wsUrl` to the managed hosts when
 * they are omitted, so supplying any fallback for the two env vars that feed
 * them overrides that default. A starter that does it points a managed user at
 * whatever the fallback names — in practice a local stack that is not running
 * (OSS-981).
 *
 * The rule is the pattern, not the literal: a staging host substituted for
 * localhost would be just as wrong, so the check flags the fallback itself.
 */
describe("managedUrlFallback", () => {
  it("flags a nullish fallback on the API URL", () => {
    expect(
      managedUrlFallback(
        '          apiUrl: process.env.INTELLIGENCE_API_URL ?? "http://localhost:4201",',
      ),
    ).toBe("INTELLIGENCE_API_URL");
  });

  it("flags a nullish fallback on the gateway websocket URL", () => {
    expect(
      managedUrlFallback(
        '            process.env.INTELLIGENCE_GATEWAY_WS_URL ?? "ws://localhost:4401",',
      ),
    ).toBe("INTELLIGENCE_GATEWAY_WS_URL");
  });

  it("flags a logical-or fallback, which fails the same way", () => {
    expect(
      managedUrlFallback(
        '  const apiUrl = process.env.INTELLIGENCE_API_URL || "https://staging.example.com";',
      ),
    ).toBe("INTELLIGENCE_API_URL");
  });

  it("allows the conditional spread, which leaves the managed default in place", () => {
    expect(
      managedUrlFallback("    ...(process.env.INTELLIGENCE_API_URL"),
    ).toBeNull();
    expect(
      managedUrlFallback(
        "      ? { apiUrl: process.env.INTELLIGENCE_API_URL }",
      ),
    ).toBeNull();
  });

  it("allows a bare read with no default", () => {
    expect(
      managedUrlFallback("  apiUrl: process.env.INTELLIGENCE_API_URL,"),
    ).toBeNull();
  });

  it("allows an env file assignment, which is a value and not a code default", () => {
    expect(
      managedUrlFallback("# INTELLIGENCE_API_URL=http://localhost:4201"),
    ).toBeNull();
    expect(
      managedUrlFallback("INTELLIGENCE_API_URL=http://localhost:4203"),
    ).toBeNull();
  });

  it("ignores an unrelated variable that merely takes a fallback", () => {
    expect(
      managedUrlFallback(
        '  url: process.env.AGENT_URL ?? "http://localhost:8000/",',
      ),
    ).toBeNull();
  });
});

/**
 * The same failure by a second route. An `.env.example` is copied to `.env`, so
 * an uncommented managed URL there hands the reader the local value the code no
 * longer defaults to. Three starters did it, two of them directly under a
 * comment telling the reader to leave the variable unset (OSS-981).
 */
describe("managedUrlEnvFileAssignment", () => {
  it("flags an uncommented assignment with a value", () => {
    expect(
      managedUrlEnvFileAssignment("INTELLIGENCE_API_URL=http://localhost:4203"),
    ).toBe("INTELLIGENCE_API_URL");
    expect(
      managedUrlEnvFileAssignment(
        "INTELLIGENCE_GATEWAY_WS_URL=ws://localhost:4403",
      ),
    ).toBe("INTELLIGENCE_GATEWAY_WS_URL");
  });

  it("allows a commented assignment, which sets nothing", () => {
    expect(
      managedUrlEnvFileAssignment(
        "# INTELLIGENCE_API_URL=http://localhost:4201",
      ),
    ).toBeNull();
  });

  it("allows an empty assignment, which is the documented managed setting", () => {
    expect(managedUrlEnvFileAssignment("INTELLIGENCE_API_URL=")).toBeNull();
  });

  it("ignores a different Intelligence variable", () => {
    expect(
      managedUrlEnvFileAssignment("CPK_INTELLIGENCE_API_KEY=cpk_example"),
    ).toBeNull();
  });
});

describe("the repository", () => {
  it("uses one Intelligence project key name", () => {
    const oldName = ["INTELLIGENCE", "API", "KEY"].join("_");
    const offenders = findViolations().filter(
      (violation) => violation.name === oldName,
    );

    expect(
      offenders.map((violation) => `${violation.file}:${violation.line}`),
    ).toEqual([]);
  }, 60_000);

  // A repo-wide scan: several `git grep` passes over the whole tree.
  it("never overrides the managed Intelligence URL defaults", () => {
    const offenders = findViolations().filter(
      (violation) => violation.reason === MANAGED_URL_FALLBACK_REASON,
    );

    expect(
      offenders.map((violation) => `${violation.file}:${violation.line}`),
    ).toEqual([]);
  }, 60_000);

  it("never ships an env example that sets a managed Intelligence URL", () => {
    const offenders = findViolations().filter(
      (violation) => violation.reason === MANAGED_URL_ENV_FILE_REASON,
    );

    expect(
      offenders.map((violation) => `${violation.file}:${violation.line}`),
    ).toEqual([]);
  }, 60_000);
});

/** Kept in step with the reason string the validator reports. */
const MANAGED_URL_FALLBACK_REASON =
  "overrides the managed Intelligence default; omit the fallback";

/** Kept in step with the reason string the validator reports. */
const MANAGED_URL_ENV_FILE_REASON =
  "env example sets a managed Intelligence URL; comment it out";
