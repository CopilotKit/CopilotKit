import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";
import {
  writeGithubOutput,
  resolvePackageCountSafe,
  resolveModeSafe,
  resolveJobResultSafe,
} from "../build-release-notification.js";
import * as config from "./config.js";

const WRAPPER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../build-release-notification.ts",
);

// Resolve the local tsx binary so the subprocess never hits npx's network /
// registry path (which is flaky in CI). Walk up from this file to the repo
// root's node_modules/.bin/tsx.
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const TSX_BIN = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");

/**
 * Run the wrapper CLI as a subprocess; returns { code, stdout, stderr }.
 *
 * Builds a CLEAN minimal env (only PATH + the caller's overrides) rather than
 * spreading the runner's process.env. This matters because the suite itself may
 * run under GitHub Actions with a real GITHUB_OUTPUT / GITHUB_ACTIONS set —
 * spreading those in would pollute the fail-loud "GITHUB_OUTPUT unset" test and
 * the DRY_RUN coercion cases.
 */
function runWrapper(env: Record<string, string | undefined>): {
  code: number;
  stdout: string;
  stderr: string;
} {
  // Strip undefined values so an explicit `KEY: undefined` truly unsets it
  // (rather than passing the string "undefined").
  const cleanEnv: Record<string, string> = { PATH: process.env.PATH ?? "" };
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined) cleanEnv[k] = v;
  }
  try {
    const stdout = execFileSync(TSX_BIN, [WRAPPER], {
      env: cleanEnv,
      stdio: "pipe",
      encoding: "utf8",
    });
    return { code: 0, stdout, stderr: "" };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return {
      code: err.status ?? 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "release-notify-wrapper-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("writeGithubOutput", () => {
  it("round-trips a multi-line message through the GITHUB_OUTPUT heredoc", () => {
    const outputPath = path.join(tmpDir, "out.txt");
    fs.writeFileSync(outputPath, "");
    const message = "line one\nline two · <https://x|y>";

    writeGithubOutput(outputPath, { message, shouldPost: true });

    const raw = fs.readFileSync(outputPath, "utf8");

    // Parse the heredoc the way GitHub Actions does: message<<DELIM ... DELIM.
    const m = raw.match(/^message<<(\S+)\n([\s\S]*?)\n\1\n/m);
    expect(m).not.toBeNull();
    expect(m![2]).toBe(message);
    expect(raw).toContain("should_post=true");
  });

  it("uses a per-write RANDOM delimiter (not a fixed sentinel)", () => {
    const a = path.join(tmpDir, "a.txt");
    const b = path.join(tmpDir, "b.txt");
    fs.writeFileSync(a, "");
    fs.writeFileSync(b, "");

    writeGithubOutput(a, { message: "x", shouldPost: true });
    writeGithubOutput(b, { message: "x", shouldPost: true });

    const delimA = fs.readFileSync(a, "utf8").match(/^message<<(\S+)/m)?.[1];
    const delimB = fs.readFileSync(b, "utf8").match(/^message<<(\S+)/m)?.[1];

    expect(delimA).toBeTruthy();
    expect(delimB).toBeTruthy();
    // No fixed sentinel, and two separate writes must differ.
    expect(delimA).not.toBe("__RELEASE_NOTIFY_EOF__");
    expect(delimA).not.toBe(delimB);
  });

  it("does not corrupt output when the message itself contains a heredoc-like token", () => {
    const outputPath = path.join(tmpDir, "out.txt");
    fs.writeFileSync(outputPath, "");
    // A pathological message containing the legacy fixed delimiter must not
    // prematurely terminate the heredoc.
    const message = "__RELEASE_NOTIFY_EOF__\nstill the message";

    writeGithubOutput(outputPath, { message, shouldPost: true });

    const raw = fs.readFileSync(outputPath, "utf8");
    const m = raw.match(/^message<<(\S+)\n([\s\S]*?)\n\1\n/m);
    expect(m).not.toBeNull();
    expect(m![2]).toBe(message);
  });
});

