/**
 * Single-Source Symlink Erosion Guard
 *
 * The `shared-tools`, `tools`, and `_shared` dirs under each
 * `showcase/integrations/<slug>/` are
 * meant to be SYMLINKS into `showcase/shared/...` — a single source of truth
 * (see showcase/AGENTS.md "The single-source symlink mechanism"). The build
 * dereferences them into real copies for Docker (`stage_shared()` in
 * showcase/scripts/cli/_common.sh) and restores them afterward
 * (`restore_symlinks()`).
 *
 * A REAL directory where one of those symlinks should be is "single-source
 * erosion": the symlink was clobbered (a botched `restore_symlinks`, a `git
 * add` of a staged tree, or an agent "fixing all N copies byte-identically")
 * and that copy will silently drift from the shared source. This is the exact
 * failure class that eroded the tree in April, and the one an agent editing a
 * copy instead of the shared source reintroduces. Nothing linked "this path is
 * supposed to be a symlink" to "this path IS a symlink", so the drift was
 * invisible to every pre-merge gate.
 *
 * This validator closes that gap. It enumerates the expected-symlink dirs and
 * reports each slot that is STRUCTURALLY eroded — either a REAL directory where
 * a symlink belongs, or a symlink that does not resolve to the shared source it
 * is supposed to point at (broken/dangling, or pointing somewhere else). Note
 * this guards STRUCTURE, not content: it cannot see drift WITHIN the shared
 * source itself — that is a separate concern. A
 * `validate-shared-symlinks.baseline.json` grandfathers the currently-eroded
 * set (same idea as the pin-drift `fail-baseline.json` and
 * validate-runtime-routes' baseline), so wiring this into CI:
 *
 *   - PASSES on the known-eroded set (does not hard-fail the pre-existing
 *     debt — that would break every showcase PR), and
 *   - FAILS if a NEW dir erodes (a symlink outside the baseline turns into a
 *     real dir), catching regressions at the PR that introduces them.
 *
 * The baseline is a SHRINK-ONLY ratchet: as symlinks are restored, remove the
 * healed keys (the tool reports stale baseline entries to make this mechanical).
 * When the baseline reaches zero, the guard becomes FULLY ENFORCING — any real
 * dir where a symlink belongs fails CI.
 *
 * Usage:
 *   npx tsx showcase/scripts/validate-shared-symlinks.ts
 *   npx tsx showcase/scripts/validate-shared-symlinks.ts --json
 *
 * Exit code 0 = clean (no non-baselined erosion); 1 = new erosion found.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOWCASE_ROOT = path.resolve(__dirname, "..");
const INTEGRATIONS_DIR = path.join(SHOWCASE_ROOT, "integrations");
const BASELINE_PATH = path.join(
  __dirname,
  "validate-shared-symlinks.baseline.json",
);

/**
 * The link names under each integration that are meant to be symlinks into
 * showcase/shared/... Kept in lockstep with `stage_shared()` /
 * `restore_symlinks()` in scripts/cli/_common.sh — if that list changes, this
 * one must too.
 */
export const EXPECTED_SYMLINK_NAMES = [
  "shared-tools",
  "tools",
  "_shared",
] as const;

/**
 * Why a slot counts as eroded:
 *   real-dir     — a real directory sits where a symlink belongs (the copy that
 *                  silently drifts — the classic single-source erosion).
 *   broken-link  — a symlink whose target does not exist (dangling).
 *   wrong-target — a symlink that resolves to something OTHER than the shared
 *                  source it is supposed to point at (points off into the weeds;
 *                  a copy could be reintroduced there just as invisibly).
 */
export type ErosionReason = "real-dir" | "broken-link" | "wrong-target";

export interface Erosion {
  /** integration slug, e.g. "langgraph-python" */
  integration: string;
  /** the link name that should be a symlink, e.g. "tools" */
  linkName: string;
  /** repo-relative path of the eroded dir, e.g. "showcase/integrations/langgraph-python/tools" */
  path: string;
  /** stable key used for baselining: "<slug>/<linkName>" */
  key: string;
  /** why this slot is eroded (real dir, broken symlink, or wrong target) */
  reason: ErosionReason;
}

