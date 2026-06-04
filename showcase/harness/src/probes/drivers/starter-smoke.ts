import { z } from "zod";
import { sanitizeErrorDesc } from "./sanitize.js";
import {
  STARTER_LEVELS,
  starterToColumnSlug,
  type StarterLevel,
} from "../helpers/starter-mapping.js";
import type { ProbeDriver } from "../types.js";
import type { ProbeContext, ProbeResult } from "../../types/index.js";

/**
 * starter_smoke driver — per-starter L1–L4 smoke health over HTTP.
 *
 * This is the harness twin of the GitHub-Actions `smoke-starter` matrix
 * (`showcase/tests/e2e/starter-smoke.spec.ts`): instead of building each
 * starter image and running Playwright in CI, it HTTP-probes each starter's
 * own deployed (scale-to-zero) Railway service on the harness cadence. The
 * model is the *same* probe machinery the `smoke` dimension (`liveness.ts`)
 * already runs against the 19 deployed showcase services — no new harness
 * capability, no Docker-on-harness, no browser.
 *
 * One invocation = one starter service. Per starter the driver issues FOUR
 * HTTP checks against the deployed base URL and side-emits one row per
 * level plus an aggregate primary:
 *
 *   - **health**      GET  `${base}/api/health` → 200 + JSON-parseable body.
 *                     Mirrors the `@health` tag (health endpoint responds).
 *   - **agent**       POST `${base}/api/copilotkit/` with `{}` → any non-404
 *                     response. Reuses the exact `checkAgentEndpoint`
 *                     contract `liveness.ts`'s smoke agent check uses: a
 *                     non-404 proves the CopilotKit runtime is mounted; a
 *                     404 means the route isn't wired.
 *   - **chat**        POST `${base}/api/copilotkit/` with a minimal chat
 *                     round-trip payload (aimock answers it) → a non-empty
 *                     response body. Mirrors the `@chat` tag (chat
 *                     round-trip via aimock returns a response) but over a
 *                     single HTTP turn rather than a browser.
 *   - **interaction** GET `${base}/` → 200 (the app shell serves). Mirrors
 *                     the `@interaction` tag, which branches on `hasAppMode`
 *                     (`starter-smoke.spec.ts:123`). We keep this check
 *                     GENERIC — both the App-mode and CopilotSidebar
 *                     starters serve the same root shell, so an HTTP-level
 *                     "root page renders" signal stays valid for every
 *                     starter without encoding per-starter UI branching the
 *                     way the Playwright spec does. `hasAppMode` is accepted
 *                     in the input (so the row/tooltip can stay generic and
 *                     a future browser-based interaction probe can branch)
 *                     but does NOT change the HTTP behaviour here.
 *
 * Side-emit + slug remap (mirrors `e2e-readiness.ts` / `d4-chat-roundtrip.ts`):
 * the starter slug from discovery (`starter-<slug>` Railway service name) is
 * remapped to the dashboard COLUMN slug via `starterToColumnSlug` (S1's
 * single source of truth) BEFORE any emit, so the dashboard only ever sees
 * column slugs. Per starter the driver writes four side rows
 * `starter:<column-slug>/<level>` via `makeSideEmit`, plus an aggregate
 * `starter:<column-slug>` primary (the `run()` return value, picked up by
 * the invoker's `writer.write()` like every other driver).
 *
 * Transport-failure classification (mirrors `e2e-readiness.ts`'s keyed
 * `errorClass`): a scale-to-zero starter must WAKE on the probe's first
 * request, and that cold-start can legitimately exceed the per-check
 * timeout. We do NOT let a wake/transport hiccup read as a hard red. A
 * fetch-level failure (timeout, connection refused, DNS, abort) is emitted
 * with `errorClass: "transport-error"` so the dashboard / alert rules can
 * branch on a stable discriminator and let the two-miss staleness rule
 * absorb a single slow wake — distinct from `errorClass: "smoke-failed"` (a
 * real HTTP-level regression: 404 agent route, 500 health, empty chat).
 *
 * Live-wiring against real Railway starter services is gated on a separate
 * slot (the services don't exist yet); this driver is unit-tested with a
 * stubbed `fetchImpl` and ships ready for that slot to point it at the
 * deployed base URLs.
 */

