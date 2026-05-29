/**
 * railway-graphql.ts — Single source of truth for the Railway GraphQL
 * endpoint host. ALL Railway GraphQL callers in this repo (TypeScript
 * scripts, workflow inline curls, and Ruby `bin/railway` via its own
 * constant) MUST resolve to this exact URL. The historic `.com` host
 * (`backboard.railway.com`) is unauthenticated for the public GraphQL
 * API and silently returns 401/403 — fixing here in one place prevents
 * it from coming back.
 */
export const RAILWAY_GRAPHQL_ENDPOINT =
    "https://backboard.railway.app/graphql/v2";
