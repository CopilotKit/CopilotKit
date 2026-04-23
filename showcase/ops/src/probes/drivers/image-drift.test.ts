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

  it("inputSchema requires key + name + imageRef", () => {
    expect(
      imageDriftDriver.inputSchema.safeParse({
        key: "image_drift:showcase-a",
        name: "showcase-a",
        imageRef: "ghcr.io/copilotkit/showcase-a:latest",
      }).success,
    ).toBe(true);
  });

  it("inputSchema rejects missing name", () => {
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
      name: "showcase-a",
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
      name: "showcase-a",
      imageRef: `ghcr.io/copilotkit/showcase-a@${CURRENT_DIGEST}`,
    });
    expect(r.state).toBe("red");
    // Success variant — narrowed by checking the success-only field.
    if ("errorDesc" in r.signal) {
      throw new Error("expected success-variant signal");
    }
    expect(r.signal.service).toBe("showcase-a");
    expect(r.signal.isStale).toBe(true);
    expect(r.signal.currentImage).toBe(CURRENT_DIGEST);
    expect(r.signal.expectedImage).toBe(LATEST_DIGEST);
  });

  it("returns red with errorDesc on GHCR 404 (tag doesn't exist)", async () => {
    const { fetchImpl } = scriptedFetch([
      { status: 404, body: { errors: [{ message: "not found" }] } },
    ]);
    const { logger: captured, warnCalls } = captureLogger();
    const ctx = makeCtx(fetchImpl, captured);
    const r = await imageDriftDriver.run(ctx, {
      key: "image_drift:showcase-a",
      name: "showcase-a",
      imageRef: "ghcr.io/copilotkit/showcase-a:latest",
    });
    expect(r.state).toBe("red");
    if (!("errorDesc" in r.signal)) {
      throw new Error("expected error-variant signal");
    }
    expect(r.signal.errorDesc).toBeTypeOf("string");
    expect(r.signal.errorDesc).toMatch(/404|not found/i);
    expect(warnCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("returns red with errorDesc on GHCR auth fail (401)", async () => {
    const { fetchImpl } = scriptedFetch([
      { status: 401, body: { errors: [{ message: "unauthenticated" }] } },
    ]);
    const ctx = makeCtx(fetchImpl);
    const r = await imageDriftDriver.run(ctx, {
      key: "image_drift:showcase-a",
      name: "showcase-a",
      imageRef: "ghcr.io/copilotkit/showcase-a:latest",
    });
    expect(r.state).toBe("red");
    if (!("errorDesc" in r.signal)) {
      throw new Error("expected error-variant signal");
    }
    expect(r.signal.errorDesc).toMatch(/401|auth/i);
  });

  it("returns error state when fetch throws (can't reach GHCR)", async () => {
    const err = new Error("getaddrinfo ENOTFOUND ghcr.io");
    const { fetchImpl } = scriptedFetch([{ status: 0, throws: err }]);
    const ctx = makeCtx(fetchImpl);
    const r = await imageDriftDriver.run(ctx, {
      key: "image_drift:showcase-a",
      name: "showcase-a",
      imageRef: "ghcr.io/copilotkit/showcase-a:latest",
    });
    // Transport fail is treated as error (distinct from red/stale) so
    // the alert engine can suppress noisy DNS blips separately from real
    // drift.
    expect(r.state).toBe("error");
    if (!("errorDesc" in r.signal)) {
      throw new Error("expected error-variant signal");
    }
    expect(r.signal.errorDesc).toMatch(/ENOTFOUND|fetch/i);
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
      name: "showcase-a",
      imageRef: "ghcr.io/copilotkit/showcase-a:stable",
    });
    // Resolved URL must hit the `stable` manifest path.
    expect(urls[0]).toContain("/showcase-a/manifests/stable");
  });

  it("returns red with errorDesc on GHCR 500 (generic non-ok)", async () => {
    const { fetchImpl } = scriptedFetch([
      { status: 500, body: { errors: [{ message: "server fault" }] } },
    ]);
    const ctx = makeCtx(fetchImpl);
    const r = await imageDriftDriver.run(ctx, {
      key: "image_drift:showcase-a",
      name: "showcase-a",
      imageRef: "ghcr.io/copilotkit/showcase-a:latest",
    });
    expect(r.state).toBe("red");
    if (!("errorDesc" in r.signal)) {
      throw new Error("expected error-variant signal");
    }
    expect(r.signal.errorDesc).toMatch(/500/);
  });

  it("returns red with errorDesc when GHCR response omits docker-content-digest header", async () => {
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
      name: "showcase-a",
      imageRef: "ghcr.io/copilotkit/showcase-a:latest",
    });
    expect(r.state).toBe("red");
    if (!("errorDesc" in r.signal)) {
      throw new Error("expected error-variant signal");
    }
    expect(r.signal.errorDesc).toMatch(/docker-content-digest/);
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
        name: "showcase-a",
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
      name: "showcase-a",
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
      name: "showcase-a",
      imageRef: `ghcr.io/copilotkit/showcase-a@${LATEST_DIGEST}`,
    });
    expect(seenAuth).toBe("Bearer ghp_test");
  });

  it("flips red with empty currentImage when imageRef has no digest (success variant)", async () => {
    // Edge case: Railway serviceInstance missing a digest in source.image
    // (older Railway payloads). GHCR lookup succeeds, so this stays on the
    // success variant with currentImage="" and isStale=false; state red
    // because the local ref lacks a digest to pin against.
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
      name: "showcase-a",
      imageRef: "ghcr.io/copilotkit/showcase-a:latest",
    });
    expect(r.state).toBe("red");
    if ("errorDesc" in r.signal) {
      throw new Error("expected success-variant signal");
    }
    expect(r.signal.currentImage).toBe("");
    expect(r.signal.isStale).toBe(false);
  });

  it("uses deployedDigest as currentImage when imageRef lacks a digest", async () => {
    // This is the core fix: Railway stores tag-only refs like
    // `ghcr.io/copilotkit/showcase-a:latest` in source.image, so
    // parsed.digest is always null. The discovery layer now surfaces
    // `latestDeployment.meta.imageDigest` as `deployedDigest`, and the
    // driver must prefer it over the parsed (empty) digest.
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
      name: "showcase-a",
      imageRef: "ghcr.io/copilotkit/showcase-a:latest",
      deployedDigest: LATEST_DIGEST,
    });
    expect(r.state).toBe("green");
    if ("errorDesc" in r.signal) {
      throw new Error("expected success-variant signal");
    }
    expect(r.signal.currentImage).toBe(LATEST_DIGEST);
    expect(r.signal.isStale).toBe(false);
  });

  it("returns red+stale when deployedDigest differs from GHCR digest", async () => {
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
      name: "showcase-a",
      imageRef: "ghcr.io/copilotkit/showcase-a:latest",
      deployedDigest: CURRENT_DIGEST,
    });
    expect(r.state).toBe("red");
    if ("errorDesc" in r.signal) {
      throw new Error("expected success-variant signal");
    }
    expect(r.signal.currentImage).toBe(CURRENT_DIGEST);
    expect(r.signal.expectedImage).toBe(LATEST_DIGEST);
    expect(r.signal.isStale).toBe(true);
  });

  it("prefers parsed digest from imageRef over deployedDigest when both exist", async () => {
    // When imageRef has `@sha256:...`, the parsed digest wins. This
    // preserves backward compat for any future case where Railway pins
    // by digest in source.image.
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
      name: "showcase-a",
      imageRef: `ghcr.io/copilotkit/showcase-a@${LATEST_DIGEST}`,
      deployedDigest: CURRENT_DIGEST,
    });
    // parsed.digest = LATEST_DIGEST wins over deployedDigest = CURRENT_DIGEST
    expect(r.state).toBe("green");
    if ("errorDesc" in r.signal) {
      throw new Error("expected success-variant signal");
    }
    expect(r.signal.currentImage).toBe(LATEST_DIGEST);
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
      name: "showcase-a",
      imageRef: "ghcr.io/copilotkit/showcase-a:latest",
      expectedTag: "stable",
    });
    expect(urls[0]).toContain("/showcase-a/manifests/stable");
  });

  it("threads ctx.abortSignal into the GHCR fetch so invoker timeout aborts in-flight", async () => {
    // Regression guard for CR A1: previously the driver called fetchImpl
    // without forwarding the invoker's AbortController signal, so a hung
    // GHCR response kept its socket open past the synthetic-timeout
    // ProbeResult. This test stubs fetchImpl to observe the signal arg
    // and asserts that the signal arrives both pre-abort and post-abort
    // (mutated in place).
    let capturedSignal: AbortSignal | undefined;
    const fetchImpl: typeof fetch = async (_url, init) => {
      capturedSignal = (init as RequestInit | undefined)?.signal ?? undefined;
      // If the signal is already aborted at fetch time, reject with the
      // real AbortError that undici raises so the driver's catch path
      // exercises the "transport failed" branch.
      if (capturedSignal?.aborted) {
        throw new DOMException("The operation was aborted", "AbortError");
      }
      return new Response("{}", {
        status: 200,
        headers: { "docker-content-digest": LATEST_DIGEST },
      });
    };
    const controller = new AbortController();
    const ctx: ProbeContext = {
      now: () => new Date("2026-04-20T00:00:00Z"),
      logger,
      env: {},
      fetchImpl,
      abortSignal: controller.signal,
    };
    await imageDriftDriver.run(ctx, {
      key: "image_drift:showcase-a",
      name: "showcase-a",
      imageRef: `ghcr.io/copilotkit/showcase-a:latest@${CURRENT_DIGEST}`,
    });
    expect(capturedSignal).toBe(controller.signal);
    expect(capturedSignal?.aborted).toBe(false);

    // Second invocation: abort BEFORE the fetch runs, so the driver's
    // transport-error branch fires with the AbortError.
    controller.abort();
    const result = await imageDriftDriver.run(ctx, {
      key: "image_drift:showcase-a",
      name: "showcase-a",
      imageRef: `ghcr.io/copilotkit/showcase-a:latest@${CURRENT_DIGEST}`,
    });
    expect(result.state).toBe("error");
    expect((result.signal as { errorDesc: string }).errorDesc).toMatch(
      /aborted/i,
    );
  });
});
