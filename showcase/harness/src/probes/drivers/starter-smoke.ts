import { z } from "zod";
import { sanitizeErrorDesc } from "./sanitize.js";
import {
  STARTER_LEVELS,
  starterToColumnSlug,
  type StarterLevel,
} from "../helpers/starter-mapping.js";
import { parseSseEvents } from "../helpers/sse-interceptor.js";
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
 * already runs against the deployed showcase services — no new harness
 * capability, no Docker-on-harness, no browser.
 *
 * One invocation = one starter service. Per starter the driver issues FOUR
 * HTTP checks against the deployed base URL and side-emits one row per
 * level plus an aggregate primary:
 *
 * The agent + chat rungs verify the PATH-BASED v2 multi-route runtime
 * protocol — the protocol the DEPLOYED starters actually serve. Every starter
 * mounts `createCopilotEndpoint` in its default `mode:"multi-route"` at
 * `basePath:"/api/copilotkit"` via a catch-all
 * `src/app/api/copilotkit/[[...slug]]/route.ts` (verified across
 * `examples/integrations/<slug>/`, empirically proven by a local build+curl
 * gate). `matchRoute`
 * (`packages/runtime/src/v2/runtime/core/fetch-router.ts`) dispatches by URL
 * path: `/info` → runtime info, `/agent/:agentId/run` → an agent run. The
 * single-route envelope POST to bare `/api/copilotkit` is DEAD on these
 * starters (404) and must NOT be used.
 *
 *   - **health**      GET  `${base}/api/copilotkit/info` → 200. The deployed
 *                     starter has NO `/api/health` route (its only API route
 *                     is the catch-all `/api/copilotkit/[[...slug]]`), so the
 *                     health rung repoints at the runtime `info` route as a
 *                     lightweight HTTP-level liveness check — a 200 proves the
 *                     runtime mount is up and answering. (Distinct from the
 *                     agent rung below, which additionally validates the JSON
 *                     `version` field.)
 *   - **agent**       GET  `${base}/api/copilotkit/info` → require 200 + a
 *                     `version` field in the JSON body. CONTENT-LEVEL: an
 *                     HTML error page, a JSON body lacking `version`, or any
 *                     4xx FAILS. A real `{version}` info response proves the
 *                     v2 runtime is mounted and answering.
 *   - **chat**        POST `${base}/api/copilotkit/agent/default/run` with
 *                     `Accept: text/event-stream` and the AG-UI run body
 *                     `{threadId, runId, messages, state, tools, context,
 *                     forwardedProps}`. Read the AG-UI SSE stream and require
 *                     ≥1 `TEXT_MESSAGE_CONTENT` / `TEXT_MESSAGE_CHUNK` event
 *                     carrying a non-empty `delta` AND a terminal
 *                     `RUN_FINISHED` with NO `RUN_ERROR` anywhere in the
 *                     stream. A 200 with no text, a stream missing the
 *                     terminal `RUN_FINISHED`, or a stream carrying
 *                     `RUN_ERROR`, FAILS. Mirrors the `@chat` tag (chat
 *                     round-trip returns a response) over a single HTTP turn
 *                     rather than a browser.
 *   - **interaction** GET  `${base}/` → 200 (the app shell serves). Mirrors
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
 * Canonical agent id every starter registers in its `agents` map
 * (`examples/integrations/<slug>/src/app/api/copilotkit/[[...slug]]/route.ts`
 * registers `{ default: new <Framework>Agent(...) }`). The path-based chat
 * rung targets `/agent/${CHAT_AGENT_ID}/run`; `matchRoute` reads the id from
 * the URL segment. Confirmed both in the starter routes and via a deployed
 * starter's `info` `agents` map.
 */
const CHAT_AGENT_ID = "default";

/**
 * The AG-UI run body for the chat rung. Shape matches
 * `handleRunAgent` + the reference test
 * `packages/runtime/src/v2/runtime/__tests__/express-single-sse.test.ts`:
 * `{threadId, runId, messages, state, tools, context, forwardedProps}` — NO
 * single-route envelope wrapper (the path encodes the route on multi-route).
 * A single user "Hello" turn; the runtime answers with an AG-UI SSE stream.
 * The driver asserts only the stream SHAPE it requires (≥1 text-content delta
 * + terminal RUN_FINISHED + no RUN_ERROR), never a specific reply text.
 */
const CHAT_RUN_BODY = JSON.stringify({
  threadId: "starter-smoke-thread",
  runId: "starter-smoke-run",
  messages: [{ id: "u1", role: "user", content: "Hello" }],
  state: {},
  tools: [],
  context: [],
  forwardedProps: {},
});

