#!/usr/bin/env tsx
/**
 * mutation-gate — apply each mutation in `mutants.json` in isolation, run the
 * declared test scope, assert the declared tests FAIL, revert, report.
 *
 * A test suite that stays green when the code under it is deliberately broken
 * is not a guard, it is decoration. This tool is the mechanical check for that,
 * seeded with the mutations that three separate review agents wrote by hand on
 * PR #6156 and threw away.
 *
 * USAGE
 *   cd showcase/scripts
 *   npm run mutation-gate                      # every mutant
 *   npm run mutation-gate -- --only bulk-merge # substring filter on id
 *   npm run mutation-gate -- --list            # print the manifest, run nothing
 *   npm run mutation-gate -- --check           # validate + resolve anchors only
 *   npm run mutation-gate -- --restore         # recover after a hard kill
 *   npm run mutation-gate -- --allow-fixed     # a closed gap warns, not fails
 *   npm run mutation-gate -- --no-baseline     # skip the pre-flight green check
 *   npm run mutation-gate -- --repo <path>     # explicit repo root
 *
 * EXIT CODES
 *   0  every mutant matched its declared expectation
 *   1  at least one fatal outcome (a toothless guard, a stale manifest entry,
 *      an unusable measurement, or a timeout)
 *   2  refused to run (dirty tree, wrong repo, rotted anchor, stale journal)
 *
 * SAFETY — this tool edits tracked source by design, so:
 *   1. It REFUSES to run when any TRACKED file is modified
 *      (`git status --porcelain -uno` must be empty). No `--force`. Untracked
 *      files are reported and tolerated: the gate only ever writes to tracked
 *      files it has verified against the manifest, so untracked work is not at
 *      risk, and the showcase packages legitimately carry gitignored generated
 *      artifacts (`src/data/*.json`) that the suites need in order to run.
 *   2. It NEVER runs `git stash` — the stash stack is shared repo-wide across
 *      worktrees and holds other sessions' entries — and never commits.
 *   3. It verifies `origin` resolves to `expectedRemoteSlug` BEFORE the first
 *      write, and that every target file is tracked by git.
 *   4. Originals are backed up under the worktree's own git dir (invisible to
 *      `git status`) and recorded in a JOURNAL. Reverts are byte restores
 *      verified by sha256 AND by `git diff --quiet`.
 *   5. SIGINT/SIGTERM/SIGHUP and any uncaught error revert synchronously
 *      before exit. A SIGKILL cannot be handled, so the journal survives it:
 *      the next invocation finds it, restores from the backups, and exits 2.
 */

import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import {
  classify,
  describeAnchorProblem,
  loadManifest,
  resolveAnchors,
  sha256,
} from "./manifest";
import type {
  Classification,
  Mutant,
  MutationManifest,
  RunMeasurement,
  TestOutcome,
  Verdict,
} from "./manifest";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface Options {
  repo?: string;
  only?: string;
  list: boolean;
  check: boolean;
  restore: boolean;
  allowFixed: boolean;
  baseline: boolean;
}

function parseArgs(argv: string[]): Options {
  const o: Options = {
    list: false,
    check: false,
    restore: false,
    allowFixed: false,
    baseline: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    switch (a) {
      case "--repo":
        o.repo = argv[++i];
        break;
      case "--only":
        o.only = argv[++i];
        break;
      case "--list":
        o.list = true;
        break;
      case "--check":
        o.check = true;
        break;
      case "--restore":
        o.restore = true;
        break;
      case "--allow-fixed":
        o.allowFixed = true;
        break;
      case "--no-baseline":
        o.baseline = false;
        break;
      case "-h":
      case "--help":
        printUsage();
        process.exit(0);
      default:
        fail(`unknown argument: ${a} (try --help)`, 2);
    }
  }
  return o;
}

function printUsage(): void {
  const header = readFileSync(new URL(import.meta.url), "utf8")
    .split("\n")
    .slice(1)
    .filter((l) => l.startsWith(" *") || l === "/**")
    .map((l) =>
      l
        .replace(/^ \*ic?/, "")
        .replace(/^ \* ?/, "")
        .replace(/^\/\*\*$/, ""),
    )
    .join("\n");
  process.stdout.write(`${header.trimEnd()}\n`);
}

function fail(message: string, code: number): never {
  process.stderr.write(`\nmutation-gate: ${message}\n`);
  process.exit(code);
}

