/**
 * CLI wrapper for the post-release #engr Slack notification builder.
 *
 * Thin glue around the pure buildReleaseNotification() function in
 * ./lib/build-release-notification.ts. The truth-table logic lives (and is
 * unit-tested) there; this file only:
 *   1. reads the release signals from env vars (set by the notify job from
 *      needs.* outputs/results + workflow inputs),
 *   2. resolves the npm-scope package count from release.config.json
 *      (defensively — a cosmetic count must never suppress a real alert),
 *   3. calls the pure builder, and
 *   4. writes `message=` and `should_post=` to GITHUB_OUTPUT.
 *
 * Env vars (all optional; absent → empty string):
 *   MODE                needs.build.outputs.mode            ("stable" | "prerelease" | "")
 *   NPM_RESULT          needs.publish.result                ("success" | "failure" | "skipped" | ...)
 *   NPM_VER             needs.publish.outputs.version
 *   BUILD_RESULT        needs.build.result                  (catches npm build-stage failures)
 *   NPM_INTENDED        notify-job event-derived npm release intent ("true" | ...)  (gates the npm FAILURE arm)
 *   PY_PUB              needs.build-python.outputs.should_publish ("true" | ...)
 *   PY_INTENDED         notify-job event-derived Python release intent ("true" | ...)  (gates the PyPI FAILURE arm)
 *   PY_RESULT           needs.publish-python.result
 *   PY_BUILD_RESULT     needs.build-python.result            (catches PyPI build-stage failures)
 *   PY_VER              needs.build-python.outputs.version
 *   SCOPE               needs.build.outputs.scope           ("monorepo" | "angular")
 *   DRY_RUN             inputs.dry-run                       ("true" | "false" | "")
 *   RUN_URL             this workflow run URL
 *   RELEASE_URL         GitHub Release URL (npm release notes)
 *   NPM_URL             scope-correct npm package/org page URL
 *   PY_URL              PyPI project page URL
 *
 * Usage: pnpm tsx scripts/release/build-release-notification.ts
 */

import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";
import { fileURLToPath } from "url";
import { buildReleaseNotification } from "./lib/build-release-notification.js";
import type {
  ReleaseMode,
  JobResult,
  BuildReleaseNotificationResult,
} from "./lib/build-release-notification.js";
import { getScopeConfig, loadConfig } from "./lib/config.js";
import type { ReleaseScope } from "./lib/config.js";

function env(name: string): string {
  return process.env[name] ?? "";
}

const KNOWN_MODES: readonly ReleaseMode[] = ["stable", "prerelease", ""];

const KNOWN_JOB_RESULTS: readonly JobResult[] = [
  "success",
  "failure",
  "cancelled",
  "skipped",
  "",
];

/**
 * Validate a raw GitHub Actions job-result env value against the known
 * JobResult set, degrading LOUDLY to "failure" (page-on-uncertainty) on any
 * unrecognized value. A mis-wired `needs.<job>.result` env (typo, renamed job,
 * an Actions value we don't model) must not be cast through unchecked.
 *
 * DIRECTION ASYMMETRY (intentional): RESULT values drive FAILURE-gating, and
 * for a status notifier whose thesis is "never swallow a real failure" an
 * unknown result is anomalous and must err toward PAGING, not silence — so it
 * degrades to "failure". This is safe precisely because the failure arms are
 * intent-gated (npmIntended/pyIntended): a degraded result only pages on a real
 * release attempt, never on a routine non-release merge. By contrast
 * resolveModeSafe degrades to "" — MODE drives SUCCESS-gating, where fabricating
 * "stable" would falsely claim a publish that didn't happen. The ::warning::
 * makes the degradation visible in the run log either way.
 */
export function resolveJobResultSafe(raw: string): JobResult {
  if ((KNOWN_JOB_RESULTS as readonly string[]).includes(raw)) {
    return raw as JobResult;
  }
  console.warn(
    `::warning::resolveJobResultSafe: unrecognized job result "${raw}" (expected one of: success, failure, cancelled, skipped, or empty) — coercing to "failure" (page-on-uncertainty; the intent gates ensure this only pages on a real release).`,
  );
  return "failure";
}

/**
 * Validate the raw MODE env value against the known ReleaseMode set, degrading
 * LOUDLY to "" (treated as "npm lane didn't run" — the neutral, safe default)
 * on any unrecognized value. A typo'd MODE must not be cast through unchecked.
 *
 * DIRECTION ASYMMETRY (intentional, opposite of resolveJobResultSafe): MODE
 * drives the npm SUCCESS-gating (success requires mode==="stable"). Degrading a
 * typo to a fabricated "stable" would FALSELY claim a publish that may not have
 * happened, so MODE degrades to the neutral "" — never inventing a success.
 * This does NOT swallow failures: the npm-failure arm keys off the event-derived
 * npmIntended + the job RESULTS (gated only by the canary suppression), so a real
 * stable failure still pages even with a degraded MODE. RESULT values, by
 * contrast, drive FAILURE-gating and so degrade toward "failure"
 * (page-on-uncertainty) in resolveJobResultSafe. The ::warning:: surfaces either
 * degradation in the run log.
 */
