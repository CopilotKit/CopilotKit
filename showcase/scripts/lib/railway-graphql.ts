/**
 * railway-graphql.ts — Single source of truth for the Railway GraphQL
 * endpoint host for TypeScript importers in this repo. The historic
 * `.com` host (`backboard.railway.com`) is unauthenticated for the
 * public GraphQL API and silently returns 401/403; the canonical host
 * is `backboard.railway.app`.
 *
 * Note: the Ruby `bin/railway` script and the inline `curl` commands
 * embedded in `.github/workflows/*.yml` hold their OWN copies of this
 * URL because they cannot import a TypeScript module. Those copies are
 * kept in sync by hand and enforced by the regression guard in
 * `./__tests__/railway-graphql.scan.test.ts`, which fails the build if
 * any source file under `showcase/` or `.github/workflows/` reintroduces
 * the `.com` host.
 */
export const RAILWAY_GRAPHQL_ENDPOINT =
  "https://backboard.railway.app/graphql/v2" as const;

// Fail-fast at module load if a hand-edit ever breaks the URL literal.
new URL(RAILWAY_GRAPHQL_ENDPOINT);

/** Default cap for sanitizeErrorBody. Multi-KB Cloudflare WAF HTML
 * pages would otherwise spam stderr / $GITHUB_STEP_SUMMARY. */
export const RAILWAY_ERROR_BODY_MAX_DEFAULT = 200;

/**
 * Sanitize a Railway API error body for inclusion in logs / the
 * markdown summary. Railway/Cloudflare error responses can be
 * multi-KB HTML pages:
 *
 *   - strip `<` and `>` (would break markdown tables)
 *   - strip control chars `\n`, `\r`, `\t` (would break single-line
 *     log records AND newline-bearing markdown rows in redeploy-env)
 *   - cap at `max` chars (default 200) with an ellipsis on overflow
 *
 * Shared between redeploy-env.ts and verify-railway-image-refs.ts so
 * both consumers strip control chars at the source.
 */
export function sanitizeErrorBody(
  body: string,
  max: number = RAILWAY_ERROR_BODY_MAX_DEFAULT,
): string {
  // Strip angle brackets (markdown-breaking) and control chars
  // (newline/carriage-return/tab — break single-line log records
  // and the markdown row redeploy-env produces). Original behavior
  // removed `<>` without substitution; preserve that for `<>` and
  // additionally remove `\n\r\t`.
  const stripped = body.replace(/[<>\n\r\t]/g, "");
  if (stripped.length <= max) return stripped;
  return stripped.slice(0, max) + "…";
}