/**
 * Per-target input. Discovery (`railway-services`) populates `name`
 * (`starter-<slug>`) + `publicUrl`; `hasAppMode` is optional advisory
 * metadata (see the interaction-check note above). `.passthrough()` so a
 * full discovery record can spread in without pre-filtering, matching the
 * smoke / e2e drivers.
 */
const inputSchema = z
  .object({
    key: z.string().min(1),
    /** Railway service name (`starter-<slug>`). */
    name: z.string().min(1),
    /** `https://<domain>` base URL of the deployed starter service. */
    publicUrl: z.string().url(),
    /**
     * Whether the starter exposes the Chat/App mode toggle
     * (`starter-smoke.spec.ts`). Advisory only — the HTTP interaction check
     * stays generic regardless. Defaults to false when absent.
     */
    hasAppMode: z.boolean().optional(),
  })
  .passthrough();

type StarterSmokeDriverInput = z.infer<typeof inputSchema>;

/**
 * Aggregate signal on the primary `starter:<column-slug>` result.
 * `failed` lists the levels that flipped red; `errorClass` is the worst
 * keyed failure class across the four checks (`transport-error` is treated
 * as softer than `smoke-failed` for dashboard branching).
 */
export interface StarterSmokeAggregateSignal {
  starterSlug: string;
  columnSlug: string;
  publicUrl: string;
  total: number;
  passed: number;
  failed: StarterLevel[];
  /** Worst keyed failure class across levels, when the aggregate is red. */
  errorClass?: StarterFailureClass;
}

/** Per-level side-emit signal on each `starter:<column-slug>/<level>` row. */
export interface StarterSmokeLevelSignal {
  starterSlug: string;
  columnSlug: string;
  level: StarterLevel;
  /** The URL actually probed for this level. */
  url: string;
  /** Numeric HTTP status; absent on transport failure / timeout. */
  status?: number;
  /** Slack-safe human-readable failure reason (red rows only). */
  errorDesc?: string;
  /** Keyed failure class (red rows only). */
  errorClass?: StarterFailureClass;
  latencyMs: number;
}

/**
 * Keyed failure taxonomy. `transport-error` (timeout / cold-start wake /
 * connection failure) is deliberately distinct from `smoke-failed` (a real
 * HTTP-level regression) so a scale-to-zero wake hiccup never masquerades
 * as a hard red. `aborted` is the external-abort / outer-timeout case.
 */
export type StarterFailureClass =
  | "transport-error"
  | "smoke-failed"
  | "aborted";

const DEFAULT_TIMEOUT_MS = 30_000;
const TIMEOUT_ENV_VAR = "STARTER_SMOKE_TIMEOUT_MS";

/**
 * Minimal chat round-trip payload posted to the CopilotKit runtime. The
 * runtime answers this with a streamed/structured response that aimock
 * fulfils; we only assert the response is non-empty (the `@chat` contract:
 * "chat round-trip via aimock returns a response"). Kept intentionally
 * minimal — a full GraphQL `generateCopilotResponse` body would couple the
 * probe to the runtime's request schema, which drifts; a non-empty body
 * from a non-404 POST is sufficient proof-of-life for the chat path.
 */
const CHAT_PROBE_BODY = JSON.stringify({
  messages: [{ role: "user", content: "Hello" }],
});

