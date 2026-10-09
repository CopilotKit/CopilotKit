import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyRailwayInventory,
  parseRailwayLifecyclePolicy,
  parseRunRecordsSnapshot,
} from "../harness/src/shared/railway-lifecycle";
import type {
  RunRecord,
  RailwayLifecyclePolicy,
  LifecycleEvidence,
} from "../harness/src/shared/railway-lifecycle";
import { readRailwayLifecycleEvidence } from "../harness/src/shared/railway-lifecycle-records";

const PIN = `ghcr.io/copilotkit/intelligence/app-api@sha256:${"a".repeat(64)}`;
const OTHER_PIN = `docker.io/library/postgres@sha256:${"b".repeat(64)}`;
const NOW = new Date("2026-10-08T12:20:00.000Z");
const policy: RailwayLifecyclePolicy = {
  projectId: "project",
  forbiddenEnvironmentIds: ["prod"],
  permanentServices: [{ name: "permanent", serviceId: "permanent-id" }],
  approvedImages: [PIN, OTHER_PIN],
};
function record(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: "run",
    projectId: "project",
    environmentId: "disposable-env",
    startedAt: "2026-10-08T12:00:00.000Z",
    expiresAt: "2026-10-08T13:00:00.000Z",
    phase: "ready",
    services: [{ name: "app-api", serviceId: "service", expectedImage: PIN }],
    resources: [{ kind: "environment", id: "disposable-env" }],
    ...overrides,
  };
}
function evidence(run = record()): LifecycleEvidence {
  return { status: "valid", snapshot: { schemaVersion: 1, runs: [run] } };
}
function observed(overrides = {}) {
  return {
    name: "app-api",
    serviceId: "service",
    environmentId: "disposable-env",
    image: PIN,
    ...overrides,
  };
}
function classify(overrides = {}) {
  return classifyRailwayInventory({
    policy,
    evidence: evidence(),
    now: NOW,
    projectId: "project",
    observedEnvironmentIds: ["disposable-env"],
    services: [observed()],
    ...overrides,
  });
}
function parse(run = record()) {
  return parseRunRecordsSnapshot(
    { schemaVersion: 1, runs: [run] },
    policy,
    NOW,
  );
}

