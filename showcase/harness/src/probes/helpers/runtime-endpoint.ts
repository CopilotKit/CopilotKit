/**
 * SHARED recognition of "is this request the CopilotKit runtime request?".
 *
 * ONE predicate, used by every probe that has to pick the runtime request out
 * of a demo page's network traffic (SSE interception, request-body capture,
 * response watching, resource-timing diagnostics). It carries NO
 * per-integration knowledge — no slug list, no `if slug === …` — so it does
 * not violate showcase iron rule 1 (`showcase/AGENTS.md`): the probe stays
 * byte-identical across integrations and only the URL SHAPE is recognised.
 *
 * ── WHY A SHARED HELPER AT ALL ───────────────────────────────────────────
 * Two URL shapes are live at the same time, because two demo frontends are
 * live at the same time (see the `demo_frontend` manifest field in
 * `showcase/AGENTS.md`):
 *
 *   PER-INTEGRATION frontend (`demo_frontend: integration`)
 *     `/api/copilotkit`                    the shared catch-all runtime route
 *     `/api/copilotkit-<demo>`             a demo's dedicated runtime route
 *     `/api/copilotkit/...`                v2 REST sub-paths (`/info`,
 *                                          `/agent/<id>/run`, `/transcribe`)
 *
 *   UNIFIED frontend (`demo_frontend: unified`)
 *     `/api/<slug>/<demo>`                 the generic runtime route
 *                                          (`frontends/nextjs/src/app/api/
 *                                           [integration]/[demo]/[[...slug]]`)
 *     `/api/<slug>/<demo>/...`             the same v2 REST sub-paths
 *     `/api/<slug>/auth`, `/api/<slug>/voice`
 *                                          the two sibling routes that are
 *                                          code rather than data — same
 *                                          two-segment shape, so they need no
 *                                          special case here
 *
 * Every probe that recognised ONLY the first group produced a FALSE RED
 * against a migrated integration: the runtime request was invisible, so the
 * SSE run counter stayed at 0 (`reason=sse-missing`, `runsFinished=0`) and the
 * request-body capture recorded nothing (`captured body: (none)`) even though
 * the agent demonstrably ran.
 *
 * ── WHAT THE PREDICATE IS ────────────────────────────────────────────────
 * A CopilotKit runtime request is recognised by TWO independent conjuncts,
 * both required:
 *
 *   1. METHOD — the runtime is always reached with POST. Both live transports
 *      POST: single-route sends `POST <runtimeUrl>` carrying
 *      `{"method":"info"}` then `{"method":"agent/run", …}` (see the route
 *      header comment in
 *      `frontends/nextjs/src/app/api/[integration]/[demo]/[[...slug]]/route.ts`),
 *      and multi-route sends `POST <runtimeUrl>/agent/<id>/run`. This conjunct
 *      is what makes the widened URL shape safe: it drops every GET a demo
 *      page issues, including `/api/health`, `/api/smoke`, `/api/debug`,
 *      static assets and RSC payload fetches.
 *
 *      The method is OPTIONAL at the call site: some seams (Playwright's
 *      `page.route(urlPattern)`) can only filter on the URL. When the caller
 *      cannot supply a method we fall back to URL shape alone rather than
 *      silently dropping the request — a missing method must never turn into a
 *      false red.
 *
 *   2. URL SHAPE — {@link COPILOTKIT_RUNTIME_URL_PATTERN}, below.
 *
 * ── WHAT THE URL SHAPE DELIBERATELY EXCLUDES ─────────────────────────────
 *   - ONE-SEGMENT `/api/<x>` routes that are not the `copilotkit` family:
 *     `/api/health`, `/api/smoke`, `/api/debug`. These are the only
 *     non-runtime `/api` routes the showcase frontends declare (verified
 *     across every `integrations/<slug>/src/app/api` tree and
 *     `frontends/nextjs/src/app/api`).
 *   - Segments containing anything outside `[a-z0-9-]`: `/api/_next/…`,
 *     `/api/cvdiag_events`, `/api/Foo/Bar`. Integration slugs and demo ids are
 *     lowercase-kebab by construction, so this costs nothing and excludes a
 *     whole class of infrastructure paths.
 *   - `copilotkit`-adjacent-but-different single segments:
 *     `/api/copilotkitfoo`, `/api/copilotkit_underscore_suffix` — the
 *     behaviour the previous pattern documented and which is preserved.
 *
 * It does NOT attempt to exclude an arbitrary two-segment `/api/<a>/<b>` POST
 * from some future non-runtime route. Nothing in the showcase frontends emits
 * one today, and the alternative — enumerating slugs or demo ids in the
 * predicate — is exactly the per-integration knowledge iron rule 1 forbids.
 * The consumers are additionally self-defending: the SSE run counter only
 * increments on a `RUN_FINISHED` event, and the context-sentinel capture only
 * passes when the body carries the sentinel, so a stray matched request
 * cannot manufacture a false GREEN.
 */

/**
 * URL-shape half of the predicate. Matches, anywhere in a full or relative
 * URL:
 *
 *   `/api/copilotkit`            optionally `-<suffix>`, then `/`, `?`, `#`
 *                                or end-of-string
 *   `/api/<seg>/<seg>`           two lowercase-kebab segments, then `/`, `?`,
 *                                `#` or end-of-string
 *
 * Exported so seams that can only filter on a URL (Playwright
 * `page.route(pattern)`) share the SAME shape rule as the method-aware
 * predicate. Prefer {@link isCopilotkitRuntimeRequest} wherever the method is
 * available.
 */
export const COPILOTKIT_RUNTIME_URL_PATTERN =
  /\/api\/(?:copilotkit(?:-[a-z0-9-]+)?|[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*)(?:[/?#]|$)/;

/**
 * HTTP methods that can never carry a CopilotKit runtime call. Kept to the
 * safe/idempotent verbs the runtime client never uses for a run: the generic
 * route also exports PUT/DELETE handlers, so those stay MATCHABLE rather than
 * risk a false red if a transport ever uses one.
 */
const NON_RUNTIME_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * METHOD half of the predicate, exposed separately for seams that keep their
 * own (overridable) URL filter but still want the universal method gate —
 * the CDP interceptor and its page-side `fetch` wrapper both do.
 *
 * Returns `true` for POST and for an ABSENT/unknown method: a seam that cannot
 * tell us the method must not have its request silently dropped, because a
 * dropped runtime request is a false red.
 */
export function isRuntimeCapableMethod(method?: string | null): boolean {
  if (typeof method !== "string" || method.length === 0) return true;
  return !NON_RUNTIME_METHODS.has(method.toUpperCase());
}

/**
 * Method names the page-side / CDP seams gate on, as a plain array so the
 * string-form init script injected into the browser can rebuild the same set
 * without importing this module.
 */
export const NON_RUNTIME_METHOD_LIST: readonly string[] = [
  ...NON_RUNTIME_METHODS,
];

/**
 * True when `url` (+ `method`, when the caller has it) looks like a request to
 * a CopilotKit runtime endpoint. See the module header for the full rationale,
 * including what this deliberately excludes.
 *
 * @param url    full or path-relative request URL.
 * @param method HTTP method, when the seam exposes one. Omit (or pass
 *               `undefined`) to match on URL shape alone.
 */
export function isCopilotkitRuntimeRequest(
  url: string,
  method?: string | null,
): boolean {
  if (typeof url !== "string" || url.length === 0) return false;
  if (!isRuntimeCapableMethod(method)) return false;
  return COPILOTKIT_RUNTIME_URL_PATTERN.test(url);
}
