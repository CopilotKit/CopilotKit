import PocketBase from "pocketbase";

// MODULE-LOAD SEMANTICS (F5.4):
// `resolvePbUrl()` reads `process.env.NEXT_PUBLIC_POCKETBASE_URL` and
// `process.env.NODE_ENV` ONCE at module initialization (the `const
// resolvedUrl = resolvePbUrl()` call below). The PocketBase client, the
// `pbIsMisconfigured` flag, and the dev/prod fallback decision are frozen
// at that point. Changing the env var at runtime has no effect — you must
// restart the Next.js dev server (or rebuild the production image) for a
// new value to take effect. This mirrors Next.js's own behavior for
// `NEXT_PUBLIC_*` vars, which are inlined into the client bundle at build
// time rather than read from `process.env` in the browser.
//
// Public-read client for live status + status_history. No authentication:
// per spec §3.1/§3.2 those collections have listRule/viewRule = "" (public).
// CORS restricts which origins may make the request (§5.2).
//
// NEXT_PUBLIC_POCKETBASE_URL is inlined at build time (Next.js convention).
// If the env var is NOT set when `next build` runs, the PB URL we bake in
// is whatever fallback we choose — which is exactly the "silent prod
// pointing" failure mode we want to avoid.
//
// The client is constructed eagerly at module load (this file runs during
// both SSG prerender and browser hydration), so we can't throw on missing
// env var — that would break the entire build in environments where the
// var is injected via `--build-args` rather than the shell env, but not
// until the docker build context supplies it.
//
// Strategy:
//   - If NEXT_PUBLIC_POCKETBASE_URL is set: use it.
//   - Else if NODE_ENV === "production": use a placeholder URL that is
//     clearly invalid (`http://pocketbase.invalid`) so any attempted
//     request fails fast with a DNS error the hook surfaces as an
//     offline banner — no silent prod-pointing. ALSO emit a build-time
//     warning (surfaces in `next build` logs) and a runtime console
//     error so the misconfiguration is hard to miss.
//   - Else (dev/test): fall back to a LOCAL PocketBase URL
//     (`http://127.0.0.1:8090`). Pointing dev at the production Railway
//     instance is a silent-failure footgun: a developer running the
//     dashboard without env wiring would inadvertently query prod,
//     polluting prod observability and risking authenticated requests
//     leaking against the prod collection. Local fallback forces the
//     operator to start a local PB (`pnpm pb:dev` / docker-compose) or
//     set NEXT_PUBLIC_POCKETBASE_URL explicitly.
const DEV_FALLBACK_URL = "http://127.0.0.1:8090";
const PROD_INVALID_URL = "http://pocketbase.invalid";

/** Human-readable error surfaced to hooks when the sentinel URL is live. */
export const PB_MISCONFIG_MESSAGE =
  "Dashboard misconfigured: NEXT_PUBLIC_POCKETBASE_URL was unset at build " +
  "time, so the app cannot reach PocketBase. Rebuild the shell-dashboard " +
  "image with the env var set.";

function resolvePbUrl(): string {
  const env = process.env.NEXT_PUBLIC_POCKETBASE_URL;
  if (env && env.length > 0) return env;
  if (process.env.NODE_ENV === "production") {
    // Deliberate noisy signal — this string appears in build logs AND
    // browser consoles in any deploy where the env var wasn't supplied.
    // eslint-disable-next-line no-console
    console.error(
      "[pb.ts] FATAL-CONFIG: NEXT_PUBLIC_POCKETBASE_URL is unset in a " +
        "production build; dashboard will not reach PocketBase. Set the " +
        "env var at build time.",
    );
    return PROD_INVALID_URL;
  }
  // eslint-disable-next-line no-console
  console.warn(
    `[pb.ts] NEXT_PUBLIC_POCKETBASE_URL unset; using dev fallback ${DEV_FALLBACK_URL}`,
  );
  return DEV_FALLBACK_URL;
}

const resolvedUrl = resolvePbUrl();

/**
 * `true` iff the client is using the sentinel placeholder URL because no
 * `NEXT_PUBLIC_POCKETBASE_URL` was supplied at build time. Hooks can
 * short-circuit with a clear misconfig error instead of waiting for a
 * DNS failure to surface.
 */
export const pbIsMisconfigured = resolvedUrl === PROD_INVALID_URL;

export const pb = new PocketBase(resolvedUrl);
