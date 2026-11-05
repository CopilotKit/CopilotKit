import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readRailwayLifecycleEvidence } from "../harness/src/shared/railway-lifecycle-records";
import { DISPOSABLE_LIFECYCLE_POLICY } from "./railway-envs";
import type {
  RailwayLifecyclePolicy,
  RunRecord,
} from "../harness/src/shared/railway-lifecycle";

const endpoint = "https://runner.example/registry";
const bytes = JSON.stringify({ schemaVersion: 1, runs: [] });
/** Hash the exact published bytes independently of the reader. */
function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
const headers = {
  "x-snapshot-sha256": sha256(bytes),
  "x-policy-sha256": sha256(JSON.stringify(DISPOSABLE_LIFECYCLE_POLICY)),
};
const predecessorPolicySha256 =
  "4ded223bb02ea0cdf7ffed4fb8f78b70fbb50c9f74ae82d34addfc94f712c751";
const now = new Date("2026-11-05T12:20:00.000Z");
const recoveryRun: RunRecord = {
  runId: "policy-recovery-test",
  projectId: DISPOSABLE_LIFECYCLE_POLICY.projectId,
  environmentId: "disposable-env",
  startedAt: "2026-11-05T12:00:00.000Z",
  expiresAt: "2026-11-05T13:00:00.000Z",
  phase: "ready",
  services: [
    {
      name: "disposable-app",
      serviceId: "disposable-id",
      expectedImage: DISPOSABLE_LIFECYCLE_POLICY.approvedImages[0],
    },
  ],
  resources: [{ kind: "environment", id: "disposable-env" }],
};
const recoveryBytes = JSON.stringify({ schemaVersion: 1, runs: [recoveryRun] });