export function createStarterSmokeDriver(
  deps: { timeoutMs?: number } = {},
): ProbeDriver<StarterSmokeDriverInput, StarterSmokeAggregateSignal> {
  const depTimeoutMs = deps.timeoutMs;
  return {
    kind: "starter_smoke",
    inputSchema,
    async run(
      ctx: ProbeContext,
      input: StarterSmokeDriverInput,
    ): Promise<ProbeResult<StarterSmokeAggregateSignal>> {
      const observedAt = ctx.now().toISOString();
      const fetchImpl = ctx.fetchImpl ?? globalThis.fetch.bind(globalThis);
      const timeoutMs = resolveTimeoutMs(ctx, depTimeoutMs);
      const starterSlug = deriveStarterSlug(input.name);
      const base = input.publicUrl.replace(/\/$/, "");

      // Remap starter slug → dashboard column slug (S1's source of truth)
      // BEFORE any emit so the dashboard only ever sees column slugs.
      const columnSlug = starterToColumnSlug(starterSlug);
      if (!columnSlug) {
        // An unmapped starter service is a config/mapping drift (a new
        // starter deployed before its remap entry landed). Surface it as a
        // red aggregate with a keyed class so the slug-drift lint test and
        // operators see it, rather than a silent fan-out hole. No column
        // slug means we cannot key per-level rows, so only the primary is
        // emitted (under the un-remapped starter key as a last resort).
        ctx.logger.warn("probe.starter-smoke.unmapped-starter", {
          starterSlug,
          name: input.name,
        });
        return {
          key: `starter:${starterSlug}`,
          state: "red",
          signal: {
            starterSlug,
            columnSlug: starterSlug,
            publicUrl: base,
            total: 0,
            passed: 0,
            failed: [...STARTER_LEVELS],
            errorClass: "smoke-failed",
          },
          observedAt,
        };
      }

      const sideEmit = makeSideEmit(ctx);

      // Per-level URL + probe method. Each level owns its own HTTP call and
      // success criterion so a single hung endpoint can't blind its
      // siblings (the same paired-probe isolation `liveness.ts` keeps).
      const levelUrls: Record<StarterLevel, string> = {
        health: `${base}/api/health`,
        agent: `${base}/api/copilotkit/`,
        chat: `${base}/api/copilotkit/`,
        interaction: `${base}/`,
      };

      const failed: StarterLevel[] = [];
      let passed = 0;
      let worstClass: StarterFailureClass | undefined;

      for (const level of STARTER_LEVELS) {
        const url = levelUrls[level];
        const result = await probeLevel({
          fetchImpl,
          level,
          url,
          timeoutMs,
          now: ctx.now,
          abortSignal: ctx.abortSignal,
        });

        const state = result.ok ? "green" : "red";
        if (result.ok) {
          passed++;
        } else {
          failed.push(level);
          worstClass = worsen(worstClass, result.errorClass);
        }

        await sideEmit({
          key: `starter:${columnSlug}/${level}`,
          state,
          signal: {
            starterSlug,
            columnSlug,
            level,
            url,
            status: result.status,
            errorDesc: result.errorDesc,
            errorClass: result.ok ? undefined : result.errorClass,
            latencyMs: result.latencyMs,
          },
          observedAt: ctx.now().toISOString(),
        });
      }

      const aggregateGreen = failed.length === 0;
      return {
        key: `starter:${columnSlug}`,
        state: aggregateGreen ? "green" : "red",
        signal: {
          starterSlug,
          columnSlug,
          publicUrl: base,
          total: STARTER_LEVELS.length,
          passed,
          failed,
          errorClass: aggregateGreen ? undefined : worstClass,
        },
        observedAt,
      };
    },
  };
}

interface LevelOutcome {
  ok: boolean;
  status?: number;
  errorDesc?: string;
  errorClass?: StarterFailureClass;
  latencyMs: number;
}