describe("resolvePackageCountSafe", () => {
  it("returns 0 for an unknown scope (early return, no config lookup)", () => {
    // An unknown scope is NOT a known npm scope, so it hits the early `return 0`
    // BEFORE getScopeConfig is ever called — this exercises the not-a-known-scope
    // branch, NOT the try/catch error-swallow path (see the throw test below).
    expect(() => resolvePackageCountSafe("does-not-exist")).not.toThrow();
    expect(resolvePackageCountSafe("does-not-exist")).toBe(0);
  });

  it("returns 0 for an empty scope (python-only run)", () => {
    expect(resolvePackageCountSafe("")).toBe(0);
  });

  it("returns the real package count for a known scope (angular)", () => {
    // angular has exactly one package in release.config.json.
    expect(resolvePackageCountSafe("angular")).toBe(1);
  });

  it("returns the real package count for the monorepo scope (drift guard)", () => {
    // Pins the actual count from release.config.json (16). If the package set
    // drifts, this catches the staleness of the hardcoded "16 packages"
    // assertions in build-release-notification.test.ts.
    expect(resolvePackageCountSafe("monorepo")).toBe(16);
  });

  it("returns the real package count for the channels scope (channels + channels-ui, drift guard)", () => {
    expect(resolvePackageCountSafe("channels")).toBe(2);
  });

  it("returns the real package count for the channels-slack scope (drift guard)", () => {
    expect(resolvePackageCountSafe("channels-slack")).toBe(1);
  });

  it("resolves a positive count for EVERY scope in release.config.json (anti-drift)", () => {
    // Membership is read from the config at runtime, so a newly added scope
    // can never silently render without a package count. If this fails for a
    // future scope, that scope's package list is empty or the wrapper has
    // drifted from release.config.json.
    for (const [scope, cfg] of Object.entries(config.loadConfig().scopes)) {
      expect(resolvePackageCountSafe(scope)).toBe(cfg.packages.length);
      expect(resolvePackageCountSafe(scope)).toBeGreaterThan(0);
    }
  });

  it("swallows a getScopeConfig throw on a KNOWN scope → returns 0 AND emits ::warning::", () => {
    // Drive the catch branch (not the early return): stub getScopeConfig to
    // throw for a KNOWN scope (monorepo), simulating a corrupt/missing
    // release.config.json. The safe wrapper must degrade to 0 and surface the
    // failure as a ::warning:: rather than crash the notifier.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const scopeSpy = vi
      .spyOn(config, "getScopeConfig")
      .mockImplementation(() => {
        throw new Error("simulated corrupt release.config.json");
      });

    expect(() => resolvePackageCountSafe("monorepo")).not.toThrow();
    expect(resolvePackageCountSafe("monorepo")).toBe(0);
    expect(scopeSpy).toHaveBeenCalledWith("monorepo");
    expect(warnSpy).toHaveBeenCalled();
    expect(
      warnSpy.mock.calls.some(([msg]) => String(msg).includes("::warning::")),
    ).toBe(true);
  });
});

describe("resolveModeSafe", () => {
  it.each(["stable", "prerelease", ""] as const)(
    'passes through the known mode "%s" unchanged',
    (mode: string) => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(resolveModeSafe(mode)).toBe(mode);
      expect(warnSpy).not.toHaveBeenCalled();
    },
  );

  it('coerces an unknown MODE (typo) to "" AND emits ::warning:: (degrade loud, no crash)', () => {
    // A typo'd MODE must NOT be cast through unchecked. The safe resolver
    // degrades to "" (neutral "npm lane did not run") and surfaces a
    // ::warning:: so the degradation isn't silent. "" is the safe default: the
    // npm-failure arm keys off job RESULTS (gated only by canary suppression),
    // so a real failure still pages — only a stable SUCCESS would degrade, and
    // that degradation is now visible in the run log.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => resolveModeSafe("stabel")).not.toThrow();
    expect(resolveModeSafe("stabel")).toBe("");
    expect(warnSpy).toHaveBeenCalled();
    expect(
      warnSpy.mock.calls.some(([msg]) => String(msg).includes("::warning::")),
    ).toBe(true);
  });
});

