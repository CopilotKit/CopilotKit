/**
 * railway-token.ts — Shared resolver for the Railway GraphQL bearer.
 *
 * The Railway CLI stores the public-GraphQL bearer in `user.accessToken`.
 * The shorter `user.token` is a legacy CLI session token that does NOT
 * authenticate to the public GraphQL API. Older configs still on disk
 * have `user.token` set and `user.accessToken` empty; those callers get
 * a one-cycle deprecation warning and still work.
 *
 * Resolution order matches the first four candidates of
 * `showcase/bin/railway` `Auth.token`; the per-project
 * `projects.<id>.token` fallback is intentionally not honored (no
 * project-scoped tokens here):
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
    "legacy field will be removed in a future release.";

function nonEmpty(v: unknown): v is string {
    return typeof v === "string" && v.trim().length > 0;
}

export function resolveRailwayTokenFromConfig(
    config: RailwayConfigShape | null | undefined,
    deps: ResolverDeps = {},
): string | undefined {
    // Defensive guard: config originates from JSON.parse of
    // ~/.railway/config.json (untrusted). Reject anything that isn't a
    // plain object before property access.
    if (config === null || config === undefined) return undefined;
    if (typeof config !== "object") return undefined;
    if (Array.isArray(config)) return undefined;

    const warn = deps.warn ?? ((m: string) => console.warn(m));

    const userAccess = config.user?.accessToken;
    if (nonEmpty(userAccess)) return userAccess;

    const topAccess = config.accessToken;
    if (nonEmpty(topAccess)) return topAccess;

    const userLegacy = config.user?.token;
    if (nonEmpty(userLegacy)) {
        warn(DEPRECATION_MESSAGE);
        return userLegacy;
    }

    const topLegacy = config.token;
    if (nonEmpty(topLegacy)) {
        warn(DEPRECATION_MESSAGE);
        return topLegacy;
    }
    return undefined;
}
