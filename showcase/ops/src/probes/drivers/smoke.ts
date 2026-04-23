import { z } from "zod";
import { deriveHealthUrl } from "../smoke.js";
import {
  resolveShape,
  showcaseShapeSchema,
  type ShowcaseServiceShape,
} from "../discovery/railway-services.js";
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
 * Per-target input schema, shaped as a discriminated union on `mode` so
 * the two call paths (`static` / `discovery`) are type-level distinct.
 * Each branch carries exactly the fields it needs; the non-null assertion
 * previously used on `input.url` (static path) and ad-hoc `refine()`s
 * that expressed `url XOR (name+publicUrl)` + `no shape with url` are
 * replaced by the discriminator, which `tsc` can narrow directly.
 *
 * Both branches keep `mode` optional so existing callers (YAML,
 * orchestrator, unit tests) that pre-date the discriminator still parse
 * and run unchanged; `normaliseMode()` at the top of `run()` fills it
 * in from field presence before any downstream narrowing. The discovery
 * branch `.passthrough()`s so the orchestrator can spread a full
 * `RailwayServiceInfo` (`{ name, publicUrl, imageRef, env, shape }`)
 * into the input without pre-filtering fields.
 */
const staticSmokeInputSchema = z
  .object({
    mode: z.literal("static").optional(),
    key: z.string().min(1),
    /** Static mode: full `/smoke` URL. */
    url: z.string().url(),
  })
  .strict();

const discoverySmokeInputSchema = z
  .object({
    mode: z.literal("discovery").optional(),
    key: z.string().min(1),
    /** Discovery mode: Railway service name (`showcase-<slug>` or `showcase-starter-<slug>`). */
    name: z.string().min(1),
    /** Discovery mode: `https://<domain>` base URL. The driver appends `/smoke` or `/api/health` per shape. */
    publicUrl: z.string().url(),
    /**
     * Deployment shape tag from the discovery source
     * (`discovery/railway-services.ts`). Controls which URL contract the
     * driver exercises:
     *
     *   - `package` → legacy `/smoke` + `/health` + `/api/copilotkit/`.
     *   - `starter` → `/api/health` (primary + side-emit) +
     *                 `/api/copilotkit/`. Starters have no `/smoke`
     *                 route; using the legacy contract produces one
     *                 false-red row per starter per endpoint.
     *
     * Optional — when absent the driver reclassifies from `name` at
     * run() entry. When both are present and the classifier disagrees
     * with the explicit value, the driver throws; silent drift between
     * the classifier and caller-supplied shape is the exact failure
     * mode this contract is meant to prevent.
     */
    shape: showcaseShapeSchema.optional(),
  })
  .passthrough();

/**
 * Raw schema produced by `smokeInputSchema.parse()` / `.safeParse()`.
 * Both branches leave `mode` optional — `normaliseMode` at the top of
 * `run()` fills in the discriminator from field presence (`url` ⇒
 * static, `name+publicUrl` ⇒ discovery) and produces a
 * `NormalisedSmokeInput` that the rest of the driver narrows against.
 *
 * The union contract is re-asserted at parse time via `.superRefine()`:
 *   - Exactly one of `(url)` OR `(name + publicUrl)` must be present.
 *     A caller passing all three gets rejected here, which matters
 *     because the discovery arm's `.passthrough()` would otherwise let
 *     the mixed payload through.
 *   - `shape` is only valid alongside the discovery fields; setting
 *     `shape` with `url` is a structural mistake (static mode predates
 *     shape detection and is always package).
 *
 * Callers doing `smokeInputSchema.safeParse()` in isolation now see a
 * unified rejection path for structural invariants regardless of which
 * arm's strictness caught the bad field.
 */