describe("read-only lifecycle classification", () => {
  it("recognizes only exact recorded scope and independently approved image", () => {
    const result = classify();
    expect(result.services[0].classification).toBe("owned-disposable");
    expect(result.failures).toEqual([]);
    expect(result.excludedServices).toEqual([
      {
        projectId: "project",
        environmentId: "disposable-env",
        serviceId: "service",
      },
    ]);
    expect(result.excludedEnvironments).toEqual([
      { projectId: "project", environmentId: "disposable-env" },
    ]);
  });
  it.each(["setup", "teardown", "complete"] as const)(
    "allows absent %s services",
    (phase) => {
      expect(
        classify({ evidence: evidence(record({ phase })), services: [] })
          .failures,
      ).toEqual([]);
    },
  );
  it("allows partial setup with no recorded services", () => {
    expect(
      classify({
        evidence: evidence(record({ phase: "setup", services: [] })),
        services: [],
      }).failures,
    ).toEqual([]);
  });
  it("reports a missing ready service only in completely observed environments", () => {
    expect(classify({ services: [] }).failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "ready-service-missing",
          runId: "run",
        }),
      ]),
    );
    expect(
      classify({ services: [], observedEnvironmentIds: ["staging"] }).failures,
    ).toEqual([]);
  });
  it.each(["interrupted", "complete"] as const)(
    "retains owned exclusion for %s leftovers",
    (phase) => {
      const result = classify({ evidence: evidence(record({ phase })) });
      expect(result.services[0].classification).toBe("owned-disposable");
      expect(result.failures).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "leftover-service" }),
        ]),
      );
      expect(result.excludedServices).toHaveLength(1);
    },
  );
  it("reports expired setup leftovers without releasing ownership", () => {
    const result = classify({
      evidence: evidence(record({ phase: "setup" })),
      now: new Date("2026-10-08T13:00:00.000Z"),
    });
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "leftover-service" }),
      ]),
    );
    expect(result.excludedServices).toHaveLength(1);
  });
  it.each(["setup", "ready", "teardown"] as const)(
    "requires exact expected image during %s",
    (phase) => {
      const result = classify({
        evidence: evidence(record({ phase })),
        services: [observed({ image: OTHER_PIN })],
      });
      expect(result.failures).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "image-mismatch" }),
        ]),
      );
      expect(result.services[0].classification).toBe("owned-disposable");
      expect(result.excludedServices).toHaveLength(1);
    },
  );
  it("rejects a missing image without releasing ownership", () => {
    expect(
      classify({ services: [observed({ image: null })] }).failures,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "image-mismatch" }),
      ]),
    );
  });
  it("does not exempt an additional environment instance", () => {
    const result = classify({
      services: [observed(), observed({ environmentId: "staging" })],
    });
    expect(result.services.map((service) => service.classification)).toEqual([
      "owned-disposable",
      "unknown",
    ]);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unknown-service",
          environmentId: "staging",
        }),
      ]),
    );
  });
  it("does not exempt a foreign project observation", () => {
    const result = classify({ projectId: "foreign" });
    expect(result.services[0].classification).toBe("unknown");
    expect(result.excludedServices).toEqual([]);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "project-mismatch" }),
      ]),
    );
  });
  it("checks the observed name before granting an exclusion", () => {
    const result = classify({ services: [observed({ name: "renamed" })] });
    expect(result.services[0].classification).toBe("unknown");
    expect(result.excludedServices).toEqual([]);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "unknown-service" }),
        expect.objectContaining({ code: "ready-service-missing" }),
      ]),
    );
  });
  it("reports ready absence without excluding an unobserved identity", () => {
    const result = classify({ services: [] });
    expect(result.excludedServices).toEqual([]);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "ready-service-missing" }),
      ]),
    );
  });
  it.each([{ services: [] }, { services: record().services }])(
    "reports setup timeout even when no services remain: %j",
    ({ services }) => {
      const result = classify({
        evidence: evidence(record({ phase: "setup", services, resources: [] })),
        now: new Date("2026-10-08T13:00:00.000Z"),
        services: [],
      });
      expect(result.failures).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "setup-expired", runId: "run" }),
        ]),
      );
      expect(result.excludedServices).toEqual([]);
    },
  );
  it("preserves permanent classification without evidence", () => {
    const result = classify({
      evidence: { status: "unavailable" },
      services: [observed({ name: "permanent", serviceId: "permanent-id" })],
    });
    expect(result.services[0].classification).toBe("permanent");
    expect(result.failures).toEqual([]);
  });
  it("never infers ownership from a name or digest", () => {
    const result = classify({ evidence: { status: "unavailable" } });
    expect(result.services[0].classification).toBe("unknown");
    expect(result.excludedServices).toEqual([]);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "unknown-service" }),
      ]),
    );
  });
  it("makes invalid evidence visible and grants no exclusions", () => {
    const result = classify({
      evidence: {
        status: "invalid",
        issues: [{ code: "records-unreadable", message: "unreadable" }],
      },
    });
    expect(result.excludedServices).toEqual([]);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "records-unreadable" }),
      ]),
    );
  });
  it("does not claim non-service resources disappeared from service-only inventory", () => {
    const result = classify({
      evidence: evidence(record({ phase: "complete" })),
      services: [],
    });
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "non-service-presence-unverified" }),
      ]),
    );
  });
});

