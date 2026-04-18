// Shared test helper: snapshot/restore working-tree files that test scripts
// mutate as a side effect.
//
// Rationale:
//
// Several showcase test suites invoke real generator scripts (create-integration,
// generate-registry, bundle-demo-content) that write to tracked files OUTSIDE
// any tmp dir — workflow YAMLs in .github/workflows/ and data JSONs in
// showcase/shell/src/data/. Without explicit restoration these writes leak
// into the working tree on every `nx run-many -t test` and, on Node 20 CI with
// vitest worker pools, the accumulated drift races the worker-RPC channel
// (`Timeout calling "onTaskUpdate"` -> ELIFECYCLE).
//
// This module provides two pieces:
//
//   1. `restoreFromGitHead(repoRoot, paths)` — synchronously restore any file
//      from the most recent git HEAD. Used in `beforeAll` to heal a working
//      tree left dirty by a previously crashed test run before we snapshot.
//
//   2. `FileSnapshotRestorer` — captures content of a fixed file list at
//      snapshot time and rewrites only the files that drift. Idempotent. Used
//      in `afterEach` / `afterAll` as the inner loop.
//
// IMPORTANT: this depends on vitest's `fileParallelism: false` setting in
// vitest.config.ts. Multiple suites snapshotting/restoring the SAME files in
// parallel would race each other. If you enable file parallelism, you must
// move to per-suite isolation (tmp cwd + env-var-parameterized scripts).
//
// WINDOWS: callers that invoke `npx` through `execFileSync` (see sibling
// test files) are POSIX-only as written — on Windows `npx` is a `.cmd` and
// `execFileSync("npx", ...)` without `shell: true` fails. Showcase tests
// currently run on Ubuntu/macOS CI only; if we ever add Windows CI we'll
// need a `process.platform === "win32"` gate at those call sites.

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execFileSync } from "child_process";

/** Escape a string for inclusion as a literal in a `RegExp`. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Shared exec options for all child_process calls in the test harness.
 *
 *  `stdio: ["ignore", "pipe", "pipe"]` — on Node 20 CI, inheriting stderr
 *  into the parent vitest worker races the worker-RPC channel (observed as
 *  `Timeout calling "onTaskUpdate"`). We capture instead; success-path stderr
 *  is dropped by design — use the generator's stdout for test assertions.
 *
 *  `maxBuffer: 10MiB` — defensive; the default 1MiB can deadlock if the
 *  generator logs verbose output.
 *
 *  `timeout: 30000` — generators shell out to npx/tsx which cold-boots on
 *  first run; 15s produced flakes on slow CI runners.
 */
const SAFE_STDIO = Object.freeze([
  "ignore",
  "pipe",
  "pipe",
] as const) as readonly ["ignore", "pipe", "pipe"];

export const SAFE_EXEC_OPTS = Object.freeze({
  encoding: "utf-8" as const,
  timeout: 30000,
  maxBuffer: 10 * 1024 * 1024,
  stdio: SAFE_STDIO,
});

/** Build exec options scoped to a specific cwd. Shared helper so suites don't
 *  recompute the same frozen `{...SAFE_EXEC_OPTS, cwd}` shape. The freeze is
 *  defensive — callers that accidentally mutate would corrupt subsequent
 *  invocations. */
export function execOptsFor(cwd: string) {
  return Object.freeze({ ...SAFE_EXEC_OPTS, cwd });
}

