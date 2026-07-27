#!/usr/bin/env npx tsx
/**
 * sync-promote-service-options.ts — Self-maintaining dropdown generator for
 * the `service` workflow_dispatch input of
 * `.github/workflows/showcase_promote.yml`.
 *
 * The promote workflow's `service` input used to be a freeform `type: string`
 * defaulting to "all", which made it trivially easy to accidentally kick off
 * a whole-fleet prod promote. This generator turns it into a `type: choice`
 * dropdown whose option list is derived directly from the SSOT
 * (`railway-envs.ts` → `SERVICES`), so the dropdown can never drift from the
 * set of promotable services.
 *
 * Option ordering (deliberate):
 *   1. SENTINEL ("__select_a_service__") — FIRST. The anti-footgun default is
 *      enforced by the emitted `default: <SENTINEL>` key (see
 *      `renderGeneratedBody`), NOT by list position: GitHub honors an explicit
 *      `default:` when present and only falls back to `options[0]` when it is
 *      absent. Listing the sentinel first is secondary/cosmetic — it keeps the
 *      default visually at the top of the menu. Selecting the sentinel aborts
 *      the run (the workflow's resolve step rejects it), so nothing happens
 *      unless a human picks a real target.
 *   2. "all" — the explicit whole-fleet promote.
 *   3. Each `probe.prod === true` service, rendered as its `dispatchName`
 *      when set, else its `.name`, sorted alphabetically by the RENDERED
 *      token so the dropdown reads in alphabetical order to a human.
 *
 * The generated block is spliced between two markers inside the workflow
 * file. Everything outside the markers is preserved verbatim. If the markers
 * are missing, duplicated, or malformed the generator FAILS LOUD (non-zero
 * exit) rather than silently rewriting the wrong region.
 *
 * Flags:
 *   --check              Validate without writing. See exit codes below.
 *   --workflow=<path>    Override the target workflow path (used by tests).
 *                        Defaults to the tracked showcase_promote.yml.
 *
 * Any unrecognized argument, a bare `--workflow` (no `=value`), an empty
 * `--workflow=` value, or a duplicate `--workflow=` fails loud (exit 2).
 *
 * Exit codes:
 *   1  Drift — under --check ONLY, the file would change (re-run to
 *      regenerate). Exit 1 (drift) is the only code unique to --check; a
 *      --check run can still exit 2 or 3 via the shared read/render paths.
 *   2  I/O or usage error — the workflow file could not be read OR (in write
 *      mode) could not be written, OR the CLI args were invalid (unknown
 *      flag, bare/empty/duplicate --workflow). Covers ALL read failures
 *      (including a missing file), write failures (EACCES/ENOSPC/etc.), and
 *      argument-parse failures. Applies to BOTH the default write mode and
 *      --check (--check only reads). Failing loud on a bad arg prevents a
 *      typo like `--chek` from silently performing a destructive write.
 *   3  Marker/render error — the generated marker block is missing,
 *      duplicated, or malformed (out of order), or a rendered option token
 *      is not YAML-safe, so the region cannot be spliced safely. The file is
 *      left untouched. Applies to BOTH the default write mode and --check.
 *
 * Idempotent: writes only when the rendered content differs from disk. A
 * lefthook pre-commit hook runs this (regenerate + `git add` the workflow)
 * on commits that touch the SSOT or the generator, so the dropdown tracks
 * the SSOT. (The hook is scoped to those paths and is bypassed by
 * `LEFTHOOK=0`, so it is a convenience, not an ironclad guarantee.)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SERVICES } from "./railway-envs";
import type { ServiceEntry } from "./railway-envs";

/**
 * Whether an entry is prod-promotable: it declares a prod environment whose
 * probe is enabled (`probe` defaults to true when omitted). Operates on the
 * passed entry (NOT the global SSOT) so `computeOptionTokens` can be exercised
 * with an injected synthetic services map in tests.
 *
 * Recognizes the single canonical eligibility shape: the env-map schema used by
 * `railway-envs.ts` (`SERVICES`), where per-env config lives under
 * `environments.prod.probe`. This is the TS SSOT shape every current service
 * (including the 12 starters) carries, and it is the ONLY shape the generator
 * reads — the generator imports the TS SSOT, never the generated JSON.
 *
 * This predicate is equivalent to the workflow resolve step's
 * `select(.probe.prod == true)`: that step runs against the EMITTED JSON whose
 * flat `probe.prod` is derived solely from this same `environments.prod.probe`
 * (see `emit-railway-envs-json.ts`). So an entry is promotable here iff resolve
 * would accept it, keeping the dropdown and the resolve step in lockstep.
 */
