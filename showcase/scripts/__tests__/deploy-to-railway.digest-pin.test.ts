/**
 * Tests for the prod digest-pinning logic in `deploy-to-railway.ts`.
 *
 * Contract under test: a freshly provisioned PROD showcase service must be
 * born pinned to a content digest (`ghcr.io/copilotkit/showcase-<slug>@sha256:...`),
 * NEVER the mutable `:latest` tag. Staging floats `:latest` by design and is
 * provisioned by a different script — not exercised here.
 *
 * Style note (mirrors provision-starter-fleet / redeploy-env tests): GHCR is
 * the only impure surface and is dependency-injected as a `GhcrHttp`. We use a
 * plain recording mock — GHCR is an external registry boundary, not an LLM, so
 * aimock does not apply. No real network I/O.
 */

import { describe, it, expect } from "vitest";
import {
  assertProdDigestPinned,
  buildProdImageRef,
  ProdPinError,
  resolveGhcrDigest,
} from "../deploy-to-railway";
import type {
  GhcrHttp,
  GhcrHttpResponse,
  ProdInstanceQueryFn,
} from "../deploy-to-railway";

const DIGEST = "sha256:" + "a".repeat(64);

/**
 * Build a GhcrHttp mock. `manifestStatus` controls the HEAD on
 * /manifests/<tag>; `digestHeader` controls the Docker-Content-Digest header
 * returned on a 2xx. The /token GET always succeeds with a dummy bearer
 * unless `tokenStatus` overrides it.
 */
function makeGhcrHttp(opts: {
  manifestStatus?: number;
  digestHeader?: string | null;
  tokenStatus?: number;
}): { http: GhcrHttp; calls: { method: string; url: string }[] } {
  const calls: { method: string; url: string }[] = [];
  const http: GhcrHttp = {
    async get(url): Promise<GhcrHttpResponse> {
      calls.push({ method: "GET", url });
      const status = opts.tokenStatus ?? 200;
      return {
        status,
        headers: {},
        body: status < 400 ? JSON.stringify({ token: "dummy-bearer" }) : "",
      };
    },
    async head(url): Promise<GhcrHttpResponse> {
      calls.push({ method: "HEAD", url });
      const status = opts.manifestStatus ?? 200;
      const headers: Record<string, string> = {};
      const dh = opts.digestHeader === undefined ? DIGEST : opts.digestHeader;
      if (status < 400 && dh) headers["docker-content-digest"] = dh;
      return { status, headers, body: "" };
    },
  };
  return { http, calls };
}

describe("resolveGhcrDigest", () => {
  it("resolves :latest to its content digest via a manifest HEAD", async () => {
    const { http, calls } = makeGhcrHttp({});
    const digest = await resolveGhcrDigest(
      "showcase-mastra",
      "latest",
      http,
      "pat",
    );
    expect(digest).toBe(DIGEST);
    // Mirrors the Ruby CLI: a /token exchange GET precedes the manifest HEAD.
    expect(calls[0]).toMatchObject({ method: "GET" });
    expect(calls[0].url).toContain("/token");
    expect(calls[1]).toMatchObject({ method: "HEAD" });
    expect(calls[1].url).toContain(
      "/v2/copilotkit/showcase-mastra/manifests/latest",
    );
  });

  it("throws (fail-loud) when the tag does not exist (404) — no fallback", async () => {
    const { http } = makeGhcrHttp({ manifestStatus: 404 });
    await expect(
      resolveGhcrDigest("showcase-mastra", "latest", http, "pat"),
    ).rejects.toThrow(/404/);
  });

  it("throws when GHCR returns a 2xx but no Docker-Content-Digest header", async () => {
    const { http } = makeGhcrHttp({ digestHeader: null });
    await expect(
      resolveGhcrDigest("showcase-mastra", "latest", http, "pat"),
    ).rejects.toThrow(/Docker-Content-Digest/);
  });

  it("throws when a supplied token fails the /token exchange (no silent anon downgrade)", async () => {
    const { http } = makeGhcrHttp({ tokenStatus: 403 });
    await expect(
      resolveGhcrDigest("showcase-mastra", "latest", http, "pat"),
    ).rejects.toThrow(/token exchange failed/);
  });
});

