// Build-time helper for next.config.ts: computes the
// NEXT_PUBLIC_LOCAL_BACKENDS env value from shared/local-ports.json when
// SHOWCASE_LOCAL=1 (local-dev only — deployed images bake "").
//
// Extracted from next.config.ts so the logic is unit-testable (vitest
// only includes src/**); next.config.ts imports it and passes the real
// ports path. Node-only (fs/path) — never import from app/middleware
// code.

import fs from "fs";

/**
 * Returns the JSON string to bake into NEXT_PUBLIC_LOCAL_BACKENDS, or
 * "" when local backends are not in play.
 *
 * Failure posture (this runs at BUILD time, so throwing IS the loud
 * path): an unreadable file, corrupt JSON, a non-object top level, or
 * an invalid port all throw, naming the file (read failures and parse
 * failures are labeled distinctly — an EACCES is not a syntax error).
 * A MISSING file with SHOWCASE_LOCAL=1 set warns instead of silently
 * returning "" — the developer explicitly opted in, so "why are my
 * local backends not wired?" must have a signal. SHOWCASE_LOCAL=1
 * combined with NODE_ENV=production warns loudly: it bakes localhost
 * iframe targets into the image, which must never deploy (not a throw
 * — `next build` always sets NODE_ENV=production, so refusing would
 * break the documented local production-build flow).
 */
export function localBackendsEnv(portsPath: string): string {
  // Unset-vs-blank distinction: unset (never exported) and
  // blank/whitespace-only (`SHOWCASE_LOCAL= npm run build` to
  // explicitly disable) are BOTH deliberate "off" states and stay
  // silent. The value is trimmed before the comparison — the same
  // paste-artifact tolerance runtime-config.ts applies to every env
  // value — so `SHOWCASE_LOCAL=" 1"` still opts in instead of
  // silently disabling local backends.
  const rawLocal = process.env.SHOWCASE_LOCAL;
  const showcaseLocal = rawLocal === undefined ? "" : rawLocal.trim();
  if (showcaseLocal !== "1") {
    // Set to a non-blank value other than "1" ("true", "yes", "0", …):
    // the developer believes they toggled local backends, but only "1"
    // opts in — a silent no-op here is exactly the "why are my local
    // backends not wired?" zero-signal failure the missing-file warn
    // below exists to prevent. Warn, treat as off.
    if (showcaseLocal !== "") {
      // eslint-disable-next-line no-console
      console.warn(
        `[next.config] SHOWCASE_LOCAL is set to ${JSON.stringify(rawLocal)} ` +
          `but only "1" enables local backend overrides — treating it as ` +
          `off. Set SHOWCASE_LOCAL=1 (or unset it).`,
      );
    }
    return "";
  }
  if (process.env.NODE_ENV === "production") {
    // eslint-disable-next-line no-console
    console.warn(
      `[next.config] SHOWCASE_LOCAL=1 in a production build — localhost ` +
        `backend overrides will be baked into this image. NEVER deploy it; ` +
        `unset SHOWCASE_LOCAL for deployable builds.`,
    );
  }
  // Read directly and branch on ENOENT instead of a separate existsSync
  // guard: existsSync returns false for an EACCES on the parent
  // directory too, which masked a permissions problem as "missing file"
  // — defeating the labeled-throw design the read/parse split exists
  // for. The read also stays OUTSIDE the parse try: an EACCES inside it
  // was mislabeled "not valid JSON", sending the developer to inspect
  // the file's syntax when the problem is its permissions.
  let rawText: string;
  try {
    rawText = fs.readFileSync(portsPath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      // eslint-disable-next-line no-console
      console.warn(
        `[next.config] SHOWCASE_LOCAL=1 but ${portsPath} does not exist — ` +
          `no local backend overrides will be baked. Generate it (or unset ` +
          `SHOWCASE_LOCAL).`,
      );
      return "";
    }
    throw new Error(`${portsPath} could not be read: ${String(err)}`, {
      cause: err,
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    throw new Error(`${portsPath} is not valid JSON: ${String(err)}`, {
      cause: err,
    });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `${portsPath} must be a JSON object mapping slug -> port (got ` +
        `${Array.isArray(parsed) ? "an array" : typeof parsed}).`,
    );
  }
  // Null-prototype accumulator: on a plain `{}`, a "__proto__" key in
  // the ports file would hit the Object.prototype setter — a silent
  // no-op that drops the entry from the emitted JSON even though the
  // slug-contract warn below fires. With no prototype it lands as an
  // ordinary own data property (JSON.stringify serializes it fine).
  const map: Record<string, string> = Object.create(null);
  for (const [slug, port] of Object.entries(parsed)) {
    // Registry slugs are [a-z0-9-]+ (see lib/backend-url.ts SLUG_RE) —
    // a key outside that contract can never match an integration slug,
    // so its override is a silent no-op at runtime. Warn, don't throw:
    // the entry breaks nothing, it just never applies.
    if (!/^[a-z0-9-]+$/.test(slug)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[next.config] ${portsPath}: key ${JSON.stringify(slug)} does not ` +
          `match the integration slug contract ([a-z0-9-]+) — its override ` +
          `can never apply (silent no-op at runtime).`,
      );
    }
    // Full TCP-port validation, not just typeof: 3.5 / 0 / -1 / 99999
    // are all numbers, and every one of them yields a URL that can
    // never connect. THROW — this is build time (the file's stated
    // fail-loud posture); a warn+skip silently shipped a build with
    // that integration's override missing.
    if (
      typeof port !== "number" ||
      !Number.isInteger(port) ||
      port <= 0 ||
      port > 65535
    ) {
      throw new Error(
        `${portsPath}: port for "${slug}" is not a valid TCP port ` +
          `(integer 1-65535); got ${JSON.stringify(port)}.`,
      );
    }
    map[slug] = `http://localhost:${port}`;
  }
  return JSON.stringify(map);
}