function isProdPromotable(entry: Pick<ServiceEntry, "environments">): boolean {
  // Env-map schema — environments.prod.probe (defaults true when omitted).
  const envMapProd = entry.environments?.prod;
  if (envMapProd) {
    if ((envMapProd.probe ?? true) === true) return true;
  }
  return false;
}

/** Selecting this option aborts the promote run (rejected by resolve step). */
export const SENTINEL = "__select_a_service__";

/**
 * Tokens are interpolated RAW into the YAML `options:` list (`- ${token}`).
 * A token carrying a YAML-special character (`:`, space, `#`, `*`, `&`,
 * quotes, etc.) would silently emit a malformed workflow that the pre-commit
 * hook then `git add`s. Today every SSOT key/dispatchName is `[a-z0-9-]`, but
 * a future entry could break that, so we fail loud instead. The class below
 * is a conservative ALLOWLIST — ASCII alphanumerics plus `.`, `_`, and `-`.
 * Every character it permits is YAML-plain-scalar-safe, but the allowlist is
 * deliberately narrower than the full set of YAML-safe characters: it is a
 * whitelist of what we accept, not a proof of general YAML safety.
 */
const SAFE_TOKEN = /^[A-Za-z0-9._-]+$/;

export const BEGIN_MARKER =
  "# >>> BEGIN GENERATED service options (showcase/scripts/sync-promote-service-options.ts) — DO NOT EDIT";
export const END_MARKER = "# <<< END GENERATED service options";

const DEFAULT_WORKFLOW_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".github",
  "workflows",
  "showcase_promote.yml",
);

/**
 * The ordered option-token list rendered into the dropdown:
 *   [SENTINEL, "all", ...probe.prod services rendered as
 *    (dispatchName ?? name) and sorted alphabetically by the RENDERED token]
 *
 * Sorting by the rendered token (rather than by SSOT key) means the menu
 * reads in alphabetical order to a human — the SSOT key is invisible to the
 * person picking a target, so ordering by it produces a scrambled-looking
 * list.
 */
export function computeOptionTokens(
  services: typeof SERVICES = SERVICES,
): string[] {
  const promotable = Object.entries(services)
    .filter(([, entry]) => isProdPromotable(entry))
    .map(([name, entry]) => {
      const token = entry.dispatchName ?? name;
      // Fail loud (routes through the exit-3 render path) rather than emit a
      // YAML-breaking option the pre-commit hook would silently `git add`.
      if (!SAFE_TOKEN.test(token)) {
        throw new Error(
          `sync-promote-service-options: option token "${token}" (SSOT key ` +
            `"${name}") is not YAML-safe. Tokens must match ` +
            `${SAFE_TOKEN} — fix the service's dispatchName or key.`,
        );
      }
      return token;
    })
    // Deterministic byte/codepoint comparison rather than `localeCompare`:
    // the lefthook hook runs on dev machines with varied LANG/LC_*, while
    // CI's `--check` runs on a Depot runner, so locale-dependent collation
    // could flag the dropdown as stale or ping-pong the file. A pinned
    // codepoint sort (mirroring the repo's `LC_ALL=C` usage for `sort`) is
    // stable across every machine.
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  // Enforce the EXACT invariant the workflow's resolve step relies on. The
  // resolve step maps a chosen dropdown token T back to a service via the
  // predicate `s.name === T || s.dispatchName === T` and FAILS if more than
  // one service matches (ambiguous → un-promotable). So every token we emit
  // MUST resolve to exactly one service under that same predicate, and must
  // not collide with a reserved literal ("all"/SENTINEL) the resolve step
  // special-cases.
  //
  // This single structural check SUBSUMES the older piecemeal guards:
  //   - reserved-literal collision (T === "all" || T === SENTINEL), and
  //   - rendered-token dedupe (two services rendering the SAME token T match
  //     each other under the predicate → matches.length > 1).
  // Crucially it ALSO catches the case those guards MISSED: one service's
  // rendered token T equaling a DIFFERENT service's `name`/`dispatchName`
  // (e.g. A renders "foo" via dispatchName while B has name "foo" but a
  // different dispatchName, so B renders a distinct token "bar"). The dedupe
  // guard saw two distinct rendered tokens and passed, yet token "foo"
  // resolves to BOTH A and B and is un-promotable. assertDispatchNamesUnique
  // only dedupes dispatchName-vs-dispatchName and cannot see this either.
  const reserved = new Set([SENTINEL, "all"]);
  const allEntries = Object.entries(services);
  for (const token of promotable) {
    if (reserved.has(token)) {
      throw new Error(
        `sync-promote-service-options: option token ${JSON.stringify(token)} ` +
          `collides with a reserved literal ("all" or ${JSON.stringify(SENTINEL)}). ` +
          `A real service must not render as a reserved dropdown value — fix ` +
          `the offending dispatchName or SSOT key.`,
      );
    }
    // The resolve-step predicate, applied EXACTLY as the workflow does:
    // `(name === token || dispatchName === token) && probe.prod === true`.
    // The `probe.prod === true` restriction is load-bearing — the workflow's
    // resolve step is `select(.name == $s or .dispatchName == $s) |
    // select(.probe.prod == true)`, so the match set is restricted to
    // prod-eligible services. Omitting it here would make the guard STRICTER
    // than resolve: a future non-prod service sharing a name/dispatchName token
    // with a prod-eligible service would be counted as a collision and throw
    // (false positive, hard-blocking regeneration), even though the workflow
    // would resolve that token unambiguously to the single prod-eligible
    // service. With the restriction the guard is logically equivalent to
    // resolve (the same predicate, modulo TS short-circuit AND vs jq's two
    // chained `select`s in the opposite order).
    const matches = allEntries.filter(
      ([name, entry]) =>
        isProdPromotable(entry) &&
        (name === token || entry.dispatchName === token),
    );
    if (matches.length !== 1) {
      const keys = matches.map(([name]) => name);
      throw new Error(
        `sync-promote-service-options: option token ${JSON.stringify(token)} ` +
          `resolves to ${matches.length} services ${JSON.stringify(keys)} ` +
          `under the workflow resolve predicate ` +
          `(s.name === token || s.dispatchName === token), but must resolve ` +
          `to EXACTLY ONE. ${
            matches.length > 1
              ? `An ambiguous token is un-promotable (the resolve step fails ` +
                `on >1 match). Fix the colliding dispatchName(s) or SSOT key(s).`
              : `A token resolving to zero services should be impossible by ` +
                `construction — this indicates an SSOT/generator inconsistency.`
          }`,
      );
    }
  }
  return [SENTINEL, "all", ...promotable];
}