/**
 * AG-UI text-content event types that carry a streamed assistant `delta`.
 * `TEXT_MESSAGE_CONTENT` is the canonical per-delta event; `TEXT_MESSAGE_CHUNK`
 * is the combined-chunk variant some transports emit. Either, with a
 * non-empty `delta`, is proof the chat round-trip produced assistant text.
 */
const CHAT_TEXT_EVENT_TYPES = new Set([
  "TEXT_MESSAGE_CONTENT",
  "TEXT_MESSAGE_CHUNK",
]);

/** AG-UI run-failure event type — a stream carrying this FAILS the chat rung. */
const RUN_ERROR_EVENT_TYPE = "RUN_ERROR";

/**
 * AG-UI terminal event type — a complete chat round-trip ends with this. A
 * 200 stream that carries assistant text but never reaches `RUN_FINISHED`
 * (e.g. the connection dropped mid-run) FAILS, since the run did not complete.
 */
const RUN_FINISHED_EVENT_TYPE = "RUN_FINISHED";

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
            total: STARTER_LEVELS.length,
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
      // PATH-BASED multi-route protocol: `matchRoute` dispatches on the URL
      // path, so health/agent GET `/api/copilotkit/info` and chat POSTs the
      // per-agent run path `/api/copilotkit/agent/<id>/run`. The dead
      // single-route envelope POST to bare `/api/copilotkit` is never issued.
      const levelUrls: Record<StarterLevel, string> = {
        health: `${base}/api/copilotkit/info`,
        agent: `${base}/api/copilotkit/info`,
        chat: `${base}/api/copilotkit/agent/${encodeURIComponent(CHAT_AGENT_ID)}/run`,
        interaction: `${base}/`,
      };

      const failed: StarterLevel[] = [];
      let passed = 0;
      let worstClass: StarterFailureClass | undefined;

      for (const level of STARTER_LEVELS) {
        const url = levelUrls[level];
        // Short-circuit on an external (outer-timeout) abort BEFORE issuing a
        // fresh fetch. Without this, an abort mid-tick still fires a cold-start
        // request for every remaining level — wasting wake requests and
        // emitting up to four spurious `aborted` rows. Mirrors
        // `e2e-readiness.ts`, which checks `abort.signal.aborted` before each
        // iteration and emits a clean `aborted` row WITHOUT a fetch. The first
        // level whose fetch races the abort still classifies `aborted` in
        // `probeLevel`; this guard covers the SUBSEQUENT levels.
        let result: LevelOutcome;
        if (ctx.abortSignal?.aborted) {
          result = {
            ok: false,
            errorClass: "aborted",
            errorDesc: sanitizeErrorDesc("aborted"),
            latencyMs: 0,
          };
        } else {
          result = await probeLevel({
            fetchImpl,
            level,
            url,
            timeoutMs,
            now: ctx.now,
            abortSignal: ctx.abortSignal,
          });
        }

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
 *     2xx HTML shell; health GETs `/api/copilotkit/info` and only requires a
 *     2xx — a lightweight runtime-mount liveness check).
 *   - agent: GET `/api/copilotkit/info`, success = 200 + a `version` field in
 *     the JSON body (the v2 multi-route runtime is mounted and answering). An
 *     HTML error page, a JSON body lacking `version`, or any 4xx =
 *     `smoke-failed`.
 *   - chat: POST `/api/copilotkit/agent/<id>/run` with
 *     `Accept: text/event-stream`, success = an SSE stream carrying ≥1
 *     `TEXT_MESSAGE_CONTENT`/`TEXT_MESSAGE_CHUNK` event with a non-empty
 *     `delta` AND a terminal `RUN_FINISHED` with NO `RUN_ERROR`. A 200 with
 *     no text, a missing terminal `RUN_FINISHED`, or a `RUN_ERROR` stream =
 *     `smoke-failed`.
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
  // Track WHY this specific check terminated. The shared `abortSignal` is
  // LATCHED state: re-reading it at catch-time mislabels a later self-timeout
  // or a non-abort error (e.g. ECONNREFUSED) as `aborted` once the external
  // signal has fired for an EARLIER sibling. Instead, flip this local flag
  // ONLY when THIS check's own abort was driven by the external signal.
  let externallyAborted = false;
  // Chain the invoker's external abort into this check so an outer timeout
  // releases the socket promptly.
  const onExternalAbort = (): void => {
    externallyAborted = true;
    controller.abort();
  };
  if (abortSignal) {
    if (abortSignal.aborted) {
      externallyAborted = true;
      controller.abort();
    } else {
      abortSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
  }
  const started = now().getTime();
  // SINGLE classification for any termination driven by an abort — the body
  // read OR the fetch itself. `aborted` ONLY when THIS check's abort was
  // externally driven (the outer tick was abandoned); a self-timeout or a
  // non-abort error racing a latched external signal is `transport-error`.
  // Both rungs feed the SAME discriminator (`externallyAborted`) rather than
  // re-reading the latched `controller.signal.aborted` or keying on `err.name`
  // alone, so the four rungs classify identically.
  const abortOutcome = (status: number | undefined): LevelOutcome => ({
    ok: false,
    status,
    errorClass: externallyAborted ? "aborted" : "transport-error",
    errorDesc: sanitizeErrorDesc(
      externallyAborted
        ? "aborted"
        : `${level} read aborted after ${timeoutMs}ms (cold-start wake or slow stream)`,
    ),
    // Recompute at OUTCOME time, not headers-received: a body-abort outcome
    // must surface the slow-wake latency it exists to flag, not just
    // time-to-headers.
    latencyMs: now().getTime() - started,
  });
  try {
    // PATH-BASED protocol: only the chat rung is a POST (the per-agent run
    // path with an AG-UI run body + event-stream negotiation). health, agent
    // (info) and interaction are all plain GETs.
    const isChat = level === "chat";
    const res = await fetchImpl(url, {
      method: isChat ? "POST" : "GET",
      headers: isChat
        ? {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          }
        : undefined,
      body: isChat ? CHAT_RUN_BODY : undefined,
      signal: controller.signal,
      // `follow` transparently handles any host-level (e.g. https) redirect.
      redirect: "follow",
    });
    // Latency at headers-received. The body-read rungs below recompute at
    // OUTCOME time (`outcomeLatency()`) so an emitted latency reflects the time
    // actually spent — including the body read on a slow cold-start stream —
    // not just time-to-headers.
    const outcomeLatency = (): number => now().getTime() - started;

    // agent: require a 200 `info` response carrying a `version` field. A
    // 4xx, a JSON body lacking `version`, or an HTML error page must FAIL.
    if (level === "agent") {
      const { text: body, completed } = await safeReadBody(res);
      // A read that did NOT complete was cut short by our timer / the
      // external signal → route through the shared abort classification, not
      // a hard `smoke-failed` empty body.
      if (!completed) return abortOutcome(res.status);
      const latencyMs = outcomeLatency();
      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          errorClass: "smoke-failed",
          errorDesc: sanitizeErrorDesc(
            body.length > 0
              ? `agent info http ${res.status}: ${body}`
              : `agent info http ${res.status}`,
          ),
          latencyMs,
        };
      }
      const versionErr = verifyInfoVersion(body);
      if (versionErr) {
        return {
          ok: false,
          status: res.status,
          errorClass: "smoke-failed",
          errorDesc: sanitizeErrorDesc(`agent info ${versionErr}`),
          latencyMs,
        };
      }
      return { ok: true, status: res.status, latencyMs };
    }

    // chat: require an SSE stream carrying assistant text content.
    if (level === "chat") {
      const { text: body, completed } = await safeReadBody(res);
      if (!completed) return abortOutcome(res.status);
      const latencyMs = outcomeLatency();
      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          errorClass: "smoke-failed",
          errorDesc: sanitizeErrorDesc(`chat http ${res.status}: ${body}`),
          latencyMs,
        };
      }
      const chatErr = verifyChatStream(body);
      if (chatErr) {
        return {
          ok: false,
          status: res.status,
          errorClass: "smoke-failed",
          errorDesc: sanitizeErrorDesc(`chat ${chatErr}`),
          latencyMs,
        };
      }
      return { ok: true, status: res.status, latencyMs };
    }

    // health / interaction: require a 2xx. The health rung is a lightweight
    // liveness GET against `/api/copilotkit/info` — a 200 is enough to prove
    // the runtime mount is up (the agent rung does the content-level
    // `version` validation).
    if (!res.ok) {
      const { text: body, completed } = await safeReadBody(res);
      // A non-2xx whose body read was cut short by our abort is a cold-start
      // transport hiccup — these rungs are hit FIRST on a cold wake, so route
      // them through the SAME shared abort classification the agent/chat rungs
      // use instead of unconditionally hard-redding `smoke-failed`.
      if (!completed) return abortOutcome(res.status);
      return {
        ok: false,
        status: res.status,
        errorClass: "smoke-failed",
        errorDesc: sanitizeErrorDesc(
          body.length > 0
            ? `${level} http ${res.status}: ${body}`
            : `${level} http ${res.status}`,
        ),
        latencyMs: outcomeLatency(),
      };
    }

    // health / interaction 2xx success: no body read, so headers-time latency
    // is the true outcome time.
    return { ok: true, status: res.status, latencyMs: outcomeLatency() };
  } catch (err) {
    const latencyMs = now().getTime() - started;
    const isAbortError =
      err instanceof Error &&
      (err.name === "AbortError" || err.name === "TimeoutError");
    // Distinguish an EXTERNAL abort (invoker outer-timeout) from this check's
    // OWN timeout, using why THIS check terminated — NOT the shared latched
    // signal. `aborted` ONLY when this check's abort was externally driven AND
    // the error is an actual abort. A self-timeout (`isAbortError` but not
    // externally driven) or a non-abort error (e.g. ECONNREFUSED) racing an
    // external abort is `transport-error` — the keyed class then truthfully
    // tells "the whole tick was abandoned" from "this one endpoint was slow to
    // wake / refused".
    const abortedByExternalSignal = externallyAborted && isAbortError;
    const errorClass: StarterFailureClass = abortedByExternalSignal
      ? "aborted"
      : "transport-error";
    const errorDesc = sanitizeErrorDesc(
      isAbortError
        ? abortedByExternalSignal
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

/**
 * Best-effort body read. Reports ONLY whether the read COMPLETED — not why it
 * didn't. A read that RESOLVED was, by definition, not cut short, so
 * `completed: true` is returned EVEN when the controller's signal has since
 * latched (a self-timeout that fires a hair after `res.text()` resolves must
 * NOT discard a complete valid body). A read that THREW did not complete and
 * yields `completed: false` regardless of the rejection's `err.name` — the
 * SINGLE soft-vs-hard decision (abort vs real bad response) lives at the call
 * site (`abortOutcome`), keyed on the LOCAL `externallyAborted` flag, so a
 * non-abort body error (decode error, `ERR_STREAM_PREMATURE_CLOSE`, connection
 * reset) is classified by the same discriminator as the catch block — never by
 * a re-read of the latched signal or `err.name` alone.
 */
async function safeReadBody(
  res: Response,
): Promise<{ text: string; completed: boolean }> {
  try {
    const text = await res.text();
    return { text, completed: true };
  } catch {
    return { text: "", completed: false };
  }
}

/**
 * Validate an `info` response body: it must be JSON carrying a non-empty
 * `version`. Returns null on success, else a human-readable reason. A JSON
 * body lacking `version` or an HTML page (parse failure) both fail.
 */
function verifyInfoVersion(body: string): string | null {
  if (body.trim().length === 0) return "returned empty body (expected version)";
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return "body is not JSON (expected info {version})";
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return "body is not a JSON object (expected info {version})";
  }
  const version = (parsed as Record<string, unknown>)["version"];
  if (typeof version !== "string" || version.trim().length === 0) {
    return "response missing a non-empty version field";
  }
  return null;
}

/**
 * Validate a chat `agent/run` SSE body. A passing stream must satisfy ALL of:
 *   - ≥1 `TEXT_MESSAGE_CONTENT`/`TEXT_MESSAGE_CHUNK` event with a non-empty
 *     `delta` (the assistant produced text),
 *   - a terminal `RUN_FINISHED` event (the run completed), AND
 *   - NO `RUN_ERROR` anywhere in the stream (the run did not fail).
 *
 * Matching is on event SHAPE/CONTENT, never on the server-generated
 * `messageId` (which is a `chatcmpl-<uuid>`). A `RUN_ERROR` stream, a 200
 * stream with no text, or a stream that produced text but never reached
 * `RUN_FINISHED` (e.g. a mid-run drop) all FAIL. Returns null on success,
 * else a human-readable reason.
 */
function verifyChatStream(body: string): string | null {
  if (body.trim().length === 0) return "returned an empty stream body";
  const events = parseSseEvents(body);
  let sawTextDelta = false;
  let sawRunError = false;
  let sawRunFinished = false;
  for (const ev of events) {
    if (ev.kind !== "json") continue;
    const type = ev.payload["type"];
    if (typeof type !== "string") continue;
    if (type === RUN_ERROR_EVENT_TYPE) {
      sawRunError = true;
      continue;
    }
    if (type === RUN_FINISHED_EVENT_TYPE) {
      sawRunFinished = true;
      continue;
    }
    if (CHAT_TEXT_EVENT_TYPES.has(type)) {
      const delta = ev.payload["delta"];
      if (typeof delta === "string" && delta.length > 0) {
        sawTextDelta = true;
      }
    }
  }
  // A RUN_ERROR fails the run regardless of any text that streamed before it.
  if (sawRunError) {
    return "stream emitted RUN_ERROR";
  }
  if (!sawTextDelta) {
    return "stream carried no TEXT_MESSAGE_CONTENT/TEXT_MESSAGE_CHUNK with a non-empty delta";
  }
  if (!sawRunFinished) {
    return "stream produced text but never reached a terminal RUN_FINISHED";
  }
  return null;
}

/** Default driver instance — registered by the orchestrator at boot. */
export const starterSmokeDriver = createStarterSmokeDriver();
