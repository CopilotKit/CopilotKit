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