describe("resolveJobResultSafe", () => {
  it.each(["success", "failure", "cancelled", "skipped", ""] as const)(
    'passes through the known job result "%s" unchanged (no warning)',
    (result: string) => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(resolveJobResultSafe(result)).toBe(result);
      expect(warnSpy).not.toHaveBeenCalled();
    },
  );

  it('coerces an unknown job result to "failure" AND emits ::warning:: (page-on-uncertainty, no crash)', () => {
    // A mis-wired needs.<job>.result (typo, renamed job, an Actions value we
    // don't model) must NOT be cast through unchecked. RESULT values drive
    // FAILURE-gating, so for a notifier whose thesis is "never swallow a real
    // failure" an unknown result is anomalous and degrades toward "failure"
    // (page-on-uncertainty), not silence. The intent gates (npmIntended/
    // pyIntended) ensure this only pages on a real release. A ::warning:: makes
    // the degradation visible in the run log.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => resolveJobResultSafe("succeeded")).not.toThrow();
    expect(resolveJobResultSafe("succeeded")).toBe("failure");
    expect(warnSpy).toHaveBeenCalled();
    expect(
      warnSpy.mock.calls.some(([msg]) => String(msg).includes("::warning::")),
    ).toBe(true);
  });
});

describe("wrapper CLI fail-loud (subprocess)", () => {
  it("fails loud (non-zero + ::error::) when running under Actions with GITHUB_OUTPUT unset", () => {
    // GITHUB_ACTIONS=true signals an Actions context; with no GITHUB_OUTPUT a
    // status notifier that cannot write its output must fail visibly.
    const { code, stderr } = runWrapper({
      GITHUB_ACTIONS: "true",
      GITHUB_OUTPUT: undefined,
      MODE: "stable",
      NPM_RESULT: "success",
      NPM_VER: "1.2.3",
      BUILD_RESULT: "success",
    });
    expect(code).not.toBe(0);
    expect(stderr).toContain("::error::");
  }, 30000);

  it("writes output and exits 0 when GITHUB_OUTPUT is set", () => {
    const out = path.join(tmpDir, "gho.txt");
    fs.writeFileSync(out, "");
    const { code } = runWrapper({
      GITHUB_ACTIONS: "true",
      GITHUB_OUTPUT: out,
      MODE: "stable",
      NPM_RESULT: "success",
      NPM_VER: "1.2.3",
      BUILD_RESULT: "success",
      SCOPE: "monorepo",
    });
    expect(code).toBe(0);
    const raw = fs.readFileSync(out, "utf8");
    expect(raw).toContain("should_post=true");
    expect(raw).toMatch(/^message<<\S+/m);
  }, 30000);
});

describe("wrapper CLI DRY_RUN string coercion (subprocess)", () => {
  // DRY_RUN is the inputs.dry-run boolean stringified by Actions. It gates EVERY
  // production notification, yet the env→boolean coercion is only exercisable at
  // this string layer. Only the exact string "true" suppresses the post.
  function postFor(dryRun: string): { code: number; raw: string } {
    const out = path.join(tmpDir, "gho.txt");
    fs.writeFileSync(out, "");
    const { code } = runWrapper({
      GITHUB_ACTIONS: "true",
      GITHUB_OUTPUT: out,
      MODE: "stable",
      NPM_RESULT: "success",
      NPM_VER: "1.2.3",
      BUILD_RESULT: "success",
      SCOPE: "monorepo",
      DRY_RUN: dryRun,
    });
    return { code, raw: fs.readFileSync(out, "utf8") };
  }

  it('DRY_RUN="true" → should_post=false (suppressed)', () => {
    const { code, raw } = postFor("true");
    expect(code).toBe(0);
    expect(raw).toContain("should_post=false");
  }, 30000);

  it('DRY_RUN="false" → posts on an otherwise-successful stable run', () => {
    const { code, raw } = postFor("false");
    expect(code).toBe(0);
    expect(raw).toContain("should_post=true");
  }, 30000);

  it('DRY_RUN="" (empty) → posts on an otherwise-successful stable run', () => {
    const { code, raw } = postFor("");
    expect(code).toBe(0);
    expect(raw).toContain("should_post=true");
  }, 30000);
});

