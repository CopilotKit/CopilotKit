import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { smokeDriver } from "./smoke.js";
import { logger } from "../../logger.js";
import type {
  ProbeContext,
  ProbeResult,
  ProbeResultWriter,
} from "../../types/index.js";

// Driver-level tests for the smoke ProbeDriver. Deep behavioural coverage of
// `deriveHealthUrl` + the legacy `smokeProbe.run` path lives in
// `../smoke.test.ts`; this file verifies the driver-adapter layer:
//   - schema accepts/rejects the expected YAML-static input shape
//   - primary return value (smoke tick) matches the canonical ProbeResult
//     shape per status code
//   - side-emission of the paired `health:<slug>` tick via ctx.writer
//   - timeout at the driver level resolves to `timeout after Nms`
//   - concurrency-safety across N parallel `run()` calls

function mkWriter(): {
  writer: ProbeResultWriter;
  writes: ProbeResult<unknown>[];
} {
  const writes: ProbeResult<unknown>[] = [];
  const writer: ProbeResultWriter = {
    async write(result) {
      writes.push(result);
      return undefined;
    },
  };
  return { writer, writes };
}

function mkCtx(writer?: ProbeResultWriter): ProbeContext {
  return {
    now: () => new Date("2026-04-22T00:00:00Z"),
    logger,
    env: {},
    writer,
  };
}

/**
 * Response builder that returns a *fresh* Response per call. Each
 * `globalThis.fetch` invocation consumes one body clone, so reusing a
 * single Response instance across multiple fake-fetch calls fails the
 * second `.text()` read with "Body has already been consumed".
 */
function responseFor(url: string, opts: {
  smokeStatus?: number;
  healthStatus?: number;
  smokeBody?: string;
  healthBody?: string;
}): Response {
  const isHealth = /\/health(\b|\/|\?|$)/.test(url);
  const status = isHealth
    ? (opts.healthStatus ?? 200)
    : (opts.smokeStatus ?? 200);
  const body = isHealth
    ? (opts.healthBody ?? '{"status":"ok"}')
    : (opts.smokeBody ?? '{"status":"ok"}');
  return new Response(body, {
    status,
    statusText: `HTTP ${status}`,
  });
}

/** Fake-fetch factory: answer smoke/health differently per test case. */
function fakeFetch(opts: {
  smokeStatus?: number;
  healthStatus?: number;
  smokeBody?: string;
  healthBody?: string;
}): typeof fetch {
  return (async (url: string | URL) => {
    const href = typeof url === "string" ? url : url.toString();
    return responseFor(href, opts);
  }) as unknown as typeof fetch;
}