/**
 * Issue one HTTP check for a level and classify the outcome.
 *
 *   - health/interaction: GET, success = 2xx (interaction tolerates any
 *     2xx HTML shell; health additionally requires a JSON-parseable body).
 *   - agent: POST `{}`, success = any non-404 response (proof the runtime
 *     is mounted), 404 = `smoke-failed`.
 *   - chat: POST a minimal chat payload, success = a non-404 response with
 *     a non-empty body (aimock answered).
 *
 * Transport failures (timeout / cold-start wake / connection / DNS / abort)
 * are classified `transport-error` (or `aborted` on external abort) so a
 * scale-to-zero wake hiccup is softer than a real HTTP regression
 * (`smoke-failed`).
 */
async function probeLevel(opts: {
  fetchImpl: typeof fetch;
  level: StarterLevel;
  url: string;
  timeoutMs: number;
  now: () => Date;
  abortSignal?: AbortSignal;
}): Promise<LevelOutcome> {
  const { fetchImpl, level, url, timeoutMs, now, abortSignal } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // Chain the invoker's external abort into this check so an outer timeout
  // releases the socket promptly.
  const onExternalAbort = (): void => controller.abort();
  if (abortSignal) {
    if (abortSignal.aborted) controller.abort();
    else abortSignal.addEventListener("abort", onExternalAbort, { once: true });
  }
  const started = now().getTime();
  try {
    const isPost = level === "agent" || level === "chat";
    const res = await fetchImpl(url, {
      method: isPost ? "POST" : "GET",
      headers: isPost ? { "Content-Type": "application/json" } : undefined,
      body: level === "chat" ? CHAT_PROBE_BODY : isPost ? "{}" : undefined,
      signal: controller.signal,
      // Follow trailing-slash 308s so we judge the FINAL response (an
      // unmounted route that redirects to a 404 must read red), matching
      // the smoke agent check.
      redirect: "follow",
    });
    const latencyMs = now().getTime() - started;

    // agent / chat: a 404 is a real regression (route not mounted).
    if ((level === "agent" || level === "chat") && res.status === 404) {
      const body = await safeReadBody(res);
      return {
        ok: false,
        status: 404,
        errorClass: "smoke-failed",
        errorDesc: sanitizeErrorDesc(
          body.length > 0
            ? `${level} endpoint 404: ${body}`
            : `${level} endpoint 404 — route not mounted`,
        ),
        latencyMs,
      };
    }

    // chat: a non-404 response must carry a non-empty body (aimock answered).
    if (level === "chat") {
      const body = await safeReadBody(res);
      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          errorClass: "smoke-failed",
          errorDesc: sanitizeErrorDesc(`chat http ${res.status}: ${body}`),
          latencyMs,
        };
      }
      if (body.trim().length === 0) {
        return {
          ok: false,
          status: res.status,
          errorClass: "smoke-failed",
          errorDesc: sanitizeErrorDesc("chat returned empty response body"),
          latencyMs,
        };
      }
      return { ok: true, status: res.status, latencyMs };
    }

    // agent: any non-404 response is proof-of-life.
    if (level === "agent") {
      return { ok: true, status: res.status, latencyMs };
    }

    // health / interaction: require a 2xx.
    if (!res.ok) {
      const body = await safeReadBody(res);
      return {
        ok: false,
        status: res.status,
        errorClass: "smoke-failed",
        errorDesc: sanitizeErrorDesc(
          body.length > 0
            ? `${level} http ${res.status}: ${body}`
            : `${level} http ${res.status}`,
        ),
        latencyMs,
      };
    }

    // health additionally requires a JSON-parseable body — a 200 that
    // serves an HTML error page (misrouted edge) must NOT pass.
    if (level === "health") {
      const parseErr = await verifyJsonBody(res);
      if (parseErr) {
        return {
          ok: false,
          status: res.status,
          errorClass: "smoke-failed",
          errorDesc: sanitizeErrorDesc(`health malformed body: ${parseErr}`),
          latencyMs,
        };
      }
    }

    return { ok: true, status: res.status, latencyMs };
  } catch (err) {
    const latencyMs = now().getTime() - started;
    const isAbortError =
      err instanceof Error &&
      (err.name === "AbortError" || err.name === "TimeoutError");
    // Distinguish an EXTERNAL abort (invoker outer-timeout) from this
    // check's own timeout. Either way it's a transport-class failure, but
    // the keyed class lets dashboards tell "the whole tick was abandoned"
    // from "this one endpoint was slow to wake".
    const externallyAborted = abortSignal?.aborted ?? false;
    const errorClass: StarterFailureClass = externallyAborted
      ? "aborted"
      : "transport-error";
    const errorDesc = sanitizeErrorDesc(
      isAbortError
        ? externallyAborted
          ? "aborted"
          : `timeout after ${timeoutMs}ms (cold-start wake or hung endpoint)`
        : err instanceof Error
          ? err.message
          : String(err),
    );
    return { ok: false, errorClass, errorDesc, latencyMs };
  } finally {
    clearTimeout(timer);
    if (abortSignal) abortSignal.removeEventListener("abort", onExternalAbort);
  }
}

