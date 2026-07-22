/**
 * Pure message-builder for the post-release #engr Slack notification.
 *
 * This is the load-bearing truth table for what (if anything) gets posted to
 * Slack after the publish-release.yml workflow runs. It is deliberately a PURE
 * function of its inputs so the full truth table can be unit-tested without any
 * GitHub Actions / network involvement. The thin CLI wrapper
 * (scripts/release/build-release-notification.ts) parses env vars, resolves the
 * package count from release.config.json, calls this function, and writes the
 * result to GITHUB_OUTPUT.
 *
 * Failure model — TWO INDEPENDENT LANES (npm + PyPI):
 *
 *   - dry-run → no post (entirely suppressed).
 *
 *   - npm lane (canary npm fully suppressed — success AND failure — when
 *     mode === "prerelease", because npm canaries are noise):
 *       • SUCCESS line when mode==stable && npmResult==success && npmVer set.
 *         The "<releaseUrl|Release notes>" link is included only when
 *         releaseUrl is non-empty. This empty-releaseUrl guard is retained as
 *         DEFENSE-IN-DEPTH: the empty-releaseUrl-on-SUCCESS state is NOT
 *         currently reachable — the tag step is `if: success()`, so a tag-step
 *         failure flips the publish JOB to `failure`, routing to the failure
 *         arm (npmResult != "success") rather than rendering an empty link. The
 *         guard exists so that a FUTURE change making the tag step
 *         continue-on-error (publish success + empty tag output) cannot render a
 *         broken empty "<|Release notes>" / "/releases/tag/" link. Do NOT
 *         remove it. The "(`latest`, N packages)" count parenthetical is OMITTED
 *         when the resolved packageCount is 0 (unknown/degraded config) — never
 *         print the self-contradictory "0 packages".
 *       • FAILURE alert (lane-level, NOT step-level) when
 *         npmIntended && (npmResult==failure || buildResult==failure) &&
 *         mode != "prerelease". Gated on the event-derived npmIntended (computed
 *         in the notify job from the github.event payload — a workflow_dispatch
 *         or a merged release/publish/* PR) and the job results, with the canary
 *         suppression. NOT additionally gated on mode==stable (which would
 *         swallow a real stable publish failure whose mode output came back
 *         empty). See the inline LANE SYMMETRY note. The publish step may have
 *         succeeded with a LATER tag/release step failing, so the wording is
 *         "release failed", never "publish failed".
 *
 *   - PyPI lane (INDEPENDENT of MODE — PyPI has no canary concept, so a
 *     mode=prerelease dispatch that also runs python_publish must still
 *     announce the real PyPI publish. NB: this mode-independence only matters
 *     when the python lane was actually dispatched; on a pure npm release the
 *     lane is skipped and contributes nothing):
 *       • SUCCESS line when pyPub=="true" && pyResult==success && pyVer set.
 *         (Success legitimately requires detect to have run and emitted
 *         should_publish, so pyPub is the correct success gate.)
 *       • FAILURE alert when pyIntended &&
 *         (pyResult==failure || pyBuildResult==failure), where pyIntended is the
 *         notify job's event-derived Python-release intent (a python_publish
 *         dispatch, OR a merged PR that changed sdk-python/pyproject.toml per
 *         the GitHub PR changed-files API). Symmetric with the npm lane. The
 *         pyBuildResult arm closes the gap where build-python FAILS during a
 *         genuine release → publish-python is skipped (its `if` requires
 *         build-python.result == 'success') → pyResult is "skipped", so a bare
 *         pyResult check would post nothing. CRITICAL — gate on the
 *         build-job-INDEPENDENT intent, not pyPub: should_publish (pyPub) is
 *         emitted only at the END of the detect step, so a build-python failure
 *         AT/BEFORE detect on a genuine release (PyPI API outage, setup-python
 *         failure, malformed pyproject) never emits it → pyPub="" → a pyPub-gated
 *         failure arm SILENTLY SWALLOWS the alert. pyIntended is computed in the
 *         notify job itself from the github.event payload + the PR changed-files
 *         API, so it does NOT depend on the build jobs running at all. pyIntended
 *         also keeps routine non-Python PRs quiet: build-python runs on EVERY
 *         merged PR, but a docs/npm-only PR neither changed pyproject.toml nor is
 *         a python_publish dispatch, so a transient build flake stays neutral. A
 *         CANCELLED build reports "cancelled" (NOT "failure") and stays neutral
 *         — no false-RED on a deliberate cancel.
 *
 *   - cancelled is NEUTRAL everywhere — never a failure line. (GitHub has no
 *     timeout-specific result; a job hitting timeout-minutes reports
 *     "cancelled", which correctly stays neutral.) This matches the
 *     showcase-notify convention and avoids false-red pages on deliberate
 *     cancels (e.g. concurrency cancel-in-progress).
 *
 *   - a skipped lane contributes NOTHING (no false red).
 *   - shouldPost is true iff ≥1 line (success OR failure) was emitted; an empty
 *     message never posts.
 *
 * See build-release-notification.test.ts for the exhaustive truth table.
 */

