import { describe, it, expect } from "vitest";
import { imageDriftDriver } from "./image-drift.js";
import { logger } from "../../logger.js";
import type { Logger, ProbeContext } from "../../types/index.js";

// Driver-level tests — the per-service digest comparison matrix lives on
// the legacy `imageDriftProbe` in ../image-drift.test.ts. This file covers
// the driver adapter: single-service invocation, GHCR manifest fetch, and
// the {stale, fresh, 404, auth-fail, transport-fail} matrix each as its
// own ProbeResult.

function captureLogger(): {
  logger: Logger;
  warnCalls: { msg: string; meta?: Record<string, unknown> }[];
  errorCalls: { msg: string; meta?: Record<string, unknown> }[];
} {
  const warnCalls: { msg: string; meta?: Record<string, unknown> }[] = [];
  const errorCalls: { msg: string; meta?: Record<string, unknown> }[] = [];
  const captured: Logger = {
    debug: () => {},
    info: () => {},
    warn: (msg, meta) => warnCalls.push({ msg, meta }),
    error: (msg, meta) => errorCalls.push({ msg, meta }),
  };
  return { logger: captured, warnCalls, errorCalls };
}

interface ResponseSpec {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  throws?: Error;
}

function scriptedFetch(queue: ResponseSpec[]): {
  fetchImpl: typeof fetch;
  urls: string[];
} {
  const urls: string[] = [];
  let idx = 0;
  const fetchImpl: typeof fetch = async (url) => {
    urls.push(typeof url === "string" ? url : url.toString());
    const entry = queue[idx++];
    if (!entry) throw new Error(`scriptedFetch: queue exhausted`);
    if (entry.throws) throw entry.throws;
    const body =
      typeof entry.body === "string"
        ? entry.body
        : JSON.stringify(entry.body ?? {});
    return new Response(body, {
      status: entry.status,
      headers: entry.headers ?? { "content-type": "application/json" },
    });
  };
  return { fetchImpl, urls };
}

function makeCtx(
  fetchImpl: typeof fetch,
  loggerOverride?: Logger,
  envOverride?: Record<string, string | undefined>,
): ProbeContext & { fetchImpl: typeof fetch } {
  return {
    now: () => new Date("2026-04-20T00:00:00Z"),
    logger: loggerOverride ?? logger,
    env: envOverride ?? {},
    fetchImpl,
  } as ProbeContext & { fetchImpl: typeof fetch };
}

const CURRENT_DIGEST = "sha256:CURRENT";
const LATEST_DIGEST = "sha256:LATEST";

