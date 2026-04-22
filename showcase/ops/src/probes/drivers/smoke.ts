import { z } from "zod";
import { deriveHealthUrl } from "../smoke.js";
import type { ProbeDriver } from "../types.js";
import type { ProbeContext, ProbeResult } from "../../types/index.js";

/**
 * Driver wrapper around the existing smoke probe. Converts a single YAML-
 * static target (`{ key, url }`) OR a railway-services discovery record
 * (`{ key, name, imageRef, publicUrl, env }`) into the THREE ProbeResults
 * the smoke dimension now emits per tick:
 *
 *   1. `smoke:<slug>`  — the RETURN VALUE of `run()`. The invoker runs
 *      `writer.write()` on the returned result just like every other
 *      driver, so the primary smoke tick participates in the standard
 *      status-writer / alert-engine pipeline with no special-casing.
 *   2. `health:<slug>` — side-emission #1 via `ctx.writer.write()`.
 *      Derived /health URL (via `deriveHealthUrl`) is GET-probed for
 *      a 200-OK JSON body, same contract as the smoke tick.
 *   3. `agent:<slug>`  — side-emission #2 via `ctx.writer.write()`. L2
 *      coverage: POSTs to `${backendUrl}/api/copilotkit/` with an empty
 *      JSON body and asserts the response is non-404. Matches the
 *      contract of `checkAgentEndpoint` in the e2e helpers — any
 *      non-404 response from the CopilotKit runtime proves it's mounted,
 *      a 404 means the route isn't wired (Next.js 404 page, wrong agent
 *      type, etc.). Green on non-404 2xx-5xx responses, red on 404 or
 *      transport failure.
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
 * Input shapes: the driver accepts TWO inputs.
 *   - Static YAML: `{ key, url }`. `url` is the `/smoke` endpoint; the
 *     derived /health + agent URLs come from path manipulation.
 *   - Discovery: `{ key, name, imageRef, publicUrl, env }`. The smoke
 *     URL is `${publicUrl}/smoke`; slug is `name` with the `showcase-`
 *     prefix stripped (`showcase-ag2` → `ag2`, `showcase-starter-ag2`
 *     → `starter-ag2`). `imageRef` + `env` are ignored by this driver
 *     but declared in the schema so the railway-services record passes
 *     through without a translation hop — same pattern image-drift uses.
 *
 * Slug derivation priority: (1) if `name` is present, strip the
 * `showcase-` prefix; (2) otherwise split `key` on `:` and take the
 * second segment. This keeps static-YAML ticks emitting the same
 * `smoke:<slug>`/`health:<slug>`/`agent:<slug>` triple the dashboard
 * expects while letting discovery-sourced ticks emit the same triple
 * without the YAML operator hand-editing key strings.
 *
 * Timeout: the driver OWNS the timeout, not the probe-invoker. The
 * invoker's `cfg.timeout_ms` guard bounds the whole `run()` call; inside
 * `run()`, each of the three HTTP calls uses the same `timeout_ms` as an
 * AbortController limit so one slow endpoint (smoke OK, health hung)
 * can't gobble the invoker's whole budget and starve sibling targets
 * in the same tick.
 */

/**
 * Per-target input schema. Two cases: static (`{key, url}`) and discovery
 * (`{key, name, publicUrl, ...}`). `passthrough()` tolerates the extra
 * discovery fields (`imageRef`, `env`) without requiring the schema to
 * enumerate them — the driver only reads the subset it needs and lets the
 * discovery source own the authoritative shape.
 */
const smokeInputSchema = z
  .object({
    key: z.string().min(1),
    /** Static mode: full `/smoke` URL. Optional in discovery mode — derived from `publicUrl`. */
    url: z.string().url().optional(),
    /** Discovery mode: Railway service name (`showcase-<slug>` or `showcase-starter-<slug>`). */
    name: z.string().min(1).optional(),
    /** Discovery mode: `https://<domain>` base URL. The driver appends `/smoke`. */
    publicUrl: z.string().optional(),
  })
  .passthrough()
  .refine((v) => v.url || (v.name && v.publicUrl), {
    message:
      "smoke driver requires either `url` (static) or `name`+`publicUrl` (discovery)",
  });

type SmokeDriverInput = z.infer<typeof smokeInputSchema>;

