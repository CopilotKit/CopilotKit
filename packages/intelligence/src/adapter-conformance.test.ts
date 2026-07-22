import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { validateAdapterCorpus } from "../scripts/verify-adapter-corpus.js";

const corpusPath = fileURLToPath(
  new URL("../conformance/registry-adapters-v1.json", import.meta.url),
);
const sdkCorpusPath = fileURLToPath(
  new URL("../conformance/registry-sdk-v1.json", import.meta.url),
);
const packageJsonPath = fileURLToPath(
  new URL("../package.json", import.meta.url),
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

type JsonObject = Record<string, unknown>;

function readCorpus(): AdapterCorpus {
  return JSON.parse(readFileSync(corpusPath, "utf8")) as AdapterCorpus;
}

function readJsonObject(path: string): JsonObject {
  return JSON.parse(readFileSync(path, "utf8")) as JsonObject;
}

function asObject(value: unknown): JsonObject {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new TypeError("mutation fixture expected an object");
  }
  return value as JsonObject;
}

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value))
    throw new TypeError("mutation fixture expected an array");
  return value;
}

function caseNamed(corpus: JsonObject, name: string): JsonObject {
  const entry = asArray(corpus.cases)
    .map(asObject)
    .find((candidate) => candidate.name === name);
  if (entry === undefined) throw new Error(`missing mutation fixture ${name}`);
  return entry;
}

function expectedFor(corpus: JsonObject, name: string): JsonObject {
  return asObject(caseNamed(corpus, name).expected);
}

function telemetryNames(corpus: JsonObject, name: string): unknown[] {
  return asArray(expectedFor(corpus, name).telemetryNames);
}

interface MutationFixture {
  name: string;
  failure: string;
  mutate(corpus: JsonObject): void;
}