/**
 * The absolute path(s) a given slot's symlink is allowed to resolve to. Derived
 * from the showcase root that owns this integration (integrations live at
 * `<showcaseRoot>/integrations/<slug>`), so a self-contained fixture tree with
 * its own `shared/` validates against ITS roots, not the repo's:
 *   tools / shared-tools → showcase/shared/{python,typescript}/tools (either)
 *   _shared              → showcase/integrations/_shared (the canonical dir the
 *                          per-slug `_shared` symlinks all point at)
 */
export function expectedTargets(
  integrationDir: string,
  linkName: (typeof EXPECTED_SYMLINK_NAMES)[number],
): string[] {
  const integrationsDir = path.dirname(integrationDir);
  const showcaseRoot = path.dirname(integrationsDir);
  if (linkName === "_shared") {
    return [path.join(integrationsDir, "_shared")];
  }
  // tools / shared-tools: accept either language's shared tools dir; a slug uses
  // exactly one, but the guard doesn't need to know which — either is valid.
  return [
    path.join(showcaseRoot, "shared", "python", "tools"),
    path.join(showcaseRoot, "shared", "typescript", "tools"),
  ];
}

/**
 * Scan one integration dir for eroded symlink slots. A slot is healthy ONLY
 * when it is a symlink that RESOLVES to its expected shared target. Erosion is:
 *   - a real directory in the slot (`real-dir`);
 *   - a symlink whose target is missing (`broken-link`); or
 *   - a symlink pointing anywhere other than the shared source (`wrong-target`).
 * A missing slot is fine (that integration simply doesn't use that shared dir);
 * a real FILE in the slot is a different bug and is ignored (only dirs are the
 * shared slots).
 */
export function scanIntegration(integrationDir: string): Erosion[] {
  const slug = path.basename(integrationDir);
  const out: Erosion[] = [];
  const repoRoot = path.resolve(SHOWCASE_ROOT, "..");
  for (const linkName of EXPECTED_SYMLINK_NAMES) {
    const p = path.join(integrationDir, linkName);
    let st: fs.Stats;
    try {
      // lstat, NOT stat: stat follows the symlink and would report a healthy
      // symlink-to-a-dir as a directory, defeating the whole check.
      st = fs.lstatSync(p);
    } catch {
      continue; // absent slot — not eroded
    }
    const record = (reason: ErosionReason) =>
      out.push({
        integration: slug,
        linkName,
        path: path.relative(repoRoot, p),
        key: `${slug}/${linkName}`,
        reason,
      });
    if (st.isSymbolicLink()) {
      // A symlink is healthy ONLY if it resolves to the expected shared target.
      // realpathSync throws on a dangling link → broken. Otherwise compare the
      // resolved absolute path against the allowed shared target(s).
      const allowed = expectedTargets(integrationDir, linkName).map((t) => {
        try {
          return fs.realpathSync(t);
        } catch {
          return t; // target dir itself missing — resolved link can't match it
        }
      });
      let resolved: string;
      try {
        resolved = fs.realpathSync(p);
      } catch {
        record("broken-link"); // dangling symlink — target does not exist
        continue;
      }
      if (!allowed.includes(resolved)) record("wrong-target");
      continue; // proper symlink to the shared source — the single source
    }
    if (!st.isDirectory()) continue; // a real FILE here is a different bug; only dirs are the shared slots
    record("real-dir");
  }
  return out;
}

/** Scan every integration under a root; returns all erosions, sorted by key. */
export function scanAll(integrationsDir: string = INTEGRATIONS_DIR): Erosion[] {
  if (!fs.existsSync(integrationsDir)) return [];
  const dirs = fs
    .readdirSync(integrationsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(integrationsDir, e.name));
  const all: Erosion[] = [];
  for (const dir of dirs) all.push(...scanIntegration(dir));
  return all.sort((a, b) => a.key.localeCompare(b.key));
}