// ---------------------------------------------------------------------------
// git helpers (read-only; the gate never mutates git state)
// ---------------------------------------------------------------------------

function git(cwd: string, args: string[]): { ok: boolean; out: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim() };
}

/** `https://github.com/Owner/Name.git`, `git@github.com:Owner/Name` → `owner/name`. */
function remoteSlug(url: string): string {
  return url
    .replace(/\.git$/, "")
    .replace(/^.*[:/]([^/]+\/[^/]+)$/, "$1")
    .toLowerCase();
}

// ---------------------------------------------------------------------------
// Journal — the SIGKILL-survivable record of what is currently mutated
// ---------------------------------------------------------------------------

interface JournalEntry {
  file: string;
  backup: string;
  originalSha256: string;
}
interface Journal {
  mutantId: string;
  startedAt: string;
  pid: number;
  entries: JournalEntry[];
}

class Mutator {
  private journal: Journal | null = null;

  constructor(
    private readonly repoRoot: string,
    private readonly journalFile: string,
    private readonly backupDir: string,
  ) {}

  get active(): boolean {
    return this.journal !== null;
  }

  /** Back up, journal, then write the mutated content. */
  apply(mut: Mutant): void {
    if (this.journal) throw new Error("a mutation is already applied");
    mkdirSync(this.backupDir, { recursive: true });
    const byFile = new Map<string, string>();
    for (const e of mut.edits) {
      const abs = path.join(this.repoRoot, e.file);
      let src = byFile.get(abs) ?? readFileSync(abs, "utf8");
      const n = src.split(e.find).length - 1;
      if (n !== 1) {
        throw new Error(
          `anchor for \`${mut.id}\` occurs ${n}× in ${e.file} (expected 1)`,
        );
      }
      byFile.set(abs, src.replace(e.find, e.replace));
      src = byFile.get(abs)!;
    }
    // Journal BEFORE the first write, so a kill between them is recoverable.
    const entries: JournalEntry[] = [];
    let i = 0;
    for (const abs of byFile.keys()) {
      const original = readFileSync(abs, "utf8");
      const backup = path.join(this.backupDir, `${i++}.orig`);
      writeFileSync(backup, original);
      entries.push({
        file: abs,
        backup,
        originalSha256: sha256(original),
      });
    }
    this.journal = {
      mutantId: mut.id,
      startedAt: new Date().toISOString(),
      pid: process.pid,
      entries,
    };
    writeFileSync(this.journalFile, JSON.stringify(this.journal, null, 2));
    for (const [abs, mutated] of byFile) writeFileSync(abs, mutated);
  }

