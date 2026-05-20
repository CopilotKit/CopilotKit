import type { Probe, ProbeContext, ProbeResult } from "../types/index.js";

export interface LivenessInput {
  slug: string;
  url: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface LivenessSignal {
  slug: string;
  url: string;
  status?: number;
  errorDesc?: string;
  latencyMs?: number;
  links: { smoke: string; health: string };
}

export const livenessProbe: Probe<LivenessInput, LivenessSignal> = {
  dimension: "smoke",
  async run(
    input: LivenessInput,
    ctx: ProbeContext,
  ): Promise<ProbeResult<LivenessSignal>> {
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
      const signal: LivenessSignal = {
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
      // Differentiate our own timeout abort from other AbortErrors / rejection
      // reasons. Without this branch the caller sees the DOM-ish
      // "This operation was aborted" which is indistinguishable from an
      // externally-triggered cancellation.
      const timedOut =
        err instanceof Error &&
        (err.name === "AbortError" || err.name === "TimeoutError") &&
        controller.signal.aborted;
      const errMsg = timedOut
        ? `timeout after ${input.timeoutMs ?? 15_000}ms`
        : err instanceof Error
          ? err.message
          : String(err);
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
 * Fields on smoke signal that are safe for triple-brace interpolation.
 *
 * Double-brace HTML-escapes every value via Mustache's default, which turns
 * `/` into `&#x2F;` inside the rendered text. That breaks Slack link markup
 * `<URL|label>` because the escaped URL is no longer a valid scheme — Slack
 * renders the raw text instead of a clickable link. The smoke template
 * interpolates `signal.links.smoke` / `signal.links.health` directly inside
 * `< ... |label>` pairs, so both fields must be triple-brace safe.
 *
 * Structurally these URLs are produced by the smoke probe itself (caller
 * supplies `input.url`; the probe derives the health URL by path-swap in
 * `deriveHealthUrl`). Neither flows from untrusted user input — they're
 * operator-configured service URLs. Safe to emit without HTML-escape.
 */
export const LIVENESS_SLACK_SAFE_FIELDS = [
  // A3: the `links` object lives on the old `LivenessSignal` shape below (still
  // exported for backward compatibility). The driver-emitted
  // `SmokeDriverSignal` (probes/drivers/liveness.ts) carries `url` instead —
  // the URL that was actually probed — which is now the canonical field
  // template authors reference for endpoint links.
  "url",
  // errorDesc is pre-sanitized at the probe driver's 8 assignment sites
  // (probes/drivers/liveness.ts via sanitizeErrorDesc) — triple-brace is
  // intentional so already-stripped HTML / mrkdwn control tokens render
  // as literal characters in Slack rather than being double-escaped.
  "errorDesc",
] as const;

/**
 * Derive a plausible health URL from the smoke URL by swapping a trailing
 * `/smoke` (with optional trailing slash) for `/health`. If the input URL
 * does not parse, return an empty string — templates should guard with
 * `{{#signal.links.health}}...{{/signal.links.health}}` rather than linking
 * to a misleading smoke URL.
 */
export function deriveHealthUrl(url: string): string {
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
