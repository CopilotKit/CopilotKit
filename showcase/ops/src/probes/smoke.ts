import type { Probe, ProbeContext, ProbeResult } from "../types/index.js";

export interface SmokeInput {
  slug: string;
  url: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface SmokeSignal {
  slug: string;
  url: string;
  status?: number;
  errorDesc?: string;
  latencyMs?: number;
  links: { smoke: string; health: string };
}

export const smokeProbe: Probe<SmokeInput, SmokeSignal> = {
  dimension: "smoke",
  async run(
    input: SmokeInput,
    ctx: ProbeContext,
  ): Promise<ProbeResult<SmokeSignal>> {
    // Some runtimes (undici, certain bun builds) throw when `fetch` is invoked
    // without its `this` bound to globalThis. Bind defensively at dependency
    // construction so all call sites benefit.
    const fetchImpl = input.fetchImpl ?? globalThis.fetch.bind(globalThis);
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      input.timeoutMs ?? 15_000,
    );
    // Use ctx.now() for latency so fake clocks in tests apply uniformly with
    // the observedAt stamp. Mixing Date.now() here with ctx.now().toISOString()
    // below produces inconsistent timings under vi.useFakeTimers().
    const started = ctx.now().getTime();
    const links = {
      smoke: input.url,
      health: deriveHealthUrl(input.url),
    };
    try {
      const res = await fetchImpl(input.url, { signal: controller.signal });
      const latencyMs = ctx.now().getTime() - started;
      const state = res.ok ? "green" : "red";
      const signal: SmokeSignal = {
        slug: input.slug,
        url: input.url,
        status: res.status,
        latencyMs,
        links,
      };
      if (!res.ok) signal.errorDesc = `http ${res.status}`;
      return {
        key: `smoke:${input.slug}`,
        state,
        signal,
        observedAt: ctx.now().toISOString(),
      };
    } catch (err) {
      const latencyMs = ctx.now().getTime() - started;
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        key: `smoke:${input.slug}`,
        state: "red",
        signal: {
          slug: input.slug,
          url: input.url,
          errorDesc: errMsg,
          latencyMs,
          links,
        },
        observedAt: ctx.now().toISOString(),
      };
    } finally {
      clearTimeout(timeout);
    }
  },
};

/**
 * Derive a plausible health URL from the smoke URL by swapping a trailing
 * `/smoke` (with optional trailing slash) for `/health`. If the input URL
 * does not parse, return an empty string — templates should guard with
 * `{{#signal.links.health}}...{{/signal.links.health}}` rather than linking
 * to a misleading smoke URL.
 */
function deriveHealthUrl(url: string): string {
  try {
    const u = new URL(url);
    // Match `/smoke` at the end, optionally followed by a single trailing slash.
    if (/\/smoke\/?$/.test(u.pathname)) {
      u.pathname = u.pathname.replace(/\/smoke\/?$/, "/health");
    } else {
      u.pathname = u.pathname.replace(/\/$/, "") + "/health";
    }
    return u.toString();
  } catch {
    return "";
  }
}
