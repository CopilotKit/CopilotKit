import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import {
  FileSnapshotRestorer,
  SAFE_EXEC_OPTS,
  execOptsFor,
  restoreFromGitHead,
} from "./test-cleanup";

// Unit tests for the shared test-cleanup harness. Covers:
//   - FileSnapshotRestorer round trip (mutate + restore)
//   - FileSnapshotRestorer ENOENT read handling (file deleted after snapshot)
//   - FileSnapshotRestorer ENOENT write handling (parent dir deleted)
//   - FileSnapshotRestorer re-invocation guard (snapshot twice throws)
//   - FileSnapshotRestorer byte-exact round trip (non-utf8 bytes)
//   - FileSnapshotRestorer sweeps atomic-write tmp stragglers on snapshot()
//   - restoreFromGitHead narrow catch (benign pathspec vs fatal errors)
//   - restoreFromGitHead accepts the allowlisted truthy CI values
//   - restoreFromGitHead tracked/untracked partitioning (mixed path list)
//   - restoreFromGitHead off-CI guard propagates stderr on re-raise

/** Env with all `GIT_*` vars stripped — pre-commit hooks (lefthook) run with
 *  GIT_DIR / GIT_INDEX_FILE / GIT_WORK_TREE set on process.env, which cause
 *  child `git commit` calls to ignore `cwd` and write to the HOST repo. Every
 *  test-owned subprocess must use this env so tmp-repo commits stay confined.
 *  Without this scrub, a developer running `git commit` (which triggers
 *  test-and-check-packages -> `pnpm run test` -> this file) would silently
 *  accumulate "initial" / "init" commits on the real working-tree HEAD. */
function cleanGitEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith("GIT_")) out[k] = v;
  }
  return out;
}

/** Exec options shared by every `git` subprocess spawned from this test file.
 *  Stdio is explicitly piped (not inherited) so child stdout/stderr can't
 *  interleave with the vitest worker's stdio streams — inherited stdio on a
 *  thread/fork vitest worker disrupts the worker→parent RPC channel on Node
 *  20 and surfaces as "Timeout calling onTaskUpdate" during teardown. */
const TEST_GIT_STDIO = ["ignore", "pipe", "pipe"] as const;

function mkTmpRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "test-cleanup-"));
  const env = cleanGitEnv();
  const opts = { cwd: dir, env, stdio: TEST_GIT_STDIO } as const;
  execFileSync("git", ["init", "-q"], opts);
  execFileSync("git", ["config", "user.email", "t@t"], opts);
  execFileSync("git", ["config", "user.name", "t"], opts);
  execFileSync("git", ["config", "commit.gpgsign", "false"], opts);
  return dir;
}

function commitAll(repo: string, msg: string): void {
  const env = cleanGitEnv();
  const opts = { cwd: repo, env, stdio: TEST_GIT_STDIO } as const;
  execFileSync("git", ["add", "-A"], opts);
  execFileSync("git", ["commit", "-q", "-m", msg], opts);
}

