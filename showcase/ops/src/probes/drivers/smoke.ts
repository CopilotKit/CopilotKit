import { z } from "zod";
import { deriveHealthUrl } from "../smoke.js";
import type { ProbeDriver } from "../types.js";
import type { ProbeContext, ProbeResult } from "../../types/index.js";

/**
 * Driver wrapper around the existing smoke probe. Converts a single
 * YAML-static target (`{ key, url }`) into the two ProbeResults the smoke
 * dimension has always emitted per tick:
 *
 *   1. `smoke:<slug>`  — the RETURN VALUE of `run()`. The invoker runs
 *      `writer.write()` on the returned result just like every other
 *      driver, so the primary smoke tick participates in the standard
 *      status-writer / alert-engine pipeline with no special-casing.
 *   2. `health:<slug>` — the side-emission. A driver `run()` can only
 *      return ONE ProbeResult (that's the `ProbeDriver` contract), so the
 *      paired `/health` check is pushed through `ctx.writer.write()` as
 *      a side-effect before returning. `ctx.writer` is wired by
 *      buildProbeInvoker; when absent (tests that don't care about the
 *      side tick, or legacy call sites) the driver skips the side-emit
 *      silently instead of throwing.
 *
 * Why not return `ProbeResult[]`? The invoker's fan-out and bookkeeping
 * is uniform across ALL drivers — one input, one primary result, one
 * writer.write. Teaching every driver, every test helper, and every
 * fan-out path to handle an array-of-results for a single edge case
 * would bleed smoke-specific semantics into the driver-framework core.
 * Writer side-emission is already a first-class capability of the
 * writer-engine pipeline, so using it here keeps smoke's paired-probe
 * behaviour contained to this file.
 *
 * Slug derivation: `input.key` arrives as `smoke:<slug>`; the driver
 * splits on `:` to produce the health key. If the input key doesn't
 * carry a `:` (e.g. a hand-wired caller passed `"smoke"`), we fall back
 * to using the full key as the slug — still produces a distinct
 * `health:<key>` tick so the side-emit path stays observable.
 *
 * Timeout: the driver OWNS the timeout, not the probe-invoker. The
 * invoker's `cfg.timeout_ms` guard bounds the whole `run()` call; inside
 * `run()`, each of the two HTTP GETs uses the same `timeout_ms` as an
 * AbortController limit so one slow endpoint (smoke OK, health hung)
 * can't gobble the invoker's whole budget and starve sibling targets
 * in the same tick.
 */

/**
 * Per-target input schema. `key` is the writer dedupe key the invoker
 * already validated at probe-loader time; `url` is the `/smoke` endpoint.
 * `passthrough()` is deliberately NOT used — the YAML shape is
 * exhaustively `{ key, url }`, so any extra per-target field is a
 * probable typo we want to reject at load time.
 */
const smokeInputSchema = z
  .object({
    key: z.string().min(1),
    url: z.string().url(),
  })
  .strict();

type SmokeDriverInput = z.infer<typeof smokeInputSchema>;

/**
 * Shared signal shape for both the smoke and the paired health
 * ProbeResult. `url` is the URL that was ACTUALLY probed (smoke URL for
 * the smoke result, health URL for the health result) so dashboards can
 * link operators directly to the endpoint that failed; `status` is the
 * numeric HTTP status (absent on network error / timeout so templates
 * can branch on its presence); `errorDesc` is a human-readable reason
 * that's safe to render in Slack. `latencyMs` is wall-clock measured
 * from `ctx.now()` so fake-timer tests produce deterministic numbers.
 */
export interface SmokeDriverSignal {
  slug: string;
  url: string;
  status?: number;
  errorDesc?: string;
  latencyMs: number;
}