/** Build the env forced for every `git` invocation in this module.
 *
 *  Computed lazily per call so a test that temporarily mutates `process.env`
 *  (e.g. to toggle `CI`) observes the mutation instead of a module-load-time
 *  snapshot.
 *
 *  Strips `GIT_*` environment overrides from the parent process
 *  (`GIT_DIR`, `GIT_INDEX_FILE`, `GIT_WORK_TREE`, ...). If the developer or
 *  a wrapping tool has set any of these, git would silently redirect our
 *  `ls-files` / `diff` / `checkout` calls to a different repository,
 *  corrupting the snapshot baseline. We scrub ALL `GIT_*` vars (allowlist
 *  is simpler and safer than enumerating the dozen+ recognized vars).
 *
 *  `LC_ALL=C` / `LANG=C` — git localizes its error strings; the benign
 *  "pathspec did not match" detection is regex-based and must not depend on
 *  the developer's locale. DO NOT remove LC_ALL — the `benign-pathspec`
 *  regex below is English-only by design. */
function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("GIT_")) continue;
    env[k] = v;
  }
  env.LC_ALL = "C";
  env.LANG = "C";
  return env;
}

/** Shared exec options for git invocations inside this module. Captures
 *  stderr (we interrogate it for benign-pathspec detection) and applies the
 *  SAFE_EXEC_OPTS timeout / buffer bounds — a hung git (corrupt worktree,
 *  signing prompt, network filesystem) would otherwise wedge the suite.
 *
 *  Frozen for symmetry with `execOptsFor` — callers can't accidentally
 *  mutate shared options. */
function gitExecOpts(cwd: string) {
  return Object.freeze({
    ...SAFE_EXEC_OPTS,
    cwd,
    env: gitEnv(),
  });
}

/** True when running under a recognized truthy CI env var. Accepts exactly
 *  the common values — `"true"`, `"1"`, `"yes"` (case-insensitive). Anything
 *  else (including unset, `""`, `"0"`, `"false"`, arbitrary strings) is off.
 *  Allowlist over blocklist for strictness. */