describe("FileSnapshotRestorer", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-"));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("round trip: mutate then restore returns original content", () => {
    const f = path.join(tmp, "a.txt");
    fs.writeFileSync(f, "original");
    const r = new FileSnapshotRestorer([f]);
    r.snapshot();

    fs.writeFileSync(f, "mutated");
    expect(fs.readFileSync(f, "utf-8")).toBe("mutated");

    r.restore();
    expect(fs.readFileSync(f, "utf-8")).toBe("original");
  });

  it("byte-exact round trip preserves non-utf8 bytes", () => {
    const f = path.join(tmp, "bin");
    // 0xC3 followed by 0x28 is an invalid utf-8 sequence. A utf-8 string
    // round-trip would replace it with U+FFFD; Buffer round-trip preserves it.
    const bytes = Buffer.from([0x00, 0xc3, 0x28, 0xff]);
    fs.writeFileSync(f, bytes);
    const r = new FileSnapshotRestorer([f]);
    r.snapshot();

    fs.writeFileSync(f, Buffer.from([0x01, 0x02]));
    r.restore();

    const got = fs.readFileSync(f);
    expect(got.equals(bytes)).toBe(true);
  });

  it("is a no-op on a clean run (no mtime churn)", () => {
    const f = path.join(tmp, "a.txt");
    fs.writeFileSync(f, "unchanged");
    const r = new FileSnapshotRestorer([f]);
    r.snapshot();

    const before = fs.statSync(f).mtimeMs;
    r.restore();
    const after = fs.statSync(f).mtimeMs;
    expect(after).toBe(before);
  });

  it("re-creates a snapshotted file that was deleted after snapshot", () => {
    const f = path.join(tmp, "a.txt");
    fs.writeFileSync(f, "gone");
    const r = new FileSnapshotRestorer([f]);
    r.snapshot();

    fs.rmSync(f);
    expect(fs.existsSync(f)).toBe(false);

    r.restore();
    expect(fs.readFileSync(f, "utf-8")).toBe("gone");
  });

  it("re-creates parent directory on write ENOENT", () => {
    const f = path.join(tmp, "sub", "a.txt");
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, "deep");
    const r = new FileSnapshotRestorer([f]);
    r.snapshot();

    fs.rmSync(path.dirname(f), { recursive: true });
    expect(fs.existsSync(f)).toBe(false);

    r.restore();
    expect(fs.readFileSync(f, "utf-8")).toBe("deep");
  });

  it("ignores paths that don't exist at snapshot time", () => {
    const r = new FileSnapshotRestorer([path.join(tmp, "nonexistent.txt")]);
    r.snapshot();
    expect(r.snapshotMap.size).toBe(0);
    r.restore(); // no-op, shouldn't throw
  });

  it("throws when snapshot() is called twice on the same instance", () => {
    const f = path.join(tmp, "a.txt");
    fs.writeFileSync(f, "first");
    const r = new FileSnapshotRestorer([f]);
    r.snapshot();
    expect(() => r.snapshot()).toThrow(
      /called on a restorer that already has a snapshot/,
    );
  });

  it("sweeps leftover atomic-write tmp stragglers on snapshot()", () => {
    const f = path.join(tmp, "a.txt");
    fs.writeFileSync(f, "content");

    // Simulate a straggler matching the atomic-write naming convention
    // (`.{basename}.{16-hex}.tmp`). SIGKILL between writeFileSync +
    // renameSync would leave one of these behind.
    const straggler = path.join(tmp, ".a.txt.0123456789abcdef.tmp");
    fs.writeFileSync(straggler, "leftover");
    expect(fs.existsSync(straggler)).toBe(true);

    // An unrelated dot-tmp file that MUST be preserved (not our pattern).
    const unrelated = path.join(tmp, ".editor-swap.tmp");
    fs.writeFileSync(unrelated, "keep me");

    const r = new FileSnapshotRestorer([f]);
    r.snapshot();

    expect(fs.existsSync(straggler)).toBe(false);
    expect(fs.existsSync(unrelated)).toBe(true);
  });
});