export function resolveModeSafe(raw: string): ReleaseMode {
  if ((KNOWN_MODES as readonly string[]).includes(raw)) {
    return raw as ReleaseMode;
  }
  console.warn(
    `::warning::resolveModeSafe: unrecognized MODE "${raw}" (expected one of: stable, prerelease, or empty) — coercing to "" (treated as "npm lane did not run").`,
  );
  return "";
}

/**
 * Resolve the npm-scope package count from release.config.json, degrading to 0
 * on ANY error (unknown scope, missing/corrupt config, etc.). A cosmetic
 * package count must NEVER throw and suppress a real release alert.
 */
export function resolvePackageCountSafe(scope: string): number {
  try {
    // Any scope defined in release.config.json has a package list; anything
    // else (e.g. a python-only run with an empty scope) has no npm packages to
    // count. Membership comes from the config itself so a newly added scope
    // can never drift out of sync with this notifier.
    if (scope in loadConfig().scopes) {
      return getScopeConfig(scope as ReleaseScope).packages.length;
    }
    return 0;
  } catch (err) {
    // Degrade to 0 — the message simply omits the count rather than crashing a
    // status notifier over a cosmetic detail. But surface the error in the run
    // log (don't swallow silently): a corrupt/missing release.config.json
    // should be visible, and the builder will render "published to npm
    // (`latest`)" with no count parenthetical (never "0 packages").
    console.warn(
      `::warning::resolvePackageCountSafe: failed to resolve npm package count for scope "${scope}" — rendering without a package count. ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return 0;
  }
}

/**
 * Serialize the builder result to a GITHUB_OUTPUT file using a per-write RANDOM
 * heredoc delimiter (GitHub's documented pattern), so message content can never
 * collide with / prematurely terminate the heredoc.
 */
export function writeGithubOutput(
  outputPath: string,
  result: BuildReleaseNotificationResult,
): void {
  const delimiter = `EOF_${randomBytes(8).toString("hex")}`;
  fs.appendFileSync(
    outputPath,
    `message<<${delimiter}\n${result.message}\n${delimiter}\n`,
  );
  fs.appendFileSync(outputPath, `should_post=${result.shouldPost}\n`);
}

function main(): void {
  const scope = env("SCOPE");

  const result = buildReleaseNotification({
    mode: resolveModeSafe(env("MODE")),
    npmResult: resolveJobResultSafe(env("NPM_RESULT")),
    npmVer: env("NPM_VER"),
    buildResult: resolveJobResultSafe(env("BUILD_RESULT")),
    npmIntended: env("NPM_INTENDED"),
    pyPub: env("PY_PUB"),
    pyIntended: env("PY_INTENDED"),
    pyResult: resolveJobResultSafe(env("PY_RESULT")),
    pyBuildResult: resolveJobResultSafe(env("PY_BUILD_RESULT")),
    pyVer: env("PY_VER"),
    scope,
    dryRun: env("DRY_RUN") === "true",
    packageCount: resolvePackageCountSafe(scope),
    runUrl: env("RUN_URL"),
    releaseUrl: env("RELEASE_URL"),
    npmUrl: env("NPM_URL"),
    pyUrl: env("PY_URL"),
  });

  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    writeGithubOutput(outputPath, result);
  } else if (process.env.GITHUB_ACTIONS === "true") {
    // A status notifier that cannot write its `should_post`/`message` outputs
    // is broken: the Post step gates on those outputs, so silently no-op'ing
    // would swallow a real release alert. Fail loud under Actions.
    console.error(
      "::error::GITHUB_OUTPUT is unset under GitHub Actions — cannot emit should_post/message for the release notification.",
    );
    process.exit(1);
  }

  // Console echo (always useful in logs; the sole output channel for an
  // explicit local/no-Actions invocation).
  console.log(`should_post=${result.shouldPost}`);
  if (result.message) {
    console.log(`message:\n${result.message}`);
  }
}

// Only run when invoked directly as a CLI, not when imported by tests.
// Apply fs.realpathSync to BOTH sides so a symlinked checkout (where the module
// path and argv[1] resolve to the same real file through different symlinks)
// can't make main() silently not run. But realpathSync THROWS (ENOENT) if
// argv[1] doesn't resolve on disk — which would crash before main() and
// swallow a real release alert. So guard it: on a realpath throw, fall back to
// a path.resolve()-normalized compare (no disk resolution) so the normal
// direct-invoke path still runs the notifier. Normalize BOTH sides with
// path.resolve — modulePath is already absolute (fileURLToPath), but argv[1]
// may be relative, so a bare string compare could spuriously fail and silently
// skip main() on a realpath throw.
function isInvokedDirectly(): boolean {
  if (process.argv[1] == null) return false;
  const modulePath = fileURLToPath(import.meta.url);
  try {
    return fs.realpathSync(modulePath) === fs.realpathSync(process.argv[1]);
  } catch {
    return path.resolve(modulePath) === path.resolve(process.argv[1]);
  }
}
if (isInvokedDirectly()) {
  main();
}