describe("strict snapshot and policy validation", () => {
  it("accepts explicit empty snapshots", () => {
    expect(
      parseRunRecordsSnapshot({ schemaVersion: 1, runs: [] }, policy, NOW),
    ).toEqual({ ok: true, value: { schemaVersion: 1, runs: [] } });
  });
  it("accepts approved nested GHCR and external dependency pins", () => {
    expect(parse().ok).toBe(true);
    expect(
      parse(
        record({
          services: [
            { name: "postgres", serviceId: "db", expectedImage: OTHER_PIN },
          ],
        }),
      ).ok,
    ).toBe(true);
  });
  it.each([
    "ghcr.io/fixture__images/nested/app",
    "ghcr.io/fixture--images/nested/app",
    "registry.example:5000/team/image__server",
    "registry.example/team/image---server",
  ])(
    "classifies an approved immutable repository with Docker separators: %s",
    (repository) => {
      const image = `${repository}@sha256:${"a".repeat(64)}`;
      const approvedPolicy = { ...policy, approvedImages: [image] };
      expect(parseRailwayLifecyclePolicy(approvedPolicy)).toEqual({
        ok: true,
        value: approvedPolicy,
      });
      const snapshot = {
        schemaVersion: 1,
        runs: [
          record({
            services: [
              { name: "app-api", serviceId: "service", expectedImage: image },
            ],
          }),
        ],
      };
      expect(parseRunRecordsSnapshot(snapshot, approvedPolicy, NOW)).toEqual({
        ok: true,
        value: snapshot,
      });
      const result = classify({
        policy: approvedPolicy,
        evidence: { status: "valid", snapshot },
        services: [observed({ image })],
      });
      expect(result.failures).toEqual([]);
      expect(result.services[0].classification).toBe("owned-disposable");
      expect(result.excludedServices).toEqual([
        {
          projectId: "project",
          environmentId: "disposable-env",
          serviceId: "service",
        },
      ]);
    },
  );
  it.each([
    `registry.example/team/image___server@sha256:${"a".repeat(64)}`,
    `registry.example/team/-image@sha256:${"a".repeat(64)}`,
    `registry.example/team/image-@sha256:${"a".repeat(64)}`,
    `registry.example/_team/image@sha256:${"a".repeat(64)}`,
    `registry.example/team_/image@sha256:${"a".repeat(64)}`,
    `registry.example/team/image._server@sha256:${"a".repeat(64)}`,
    "registry.example/team/image--server:latest",
    "registry.example/team/image__server:1.0.0",
    `registry.example/team/image--server@sha256:${"a".repeat(63)}`,
    `registry.example/team/image__server@sha256:${"a".repeat(65)}`,
    `registry.example/team/image--server@sha256:${"A".repeat(64)}`,
    `image--server@sha256:${"a".repeat(64)}`,
  ])("rejects a malformed or mutable approved image: %s", (image) => {
    expect(
      parseRailwayLifecyclePolicy({ ...policy, approvedImages: [image] }),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "invalid-approved-image" }],
    });
  });
  it("does not grant ownership for an unapproved pin with valid Docker separators", () => {
    const image = `registry.example/team/image__server@sha256:${"a".repeat(64)}`;
    const run = record({
      services: [
        { name: "app-api", serviceId: "service", expectedImage: image },
      ],
    });
    expect(parse(run)).toMatchObject({
      ok: false,
      issues: [{ code: "unapproved-image" }],
    });
    const result = classify({
      evidence: evidence(run),
      services: [observed({ image })],
    });
    expect(result.excludedServices).toEqual([]);
    expect(result.failures).toContainEqual(
      expect.objectContaining({ code: "unapproved-image" }),
    );
  });
  it.each([
    ["missing service ID", { services: [{ name: "api", expectedImage: PIN }] }],
    ["blank ID", { environmentId: " " }],
    ["foreign project", { projectId: "foreign" }],
    ["production environment", { environmentId: "prod" }],
    ["malformed date", { startedAt: "2026-02-30T12:00:00.000Z" }],
    ["non UTC date", { startedAt: "2026-10-08T12:00:00+00:00" }],
    ["future start", { startedAt: "2026-10-08T12:30:00.000Z" }],
    ["over 60 minutes", { expiresAt: "2026-10-08T13:00:01.000Z" }],
    ["nonpositive duration", { expiresAt: "2026-10-08T12:00:00.000Z" }],
    ["unknown phase", { phase: "readi" }],
    [
      "permanent name collision",
      {
        services: [
          { name: "permanent", serviceId: "service", expectedImage: PIN },
        ],
      },
    ],
    [
      "permanent ID collision",
      {
        services: [
          { name: "api", serviceId: "permanent-id", expectedImage: PIN },
        ],
      },
    ],
    [
      "unapproved pin",
      {
        services: [
          {
            name: "api",
            serviceId: "service",
            expectedImage: `registry.io/app@sha256:${"c".repeat(64)}`,
          },
        ],
      },
    ],
    [
      "duplicate service ID",
      {
        services: [
          { name: "api", serviceId: "service", expectedImage: PIN },
          { name: "db", serviceId: "service", expectedImage: OTHER_PIN },
        ],
      },
    ],
    [
      "duplicate resource ID",
      {
        resources: [
          { kind: "volume", id: "volume" },
          { kind: "volume", id: "volume" },
        ],
      },
    ],
    ["unknown field", { credentials: "secret" }],
    [
      "unknown service field",
      {
        services: [
          {
            name: "api",
            serviceId: "service",
            expectedImage: PIN,
            gateIgnore: true,
          },
        ],
      },
    ],
    [
      "unknown resource field",
      { resources: [{ kind: "volume", id: "volume", owned: true }] },
    ],
  ])("rejects %s", (_name, overrides) => {
    expect(parse(record(overrides as Partial<RunRecord>)).ok).toBe(false);
  });
  it.each([
    { schemaVersion: 2, runs: [] },
    { schemaVersion: 1, runs: [], run: [] },
    { schemaVersion: 1 },
    null,
  ])("rejects malformed root %j", (input) => {
    expect(parseRunRecordsSnapshot(input, policy, NOW).ok).toBe(false);
  });
  it("rejects duplicate run IDs", () => {
    expect(
      parseRunRecordsSnapshot(
        { schemaVersion: 1, runs: [record(), record()] },
        policy,
        NOW,
      ).ok,
    ).toBe(false);
  });
  it("rejects repeated claims across terminal records", () => {
    expect(
      parseRunRecordsSnapshot(
        {
          schemaVersion: 1,
          runs: [
            record({ phase: "complete" }),
            record({ runId: "second", phase: "complete" }),
          ],
        },
        policy,
        NOW,
      ).ok,
    ).toBe(false);
  });
  it("rejects concurrent active runs even with disjoint resources", () => {
    expect(
      parseRunRecordsSnapshot(
        {
          schemaVersion: 1,
          runs: [
            record(),
            record({
              runId: "second",
              environmentId: "second-env",
              services: [],
              resources: [],
            }),
          ],
        },
        policy,
        NOW,
      ).ok,
    ).toBe(false);
  });
  it("allows expired and active runs with disjoint resources", () => {
    expect(
      parseRunRecordsSnapshot(
        {
          schemaVersion: 1,
          runs: [
            record({
              startedAt: "2026-10-08T10:00:00Z",
              expiresAt: "2026-10-08T11:00:00Z",
              services: [],
              resources: [],
              environmentId: "old-env",
              runId: "old",
            }),
            record(),
          ],
        },
        policy,
        NOW,
      ).ok,
    ).toBe(true);
  });
  it("rejects self-approved receipts under an empty approved policy", () => {
    expect(
      parseRunRecordsSnapshot(
        { schemaVersion: 1, runs: [record()] },
        { ...policy, approvedImages: [] },
        NOW,
      ).ok,
    ).toBe(false);
  });
  it.each([
    { approvedImages: ["ghcr.io/copilotkit/api:latest"] },
    { forbiddenEnvironmentIds: ["prod", "prod"] },
    {
      permanentServices: [
        { name: "a", serviceId: "same" },
        { name: "b", serviceId: "same" },
      ],
    },
    { typo: true },
  ])("rejects invalid policy %j", (overrides) => {
    expect(parseRailwayLifecyclePolicy({ ...policy, ...overrides }).ok).toBe(
      false,
    );
  });
  it("accepts an empty approved image list", () => {
    expect(
      parseRailwayLifecyclePolicy({ ...policy, approvedImages: [] }).ok,
    ).toBe(true);
  });
  it("revalidates purported valid evidence before granting exclusions", () => {
    expect(
      classify({ evidence: evidence(record({ projectId: "foreign" })) })
        .excludedServices,
    ).toEqual([]);
  });
});

