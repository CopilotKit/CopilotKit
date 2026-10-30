import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readExpectedDocsImage,
  verifyDocsDeployment,
} from "./verify-docs-deployment";
import { DOCS_GHCR_IMAGE } from "./docs-prod-pin";
import { SERVICES, STAGING_ENV_ID } from "./railway-envs";
import { stepsOf } from "./__tests__/showcase-build-workflow";

const INDEX = `sha256:${"a".repeat(64)}`;
const PLATFORM = `sha256:${"b".repeat(64)}`;
const OLD = `sha256:${"c".repeat(64)}`;
const IMAGE = `${DOCS_GHCR_IMAGE}:${"d".repeat(40)}`;
const expected = { digests: [INDEX, PLATFORM] };
const node = (status = "SUCCESS", digest = PLATFORM) => ({
  id: "fresh-docs",
  serviceId: SERVICES.docs.serviceId,
  environmentId: STAGING_ENV_ID,
  status,
  meta: { imageDigest: digest },
});
const response = (deployment = node()) =>
  new Response(JSON.stringify({ data: { deployment } }));
const docsPages = new Map([
  [
    "https://docs.staging.copilotkit.ai/generative-ui/components",
    readFileSync(
      new URL(
        "../shell-docs/src/content/docs/generative-ui/components/index.mdx",
        import.meta.url,
      ),
      "utf8",
    ),
  ],
  [
    "https://docs.staging.copilotkit.ai/generative-ui/components/standard-catalog",
    readFileSync(
      new URL(
        "../shell-docs/src/content/docs/generative-ui/components/standard-catalog.mdx",
        import.meta.url,
      ),
      "utf8",
    ),
  ],
]);

afterEach(() => vi.restoreAllMocks());

describe("readExpectedDocsImage", () => {
  function inspector(latest = INDEX) {
    return vi.fn((ref: string, format: "digest" | "manifest") => {
      if (format === "digest") return ref.endsWith(":latest") ? latest : INDEX;
      return JSON.stringify({
        schemaVersion: 2,
        manifests: [
          {
            digest: PLATFORM,
            platform: { os: "linux", architecture: "amd64" },
          },
          { digest: OLD, platform: { os: "unknown", architecture: "unknown" } },
        ],
      });
    });
  }

  it("binds verification to the commit image and its amd64 manifest, excluding attestations", () => {
    const inspect = inspector();
    expect(readExpectedDocsImage(IMAGE, inspect)).toEqual(expected);
    expect(inspect).toHaveBeenCalledWith(
      `${DOCS_GHCR_IMAGE}@${INDEX}`,
      "manifest",
    );
  });

  it("refuses a superseded build before creating a deployment", () => {
    expect(() => readExpectedDocsImage(IMAGE, inspector(OLD))).toThrow(
      /latest.*this build/,
    );
  });

  it("rejects mutable or unrelated expected image references", () => {
    const inspect = inspector();
    for (const ref of [
      `${DOCS_GHCR_IMAGE}:latest`,
      "ghcr.io/other/image:main",
      "",
    ]) {
      expect(() => readExpectedDocsImage(ref, inspect)).toThrow(/commit image/);
    }
    expect(inspect).not.toHaveBeenCalled();
  });

  it("rejects an image index without a usable amd64 manifest", () => {
    expect(() =>
      readExpectedDocsImage(IMAGE, (_ref, format) =>
        format === "digest"
          ? INDEX
          : JSON.stringify({ schemaVersion: 2, manifests: [] }),
      ),
    ).toThrow(/amd64/);
  });
});