/**
 * Shared signal shape for the smoke, health, and agent ProbeResults.
 * `url` is the URL that was ACTUALLY probed (smoke URL, health URL, or
 * agent URL respectively) so dashboards can link operators directly to
 * the endpoint that failed; `status` is the numeric HTTP status (absent
 * on network error / timeout so templates can branch on its presence);
 * `errorDesc` is a human-readable reason that's safe to render in Slack.
 * `latencyMs` is wall-clock measured from `ctx.now()` so fake-timer
 * tests produce deterministic numbers.
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
    const fetchImpl = ctx.fetchImpl ?? globalThis.fetch.bind(globalThis);
    const timeoutMs = readTimeoutMs(ctx);
    const slug = deriveSlug(input);
    const { smokeUrl, healthUrl, agentUrl } = deriveUrls(input);
    // Primary key for the smoke ProbeResult. In DISCOVERY mode (when
    // `input.name` is set), `input.key` arrives as `smoke:showcase-ag2`
    // because the `key_template` in YAML interpolates `${name}` and
    // the template language has no string-munge function to strip the
    // prefix. Rewrite to `smoke:<slug>` here so dashboards/alerts that
    // match on `smoke:ag2` / `smoke:starter-ag2` stay intact under
    // both static and discovery call paths. In STATIC mode, pass the
    // YAML-authored key through verbatim so legacy callers keep their
    // exact `input.key` in the primary result.
    const primaryKey = input.name ? `smoke:${slug}` : input.key;

    // Issue the smoke + health + agent probes SEQUENTIALLY rather than
    // in parallel. Parallel would cut wall-clock but would triple the
    // inflight socket count per target; at max_concurrency=6 * 34
    // services * 3 endpoints that's 612 simultaneous TCP connections to
    // Railway, which has historically triggered edge-side rate
    // limiting. Sequential keeps the bound at max_concurrency * 3 = 18 —
    // still well under any edge threshold.
    const smokeResult = await probeOne({
      fetchImpl,
      url: smokeUrl,
      key: primaryKey,
      slug,
      timeoutMs,
      now: ctx.now,
      method: "GET",
    });

    // Side-emit #1: health tick.
    const healthKey = `health:${slug}`;
    const healthResult = await probeOne({
      fetchImpl,
      url: healthUrl,
      key: healthKey,
      slug,
      timeoutMs,
      now: ctx.now,
      method: "GET",
    });
    await sideEmit(ctx, healthResult, healthKey);

    // Side-emit #2: agent endpoint POST. Non-404 2xx-5xx response is
    // green (proves the CopilotKit runtime is mounted); 404 and
    // transport failures are red. This mirrors the L2 `@agent`
    // assertion in `integration-smoke.spec.ts:311`.
    const agentKey = `agent:${slug}`;
    const agentResult = await probeAgent({
      fetchImpl,
      url: agentUrl,
      key: agentKey,
      slug,
      timeoutMs,
      now: ctx.now,
    });
    await sideEmit(ctx, agentResult, agentKey);

    return smokeResult;
  },
};

/**
 * Write a side-emit ProbeResult through `ctx.writer`. Absent writer is a
 * wiring issue, not a per-tick failure — log-and-skip so the driver stays
 * usable in unit tests that only care about the primary return value. A
 * writer throw is non-fatal for the same reason: the primary smoke tick
 * is what the invoker is waiting on; a side-emit writer hiccup must not
 * take the primary result down with it.
 */
