/**
 * railway-token.ts — Shared resolver for the Railway GraphQL bearer.
 *
 * The Railway CLI stores the public-GraphQL bearer in `user.accessToken`
 * (43+ chars). The shorter `user.token` is a legacy CLI session token
 * that does NOT authenticate to the public GraphQL API. Older configs
 * still on disk have `user.token` set and `user.accessToken` empty;
 * those callers get a one-cycle deprecation warning and still work.
 *
 * Resolution order mirrors `showcase/bin/railway:115-119`:
 *   1. user.accessToken
 *   2. accessToken (top-level)
 *   3. user.token        (legacy → warn)
 *   4. token (top-level) (legacy → warn)
 *
 * Returns undefined when no usable token is present; callers print the
 * "set RAILWAY_TOKEN or run `railway login`" error.
 */

export interface RailwayConfigShape {
    user?: {
        accessToken?: string;
        token?: string;
    };
    accessToken?: string;
    token?: string;
}

export interface ResolverDeps {
    warn?: (message: string) => void;
}

const DEPRECATION_MESSAGE =
    "[railway-token] WARNING: legacy Railway config field is deprecated: " +
    "`user.token` / top-level `token` no longer authenticates the public " +
    "GraphQL API. The Railway CLI now writes `user.accessToken`; re-run " +
    "`railway login` to refresh ~/.railway/config.json. Support for the " +
    "legacy field will be removed in the next release cycle.";

function nonEmpty(v: unknown): v is string {
    return typeof v === "string" && v.length > 0;
}

export function resolveRailwayTokenFromConfig(
    config: RailwayConfigShape | null | undefined,
    deps: ResolverDeps = {},
): string | undefined {
    if (!config) return undefined;
    const warn = deps.warn ?? ((m: string) => console.warn(m));

    if (nonEmpty(config.user?.accessToken)) return config.user!.accessToken;
    if (nonEmpty(config.accessToken)) return config.accessToken;

    if (nonEmpty(config.user?.token)) {
        warn(DEPRECATION_MESSAGE);
        return config.user!.token;
    }
    if (nonEmpty(config.token)) {
        warn(DEPRECATION_MESSAGE);
        return config.token;
    }
    return undefined;
}
