import { describe, it, expect } from "vitest";
import { livenessProbe } from "./liveness.js";
import { logger } from "../logger.js";
import type { ProbeContext } from "../types/index.js";

const ctx: ProbeContext = {
  now: () => new Date("2026-04-20T00:00:00Z"),
  logger,
  env: {},
};

function fakeFetch(status: number, okBody = ""): typeof fetch {
  return (async () =>
    new Response(okBody, {
      status,
      statusText: `HTTP ${status}`,
    })) as unknown as typeof fetch;
}

describe("smoke probe", () => {
  it("returns green on 200", async () => {
    const r = await livenessProbe.run(
      { slug: "mastra", url: "https://x/api/smoke", fetchImpl: fakeFetch(200) },
      ctx,
    );
    expect(r.state).toBe("green");
    expect(r.key).toBe("smoke:mastra");
    expect(r.signal.status).toBe(200);
    expect(r.signal.links.smoke).toBe("https://x/api/smoke");
    expect(r.signal.links.health).toBe("https://x/api/health");
  });

  it("returns red on 5xx with errorDesc", async () => {
    const r = await livenessProbe.run(
      { slug: "mastra", url: "https://x/api/smoke", fetchImpl: fakeFetch(503) },
      ctx,
    );
    expect(r.state).toBe("red");
    expect(r.signal.errorDesc).toBe("http 503");
  });

  it("returns red on fetch throw", async () => {
    const fetchImpl: typeof fetch = (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    const r = await livenessProbe.run(
      { slug: "mastra", url: "https://x/api/smoke", fetchImpl },
      ctx,
    );
    expect(r.state).toBe("red");
    expect(r.signal.errorDesc).toContain("ECONNRESET");
  });

  it("derives health URL from /smoke with trailing slash (/smoke/)", async () => {
    const r = await livenessProbe.run(
      {
        slug: "mastra",
        url: "https://x/api/smoke/",
        fetchImpl: fakeFetch(200),
      },
      ctx,
    );
    expect(r.signal.links.health).toBe("https://x/api/health");
  });

  it("derives health URL by appending /health when URL has no /smoke suffix", async () => {
    const r = await livenessProbe.run(
      { slug: "mastra", url: "https://x/", fetchImpl: fakeFetch(200) },
      ctx,
    );
    expect(r.signal.links.health).toBe("https://x/health");
  });

  it("differentiates our own timeout abort from generic fetch errors", async () => {
    // Regression: post-timeout the AbortController rejects with DOMException
    // "This operation was aborted" — indistinguishable from an externally
    // triggered cancellation. Surface as `timeout after Nms` so operators
    // can tell "probe gave up" from "network error".
    const fetchImpl: typeof fetch = (async (
      _url: string,
      init: { signal: AbortSignal },
    ) => {
      // Wait until the controller aborts, then reject like the real fetch.
      await new Promise<void>((_, reject) => {
        init.signal.addEventListener("abort", () => {
          const e = new Error("This operation was aborted");
          e.name = "AbortError";
          reject(e);
        });
      });
    }) as unknown as typeof fetch;

    const r = await livenessProbe.run(
      {
        slug: "mastra",
        url: "https://x/api/smoke",
        fetchImpl,
        timeoutMs: 5,
      },
      ctx,
    );
    expect(r.state).toBe("red");
    expect(r.signal.errorDesc).toBe("timeout after 5ms");
  });

  it("returns empty health URL when smoke URL is unparseable", async () => {
    const r = await livenessProbe.run(
      { slug: "mastra", url: "not a url", fetchImpl: fakeFetch(200) },
      ctx,
    );
    // Templates are expected to guard on empty string rather than link
    // to a misleading smoke URL.
    expect(r.signal.links.health).toBe("");
  });
});