export function loadBaseline(
  baselinePath: string = BASELINE_PATH,
): Set<string> {
  if (!fs.existsSync(baselinePath)) return new Set();
  // Fail LOUD on a malformed baseline: silently swallowing a parse error would
  // return an empty set, which reports EVERY currently-eroded (baselined) dir
  // as a NEW erosion — masking real debt as a fresh regression. A broken
  // baseline is an operator error that must be surfaced, not papered over.
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(baselinePath, "utf-8"));
  } catch (err) {
    throw new Error(
      `validate-shared-symlinks: baseline is not valid JSON (${baselinePath}): ` +
        `${(err as Error).message}`,
    );
  }
  const keys = Array.isArray(parsed)
    ? parsed
    : ((parsed as { keys?: unknown })?.keys ?? []);
  if (!Array.isArray(keys) || !keys.every((k) => typeof k === "string")) {
    throw new Error(
      `validate-shared-symlinks: baseline malformed (${baselinePath}): ` +
        `expected an array of string keys or { "keys": string[] }.`,
    );
  }
  return new Set(keys);
}

/**
 * Partition observed erosions against a baseline.
 *   fresh          — eroded dirs NOT in the baseline → NEW erosion → fail.
 *   baselinedHit   — eroded dirs that ARE in the baseline → known debt → pass.
 *   staleBaseline  — baseline keys that are NO LONGER eroded (a symlink was
 *                    restored) → remove them so the ratchet shrinks.
 */
export function partition(
  erosions: Erosion[],
  baseline: Set<string>,
): { fresh: Erosion[]; baselinedHit: string[]; staleBaseline: string[] } {
  const fresh = erosions.filter((e) => !baseline.has(e.key));
  const hitKeys = new Set(
    erosions.filter((e) => baseline.has(e.key)).map((e) => e.key),
  );
  const staleBaseline = [...baseline].filter((k) => !hitKeys.has(k));
  return { fresh, baselinedHit: [...hitKeys], staleBaseline };
}

function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");

  const erosions = scanAll();
  const baseline = loadBaseline();
  const { fresh, baselinedHit, staleBaseline } = partition(erosions, baseline);

  if (asJson) {
    console.log(
      JSON.stringify(
        { eroded: erosions, fresh, baselinedHit, staleBaseline },
        null,
        2,
      ),
    );
    process.exit(fresh.length > 0 ? 1 : 0);
    return;
  }

  // Advisory report of the full known-eroded set so the debt stays visible.
  if (erosions.length > 0) {
    console.warn(
      `ℹ ${erosions.length} single-source slot(s) are ERODED ` +
        `(should be symlinks into showcase/shared/...):`,
    );
    for (const e of erosions) {
      const tag = baseline.has(e.key) ? "known" : "NEW";
      console.warn(`  • [${tag}] ${e.path}  (${e.reason})`);
    }
    console.warn("");
  }

  if (fresh.length === 0) {
    console.log(
      `✔ single-source symlinks OK — no NEW erosion ` +
        `(${baselinedHit.length}/${baseline.size} baselined slot(s) still eroded, expected until symlinks are restored).`,
    );
  } else {
    console.error(
      `✖ ${fresh.length} NEW single-source erosion(s) — a symlink slot is no longer a healthy symlink into the shared source:\n`,
    );
    for (const e of fresh) {
      console.error(
        `  • ${e.path}  (slot "${e.linkName}" in ${e.integration}, ${e.reason})`,
      );
    }
    console.error(
      `\nThis is single-source erosion (see showcase/AGENTS.md "The single-source symlink\n` +
        `mechanism"): ${EXPECTED_SYMLINK_NAMES.map((n) => `*/${n}`).join(", ")} must be SYMLINKS into\n` +
        `showcase/shared/... A real directory there will silently DRIFT from the shared source.\n\n` +
        `Fix by editing ONLY the shared source (showcase/shared/...) and restoring the symlink\n` +
        `(e.g. \`git checkout -- ${fresh[0].path}\` or run \`restore_symlinks\`). Do NOT perpetuate the copy.\n` +
        `If this erosion is genuinely intentional and pre-existing, add its key ("${fresh[0].key}")\n` +
        `to validate-shared-symlinks.baseline.json — but the baseline is a SHRINK-ONLY ratchet.`,
    );
  }

  if (staleBaseline.length > 0) {
    console.warn(
      `\nℹ ${staleBaseline.length} baseline entr(y/ies) no longer eroded (symlink restored) — ` +
        `remove them so the ratchet shrinks toward a fully-enforcing zero baseline:\n` +
        staleBaseline.map((k) => `  • ${k}`).join("\n"),
    );
  }

  process.exit(fresh.length > 0 ? 1 : 0);
}

// Only run as CLI when invoked directly (not when imported by tests).
const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
