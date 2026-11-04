import { describe, expect, it, vi } from "vitest";
import { stepsOf } from "./__tests__/showcase-build-workflow";
import {
  readExpectedImage,
  verifyImageDeployment,
} from "./verify-image-deployment";

const INDEX = `sha256:${"a".repeat(64)}`;
const PLATFORM = `sha256:${"b".repeat(64)}`;
const OLD = `sha256:${"c".repeat(64)}`;
const REPO = "ghcr.io/copilotkit/showcase-crewai-conversational-flows";
const target = { serviceId: "agent", environmentId: "staging" };
const expected = { digests: [INDEX, PLATFORM] };
const node = (status = "SUCCESS", imageDigest: unknown = PLATFORM) => ({
  id: "fresh",
  ...target,
  status,
  meta: { imageDigest },
});
const response = (deployment = node()) =>
  new Response(JSON.stringify({ data: { deployment } }));

describe("readExpectedImage", () => {
  function inspector(latest = INDEX) {
    return vi.fn((ref: string, format: "digest" | "manifest") =>
      format === "digest"
        ? ref.endsWith(":latest")
          ? latest
          : INDEX
        : JSON.stringify({
            schemaVersion: 2,
            manifests: [
              {
                digest: PLATFORM,
                platform: { os: "linux", architecture: "amd64" },
              },
              {
                digest: OLD,
                platform: { os: "unknown", architecture: "unknown" },
              },
            ],
          }),
    );
  }
  it("resolves manual latest before deployment without accepting attestation identity", () => {
    const inspect = inspector();
    expect(readExpectedImage(`${REPO}:latest`, {}, inspect)).toEqual(expected);
    expect(inspect).toHaveBeenCalledTimes(2);
  });
  it("binds a CI image to the immutable full commit and refuses an advanced latest", () => {
    const inspect = inspector(OLD);
    expect(() =>
      readExpectedImage(
        `${REPO}:${"d".repeat(40)}`,
        { requireCommit: true, checkLatest: true },
        inspect,
      ),
    ).toThrow(/superseded/);
    expect(inspect).toHaveBeenCalledTimes(2);
  });
  it("accepts a single-platform selected digest", () => {
    expect(
      readExpectedImage(`${REPO}@${INDEX}`, {}, (_ref, format) =>
        format === "digest"
          ? INDEX
          : JSON.stringify({ schemaVersion: 2, config: {}, layers: [] }),
      ),
    ).toEqual({ digests: [INDEX] });
  });
  it.each([
    `${REPO}:latest`,
    `${REPO}:short-sha`,
    "",
    "https://example.com/image",
  ])("refuses non-commit CI references before registry access: %s", (image) => {
    const inspect = inspector();
    expect(() =>
      readExpectedImage(image, { requireCommit: true }, inspect),
    ).toThrow(/image reference/);
    expect(inspect).not.toHaveBeenCalled();
  });
});

describe("verifyImageDeployment", () => {
  it.each([INDEX, PLATFORM])(
    "accepts only the exact successful deployment with a runnable image identity: %s",
    async (digest) => {
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValue(response(node("SUCCESS", digest)));
      await expect(
        verifyImageDeployment("token", "fresh", expected, target, {
          fetchImpl,
        }),
      ).resolves.toEqual({ imageDigest: digest });
      const request = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
      expect(request.variables).toEqual({ id: "fresh" });
      expect(request.query).not.toContain("deployments(");
    },
  );
  it.each([OLD, null, undefined])(
    "rejects a successful deployment with an old or missing digest: %s",
    async (digest) => {
      const deployment = node();
      deployment.meta = { imageDigest: digest };
      await expect(
        verifyImageDeployment("token", "fresh", expected, target, {
          fetchImpl: vi
            .fn<typeof fetch>()
            .mockResolvedValue(response(deployment)),
        }),
      ).rejects.toThrow(/image digest/);
    },
  );
  it.each(["id", "serviceId", "environmentId"])(
    "rejects a different deployment identity field: %s",
    async (field) => {
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValue(response({ ...node(), [field]: "other" }));
      await expect(
        verifyImageDeployment("token", "fresh", expected, target, {
          fetchImpl,
        }),
      ).rejects.toThrow(/identity/);
    },
  );
  it.each([
    "FAILED",
    "CRASHED",
    "REMOVED",
    "SLEEPING",
    "NEEDS_APPROVAL",
    "NEW_UNKNOWN_STATUS",
  ])(
    "fails promptly for non-running terminal/actionable status %s",
    async (status) => {
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValue(response(node(status)));
      await expect(
        verifyImageDeployment("token", "fresh", expected, target, {
          fetchImpl,
        }),
      ).rejects.toThrow(status);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );
  it("waits for the selected deployment and bounds pending status", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => response(node("DEPLOYING")));
    let clock = 0;
    await expect(
      verifyImageDeployment("token", "fresh", expected, target, {
        fetchImpl,
        now: () => clock,
        timeoutMs: 10,
        sleep: async (ms) => {
          clock += ms;
        },
      }),
    ).rejects.toThrow(/timed out/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("does not treat HTTP or GraphQL errors as deployment success", async () => {
    for (const reply of [
      new Response("denied", { status: 503 }),
      new Response(JSON.stringify({ errors: [{ message: "denied" }] })),
    ]) {
      await expect(
        verifyImageDeployment("token", "fresh", expected, target, {
          fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(reply),
        }),
      ).rejects.toThrow(/lookup/);
    }
  });
});

it.each([
  ["redeploy-staging", "Redeploy changed services in staging"],
  ["redeploy-staging-starters", "Redeploy changed starters in staging"],
])("wires this build SHA into the %s deployment lane", (job, stepName) => {
  const step = stepsOf(job).find((candidate) => candidate.name === stepName);
  expect(step?.env?.STAGING_EXPECTED_IMAGE_TAG).toBe("${{ github.sha }}");
});