const smokeInputSchema = z
  .union([staticSmokeInputSchema, discoverySmokeInputSchema])
  .superRefine((val, ctx) => {
    const raw = val as {
      url?: unknown;
      name?: unknown;
      publicUrl?: unknown;
      shape?: unknown;
    };
    const hasUrl = typeof raw.url === "string";
    const hasDiscovery =
      typeof raw.name === "string" && typeof raw.publicUrl === "string";
    if (hasUrl && hasDiscovery) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "smoke input: pass either `url` (static) OR `name`+`publicUrl` (discovery), not both",
      });
    }
    if (!hasUrl && !hasDiscovery) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "smoke input: requires either `url` (static) or `name`+`publicUrl` (discovery)",
      });
    }
    if (hasUrl && raw.shape !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "smoke input: `shape` is only valid with discovery mode (`name`+`publicUrl`)",
      });
    }
  });

type SmokeDriverInput = z.infer<typeof smokeInputSchema>;

/**
 * Internal, post-normalisation form. `mode` is required here so every
 * downstream helper narrows by discriminator without a fallback branch.
 * The discovery arm intentionally does NOT carry a `[k: string]: unknown`
 * index signature: passthrough extras from the raw input are not read
 * downstream, and keeping them off the type forces `input.url` in a
 * `mode === "discovery"` branch to be a TS error rather than silently
 * typechecking as `unknown`.
 */