describe("smokeDriver", () => {
  beforeEach(() => {
    // Each test stubs globalThis.fetch via vi.stubGlobal so parallel test
    // runs don't cross-contaminate and a failure in one test restores a
    // clean global for the next.
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exposes kind === 'smoke'", () => {
    expect(smokeDriver.kind).toBe("smoke");
  });

  it("inputSchema accepts { key, url }", () => {
    const parsed = smokeDriver.inputSchema.safeParse({
      key: "smoke:mastra",
      url: "https://x.example/smoke",
    });
    expect(parsed.success).toBe(true);
  });

  it("inputSchema rejects missing url", () => {
    const parsed = smokeDriver.inputSchema.safeParse({
      key: "smoke:mastra",
    });
    expect(parsed.success).toBe(false);
  });

  it("inputSchema rejects missing key", () => {
    const parsed = smokeDriver.inputSchema.safeParse({
      url: "https://x.example/smoke",
    });
    expect(parsed.success).toBe(false);
  });

  it("inputSchema rejects non-url url", () => {
    const parsed = smokeDriver.inputSchema.safeParse({
      key: "smoke:mastra",
      url: "not-a-url",
    });
    expect(parsed.success).toBe(false);
  });

  it("happy path: 200 on /smoke + 200 on /health → green smoke + green health side-emission", async () => {
    vi.stubGlobal("fetch", fakeFetch({ smokeStatus: 200, healthStatus: 200 }));
    const { writer, writes } = mkWriter();
    const r = await smokeDriver.run(mkCtx(writer), {
      key: "smoke:mastra",
      url: "https://x.example/smoke",
    });
    expect(r.state).toBe("green");
    expect(r.key).toBe("smoke:mastra");
    expect(r.signal.status).toBe(200);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.key).toBe("health:mastra");
    expect(writes[0]!.state).toBe("green");
  });

  it("/smoke 500 → smoke red, health still probes", async () => {
    vi.stubGlobal("fetch", fakeFetch({ smokeStatus: 500, healthStatus: 200 }));
    const { writer, writes } = mkWriter();
    const r = await smokeDriver.run(mkCtx(writer), {
      key: "smoke:mastra",
      url: "https://x.example/smoke",
    });
    expect(r.state).toBe("red");
    expect(r.signal.errorDesc).toContain("500");
    expect(writes).toHaveLength(1);
    expect(writes[0]!.state).toBe("green");
  });

  it("/smoke 404 → smoke red with http 404 errorDesc", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch({ smokeStatus: 404, smokeBody: "", healthStatus: 200 }),
    );
    const { writer, writes } = mkWriter();
    const r = await smokeDriver.run(mkCtx(writer), {
      key: "smoke:ag2",
      url: "https://x.example/smoke",
    });
    expect(r.state).toBe("red");
    expect(r.signal.errorDesc).toBe("http 404");
    expect(writes).toHaveLength(1);
  });

  it("/smoke times out → smoke red with 'timeout after Nms'", async () => {
    // Fake fetch that waits on the AbortSignal and rejects with an
    // AbortError — mirrors what the real fetch does when aborted.
    const fetchImpl: typeof fetch = (async (
      _url: string | URL,
      init?: { signal?: AbortSignal },
    ) => {
      await new Promise<void>((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const e = new Error("This operation was aborted");
          e.name = "AbortError";
          reject(e);
        });
      });
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchImpl);
    const { writer, writes } = mkWriter();
    // Set an aggressive driver timeout via env so the test doesn't wait
    // the default 10 seconds.
    const ctx: ProbeContext = {
      now: () => new Date("2026-04-22T00:00:00Z"),
      logger,
      env: { SMOKE_TIMEOUT_MS: "5" },
      writer,
    };
    const r = await smokeDriver.run(ctx, {
      key: "smoke:mastra",
      url: "https://x.example/smoke",
    });
    expect(r.state).toBe("red");
    expect(r.signal.errorDesc).toBe("timeout after 5ms");
    // Health tick should also show a timeout (same fake-fetch behaviour).
    expect(writes).toHaveLength(1);
    expect(writes[0]!.state).toBe("red");
    expect(
      (writes[0]!.signal as { errorDesc?: string }).errorDesc,
    ).toBe("timeout after 5ms");
  });

  it("/smoke 200 with malformed JSON body → smoke red with parse reason", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch({
        smokeStatus: 200,
        smokeBody: "<html>ServiceUnavailable</html>",
        healthStatus: 200,
      }),
    );
    const { writer, writes } = mkWriter();
    const r = await smokeDriver.run(mkCtx(writer), {
      key: "smoke:mastra",
      url: "https://x.example/smoke",
    });
    expect(r.state).toBe("red");
    expect(r.signal.errorDesc).toMatch(/malformed body/);
    // Health side-emit still OK.
    expect(writes).toHaveLength(1);
    expect(writes[0]!.state).toBe("green");
  });

  it("/health 503 → health red, smoke unaffected", async () => {
    vi.stubGlobal("fetch", fakeFetch({ smokeStatus: 200, healthStatus: 503 }));
    const { writer, writes } = mkWriter();
    const r = await smokeDriver.run(mkCtx(writer), {
      key: "smoke:mastra",
      url: "https://x.example/smoke",
    });
    expect(r.state).toBe("green");
    expect(writes).toHaveLength(1);
    expect(writes[0]!.state).toBe("red");
    expect(
      (writes[0]!.signal as { errorDesc?: string }).errorDesc,
    ).toContain("503");
  });

  it("missing writer logs a warning and does not throw", async () => {
    vi.stubGlobal("fetch", fakeFetch({ smokeStatus: 200, healthStatus: 200 }));
    const r = await smokeDriver.run(mkCtx(undefined), {
      key: "smoke:mastra",
      url: "https://x.example/smoke",
    });
    expect(r.state).toBe("green");
  });

  it("writer.write() throwing on side-emit does not break the primary smoke return", async () => {
    vi.stubGlobal("fetch", fakeFetch({ smokeStatus: 200, healthStatus: 200 }));
    const writer: ProbeResultWriter = {
      async write() {
        throw new Error("writer exploded");
      },
    };
    const r = await smokeDriver.run(mkCtx(writer), {
      key: "smoke:mastra",
      url: "https://x.example/smoke",
    });
    expect(r.state).toBe("green");
    expect(r.key).toBe("smoke:mastra");
  });

  it("fetch throwing a generic network error → smoke red with raw message", async () => {
    const fetchImpl: typeof fetch = (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchImpl);
    const { writer, writes } = mkWriter();
    const r = await smokeDriver.run(mkCtx(writer), {
      key: "smoke:mastra",
      url: "https://x.example/smoke",
    });
    expect(r.state).toBe("red");
    expect(r.signal.errorDesc).toContain("ECONNRESET");
    expect(writes).toHaveLength(1);
    expect(writes[0]!.state).toBe("red");
  });

  it("10 parallel run() calls don't cross-contaminate URLs or keys", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = (async (url: string | URL) => {
      const href = typeof url === "string" ? url : url.toString();
      calls.push(href);
      return responseFor(href, { smokeStatus: 200, healthStatus: 200 });
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchImpl);

    const slugs = Array.from({ length: 10 }, (_, i) => `svc${i}`);
    const { writer, writes } = mkWriter();
    const ctx = mkCtx(writer);
    const results = await Promise.all(
      slugs.map((slug) =>
        smokeDriver.run(ctx, {
          key: `smoke:${slug}`,
          url: `https://x-${slug}.example/smoke`,
        }),
      ),
    );

    // All 10 smoke ticks green + all 10 health side-emissions green.
    expect(results.map((r) => r.state)).toEqual(Array(10).fill("green"));
    expect(results.map((r) => r.key).sort()).toEqual(
      slugs.map((s) => `smoke:${s}`).sort(),
    );
    expect(writes.map((w) => w.key).sort()).toEqual(
      slugs.map((s) => `health:${s}`).sort(),
    );
    // Every fake-fetch call received a URL matching one of the expected
    // smoke or health URLs — no cross-contamination.
    for (const href of calls) {
      expect(href).toMatch(
        /^https:\/\/x-svc\d\.example\/(smoke|health)$/,
      );
    }
    // Each slug's smoke + health URL was invoked exactly once.
    expect(calls.length).toBe(20);
  });

  it("/smoke 500 with long body truncates errorDesc at 160 chars + ellipsis", async () => {
    const longBody = "x".repeat(500);
    vi.stubGlobal(
      "fetch",
      fakeFetch({ smokeStatus: 500, smokeBody: longBody, healthStatus: 200 }),
    );
    const { writer } = mkWriter();
    const r = await smokeDriver.run(mkCtx(writer), {
      key: "smoke:mastra",
      url: "https://x.example/smoke",
    });
    expect(r.state).toBe("red");
    // Truncated tail is ellipsis (…) — operator sees the shape without
    // dragging a 500-byte blob into the alert payload.
    expect(r.signal.errorDesc).toMatch(/^http 500: x+…$/);
  });

  it("response body read throwing is treated as 'no extra detail'", async () => {
    // Response whose `.text()` rejects — simulates a corrupted stream or
    // an already-consumed body. The safeReadBody helper swallows the
    // error and returns ""; the driver falls back to the bare `http N`
    // errorDesc without the body suffix.
    const brokenResponse = new Response(null, {
      status: 502,
      statusText: "HTTP 502",
    });
    // Overwrite .text() to reject.
    Object.defineProperty(brokenResponse, "text", {
      value: () => Promise.reject(new Error("stream borked")),
    });
    const fetchImpl: typeof fetch = (async () =>
      brokenResponse) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchImpl);
    const { writer } = mkWriter();
    const r = await smokeDriver.run(mkCtx(writer), {
      key: "smoke:mastra",
      url: "https://x.example/smoke",
    });
    expect(r.state).toBe("red");
    expect(r.signal.errorDesc).toBe("http 502");
  });

  it("SMOKE_TIMEOUT_MS=invalid falls back to the 10s default", async () => {
    vi.stubGlobal("fetch", fakeFetch({ smokeStatus: 200, healthStatus: 200 }));
    const { writer } = mkWriter();
    const ctx: ProbeContext = {
      now: () => new Date("2026-04-22T00:00:00Z"),
      logger,
      env: { SMOKE_TIMEOUT_MS: "nonsense" },
      writer,
    };
    const r = await smokeDriver.run(ctx, {
      key: "smoke:mastra",
      url: "https://x.example/smoke",
    });
    expect(r.state).toBe("green");
  });

  it("fetch throwing a non-Error value → errorDesc is String-coerced", async () => {
    // Modern fetch impls always throw Errors, but some transport shims
    // (old undici branches, certain wasm polyfills) can throw strings.
    // Ensure the coercion path still produces a readable errorDesc.
    const fetchImpl: typeof fetch = (async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw "weird-string-error";
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchImpl);
    const { writer } = mkWriter();
    const r = await smokeDriver.run(mkCtx(writer), {
      key: "smoke:mastra",
      url: "https://x.example/smoke",
    });
    expect(r.state).toBe("red");
    expect(r.signal.errorDesc).toBe("weird-string-error");
  });

  it("input key without ':' falls back to whole-key as slug", async () => {
    vi.stubGlobal("fetch", fakeFetch({ smokeStatus: 200, healthStatus: 200 }));
    const { writer, writes } = mkWriter();
    const r = await smokeDriver.run(mkCtx(writer), {
      key: "bare",
      url: "https://x.example/smoke",
    });
    expect(r.state).toBe("green");
    expect(writes[0]!.key).toBe("health:bare");
  });
});
