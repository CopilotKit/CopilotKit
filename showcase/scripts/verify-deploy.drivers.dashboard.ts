import type { ProbeTarget } from "./verify-deploy";
import type { ProbeOutcome } from "./verify-deploy.drivers";
import type { FetchLike } from "./verify-deploy.drivers.baseline";
import { probeBaseline } from "./verify-deploy.drivers.baseline";

const DRIVER_LABEL = "dashboard";
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Production sentinels the dashboard's runtime-config reader emits when a
 * required env var is unset on the Railway service. When either of these
 * lands in the injected `window.__SHOWCASE_CONFIG__`, the dashboard renders
 * with dead Demo/Code/hover-preview links (shellUrl) or dead Status-tab
 * live-readers (pocketbaseUrl) — a 200 that is NOT healthy.
 *
 * These MUST stay in sync with the SSOT in
 * `showcase/shell-dashboard/src/lib/runtime-config.ts:39-40`
 * (`PROD_INVALID_POCKETBASE_URL` / `PROD_INVALID_SHELL_URL`). That module
 * imports `next/cache`, so it cannot be cleanly imported into the scripts
 * tsconfig (the scripts typecheck has no Next types and `include` is scoped
 * to this directory); we mirror the literals here with this pointer instead
 * of pulling Next into the verify-deploy toolchain.
 */
const PROD_INVALID_SHELL_URL = "about:blank#shell-url-missing";
const PROD_INVALID_POCKETBASE_URL = "http://pocketbase.invalid";

function isAbortError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  return (e as { name?: unknown }).name === "AbortError";
}

/**
 * Extract the inlined runtime config from the dashboard's HTML. The root
 * layout (`shell-dashboard/src/app/layout.tsx`) injects an inline
 * `<script id="__showcase_config__">` whose body is
 * `window.__SHOWCASE_CONFIG__={...};`.
 *
 * We match by the SCRIPT-TAG BOUNDARY (`id="__showcase_config__"` open tag →
 * `</script>` close) and then strip the `window.__SHOWCASE_CONFIG__=` prefix
 * and trailing `;`, rather than char-class-matching the JSON body. A body
 * char-class like `\{[^<]*?\}` truncates at the first `};` that appears inside
 * a value and fails entirely on trailing-whitespace / newline / missing-semi
 * drift in the injection — and a silent no-match there would let a
 * format-drifted-but-present config slip through as "block absent → pass".
 * Anchoring on the tag boundary means any present-but-unparseable block
 * fails LOUD (throws) instead.
 *
 * Returns the parsed config object, or `undefined` ONLY when the script tag
 * is genuinely not present on the page (some renders may omit it) — in that
 * case the probe must NOT false-fail. A present-but-malformed block (bad
 * JSON, or a parseable non-object) THROWS so the verifier can never silently
 * PASS on a wiring bug.
 */