describe("restoreFromGitHead", () => {
  let repo: string;
  let savedCI: string | undefined;

  beforeEach(() => {
    repo = mkTmpRepo();
    savedCI = process.env.CI;
    // Default to CI=true; individual tests that need the off-CI guard
    // override this inside the test body.
    process.env.CI = "true";
  });

  afterEach(() => {
    if (savedCI === undefined) delete process.env.CI;
    else process.env.CI = savedCI;
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("restores a tracked file from HEAD (on CI)", () => {
    fs.writeFileSync(path.join(repo, "a.txt"), "committed");
    commitAll(repo, "initial");

    fs.writeFileSync(path.join(repo, "a.txt"), "drift");
    restoreFromGitHead(repo, ["a.txt"]);
    expect(fs.readFileSync(path.join(repo, "a.txt"), "utf-8")).toBe(
      "committed",
    );
  });

  it("accepts CI=1 as truthy", () => {
    process.env.CI = "1";
    fs.writeFileSync(path.join(repo, "a.txt"), "committed");
    commitAll(repo, "initial");

    fs.writeFileSync(path.join(repo, "a.txt"), "drift");
    expect(() => restoreFromGitHead(repo, ["a.txt"])).not.toThrow();
    expect(fs.readFileSync(path.join(repo, "a.txt"), "utf-8")).toBe(
      "committed",
    );
  });

  it("accepts CI=yes as truthy (case-insensitive)", () => {
    process.env.CI = "YES";
    fs.writeFileSync(path.join(repo, "a.txt"), "committed");
    commitAll(repo, "initial");

    fs.writeFileSync(path.join(repo, "a.txt"), "drift");
    expect(() => restoreFromGitHead(repo, ["a.txt"])).not.toThrow();
  });

  it("treats CI='false', CI='0', and arbitrary strings as off", () => {
    fs.writeFileSync(path.join(repo, "a.txt"), "committed");
    commitAll(repo, "initial");
    fs.writeFileSync(path.join(repo, "a.txt"), "wip");

    process.env.CI = "false";
    expect(() => restoreFromGitHead(repo, ["a.txt"])).toThrow(
      /refusing to overwrite/,
    );

    process.env.CI = "0";
    expect(() => restoreFromGitHead(repo, ["a.txt"])).toThrow(
      /refusing to overwrite/,
    );

    // Allowlist strictness: a random value is off, not on.
    process.env.CI = "on";
    expect(() => restoreFromGitHead(repo, ["a.txt"])).toThrow(
      /refusing to overwrite/,
    );
  });

  it("skips untracked paths when mixed with tracked peers (benign pathspec)", () => {
    // Mixed lists must succeed: partitionTrackedPaths filters out the
    // untracked entry and the tracked entry is healed normally. (An
    // all-untracked call is a separate case — covered by the
    // "drifted baseline guard" block.)
    fs.writeFileSync(path.join(repo, "a.txt"), "committed");
    commitAll(repo, "initial");
    fs.writeFileSync(path.join(repo, "a.txt"), "drift");
    expect(() => restoreFromGitHead(repo, ["a.txt", "nope.txt"])).not.toThrow();
    expect(fs.readFileSync(path.join(repo, "a.txt"), "utf-8")).toBe(
      "committed",
    );
  });

  it("handles mixed tracked+untracked lists without masking dirty tracked files", () => {
    // Regression guard: a mixed tracked/untracked list previously caused
    // `git diff --quiet` to exit 128 (pathspec mismatch from untracked),
    // which the guard treated as "nothing to clobber" and silently
    // overwrote the dirty tracked file.
    delete process.env.CI;

    fs.writeFileSync(path.join(repo, "tracked.txt"), "committed");
    commitAll(repo, "initial");

    // Dirty tracked file + one untracked path in the same call.
    fs.writeFileSync(path.join(repo, "tracked.txt"), "wip");

    expect(() =>
      restoreFromGitHead(repo, ["tracked.txt", "untracked.txt"]),
    ).toThrow(/refusing to overwrite uncommitted changes/);

    // Critically: the dirty tracked file must NOT have been clobbered.
    expect(fs.readFileSync(path.join(repo, "tracked.txt"), "utf-8")).toBe(
      "wip",
    );
  });

  it("off-CI, refuses to clobber uncommitted tracked-file changes", () => {
    delete process.env.CI;
    fs.writeFileSync(path.join(repo, "a.txt"), "committed");
    commitAll(repo, "initial");

    // Create dev-style uncommitted edit
    fs.writeFileSync(path.join(repo, "a.txt"), "wip");
    expect(() => restoreFromGitHead(repo, ["a.txt"])).toThrow(
      /refusing to overwrite uncommitted changes/,
    );
    // File must remain unchanged
    expect(fs.readFileSync(path.join(repo, "a.txt"), "utf-8")).toBe("wip");
  });

  it("off-CI error message mentions the discard alternative", () => {
    delete process.env.CI;
    fs.writeFileSync(path.join(repo, "a.txt"), "committed");
    commitAll(repo, "initial");
    fs.writeFileSync(path.join(repo, "a.txt"), "wip");

    try {
      restoreFromGitHead(repo, ["a.txt"]);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as Error).message).toMatch(/git checkout HEAD --/);
    }
  });

  it("off-CI, heals when tree is clean wrt the target paths", () => {
    delete process.env.CI;
    fs.writeFileSync(path.join(repo, "a.txt"), "committed");
    commitAll(repo, "initial");

    // clean tree -> heal is a no-op but must not throw
    expect(() => restoreFromGitHead(repo, ["a.txt"])).not.toThrow();
    expect(fs.readFileSync(path.join(repo, "a.txt"), "utf-8")).toBe(
      "committed",
    );
  });
});