function isCI(): boolean {
  const v = process.env.CI;
  if (!v) return false;
  const normalized = v.toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

/** Split input paths into tracked vs untracked relative to HEAD. Uses
 *  `git ls-files --error-unmatch` per path; exit 0 = tracked, exit 1 =
 *  untracked. Any OTHER failure (ENOENT git binary, EACCES, corrupt
 *  worktree, signal kill, timeout) is re-raised — otherwise a broken
 *  environment gets silently treated as "everything untracked" and the
 *  caller skips its destructive healing, locking in any drifted baseline.
 *
 *  N complexity — we run one subprocess per path. Acceptable while the
 *  snapshot scope is single-digit paths (3 workflow YAMLs / 2 data JSONs).
 *  If scope grows materially, batch via a single `git ls-files -z -- <paths>`
 *  and diff the output against the input.
 */
function partitionTrackedPaths(
  repoRoot: string,
  paths: readonly string[],
): { tracked: string[]; untracked: string[] } {
  const tracked: string[] = [];
  const untracked: string[] = [];
  for (const p of paths) {
    try {
      execFileSync("git", ["ls-files", "--error-unmatch", "--", p], {
        ...gitExecOpts(repoRoot),
        stdio: ["ignore", "ignore", "pipe"],
      });
      tracked.push(p);
    } catch (err) {
      const code = (err as { status?: number | null }).status;
      const errno = (err as NodeJS.ErrnoException).code;
      // SAFE_EXEC_OPTS pins `encoding: "utf-8"`, so stderr is a string here.
      const stderr = (err as { stderr?: string }).stderr ?? "";
      // Exit 1 == pathspec unmatched (git's documented "not tracked" code).
      // Anything else (ENOENT = git missing, EACCES, ETIMEDOUT, SIGKILL with
      // status=null, exit 128 for corrupt repo, ...) is an environment
      // failure, not a tracked/untracked question.
      if (code === 1 && typeof errno !== "string") {
        untracked.push(p);
        continue;
      }
      throw new Error(
        `partitionTrackedPaths: unexpected git ls-files failure for ${p}` +
          ` (exit ${code ?? "?"}, errno ${errno ?? "n/a"}): ${stderr.trim()}`,
        { cause: err },
      );
    }
  }
  return { tracked, untracked };
}

/**
 * Restore the given files from `git HEAD` (working tree refresh).
 *
 * @param repoRoot Absolute path to the git repository root. Used as `cwd` for
 *                 all git invocations so resolution doesn't depend on the
 *                 caller's current working directory.
 * @param paths    Absolute or repo-relative paths to restore. Empty array is
 *                 a no-op. Mixed tracked/untracked lists are supported: this
 *                 function partitions them via `git ls-files --error-unmatch`
 *                 and operates ONLY on tracked paths.
 *
 * This is destructive for tracked paths — it clobbers any uncommitted
 * tracked-file edits. To prevent silently destroying a developer's in-progress
 * work:
 *
 *   - On CI (`process.env.CI` set to a truthy value) we always heal, since
 *     CI checkouts start clean and any drift is leaked state from a previous
 *     test run.
 *   - Off CI, we refuse to heal if the developer has uncommitted changes to
 *     any of the tracked target paths, throwing an error that tells them to
 *     stash, commit, or discard (`git checkout HEAD -- <paths>`) first. If
 *     the tree is already clean wrt these paths, we heal.
 *
 * Untracked paths are skipped entirely. Anything else — EACCES, git missing,
 * corrupt worktree — is re-raised so the test suite fails loudly rather than
 * silently seeding a drifted baseline into the subsequent snapshot.
 */
export function restoreFromGitHead(
  repoRoot: string,
  paths: readonly string[],
): void {
  if (paths.length === 0) return;

  // Partition BEFORE any destructive op. Mixing untracked paths into
  // `git diff --quiet` would produce exit 128 (pathspec mismatch) and
  // cause the off-CI guard to mis-treat a legitimate dirty-tracked case
  // as "nothing to clobber", silently overwriting developer edits.
  const { tracked } = partitionTrackedPaths(repoRoot, paths);
  if (tracked.length === 0) {
    // Silent early-return here used to lock in a drifted baseline: a
    // previous run's generator output that was then committed (or a
    // developer moved the paths out of tracking entirely) would leave
    // `partitionTrackedPaths` returning an empty list and the caller
    // would happily snapshot the already-drifted content. Surface it so
    // the user investigates: on CI we throw outright; off-CI we warn
    // (developers may legitimately be exercising the test harness against
    // a tree that hasn't had those files committed yet).
    const msg =
      `restoreFromGitHead: no input path is tracked by git:\n` +
      paths.map((p) => `  ${p}`).join("\n") +
      `\nSnapshot baseline would be drifted — investigate before running tests.`;
    if (isCI()) {
      throw new Error(msg);
    }
    // eslint-disable-next-line no-console
    console.warn(`[test-cleanup] ${msg}`);
    return;
  }

  if (!isCI()) {
    // Off-CI guard: bail before clobbering developer edits. Only runs
    // against tracked paths so untracked path components can't mask a
    // dirty tracked file.
    try {
      execFileSync("git", ["diff", "--quiet", "HEAD", "--", ...tracked], {
        ...gitExecOpts(repoRoot),
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      const code = (err as { status?: number }).status;
      // SAFE_EXEC_OPTS pins `encoding: "utf-8"`, so stderr is a string here.
      const stderr = (err as { stderr?: string }).stderr ?? "";
      if (code === 1) {
        // `git diff --quiet` exits 1 when there ARE differences.
        throw new Error(
          `restoreFromGitHead: refusing to overwrite uncommitted changes to:\n` +
            tracked.map((p) => `  ${p}`).join("\n") +
            `\nStash, commit, or discard these changes before running the test` +
            ` suite (e.g. \`git checkout HEAD -- <paths>\`).`,
          { cause: err },
        );
      }
      // Any other failure is unexpected now that we've pre-filtered to
      // tracked paths. Re-raise with stderr attached so the caller sees
      // what git actually said.
      throw new Error(
        `restoreFromGitHead: unexpected git diff failure (exit ${code ?? "?"}): ${stderr.trim()}`,
        { cause: err },
      );
    }
  }

  try {
    execFileSync("git", ["checkout", "HEAD", "--", ...tracked], {
      ...gitExecOpts(repoRoot),
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    // Narrow: pathspec-did-not-match on untracked files is benign. Git
    // produces this as `error: pathspec '…' did not match any file(s) known
    // to git` (exit 1) OR `fatal: … is outside repository` (exit 128).
    // Anything else — EACCES, git missing, corrupt worktree — bubble up so
    // the suite fails loudly instead of seeding a drifted baseline.
    const stderr =
      // SAFE_EXEC_OPTS pins `encoding: "utf-8"`, so stderr is a string here.
      (err as { stderr?: string }).stderr ?? "";
    const isBenignPathspec = /did not match any file\(s\) known to git/.test(
      stderr,
    );
    if (!isBenignPathspec) {
      const code = (err as { status?: number }).status;
      throw new Error(
        `restoreFromGitHead: git checkout failed (exit ${code ?? "?"}): ${stderr.trim()}`,
        { cause: err },
      );
    }
  }
}

/**
 * Snapshots file content in-memory and restores any file that drifts. Uses
 * an atomic temp-file + rename only when the on-disk bytes differ from the
 * snapshot, which avoids touching mtime on clean runs and guarantees readers
 * never observe a truncated file.
 *
 * ASYMMETRY: `restore()` undoes drift to snapshotted files and re-creates
 * snapshotted files that were deleted. It does NOT remove files that tests
 * create which weren't in the snapshot — the test is responsible for cleaning
 * up new files it creates (the create-integration suite does this explicitly
 * via `fs.rmSync(TEST_DIR, {recursive: true, force: true})`).
 */
export class FileSnapshotRestorer {
  private readonly snapshots = new Map<string, Buffer>();
  // Tracks whether `snapshot()` has been invoked — set unconditionally
  // before any throwing work so the double-snapshot guard fires even when
  // the path list is empty or every path is missing (size-based guards
  // would silently allow a second call in that case).
  private snapshotted = false;

  constructor(private readonly paths: readonly string[]) {}

  /** Capture current content for every path that exists on disk.
   *
   *  Also sweeps any stragger atomic-write temp files in each path's parent
   *  directory — `.<basename>.<hex>.tmp` — that a prior crashed run left
   *  behind. Without the sweep, those tmp files accumulate in tracked
   *  directories (`.github/workflows/`, `showcase/shell/src/data/`) and
   *  reintroduce the exact pollution this harness exists to prevent.
   *
   *  Throws if called after a previous snapshot — snapshotting twice silently
   *  discards the original baseline and is almost always a bug. Use a fresh
   *  restorer instance per test suite. */
  snapshot(): void {
    if (this.snapshotted) {
      throw new Error(
        "FileSnapshotRestorer.snapshot() called on a restorer that already" +
          " has a snapshot. Construct a new instance per suite.",
      );
    }
    this.snapshotted = true;
    // Sweep atomic-write temp stragglers BEFORE capturing. The sweep is
    // scoped per-basename: for each snapshot target, we look ONLY for
    // `.<basename>.<16hex>.tmp` stragglers of that specific target. Earlier
    // revisions used a generic `/^\..+\.[0-9a-f]{16}\.tmp$/` regex which
    // would match any same-shaped tmp file in the directory — a landmine in
    // shared dirs like `.github/workflows/` where an unrelated tool could
    // have created a similarly-named file. CR5 HIGH tightening.
    const bucketed = new Map<string, Set<string>>();
    for (const p of this.paths) {
      const dir = path.dirname(p);
      let bucket = bucketed.get(dir);
      if (!bucket) {
        bucket = new Set();
        bucketed.set(dir, bucket);
      }
      bucket.add(path.basename(p));
    }
    for (const [dir, basenames] of bucketed) {
      this.sweepTmpStragglers(dir, basenames);
    }
    for (const p of this.paths) {
      if (fs.existsSync(p)) {
        this.snapshots.set(p, fs.readFileSync(p));
      }
    }
  }

  /** Remove `.<basename>.<16hex>.tmp` stragglers in `dir`, where `basename`
   *  is drawn from the snapshot target list for that directory. Tolerant of
   *  a missing directory (parent dir may not exist yet in a fresh clone).
   *
   *  The pattern matches files produced by `atomicWrite` for the specific
   *  targets we're about to snapshot, and ONLY those — stragglers for
   *  unrelated files in the same directory are left alone. EACCES/EBUSY on
   *  a specific unlink is debug-logged (`DEBUG_TEST_CLEANUP=1`) so hangs
   *  are diagnosable, then swallowed per best-effort sweep semantics. */
  private sweepTmpStragglers(
    dir: string,
    basenames: ReadonlySet<string>,
  ): void {
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
    // Escape each target basename for literal regex inclusion, then build
    // an alternation. `crypto.randomBytes(8)` is 16 hex chars.
    const escaped = Array.from(basenames, escapeRegExp);
    const re = new RegExp(`^\\.(?:${escaped.join("|")})\\.[0-9a-f]{16}\\.tmp$`);
    for (const name of entries) {
      if (!re.test(name)) continue;
      const target = path.join(dir, name);
      try {
        fs.unlinkSync(target);
      } catch (err) {
        if (process.env.DEBUG_TEST_CLEANUP) {
          const code = (err as NodeJS.ErrnoException).code ?? "?";
          // eslint-disable-next-line no-console
          console.warn(
            `[test-cleanup] sweep: unlink ${target} failed (${code})`,
          );
        }
        /* best effort */
      }
    }
  }

  /**
   * Restore every snapshotted path. If the on-disk bytes match the snapshot,
   * no write happens. Writes are atomic: we write the snapshot bytes to a
   * sibling temp file and `fs.renameSync` it into place, so readers never
   * observe a truncated intermediate state. Missing files are re-created
   * from the snapshot (including re-creating parent directories if they
   * were deleted). Any unexpected read error (EACCES, EISDIR, EBUSY, ...)
   * propagates.
   */
  restore(): void {
    for (const [p, content] of this.snapshots) {
      let current: Buffer | null;
      try {
        current = fs.readFileSync(p);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          current = null;
        } else {
          throw err;
        }
      }
      if (current === null || !current.equals(content)) {
        this.atomicWrite(p, content);
      }
    }
  }

  /** Atomic write via temp file + rename. Creates parent dir if missing.
   *
   *  Temp filename uses `crypto.randomBytes(8).toString("hex")` so two
   *  concurrent writes from the same process can't collide (they would with
   *  `Date.now()` at ms resolution) and so the `snapshot()` sweep regex can
   *  match stragglers unambiguously. */
  private atomicWrite(target: string, content: Buffer): void {
    const dir = path.dirname(target);
    const ensureDir = () => {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      }
    };

    const write = () => {
      // Temp file sits in the same directory so rename is atomic (same
      // filesystem). `os.tmpdir()` could be a different mount.
      const suffix = crypto.randomBytes(8).toString("hex");
      const tmp = path.join(dir, `.${path.basename(target)}.${suffix}.tmp`);
      fs.writeFileSync(tmp, content);
      try {
        fs.renameSync(tmp, target);
      } catch (err) {
        // Best effort — don't leak temp files on rename failure.
        try {
          fs.unlinkSync(tmp);
        } catch {
          /* swallow */
        }
        throw err;
      }
    };

    try {
      write();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        // Parent directory was removed between snapshot and restore — create
        // it and retry once.
        ensureDir();
        write();
      } else {
        throw err;
      }
    }
  }

  /** Expose the snapshot map (read-only) so tests can assert against it. */
  get snapshotMap(): ReadonlyMap<string, Buffer> {
    return this.snapshots;
  }
}