/**
 * Render the generated body that sits BETWEEN the markers. The body carries
 * the `default:` and `options:` keys at the SAME indentation as the BEGIN/END
 * markers (`indent`), with list items indented one level (two spaces) deeper.
 *
 * The indentation is derived from the detected marker line rather than
 * hardcoded so the body can never disagree with the marker lines that
 * `renderWorkflow` re-emits: if the markers ever move to a different indent,
 * the generated body follows them and the YAML stays valid.
 */
export function renderGeneratedBody(tokens: string[], indent: string): string {
  const lines: string[] = [];
  lines.push(`${indent}default: ${SENTINEL}`);
  lines.push(`${indent}options:`);
  for (const token of tokens) {
    lines.push(`${indent}  - ${token}`);
  }
  return lines.join("\n");
}

interface MarkerSpan {
  /** Index of the line containing BEGIN_MARKER. */
  beginLine: number;
  /** Index of the line containing END_MARKER. */
  endLine: number;
  /** The leading whitespace of the BEGIN marker line (preserved on splice). */
  indent: string;
}

/**
 * Locate the single marker pair. THROWS if zero or more than one BEGIN/END
 * marker exists, or if they are out of order — never silently rewrite.
 */
function findMarkerSpan(lines: string[]): MarkerSpan {
  const begins: number[] = [];
  const ends: number[] = [];
  // Match the TRIMMED line for equality with the marker, not `includes`:
  // an incidental mention of the marker text in a comment or value
  // elsewhere in the file would otherwise be miscounted as a duplicate
  // marker and block all regeneration. Only a true marker line — whose
  // sole content (modulo indentation) is the marker — counts.
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed === BEGIN_MARKER) begins.push(i);
    if (trimmed === END_MARKER) ends.push(i);
  });
  if (begins.length === 0 || ends.length === 0) {
    throw new Error(
      `sync-promote-service-options: generated marker block not found ` +
        `(expected exactly one BEGIN and one END marker). ` +
        `BEGIN found ${begins.length}, END found ${ends.length}.`,
    );
  }
  if (begins.length > 1 || ends.length > 1) {
    throw new Error(
      `sync-promote-service-options: duplicate generated markers ` +
        `(found ${begins.length} BEGIN and ${ends.length} END markers; ` +
        `expected exactly one of each). Refusing to rewrite.`,
    );
  }
  const beginLine = begins[0];
  const endLine = ends[0];
  if (endLine <= beginLine) {
    throw new Error(
      `sync-promote-service-options: malformed marker block ` +
        `(END marker at line ${endLine + 1} is not after BEGIN marker at ` +
        `line ${beginLine + 1}). Refusing to rewrite.`,
    );
  }
  const indentMatch = lines[beginLine].match(/^(\s*)/);
  const indent = indentMatch ? indentMatch[1] : "";
  return { beginLine, endLine, indent };
}

