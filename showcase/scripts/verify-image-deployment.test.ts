import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { stepsOf } from "./__tests__/showcase-build-workflow";
import {
  SupersededImageError,
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
  it("keeps Railway request timers responsive while the registry subprocess is pending", async () => {
    const directory = mkdtempSync(join(tmpdir(), "image-inspection-"));
    const gate = join(directory, "event-loop-responsive");
    const originalPath = process.env.PATH;
    // A real child process needs the parent event loop to release it. A sync
    // inspector blocks that release and fails, as it blocks Railway timers.
    writeFileSync(
      join(directory, "docker"),
      `#!${process.execPath}
const fs = require("node:fs");
const gate = ${JSON.stringify(gate)};
const deadline = Date.now() + 300;
const timer = setInterval(() => {
  if (fs.existsSync(gate)) {
    clearInterval(timer);
    process.stdout.write(process.argv.includes("--raw")
      ? ${JSON.stringify(JSON.stringify({ schemaVersion: 2, config: {}, layers: [] }))}
      : ${JSON.stringify(INDEX)});
  } else if (Date.now() >= deadline) {
    process.stderr.write("parent event loop blocked during registry inspection");
    process.exit(1);
  }
}, 5);
`,
      { mode: 0o755 },
    );
    process.env.PATH = `${directory}:${originalPath}`;
    const release = setTimeout(() => writeFileSync(gate, "released"), 10);
    try {
      expect(await readExpectedImage(`${REPO}:latest`)).toEqual({
        digests: [INDEX],
      });
    } finally {
      clearTimeout(release);
      process.env.PATH = originalPath;
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function inspector(latest = INDEX) {
    return vi.fn((ref: string, format: "digest" | "manifest" | "config") =>
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
  it("resolves manual latest before deployment without accepting attestation identity", async () => {
    const inspect = inspector();
    await expect(
      readExpectedImage(`${REPO}:latest`, {}, inspect),
    ).resolves.toEqual(expected);
    expect(inspect).toHaveBeenCalledTimes(2);
  });
  it("binds a CI image to the immutable full commit and refuses an advanced latest", async () => {
    const inspect = inspector(OLD);
    await expect(
      readExpectedImage(
        `${REPO}:${"d".repeat(40)}`,
        { requireCommit: true, checkLatest: true },
        inspect,
      ),
    ).rejects.toThrow(/superseded/);
    expect(inspect).toHaveBeenCalled();
  });
  it("accepts a single-platform selected digest", async () => {
    await expect(
      readExpectedImage(`${REPO}@${INDEX}`, {}, (_ref, format) =>
        format === "digest"
          ? INDEX
          : JSON.stringify({ schemaVersion: 2, config: {}, layers: [] }),
      ),
    ).resolves.toEqual({ digests: [INDEX] });
  });
  it.each([
    `${REPO}:latest`,
    `${REPO}:short-sha`,
    "",
    "https://example.com/image",
  ])(
    "refuses non-commit CI references before registry access: %s",
    async (image) => {
      const inspect = inspector();
      await expect(
        readExpectedImage(image, { requireCommit: true }, inspect),
      ).rejects.toThrow(/image reference/);
      expect(inspect).not.toHaveBeenCalled();
    },
  );
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
  it("retries transient HTTP errors after releasing each body, then verifies the selected digest", async () => {
    const statuses = [429, 500, 503, 599];
    const events: string[] = [];
    let clock = 0;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => {
      const status = statuses[fetchImpl.mock.calls.length - 1];
      events.push(`fetch ${status ?? 200}`);
      return status
        ? new Response(
            new ReadableStream({
              cancel: async () => {
                await Promise.resolve();
                events.push(`cancel ${status}`);
              },
            }),
            { status },
          )
        : response();
    });
    await expect(
      verifyImageDeployment("token", "fresh", expected, target, {
        fetchImpl,
        now: () => clock,
        timeoutMs: 25_000,
        sleep: async (ms) => {
          events.push(`sleep ${ms}`);
          clock += ms;
        },
      }),
    ).resolves.toEqual({ imageDigest: PLATFORM });
    expect(events).toEqual([
      ...statuses.flatMap((status) => [
        `fetch ${status}`,
        `cancel ${status}`,
        "sleep 5000",
      ]),
      "fetch 200",
    ]);
  });
  it.each([
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "EAI_AGAIN",
    "ENETUNREACH",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_SOCKET",
    "UND_ERR_HEADERS_TIMEOUT",
    "UND_ERR_BODY_TIMEOUT",
  ])("retries native fetch transport failures with cause %s", async (code) => {
    const failure = new TypeError("fetch failed", {
      cause: Object.assign(new Error("network failure"), { code }),
    });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValue(response());
    const sleep = vi.fn(async () => {});
    await expect(
      verifyImageDeployment("token", "fresh", expected, target, {
        fetchImpl,
        sleep,
      }),
    ).resolves.toEqual({ imageDigest: PLATFORM });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledExactlyOnceWith(5_000);
  });
  it.each([
    new TypeError("fetch failed"),
    Object.assign(new Error("socket closed"), { code: "ECONNRESET" }),
    new DOMException("request timed out", "TimeoutError"),
    new DOMException("request aborted", "AbortError"),
  ])("retries a transient fetch rejection: %s", async (failure) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValue(response());
    const sleep = vi.fn(async () => {});
    await expect(
      verifyImageDeployment("token", "fresh", expected, target, {
        fetchImpl,
        sleep,
      }),
    ).resolves.toEqual({ imageDigest: PLATFORM });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledExactlyOnceWith(5_000);
  });
  it("bounds persistent transport rejections to the original deadline and preserves the final failure", async () => {
    const failure = new TypeError("fetch failed", {
      cause: Object.assign(new Error("connection reset"), {
        code: "ECONNRESET",
      }),
    });
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(failure);
    let clock = 0;
    const sleep = vi.fn(async (ms: number) => {
      clock += ms;
    });
    await expect(
      verifyImageDeployment("token", "fresh", expected, target, {
        fetchImpl,
        now: () => clock,
        timeoutMs: 12_000,
        sleep,
      }),
    ).rejects.toBe(failure);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls).toEqual([[5_000], [5_000], [2_000]]);
    expect(clock).toBe(12_000);
  });
  it("shares one deadline across transport failures, HTTP errors and pending states", async () => {
    const failure = new DOMException("request timed out", "TimeoutError");
    const cancel = vi.fn();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(
        new Response(new ReadableStream({ cancel }), { status: 429 }),
      )
      .mockResolvedValueOnce(response(node("DEPLOYING")))
      .mockResolvedValueOnce(
        new Response(new ReadableStream({ cancel }), { status: 503 }),
      )
      .mockRejectedValue(failure);
    let clock = 0;
    const sleep = vi.fn(async (ms: number) => {
      clock += ms;
    });
    await expect(
      verifyImageDeployment("token", "fresh", expected, target, {
        fetchImpl,
        now: () => clock,
        timeoutMs: 17_000,
        sleep,
      }),
    ).rejects.toBe(failure);
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls).toEqual([[5_000], [5_000], [5_000], [2_000]]);
    expect(clock).toBe(17_000);
  });
  it.each([
    new TypeError("Failed to parse URL from invalid"),
    new TypeError("Request with GET/HEAD method cannot have body."),
    new TypeError("fetch failed", {
      cause: Object.assign(new TypeError("Invalid URL"), {
        code: "ERR_INVALID_URL",
      }),
    }),
    new TypeError("fetch failed", { cause: new Error("invalid request") }),
    new Error("programming failure"),
    new Error("fetch failed"),
    { code: "ECONNRESET" },
    "fetch failed",
    null,
  ])("does not retry a non-transient fetch rejection: %s", async (failure) => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(failure);
    const sleep = vi.fn();
    await expect(
      verifyImageDeployment("token", "fresh", expected, target, {
        fetchImpl,
        sleep,
      }),
    ).rejects.toBe(failure);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
  it("does not retry response parsing failures even with a transport error signature", async () => {
    const failure = new DOMException("response parse failed", "TimeoutError");
    const reply = response();
    vi.spyOn(reply, "json").mockRejectedValue(failure);
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply);
    const sleep = vi.fn();
    await expect(
      verifyImageDeployment("token", "fresh", expected, target, {
        fetchImpl,
        sleep,
      }),
    ).rejects.toBe(failure);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
  it.each([429, 503])(
    "bounds persistent HTTP %s retries to the original deadline and releases the final body",
    async (status) => {
      const cancel = vi.fn();
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockImplementation(
          async () => new Response(new ReadableStream({ cancel }), { status }),
        );
      let clock = 0;
      const sleep = vi.fn(async (ms: number) => {
        clock += ms;
      });
      await expect(
        verifyImageDeployment("token", "fresh", expected, target, {
          fetchImpl,
          now: () => clock,
          timeoutMs: 12_000,
          sleep,
        }),
      ).rejects.toThrow(`lookup returned HTTP ${status}`);
      expect(fetchImpl).toHaveBeenCalledTimes(4);
      expect(cancel).toHaveBeenCalledTimes(4);
      expect(sleep.mock.calls).toEqual([[5_000], [5_000], [2_000]]);
      expect(clock).toBe(12_000);
    },
  );
  it.each([400, 401, 403, 404, 499])(
    "fails promptly for non-retryable HTTP %s and releases its body",
    async (status) => {
      const cancel = vi.fn();
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockImplementation(
          async () => new Response(new ReadableStream({ cancel }), { status }),
        );
      const sleep = vi.fn();
      await expect(
        verifyImageDeployment("token", "fresh", expected, target, {
          fetchImpl,
          sleep,
        }),
      ).rejects.toThrow(`lookup returned HTTP ${status}`);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    },
  );
  it("does not treat HTTP or GraphQL errors as deployment success", async () => {
    for (const reply of [
      new Response("denied", { status: 403 }),
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
  expect(step?.env?.GH_TOKEN).toBe("${{ secrets.GITHUB_TOKEN }}");
});

it("authenticates scheduled remediation image reads and budgets verified fleet deployment", () => {
  const workflow = parseYaml(
    readFileSync(
      new URL(
        "../../.github/workflows/showcase_reconcile_staging.yml",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const job = workflow.jobs.reconcile;
  const deployIndex = job.steps.findIndex((step: { run?: string }) =>
    step.run?.includes("reconcile-staging.ts"),
  );
  const loginIndex = job.steps.findIndex((step: { uses?: string }) =>
    step.uses?.startsWith("docker/login-action@"),
  );
  expect(loginIndex).toBeGreaterThanOrEqual(0);
  expect(loginIndex).toBeLessThan(deployIndex);
  expect(job.steps[loginIndex].with).toEqual({
    registry: "ghcr.io",
    username: "${{ github.actor }}",
    password: "${{ secrets.GHCR_TOKEN || secrets.GITHUB_TOKEN }}",
  });
  expect(job["timeout-minutes"]).toBe(45);
});

const BUILD_SHA = "d".repeat(40);
const NEW_SHA = "e".repeat(40);
const NEW_INDEX = `sha256:${"e".repeat(64)}`;
const NEW_PLATFORM = `sha256:${"f".repeat(64)}`;
function newerInspector(
  config = JSON.stringify({
    config: { Labels: { "org.opencontainers.image.revision": NEW_SHA } },
  }),
) {
  return vi.fn(
    async (ref: string, format: "digest" | "manifest" | "config") => {
      if (format === "config") return config;
      if (format === "digest")
        return ref.endsWith(":latest") || ref.includes(NEW_INDEX)
          ? NEW_INDEX
          : INDEX;
      return JSON.stringify({
        schemaVersion: 2,
        manifests: [
          {
            digest: ref.includes(NEW_INDEX) ? NEW_PLATFORM : PLATFORM,
            platform: { os: "linux", architecture: "amd64" },
          },
          { digest: OLD, platform: { os: "unknown", architecture: "unknown" } },
        ],
      });
    },
  );
}
describe("strict superseded ownership", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("refuses invalid GitHub repository paths before comparison", async () => {
    vi.stubEnv("GITHUB_REPOSITORY", "../repository");
    const compare = vi.fn(async () => "behind");
    const error = await readExpectedImage(
      `${REPO}:${BUILD_SHA}`,
      { requireCommit: true, checkLatest: true, compare },
      newerInspector(),
    ).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(SupersededImageError);
    expect(compare).not.toHaveBeenCalled();
  });

  it("pins revision and runnable identity to the newer digest before declaring preflight supersession", async () => {
    const inspect = newerInspector();
    const compare = vi.fn(async () => "behind");
    const error = await readExpectedImage(
      `${REPO}:${BUILD_SHA}`,
      { requireCommit: true, checkLatest: true, compare },
      inspect,
    ).catch((e) => e);
    expect(error).toBeInstanceOf(SupersededImageError);
    expect(error).toMatchObject({
      supersededBy: NEW_SHA,
      supersedingImageDigest: NEW_INDEX,
    });
    expect(compare).toHaveBeenCalledWith(
      "CopilotKit/CopilotKit",
      NEW_SHA,
      BUILD_SHA,
    );
    expect(inspect).toHaveBeenCalledWith(`${REPO}@${NEW_INDEX}`, "config");
    expect(inspect).not.toHaveBeenCalledWith(`${REPO}:latest`, "config");
  });
  it.each(["ahead", "identical", "diverged", "unknown", "", "broken"])(
    "fails closed for compare %s",
    async (status) => {
      const error = await readExpectedImage(
        `${REPO}:${BUILD_SHA}`,
        { requireCommit: true, checkLatest: true, compare: async () => status },
        newerInspector(),
      ).catch((e) => e);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(SupersededImageError);
    },
  );
  it.each([
    "{}",
    "bad json",
    JSON.stringify({ "org.opencontainers.image.revision": "short" }),
    JSON.stringify({ "org.opencontainers.image.revision": BUILD_SHA }),
    JSON.stringify([
      { "org.opencontainers.image.revision": NEW_SHA },
      { "org.opencontainers.image.revision": BUILD_SHA },
    ]),
  ])(
    "refuses absent, malformed, same-commit or ambiguous revisions: %s",
    async (config) => {
      const compare = vi.fn(async () => "behind");
      const error = await readExpectedImage(
        `${REPO}:${BUILD_SHA}`,
        { requireCommit: true, checkLatest: true, compare },
        newerInspector(config),
      ).catch((e) => e);
      expect(error).not.toBeInstanceOf(SupersededImageError);
      expect(compare).not.toHaveBeenCalled();
    },
  );
  it("preserves mismatch when ownership lookup rejects", async () => {
    const error = await readExpectedImage(
      `${REPO}:${BUILD_SHA}`,
      {
        requireCommit: true,
        checkLatest: true,
        compare: async () => {
          throw new Error("denied");
        },
      },
      newerInspector(),
    ).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(SupersededImageError);
  });
  it.each(["not-a-digest", OLD])(
    "refuses a malformed or unproven latest candidate %s",
    async (latest) => {
      const inspectBase = newerInspector();
      const inspect = vi.fn(
        async (ref: string, format: "digest" | "manifest" | "config") =>
          ref.endsWith(":latest") ? latest : inspectBase(ref, format),
      );
      const error = await readExpectedImage(
        `${REPO}:${BUILD_SHA}`,
        {
          requireCommit: true,
          checkLatest: true,
          compare: async () => "behind",
        },
        inspect,
      ).catch((e) => e);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(SupersededImageError);
    },
  );
  it("refuses attestation-only newer image identities", async () => {
    const base = newerInspector();
    const inspect = vi.fn(
      async (ref: string, format: "digest" | "manifest" | "config") =>
        ref.includes(NEW_INDEX) && format === "manifest"
          ? JSON.stringify({
              schemaVersion: 2,
              manifests: [
                {
                  digest: OLD,
                  platform: { os: "unknown", architecture: "unknown" },
                },
              ],
            })
          : base(ref, format),
    );
    const error = await readExpectedImage(
      `${REPO}:${BUILD_SHA}`,
      { requireCommit: true, checkLatest: true, compare: async () => "behind" },
      inspect,
    ).catch((e) => e);
    expect(error).not.toBeInstanceOf(SupersededImageError);
  });
  it("does not run ownership probes on a matching CI image", async () => {
    const base = newerInspector();
    const inspect = vi.fn(
      async (ref: string, format: "digest" | "manifest" | "config") =>
        ref.endsWith(":latest") ? INDEX : base(ref, format),
    );
    const compare = vi.fn(async () => "behind");
    await expect(
      readExpectedImage(
        `${REPO}:${BUILD_SHA}`,
        { requireCommit: true, checkLatest: true, compare },
        inspect,
      ),
    ).resolves.toEqual({
      ...expected,
      build: { repository: REPO, sha: BUILD_SHA },
    });
    expect(compare).not.toHaveBeenCalled();
    expect(inspect.mock.calls.some(([, format]) => format === "config")).toBe(
      false,
    );
  });
  it.each([NEW_INDEX, NEW_PLATFORM])(
    "recognizes an exact SUCCESS race using candidate identity %s",
    async (digest) => {
      await expect(
        verifyImageDeployment(
          "token",
          "fresh",
          { ...expected, build: { repository: REPO, sha: BUILD_SHA } },
          target,
          {
            fetchImpl: vi
              .fn<typeof fetch>()
              .mockResolvedValue(response(node("SUCCESS", digest))),
            inspect: newerInspector(),
            compare: async () => "behind",
          },
        ),
      ).rejects.toBeInstanceOf(SupersededImageError);
    },
  );
  it.each([OLD, INDEX, null, undefined, "malformed"])(
    "does not skip an unproven observed digest %s",
    async (digest) => {
      // INDEX is the expected index and remains a normal successful receipt.
      const inspect = newerInspector();
      const result = verifyImageDeployment(
        "token",
        "fresh",
        { ...expected, build: { repository: REPO, sha: BUILD_SHA } },
        target,
        {
          fetchImpl: vi
            .fn<typeof fetch>()
            .mockResolvedValue(
              response({ ...node(), meta: { imageDigest: digest } }),
            ),
          inspect,
          compare: async () => "behind",
        },
      );
      if (digest === INDEX) {
        await expect(result).resolves.toEqual({ imageDigest: INDEX });
        expect(inspect).not.toHaveBeenCalled();
      } else {
        const error = await result.catch((e) => e);
        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(SupersededImageError);
      }
    },
  );
  it.each([
    { ...node("SUCCESS", NEW_INDEX), serviceId: "wrong" },
    { ...node("SUCCESS", NEW_INDEX), environmentId: "wrong" },
    { ...node("SUCCESS", NEW_INDEX), id: "wrong" },
    node("FAILED", NEW_INDEX),
  ])(
    "preserves identity/status failures without ownership probes",
    async (deployment) => {
      const inspect = newerInspector();
      await expect(
        verifyImageDeployment(
          "token",
          "fresh",
          { ...expected, build: { repository: REPO, sha: BUILD_SHA } },
          target,
          {
            fetchImpl: vi
              .fn<typeof fetch>()
              .mockResolvedValue(response(deployment)),
            inspect,
            compare: async () => "behind",
          },
        ),
      ).rejects.toThrow();
      expect(inspect).not.toHaveBeenCalled();
    },
  );
});