describe("wrapper CLI end-to-end message rendering (subprocess)", () => {
  it("mixed lane: npm success + PyPI failure → one 🚀 line and one 🔴 line in one message", () => {
    const out = path.join(tmpDir, "gho.txt");
    fs.writeFileSync(out, "");
    const { code } = runWrapper({
      GITHUB_ACTIONS: "true",
      GITHUB_OUTPUT: out,
      MODE: "stable",
      NPM_RESULT: "success",
      NPM_VER: "1.2.3",
      BUILD_RESULT: "success",
      NPM_INTENDED: "true",
      SCOPE: "monorepo",
      PY_INTENDED: "true",
      PY_PUB: "true",
      PY_RESULT: "failure",
      RUN_URL: "https://github.com/CopilotKit/CopilotKit/actions/runs/123",
    });
    expect(code).toBe(0);
    const m = fs
      .readFileSync(out, "utf8")
      .match(/^message<<(\S+)\n([\s\S]*?)\n\1\n/m);
    expect(m).not.toBeNull();
    const message = m![2];
    expect(message).toContain("🚀");
    expect(message).toContain("🔴");
    expect(message).toContain("(Python SDK) release failed");
    // Exactly two lines (one per lane).
    expect(message.split("\n")).toHaveLength(2);
  }, 30000);

  it("PyPI build failure during a real release (PY_BUILD_RESULT=failure, publish skipped) → 🔴 PyPI alert", () => {
    // End-to-end wiring of the PY_BUILD_RESULT env: build-python failed, so
    // publish-python was skipped (PY_RESULT=skipped). The notifier must still
    // emit the PyPI failure line via the pyBuildResult arm.
    const out = path.join(tmpDir, "gho.txt");
    fs.writeFileSync(out, "");
    const { code } = runWrapper({
      GITHUB_ACTIONS: "true",
      GITHUB_OUTPUT: out,
      PY_INTENDED: "true",
      PY_PUB: "true",
      PY_RESULT: "skipped",
      PY_BUILD_RESULT: "failure",
      RUN_URL: "https://github.com/CopilotKit/CopilotKit/actions/runs/123",
    });
    expect(code).toBe(0);
    const raw = fs.readFileSync(out, "utf8");
    expect(raw).toContain("should_post=true");
    const m = raw.match(/^message<<(\S+)\n([\s\S]*?)\n\1\n/m);
    expect(m).not.toBeNull();
    const message = m![2];
    expect(message).toContain("🔴");
    expect(message).toContain("(Python SDK) release failed");
  }, 30000);

  it("build-skipped routine merge (BUILD_RESULT=skipped, MODE='', SCOPE='', NPM_INTENDED='false', PY_INTENDED='false') → should_post=false (no false red)", () => {
    // The dominant real-world case: the notify job runs on EVERY merged PR, but
    // the build job is `skipped` on a non-release merge (no release/publish/*
    // ref) → MODE/SCOPE come back empty and no Python intent signal is set.
    // The notifier must stay completely silent — neither a success nor a
    // failure line — so a routine docs/feature merge never pages #engr.
    const out = path.join(tmpDir, "gho.txt");
    fs.writeFileSync(out, "");
    const { code } = runWrapper({
      GITHUB_ACTIONS: "true",
      GITHUB_OUTPUT: out,
      MODE: "",
      SCOPE: "",
      BUILD_RESULT: "skipped",
      NPM_RESULT: "skipped",
      NPM_INTENDED: "false",
      PY_PUB: "",
      PY_INTENDED: "false",
      PY_RESULT: "skipped",
      PY_BUILD_RESULT: "skipped",
      RUN_URL: "https://github.com/CopilotKit/CopilotKit/actions/runs/123",
    });
    expect(code).toBe(0);
    const raw = fs.readFileSync(out, "utf8");
    expect(raw).toContain("should_post=false");
  }, 30000);

  it("packageCount=0 (unknown scope) → success line WITHOUT a packages count", () => {
    // An empty/unknown SCOPE resolves to 0 packages; the rendered npm line must
    // omit the count parenthetical, never print "0 packages".
    const out = path.join(tmpDir, "gho.txt");
    fs.writeFileSync(out, "");
    const { code } = runWrapper({
      GITHUB_ACTIONS: "true",
      GITHUB_OUTPUT: out,
      MODE: "stable",
      NPM_RESULT: "success",
      NPM_VER: "1.2.3",
      BUILD_RESULT: "success",
      SCOPE: "",
      NPM_URL: "https://www.npmjs.com/org/copilotkit",
    });
    expect(code).toBe(0);
    const m = fs
      .readFileSync(out, "utf8")
      .match(/^message<<(\S+)\n([\s\S]*?)\n\1\n/m);
    expect(m).not.toBeNull();
    const message = m![2];
    expect(message).toContain("published to npm (`latest`)");
    expect(message).not.toContain("packages");
    expect(message).not.toContain("0 package");
  }, 30000);
});