export const smokeDriver: ProbeDriver<SmokeDriverInput, SmokeDriverSignal> = {
  kind: "smoke",
  inputSchema: smokeInputSchema,
  async run(ctx, input) {
    const fetchImpl = globalThis.fetch.bind(globalThis);
    const timeoutMs = readTimeoutMs(ctx);
    const slug = deriveSlug(input.key);
    const healthUrl = deriveHealthUrl(input.url);

    // Issue the smoke + health probes SEQUENTIALLY rather than in parallel.
    // Parallel would halve the wall-clock but would double the inflight
    // socket count per target; at max_concurrency=6 * 17 services * 2
    // endpoints that's 204 simultaneous TCP connections to Railway, which
    // has historically triggered edge-side rate limiting. Sequential keeps
    // the bound at max_concurrency * 2 = 12 — still well under any edge
    // threshold.
    const smokeResult = await probeOne({
      fetchImpl,
      url: input.url,
      key: input.key,
      slug,
      timeoutMs,
      now: ctx.now,
    });

    // Side-emit the health tick through ctx.writer BEFORE returning. If
    // the writer is absent (legacy call sites, tests that don't assert
    // on the side-emission) we log-and-skip — a missing writer is a
    // wiring issue, not a per-tick failure, and swallowing it keeps the
    // driver usable in unit tests that only care about the return value.
    const healthKey = `health:${slug}`;
    const healthResult = await probeOne({
      fetchImpl,
      url: healthUrl,
      key: healthKey,
      slug,
      timeoutMs,
      now: ctx.now,
    });
    if (ctx.writer) {
      try {
        await ctx.writer.write(healthResult);
      } catch (err) {
        // Writer failures on the side-emit path should NOT swallow the
        // primary smoke tick — that path is what the invoker is waiting
        // for. Log with enough context to correlate to the writer's own
        // `writer.failed` bus emission and keep going.
        ctx.logger.error("probe.smoke.health-writer-failed", {
          key: healthKey,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      ctx.logger.warn("probe.smoke.writer-missing", {
        key: input.key,
        healthKey,
      });
    }

    return smokeResult;
  },
};

/**
 * Per-endpoint probe — issues one HTTP GET with an AbortController
 * timeout, maps the result to a ProbeResult<SmokeDriverSignal>. Shared
 * between the smoke and health code paths so both produce identical
 * shapes (dashboards, templates, tests can all treat the two keys as
 * a matched pair).
 */
async function probeOne(opts: {
  fetchImpl: typeof fetch;
  url: string;
  key: string;
  slug: string;
  timeoutMs: number;
  now: () => Date;
}): Promise<ProbeResult<SmokeDriverSignal>> {
  const { fetchImpl, url, key, slug, timeoutMs, now } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = now().getTime();
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    const latencyMs = now().getTime() - started;
    const signal: SmokeDriverSignal = {
      slug,
      url,
      status: res.status,
      latencyMs,
    };
    if (!res.ok) {
      // 4xx / 5xx: mark red, but still attempt to surface a parsed body
      // if the endpoint returned JSON. We don't BLOCK on the body — a
      // hung body read after a 503 header is an easy way to stall the
      // whole tick. Opt for a best-effort text read with a hard bound.
      signal.errorDesc = `http ${res.status}`;
      const body = await safeReadBody(res);
      if (body && body.length > 0) {
        signal.errorDesc = `http ${res.status}: ${truncate(body, 160)}`;
      }
      return {
        key,
        state: "red",
        signal,
        observedAt: now().toISOString(),
      };
    }
    // Green path: sanity-check the body parses. A "200 OK" with an
    // HTML error page (e.g. misrouted edge) should NOT pass smoke.
    const parseErr = await verifyJsonBody(res);
    if (parseErr) {
      return {
        key,
        state: "red",
        signal: { ...signal, errorDesc: `malformed body: ${parseErr}` },
        observedAt: now().toISOString(),
      };
    }
    return {
      key,
      state: "green",
      signal,
      observedAt: now().toISOString(),
    };
  } catch (err) {
    const latencyMs = now().getTime() - started;
    const timedOut =
      err instanceof Error &&
      (err.name === "AbortError" || err.name === "TimeoutError") &&
      controller.signal.aborted;
    const errorDesc = timedOut
      ? `timeout after ${timeoutMs}ms`
      : err instanceof Error
        ? err.message
        : String(err);
    return {
      key,
      state: "red",
      signal: {
        slug,
        url,
        errorDesc,
        latencyMs,
      },
      observedAt: now().toISOString(),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extract `<slug>` from `"smoke:<slug>"`. Falls back to the whole key
 * when the colon is missing so a hand-wired caller still produces a
 * distinct `health:<key>` side-tick rather than a blank one.
 */
function deriveSlug(key: string): string {
  const parts = key.split(":");
  if (parts.length >= 2 && parts[1]!.length > 0) {
    return parts[1]!;
  }
  return key;
}

/**
 * Pull the driver's per-call timeout out of context. The invoker sets
 * no ctx-level timeout (it applies cfg.timeout_ms as an outer race),
 * but a driver-internal HTTP-level timeout is still required so one
 * hung endpoint doesn't starve its sibling probe on the same
 * invocation. Defaults to 10s — matches the YAML probe's
 * `timeout_ms: 10000`.
 */
function readTimeoutMs(ctx: ProbeContext): number {
  const fromEnv = ctx.env.SMOKE_TIMEOUT_MS;
  if (fromEnv) {
    const n = Number.parseInt(fromEnv, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 10_000;
}

/**
 * Best-effort body read, bounded so a hung response body can't stall
 * the probe past its timeout. Returns empty string when the body can't
 * be read — callers treat the absence as "no extra detail available"
 * rather than an error.
 */
async function safeReadBody(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

/**
 * Verify the 200-OK body is parseable JSON. Returns null on success
 * (or when the response has no body), or a short reason string on
 * failure. Non-JSON 200 (HTML error pages, edge-injected banners) is
 * treated as red with `malformed body: <reason>` so operators see
 * the actual shape of the wrongness in the ProbeResult.
 */
async function verifyJsonBody(res: Response): Promise<string | null> {
  const text = await safeReadBody(res);
  if (!text) return null;
  try {
    JSON.parse(text);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** Truncate a string to N chars, adding an ellipsis marker when clipped. */
function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
