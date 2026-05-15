import { z } from "zod";
import {
  redirectDecommissionProbe,
  type RedirectDecommissionSignal,
} from "../redirect-decommission.js";
import type { ProbeDriver } from "../types.js";
import type { Logger, ProbeContext, ProbeResult } from "../../types/index.js";
import { seoRedirects } from "./seo-redirects.js";
import {
  computeRedirectDecommission,
  type RedirectDecommissionInput,
} from "./redirect-decommission-core.js";

/**
 * Driver wrapper around the legacy `redirectDecommissionProbe`. Mirrors the
 * split already established for aimock-wiring:
 *
 *   1. The legacy probe stays authoritative for the final per-tick
 *      ProbeResult shape (state, signal schema, probeErrored branch). This
 *      driver only adapts the YAML-driven loader path (single-target
 *      `{ key }`) to the probe's formatter-ready input shape.
 *   2. The CLI formatter is extracted into
 *      `showcase/scripts/redirect-decommission-core.ts` (CLI-side copy) and
 *      a hermetic mirror sits beside this driver at `./redirect-decommission-core.ts`.
 *      Previously this driver dynamic-imported the CLI copy AND
 *      `showcase/shell/src/lib/seo-redirects.ts` at runtime — both paths
 *      ENOENT'd inside the container image, because neither tree is COPYd
 *      into the runtime stage. Static imports off sibling modules make the
 *      driver hermetic + let tsc check the full import graph. See the
 *      provenance banner at the top of `seo-redirects.ts` +
 *      `redirect-decommission-core.ts`.
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
  abortSignal: AbortSignal | undefined,
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
      // Thread the invoker's AbortController signal into the fetch so the
      // request aborts in-flight if the probe's timeout_ms fires. Without
      // this, a hung PostHog endpoint keeps the socket alive past the
      // synthetic-timeout ProbeResult, leaking descriptors on every tick.
      signal: abortSignal,
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
 * Bundle of data + formatter the driver hands to the legacy probe. Kept as
 * an injectable seam so tests can stub the seo-redirects catalogue and
 * `computeRedirectDecommission` implementation without requiring the real
 * modules. Default wiring (used by the exported singleton) points at the
 * hermetic sibling modules — no dynamic imports, no filesystem coupling
 * to the monorepo layout.
 */
export interface RedirectDecommissionCoreDeps {
  seoRedirects: Array<{ id: string; source: string; destination: string }>;
  computeRedirectDecommission: (i: RedirectDecommissionInput) => {
    body: string;
    candidateCount: number;
    hasCandidates: boolean;
  };
}

const defaultCore: RedirectDecommissionCoreDeps = {
  seoRedirects,
  computeRedirectDecommission,
};

/**
 * Exposed for test injection — tests override the default fetch/core
 * providers so they don't need to hit PostHog or construct the real
 * catalogue. The `core` seam replaces the previous `load` async factory;
 * since everything is statically imported now, there's no async to
 * preserve.
 */
export interface RedirectDecommissionDriverDeps {
  fetchImpl?: typeof fetch;
  core?: RedirectDecommissionCoreDeps;
}

export function createRedirectDecommissionDriver(
  deps: RedirectDecommissionDriverDeps = {},
): ProbeDriver<RedirectDecommissionDriverInput, RedirectDecommissionSignal> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const core = deps.core ?? defaultCore;

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
        events = await queryPostHog(
          apiKey,
          projectId,
          fetchImpl,
          logger,
          ctx.abortSignal,
        );
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
        const result = core.computeRedirectDecommission({
          events,
          redirects: core.seoRedirects,
          days: DAYS,
          slackFormat: true,
        });
        rendered = {
          body: result.body,
          candidateCount: result.candidateCount,
        };
      } catch (err) {
        // Core formatter failure — surface as an audit error so the template
        // branch renders instead of silent suppression.
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
 * call `createRedirectDecommissionDriver({ fetchImpl, core })` directly to
 * stub out PostHog + the formatter/data; production callers use this
 * singleton which binds to the real `globalThis.fetch` and the hermetic
 * sibling-module copies of the catalogue + formatter.
 */
export const redirectDecommissionDriver = createRedirectDecommissionDriver();