describe("SAFE_EXEC_OPTS", () => {
  it("exposes stdio ignore/pipe/pipe and a bounded timeout", () => {
    expect(SAFE_EXEC_OPTS.stdio).toEqual(["ignore", "pipe", "pipe"]);
    expect(SAFE_EXEC_OPTS.timeout).toBe(30000);
    expect(SAFE_EXEC_OPTS.maxBuffer).toBe(10 * 1024 * 1024);
  });

  it("freezes the inner stdio array (not just the outer object)", () => {
    expect(Object.isFrozen(SAFE_EXEC_OPTS)).toBe(true);
    expect(Object.isFrozen(SAFE_EXEC_OPTS.stdio)).toBe(true);
  });
});

describe("execOptsFor", () => {
  it("returns a frozen object with cwd and the SAFE_EXEC_OPTS defaults", () => {
    const opts = execOptsFor("/some/path");
    expect(opts.cwd).toBe("/some/path");
    expect(opts.stdio).toEqual(["ignore", "pipe", "pipe"]);
    expect(opts.timeout).toBe(30000);
    expect(Object.isFrozen(opts)).toBe(true);
  });
});

// --- Regression guards: narrow-catch + per-basename sweep + drift guard ---

describe("restoreFromGitHead: narrow catch in partitionTrackedPaths", () => {
  let savedCI: string | undefined;

  beforeEach(() => {
    savedCI = process.env.CI;
    process.env.CI = "true";
  });

  afterEach(() => {
    if (savedCI === undefined) delete process.env.CI;
    else process.env.CI = savedCI;
  });

  it("fails loudly when the git binary is missing (PATH empty)", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-nogit-"));
    try {
      const env = cleanGitEnv();
      const opts = { cwd: repo, env, stdio: TEST_GIT_STDIO } as const;
      execFileSync("git", ["init", "-q"], opts);
      fs.writeFileSync(path.join(repo, "a.txt"), "x");
      execFileSync("git", ["config", "user.email", "t@t"], opts);
      execFileSync("git", ["config", "user.name", "t"], opts);
      execFileSync("git", ["config", "commit.gpgsign", "false"], opts);
      execFileSync("git", ["add", "-A"], opts);
      execFileSync("git", ["commit", "-q", "-m", "init"], opts);

      // Force PATH to an empty dir so the spawned `git` fails with ENOENT.
      // Prior to the narrow-catch fix, `partitionTrackedPaths` swallowed
      // ENOENT and treated the path as "untracked", causing
      // `restoreFromGitHead` to silently no-op and lock in the drifted
      // baseline.
      const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-empty-"));
      const savedPath = process.env.PATH;
      process.env.PATH = emptyDir;
      try {
        expect(() => restoreFromGitHead(repo, ["a.txt"])).toThrow(
          /partitionTrackedPaths|git ls-files/,
        );
      } finally {
        process.env.PATH = savedPath;
        fs.rmSync(emptyDir, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("FileSnapshotRestorer: sweepTmpStragglers basename scope", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-sweep-"));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("does NOT sweep same-shaped tmp files for unrelated basenames", () => {
    // Only `a.txt` is in the snapshot scope. A `.b.txt.<hex>.tmp` straggler
    // must survive the sweep — it belongs to a different snapshot target
    // (possibly run by a different tool in the same directory). Prior to
    // the per-basename tightening, the generic regex
    // `/^\..+\.[0-9a-f]{16}\.tmp$/` matched and deleted any file of this
    // shape.
    const a = path.join(tmp, "a.txt");
    fs.writeFileSync(a, "x");

    const ourStraggler = path.join(tmp, ".a.txt.0123456789abcdef.tmp");
    fs.writeFileSync(ourStraggler, "ours");

    const foreignStraggler = path.join(tmp, ".b.txt.0123456789abcdef.tmp");
    fs.writeFileSync(foreignStraggler, "foreign");

    const r = new FileSnapshotRestorer([a]);
    r.snapshot();

    expect(fs.existsSync(ourStraggler)).toBe(false);
    expect(fs.existsSync(foreignStraggler)).toBe(true);
  });
});

describe("FileSnapshotRestorer: double-snapshot guard (flag-based)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-dbl-"));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("throws on second snapshot() even when the path list matched nothing", () => {
    // Prior to the flag-based guard, the check was size-based
    // (`snapshots.size > 0`); with zero matching paths the size stayed 0
    // forever and a second snapshot() would silently succeed.
    const r = new FileSnapshotRestorer([path.join(tmp, "never.txt")]);
    r.snapshot();
    expect(r.snapshotMap.size).toBe(0);
    expect(() => r.snapshot()).toThrow(
      /called on a restorer that already has a snapshot/,
    );
  });
});

