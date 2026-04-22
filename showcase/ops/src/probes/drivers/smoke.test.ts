import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { smokeDriver, type SmokeDriverSignal } from "./smoke.js";
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
function responseFor(
  url: string,
  opts: {
    smokeStatus?: number;
    healthStatus?: number;
    agentStatus?: number;
    smokeBody?: string;
    healthBody?: string;
    agentBody?: string;
  },
): Response {
  const isAgent = /\/api\/copilotkit(\/|\b|\?|$)/.test(url);
  const isHealth = !isAgent && /\/health(\b|\/|\?|$)/.test(url);
  let status: number;
  let body: string;
  if (isAgent) {
    status = opts.agentStatus ?? 200;
    body = opts.agentBody ?? '{"status":"ok"}';
  } else if (isHealth) {
    status = opts.healthStatus ?? 200;
    body = opts.healthBody ?? '{"status":"ok"}';
  } else {
    status = opts.smokeStatus ?? 200;
    body = opts.smokeBody ?? '{"status":"ok"}';
  }
  return new Response(body, {
    status,
    statusText: `HTTP ${status}`,
  });
}

/** Fake-fetch factory: answer smoke/health/agent differently per test case. */
function fakeFetch(opts: {
  smokeStatus?: number;
  healthStatus?: number;
  agentStatus?: number;
  smokeBody?: string;
  healthBody?: string;
  agentBody?: string;
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

  it("happy path: 200 /smoke + 200 /health + 200 /agent → green smoke + green health + green agent side-emissions", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch({ smokeStatus: 200, healthStatus: 200, agentStatus: 200 }),
    );
    const { writer, writes } = mkWriter();
    const r = await smokeDriver.run(mkCtx(writer), {
      key: "smoke:mastra",
      url: "https://x.example/smoke",
    });
    expect(r.state).toBe("green");
    expect(r.key).toBe("smoke:mastra");
    expect(r.signal.status).toBe(200);
    expect(writes).toHaveLength(2);
    expect(writes[0]!.key).toBe("health:mastra");
    expect(writes[0]!.state).toBe("green");
    expect(writes[1]!.key).toBe("agent:mastra");
    expect(writes[1]!.state).toBe("green");
  });

  it("/smoke 500 → smoke red, health still probes", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch({ smokeStatus: 500, healthStatus: 200, agentStatus: 200 }),
    );
    const { writer, writes } = mkWriter();
    const r = await smokeDriver.run(mkCtx(writer), {
      key: "smoke:mastra",
      url: "https://x.example/smoke",
    });
    expect(r.state).toBe("red");
    expect(r.signal.errorDesc).toContain("500");
    expect(writes).toHaveLength(2);
    expect(writes[0]!.key).toBe("health:mastra");
    expect(writes[0]!.state).toBe("green");
    expect(writes[1]!.key).toBe("agent:mastra");
    expect(writes[1]!.state).toBe("green");
  });

  it("/smoke 404 → smoke red with http 404 errorDesc", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch({
        smokeStatus: 404,
        smokeBody: "",
        healthStatus: 200,
        agentStatus: 200,
      }),
    );
    const { writer, writes } = mkWriter();
    const r = await smokeDriver.run(mkCtx(writer), {
      key: "smoke:ag2",
      url: "https://x.example/smoke",
    });
    expect(r.state).toBe("red");
    expect(r.signal.errorDesc).toBe("http 404");
    expect(writes).toHaveLength(2);
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
    // Health + agent ticks should also show a timeout (same fake-fetch).
    expect(writes).toHaveLength(2);
    expect(writes[0]!.state).toBe("red");
    expect((writes[0]!.signal as { errorDesc?: string }).errorDesc).toBe(
      "timeout after 5ms",
    );
    expect(writes[1]!.key).toBe("agent:mastra");
    expect(writes[1]!.state).toBe("red");
  });

  it("/smoke 200 with malformed JSON body → smoke red with parse reason", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch({
        smokeStatus: 200,
        smokeBody: "<html>ServiceUnavailable</html>",
        healthStatus: 200,
        agentStatus: 200,
      }),
    );
    const { writer, writes } = mkWriter();
    const r = await smokeDriver.run(mkCtx(writer), {
      key: "smoke:mastra",
      url: "https://x.example/smoke",
    });
    expect(r.state).toBe("red");
    expect(r.signal.errorDesc).toMatch(/malformed body/);
    // Health + agent side-emits still OK.
    expect(writes).toHaveLength(2);
    expect(writes[0]!.state).toBe("green");
    expect(writes[1]!.state).toBe("green");
  });

  it("/health 503 → health red, smoke + agent unaffected", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch({ smokeStatus: 200, healthStatus: 503, agentStatus: 200 }),
    );
    const { writer, writes } = mkWriter();
    const r = await smokeDriver.run(mkCtx(writer), {
      key: "smoke:mastra",
      url: "https://x.example/smoke",
    });
    expect(r.state).toBe("green");
    expect(writes).toHaveLength(2);
    expect(writes[0]!.key).toBe("health:mastra");
    expect(writes[0]!.state).toBe("red");
    expect((writes[0]!.signal as { errorDesc?: string }).errorDesc).toContain(
      "503",
    );
    expect(writes[1]!.key).toBe("agent:mastra");
    expect(writes[1]!.state).toBe("green");
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
    expect(writes).toHaveLength(2);
    expect(writes[0]!.state).toBe("red");
    expect(writes[1]!.key).toBe("agent:mastra");
    expect(writes[1]!.state).toBe("red");
  });

  it("10 parallel run() calls don't cross-contaminate URLs or keys", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = (async (url: string | URL) => {
      const href = typeof url === "string" ? url : url.toString();
      calls.push(href);
      return responseFor(href, {
        smokeStatus: 200,
        healthStatus: 200,
        agentStatus: 200,
      });
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

    // All 10 smoke ticks green + 10 health + 10 agent side-emissions green.
    expect(results.map((r) => r.state)).toEqual(Array(10).fill("green"));
    expect(results.map((r) => r.key).sort()).toEqual(
      slugs.map((s) => `smoke:${s}`).sort(),
    );
    // writes has 20 entries: 10 health:<slug> + 10 agent:<slug>.
    const writeKeys = writes.map((w) => w.key).sort();
    const expectedWriteKeys = [
      ...slugs.map((s) => `health:${s}`),
      ...slugs.map((s) => `agent:${s}`),
    ].sort();
    expect(writeKeys).toEqual(expectedWriteKeys);
    // Every fake-fetch call received a URL matching one of the expected
    // smoke, health, or agent URLs — no cross-contamination.
    for (const href of calls) {
      expect(href).toMatch(
        /^https:\/\/x-svc\d\.example\/(smoke|health|api\/copilotkit\/?)$/,
      );
    }
    // Each slug's smoke + health + agent URL invoked exactly once (10 × 3 = 30).
    expect(calls.length).toBe(30);
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
    vi.stubGlobal(
      "fetch",
      fakeFetch({ smokeStatus: 200, healthStatus: 200, agentStatus: 200 }),
    );
    const { writer, writes } = mkWriter();
    const r = await smokeDriver.run(mkCtx(writer), {
      key: "bare",
      url: "https://x.example/smoke",
    });
    expect(r.state).toBe("green");
    expect(writes[0]!.key).toBe("health:bare");
    expect(writes[1]!.key).toBe("agent:bare");
  });

  // -------------------------------------------------------------------
  // L2 agent endpoint
  // -------------------------------------------------------------------

  it("/agent 200 → agent green with status 200", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch({ smokeStatus: 200, healthStatus: 200, agentStatus: 200 }),
    );
    const { writer, writes } = mkWriter();
    await smokeDriver.run(mkCtx(writer), {
      key: "smoke:mastra",
      url: "https://x.example/smoke",
    });
    const agent = writes.find((w) => w.key === "agent:mastra")!;
    expect(agent.state).toBe("green");
    expect((agent.signal as SmokeDriverSignal).status).toBe(200);
  });

  it("/agent 400 (runtime rejected empty payload) → agent green — runtime is mounted", async () => {
    // The CopilotKit Hono router returns 400 for an empty `{}` body; this
    // is still an L2 success — any non-404 response proves the route
    // exists. Mirrors the `checkAgentEndpoint` contract.
    vi.stubGlobal(
      "fetch",
      fakeFetch({ smokeStatus: 200, healthStatus: 200, agentStatus: 400 }),
    );
    const { writer, writes } = mkWriter();
    await smokeDriver.run(mkCtx(writer), {
      key: "smoke:mastra",
      url: "https://x.example/smoke",
    });
    const agent = writes.find((w) => w.key === "agent:mastra")!;
    expect(agent.state).toBe("green");
    expect((agent.signal as SmokeDriverSignal).status).toBe(400);
  });

  it("/agent 404 → agent red with 'route not mounted' errorDesc", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch({
        smokeStatus: 200,
        healthStatus: 200,
        agentStatus: 404,
        agentBody: "",
      }),
    );
    const { writer, writes } = mkWriter();
    await smokeDriver.run(mkCtx(writer), {
      key: "smoke:mastra",
      url: "https://x.example/smoke",
    });
    const agent = writes.find((w) => w.key === "agent:mastra")!;
    expect(agent.state).toBe("red");
    expect((agent.signal as SmokeDriverSignal).errorDesc).toMatch(
      /route not mounted/,
    );
  });

  it("/agent 404 with body → agent red with truncated body in errorDesc", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch({
        smokeStatus: 200,
        healthStatus: 200,
        agentStatus: 404,
        agentBody: "<html>Next.js 404</html>",
      }),
    );
    const { writer, writes } = mkWriter();
    await smokeDriver.run(mkCtx(writer), {
      key: "smoke:mastra",
      url: "https://x.example/smoke",
    });
    const agent = writes.find((w) => w.key === "agent:mastra")!;
    expect(agent.state).toBe("red");
    expect((agent.signal as SmokeDriverSignal).errorDesc).toContain(
      "agent endpoint 404",
    );
    expect((agent.signal as SmokeDriverSignal).errorDesc).toContain(
      "Next.js 404",
    );
  });

  it("/agent transport error → agent red with raw message", async () => {
    let callIdx = 0;
    const fetchImpl: typeof fetch = (async (url: string | URL) => {
      const href = typeof url === "string" ? url : url.toString();
      callIdx++;
      if (/\/api\/copilotkit/.test(href)) {
        throw new Error("EHOSTUNREACH");
      }
      return responseFor(href, { smokeStatus: 200, healthStatus: 200 });
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchImpl);
    const { writer, writes } = mkWriter();
    await smokeDriver.run(mkCtx(writer), {
      key: "smoke:mastra",
      url: "https://x.example/smoke",
    });
    expect(callIdx).toBeGreaterThanOrEqual(3);
    const agent = writes.find((w) => w.key === "agent:mastra")!;
    expect(agent.state).toBe("red");
    expect((agent.signal as SmokeDriverSignal).errorDesc).toContain(
      "EHOSTUNREACH",
    );
  });

  it("POSTs `{}` to /api/copilotkit/ for the agent probe", async () => {
    let agentInit: RequestInit | undefined;
    const fetchImpl: typeof fetch = (async (
      url: string | URL,
      init?: RequestInit,
    ) => {
      const href = typeof url === "string" ? url : url.toString();
      if (/\/api\/copilotkit/.test(href)) {
        agentInit = init;
      }
      return responseFor(href, {
        smokeStatus: 200,
        healthStatus: 200,
        agentStatus: 200,
      });
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchImpl);
    const { writer } = mkWriter();
    await smokeDriver.run(mkCtx(writer), {
      key: "smoke:mastra",
      url: "https://x.example/smoke",
    });
    expect(agentInit?.method).toBe("POST");
    expect(agentInit?.body).toBe("{}");
    // Content-Type header must be JSON so the runtime's body parser kicks in.
    const headers = agentInit?.headers as Record<string, string> | undefined;
    expect(headers?.["Content-Type"]).toBe("application/json");
  });

  // -------------------------------------------------------------------
  // Discovery-shape input
  // -------------------------------------------------------------------

  it("inputSchema accepts discovery shape { key, name, publicUrl, imageRef, env }", () => {
    const parsed = smokeInputSchema_safeParse({
      key: "smoke:ag2",
      name: "showcase-ag2",
      imageRef: "ghcr.io/copilotkit/showcase-ag2:latest",
      publicUrl: "https://showcase-ag2.up.railway.app",
      env: { FOO: "bar" },
    });
    expect(parsed.success).toBe(true);
  });

  it("inputSchema rejects when neither `url` nor (`name` + `publicUrl`) is set", () => {
    const parsed = smokeInputSchema_safeParse({ key: "smoke:ag2" });
    expect(parsed.success).toBe(false);
  });

  it("discovery input: `showcase-ag2` name strips prefix → slug=`ag2`, URLs built from publicUrl", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = (async (url: string | URL) => {
      const href = typeof url === "string" ? url : url.toString();
      calls.push(href);
      return responseFor(href, {
        smokeStatus: 200,
        healthStatus: 200,
        agentStatus: 200,
      });
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchImpl);
    const { writer, writes } = mkWriter();
    const r = await smokeDriver.run(mkCtx(writer), {
      key: "smoke:ag2",
      name: "showcase-ag2",
      imageRef: "ghcr.io/copilotkit/showcase-ag2:latest",
      publicUrl: "https://showcase-ag2.up.railway.app",
      env: {},
    });
    expect(r.state).toBe("green");
    expect(r.key).toBe("smoke:ag2");
    expect(writes.map((w) => w.key).sort()).toEqual(
      ["agent:ag2", "health:ag2"].sort(),
    );
    expect(calls).toContain("https://showcase-ag2.up.railway.app/smoke");
    expect(calls).toContain("https://showcase-ag2.up.railway.app/health");
    expect(calls).toContain(
      "https://showcase-ag2.up.railway.app/api/copilotkit/",
    );
  });

  it("discovery input: `showcase-starter-ag2` name strips prefix → slug=`starter-ag2`", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch({ smokeStatus: 200, healthStatus: 200, agentStatus: 200 }),
    );
    const { writer, writes } = mkWriter();
    const r = await smokeDriver.run(mkCtx(writer), {
      key: "smoke:starter-ag2",
      name: "showcase-starter-ag2",
      imageRef: "ghcr.io/copilotkit/showcase-starter-ag2:latest",
      publicUrl: "https://showcase-starter-ag2.up.railway.app",
      env: {},
    });
    expect(r.state).toBe("green");
    expect(writes.map((w) => w.key).sort()).toEqual(
      ["agent:starter-ag2", "health:starter-ag2"].sort(),
    );
  });

  // -------------------------------------------------------------------
  // Starter shape: probes hit `/api/health` instead of `/smoke` + `/health`.
  // Starters are single-app Next.js integrations deployed from
  // showcase/starters/*. They expose `/api/health` (returning JSON) but
  // no `/smoke`, no `/health`, and no `/demos/*`. Without shape branching
  // every starter registers 51 false red alerts per tick (17 services ×
  // 3 endpoints).
  // -------------------------------------------------------------------

  it("starter shape: primary smoke probe hits /api/health, green on 200", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = (async (url: string | URL) => {
      const href = typeof url === "string" ? url : url.toString();
      calls.push(href);
      // Starter only answers /api/health; everything else is 404.
      if (/\/api\/health\b/.test(href)) {
        return new Response('{"status":"ok","integration":"ag2"}', {
          status: 200,
        });
      }
      if (/\/api\/copilotkit/.test(href)) {
        return new Response('{"error":"bad body"}', { status: 400 });
      }
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchImpl);
    const { writer, writes } = mkWriter();
    const r = await smokeDriver.run(mkCtx(writer), {
      key: "smoke:starter-ag2",
      name: "showcase-starter-ag2",
      publicUrl: "https://showcase-starter-ag2-production.up.railway.app",
      shape: "starter",
    });
    expect(r.state).toBe("green");
    expect(r.key).toBe("smoke:starter-ag2");
    // Starter smoke probe MUST hit /api/health — the whole reason for
    // shape detection. Seeing /smoke here is the primary regression.
    expect(calls).toContain(
      "https://showcase-starter-ag2-production.up.railway.app/api/health",
    );
    expect(calls).not.toContain(
      "https://showcase-starter-ag2-production.up.railway.app/smoke",
    );
    expect(calls).not.toContain(
      "https://showcase-starter-ag2-production.up.railway.app/health",
    );
    // Health side-emit still produced (mirrors primary) so dashboards
    // keyed on `health:<slug>` stay populated.
    const health = writes.find((w) => w.key === "health:starter-ag2");
    expect(health?.state).toBe("green");
  });

  it("starter shape: /api/health 503 → primary smoke red with http 503", async () => {
    const fetchImpl: typeof fetch = (async (url: string | URL) => {
      const href = typeof url === "string" ? url : url.toString();
      if (/\/api\/health\b/.test(href)) {
        return new Response('{"status":"degraded"}', { status: 503 });
      }
      if (/\/api\/copilotkit/.test(href)) {
        return new Response("{}", { status: 200 });
      }
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchImpl);
    const { writer, writes } = mkWriter();
    const r = await smokeDriver.run(mkCtx(writer), {
      key: "smoke:starter-ag2",
      name: "showcase-starter-ag2",
      publicUrl: "https://showcase-starter-ag2-production.up.railway.app",
      shape: "starter",
    });
    expect(r.state).toBe("red");
    expect(r.signal.errorDesc).toContain("503");
    // The agent side-emit (L2) should still run + succeed.
    const agent = writes.find((w) => w.key === "agent:starter-ag2");
    expect(agent?.state).toBe("green");
  });

  it("starter shape: never probes /smoke (real starters 404 on it)", async () => {
    // Regression guard: the previous contract fired GET /smoke which
    // produced 17 false-red smoke alerts the first tick after deploy.
    // Under the new shape contract, /smoke must NOT be called at all —
    // the primary probe, the health side-emit, and the agent probe are
    // all expected to use `/api/health` / `/api/copilotkit/`.
    const calls: string[] = [];
    const fetchImpl: typeof fetch = (async (url: string | URL) => {
      const href = typeof url === "string" ? url : url.toString();
      calls.push(href);
      if (/\/api\/health\b/.test(href)) {
        return new Response('{"status":"ok"}', { status: 200 });
      }
      if (/\/api\/copilotkit/.test(href)) {
        return new Response("{}", { status: 200 });
      }
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchImpl);
    const { writer } = mkWriter();
    await smokeDriver.run(mkCtx(writer), {
      key: "smoke:starter-mastra",
      name: "showcase-starter-mastra",
      publicUrl: "https://showcase-starter-mastra.up.railway.app",
      shape: "starter",
    });
    for (const c of calls) {
      expect(c).not.toMatch(/\/smoke(\b|\?|$)/);
      // `/health` without the `/api` prefix must also not appear.
      expect(c).not.toMatch(/\.app\/health(\b|\?|$)/);
    }
  });

  it("package shape (explicit): keeps the legacy /smoke + /health contract", async () => {
    // Sanity check that the new `shape` field is optional and
    // backward-compatible: when `shape === "package"` (or omitted), the
    // driver still hits /smoke + /health exactly like before.
    const calls: string[] = [];
    const fetchImpl: typeof fetch = (async (url: string | URL) => {
      const href = typeof url === "string" ? url : url.toString();
      calls.push(href);
      return responseFor(href, {
        smokeStatus: 200,
        healthStatus: 200,
        agentStatus: 200,
      });
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchImpl);
    const { writer } = mkWriter();
    await smokeDriver.run(mkCtx(writer), {
      key: "smoke:ag2",
      name: "showcase-ag2",
      publicUrl: "https://showcase-ag2.up.railway.app",
      shape: "package",
    });
    expect(calls).toContain("https://showcase-ag2.up.railway.app/smoke");
    expect(calls).toContain("https://showcase-ag2.up.railway.app/health");
  });

  // -------------------------------------------------------------------
  // L2 308 redirect handling: /api/copilotkit/ → /api/copilotkit
  //
  // Railway's Next.js edge serves a 308 for the trailing-slash variant.
  // The previous contract accepted the raw 308 as proof-of-life, which
  // quietly masked regressions where the redirect target was a 404
  // (e.g. wrong mount path). Enabling redirect following makes the
  // probe classify on the FINAL status: 308→200 stays green, 308→400
  // (runtime rejected the empty body) stays green, but 308→404 flips
  // red so we actually catch unmounted routes.
  // -------------------------------------------------------------------

  it("agent probe follows 308 redirects and judges the final response", async () => {
    const seenPaths: string[] = [];
    // Simulate Railway edge: 308 with Location, then the real handler.
    // We can't actually send 308 from a synthetic Response + have fetch
    // follow — testing the effect via the probe's behaviour after the
    // redirect lands on a 404 target URL. The driver MUST request with
    // `redirect: "follow"` so the undici runtime handles the redirect.
    let sawRedirectOption = false;
    const fetchImpl: typeof fetch = (async (
      url: string | URL,
      init?: RequestInit,
    ) => {
      const href = typeof url === "string" ? url : url.toString();
      seenPaths.push(href);
      if (/\/api\/copilotkit/.test(href)) {
        if ((init as RequestInit | undefined)?.redirect === "follow") {
          sawRedirectOption = true;
        }
        // Simulate the post-redirect reply: runtime got our `{}` and
        // responded with 400. That's a non-404 → proof-of-life → green.
        return new Response('{"error":"missing fields"}', { status: 400 });
      }
      return responseFor(href, { smokeStatus: 200, healthStatus: 200 });
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchImpl);
    const { writer, writes } = mkWriter();
    await smokeDriver.run(mkCtx(writer), {
      key: "smoke:mastra",
      url: "https://x.example/smoke",
    });
    expect(sawRedirectOption).toBe(true);
    const agent = writes.find((w) => w.key === "agent:mastra")!;
    expect(agent.state).toBe("green");
    expect((agent.signal as SmokeDriverSignal).status).toBe(400);
  });

  it("agent probe red when 308 redirect lands on a 404 (route actually missing)", async () => {
    const fetchImpl: typeof fetch = (async (
      url: string | URL,
      _init?: RequestInit,
    ) => {
      const href = typeof url === "string" ? url : url.toString();
      if (/\/api\/copilotkit/.test(href)) {
        // Post-redirect reply: edge says "page not found". Under the old
        // contract the raw 308 was treated as green — this test locks in
        // that we now see the terminal 404 and flip red.
        return new Response("<html>not found</html>", { status: 404 });
      }
      return responseFor(href, { smokeStatus: 200, healthStatus: 200 });
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchImpl);
    const { writer, writes } = mkWriter();
    await smokeDriver.run(mkCtx(writer), {
      key: "smoke:mastra",
      url: "https://x.example/smoke",
    });
    const agent = writes.find((w) => w.key === "agent:mastra")!;
    expect(agent.state).toBe("red");
    expect((agent.signal as SmokeDriverSignal).errorDesc).toMatch(
      /route not mounted|agent endpoint 404/,
    );
  });

  it("discovery input with trailing `/` on publicUrl strips it before appending paths", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = (async (url: string | URL) => {
      const href = typeof url === "string" ? url : url.toString();
      calls.push(href);
      return responseFor(href, {
        smokeStatus: 200,
        healthStatus: 200,
        agentStatus: 200,
      });
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchImpl);
    const { writer } = mkWriter();
    await smokeDriver.run(mkCtx(writer), {
      key: "smoke:ag2",
      name: "showcase-ag2",
      imageRef: "",
      publicUrl: "https://showcase-ag2.up.railway.app/",
      env: {},
    });
    // No double-slashes.
    for (const c of calls) {
      expect(c).not.toContain(".app//");
    }
  });
});

/**
 * Proxy helper for the two schema-level assertions above. Not exposed
 * from the module itself (drivers keep their schemas private); the tests
 * pull it through the existing `smokeDriver` import so the tested shape
 * matches exactly what the invoker hands in.
 */
function smokeInputSchema_safeParse(input: unknown): { success: boolean } {
  return smokeDriver.inputSchema.safeParse(input);
}