  /**
   * Restore every journalled file and verify. Synchronous and idempotent so it
   * is safe to call from a signal handler.
   */
  revert(): void {
    const j =
      this.journal ??
      (existsSync(this.journalFile)
        ? (JSON.parse(readFileSync(this.journalFile, "utf8")) as Journal)
        : null);
    if (!j) return;
    const problems: string[] = [];
    for (const e of j.entries) {
      const original = readFileSync(e.backup, "utf8");
      if (sha256(original) !== e.originalSha256) {
        problems.push(`backup for ${e.file} is corrupt (sha mismatch)`);
        continue;
      }
      writeFileSync(e.file, original);
      if (sha256(readFileSync(e.file, "utf8")) !== e.originalSha256) {
        problems.push(`restore of ${e.file} did not take`);
      }
    }
    this.journal = null;
    if (existsSync(this.journalFile)) unlinkSync(this.journalFile);
    rmSync(this.backupDir, { recursive: true, force: true });
    if (problems.length > 0) {
      process.stderr.write(
        `\nmutation-gate: REVERT PROBLEM — restore by hand:\n  - ${problems.join(
          "\n  - ",
        )}\n`,
      );
      return;
    }
    const status = git(this.repoRoot, ["status", "--porcelain", "-uno"]);
    if (status.ok && status.out !== "") {
      process.stderr.write(
        `\nmutation-gate: tree is NOT clean after revert:\n${status.out}\n`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// vitest execution
// ---------------------------------------------------------------------------

interface VitestRunResult extends RunMeasurement {
  exitCode: number | null;
}

function runVitest(
  cwd: string,
  vitestBin: string,
  scope: string[],
  timeoutMs: number,
): Promise<VitestRunResult> {
  const outDir = mkdtempSync(path.join(tmpdir(), "mutation-gate-"));
  const outFile = path.join(outDir, "results.json");
  const args = [
    "run",
    ...scope,
    "--reporter=json",
    `--outputFile=${outFile}`,
    // Silence the interleaved test-side console noise; the JSON file is the
    // measurement. Failures are reported from the JSON, not from stdout.
    "--silent",
  ];
  return new Promise((resolve) => {
    const child = spawn(path.join(cwd, vitestBin), args, {
      cwd,
      // Capture BOTH streams: when vitest dies without writing its JSON (it
      // does, under enough machine load) the only account of why is on one of
      // them, and a non-measurement reported without its cause is useless.
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CI: "1", FORCE_COLOR: "0" },
    });
    let output = "";
    const collect = (d: Buffer) => {
      output += d.toString();
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000);
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      const measurement = timedOut
        ? { tests: [], loadErrors: [], timedOut: true }
        : readMeasurement(outFile, output, code);
      rmSync(outDir, { recursive: true, force: true });
      resolve({ ...measurement, exitCode: code });
    });
  });
}

/**
 * A verdict that reflects the MACHINE rather than the code. Vitest killed by
 * its own internal timeouts under load, or a scope that overran the wall clock,
 * says nothing about whether the guard has teeth — so these are retried once
 * before they are allowed to fail the gate. Retrying a real SURVIVED would be
 * corner-cutting; retrying a non-measurement is just refusing to guess.
 */
function isNonMeasurement(v: Verdict): boolean {
  return v === "ERROR" || v === "TIMEOUT";
}

interface VitestJson {
  numTotalTests?: number;
  testResults?: Array<{
    name?: string;
    status?: string;
    message?: string;
    assertionResults?: Array<{ fullName?: string; status?: string }>;
  }>;
}

function readMeasurement(
  outFile: string,
  output: string,
  exitCode: number | null,
): RunMeasurement {
  if (!existsSync(outFile)) {
    return {
      tests: [],
      loadErrors: [
        `vitest exited ${exitCode} without writing its JSON report` +
          (output ? `: ${firstLine(output)}` : " and printed nothing"),
      ],
      timedOut: false,
    };
  }
  let json: VitestJson;
  try {
    json = JSON.parse(readFileSync(outFile, "utf8")) as VitestJson;
  } catch (err) {
    return {
      tests: [],
      loadErrors: [`vitest JSON output was unparseable: ${String(err)}`],
      timedOut: false,
    };
  }
  const tests: TestOutcome[] = [];
  const loadErrors: string[] = [];
  for (const file of json.testResults ?? []) {
    const assertions = file.assertionResults ?? [];
    // A file that reports NO assertions but carries a message failed to
    // load/transform. That is not a measurement of the tests — a mutation that
    // breaks the parse "fails" everything while proving nothing.
    if (assertions.length === 0 && (file.message || file.status === "failed")) {
      loadErrors.push(
        `${file.name ?? "<unknown file>"}: ${firstLine(file.message ?? "no tests ran")}`,
      );
      continue;
    }
    for (const a of assertions) {
      tests.push({ fullName: a.fullName ?? "", status: a.status ?? "unknown" });
    }
  }
  return { tests, loadErrors, timedOut: false };
}

function firstLine(s: string): string {
  const line = s.split("\n").find((l) => l.trim() !== "") ?? "";
  return line.length > 220 ? `${line.slice(0, 220)}…` : line.trim();
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const GLYPH: Record<Verdict, string> = {
  KILLED: "KILLED",
  SURVIVED: "SURVIVED",
  SURVIVED_AS_DECLARED: "TOOTHLESS",
  GAP_CLOSED: "GAP-CLOSED",
  RATCHET_ADVANCED: "RATCHETED",
  ERROR: "ERROR",
  BASELINE_DIRTY: "BASE-RED",
  TIMEOUT: "TIMEOUT",
};

interface Row {
  mutant: Mutant;
  cls: Classification;
  ms: number;
}

function report(rows: Row[]): void {
  const w = Math.max(...rows.map((r) => r.mutant.id.length), 8);
  process.stdout.write(
    `\n${"MUTANT".padEnd(w)}  ${"EXPECT".padEnd(8)}  ${"VERDICT".padEnd(10)}  TIME\n`,
  );
  process.stdout.write(
    `${"-".repeat(w)}  ${"-".repeat(8)}  ${"-".repeat(10)}  ----\n`,
  );
  for (const r of rows) {
    process.stdout.write(
      `${r.mutant.id.padEnd(w)}  ${r.mutant.expect.padEnd(8)}  ` +
        `${GLYPH[r.cls.verdict].padEnd(10)}  ${(r.ms / 1000).toFixed(1)}s\n`,
    );
  }

  const fatal = rows.filter((r) => r.cls.fatal);
  const toothless = rows.filter(
    (r) => r.cls.verdict === "SURVIVED_AS_DECLARED",
  );
  const ratcheted = rows.filter((r) => r.cls.verdict === "RATCHET_ADVANCED");
  process.stdout.write(
    `\n${rows.length} mutant(s): ` +
      `${rows.filter((r) => r.cls.verdict === "KILLED").length} killed, ` +
      `${toothless.length} declared-toothless, ` +
      `${ratcheted.length} ratcheted, ` +
      `${fatal.length} FATAL\n`,
  );

  if (ratcheted.length > 0) {
    process.stdout.write(
      `\nRATCHET ADVANCED (a declared gap has been CLOSED — good news, but the ` +
        `manifest now carries a state it no longer needs)\n`,
    );
    for (const r of ratcheted) {
      process.stdout.write(`  ${r.mutant.id}\n    ${r.cls.detail}\n`);
    }
  }
  if (toothless.length > 0) {
    process.stdout.write(
      `\nDECLARED-TOOTHLESS GUARDS (known gaps, tracked in the manifest)\n`,
    );
    for (const r of toothless) {
      process.stdout.write(`  ${r.mutant.id}\n    ${r.cls.detail}\n`);
    }
  }
  if (fatal.length > 0) {
    process.stderr.write(`\nFATAL\n`);
    for (const r of fatal) {
      process.stderr.write(
        `  ${r.cls.verdict}: ${r.mutant.id}\n    ${r.cls.detail}\n` +
          `    provenance: ${r.mutant.provenance}\n`,
      );
    }
  }
}

function listManifest(m: MutationManifest): void {
  for (const mut of m.mutants) {
    process.stdout.write(
      `${mut.id}\n` +
        `  expect     ${mut.expect}\n` +
        `  suite      ${mut.suite} (${m.suites[mut.suite]!.package})\n` +
        `  scope      ${mut.scope.join(", ")}\n` +
        `  guards     ${mut.guards}\n` +
        `  provenance ${mut.provenance}\n` +
        (mut.expect === "kill"
          ? `  mustFail   ${mut.mustFail!.length} test(s)\n`
          : `  knownGap   ${mut.knownGap!.reason}\n` +
            `  closedBy   ${mut.knownGap!.closedBy}\n`) +
        (mut.ratchet
          ? `  ratchet    → ${mut.ratchet.expect}` +
            (mut.ratchet.expect === "kill"
              ? ` (${mut.ratchet.mustFail!.length} test(s))`
              : "") +
            ` measured at ${mut.ratchet.measuredAt} (${mut.ratchet.ref})\n` +
            `             ${mut.ratchet.note}\n`
          : ""),
    );
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const manifest = loadManifest();

  if (opts.list) {
    listManifest(manifest);
    return;
  }

  // --- repo resolution + HARD pre-flight -----------------------------------
  const here = import.meta.dirname;
  const top = opts.repo ?? git(here, ["rev-parse", "--show-toplevel"]).out;
  if (!top || !existsSync(top)) {
    fail(`could not resolve a repo root (tried \`${top}\`); pass --repo`, 2);
  }
  const repoRoot = path.resolve(top);

  const inside = git(repoRoot, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok || inside.out !== "true") {
    fail(`\`${repoRoot}\` is not a git work tree`, 2);
  }
  const origin = git(repoRoot, ["remote", "get-url", "origin"]);
  if (!origin.ok) fail(`\`${repoRoot}\` has no \`origin\` remote`, 2);
  const slug = remoteSlug(origin.out);
  if (slug !== manifest.expectedRemoteSlug.toLowerCase()) {
    fail(
      `REFUSING TO WRITE. \`${repoRoot}\` origin resolves to \`${slug}\`, but ` +
        `the manifest expects \`${manifest.expectedRemoteSlug}\`. This gate ` +
        `edits tracked source; it will not do so in an unexpected repo.`,
      2,
    );
  }
  const gitDir = git(repoRoot, ["rev-parse", "--absolute-git-dir"]);
  if (!gitDir.ok) fail("could not resolve the git dir", 2);
  const journalFile = path.join(gitDir.out, "mutation-gate-journal.json");
  const backupDir = path.join(gitDir.out, "mutation-gate-backup");
  const mutator = new Mutator(repoRoot, journalFile, backupDir);

  // --- journal recovery ----------------------------------------------------
  if (existsSync(journalFile)) {
    const stale = JSON.parse(readFileSync(journalFile, "utf8")) as Journal;
    process.stderr.write(
      `\nmutation-gate: a PREVIOUS RUN DIED with \`${stale.mutantId}\` applied ` +
        `(pid ${stale.pid}, ${stale.startedAt}). Restoring from the journal.\n`,
    );
    mutator.revert();
    const after = git(repoRoot, ["status", "--porcelain", "-uno"]);
    process.stderr.write(
      after.out === ""
        ? `mutation-gate: restored; tree is clean. Re-run.\n`
        : `mutation-gate: restored, but the tree is still dirty:\n${after.out}\n`,
    );
    process.exit(2);
  }
  if (opts.restore) {
    process.stdout.write(
      `mutation-gate: no journal at ${journalFile} — nothing to restore.\n`,
    );
    return;
  }

  // --- clean tree ----------------------------------------------------------
  // TRACKED modifications only (`-uno`): those are what a revert could clobber.
  // Untracked files are noted but tolerated — the showcase packages need
  // gitignored generated artifacts (`src/data/*.json`) present for the suites
  // to load at all, so demanding a virgin tree would make the gate unrunnable.
  // `--check` only READS (validate + resolve anchors), so it is allowed on a
  // dirty tree — it is the check you most want while editing the manifest.
  const status = git(repoRoot, ["status", "--porcelain", "-uno"]);
  if (!status.ok) fail("`git status` failed", 2);
  if (status.out !== "" && !opts.check) {
    fail(
      `REFUSING TO RUN — ${status.out.split("\n").length} tracked file(s) are ` +
        `modified. This gate rewrites tracked source and reverts it, so ` +
        `uncommitted work is at risk. There is no --force, and this gate never ` +
        `uses \`git stash\` (the stash stack is shared repo-wide across ` +
        `worktrees and holds other sessions' entries). Commit or discard ` +
        `first:\n${status.out}`,
      2,
    );
  }

  // --- every target must be tracked ---------------------------------------
  const files = [
    ...new Set(manifest.mutants.flatMap((m) => m.edits.map((e) => e.file))),
  ];
  const untracked = files.filter(
    (f) => !git(repoRoot, ["ls-files", "--error-unmatch", f]).ok,
  );
  if (untracked.length > 0) {
    fail(`target file(s) are not tracked by git: ${untracked.join(", ")}`, 2);
  }

  // --- anchors resolve ----------------------------------------------------
  const anchorProblems = resolveAnchors(manifest, repoRoot);
  if (anchorProblems.length > 0) {
    fail(
      `manifest anchors do not resolve at HEAD ` +
        `(${git(repoRoot, ["rev-parse", "--short", "HEAD"]).out}):\n  - ` +
        anchorProblems.map(describeAnchorProblem).join("\n  - "),
      2,
    );
  }
  if (opts.check) {
    process.stdout.write(
      `mutation-gate: manifest valid; ${manifest.mutants.length} mutant(s), ` +
        `all anchors resolve uniquely at ` +
        `${git(repoRoot, ["rev-parse", "--short", "HEAD"]).out}.\n`,
    );
    return;
  }

  const selected = opts.only
    ? manifest.mutants.filter((m) => m.id.includes(opts.only!))
    : manifest.mutants;
  if (selected.length === 0) fail(`--only "${opts.only}" matched no mutant`, 2);

  // --- revert-on-death wiring ---------------------------------------------
  let interrupted = false;
  const onSignal = (sig: NodeJS.Signals) => {
    interrupted = true;
    process.stderr.write(`\nmutation-gate: ${sig} — reverting…\n`);
    mutator.revert();
    process.stderr.write(`mutation-gate: reverted. Exiting.\n`);
    process.exit(130);
  };
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as NodeJS.Signals[]) {
    process.on(sig, () => onSignal(sig));
  }
  const onCrash = (err: unknown) => {
    process.stderr.write(
      `\nmutation-gate: crashed — reverting…\n${String(err)}\n`,
    );
    mutator.revert();
    process.exit(1);
  };
  process.on("uncaughtException", onCrash);
  process.on("unhandledRejection", onCrash);

  // --- baseline: the scope must be GREEN before it can be mutated ---------
  const baselineOf = new Map<string, RunMeasurement>();
  if (opts.baseline) {
    const scopes = new Map<string, { suite: string; scope: string[] }>();
    for (const m of selected) {
      scopes.set(`${m.suite}::${[...m.scope].sort().join("|")}`, {
        suite: m.suite,
        scope: m.scope,
      });
    }
    process.stdout.write(
      `mutation-gate: baseline — ${scopes.size} distinct scope(s) must be green ` +
        `before any mutation is applied.\n`,
    );
    for (const [key, { suite, scope }] of scopes) {
      const s = manifest.suites[suite]!;
      const r = await runVitest(
        path.join(repoRoot, s.package),
        s.vitestBin,
        scope,
        s.timeoutMs,
      );
      baselineOf.set(key, r);
      const failed = r.tests.filter((t) => t.status === "failed").length;
      const bad = r.timedOut || r.loadErrors.length > 0 || failed > 0;
      process.stdout.write(
        `  ${bad ? "RED " : "green"}  ${suite}  ${scope.join(", ")}  ` +
          `(${r.tests.length} tests, ${failed} failed` +
          `${r.loadErrors.length ? `, ${r.loadErrors.length} load error(s)` : ""}` +
          `${r.timedOut ? ", TIMED OUT" : ""})\n`,
      );
      if (bad) {
        fail(
          `baseline for \`${suite}\` (${scope.join(", ")}) is NOT green, so no ` +
            `mutation run on it can be interpreted. Nothing was mutated.` +
            (r.loadErrors.length
              ? `\n  first load error: ${r.loadErrors[0]}`
              : ""),
          2,
        );
      }
    }
  }

  // --- the run ------------------------------------------------------------
  /** Apply, measure, revert, classify. Reverts even if vitest plumbing throws. */
  const attempt = async (
    mut: Mutant,
    s: (typeof manifest.suites)[string],
  ): Promise<Classification> => {
    let run: RunMeasurement;
    try {
      mutator.apply(mut);
      run = await runVitest(
        path.join(repoRoot, s.package),
        s.vitestBin,
        mut.scope,
        mut.timeoutMs ?? s.timeoutMs,
      );
    } finally {
      mutator.revert();
    }
    return classify(mut, run, { allowFixed: opts.allowFixed });
  };

  const rows: Row[] = [];
  for (const mut of selected) {
    if (interrupted) break;
    const s = manifest.suites[mut.suite]!;
    process.stdout.write(`\n▸ ${mut.id}  (expect ${mut.expect})\n`);
    const started = Date.now();
    // One retry, and ONLY for a non-measurement. Every attempt applies and
    // reverts within itself, so a retry re-mutates from a verified clean tree
    // rather than stacking on the previous attempt. Retrying a real SURVIVED
    // would be corner-cutting; retrying a non-measurement refuses to guess.
    const MAX_ATTEMPTS = 2;
    let cls = await attempt(mut, s);
    for (let n = 2; isNonMeasurement(cls.verdict) && n <= MAX_ATTEMPTS; n++) {
      process.stdout.write(
        `  ${cls.verdict} on attempt ${n - 1} — a non-measurement, not a ` +
          `result; retrying.\n    ${cls.detail}\n`,
      );
      cls = await attempt(mut, s);
      if (!isNonMeasurement(cls.verdict)) {
        cls = {
          ...cls,
          detail:
            `${cls.detail} [measured on attempt ${n}; earlier attempt(s) ` +
            `were non-measurements — treat the timing below as unreliable]`,
        };
      }
    }
    const ms = Date.now() - started;
    process.stdout.write(`  ${GLYPH[cls.verdict].trim()} — ${cls.detail}\n`);
    rows.push({ mutant: mut, cls, ms });
  }

  // Final belt-and-braces: the tree must be exactly as we found it.
  const finalStatus = git(repoRoot, ["status", "--porcelain", "-uno"]);
  if (finalStatus.out !== "") {
    process.stderr.write(
      `\nmutation-gate: TREE NOT CLEAN at exit — investigate:\n${finalStatus.out}\n`,
    );
    report(rows);
    process.exit(1);
  }
  process.stdout.write(`\nmutation-gate: tree verified clean at exit.\n`);

  report(rows);
  process.exit(rows.some((r) => r.cls.fatal) ? 1 : 0);
}

await main();