type NormalisedSmokeInput =
  | { mode: "static"; key: string; url: string }
  | {
      mode: "discovery";
      key: string;
      name: string;
      publicUrl: string;
      shape?: ShowcaseServiceShape;
    };

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
  async run(ctx, rawInput) {
    // Normalise mode at the boundary. Schema-parsed inputs (orchestrator
    // path) carry `mode` via the union default; tests that hand a raw
    // object to `driver.run()` omit it. Field presence is the runtime
    // discriminator: `url` present ⇒ static, `name`+`publicUrl` ⇒
    // discovery. After this cast the rest of the function narrows via
    // `input.mode` alone.
    const input = normaliseMode(rawInput);
    const fetchImpl = ctx.fetchImpl ?? globalThis.fetch.bind(globalThis);
    const timeoutMs = readTimeoutMs(ctx);
    const slug = deriveSlug(input);
    // Shape resolution delegates to the shared resolveShape helper in
    // `discovery/railway-services.ts` — classifier wins on `name`, throws
    // on explicit-vs-classifier disagreement, honours explicit `shape`
    // otherwise. Thread `ctx.logger` so the classifier's audit-warn fires
    // on the driver path too.
    const shape = resolveShape(
      input.mode === "discovery"
        ? { name: input.name, shape: input.shape }
        : {},
      { logger: ctx.logger },
    );
    const { smokeUrl, healthUrl, agentUrl } = deriveUrls(input, shape);
    // Primary key for the smoke ProbeResult. In DISCOVERY mode,
    // `input.key` arrives as `smoke:showcase-ag2` because the
    // `key_template` in YAML interpolates `${name}` and the template
    // language has no string-munge function to strip the prefix.
    // Rewrite to `smoke:<slug>` here so dashboards/alerts that match on
    // `smoke:ag2` / `smoke:starter-ag2` stay intact. In STATIC mode,
    // pass the YAML-authored key through verbatim so legacy callers
    // keep their exact `input.key` in the primary result.
    const primaryKey = input.mode === "discovery" ? `smoke:${slug}` : input.key;

    // Sequential issue of smoke + health + agent to keep inflight socket
    // count bounded at max_concurrency × 3 — Railway's edge has
    // historically rate-limited at higher parallelism, so we eat the
    // wall-clock cost to stay well under any edge threshold.
    //
    // Starter shape hits the same endpoint (`/api/health`) for both the
    // primary smoke tick and the health side-emit. We intentionally run
    // TWO independent GETs rather than reusing the first result: the
    // `smoke:<slug>` and `health:<slug>` rows feed separate alert
    // dimensions (`dimension: smoke` vs `dimension: health`) that
    // dashboards compare for correlation, and a single-GET-reuse would
    // make the two rows byte-identical and defeat that signal. The extra
    // round-trip is a cheap liveness check against the same endpoint.
    const smokeResult = await probeOne({
      fetchImpl,
      url: smokeUrl,
      key: primaryKey,
      slug,
      timeoutMs,
      now: ctx.now,
      method: "GET",
    });

    // Side-emit #1: health tick. Always a fresh GET — even when smokeUrl
    // === healthUrl (starter shape), see the comment block above for why
    // we do NOT reuse the smoke result.
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
 * Normalise a driver input into the `SmokeDriverInput` discriminated
 * union. Schema-parsed inputs already carry `mode` via the union
 * default, but callers that hand a raw object straight to `driver.run()`
 * (unit tests, ad-hoc integrations) omit it. We detect mode from field
 * presence: `url` present ⇒ static; `name` + `publicUrl` present ⇒
 * discovery. When neither matches, throw loud — the previous ad-hoc
 * `.refine()` guards enforced the same invariant and the discriminated
 * union needs to preserve that behaviour for unparsed-input callers.
 */
function normaliseMode(input: unknown): NormalisedSmokeInput {
  const raw = input as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") {
    throw new Error("smoke driver: input must be an object");
  }
  // Field presence is the sole discriminator. A caller-supplied `raw.mode`
  // ("static" / "discovery") is ignored here — a previous early-return
  // arm trusted `raw.mode` verbatim and let malformed inputs like
  // `{mode:"static", key:"k"}` (no `url`) slip through. Letting the
  // field-presence branches classify instead means the two paths are
  // consistent between schema-parsed and raw inputs, and a bad shape
  // throws loud rather than coercing.
  if (typeof raw.key !== "string" || raw.key.length === 0) {
    throw new Error("smoke driver: input.key is required");
  }
  if (typeof raw.url === "string") {
    return {
      mode: "static",
      key: raw.key,
      url: raw.url,
    };
  }
  if (typeof raw.name === "string" && typeof raw.publicUrl === "string") {
    const shape =
      typeof raw.shape === "string"
        ? (raw.shape as ShowcaseServiceShape)
        : undefined;
    return {
      mode: "discovery",
      key: raw.key,
      name: raw.name,
      publicUrl: raw.publicUrl,
      shape,
    };
  }
  throw new Error(
    "smoke driver: input requires either `url` (static) or `name`+`publicUrl` (discovery)",
  );
}

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
 * Playwright where it can afford two round-trips; the probe budget per
 * tick is tight (N services × sequential endpoints) so we keep the agent
 * check to a single POST.
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
      // Railway's Next.js edge serves a 308 for the trailing-slash
      // variant of `/api/copilotkit/` → `/api/copilotkit`. Without
      // following, the probe classifies the raw 308 as proof-of-life,
      // which quietly masks regressions where the redirect target is a
      // 404 (route actually unmounted). Following means we judge the
      // FINAL response: a runtime-rejected `{}` payload (400) stays
      // green, but an unmounted route (final 404) correctly flips red.
      redirect: "follow",
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
function deriveSlug(input: NormalisedSmokeInput): string {
  if (input.mode === "discovery") {
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
function deriveUrls(
  input: NormalisedSmokeInput,
  shape: ShowcaseServiceShape,
): DerivedUrls {
  if (input.mode === "discovery") {
    const base = input.publicUrl.replace(/\/$/, "");
    if (shape === "starter") {
      // Starters expose `/api/health` as the canonical liveness route
      // (see any starter's `app/api/health/route.ts`). There is no
      // `/smoke` and no separate `/health` route — both the primary
      // smoke probe and the health side-emit target `/api/health`. The
      // two calls are intentionally independent round-trips; see the
      // run() comment block for why.
      return {
        smokeUrl: `${base}/api/health`,
        healthUrl: `${base}/api/health`,
        agentUrl: `${base}/api/copilotkit/`,
      };
    }
    return {
      smokeUrl: `${base}/smoke`,
      healthUrl: `${base}/health`,
      agentUrl: `${base}/api/copilotkit/`,
    };
  }
  // Static mode. The discriminated union guarantees `url` is present
  // here; static mode predates shape detection and always assumes
  // package shape — the YAML author already picked concrete URLs.
  const smokeUrl = input.url;
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
