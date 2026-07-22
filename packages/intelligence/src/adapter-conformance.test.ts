import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const corpusPath = fileURLToPath(
  new URL("../conformance/registry-adapters-v1.json", import.meta.url),
);

const requiredCaseNames = [
  "cold-fresh-load",
  "explicit-cached-preload",
  "throttle-hit",
  "concurrent-singleflight",
  "etag-unchanged",
  "changed-revision",
  "empty",
  "revoked",
  "transient-stale",
  "integrity-stale",
  "denial",
  "too-many-skills",
  "skill-md-too-large",
  "aggregate-too-large",
  "invalid-utf8",
  "script-disabled",
  "close-idempotent",
  "readiness-ready",
  "readiness-timeout",
  "readiness-denied-rejects",
  "readiness-stale-rejects",
  "readiness-closed-rejects",
  "retry-after-failed-throttle-window",
  "load-after-close-rejects",
  "telemetry-sink-failure-singleflight",
  "error-category-auth-denied",
  "error-category-permission-denied",
  "http-401-denied",
  "http-403-denied",
  "http-404-denied",
  "http-410-denied",
  "container-archived-denied",
  "project-mismatch-denied",
  "container-not-found-denied",
  "registry-unrecoverable-denied",
] as const;

const permanentDenialSources = [
  "error-category-auth",
  "error-category-permission",
  "http-401",
  "http-403",
  "http-404",
  "http-410",
  "container-archived",
  "project-mismatch",
  "container-not-found",
  "registry-unrecoverable",
] as const;

interface AdapterCorpus {
  schemaVersion: number;
  contractVersion: string;
  cases: Array<{
    name: string;
    permanentDenialSource?: string;
  }>;
}

function readCorpus(): AdapterCorpus {
  return JSON.parse(readFileSync(corpusPath, "utf8")) as AdapterCorpus;
}

describe("adapter conformance corpus", () => {
  test("contains exactly the required 35 cases", () => {
    const corpus = readCorpus();
    const names = corpus.cases.map(({ name }) => name);

    expect(corpus.schemaVersion).toBe(1);
    expect(corpus.contractVersion).toBe("registry-adapters-v1");
    expect(names).toHaveLength(35);
    expect(new Set(names).size).toBe(35);
    expect(names).toEqual(requiredCaseNames);
  });

  test("classifies every permanent denial source exactly once", () => {
    const denialSources = readCorpus().cases.flatMap((entry) =>
      entry.permanentDenialSource === undefined
        ? []
        : [entry.permanentDenialSource],
    );

    expect(denialSources).toEqual(permanentDenialSources);
    expect(new Set(denialSources).size).toBe(permanentDenialSources.length);
  });
});
