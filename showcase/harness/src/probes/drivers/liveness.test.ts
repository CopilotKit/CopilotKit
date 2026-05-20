import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { livenessDriver, type SmokeDriverSignal } from "./liveness.js";
import { logger } from "../../logger.js";
import type {
  ProbeContext,
  ProbeResult,
  ProbeResultWriter,
} from "../../types/index.js";

// Driver-level tests for the smoke ProbeDriver. Deep behavioural coverage of
// `deriveHealthUrl` + the legacy `livenessProbe.run` path lives in
// `../liveness.test.ts`; this file verifies the driver-adapter layer:
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

describe("livenessDriver", () => {
  beforeEach(() => {
    // Each test stubs globalThis.fetch via vi.stubGlobal so parallel test
    // runs don't cross-contaminate and a failure in one test restores a
    // clean global for the next.
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exposes kind === 'smoke'", () => {
    expect(livenessDriver.kind).toBe("smoke");
  });

  it("inputSchema accepts { key, url }", () => {
    const parsed = livenessDriver.inputSchema.safeParse({
      key: "smoke:mastra",
      url: "https://x.example/smoke",
    });
    expect(parsed.success).toBe(true);
  });

  it("inputSchema rejects missing url", () => {
    const parsed = livenessDriver.inputSchema.safeParse({
      key: "smoke:mastra",
    });
    expect(parsed.success).toBe(false);
  });

  it("inputSchema rejects missing key", () => {
    const parsed = livenessDriver.inputSchema.safeParse({
      url: "https://x.example/smoke",
    });
    expect(parsed.success).toBe(false);
  });

  it("inputSchema rejects non-url url", () => {
    const parsed = livenessDriver.inputSchema.safeParse({
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
    const r = await livenessDriver.run(mkCtx(writer), {
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
    const r = await livenessDriver.run(mkCtx(writer), {
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
    const r = await livenessDriver.run(mkCtx(writer), {
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
    const r = await livenessDriver.run(ctx, {
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
    const r = await livenessDriver.run(mkCtx(writer), {
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
    const r = await livenessDriver.run(mkCtx(writer), {
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
    const r = await livenessDriver.run(mkCtx(undefined), {
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
    const r = await livenessDriver.run(mkCtx(writer), {
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
    const r = await livenessDriver.run(mkCtx(writer), {
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
        livenessDriver.run(ctx, {
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
    const r = await livenessDriver.run(mkCtx(writer), {
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
    const r = await livenessDriver.run(mkCtx(writer), {
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
    const r = await livenessDriver.run(ctx, {
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
    const r = await livenessDriver.run(mkCtx(writer), {
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
    const r = await livenessDriver.run(mkCtx(writer), {
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
    await livenessDriver.run(mkCtx(writer), {
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
    await livenessDriver.run(mkCtx(writer), {
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
    await livenessDriver.run(mkCtx(writer), {
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
    await livenessDriver.run(mkCtx(writer), {
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
    await livenessDriver.run(mkCtx(writer), {
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
    await livenessDriver.run(mkCtx(writer), {
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
    const r = await livenessDriver.run(mkCtx(writer), {
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
    expect(calls).toContain("https://showcase-ag2.up.railway.app/api/smoke");
    expect(calls).toContain("https://showcase-ag2.up.railway.app/api/health");
    expect(calls).toContain(
      "https://showcase-ag2.up.railway.app/api/copilotkit/",
    );
  });

  it("package shape (explicit): hits /api/smoke + /api/health", async () => {
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
    await livenessDriver.run(mkCtx(writer), {
      key: "smoke:ag2",
      name: "showcase-ag2",
      publicUrl: "https://showcase-ag2.up.railway.app",
      shape: "package",
    });
    expect(calls).toContain("https://showcase-ag2.up.railway.app/api/smoke");
    expect(calls).toContain("https://showcase-ag2.up.railway.app/api/health");
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

  // Real-server 308 tests: stand up an ephemeral http.Server that replies
  // with a genuine 308 + Location to the first path, then the terminal
  // status on the redirect target. A regression that drops
  // `redirect: "follow"` from the agent POST will fail these — the driver
  // would classify the raw 308 as proof-of-life and miss the final 404.
  it("agent probe follows a real 308 redirect to a 200 and stays green", async () => {
    const { url, close } = await startRealRedirectServer({
      first: { status: 308, locationPath: "/final" },
      final: { status: 200, body: '{"ok":true}' },
    });
    try {
      // Restore real fetch — we're intentionally talking to a real socket.
      vi.unstubAllGlobals();
      const { writer, writes } = mkWriter();
      await livenessDriver.run(mkCtx(writer), {
        key: "smoke:mastra",
        url: `${url}/smoke`,
      });
      const agent = writes.find((w) => w.key === "agent:mastra")!;
      expect(agent.state).toBe("green");
      expect((agent.signal as SmokeDriverSignal).status).toBe(200);
    } finally {
      await close();
    }
  });

  it("agent probe follows a real 308 redirect to a 404 and flips red", async () => {
    const { url, close } = await startRealRedirectServer({
      first: { status: 308, locationPath: "/final" },
      final: { status: 404, body: "<html>not found</html>" },
    });
    try {
      vi.unstubAllGlobals();
      const { writer, writes } = mkWriter();
      await livenessDriver.run(mkCtx(writer), {
        key: "smoke:mastra",
        url: `${url}/smoke`,
      });
      const agent = writes.find((w) => w.key === "agent:mastra")!;
      expect(agent.state).toBe("red");
      expect((agent.signal as SmokeDriverSignal).errorDesc).toMatch(
        /route not mounted|agent endpoint 404/,
      );
    } finally {
      await close();
    }
  });

  // Regression guard for discovery-mode `redirect: "follow"` propagation.
  // Earlier coverage asserted the option only for static-URL mode; a
  // refactor could drop the option in the discovery branch without the
  // original test catching it.
  it("discovery + package: agent POST carries `redirect: 'follow'`", async () => {
    let sawRedirect = false;
    const fetchImpl: typeof fetch = (async (
      url: string | URL,
      init?: RequestInit,
    ) => {
      const href = typeof url === "string" ? url : url.toString();
      if (/\/api\/copilotkit/.test(href)) {
        if ((init as RequestInit | undefined)?.redirect === "follow") {
          sawRedirect = true;
        }
        return new Response("{}", { status: 200 });
      }
      return responseFor(href, { smokeStatus: 200, healthStatus: 200 });
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchImpl);
    const { writer } = mkWriter();
    await livenessDriver.run(mkCtx(writer), {
      key: "smoke:ag2",
      name: "showcase-ag2",
      publicUrl: "https://showcase-ag2.up.railway.app",
    });
    expect(sawRedirect).toBe(true);
  });

  it("inputSchema rejects `url` + `shape` combo (shape only valid with publicUrl)", () => {
    const parsed = livenessDriver.inputSchema.safeParse({
      key: "smoke:mastra",
      url: "https://x.example/smoke",
      shape: "package",
    });
    expect(parsed.success).toBe(false);
  });

  // Parse-time invariants — callers that run safeParse in isolation must
  // get a unified rejection for structural mistakes regardless of which
  // arm's strictness would otherwise absorb them.
  it("inputSchema rejects bare `{ key }` (no url, no name+publicUrl)", () => {
    const parsed = livenessDriver.inputSchema.safeParse({ key: "k" });
    expect(parsed.success).toBe(false);
  });

  it("inputSchema rejects `{ key, name }` (discovery missing publicUrl)", () => {
    const parsed = livenessDriver.inputSchema.safeParse({
      key: "k",
      name: "showcase-ag2",
    });
    expect(parsed.success).toBe(false);
  });

  it("inputSchema rejects mixed modes `{ key, url, name, publicUrl }`", () => {
    // Discovery arm's .passthrough() would otherwise absorb the stray
    // `url` field; the union-level superRefine enforces XOR across the
    // two modes.
    const parsed = livenessDriver.inputSchema.safeParse({
      key: "k",
      url: "http://x.example/smoke",
      name: "showcase-ag2",
      publicUrl: "http://x.example",
    });
    expect(parsed.success).toBe(false);
  });

  // Item-5 regression guards: the primary `smoke:<slug>` key is rewritten
  // in discovery mode so YAML key_templates that interpolate `${name}`
  // (producing `smoke:showcase-ag2`) land on the stripped slug
  // (`smoke:ag2`) dashboards + alerts are actually keyed on. Static mode
  // passes the YAML-authored key through verbatim.
  it("discovery package: `smoke:showcase-ag2` is rewritten to `smoke:ag2`", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch({ smokeStatus: 200, healthStatus: 200, agentStatus: 200 }),
    );
    const { writer } = mkWriter();
    const r = await livenessDriver.run(mkCtx(writer), {
      key: "smoke:showcase-ag2",
      name: "showcase-ag2",
      publicUrl: "https://showcase-ag2.up.railway.app",
      shape: "package",
    });
    expect(r.key).toBe("smoke:ag2");
  });

  it("static mode passes the YAML-authored key through verbatim", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch({ smokeStatus: 200, healthStatus: 200, agentStatus: 200 }),
    );
    const { writer } = mkWriter();
    const r = await livenessDriver.run(mkCtx(writer), {
      key: "smoke:custom-yaml-key",
      url: "https://x.example/smoke",
    });
    expect(r.key).toBe("smoke:custom-yaml-key");
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
    await livenessDriver.run(mkCtx(writer), {
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
 * pull it through the existing `livenessDriver` import so the tested shape
 * matches exactly what the invoker hands in.
 */
function smokeInputSchema_safeParse(input: unknown): { success: boolean } {
  return livenessDriver.inputSchema.safeParse(input);
}

/**
 * Stand up an ephemeral HTTP server that answers the first path with a
 * real 308 redirect (Location header → `/final`) and the terminal path
 * with the configured status + body. Used to verify that the driver's
 * agent POST actually follows redirects via `redirect: "follow"` rather
 * than classifying the raw 308 as proof-of-life.
 */
async function startRealRedirectServer(spec: {
  first: { status: number; locationPath: string };
  final: { status: number; body: string };
}): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    if (url === spec.first.locationPath) {
      res.writeHead(spec.final.status, {
        "Content-Type": "text/html; charset=utf-8",
      });
      res.end(spec.final.body);
      return;
    }
    // First hop — handles the `/api/copilotkit/` POST. Respond 308 with
    // Location so undici follows to `/final`.
    if (/\/api\/copilotkit/.test(url)) {
      res.writeHead(spec.first.status, {
        Location: spec.first.locationPath,
      });
      res.end();
      return;
    }
    // Smoke / health GETs land on `/smoke` / `/health` — respond 200 with
    // a JSON body so those rows don't accidentally fail.
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end('{"status":"ok"}');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${addr.port}`;
  return {
    url,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
