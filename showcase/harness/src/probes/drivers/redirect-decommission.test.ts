import { describe, it, expect, vi } from "vitest";
import {
  createRedirectDecommissionDriver,
  redirectDecommissionDriver,
} from "./redirect-decommission.js";
// `redirectDecommissionDriver` is the default instance used for kind +
// inputSchema shape checks; `createRedirectDecommissionDriver` is used
// everywhere we need to stub fetch / load.
import { logger } from "../../logger.js";

// Driver-level tests. Deep behavioural coverage for the per-tick signal
// invariants lives in `../redirect-decommission.test.ts` and the formatter
// cross-check lives in
// `showcase/scripts/redirect-decommission-core.test.ts`. This file verifies
// the driver adapter — schema shape, env-missing failure path, PostHog
// success + 5xx paths, and the (ctx, input) call-order wiring — without
// re-covering either of those matrices.

const BASE_CTX = {
  now: () => new Date("2026-04-20T00:00:00Z"),
  logger,
};

const SAMPLE_REDIRECTS = [
  { id: "A1", source: "/a1-old", destination: "/a1" },
  { id: "A2", source: "/a2-old", destination: "/a2" },
];

function mkCore(
  stubCompute?: (i: {
    events: Array<{ redirect_id: string; count: number }>;
    redirects: Array<{ id: string; source: string; destination: string }>;
    days: number;
    slackFormat: boolean;
  }) => {
    body: string;
    candidateCount: number;
    hasCandidates: boolean;
  },
) {
  return {
    seoRedirects: SAMPLE_REDIRECTS,
    computeRedirectDecommission:
      stubCompute ??
      (() => ({
        body: ":warning: 1 candidate",
        candidateCount: 1,
        hasCandidates: true,
      })),
  };
}

function mkFetch(
  response: Partial<Response> & { json?: () => Promise<unknown> },
) {
  return vi.fn(async () => response as unknown as Response);
}