// Note: we intentionally do NOT test the `GIT_*` scrub by setting
// `process.env.GIT_DIR` in the test body — a polluted process.env has
// catastrophic blast-radius (any other git call in ANY parallel vitest
// suite or pre-commit hook would misroute to our decoy repo, and if our
// afterEach is skipped for any reason we'd silently corrupt the real
// working tree). The unit under test is `gitEnv()`, which we cover via its
// observable behavior: the existing "restores a tracked file from HEAD (on
// CI)" / mixed-list tests exercise the git-subprocess path with a real
// repo and would fail immediately if `gitEnv` stopped forwarding PATH,
// HOME, etc. The scrub itself is a simple `!k.startsWith("GIT_")` loop.

describe("restoreFromGitHead: drifted baseline guard", () => {
  let repo: string;
  let savedCI: string | undefined;

  beforeEach(() => {
    repo = mkTmpRepo();
    savedCI = process.env.CI;
    process.env.CI = "true";
  });

  afterEach(() => {
    if (savedCI === undefined) delete process.env.CI;
    else process.env.CI = savedCI;
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("throws on CI when the input has paths but none are tracked", () => {
    // Prior to the drifted-baseline guard, this silently early-returned
    // and the caller would snapshot whatever drifted content was on disk.
    expect(() => restoreFromGitHead(repo, ["totally-untracked.txt"])).toThrow(
      /no input path is tracked by git/,
    );
  });

  it("warns (does not throw) off-CI when nothing is tracked", () => {
    delete process.env.CI;
    // Off-CI we don't want to disrupt a developer running tests against a
    // tree that may not yet have committed these files. Warn and return.
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (msg: unknown) => {
      warnings.push(String(msg));
    };
    try {
      expect(() =>
        restoreFromGitHead(repo, ["totally-untracked.txt"]),
      ).not.toThrow();
      expect(
        warnings.some((w) => /no input path is tracked by git/.test(w)),
      ).toBe(true);
    } finally {
      console.warn = origWarn;
    }
  });
});