export type ReleaseMode = "stable" | "prerelease" | "";

/**
 * GitHub Actions `result` values for a needed job. These are the ONLY values
 * GitHub emits: success | failure | cancelled | skipped (plus "" when unset).
 * There is no timeout-specific result — a job that hits timeout-minutes
 * reports "cancelled". We only treat "success" and "failure" as actionable;
 * "skipped"/"cancelled"/"" are neutral.
 */
export type JobResult = "success" | "failure" | "skipped" | "cancelled" | "";

export interface BuildReleaseNotificationInput {
  /** needs.build.outputs.mode — "stable" | "prerelease" | "" (empty when npm lane didn't run). */
  mode: ReleaseMode;
  /** needs.publish.result — the npm publish job result. */
  npmResult: JobResult;
  /** needs.publish.outputs.version — the published npm version (empty unless stable success). */
  npmVer: string;
  /** needs.build.result — the npm build job result (catches build-stage failures). */
  buildResult: JobResult;
  /**
   * NPM_INTENDED — "true" when the notify job determined an npm release was
   * actually attempted, computed in the notify job itself from the
   * github.event payload (a workflow_dispatch, or a merged release/publish/*
   * PR) — independent of whether/how the build jobs ran. The npm FAILURE arm
   * gates on this so a build-job failure on a genuine npm release always pages,
   * even if needs.build emitted no usable outputs.
   */
  npmIntended: string;
  /** needs.build-python.outputs.should_publish — "true" when the PyPI lane acted. */
  pyPub: string;
  /**
   * PY_INTENDED — "true" when the notify job determined a Python release was
   * actually intended, computed in the notify job itself: a workflow_dispatch
   * with python_publish=true, OR a merged PR that changed
   * sdk-python/pyproject.toml (determined via the GitHub PR changed-files API,
   * not the build job's outputs). This is the build-job-INDEPENDENT Python
   * release-intent signal. should_publish (pyPub) is emitted only at the END of
   * build-python's `detect` step, so a build-python failure at/before detect on
   * a genuine release never emits should_publish — gating the failure arm on
   * pyIntended (not pyPub) closes that silent-swallow gap.
   */
  pyIntended: string;
  /** needs.publish-python.result — the PyPI publish job result. */
  pyResult: JobResult;
  /**
   * needs.build-python.result — the PyPI build job result. Lets the failure
   * lane catch a build-stage failure that skips publish-python (whose `if`
   * requires build-python.result == 'success', so pyResult becomes "skipped").
   */
  pyBuildResult: JobResult;
  /** needs.build-python.outputs.version — the published PyPI version. */
  pyVer: string;
  /** needs.build.outputs.scope — any npm scope from release.config.json, including intelligence-langgraph. */
  scope: string;
  /** inputs.dry-run — true on a dry-run dispatch. */
  dryRun: boolean;
  /** Number of packages in the npm scope (from release.config.json). */
  packageCount: number;
  /** URL to this workflow run (for failure "View run" links). */
  runUrl: string;
  /** URL to the GitHub Release for the npm release (for "Release notes" link). May be empty. */
  releaseUrl: string;
  /** URL to the npm package/org page (for the "npm" link). Scope-correct. */
  npmUrl: string;
  /** URL to the PyPI project page (for the "PyPI" link). */
  pyUrl: string;
}

export interface BuildReleaseNotificationResult {
  /** The combined Slack message (mrkdwn). Empty when shouldPost is false. */
  message: string;
  /** True iff there is ≥1 success line OR ≥1 failure line. */
  shouldPost: boolean;
}

function pluralizePackages(count: number): string {
  return count === 1 ? "1 package" : `${count} packages`;
}

/**
 * Build the #engr Slack message for a release run. Pure function: same
 * inputs always produce the same output.
 */