/**
 * Order the failure classes worst-first so the aggregate carries the most
 * actionable class: a real `smoke-failed` regression dominates a soft
 * `transport-error` wake hiccup, which dominates a tick-level `aborted`.
 */
const CLASS_RANK: Record<StarterFailureClass, number> = {
  "smoke-failed": 3,
  "transport-error": 2,
  aborted: 1,
};

function worsen(
  current: StarterFailureClass | undefined,
  next: StarterFailureClass | undefined,
): StarterFailureClass | undefined {
  if (!next) return current;
  if (!current) return next;
  return CLASS_RANK[next] > CLASS_RANK[current] ? next : current;
}

/**
 * Build a per-`run()` side-emit function. Captures a `warnedNoWriter` flag
 * so the writer-missing warn fires AT MOST ONCE per invocation instead of
 * per-row. Writer throws stay swallowed at error-level — a side-emit hiccup
 * must not take the aggregate tick down with it. Mirrors
 * `e2e-readiness.ts`'s `makeSideEmit`.
 */
type SideEmit = (result: ProbeResult<StarterSmokeLevelSignal>) => Promise<void>;

function makeSideEmit(ctx: ProbeContext): SideEmit {
  let warnedNoWriter = false;
  return async (result) => {
    if (!ctx.writer) {
      if (!warnedNoWriter) {
        warnedNoWriter = true;
        ctx.logger.warn("probe.starter-smoke.writer-missing", {
          key: result.key,
        });
      }
      return;
    }
    try {
      await ctx.writer.write(result);
    } catch (err) {
      ctx.logger.error("probe.starter-smoke.side-emit-writer-failed", {
        key: result.key,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  };
}

/**
 * Derive the starter slug from the Railway service name by stripping the
 * `starter-` prefix (`starter-langgraph-js` → `langgraph-js`). The slug is
 * the smoke-matrix slug (NOT the column slug) — `starterToColumnSlug`
 * performs the remap. Falls back to the whole name when the prefix is
 * absent so a hand-wired target still produces a distinct slug.
 */
function deriveStarterSlug(name: string): string {
  return name.startsWith("starter-") ? name.slice("starter-".length) : name;
}

function resolveTimeoutMs(ctx: ProbeContext, depTimeoutMs?: number): number {
  const raw = ctx.env[TIMEOUT_ENV_VAR];
  if (typeof raw === "string" && /^\d+$/.test(raw.trim())) {
    const n = Number.parseInt(raw.trim(), 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return depTimeoutMs ?? DEFAULT_TIMEOUT_MS;
}

/** Best-effort bounded body read; empty string when unreadable. */
async function safeReadBody(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

/** Returns null when the body is empty or JSON-parseable, else a reason. */
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

/** Default driver instance — registered by the orchestrator at boot. */
export const starterSmokeDriver = createStarterSmokeDriver();