describe("durable record reader", () => {
  it("distinguishes unset configuration from an explicit no-run snapshot", async () => {
    expect(await readRailwayLifecycleEvidence(undefined, policy, NOW)).toEqual({
      status: "unavailable",
    });
    const dir = await mkdtemp(join(tmpdir(), "lifecycle-"));
    try {
      const path = join(dir, "records.json");
      await writeFile(path, JSON.stringify({ schemaVersion: 1, runs: [] }));
      expect(await readRailwayLifecycleEvidence(path, policy, NOW)).toEqual({
        status: "valid",
        snapshot: { schemaVersion: 1, runs: [] },
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("reports configured missing, unreadable, and malformed files as typed failures", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lifecycle-"));
    try {
      const path = join(dir, "records.json");
      expect(
        await readRailwayLifecycleEvidence(path, policy, NOW),
      ).toMatchObject({
        status: "invalid",
        issues: [{ code: "records-unreadable" }],
      });
      expect(
        await readRailwayLifecycleEvidence(dir, policy, NOW),
      ).toMatchObject({
        status: "invalid",
        issues: [{ code: "records-unreadable" }],
      });
      await writeFile(path, "{bad-json");
      expect(
        await readRailwayLifecycleEvidence(path, policy, NOW),
      ).toMatchObject({
        status: "invalid",
        issues: [{ code: "records-malformed-json" }],
      });
      await writeFile(path, JSON.stringify({ schemaVersion: 9, runs: [] }));
      expect(
        await readRailwayLifecycleEvidence(path, policy, NOW),
      ).toMatchObject({ status: "invalid" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("contains no network, subprocess, or filesystem mutation capability", async () => {
    const pure = await readFile(
      new URL("../harness/src/shared/railway-lifecycle.ts", import.meta.url),
      "utf8",
    );
    const adapter = await readFile(
      new URL(
        "../harness/src/shared/railway-lifecycle-records.ts",
        import.meta.url,
      ),
      "utf8",
    );
    expect(pure).not.toMatch(/\b(?:fetch|process|require)\s*[.(]|from\s+["']/);
    expect(adapter).not.toMatch(
      /\b(?:writeFile|unlink|mkdir|rm|spawn|exec|fetch)\s*\(/,
    );
  });
});