export function buildReleaseNotification(
  input: BuildReleaseNotificationInput,
): BuildReleaseNotificationResult {
  const empty: BuildReleaseNotificationResult = {
    message: "",
    shouldPost: false,
  };

  // Dry-run never posts (no real publish happened on any lane).
  if (input.dryRun) {
    return empty;
  }

  // Both failure lanes gate on an event-derived intent signal computed in the
  // notify job (NOT on the build jobs' outputs/results). npmIntended is "true"
  // when an npm release was actually attempted; pyIntended is "true" when a
  // Python release was actually intended. See the per-lane notes below.
  const npmIntended = input.npmIntended === "true";
  const pyIntended = input.pyIntended === "true";

  const lines: string[] = [];
  // Render the scope cleanly when empty: a bare " " or doubled "release"
  // word must never appear. With scope present we get "CopilotKit <scope> …";
  // with scope empty we collapse to "CopilotKit …" (no extra word/space).
  const scopeSegment = input.scope ? `${input.scope} ` : "";

  // --- npm lane -----------------------------------------------------------
  // Canary (prerelease) npm runs are fully suppressed — success AND failure —
  // because npm canaries are noise. The PyPI lane below is NOT gated on this.
  if (input.mode !== "prerelease") {
    if (
      input.mode === "stable" &&
      input.npmResult === "success" &&
      input.npmVer
    ) {
      // Build the success line, including the "Release notes" link ONLY when
      // releaseUrl is non-empty. This guard is retained as DEFENSE-IN-DEPTH (see
      // header): the empty-releaseUrl-on-SUCCESS state is NOT currently
      // reachable — the tag step is `if: success()`, so a tag-step failure flips
      // the publish JOB to `failure` and routes to the failure arm rather than
      // this success arm. The guard protects against a FUTURE change making the
      // tag step continue-on-error (publish success + empty tag output), which
      // would otherwise render a broken empty "<|Release notes>" /
      // "/releases/tag/" link. Do NOT remove it.
      const releaseNotes = input.releaseUrl
        ? `<${input.releaseUrl}|Release notes> · `
        : "";
      // Omit the "(`latest`, N packages)" count parenthetical entirely when
      // the package count is unknown/degraded (0) — never print "0 packages".
      const countSuffix =
        input.packageCount > 0
          ? ` (\`latest\`, ${pluralizePackages(input.packageCount)})`
          : " (`latest`)";
      lines.push(
        `🚀 *CopilotKit ${scopeSegment}v${input.npmVer}* published to npm` +
          `${countSuffix} · ` +
          `${releaseNotes}<${input.npmUrl}|npm>`,
      );
    } else if (
      npmIntended &&
      (input.npmResult === "failure" || input.buildResult === "failure")
    ) {
      // Lane-level wording: the publish step may have succeeded while a later
      // tag/release step failed, so never say "npm publish failed".
      //
      // The npm FAILURE arm gates on npmIntended AND the job results, with the
      // enclosing canary suppression (mode !== "prerelease"). It is NOT gated on
      // mode === "stable" (that would swallow a real stable publish failure
      // whose mode output came back empty).
      //
      // LANE SYMMETRY (now both lanes are intent-gated from the notify job's
      // event-derived signals): npmIntended is computed in the notify job from
      // the github.event payload (a workflow_dispatch, or a merged
      // release/publish/* PR) — NOT inferred from the `build` job's
      // branch-gating invariant. So a build-job failure that emits no usable
      // outputs still pages on a genuine npm release, and a routine non-release
      // merge's build flake stays quiet. The PyPI lane below is symmetric: it
      // gates on pyIntended, likewise event-derived in the notify job.
      lines.push(
        `🔴 *CopilotKit ${scopeSegment}release failed* · <${input.runUrl}|View run>`,
      );
    }
    // cancelled / skipped on the npm lane are NEUTRAL → no line.
  }

  // --- PyPI lane ----------------------------------------------------------
  // INDEPENDENT of MODE — PyPI has no canary concept, so the prerelease path
  // never suppresses a real PyPI publish.
  // pyIntended is the notify job's event-derived Python-release intent signal,
  // computed independently of the build jobs (a python_publish dispatch, or a
  // merged PR that changed sdk-python/pyproject.toml per the GitHub PR
  // changed-files API). The SUCCESS arm still requires pyPub (should_publish)
  // because a legitimate success necessarily means detect ran and emitted it;
  // only the FAILURE arm must gate on the build-job-independent intent so a
  // build-python failure AT/BEFORE detect (which never reaches the
  // should_publish echo) still pages.
  if (input.pyPub === "true" && input.pyResult === "success" && input.pyVer) {
    lines.push(
      `🐍 *copilotkit (Python SDK) v${input.pyVer}* published to PyPI · ` +
        `<${input.pyUrl}|PyPI>`,
    );
  } else if (
    pyIntended &&
    (input.pyResult === "failure" || input.pyBuildResult === "failure")
  ) {
    // Fire on a real Python release attempt when EITHER the publish job failed
    // OR the build job failed. Keying off pyBuildResult catches the gap where
    // build-python FAILS → publish-python is skipped (its `if` requires
    // build-python.result == 'success') → pyResult is "skipped" and the bare
    // pyResult check would post nothing.
    //
    // The gate is pyIntended (the notify job's event-derived Python-release
    // intent), NOT pyPub: pyPub (should_publish) is emitted only at the END of
    // the detect step, so a build-python failure AT/BEFORE detect on a genuine
    // release (PyPI API outage, setup-python failure, malformed pyproject) never
    // emits it → pyPub="" → the old pyPub gate silently swallowed the alert.
    // pyIntended is computed in the notify job from the github.event payload +
    // the PR changed-files API, so it is present regardless of how the build
    // jobs ran. pyIntended also keeps routine non-Python PRs quiet: build-python
    // runs on EVERY merged PR, but a docs/npm-only PR neither changed
    // sdk-python/pyproject.toml nor is a python_publish dispatch, so a transient
    // build flake there stays neutral. Use pyBuildResult === "failure" (NOT
    // "skipped"): a CANCELLED build reports "cancelled" and stays NEUTRAL, so a
    // deliberate cancel never false-REDs.
    lines.push(
      `🔴 *copilotkit (Python SDK) release failed* · <${input.runUrl}|View run>`,
    );
  }

  if (lines.length === 0) {
    return empty;
  }

  return { message: lines.join("\n"), shouldPost: true };
}