describe("verifyDocsDeployment", () => {
  function fetcher(deployment = node()) {
    return vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (String(url).includes("graphql")) return response(deployment);
      const content = docsPages.get(String(url));
      if (!content) throw new Error(`Unexpected docs request: ${url}`);
      return new Response(content);
    });
  }

  it("rejects SUCCESS on the previous image even when the site could return 200", async () => {
    const fetchImpl = fetcher(node("SUCCESS", OLD));
    await expect(
      verifyDocsDeployment("test-token", "fresh-docs", expected, { fetchImpl }),
    ).rejects.toThrow(/image digest/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([INDEX, PLATFORM])(
    "accepts the expected index or platform digest (%s) and checks both routes",
    async (digest) => {
      const fetchImpl = fetcher(node("SUCCESS", digest));
      await expect(
        verifyDocsDeployment("test-token", "fresh-docs", expected, {
          fetchImpl,
        }),
      ).resolves.toEqual({ imageDigest: digest });
      const urls = fetchImpl.mock.calls.map(([url]) => String(url));
      expect(urls.slice(1)).toEqual([
        "https://docs.staging.copilotkit.ai/generative-ui/components",
        "https://docs.staging.copilotkit.ai/generative-ui/components/standard-catalog",
      ]);
      const request = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
      expect(request.variables).toEqual({ id: "fresh-docs" });
      expect(request.query).toContain("deployment(id:");
      expect(request.query).not.toContain("deployments(");
      for (const [, init] of fetchImpl.mock.calls)
        expect(init?.signal).toBeInstanceOf(AbortSignal);
    },
  );

  it.each(["FAILED", "CRASHED", "REMOVED"])(
    "fails immediately on %s",
    async (status) => {
      const fetchImpl = fetcher(node(status));
      await expect(
        verifyDocsDeployment("test-token", "fresh-docs", expected, {
          fetchImpl,
        }),
      ).rejects.toThrow(status);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  it("waits for this deployment to reach SUCCESS", async () => {
    const fetchImpl = fetcher();
    fetchImpl.mockResolvedValueOnce(response(node("DEPLOYING")));
    const sleep = vi.fn(async () => {});
    await verifyDocsDeployment("test-token", "fresh-docs", expected, {
      fetchImpl,
      sleep,
    });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("bounds the wait for an in-progress deployment", async () => {
    const fetchImpl = fetcher(node("DEPLOYING"));
    let clock = 0;
    await expect(
      verifyDocsDeployment("test-token", "fresh-docs", expected, {
        fetchImpl,
        now: () => clock,
        timeoutMs: 10,
        sleep: async () => {
          clock += 10;
        },
      }),
    ).rejects.toThrow(/timed out/);
  });

  it.each(["id", "serviceId", "environmentId"])(
    "rejects a deployment with the wrong %s",
    async (field) => {
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValue(response({ ...node(), [field]: "wrong" }));
      await expect(
        verifyDocsDeployment("test-token", "fresh-docs", expected, {
          fetchImpl,
        }),
      ).rejects.toThrow(/identity/);
    },
  );

  it("rejects a GraphQL error even with HTTP 200", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ errors: [{ message: "denied" }] })),
      );
    await expect(
      verifyDocsDeployment("test-token", "fresh-docs", expected, { fetchImpl }),
    ).rejects.toThrow(/GraphQL/);
  });

  it.each([404, 500])(
    "rejects a missing or broken GenUI route (%s)",
    async (status) => {
      const fetchImpl = fetcher();
      fetchImpl
        .mockResolvedValueOnce(response())
        .mockResolvedValueOnce(new Response("Page not found", { status }));
      await expect(
        verifyDocsDeployment("test-token", "fresh-docs", expected, {
          fetchImpl,
        }),
      ).rejects.toThrow(/generative-ui\/components.*HTTP/);
    },
  );

  it("rejects a soft 404 or unrelated 200 page", async () => {
    const fetchImpl = fetcher();
    fetchImpl
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(new Response("<html>Page not found</html>"));
    await expect(
      verifyDocsDeployment("test-token", "fresh-docs", expected, { fetchImpl }),
    ).rejects.toThrow(/expected content/);
  });

  it("rejects catalog content served at the overview URL even though both use standardUI", async () => {
    const fetchImpl = fetcher();
    fetchImpl
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(
        new Response(
          docsPages.get(
            "https://docs.staging.copilotkit.ai/generative-ui/components/standard-catalog",
          ),
        ),
      );
    await expect(
      verifyDocsDeployment("test-token", "fresh-docs", expected, { fetchImpl }),
    ).rejects.toThrow(/generative-ui\/components.*expected content/);
  });
});

it("wires the exact built docs commit image into staging deployment verification", () => {
  const step = stepsOf("redeploy-staging").find(
    (s) => s.name === "Redeploy changed services in staging",
  );
  expect(step?.env?.DOCS_EXPECTED_IMAGE).toBe(
    "ghcr.io/copilotkit/showcase-shell-docs:${{ github.sha }}",
  );
  const upload = stepsOf("redeploy-staging").find(
    (s) => s.name === "Upload redeploy summary",
  );
  expect(upload?.if).toBe(
    "${{ !cancelled() && steps.changed.outputs.services != '' }}",
  );
  expect(upload?.with?.["if-no-files-found"]).toBe("error");
});