/**
 * Produce the full file content with the generated body spliced between the
 * markers. The marker lines themselves are preserved (re-emitted with their
 * original indentation), and the body is rendered at that same detected
 * indent so the keys/items always align with the markers. Content before
 * BEGIN and after END is untouched.
 */
export function renderWorkflow(current: string, tokens: string[]): string {
  // Normalize on \n for splicing; the workflow is LF-committed.
  const lines = current.split("\n");
  const { beginLine, endLine, indent } = findMarkerSpan(lines);
  const body = renderGeneratedBody(tokens, indent);
  const before = lines.slice(0, beginLine);
  const after = lines.slice(endLine + 1);
  const spliced = [
    ...before,
    `${indent}${BEGIN_MARKER}`,
    body,
    `${indent}${END_MARKER}`,
    ...after,
  ];
  return spliced.join("\n");
}

interface ParsedArgs {
  check: boolean;
  workflowPath: string;
}

/**
 * Parse CLI args, accepting EXACTLY `--check` and one `--workflow=<path>`.
 *
 * Fail loud (THROW) on any unrecognized arg, a bare `--workflow` with no
 * value, an empty `--workflow=` value, or a duplicate `--workflow=`. This
 * mirrors the sibling `verify-deploy.ts` (`Unknown argument: <a>`): a typo
 * like `--chek` must NOT silently fall through to a destructive write, and a
 * mishandled `--workflow` must NOT silently target the wrong file. Thrown
 * errors are caught in main() and surface as the usage/I-O exit code (2).
 */
export function parseArgs(args: string[]): ParsedArgs {
  let check = false;
  let workflowPath: string | undefined;
  for (const a of args) {
    if (a === "--check") {
      check = true;
    } else if (a.startsWith("--workflow=")) {
      const v = a.slice("--workflow=".length);
      if (v === "") {
        throw new Error("--workflow= requires a path value");
      }
      if (workflowPath !== undefined) {
        throw new Error("--workflow may only be supplied once");
      }
      workflowPath = resolve(v);
    } else if (a === "--workflow") {
      // Bare `--workflow` with no `=<value>`: this tool only accepts the
      // equals form, so reject rather than silently swallow the next arg.
      throw new Error("--workflow requires a value (use --workflow=<path>)");
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return { check, workflowPath: workflowPath ?? DEFAULT_WORKFLOW_PATH };
}

function main(): void {
  let check: boolean;
  let workflowPath: string;
  try {
    ({ check, workflowPath } = parseArgs(process.argv.slice(2)));
  } catch (err) {
    // Usage error → exit 2 (same code as an I/O error; both are "couldn't
    // even get to the render step"). Fail loud, no silent fallthrough to a
    // destructive write.
    process.stderr.write(
      `sync-promote-service-options: ${(err as Error).message}\n`,
    );
    process.exit(2);
  }

  let current: string;
  try {
    current = readFileSync(workflowPath, "utf8");
  } catch (err) {
    process.stderr.write(
      `sync-promote-service-options: failed to read ${workflowPath}: ${
        (err as Error).message
      }\n`,
    );
    process.exit(2);
  }

  // computeOptionTokens throws on a YAML-unsafe token; renderWorkflow throws
  // (fail loud) on missing/duplicate/malformed markers. Both are render-class
  // failures → exit 3. renderWorkflow also renders the body at the detected
  // marker indent.
  let next: string;
  try {
    const tokens = computeOptionTokens();
    next = renderWorkflow(current, tokens);
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    process.exit(3);
  }

  if (check) {
    if (current !== next) {
      process.stderr.write(
        `showcase_promote.yml service dropdown is stale. Re-run:\n` +
          `  npx tsx showcase/scripts/sync-promote-service-options.ts\n`,
      );
      process.exit(1);
    }
    process.stdout.write(
      "showcase_promote.yml service dropdown is up to date.\n",
    );
    return;
  }

  if (current !== next) {
    try {
      writeFileSync(workflowPath, next);
    } catch (err) {
      // A write failure (EACCES/ENOSPC/etc.) is an I/O error, same class as a
      // read failure → exit 2, consistent with the documented contract and the
      // fail-loud philosophy (no raw stack trace).
      process.stderr.write(
        `sync-promote-service-options: failed to write ${workflowPath}: ${
          (err as Error).message
        }\n`,
      );
      process.exit(2);
    }
    process.stdout.write(`wrote ${workflowPath}\n`);
  } else {
    process.stdout.write(`${workflowPath} already up to date.\n`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