describe("redirectDecommissionDriver", () => {
  it("exposes kind === 'redirect_decommission'", () => {
    expect(redirectDecommissionDriver.kind).toBe("redirect_decommission");
  });

  it("inputSchema accepts { key } (single-target YAML shape)", () => {
    const parsed = redirectDecommissionDriver.inputSchema.safeParse({
      key: "redirect_decommission:overall",
    });
    expect(parsed.success).toBe(true);
  });

  it("inputSchema rejects input without a key", () => {
    const parsed = redirectDecommissionDriver.inputSchema.safeParse({});
    expect(parsed.success).toBe(false);
  });

  it("inputSchema rejects empty key", () => {
    const parsed = redirectDecommissionDriver.inputSchema.safeParse({
      key: "",
    });
    expect(parsed.success).toBe(false);
  });

  it("returns state:'error' when POSTHOG_API_KEY missing", async () => {
    const driver = createRedirectDecommissionDriver();
    const r = await driver.run(
      { ...BASE_CTX, env: { POSTHOG_PROJECT_ID: "p1" } },
      { key: "redirect_decommission:overall" },
    );
    expect(r.state).toBe("error");
    expect(r.key).toBe("redirect_decommission:overall");
    expect((r.signal as { probeErrored: boolean }).probeErrored).toBe(true);
  });

  it("returns state:'error' when POSTHOG_PROJECT_ID missing", async () => {
    const driver = createRedirectDecommissionDriver();
    const r = await driver.run(
      { ...BASE_CTX, env: { POSTHOG_API_KEY: "phx_fake" } },
      { key: "redirect_decommission:overall" },
    );
    expect(r.state).toBe("error");
    expect((r.signal as { probeErrorDesc: string }).probeErrorDesc).toMatch(
      /POSTHOG_API_KEY and POSTHOG_PROJECT_ID/,
    );
  });

  it("returns state:'error' when both env vars missing", async () => {
    const driver = createRedirectDecommissionDriver();
    const r = await driver.run(
      { ...BASE_CTX, env: {} },
      { key: "redirect_decommission:overall" },
    );
    expect(r.state).toBe("error");
  });

  it("happy path: fetches PostHog + emits green ProbeResult with body + hasCandidates", async () => {
    const fetchImpl = mkFetch({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          ["A1", 5],
          ["A2", 2],
        ],
      }),
      text: async () => "",
    });
    const driver = createRedirectDecommissionDriver({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      core: mkCore((i) => {
        // Make sure driver is piping the PostHog events through the core
        // renderer unchanged — the cross-check test proves byte-identity
        // against the CLI, so here we just verify the forwarding contract.
        const input = i as {
          events: Array<{ redirect_id: string; count: number }>;
        };
        expect(input.events).toEqual([
          { redirect_id: "A1", count: 5 },
          { redirect_id: "A2", count: 2 },
        ]);
        return {
          body: "rendered-body",
          candidateCount: 1,
          hasCandidates: true,
        };
      }),
    });

    const r = await driver.run(
      {
        ...BASE_CTX,
        env: { POSTHOG_API_KEY: "phx_x", POSTHOG_PROJECT_ID: "proj" },
      },
      { key: "redirect_decommission:overall" },
    );
    expect(r.state).toBe("green");
    const sig = r.signal as {
      body: string;
      candidateCount: number;
      hasCandidates: boolean;
      probeErrored: boolean;
    };
    expect(sig.body).toBe("rendered-body");
    expect(sig.candidateCount).toBe(1);
    expect(sig.hasCandidates).toBe(true);
    expect(sig.probeErrored).toBe(false);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("zero-candidates path: hasCandidates=false, body empty", async () => {
    const fetchImpl = mkFetch({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          ["A1", 1],
          ["A2", 2],
        ],
      }),
      text: async () => "",
    });
    const driver = createRedirectDecommissionDriver({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      core: mkCore(() => ({
        body: "",
        candidateCount: 0,
        hasCandidates: false,
      })),
    });
    const r = await driver.run(
      {
        ...BASE_CTX,
        env: { POSTHOG_API_KEY: "phx_x", POSTHOG_PROJECT_ID: "proj" },
      },
      { key: "redirect_decommission:overall" },
    );
    expect(r.state).toBe("green");
    const sig = r.signal as {
      hasCandidates: boolean;
      candidateCount: number;
      body: string;
    };
    expect(sig.hasCandidates).toBe(false);
    expect(sig.candidateCount).toBe(0);
    expect(sig.body).toBe("");
  });

  it("5xx from PostHog routes through probeErrored=true (audit-failed branch)", async () => {
    const fetchImpl = mkFetch({
      ok: false,
      status: 503,
      json: async () => ({}),
      text: async () => "upstream busy",
    });
    const driver = createRedirectDecommissionDriver({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      core: mkCore(),
    });
    const r = await driver.run(
      {
        ...BASE_CTX,
        env: { POSTHOG_API_KEY: "phx_x", POSTHOG_PROJECT_ID: "proj" },
      },
      { key: "redirect_decommission:overall" },
    );
    // Regression guard: the monthly suppress rule relies on probeErrored
    // to distinguish "no candidates" from "audit failed". Do NOT collapse
    // transport failures into hasCandidates=false silent path.
    const sig = r.signal as { probeErrored: boolean; probeErrorDesc: string };
    expect(sig.probeErrored).toBe(true);
    expect(sig.probeErrorDesc).toMatch(/PostHog API error 503/);
  });

  it("fetch throws (network / DNS) → probeErrored=true", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ENOTFOUND eu.i.posthog.com");
    });
    const driver = createRedirectDecommissionDriver({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      core: mkCore(),
    });
    const r = await driver.run(
      {
        ...BASE_CTX,
        env: { POSTHOG_API_KEY: "phx_x", POSTHOG_PROJECT_ID: "proj" },
      },
      { key: "redirect_decommission:overall" },
    );
    const sig = r.signal as { probeErrored: boolean; probeErrorDesc: string };
    expect(sig.probeErrored).toBe(true);
    expect(sig.probeErrorDesc).toMatch(/ENOTFOUND/);
  });

  it("render-error path: computeRedirectDecommission throw → probeErrored=true", async () => {
    const fetchImpl = mkFetch({
      ok: true,
      status: 200,
      json: async () => ({ results: [] }),
      text: async () => "",
    });
    const driver = createRedirectDecommissionDriver({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      core: {
        seoRedirects: SAMPLE_REDIRECTS,
        computeRedirectDecommission: () => {
          throw new Error("core module missing");
        },
      },
    });
    const r = await driver.run(
      {
        ...BASE_CTX,
        env: { POSTHOG_API_KEY: "phx_x", POSTHOG_PROJECT_ID: "proj" },
      },
      { key: "redirect_decommission:overall" },
    );
    const sig = r.signal as { probeErrored: boolean; probeErrorDesc: string };
    expect(sig.probeErrored).toBe(true);
    expect(sig.probeErrorDesc).toMatch(/core module missing/);
  });

  it("driver exercises the real seo-redirects catalogue + computeRedirectDecommission", async () => {
    // Integration-coverage test: the default driver uses the hermetic
    // sibling-module imports (`./seo-redirects.js` +
    // `./redirect-decommission-core.js`). Previously this test exercised
    // the dynamic-import fallback across the shell + scripts trees; after
    // A3 the driver no longer touches those paths at runtime (the
    // Dockerfile never copied them, so they ENOENT'd in-container).
    // Keeping this test as an end-to-end smoke run that proves the
    // default driver wires through the real formatter + catalogue
    // without a stubbed core dep.
    const fetchImpl = mkFetch({
      ok: true,
      status: 200,
      json: async () => ({ results: [["A1", 42]] }),
      text: async () => "",
    });
    const driver = createRedirectDecommissionDriver({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      // No `core` override — exercises the default wiring (hermetic
      // sibling-module copies of the catalogue + formatter).
    });
    const r = await driver.run(
      {
        ...BASE_CTX,
        env: { POSTHOG_API_KEY: "phx_x", POSTHOG_PROJECT_ID: "proj" },
      },
      { key: "redirect_decommission:overall" },
    );
    const sig = r.signal as {
      body: string;
      candidateCount: number;
      hasCandidates: boolean;
      probeErrored: boolean;
      probeErrorDesc: string;
    };
    expect(sig.probeErrored).toBe(false);
    expect(r.state).toBe("green");
    // Real seo-redirects catalogue has 300+ entries; exactly one (A1)
    // has a hit, so hasCandidates must be true and the body must carry
    // the Slack header.
    expect(sig.hasCandidates).toBe(true);
    expect(sig.candidateCount).toBeGreaterThan(0);
    expect(sig.body).toContain(
      ":bar_chart: *SEO Redirect Decommission Report*",
    );
  });

  it("passes through empty PostHog results as events:[] (zero candidates possible even with no traffic)", async () => {
    const fetchImpl = mkFetch({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => "",
    });
    const captured: Array<{ events: unknown }> = [];
    const driver = createRedirectDecommissionDriver({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      core: mkCore((i) => {
        captured.push(i as { events: unknown });
        return { body: "", candidateCount: 0, hasCandidates: false };
      }),
    });
    await driver.run(
      {
        ...BASE_CTX,
        env: { POSTHOG_API_KEY: "phx_x", POSTHOG_PROJECT_ID: "proj" },
      },
      { key: "redirect_decommission:overall" },
    );
    expect(captured[0]!.events).toEqual([]);
  });

  it("threads ctx.abortSignal into the PostHog fetch (CR A1)", async () => {
    // Regression guard: the driver previously called fetchImpl without
    // forwarding the invoker's AbortController signal, so a hung
    // PostHog response kept its socket open past the synthetic-timeout
    // ProbeResult. Observe `init.signal` and confirm the pre-aborted
    // case surfaces through the probeErrored branch.
    let captured: AbortSignal | undefined;
    const fetchImpl: typeof fetch = async (_url, init) => {
      captured = (init as RequestInit | undefined)?.signal ?? undefined;
      if (captured?.aborted) {
        throw new DOMException("The operation was aborted", "AbortError");
      }
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const controller = new AbortController();
    const driver = createRedirectDecommissionDriver({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      core: mkCore(() => ({
        body: "",
        candidateCount: 0,
        hasCandidates: false,
      })),
    });
    await driver.run(
      {
        ...BASE_CTX,
        env: { POSTHOG_API_KEY: "phx_x", POSTHOG_PROJECT_ID: "proj" },
        abortSignal: controller.signal,
      },
      { key: "redirect_decommission:overall" },
    );
    expect(captured).toBe(controller.signal);

    controller.abort();
    const r = await driver.run(
      {
        ...BASE_CTX,
        env: { POSTHOG_API_KEY: "phx_x", POSTHOG_PROJECT_ID: "proj" },
        abortSignal: controller.signal,
      },
      { key: "redirect_decommission:overall" },
    );
    const sig = r.signal as { probeErrored: boolean; probeErrorDesc: string };
    expect(sig.probeErrored).toBe(true);
    expect(sig.probeErrorDesc).toMatch(/aborted/i);
  });
});
