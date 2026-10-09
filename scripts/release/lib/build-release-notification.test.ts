import { describe, it, expect } from "vitest";
import { buildReleaseNotification } from "./build-release-notification.js";
import type { BuildReleaseNotificationInput } from "./build-release-notification.js";

const RUN_URL = "https://github.com/CopilotKit/CopilotKit/actions/runs/123";
const RELEASE_URL =
  "https://github.com/CopilotKit/CopilotKit/releases/tag/v1.2.3";
const NPM_URL = "https://www.npmjs.com/org/copilotkit";
const ANGULAR_NPM_URL = "https://www.npmjs.com/package/@copilotkit/angular";
const PY_URL = "https://pypi.org/project/copilotkit/0.9.0/";

// A neutral baseline where nothing has acted. Each test overrides only the
// fields relevant to its truth-table row.
function base(
  overrides: Partial<BuildReleaseNotificationInput> = {},
): BuildReleaseNotificationInput {
  return {
    mode: "",
    npmResult: "skipped",
    npmVer: "",
    buildResult: "skipped",
    npmIntended: "false",
    pyPub: "false",
    pyIntended: "false",
    pyResult: "skipped",
    pyBuildResult: "skipped",
    pyVer: "",
    scope: "monorepo",
    dryRun: false,
    packageCount: 16,
    runUrl: RUN_URL,
    releaseUrl: RELEASE_URL,
    npmUrl: NPM_URL,
    pyUrl: PY_URL,
    ...overrides,
  };
}