describe("buildProdImageRef", () => {
  it("produces a digest-pinned prod image ref (@sha256:...), NOT the :latest tag", async () => {
    const ref = await buildProdImageRef("mastra", async () => DIGEST);
    // The core contract: prod is born pinned, never tracking the mutable tag.
    expect(ref).toBe(`ghcr.io/copilotkit/showcase-mastra@${DIGEST}`);
    expect(ref).toMatch(/@sha256:[0-9a-f]{64}$/);
    expect(ref).not.toContain(":latest");
  });

  it("fails loud when digest resolution rejects — does NOT fall back to :latest", async () => {
    await expect(
      buildProdImageRef("mastra", async () => {
        throw new Error("GHCR manifest HEAD 404");
      }),
    ).rejects.toThrow(/404/);
  });

  it("rejects a malformed digest rather than pinning prod to it", async () => {
    await expect(
      buildProdImageRef("mastra", async () => "sha256:not-a-real-digest"),
    ).rejects.toThrow(/malformed digest/);
  });

  it("end-to-end through resolveGhcrDigest yields a pinned ref, never the tag", async () => {
    const { http } = makeGhcrHttp({});
    const ref = await buildProdImageRef("mastra", (name) =>
      resolveGhcrDigest(name, "latest", http, "pat"),
    );
    expect(ref).toBe(`ghcr.io/copilotkit/showcase-mastra@${DIGEST}`);
    expect(ref).not.toContain(":latest");
  });
});

/**
 * Build a fake `ProdInstanceQueryFn` that returns a single showcase service
 * whose PROD serviceInstance carries `image` as its `source.image`. `image:
 * null` simulates a service with no configured image source. `serviceName`
 * and `envId` default to a matching service in the production env so the
 * tests exercise the digest-shape branch rather than the lookup branches.
 * `envId` is the `environmentId` the fake serviceInstance is reported under;
 * supply a value that differs from the env `assertProdDigestPinned` is asked
 * to verify (its 2nd arg) to drive the env-mismatch lookup branch.
 */
function makeProdInstanceQuery(opts: {
  image: string | null;
  serviceName?: string;
  envId?: string;
}): ProdInstanceQueryFn {
  const serviceName = opts.serviceName ?? "showcase-mastra";
  const instanceEnv = opts.envId ?? "prod-env";
  return async () => ({
    project: {
      services: {
        edges: [
          {
            node: {
              name: serviceName,
              serviceInstances: {
                edges: [
                  {
                    node: {
                      environmentId: instanceEnv,
                      source:
                        opts.image === null ? null : { image: opts.image },
                    },
                  },
                ],
              },
            },
          },
        ],
      },
    },
  });
}

describe("assertProdDigestPinned", () => {
  const PINNED = `ghcr.io/copilotkit/showcase-mastra@${DIGEST}`;

  it("ACCEPTS a valid ghcr.io/copilotkit/<name>@sha256:<64hex> ref", async () => {
    const query = makeProdInstanceQuery({ image: PINNED });
    await expect(
      assertProdDigestPinned("showcase-mastra", "prod-env", query),
    ).resolves.toBeUndefined();
  });

  it("REJECTS a :latest tag ref (mutable, unpinned)", async () => {
    const query = makeProdInstanceQuery({
      image: "ghcr.io/copilotkit/showcase-mastra:latest",
    });
    await expect(
      assertProdDigestPinned("showcase-mastra", "prod-env", query),
    ).rejects.toBeInstanceOf(ProdPinError);
    await expect(
      assertProdDigestPinned("showcase-mastra", "prod-env", query),
    ).rejects.toThrow(/not digest-pinned/);
  });

  it("REJECTS an empty/missing source.image", async () => {
    const query = makeProdInstanceQuery({ image: null });
    await expect(
      assertProdDigestPinned("showcase-mastra", "prod-env", query),
    ).rejects.toBeInstanceOf(ProdPinError);
    await expect(
      assertProdDigestPinned("showcase-mastra", "prod-env", query),
    ).rejects.toThrow(/no production image source/);
  });

  it("REJECTS an empty-string source.image", async () => {
    const query = makeProdInstanceQuery({ image: "" });
    await expect(
      assertProdDigestPinned("showcase-mastra", "prod-env", query),
    ).rejects.toBeInstanceOf(ProdPinError);
    await expect(
      assertProdDigestPinned("showcase-mastra", "prod-env", query),
    ).rejects.toThrow(/no production image source/);
  });

  it("REJECTS when the service is not found in the project", async () => {
    const query = makeProdInstanceQuery({
      image: PINNED,
      serviceName: "showcase-other",
    });
    await expect(
      assertProdDigestPinned("showcase-mastra", "prod-env", query),
    ).rejects.toBeInstanceOf(ProdPinError);
    await expect(
      assertProdDigestPinned("showcase-mastra", "prod-env", query),
    ).rejects.toThrow(/not found/);
  });

  it("REJECTS when the service exists but its instance is in a different env", async () => {
    // Service IS found, but its only serviceInstance is reported under
    // `other-env` while the caller asks to verify `prod-env`. The env-match
    // `.find(...)` returns undefined, so no image resolves and the guard throws.
    const query = makeProdInstanceQuery({ image: PINNED, envId: "other-env" });
    await expect(
      assertProdDigestPinned("showcase-mastra", "prod-env", query),
    ).rejects.toBeInstanceOf(ProdPinError);
    await expect(
      assertProdDigestPinned("showcase-mastra", "prod-env", query),
    ).rejects.toThrow(/no production image source/);
  });
});
