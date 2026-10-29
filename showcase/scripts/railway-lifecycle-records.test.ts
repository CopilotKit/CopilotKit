import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readRailwayLifecycleEvidence } from "../harness/src/shared/railway-lifecycle-records";
import { DISPOSABLE_LIFECYCLE_POLICY } from "./railway-envs";

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

it.each(["x-policy-sha256", "x-snapshot-sha256"])(
  "refuses mismatched %s without acknowledging",
  async (header) => {
    const fetcher = vi.fn(
      async () =>
        new Response(bytes, { headers: { ...headers, [header]: "wrong" } }),
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
      issues: [{ code: "records-unreadable" }],
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

it("fails closed when the acknowledgment is rejected", async () => {
  const fetcher = vi.fn(async (_url: unknown, options?: RequestInit) =>
    options?.method === "POST"
      ? new Response("", { status: 503 })
      : new Response(bytes, { headers }),
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
});

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

// A policy transition must require a fresh real reader acknowledgement for every role.
it.each(["image-gate", "ruby-promotion", "harness"])(
  "%s refuses the previous policy and acknowledges only the matching additive policy",
  async (consumer) => {
    vi.stubEnv("SHOWCASE_REGISTRY_CONSUMER", consumer);
    const previousPolicy = {
      ...DISPOSABLE_LIFECYCLE_POLICY,
      approvedImages: DISPOSABLE_LIFECYCLE_POLICY.approvedImages.slice(0, -1),
    };
    const fetcher = vi.fn(async (_url: unknown, options?: RequestInit) =>
      options?.method === "POST"
        ? new Response("{}")
        : new Response(bytes, { headers }),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      readRailwayLifecycleEvidence(endpoint, previousPolicy, new Date()),
    ).resolves.toMatchObject({ status: "invalid" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(
      readRailwayLifecycleEvidence(
        endpoint,
        DISPOSABLE_LIFECYCLE_POLICY,
        new Date(),
      ),
    ).resolves.toMatchObject({ status: "valid" });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher).toHaveBeenLastCalledWith(
      new URL(`/consumers/${consumer}`, endpoint),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          reader: "railway-lifecycle-records-v1",
          recordsFile: endpoint,
          sha256: headers["x-snapshot-sha256"],
          policySha256: headers["x-policy-sha256"],
        }),
      }),
    );
  },
);