async function sideEmit<T>(
  ctx: ProbeContext,
  result: ProbeResult<T>,
  key: string,
): Promise<void> {
  if (!ctx.writer) {
    ctx.logger.warn("probe.smoke.writer-missing", { key });
    return;
  }
  try {
    await ctx.writer.write(result);
  } catch (err) {
    ctx.logger.error("probe.smoke.side-emit-writer-failed", {
      key,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Per-endpoint GET probe — issues one HTTP request with an AbortController
 * timeout, maps the result to a ProbeResult<SmokeDriverSignal>. Shared
 * between the smoke and health code paths so both produce identical
 * shapes (dashboards, templates, tests can all treat the two keys as a
 * matched pair). The `method` parameter lets callers swap GET/POST when
 * a probe semantics differ — currently only GET is used here since the
 * agent POST path has distinct success criteria and lives in `probeAgent`.
 */
async function probeOne(opts: {
  fetchImpl: typeof fetch;
  url: string;
  key: string;
  slug: string;
  timeoutMs: number;
  now: () => Date;
  method: "GET" | "POST";
}): Promise<ProbeResult<SmokeDriverSignal>> {
  const { fetchImpl, url, key, slug, timeoutMs, now, method } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = now().getTime();
  try {
    const res = await fetchImpl(url, {
      method,
      signal: controller.signal,
    });
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
 * L2 agent-endpoint check. POSTs `{}` (JSON-parseable empty body) to the
 * CopilotKit runtime path and classifies the response:
 *   - 2xx / 3xx / non-404 4xx / 5xx  → GREEN: runtime is mounted and
 *     responding. The CopilotKit Hono router answers its own errors on
 *     malformed payloads, so even a 400 proves the runtime is there.
 *   - 404                            → RED: the route isn't wired (the
 *     host returned a generic not-found page, wrong agent type, etc.).
 *   - transport failure / timeout    → RED with the raw reason.
 *
 * This matches the acceptance contract of `checkAgentEndpoint` in
 * `showcase/tests/e2e/helpers.ts`: any non-404 response is proof-of-life.
 * We don't GET /info first like the helper does — the helper runs in
 * Playwright where it can afford two round-trips; the probe budget is
 * per-tick tight (3 endpoints × 34 services × sequential) so we keep it
 * to a single POST.
 */
async function probeAgent(opts: {
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
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: controller.signal,
    });
    const latencyMs = now().getTime() - started;
    const signal: SmokeDriverSignal = {
      slug,
      url,
      status: res.status,
      latencyMs,
    };
    if (res.status === 404) {
      const body = await safeReadBody(res);
      signal.errorDesc =
        body.length > 0
          ? `agent endpoint 404: ${truncate(body, 160)}`
          : "agent endpoint 404 — route not mounted";
      return {
        key,
        state: "red",
        signal,
        observedAt: now().toISOString(),
      };
    }
    // Any other response is proof the runtime is mounted. We intentionally
    // don't inspect the body — the CopilotKit runtime may return a
    // structured error for the empty `{}` payload, but that's still a
    // successful L2 signal: the route answered.
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
 * Derive the slug from driver input. Discovery shape wins: strip the
 * `showcase-` prefix from `name` so `showcase-ag2` → `ag2` and
 * `showcase-starter-ag2` → `starter-ag2`. Static shape falls back to
 * splitting the key on `:` — matches the pre-discovery behaviour so
 * static-YAML callers keep emitting the same `smoke:<slug>` rows.
 *
 * When neither field yields a non-empty slug, fall back to the whole
 * key so a hand-wired caller (`{key:"bare", url:...}`) still produces
 * a distinct `health:bare` / `agent:bare` side-tick rather than a
 * blank one.
 */
function deriveSlug(input: SmokeDriverInput): string {
  if (input.name) {
    const stripped = input.name.replace(/^showcase-/, "");
    if (stripped.length > 0) return stripped;
  }
  const parts = input.key.split(":");
  if (parts.length >= 2 && parts[1]!.length > 0) {
    return parts[1]!;
  }
  return input.key;
}

interface DerivedUrls {
  smokeUrl: string;
  healthUrl: string;
  agentUrl: string;
}

/**
 * Derive the three per-target URLs from the input shape.
 *
 *   - Discovery mode (`publicUrl` present): smoke = `${publicUrl}/smoke`,
 *     health = `${publicUrl}/health`, agent = `${publicUrl}/api/copilotkit/`.
 *     The trailing slash on the agent path mirrors the runtime router's
 *     expectation — CopilotKit Hono routes are mounted at
 *     `/api/copilotkit/` with a trailing slash in every showcase.
 *   - Static mode (`url` present): smoke = input URL, health derived
 *     via `deriveHealthUrl`, agent derived by swapping the trailing
 *     `/smoke` for `/api/copilotkit/`.
 *
 * Static-mode agent URL derivation is the weak link — the smoke URL
 * doesn't carry the agent-path convention — but static mode is a
 * fallback for operator-authored test configs, not the production
 * path (which is discovery). When the discovery migration completes,
 * static-mode callers can pass an explicit agent URL in a future
 * schema extension if needed.
 */
function deriveUrls(input: SmokeDriverInput): DerivedUrls {
  if (input.publicUrl) {
    const base = input.publicUrl.replace(/\/$/, "");
    return {
      smokeUrl: `${base}/smoke`,
      healthUrl: `${base}/health`,
      agentUrl: `${base}/api/copilotkit/`,
    };
  }
  // Static fallback. `url` is guaranteed present by the refine() guard
  // in `smokeInputSchema` when `publicUrl` is absent.
  const smokeUrl = input.url!;
  const healthUrl = deriveHealthUrl(smokeUrl);
  const agentUrl = deriveAgentUrl(smokeUrl);
  return { smokeUrl, healthUrl, agentUrl };
}

/**
 * Derive an agent URL from a smoke URL by swapping the trailing `/smoke`
 * path for `/api/copilotkit/`. Mirrors `deriveHealthUrl`'s approach so a
 * static-mode caller gets a best-effort agent path without hand-editing.
 * Empty string on parse failure — the probe will then hit `` which
 * fetch() rejects as a transport error, flipping the row red with a
 * readable reason.
 */
function deriveAgentUrl(url: string): string {
  try {
    const u = new URL(url);
    if (/\/smoke\/?$/.test(u.pathname)) {
      u.pathname = u.pathname.replace(/\/smoke\/?$/, "/api/copilotkit/");
    } else {
      u.pathname = u.pathname.replace(/\/$/, "") + "/api/copilotkit/";
    }
    return u.toString();
  } catch {
    return "";
  }
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