beforeEach(() => {
  vi.stubEnv("SHOWCASE_DISPOSABLE_RUN_RECORDS_TOKEN", "test-only-token");
  vi.stubEnv("SHOWCASE_REGISTRY_CONSUMER", "harness");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("authenticates a fresh snapshot and acknowledges its exact bytes and policy", async () => {
  const fetcher = vi.fn(async (_url: unknown, options?: RequestInit) =>
    options?.method === "POST"
      ? new Response("{}")
      : new Response(bytes, { headers }),
  );
  vi.stubGlobal("fetch", fetcher);
  await expect(
    readRailwayLifecycleEvidence(
      endpoint,
      DISPOSABLE_LIFECYCLE_POLICY,
      new Date(),
    ),
  ).resolves.toEqual({
    status: "valid",
    snapshot: { schemaVersion: 1, runs: [] },
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher).toHaveBeenNthCalledWith(
    1,
    new URL(endpoint),
    expect.objectContaining({
      headers: { authorization: "Bearer test-only-token" },
      redirect: "error",
    }),
  );
  expect(fetcher).toHaveBeenNthCalledWith(
    2,
    new URL("/consumers/harness", endpoint),
    expect.objectContaining({
      method: "POST",
      redirect: "error",
      body: JSON.stringify({
        reader: "railway-lifecycle-records-v1",
        recordsFile: endpoint,
        sha256: headers["x-snapshot-sha256"],
        policySha256: headers["x-policy-sha256"],
      }),
    }),
  );
});

it.each(["image-gate", "ruby-promotion", "harness"])(
  "recovers the reviewed docs-preview policy transition for %s",
  async (consumer) => {
    vi.stubEnv("SHOWCASE_REGISTRY_CONSUMER", consumer);
    // Any future policy change must make this recovery test fail for review.
    const predecessor = {
      ...DISPOSABLE_LIFECYCLE_POLICY,
      permanentServices: DISPOSABLE_LIFECYCLE_POLICY.permanentServices.filter(
        ({ name }) => name !== "docs-preview",
      ),
    };
    expect(sha256(JSON.stringify(predecessor))).toBe(predecessorPolicySha256);
    const fetcher = vi.fn(async (_url: unknown, options?: RequestInit) =>
      options?.method === "POST"
        ? new Response("{}")
        : new Response(recoveryBytes, {
            headers: {
              "x-snapshot-sha256": sha256(recoveryBytes),
              "x-policy-sha256": predecessorPolicySha256,
            },
          }),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      readRailwayLifecycleEvidence(endpoint, DISPOSABLE_LIFECYCLE_POLICY, now),
    ).resolves.toEqual({
      status: "valid",
      snapshot: { schemaVersion: 1, runs: [recoveryRun] },
    });
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      new URL(`/consumers/${consumer}`, endpoint),
      expect.objectContaining({
        body: JSON.stringify({
          reader: "railway-lifecycle-records-v1",
          recordsFile: endpoint,
          sha256: sha256(recoveryBytes),
          policySha256: predecessorPolicySha256,
        }),
      }),
    );
  },
);

it.each([
  ["name", "permanent-collision"],
  ["serviceId", "permanent-collision"],
  ["image", "unapproved-image"],
  ["environment", "forbidden-environment"],
])(
  "still enforces current %s protection during recovery",
  async (collision, code) => {
    const permanent = DISPOSABLE_LIFECYCLE_POLICY.permanentServices.find(
      ({ name }) => name === "docs-preview",
    )!;
    const snapshot = JSON.stringify({
      schemaVersion: 1,
      runs: [
        {
          ...recoveryRun,
          environmentId:
            collision === "environment"
              ? DISPOSABLE_LIFECYCLE_POLICY.forbiddenEnvironmentIds[0]
              : "disposable-env",
          services: [
            {
              name: collision === "name" ? permanent.name : "disposable-app",
              serviceId:
                collision === "serviceId"
                  ? permanent.serviceId
                  : "disposable-id",
              expectedImage:
                collision === "image"
                  ? `ghcr.io/copilotkit/unapproved@sha256:${"f".repeat(64)}`
                  : DISPOSABLE_LIFECYCLE_POLICY.approvedImages[0],
            },
          ],
        },
      ],
    });
    const fetcher = vi.fn(
      async () =>
        new Response(snapshot, {
          headers: {
            "x-snapshot-sha256": sha256(snapshot),
            "x-policy-sha256": predecessorPolicySha256,
          },
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      readRailwayLifecycleEvidence(
        endpoint,
        DISPOSABLE_LIFECYCLE_POLICY,
        new Date("2026-11-05T12:20:00.000Z"),
      ),
    ).resolves.toMatchObject({
      status: "invalid",
      issues: [expect.objectContaining({ code })],
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);

it.each([
  {
    ...DISPOSABLE_LIFECYCLE_POLICY,
    approvedImages: [
      ...DISPOSABLE_LIFECYCLE_POLICY.approvedImages,
      `ghcr.io/copilotkit/other@sha256:${"f".repeat(64)}`,
    ],
  },
  { ...DISPOSABLE_LIFECYCLE_POLICY, forbiddenEnvironmentIds: [] },
  {
    ...DISPOSABLE_LIFECYCLE_POLICY,
    permanentServices: [
      ...DISPOSABLE_LIFECYCLE_POLICY.permanentServices,
      { name: "future-permanent", serviceId: "future-id" },
    ],
  },
] satisfies RailwayLifecyclePolicy[])(
  "refuses the predecessor publisher when the local policy changes: %#",
  async (policy) => {
    const fetcher = vi.fn(
      async () =>
        new Response(bytes, {
          headers: { ...headers, "x-policy-sha256": predecessorPolicySha256 },
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      readRailwayLifecycleEvidence(endpoint, policy, new Date()),
    ).resolves.toMatchObject({ status: "invalid" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);

it.each([
  [headers["x-policy-sha256"], "x-policy-sha256"],
  [headers["x-policy-sha256"], "x-snapshot-sha256"],
  [predecessorPolicySha256, "x-snapshot-sha256"],
])(
  "refuses mismatched %s / %s without acknowledging",
  async (policySha256, header) => {
    const fetcher = vi.fn(
      async () =>
        new Response(bytes, {
          headers: {
            ...headers,
            "x-policy-sha256": policySha256,
            [header]: "wrong",
          },
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      readRailwayLifecycleEvidence(
        endpoint,
        DISPOSABLE_LIFECYCLE_POLICY,
        new Date(),
      ),
    ).resolves.toMatchObject({
      status: "invalid",
      issues: [
        {
          code:
            header === "x-policy-sha256"
              ? "records-policy-mismatch"
              : "records-unreadable",
        },
      ],
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);

it("refuses missing authentication before any network request", async () => {
  vi.stubEnv("SHOWCASE_DISPOSABLE_RUN_RECORDS_TOKEN", "");
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(
    readRailwayLifecycleEvidence(
      endpoint,
      DISPOSABLE_LIFECYCLE_POLICY,
      new Date(),
    ),
  ).resolves.toMatchObject({ status: "invalid" });
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([headers["x-policy-sha256"], predecessorPolicySha256])(
  "fails closed when the acknowledgment is rejected for %s",
  async (policySha256) => {
    const fetcher = vi.fn(async (_url: unknown, options?: RequestInit) =>
      options?.method === "POST"
        ? new Response("", { status: 503 })
        : new Response(bytes, {
            headers: { ...headers, "x-policy-sha256": policySha256 },
          }),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      readRailwayLifecycleEvidence(
        endpoint,
        DISPOSABLE_LIFECYCLE_POLICY,
        new Date(),
      ),
    ).resolves.toMatchObject({ status: "invalid" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  },
);

it("cancels oversized response streams and never acknowledges them", async () => {
  const cancelled = vi.fn();
  const fetcher = vi.fn(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1));
          },
          cancel: cancelled,
        }),
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  await expect(
    readRailwayLifecycleEvidence(
      endpoint,
      DISPOSABLE_LIFECYCLE_POLICY,
      new Date(),
    ),
  ).resolves.toMatchObject({ status: "invalid" });
  expect(cancelled).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("does not reuse a prior successful read during a network failure", async () => {
  const fetcher = vi.fn(async (_url: unknown, options?: RequestInit) =>
    options?.method === "POST"
      ? new Response("{}")
      : new Response(bytes, { headers }),
  );
  vi.stubGlobal("fetch", fetcher);
  await expect(
    readRailwayLifecycleEvidence(
      endpoint,
      DISPOSABLE_LIFECYCLE_POLICY,
      new Date(),
    ),
  ).resolves.toMatchObject({ status: "valid" });
  fetcher.mockRejectedValue(new Error("offline"));
  await expect(
    readRailwayLifecycleEvidence(
      endpoint,
      DISPOSABLE_LIFECYCLE_POLICY,
      new Date(),
    ),
  ).resolves.toMatchObject({ status: "invalid" });
});
