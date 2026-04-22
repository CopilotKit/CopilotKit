import { z } from "zod";
import {
  redirectDecommissionProbe,
  type RedirectDecommissionSignal,
} from "../redirect-decommission.js";
import type { ProbeDriver } from "../types.js";
import type { Logger, ProbeContext, ProbeResult } from "../../types/index.js";

/**
 * Driver wrapper around the legacy `redirectDecommissionProbe`. Mirrors the
 * split already established for aimock-wiring:
 *
 *   1. The legacy probe stays authoritative for the final per-tick
 *      ProbeResult shape (state, signal schema, probeErrored branch). This
 *      driver only adapts the YAML-driven loader path (single-target
 *      `{ key }`) to the probe's formatter-ready input shape.
 *   2. The CLI formatter is extracted into
 *      `showcase/scripts/redirect-decommission-core.ts`
 *      (see `computeRedirectDecommission`). The driver performs the same
 *      PostHog fetch the legacy CLI did, hands the events to the core
 *      formatter, and then invokes the probe — i.e. the probe receives a
 *      pre-rendered `body` string exactly like when it is called from the
 *      CLI cron path. Both paths produce byte-identical signals; the
 *      cross-check test asserts that invariant.
 *   3. PostHog env (API key + project ID) arrives via `ctx.env`, consistent
 *      with how aimock-wiring consumes Railway/AIMOCK env. Missing env
 *      surfaces as a keyed synthetic `state:"error"` ProbeResult rather
 *      than a boot-time throw so an operator deploying without env sees
 *      the issue on the next tick.
 *   4. Upstream PostHog failures are funnelled through the existing
 *      `probeErrored: true` branch of the legacy probe so the monthly
 *      rule's `probeErrored != true` suppress guard can route them to the
 *      dedicated "audit failed" template branch.
 *
 * Phase 4.1 cleanup (out of scope) retires the legacy probe object and
 * inlines its body here; until then, both co-exist and emit to the same
 * writer identically.
 */

const redirectDecommissionInputSchema = z
  .object({
    key: z.string().min(1),
  })
  .passthrough();

type RedirectDecommissionDriverInput = z.infer<
  typeof redirectDecommissionInputSchema
>;

/** PostHog event-count row, as returned by the HogQL query. */
interface EventCount {
  redirect_id: string;
  count: number;
}

/**
 * Exposed for unit tests — fetch implementation is injected via `ctx.env`
 * isn't a thing (Node's `fetch` is global), so we thread a `FetchImpl`
 * type alias here and let the driver default to `globalThis.fetch`. Tests
 * override by stubbing `globalThis.fetch`.
 */
const POSTHOG_HOST = "https://eu.i.posthog.com";
const DAYS = 30;