const mutationFixtures: MutationFixture[] = [
  {
    name: "initial snapshot is missing",
    failure: "initialSnapshot",
    mutate(corpus) {
      delete caseNamed(corpus, "cold-fresh-load").initialSnapshot;
    },
  },
  {
    name: "initial snapshot disagrees with first transition",
    failure: "initialSnapshot status",
    mutate(corpus) {
      asObject(caseNamed(corpus, "cold-fresh-load").initialSnapshot).status =
        "ready";
    },
  },
  {
    name: "observable adapter get count drifts",
    failure: "adapter get call count",
    mutate(corpus) {
      asObject(
        asObject(expectedFor(corpus, "cold-fresh-load").calls).client,
      ).get = 2;
    },
  },
  {
    name: "observable adapter getCached count drifts",
    failure: "adapter getCached call count",
    mutate(corpus) {
      asObject(
        asObject(expectedFor(corpus, "explicit-cached-preload").calls).client,
      ).getCached = 0;
    },
  },
  {
    name: "operation kind is not executable",
    failure: "operation kind",
    mutate(corpus) {
      asObject(
        asArray(caseNamed(corpus, "cold-fresh-load").operations)[1],
      ).kind = "invented-operation";
    },
  },
  {
    name: "terminal transition precedes its operation",
    failure: "transition timestamp",
    mutate(corpus) {
      asObject(
        asArray(expectedFor(corpus, "integrity-stale").statusTransitions).at(
          -1,
        ),
      ).atMs = 2;
    },
  },
  {
    name: "throttle hit fabricates a refresh transition",
    failure: "throttle-hit",
    mutate(corpus) {
      expectedFor(corpus, "throttle-hit").statusTransitions = [
        { atMs: 0, from: "ready", to: "refreshing" },
        { atMs: 1, from: "refreshing", to: "ready" },
      ];
    },
  },
  {
    name: "readiness-only operation fabricates load telemetry",
    failure: "readiness telemetry",
    mutate(corpus) {
      const expected = expectedFor(corpus, "readiness-ready");
      expected.telemetryNames = ["load.succeeded"];
      expected.telemetryRecords = [
        {
          name: "load.succeeded",
          atMs: 0,
          metadata: {
            framework: "fixture",
            outcome: "success",
            freshness: "fresh",
            skillCount: 1,
            registryRevision: "revision-1",
          },
        },
      ];
    },
  },
  {
    name: "post-close load fabricates telemetry",
    failure: "post-close telemetry",
    mutate(corpus) {
      const expected = expectedFor(corpus, "load-after-close-rejects");
      asArray(expected.telemetryNames).push("load.failed");
      asArray(expected.telemetryRecords).push({
        name: "load.failed",
        atMs: 1,
        metadata: {
          framework: "fixture",
          outcome: "failure",
          reason: "closed",
          retryable: false,
          errorCode: "LEARNING_REGISTRY_CLOSED",
          errorCategory: "lifecycle",
        },
      });
    },
  },
  {
    name: "refresh telemetry reports a cold load source",
    failure: "refresh source",
    mutate(corpus) {
      const started = asObject(
        asArray(expectedFor(corpus, "etag-unchanged").telemetryRecords)[0],
      );
      asObject(started.metadata).source = "load";
    },
  },
  {
    name: "retry omits stale status telemetry",
    failure: "retry stale transition telemetry",
    mutate(corpus) {
      const expected = expectedFor(
        corpus,
        "retry-after-failed-throttle-window",
      );
      asArray(expected.telemetryNames).splice(1, 1);
      asArray(expected.telemetryRecords).splice(1, 1);
    },
  },
  {
    name: "adapter-local failure invents tracing IDs",
    failure: "telemetry IDs must match canonical error",
    mutate(corpus) {
      const failed = asObject(
        asArray(expectedFor(corpus, "too-many-skills").telemetryRecords).at(-1),
      );
      Object.assign(asObject(failed.metadata), {
        requestId: "invented-request",
        traceId: "invented-trace",
      });
    },
  },
  {
    name: "revoked blocks native routing",
    failure: "revoked must remain authorized-empty",
    mutate(corpus) {
      asObject(expectedFor(corpus, "revoked").nativeHook).proceed = false;
    },
  },
  {
    name: "script-disabled uses a generic code",
    failure: "script-disabled error code",
    mutate(corpus) {
      asObject(
        asObject(expectedFor(corpus, "script-disabled").genericSdk).error,
      ).code = "LEARNING_REGISTRY_SCRIPT_DISABLED";
    },
  },
  {
    name: "script-disabled continues to rendering",
    failure: "reject-script",
    mutate(corpus) {
      const entry = caseNamed(corpus, "script-disabled");
      asObject(asArray(entry.operations).at(-1)).kind = "render";
    },
  },
  {
    name: "transition uses a non-lifecycle state",
    failure: "lifecycle state",
    mutate(corpus) {
      asObject(
        asArray(expectedFor(corpus, "cold-fresh-load").statusTransitions)[0],
      ).from = "idle";
    },
  },
  {
    name: "rendered identity drifts",
    failure: "rendered identity",
    mutate(corpus) {
      asObject(
        asArray(expectedFor(corpus, "cold-fresh-load").renderedRecords)[0],
      ).skillId = "wrong";
    },
  },
  {
    name: "cached preload makes a network call",
    failure: "explicit-cached-preload",
    mutate(corpus) {
      asObject(
        asObject(expectedFor(corpus, "explicit-cached-preload").calls).client,
      ).network = 1;
    },
  },
  {
    name: "telemetry leaks an identifier",
    failure: "telemetry metadata field",
    mutate(corpus) {
      asObject(
        asArray(expectedFor(corpus, "cold-fresh-load").telemetryRecords)[0],
      ).metadata = { projectId: "secret" };
    },
  },
  {
    name: "telemetry uses an unbounded metadata value",
    failure: "telemetry metadata value",
    mutate(corpus) {
      asObject(
        asObject(
          asArray(expectedFor(corpus, "cold-fresh-load").telemetryRecords)[0],
        ).metadata,
      ).source = "arbitrary-runtime-value";
    },
  },
  {
    name: "stale load reports a succeeded outcome",
    failure: "stale load must emit load.failed",
    mutate(corpus) {
      const expected = expectedFor(corpus, "transient-stale");
      const record = asObject(asArray(expected.telemetryRecords).at(-1));
      record.name = "load.succeeded";
      asObject(record.metadata).outcome = "success";
      const names = asArray(expected.telemetryNames);
      names[names.length - 1] = "load.succeeded";
    },
  },
  {
    name: "failed load omits required error metadata",
    failure: "load.failed requires",
    mutate(corpus) {
      const record = asObject(
        asArray(expectedFor(corpus, "integrity-stale").telemetryRecords).at(-1),
      );
      delete asObject(record.metadata).errorCategory;
    },
  },
  {
    name: "singleflight callers receive different rejections",
    failure: "sink exception identity",
    mutate(corpus) {
      const singleflight = asObject(
        expectedFor(corpus, "telemetry-sink-failure-singleflight").singleflight,
      );
      asObject(asArray(singleflight.callers)[0]).rejectionIdentity =
        "different";
    },
  },
  {
    name: "retry moves beyond the boundary",
    failure: "exact 30000ms boundary",
    mutate(corpus) {
      asObject(
        asArray(
          caseNamed(corpus, "retry-after-failed-throttle-window").operations,
        )[2],
      ).atMs = 30001;
    },
  },
  {
    name: "client count disagrees with operations",
    failure: "projection call count",
    mutate(corpus) {
      asObject(
        asObject(expectedFor(corpus, "cold-fresh-load").calls).client,
      ).projection = 2;
    },
  },
  {
    name: "telemetry uses a non-canonical name",
    failure: "canonical telemetry",
    mutate(corpus) {
      asArray(expectedFor(corpus, "cold-fresh-load").telemetryNames)[0] =
        "adapter.load.started";
    },
  },
  {
    name: "transition omits the terminal status",
    failure: "terminal status",
    mutate(corpus) {
      asArray(expectedFor(corpus, "cold-fresh-load").statusTransitions).pop();
    },
  },
  {
    name: "readiness reports a non-lifecycle state",
    failure: "lifecycle state",
    mutate(corpus) {
      asObject(
        asObject(expectedFor(corpus, "readiness-ready").readiness).result,
      ).state = "idle";
    },
  },
  {
    name: "generic SDK result is null",
    failure: "genericSdk.result must be an object",
    mutate(corpus) {
      asObject(expectedFor(corpus, "cold-fresh-load").genericSdk).result = null;
    },
  },
  {
    name: "generic SDK result is a scalar",
    failure: "genericSdk.result must be an object",
    mutate(corpus) {
      asObject(expectedFor(corpus, "cold-fresh-load").genericSdk).result =
        "not-an-object";
    },
  },
  {
    name: "nested field contains a secret",
    failure: "secret-bearing field",
    mutate(corpus) {
      asObject(corpus.distribution).nested = {
        apiToken: "definitely-secret",
      };
    },
  },
  {
    name: "nested package version is added",
    failure: "version field",
    mutate(corpus) {
      asObject(corpus.distribution).release = { version: "1.2.3" };
    },
  },
  {
    name: "dependency version is added",
    failure: "dependencyVersion",
    mutate(corpus) {
      asObject(corpus.distribution).dependencyVersion = "1.2.3";
    },
  },
  {
    name: "release version is added",
    failure: "releaseVersion",
    mutate(corpus) {
      asObject(corpus.distribution).releaseVersion = "1.2.3";
    },
  },
];

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

  test("passes the unmodified fail-closed verifier", () => {
    expect(
      validateAdapterCorpus(
        readJsonObject(corpusPath),
        readJsonObject(sdkCorpusPath),
        readJsonObject(packageJsonPath),
      ),
    ).toEqual([]);
  });

  test("declares an executable adapter-observable contract", () => {
    const corpus = readJsonObject(corpusPath);
    const cases = asArray(corpus.cases).map(asObject);

    expect(cases).toHaveLength(35);
    for (const case_ of cases) {
      expect(case_.initialSnapshot).toEqual(expect.any(Object));
      const client = asObject(asObject(asObject(case_.expected).calls).client);
      expect(client.get).toEqual(expect.any(Number));
      expect(client.getCached).toEqual(expect.any(Number));
    }

    expect(asArray(caseNamed(corpus, "throttle-hit").operations)).toEqual([
      { atMs: 0, kind: "load" },
      { atMs: 1, kind: "throttle-hit" },
    ]);
    expect(
      asArray(expectedFor(corpus, "throttle-hit").statusTransitions),
    ).toEqual([]);
    expect(telemetryNames(corpus, "throttle-hit")).toEqual(["load.throttled"]);

    for (const name of [
      "etag-unchanged",
      "changed-revision",
      "transient-stale",
      "integrity-stale",
    ]) {
      const first = asObject(
        asArray(expectedFor(corpus, name).telemetryRecords)[0],
      );
      expect(asObject(first.metadata).source).toBe("refresh");
    }

    for (const name of [
      "readiness-ready",
      "readiness-timeout",
      "readiness-denied-rejects",
      "readiness-stale-rejects",
    ]) {
      expect(telemetryNames(corpus, name)).toEqual([]);
      expect(asArray(expectedFor(corpus, name).telemetryRecords)).toEqual([]);
    }
    expect(telemetryNames(corpus, "readiness-closed-rejects")).toEqual([
      "status.changed",
    ]);
    expect(telemetryNames(corpus, "load-after-close-rejects")).toEqual([
      "status.changed",
    ]);

    expect(
      telemetryNames(corpus, "retry-after-failed-throttle-window"),
    ).toEqual([
      "load.started",
      "status.changed",
      "load.failed",
      "load.throttled",
      "load.started",
      "status.changed",
      "load.succeeded",
    ]);

    for (const name of [
      "too-many-skills",
      "skill-md-too-large",
      "aggregate-too-large",
      "invalid-utf8",
      "script-disabled",
      "telemetry-sink-failure-singleflight",
    ]) {
      const failed = asObject(
        asArray(expectedFor(corpus, name).telemetryRecords).at(-1),
      );
      expect(asObject(failed.metadata)).not.toHaveProperty("requestId");
      expect(asObject(failed.metadata)).not.toHaveProperty("traceId");
    }
  });

  test.each(mutationFixtures)(
    "rejects mutation: $name",
    ({ mutate, failure }) => {
      const corpus = structuredClone(readJsonObject(corpusPath));
      mutate(corpus);

      expect(
        validateAdapterCorpus(
          corpus,
          readJsonObject(sdkCorpusPath),
          readJsonObject(packageJsonPath),
        ),
      ).toEqual(expect.arrayContaining([expect.stringContaining(failure)]));
    },
  );
});
