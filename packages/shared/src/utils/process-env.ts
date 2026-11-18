/**
 * The process environment, or an empty object where there is no `process`
 * (Cloudflare Workers without `nodejs_compat`, browsers). Read it on each use
 * rather than caching it, so later changes to `process.env` are seen.
 */
export function processEnv(): Record<string, string | undefined> {
  return (
    (
      globalThis as {
        process?: { env?: Record<string, string | undefined> };
      }
    ).process?.env ?? {}
  );
}