async function queryPostHog(
  apiKey: string,
  projectId: string,
  fetchImpl: typeof fetch,
  logger: Logger,
): Promise<EventCount[]> {
  const now = new Date();
  const from = new Date(now.getTime() - DAYS * 24 * 60 * 60 * 1000);

  // Same HogQL the CLI runs — keep the two queries identical so a drift
  // between them surfaces in code review rather than as a mismatched
  // decommission list on a 9am-of-the-1st alert.
  const query = {
    kind: "HogQLQuery",
    query: `
            SELECT
                properties.redirect_id AS redirect_id,
                count() AS cnt
            FROM events
            WHERE event = 'seo_redirect'
              AND timestamp >= toDateTime('${from.toISOString()}')
              AND timestamp <= toDateTime('${now.toISOString()}')
            GROUP BY redirect_id
            ORDER BY cnt DESC
        `,
  };

  const res = await fetchImpl(
    `${POSTHOG_HOST}/api/projects/${projectId}/query/`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ query }),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`PostHog API error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as { results?: [string, number][] };
  const results: EventCount[] = [];
  for (const row of data.results ?? []) {
    results.push({ redirect_id: row[0], count: row[1] });
  }
  logger.debug("probe.redirect-decommission.posthog-rows", {
    rowCount: results.length,
  });
  return results;
}

/**
 * Make the imports resilient to the shell/scripts Node-25 ESM/CJS interop
 * gotcha documented in the CLI: named imports from
 * `../shell/src/lib/seo-redirects` surface via the CJS `default` namespace
 * under tsx + Node 25 when the containing package omits
 * `"type": "module"`. Use a namespace import and pick either shape.
 */
async function loadRedirectsAndCore(): Promise<{
  seoRedirects: Array<{ id: string; source: string; destination: string }>;
  computeRedirectDecommission: (
    i: unknown,
  ) => { body: string; candidateCount: number; hasCandidates: boolean };
}> {
  const seoMod = (await import(
    // eslint-disable-next-line import/no-relative-packages
    "../../../../shell/src/lib/seo-redirects"
  )) as {
    seoRedirects?: Array<{ id: string; source: string; destination: string }>;
    default?: {
      seoRedirects?: Array<{
        id: string;
        source: string;
        destination: string;
      }>;
    };
  };
  const seoRedirects =
    seoMod.seoRedirects ?? seoMod.default?.seoRedirects ?? [];

  const coreMod = (await import(
    // eslint-disable-next-line import/no-relative-packages
    "../../../../scripts/redirect-decommission-core"
  )) as {
    computeRedirectDecommission?: (i: unknown) => {
      body: string;
      candidateCount: number;
      hasCandidates: boolean;
    };
    default?: {
      computeRedirectDecommission?: (i: unknown) => {
        body: string;
        candidateCount: number;
        hasCandidates: boolean;
      };
    };
  };
  const computeRedirectDecommission =
    coreMod.computeRedirectDecommission ??
    coreMod.default?.computeRedirectDecommission;
  if (!computeRedirectDecommission) {
    throw new Error(
      "redirect-decommission-core did not export computeRedirectDecommission",
    );
  }
  return { seoRedirects, computeRedirectDecommission };
}

/**
 * Exposed for test injection — tests override the default fetch/core/redirects
 * providers so they don't need to hit PostHog or the shell import graph.
 */
export interface RedirectDecommissionDriverDeps {
  fetchImpl?: typeof fetch;
  load?: typeof loadRedirectsAndCore;
}

export function createRedirectDecommissionDriver(
  deps: RedirectDecommissionDriverDeps = {},
): ProbeDriver<RedirectDecommissionDriverInput, RedirectDecommissionSignal> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const load = deps.load ?? loadRedirectsAndCore;

  return {
    kind: redirectDecommissionProbe.dimension,
    inputSchema: redirectDecommissionInputSchema,
    async run(
      ctx: ProbeContext,
      input: RedirectDecommissionDriverInput,
    ): Promise<ProbeResult<RedirectDecommissionSignal>> {
      const { env, logger } = ctx;
      const apiKey = env.POSTHOG_API_KEY;
      const projectId = env.POSTHOG_PROJECT_ID;

      if (!apiKey || !projectId) {
        logger.warn("probe.redirect-decommission.config-missing", {
          hasApiKey: !!apiKey,
          hasProjectId: !!projectId,
        });
        return {
          key: input.key,
          state: "error",
          signal: {
            body: "",
            candidateCount: 0,
            hasCandidates: false,
            probeErrored: true,
            probeErrorDesc:
              "POSTHOG_API_KEY and POSTHOG_PROJECT_ID must both be set",
          },
          observedAt: ctx.now().toISOString(),
        };
      }

      let events: EventCount[];
      try {
        events = await queryPostHog(apiKey, projectId, fetchImpl, logger);
      } catch (err) {
        // Route upstream audit failures through the probe's `probeErrored`
        // branch so the monthly suppress rule (`probeErrored != true`) fires
        // the "audit failed" template instead of silently swallowing the
        // tick as "no candidates".
        const errorDesc =
          err instanceof Error ? err.message : String(err ?? "unknown error");
        logger.warn("probe.redirect-decommission.posthog-error", {
          errorDesc,
        });
        return redirectDecommissionProbe.run(
          {
            body: "",
            candidateCount: 0,
            probeErrored: true,
            probeErrorDesc: errorDesc,
          },
          ctx,
        );
      }

      let rendered: { body: string; candidateCount: number };
      try {
        const { seoRedirects, computeRedirectDecommission } = await load();
        const result = computeRedirectDecommission({
          events,
          redirects: seoRedirects,
          days: DAYS,
          slackFormat: true,
        });
        rendered = {
          body: result.body,
          candidateCount: result.candidateCount,
        };
      } catch (err) {
        // Core module / shell import failure — surface as an audit error so
        // the template branch renders instead of silent suppression.
        const errorDesc =
          err instanceof Error ? err.message : String(err ?? "unknown error");
        logger.error("probe.redirect-decommission.render-error", { errorDesc });
        return redirectDecommissionProbe.run(
          {
            body: "",
            candidateCount: 0,
            probeErrored: true,
            probeErrorDesc: errorDesc,
          },
          ctx,
        );
      }

      // Happy path: hand the pre-formatted body to the legacy probe so the
      // ProbeResult (state / signal.slackSafe / template fields) stays the
      // authoritative shape both paths share.
      return redirectDecommissionProbe.run(
        {
          body: rendered.body,
          candidateCount: rendered.candidateCount,
        },
        ctx,
      );
    },
  };
}

/**
 * Default driver instance registered by the orchestrator at boot. Tests
 * call `createRedirectDecommissionDriver({ fetchImpl, load })` directly to
 * stub out PostHog + the shell import graph; production callers use this
 * singleton which binds to the real `globalThis.fetch` and dynamic import.
 */
export const redirectDecommissionDriver = createRedirectDecommissionDriver();