function extractInjectedConfig(
  html: string,
): Record<string, unknown> | undefined {
  // Match the inline config script by its id, capturing the tag body up to
  // the closing </script>. `[\s\S]` so the body may span newlines.
  const tagMatch = html.match(
    /<script[^>]*\bid=["']__showcase_config__["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  // Tag genuinely absent — do not false-fail.
  if (!tagMatch) return undefined;

  const body = tagMatch[1].trim();
  // Strip the `window.__SHOWCASE_CONFIG__=` assignment prefix and the trailing
  // `;`. Tolerate surrounding whitespace from formatter/minifier drift.
  const assignMatch = body.match(
    /^window\.__SHOWCASE_CONFIG__\s*=\s*([\s\S]*?);?\s*$/,
  );
  if (!assignMatch) {
    // The tag is present but its body is not the expected assignment — a
    // wiring/format-drift bug. Fail loud rather than silent-pass.
    throw new Error(
      "__SHOWCASE_CONFIG__ script present but body is not the expected " +
        "`window.__SHOWCASE_CONFIG__=<json>;` assignment",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(assignMatch[1]);
  } catch {
    // A malformed config block is itself a wiring bug; fail loud so we don't
    // silently pass.
    throw new Error("__SHOWCASE_CONFIG__ present but not valid JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    // Parseable but NOT a config object (null / array / scalar) — a
    // format-drift bug. Throw like the JSON-parse branch so a parseable
    // non-object can never silently PASS.
    throw new Error(
      "__SHOWCASE_CONFIG__ present but did not parse to a config object",
    );
  }
  return parsed as Record<string, unknown>;
}

/**
 * After a green baseline, fetch `/` and assert the injected runtime config
 * is not carrying a production "env unset" sentinel. Returns an error
 * string on a sentinel hit (or on a malformed config block); `undefined`
 * when the config is healthy OR the block is simply absent.
 */
async function checkRuntimeConfigSentinels(
  host: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
): Promise<string | undefined> {
  const url = `https://${host}/`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(url, {
      method: "GET",
      headers: { "User-Agent": "verify-deploy" },
      signal: controller.signal,
    });
  } catch (e: unknown) {
    const msg = isAbortError(e)
      ? `timed out after ${timeoutMs}ms`
      : e instanceof Error
        ? e.message
        : String(e);
    return `${DRIVER_LABEL}: runtime-config GET ${url} failed: ${msg}`;
  } finally {
    clearTimeout(timer);
  }

  let html: string;
  try {
    html = await res.text();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return `${DRIVER_LABEL}: runtime-config GET ${url} body read failed: ${msg}`;
  }

  let cfg: Record<string, unknown> | undefined;
  try {
    cfg = extractInjectedConfig(html);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return `${DRIVER_LABEL}: ${msg} at ${url}`;
  }
  // Block absent — do not false-fail (some renders omit it).
  if (!cfg) return undefined;

  if (cfg.shellUrl === PROD_INVALID_SHELL_URL) {
    return (
      `${DRIVER_LABEL}: injected __SHOWCASE_CONFIG__.shellUrl is the ` +
      `"env unset" sentinel "${PROD_INVALID_SHELL_URL}" at ${url} — ` +
      `Demo/Code/preview links are dead. Set SHELL_URL on the Railway service.`
    );
  }
  if (cfg.pocketbaseUrl === PROD_INVALID_POCKETBASE_URL) {
    return (
      `${DRIVER_LABEL}: injected __SHOWCASE_CONFIG__.pocketbaseUrl is the ` +
      `"env unset" sentinel "${PROD_INVALID_POCKETBASE_URL}" at ${url} — ` +
      `Status-tab live-readers are dead. Set POCKETBASE_URL on the Railway service.`
    );
  }
  return undefined;
}

/**
 * Feature-level verifier for the `shell-dashboard` Next.js service.
 *
 * Baseline: Railway deployment-SUCCESS + HTTP 200 on `/`.
 *
 * Driver-specific layer: after a green baseline, fetch `/`, parse the
 * injected `window.__SHOWCASE_CONFIG__`, and FAIL if it carries a
 * production "env unset" sentinel (`shellUrl === about:blank#shell-url-missing`
 * or `pocketbaseUrl === http://pocketbase.invalid`). This catches the
 * "200 but every Demo/Code/preview link is dead" case that a naked HTTP
 * probe misses — the exact failure that shipped to staging when SHELL_URL
 * was unset on the Railway service.
 */
export async function probeDashboard(
  target: ProbeTarget,
): Promise<ProbeOutcome> {
  const baseline = await probeBaseline(target, {
    driverLabel: DRIVER_LABEL,
    healthcheckPath: "/",
  });
  if (!baseline.ok) return baseline;

  // Reuse the same fetch impl/timeout policy as the baseline. Production
  // callers use the real `globalThis.fetch`; tests inject a seam by passing
  // a custom `globalThis.fetch` stub (the baseline's `fetchImpl` opt is not
  // threaded here since `probeDashboard`'s public signature takes only a
  // target — mirror that for the config check).
  const sentinelErr = await checkRuntimeConfigSentinels(
    target.host,
    globalThis.fetch as unknown as FetchLike,
    DEFAULT_TIMEOUT_MS,
  );
  if (sentinelErr) return { ok: false, error: sentinelErr };

  return { ok: true };
}