describe("imageDriftDriver", () => {
  it("exposes kind === 'image_drift'", () => {
    expect(imageDriftDriver.kind).toBe("image_drift");
  });

  it("inputSchema requires key + serviceName + imageRef", () => {
    expect(
      imageDriftDriver.inputSchema.safeParse({
        key: "image_drift:showcase-a",
        serviceName: "showcase-a",
        imageRef: "ghcr.io/copilotkit/showcase-a:latest",
      }).success,
    ).toBe(true);
  });

  it("inputSchema rejects missing serviceName", () => {
    const parsed = imageDriftDriver.inputSchema.safeParse({
      key: "image_drift:showcase-a",
      imageRef: "ghcr.io/copilotkit/showcase-a:latest",
    });
    expect(parsed.success).toBe(false);
  });

  it("returns green when GHCR digest matches deployed imageRef digest", async () => {
    // imageRef is `ghcr.io/copilotkit/showcase-a@sha256:CURRENT`; GHCR
    // returns the same digest → fresh.
    const { fetchImpl } = scriptedFetch([
      {
        status: 200,
        body: { schemaVersion: 2, config: { digest: LATEST_DIGEST } },
        headers: {
          "docker-content-digest": LATEST_DIGEST,
          "content-type": "application/vnd.oci.image.manifest.v1+json",
        },
      },
    ]);
    const ctx = makeCtx(fetchImpl);
    const r = await imageDriftDriver.run(ctx, {
      key: "image_drift:showcase-a",
      serviceName: "showcase-a",
      imageRef: `ghcr.io/copilotkit/showcase-a@${LATEST_DIGEST}`,
    });
    expect(r.state).toBe("green");
    expect(r.key).toBe("image_drift:showcase-a");
  });

  it("returns red when GHCR digest differs from deployed imageRef digest", async () => {
    const { fetchImpl } = scriptedFetch([
      {
        status: 200,
        body: {},
        headers: {
          "docker-content-digest": LATEST_DIGEST,
          "content-type": "application/vnd.oci.image.manifest.v1+json",
        },
      },
    ]);
    const ctx = makeCtx(fetchImpl);
    const r = await imageDriftDriver.run(ctx, {
      key: "image_drift:showcase-a",
      serviceName: "showcase-a",
      imageRef: `ghcr.io/copilotkit/showcase-a@${CURRENT_DIGEST}`,
    });
    expect(r.state).toBe("red");
    const sig = r.signal as {
      service: string;
      currentImage: string;
      expectedImage: string;
      isStale: boolean;
    };
    expect(sig.service).toBe("showcase-a");
    expect(sig.isStale).toBe(true);
    expect(sig.currentImage).toBe(CURRENT_DIGEST);
    expect(sig.expectedImage).toBe(LATEST_DIGEST);
  });

  it("returns red with errorDesc on GHCR 404 (tag doesn't exist)", async () => {
    const { fetchImpl } = scriptedFetch([
      { status: 404, body: { errors: [{ message: "not found" }] } },
    ]);
    const { logger: captured, warnCalls } = captureLogger();
    const ctx = makeCtx(fetchImpl, captured);
    const r = await imageDriftDriver.run(ctx, {
      key: "image_drift:showcase-a",
      serviceName: "showcase-a",
      imageRef: "ghcr.io/copilotkit/showcase-a:latest",
    });
    expect(r.state).toBe("red");
    const sig = r.signal as { rebuildError?: string };
    expect(sig.rebuildError).toBeTypeOf("string");
    expect(sig.rebuildError).toMatch(/404|not found/i);
    expect(warnCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("returns red with errorDesc on GHCR auth fail (401)", async () => {
    const { fetchImpl } = scriptedFetch([
      { status: 401, body: { errors: [{ message: "unauthenticated" }] } },
    ]);
    const ctx = makeCtx(fetchImpl);
    const r = await imageDriftDriver.run(ctx, {
      key: "image_drift:showcase-a",
      serviceName: "showcase-a",
      imageRef: "ghcr.io/copilotkit/showcase-a:latest",
    });
    expect(r.state).toBe("red");
    const sig = r.signal as { rebuildError?: string };
    expect(sig.rebuildError).toMatch(/401|auth/i);
  });

  it("returns error state when fetch throws (can't reach GHCR)", async () => {
    const err = new Error("getaddrinfo ENOTFOUND ghcr.io");
    const { fetchImpl } = scriptedFetch([{ status: 0, throws: err }]);
    const ctx = makeCtx(fetchImpl);
    const r = await imageDriftDriver.run(ctx, {
      key: "image_drift:showcase-a",
      serviceName: "showcase-a",
      imageRef: "ghcr.io/copilotkit/showcase-a:latest",
    });
    // Transport fail is treated as error (distinct from red/stale) so
    // the alert engine can suppress noisy DNS blips separately from real
    // drift.
    expect(r.state).toBe("error");
    const sig = r.signal as { rebuildError?: string };
    expect(sig.rebuildError).toMatch(/ENOTFOUND|fetch/i);
  });

  it("uses the tag from the imageRef when looking up the expected digest", async () => {
    const { fetchImpl, urls } = scriptedFetch([
      {
        status: 200,
        body: {},
        headers: { "docker-content-digest": LATEST_DIGEST },
      },
    ]);
    const ctx = makeCtx(fetchImpl);
    await imageDriftDriver.run(ctx, {
      key: "image_drift:showcase-a",
      serviceName: "showcase-a",
      imageRef: "ghcr.io/copilotkit/showcase-a:stable",
    });
    // Resolved URL must hit the `stable` manifest path.
    expect(urls[0]).toContain("/showcase-a/manifests/stable");
  });

  it("returns red with rebuildError on GHCR 500 (generic non-ok)", async () => {
    const { fetchImpl } = scriptedFetch([
      { status: 500, body: { errors: [{ message: "server fault" }] } },
    ]);
    const ctx = makeCtx(fetchImpl);
    const r = await imageDriftDriver.run(ctx, {
      key: "image_drift:showcase-a",
      serviceName: "showcase-a",
      imageRef: "ghcr.io/copilotkit/showcase-a:latest",
    });
    expect(r.state).toBe("red");
    const sig = r.signal as { rebuildError?: string };
    expect(sig.rebuildError).toMatch(/500/);
  });

  it("returns red with rebuildError when GHCR response omits docker-content-digest header", async () => {
    // Defensive path: some proxy layers strip headers. Without this guard
    // we'd happily compare `""` against `imageRef`'s digest and flip every
    // service red silently. Covering this prevents a regression back to
    // that silent-fail path.
    const { fetchImpl } = scriptedFetch([
      {
        status: 200,
        body: {},
        headers: { "content-type": "application/json" },
      },
    ]);
    const ctx = makeCtx(fetchImpl);
    const r = await imageDriftDriver.run(ctx, {
      key: "image_drift:showcase-a",
      serviceName: "showcase-a",
      imageRef: "ghcr.io/copilotkit/showcase-a:latest",
    });
    expect(r.state).toBe("red");
    const sig = r.signal as { rebuildError?: string };
    expect(sig.rebuildError).toMatch(/docker-content-digest/);
  });

  it("falls back to globalThis.fetch when ctx.fetchImpl is undefined", async () => {
    // Not actually calling the real GHCR — just verifies that the driver
    // doesn't crash when ctx has no fetchImpl. We swap globalThis.fetch
    // for a stub that returns the expected digest, invoke without
    // fetchImpl on ctx, and restore.
    const original = globalThis.fetch;
    try {
      globalThis.fetch = (async () =>
        new Response("{}", {
          status: 200,
          headers: { "docker-content-digest": LATEST_DIGEST },
        })) as typeof fetch;
      const ctx: ProbeContext = {
        now: () => new Date("2026-04-20T00:00:00Z"),
        logger,
        env: {},
      };
      const r = await imageDriftDriver.run(ctx, {
        key: "image_drift:showcase-a",
        serviceName: "showcase-a",
        imageRef: `ghcr.io/copilotkit/showcase-a@${LATEST_DIGEST}`,
      });
      expect(r.state).toBe("green");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("parses digest-pinned imageRef (no tag) and falls back to 'latest' for GHCR lookup", async () => {
    const { fetchImpl, urls } = scriptedFetch([
      {
        status: 200,
        body: {},
        headers: { "docker-content-digest": LATEST_DIGEST },
      },
    ]);
    const ctx = makeCtx(fetchImpl);
    await imageDriftDriver.run(ctx, {
      key: "image_drift:showcase-a",
      serviceName: "showcase-a",
      imageRef: `ghcr.io/copilotkit/showcase-a@${LATEST_DIGEST}`,
    });
    expect(urls[0]).toContain("/showcase-a/manifests/latest");
  });

  it("attaches Authorization header when GHCR_TOKEN is present in env", async () => {
    let seenAuth: string | null | undefined;
    const fetchImpl: typeof fetch = async (_url, init) => {
      const headers = new Headers(init?.headers);
      seenAuth = headers.get("authorization");
      return new Response("{}", {
        status: 200,
        headers: { "docker-content-digest": LATEST_DIGEST },
      });
    };
    const ctx = makeCtx(fetchImpl, undefined, { GHCR_TOKEN: "ghp_test" });
    await imageDriftDriver.run(ctx, {
      key: "image_drift:showcase-a",
      serviceName: "showcase-a",
      imageRef: `ghcr.io/copilotkit/showcase-a@${LATEST_DIGEST}`,
    });
    expect(seenAuth).toBe("Bearer ghp_test");
  });

  it("flips red with empty expectedImage when currentImage is missing (imageRef has no digest)", async () => {
    // Edge case: Railway serviceInstance missing a digest in source.image
    // (older Railway payloads). currentImage resolves to "" and we must
    // flip red so the operator sees "no digest pinned on the deploy".
    const { fetchImpl } = scriptedFetch([
      {
        status: 200,
        body: {},
        headers: { "docker-content-digest": LATEST_DIGEST },
      },
    ]);
    const ctx = makeCtx(fetchImpl);
    const r = await imageDriftDriver.run(ctx, {
      key: "image_drift:showcase-a",
      serviceName: "showcase-a",
      imageRef: "ghcr.io/copilotkit/showcase-a:latest",
    });
    expect(r.state).toBe("red");
    const sig = r.signal as { currentImage: string; isStale: boolean };
    expect(sig.currentImage).toBe("");
    expect(sig.isStale).toBe(false);
  });

  it("supports explicit expectedTag override", async () => {
    const { fetchImpl, urls } = scriptedFetch([
      {
        status: 200,
        body: {},
        headers: { "docker-content-digest": LATEST_DIGEST },
      },
    ]);
    const ctx = makeCtx(fetchImpl);
    await imageDriftDriver.run(ctx, {
      key: "image_drift:showcase-a",
      serviceName: "showcase-a",
      imageRef: "ghcr.io/copilotkit/showcase-a:latest",
      expectedTag: "stable",
    });
    expect(urls[0]).toContain("/showcase-a/manifests/stable");
  });
});