describe("buildReleaseNotification", () => {
  // ---- dry-run --------------------------------------------------------------
  it("suppresses dry-run — no post", () => {
    const r = buildReleaseNotification(
      base({
        mode: "stable",
        npmResult: "success",
        npmVer: "1.2.3",
        dryRun: true,
      }),
    );
    expect(r.shouldPost).toBe(false);
    expect(r.message).toBe("");
  });

  // ---- npm lane: prerelease canary fully suppressed -------------------------
  it("suppresses prerelease (canary) success — no post", () => {
    const r = buildReleaseNotification(
      base({
        mode: "prerelease",
        npmResult: "success",
        npmVer: "1.2.3-canary.1",
        buildResult: "success",
      }),
    );
    expect(r.shouldPost).toBe(false);
    expect(r.message).toBe("");
  });

  it("suppresses prerelease (canary) npm failure — no post", () => {
    const r = buildReleaseNotification(
      base({
        mode: "prerelease",
        npmIntended: "true",
        npmResult: "failure",
        buildResult: "success",
      }),
    );
    expect(r.shouldPost).toBe(false);
    expect(r.message).toBe("");
  });

  it("suppresses prerelease (canary) build failure — no post (would otherwise fire)", () => {
    // Slot-6 strengthening: this row would emit a lane-level failure if the
    // prerelease suppression on the npm lane regressed. buildResult=failure
    // alone fires the alert UNLESS mode === "prerelease".
    const r = buildReleaseNotification(
      base({
        mode: "prerelease",
        npmIntended: "true",
        npmResult: "skipped",
        buildResult: "failure",
      }),
    );
    expect(r.shouldPost).toBe(false);
    expect(r.message).toBe("");
  });

  // ---- npm lane: stable success --------------------------------------------
  it("stable npm success → npm success line (monorepo, N packages)", () => {
    const r = buildReleaseNotification(
      base({
        mode: "stable",
        npmResult: "success",
        npmVer: "1.2.3",
        buildResult: "success",
      }),
    );
    expect(r.shouldPost).toBe(true);
    expect(r.message).toBe(
      "🚀 *CopilotKit monorepo v1.2.3* published to npm (`latest`, 16 packages) · " +
        `<${RELEASE_URL}|Release notes> · <${NPM_URL}|npm>`,
    );
  });

  it("stable npm success with empty releaseUrl → success line, NO broken Release-notes link", () => {
    const r = buildReleaseNotification(
      base({
        mode: "stable",
        npmResult: "success",
        npmVer: "1.2.3",
        buildResult: "success",
        releaseUrl: "",
      }),
    );
    expect(r.shouldPost).toBe(true);
    expect(r.message).toBe(
      "🚀 *CopilotKit monorepo v1.2.3* published to npm (`latest`, 16 packages) · " +
        `<${NPM_URL}|npm>`,
    );
    // The broken "/releases/tag/" empty link must never appear.
    expect(r.message).not.toContain("Release notes");
    expect(r.message).not.toContain("<|");
  });

  it("angular scope uses the angular package npm URL", () => {
    const r = buildReleaseNotification(
      base({
        mode: "stable",
        npmResult: "success",
        npmVer: "2.0.0",
        buildResult: "success",
        scope: "angular",
        packageCount: 1,
        npmUrl: ANGULAR_NPM_URL,
      }),
    );
    expect(r.message).toContain(`<${ANGULAR_NPM_URL}|npm>`);
    expect(r.message).toContain("*CopilotKit angular v2.0.0*");
    expect(r.message).toContain("(`latest`, 1 package)");
  });

  // ---- npm lane: failure (lane-level wording) -------------------------------
  it("stable npm failure → lane-level red alert (NOT 'npm publish failed')", () => {
    const r = buildReleaseNotification(
      base({
        mode: "stable",
        npmIntended: "true",
        npmResult: "failure",
        buildResult: "success",
      }),
    );
    expect(r.shouldPost).toBe(true);
    expect(r.message).toBe(
      `🔴 *CopilotKit monorepo release failed* · <${RUN_URL}|View run>`,
    );
    // A post-publish step (tag/release) may have failed while publish itself
    // succeeded — never claim "publish failed".
    expect(r.message).not.toContain("publish failed");
  });

  it("stable npm publish step SUCCEEDED (version emitted) but JOB failed at a later step → FAILURE line, NOT success (if/else ordering)", () => {
    // The central npm-lane design claim: a populated version does NOT force a
    // success line. The publish step can succeed and emit a version while the
    // JOB still ends in `failure` (e.g. a later tag/release step broke). The
    // success arm requires npmResult === "success"; here npmResult is "failure",
    // so the `else if (npmResult === "failure" ...)` branch wins → lane-level
    // "release failed". This locks the if/else ORDERING: failure result beats a
    // populated version. Wording stays lane-level ("release failed"), never
    // "publish failed", precisely because publish itself may have succeeded.
    const r = buildReleaseNotification(
      base({
        mode: "stable",
        npmIntended: "true",
        npmResult: "failure",
        npmVer: "1.2.3",
        buildResult: "success",
      }),
    );
    expect(r.shouldPost).toBe(true);
    expect(r.message).toBe(
      `🔴 *CopilotKit monorepo release failed* · <${RUN_URL}|View run>`,
    );
    // Must NOT render a success line despite the populated version.
    expect(r.message).not.toContain("🚀");
    expect(r.message).not.toContain("published to npm");
    // Lane-level, never step-level.
    expect(r.message).not.toContain("publish failed");
  });

  it("build failure (mode='', npm skipped) → lane-level npm/build red alert", () => {
    // A failure in the build job before the publish job ran: npmResult is
    // "skipped" and mode is empty, but buildResult is "failure".
    const r = buildReleaseNotification(
      base({
        mode: "",
        npmIntended: "true",
        npmResult: "skipped",
        buildResult: "failure",
        scope: "monorepo",
      }),
    );
    expect(r.shouldPost).toBe(true);
    expect(r.message).toBe(
      `🔴 *CopilotKit monorepo release failed* · <${RUN_URL}|View run>`,
    );
    expect(r.message).not.toContain("publish failed");
  });

  it("npm publish failure with empty mode (npmResult='failure') → lane-level red alert (no mode-coupling swallow)", () => {
    // The npm FAILURE arm keys off npmIntended (the notify job's event-derived
    // release intent) AND the job result — NOT on mode === "stable" (that would
    // swallow a real stable publish failure whose mode output came back empty).
    // An empty mode with a real publish failure on a genuine release attempt
    // still pages.
    const r = buildReleaseNotification(
      base({
        mode: "",
        npmIntended: "true",
        npmResult: "failure",
        buildResult: "success",
        scope: "monorepo",
      }),
    );
    expect(r.shouldPost).toBe(true);
    expect(r.message).toBe(
      `🔴 *CopilotKit monorepo release failed* · <${RUN_URL}|View run>`,
    );
    expect(r.message).not.toContain("publish failed");
  });

  // ---- npm lane: EVENT-DERIVED intent gate ---------------------------------
  it("npmIntended='true' + buildResult='failure' → npm red ALERT (intent gate open)", () => {
    // The notify job determined an npm release was actually attempted
    // (release/publish/* merge or a workflow_dispatch). A build-job failure on a
    // genuine npm release must page — independent of needs.build outputs.
    const r = buildReleaseNotification(
      base({
        mode: "",
        npmIntended: "true",
        npmResult: "skipped",
        buildResult: "failure",
        scope: "monorepo",
      }),
    );
    expect(r.shouldPost).toBe(true);
    expect(r.message).toBe(
      `🔴 *CopilotKit monorepo release failed* · <${RUN_URL}|View run>`,
    );
  });

  it("npmIntended='false' + buildResult='failure' → NEUTRAL (no npm release attempted)", () => {
    // The notify job runs on EVERY merged PR. A routine non-release merge whose
    // build job flakes (or a stray failure) carries no npm release intent
    // (not a release/publish/* merge, not a dispatch), so the lane stays quiet.
    const r = buildReleaseNotification(
      base({
        mode: "",
        npmIntended: "false",
        npmResult: "skipped",
        buildResult: "failure",
        scope: "monorepo",
      }),
    );
    expect(r.shouldPost).toBe(false);
    expect(r.message).toBe("");
  });

  // ---- PyPI lane: independent of MODE --------------------------------------
  it("PyPI success → only PyPI line", () => {
    const r = buildReleaseNotification(
      base({ pyPub: "true", pyResult: "success", pyVer: "0.9.0" }),
    );
    expect(r.shouldPost).toBe(true);
    expect(r.message).toBe(
      "🐍 *copilotkit (Python SDK) v0.9.0* published to PyPI · " +
        `<${PY_URL}|PyPI>`,
    );
  });

  it("PyPI failure → lane-level PyPI red alert", () => {
    const r = buildReleaseNotification(
      base({ pyIntended: "true", pyPub: "true", pyResult: "failure" }),
    );
    expect(r.shouldPost).toBe(true);
    expect(r.message).toBe(
      `🔴 *copilotkit (Python SDK) release failed* · <${RUN_URL}|View run>`,
    );
  });

  it("build-python failure during a REAL Python release (pyPub='true', publish-python skipped) → PyPI red alert", () => {
    // The previously-silent gap: on a genuine Python release where build-python
    // FAILS, publish-python is skipped (its `if` requires
    // build-python.result == 'success') → pyResult === 'skipped'. Keying the
    // failure lane off pyBuildResult catches this so a real release that broke
    // at build still pages, instead of posting nothing.
    const r = buildReleaseNotification(
      base({
        pyIntended: "true",
        pyPub: "true",
        pyResult: "skipped",
        pyBuildResult: "failure",
      }),
    );
    expect(r.shouldPost).toBe(true);
    expect(r.message).toBe(
      `🔴 *copilotkit (Python SDK) release failed* · <${RUN_URL}|View run>`,
    );
  });

  it("build-python CANCELLED during a real Python release → NEUTRAL (no false red on deliberate cancel)", () => {
    // A cancelled build-python reports result 'cancelled' (NOT 'failure'), even
    // when it hits timeout-minutes. The failure lane keys off
    // pyBuildResult === 'failure', so a cancel stays neutral.
    const r = buildReleaseNotification(
      base({
        pyIntended: "true",
        pyPub: "true",
        pyResult: "skipped",
        pyBuildResult: "cancelled",
      }),
    );
    expect(r.shouldPost).toBe(false);
    expect(r.message).toBe("");
  });

  it("build-python failure WITHOUT intent (pyIntended='false', pyBuildResult='failure') → NO post (routine PR flake)", () => {
    // build-python runs on EVERY merged PR; a transient build-python failure on
    // an unrelated PR (no release intent) must NOT page. The pyIntended === 'true'
    // gate is what prevents this false-RED.
    const r = buildReleaseNotification(
      base({
        pyIntended: "false",
        pyPub: "",
        pyResult: "skipped",
        pyBuildResult: "failure",
      }),
    );
    expect(r.shouldPost).toBe(false);
    expect(r.message).toBe("");
  });

  it("build-python without intent (pyIntended='false') → NO post (routine PR, no false red)", () => {
    // build-python runs on EVERY merged PR; only its inner steps are
    // pyproject-gated. A transient build-python failure on an unrelated
    // (docs/npm-only) PR must NOT page a PyPI failure — the notify job's
    // event-derived pyIntended is false (no Python release attempted).
    const r = buildReleaseNotification(
      base({ pyIntended: "false", pyPub: "", pyResult: "skipped" }),
    );
    expect(r.shouldPost).toBe(false);
    expect(r.message).toBe("");
  });

  // ---- PyPI lane: EARLY-INTENT failure gate (closes the should_publish gap) -
  it("build-python failure AT/BEFORE detect on a genuine Python release (pyIntended='true', pyPub='' — detect never emitted) → PyPI red ALERT", () => {
    // THE CLOSED GAP. should_publish (pyPub) is emitted at the END of the detect
    // step. A build-python failure at/before detect (PyPI API outage,
    // setup-python failure, malformed pyproject) on a genuine Python release
    // never reaches the should_publish echo → pyPub="". Gating the failure arm
    // on pyPub silently swallowed this. The notify job's event-derived
    // pyIntended (computed independently of the build jobs) catches it.
    const r = buildReleaseNotification(
      base({
        pyIntended: "true",
        pyPub: "",
        pyResult: "skipped",
        pyBuildResult: "failure",
      }),
    );
    expect(r.shouldPost).toBe(true);
    expect(r.message).toBe(
      `🔴 *copilotkit (Python SDK) release failed* · <${RUN_URL}|View run>`,
    );
  });

  it("routine PR build-python flake (pyIntended='false', pyBuildResult='failure') → NEUTRAL (no false-RED)", () => {
    // build-python runs on EVERY merged PR; an npm/docs-only PR's transient
    // build-python failure carries no release intent (the notify job's
    // pyIntended is false — the merged PR did not change sdk-python/pyproject.toml
    // and this is not a python_publish dispatch), so the lane stays quiet.
    const r = buildReleaseNotification(
      base({
        pyIntended: "false",
        pyPub: "",
        pyResult: "skipped",
        pyBuildResult: "failure",
      }),
    );
    expect(r.shouldPost).toBe(false);
    expect(r.message).toBe("");
  });

  it("python release intended (pyIntended='true', pyBuildResult='failure') → PyPI red ALERT", () => {
    // An explicit Python release intent (a python_publish=true dispatch, or a
    // merged PR that bumped sdk-python/pyproject.toml). A build failure before
    // detect emits no should_publish, but the event-derived pyIntended signal
    // still fires the alert.
    const r = buildReleaseNotification(
      base({
        pyIntended: "true",
        pyPub: "",
        pyResult: "skipped",
        pyBuildResult: "failure",
      }),
    );
    expect(r.shouldPost).toBe(true);
    expect(r.message).toBe(
      `🔴 *copilotkit (Python SDK) release failed* · <${RUN_URL}|View run>`,
    );
  });

  it("prerelease + BOTH lanes failing → ONLY the PyPI red line, npm fully suppressed (canary)", () => {
    // A mode=prerelease dispatch where the npm lane fails AND the PyPI lane
    // fails. The npm failure is canary noise → fully suppressed by
    // mode === "prerelease". The PyPI lane is mode-independent, so its real
    // failure (pyPub="true", pyResult="failure") still pages. Exactly one red
    // line, the PyPI one.
    const r = buildReleaseNotification(
      base({
        mode: "prerelease",
        npmIntended: "true",
        npmResult: "failure",
        buildResult: "failure",
        pyIntended: "true",
        pyPub: "true",
        pyResult: "failure",
      }),
    );
    expect(r.shouldPost).toBe(true);
    // No npm line: the npm failure marker "*CopilotKit" (the npm line's bold
    // prefix) must be absent. NB: the RUN_URL contains "CopilotKit/CopilotKit",
    // so assert on the line prefix, not the bare org name.
    expect(r.message).not.toContain("*CopilotKit");
    expect(r.message).toBe(
      `🔴 *copilotkit (Python SDK) release failed* · <${RUN_URL}|View run>`,
    );
  });

  it("prerelease + python_publish success → npm suppressed, PyPI line still posts", () => {
    // A mode=prerelease dispatch that also runs the Python lane must still
    // announce the real PyPI publish — the canary suppression is npm-only.
    const r = buildReleaseNotification(
      base({
        mode: "prerelease",
        npmResult: "success",
        npmVer: "1.2.3-canary.1",
        buildResult: "success",
        pyPub: "true",
        pyResult: "success",
        pyVer: "0.9.0",
      }),
    );
    expect(r.shouldPost).toBe(true);
    expect(r.message).not.toContain("🚀");
    expect(r.message).not.toContain("canary");
    expect(r.message).toBe(
      "🐍 *copilotkit (Python SDK) v0.9.0* published to PyPI · " +
        `<${PY_URL}|PyPI>`,
    );
  });

  // ---- cancelled is NEUTRAL everywhere -------------------------------------
  it("npm cancelled (mode=stable) → no line (neutral, no false red)", () => {
    const r = buildReleaseNotification(
      base({ mode: "stable", npmResult: "cancelled", buildResult: "success" }),
    );
    expect(r.shouldPost).toBe(false);
    expect(r.message).toBe("");
  });

  it("build cancelled → no line (neutral)", () => {
    const r = buildReleaseNotification(
      base({ mode: "", npmResult: "skipped", buildResult: "cancelled" }),
    );
    expect(r.shouldPost).toBe(false);
    expect(r.message).toBe("");
  });

  it("PyPI cancelled → no line (neutral)", () => {
    const r = buildReleaseNotification(
      base({ pyPub: "true", pyResult: "cancelled" }),
    );
    expect(r.shouldPost).toBe(false);
    expect(r.message).toBe("");
  });

  it("build-python succeeded but publish-python cancelled (should_publish=true) → no line (neutral)", () => {
    // Distinct from the row above: here build-python passed (pyBuildResult
    // 'success') and the publish job was cancelled. Neither a build failure nor
    // a publish failure → neutral, no false red.
    const r = buildReleaseNotification(
      base({ pyPub: "true", pyResult: "cancelled", pyBuildResult: "success" }),
    );
    expect(r.shouldPost).toBe(false);
    expect(r.message).toBe("");
  });

  // ---- skipped lanes contribute nothing ------------------------------------
  it("python-only run (npm lane skipped) → only PyPI line, NO false red", () => {
    const r = buildReleaseNotification(
      base({
        mode: "",
        npmResult: "skipped",
        buildResult: "skipped",
        pyPub: "true",
        pyResult: "success",
        pyVer: "0.9.0",
      }),
    );
    expect(r.shouldPost).toBe(true);
    expect(r.message).not.toContain("🔴");
    expect(r.message).toBe(
      "🐍 *copilotkit (Python SDK) v0.9.0* published to PyPI · " +
        `<${PY_URL}|PyPI>`,
    );
  });

  it("npm-only run (PyPI lane not acting) → only npm line", () => {
    const r = buildReleaseNotification(
      base({
        mode: "stable",
        npmResult: "success",
        npmVer: "1.2.3",
        buildResult: "success",
        pyPub: "false",
        pyResult: "skipped",
      }),
    );
    expect(r.shouldPost).toBe(true);
    expect(r.message).toContain("🚀 *CopilotKit monorepo v1.2.3*");
    expect(r.message).not.toContain("🐍");
    expect(r.message).not.toContain("🔴");
  });

  // ---- both lanes ----------------------------------------------------------
  it("both lanes succeed → one message with both lines", () => {
    const r = buildReleaseNotification(
      base({
        mode: "stable",
        npmResult: "success",
        npmVer: "1.2.3",
        buildResult: "success",
        pyPub: "true",
        pyResult: "success",
        pyVer: "0.9.0",
      }),
    );
    expect(r.shouldPost).toBe(true);
    const expected =
      "🚀 *CopilotKit monorepo v1.2.3* published to npm (`latest`, 16 packages) · " +
      `<${RELEASE_URL}|Release notes> · <${NPM_URL}|npm>\n` +
      "🐍 *copilotkit (Python SDK) v0.9.0* published to PyPI · " +
      `<${PY_URL}|PyPI>`;
    expect(r.message).toBe(expected);
  });

  it("both lanes fail → one message with both lane-level red lines", () => {
    const r = buildReleaseNotification(
      base({
        mode: "stable",
        npmIntended: "true",
        npmResult: "failure",
        buildResult: "success",
        pyIntended: "true",
        pyPub: "true",
        pyResult: "failure",
      }),
    );
    expect(r.shouldPost).toBe(true);
    expect(r.message).toBe(
      `🔴 *CopilotKit monorepo release failed* · <${RUN_URL}|View run>\n` +
        `🔴 *copilotkit (Python SDK) release failed* · <${RUN_URL}|View run>`,
    );
  });

  // ---- nothing acted -------------------------------------------------------
  it("nothing acted (npm skipped, PyPI not publishing) → no post, empty message", () => {
    const r = buildReleaseNotification(base());
    expect(r.shouldPost).toBe(false);
    expect(r.message).toBe("");
  });

  // ---- no-false-success guards ---------------------------------------------
  it("stable npm success with empty version → no npm success line (no false success)", () => {
    // npmResult=success but no version is an anomalous state — do not claim
    // success. With buildResult=success there is also no failure to report.
    const r = buildReleaseNotification(
      base({
        mode: "stable",
        npmResult: "success",
        npmVer: "",
        buildResult: "success",
      }),
    );
    expect(r.shouldPost).toBe(false);
    expect(r.message).toBe("");
  });

  it("PyPI success with empty version → no PyPI success line (no false success)", () => {
    const r = buildReleaseNotification(
      base({ pyPub: "true", pyResult: "success", pyVer: "" }),
    );
    expect(r.shouldPost).toBe(false);
    expect(r.message).toBe("");
  });

  it("pluralization: monorepo scope with N packages → 'N packages'", () => {
    const r = buildReleaseNotification(
      base({
        mode: "stable",
        npmResult: "success",
        npmVer: "1.2.3",
        buildResult: "success",
        packageCount: 16,
      }),
    );
    expect(r.message).toContain("(`latest`, 16 packages)");
  });

  it("packageCount=0 (unknown/degraded) → success line WITHOUT a packages count parenthetical", () => {
    // A degraded/missing release.config.json resolves to 0 packages. The
    // builder must NOT render the self-contradictory "(`latest`, 0 packages)";
    // it omits the count parenthetical entirely → "published to npm (`latest`)".
    const r = buildReleaseNotification(
      base({
        mode: "stable",
        npmResult: "success",
        npmVer: "1.2.3",
        buildResult: "success",
        packageCount: 0,
      }),
    );
    expect(r.shouldPost).toBe(true);
    expect(r.message).toContain("published to npm (`latest`)");
    expect(r.message).not.toContain("packages");
    expect(r.message).not.toContain("0 package");
    expect(r.message).toBe(
      "🚀 *CopilotKit monorepo v1.2.3* published to npm (`latest`) · " +
        `<${RELEASE_URL}|Release notes> · <${NPM_URL}|npm>`,
    );
  });

  // ---- empty-scope rendering (no doubled words / double spaces) -------------
  it("empty scope on the FAILURE path → clean 'CopilotKit release failed' (no 'release release')", () => {
    // A stable build failure where scope is empty must not render
    // "CopilotKit release release failed".
    const r = buildReleaseNotification(
      base({
        mode: "",
        npmIntended: "true",
        npmResult: "skipped",
        buildResult: "failure",
        scope: "",
      }),
    );
    expect(r.shouldPost).toBe(true);
    expect(r.message).toBe(
      `🔴 *CopilotKit release failed* · <${RUN_URL}|View run>`,
    );
    expect(r.message).not.toContain("release release");
    expect(r.message).not.toContain("  ");
  });

  it("empty scope on the SUCCESS path → clean version line (no double space)", () => {
    const r = buildReleaseNotification(
      base({
        mode: "stable",
        npmResult: "success",
        npmVer: "1.2.3",
        buildResult: "success",
        scope: "",
      }),
    );
    expect(r.shouldPost).toBe(true);
    expect(r.message).not.toContain("  ");
    expect(r.message).toBe(
      "🚀 *CopilotKit v1.2.3* published to npm (`latest`, 16 packages) · " +
        `<${RELEASE_URL}|Release notes> · <${NPM_URL}|npm>`,
    );
  });

  it("npm success but mode not stable (defensive) → no npm success line", () => {
    // mode "" with a success result must not produce an npm success line.
    // buildResult=success means no failure either → nothing posts.
    const r = buildReleaseNotification(
      base({
        mode: "",
        npmResult: "success",
        npmVer: "1.2.3",
        buildResult: "success",
      }),
    );
    expect(r.shouldPost).toBe(false);
    expect(r.message).toBe("");
  });
});
