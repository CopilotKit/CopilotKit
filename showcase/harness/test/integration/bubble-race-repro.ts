import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Resolve the showcase root relative to THIS source file so the repro
// drives the same checkout the test is being run from (worktree or
// main). Hard-coding /Users/jpr5/proj/cpk/cpk/showcase would drive the
// main checkout from inside a worktree and the runner edits from the
// worktree would never execute. The test file lives at
// showcase/harness/test/integration/bubble-race-repro.ts; the showcase
// root is three directories up.
const SHOWCASE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

export interface BubbleRaceReproOpts {
  /** Harness target — `<slug>` or `<slug>:<demo>` per cli.ts:52. */
  slug: string;
  /** Probe depth shorthand — one of "smoke"|"d4"|"d5"|"d6". */
  level: "smoke" | "d4" | "d5" | "d6";
  /**
   * User messages to drive into the existing canonical fixture for
   * `<slug>:<demo>`. The aimock match contract is content-based
   * (userMessage + context), so per-scenario behavior is selected by
   * sending the right message rather than swapping fixture files.
   */
  messages: string[];
  /**
   * Optional HTML injected via Playwright `addInitScript` BEFORE
   * navigation — used by defect 4 only. Forwarded to the harness via
   * the `BUBBLE_RACE_PRE_PAINT` env var; `helpers/init-scripts.ts`
   * reads it and calls `page.addInitScript` against the d5/d6 drivers'
   * pre-navigation hook (the first `page.goto` callsite for the path
   * the test drives).
   */
  prePaint?: string;
  /**
   * Optional CSS selector whose matching nodes have their
   * `data-testid` attribute stripped via Playwright `addInitScript`
   * BEFORE navigation — used by defect 3 only when no natural
   * cascade-fallback-only demo exists. Forwarded to the harness via
   * the `BUBBLE_RACE_STRIP_SELECTOR` env var; `helpers/init-scripts.ts`
   * reads it and calls `page.addInitScript` to remove the testid from
   * any rendered node matching the selector, forcing the runner's
   * cascade to fall through to a non-canonical tier.
   */
  prePaintStrip?: string;
}

export interface BubbleRaceTurnResult {
  turnIndex: number;
  inputLength: number;
  assistantTextLength: number;
}

export interface BubbleRaceReproResult {
  exitCode: number;
  turns: BubbleRaceTurnResult[];
  /** Absolute path to the harness run-artifacts directory (parsed from stdout). */
  runDir: string;
  stdout: string;
  stderr: string;
}

/**
 * Drives `bin/showcase test <slug> --<level> --verbose` (which in turn
 * runs `npx tsx harness/src/cli.ts test …` per cmd-test.sh:143). The
 * harness runs from source — no Docker image of the harness exists in
 * the local path. Parses privacy-safe per-turn length metadata out of
 * verbose stdout.
 *
 * The driver depends on TWO production log lines added in the SAME
 * commit that lands this driver:
 *   1. `[conversation-runner] turn N/total — settled metadata`
 *      — carries the turn number, bubble index, and response length but
 *      never the prompt or generated response content.
 *   2. `[harness] runDir=…` — the harness already prints the run
 *      artifacts directory in --verbose mode; the driver captures it
 *      out of stdout. If the existing log uses a different label,
 *      adjust the parser accordingly (verified during Phase 0).
 *
 * Per-scenario behavior is configured via `messages` (the array of
 * user inputs the harness sends — wired into the d5/d6 probe drivers'
 * existing user-message channel) and optionally `prePaint` (defect 4
 * only, forwarded via BUBBLE_RACE_PRE_PAINT env to init-scripts.ts).
 */
export async function runBubbleRaceRepro(
  opts: BubbleRaceReproOpts,
): Promise<BubbleRaceReproResult> {
  const env = {
    ...process.env,
    BUBBLE_RACE_MESSAGES: JSON.stringify(opts.messages),
    ...(opts.prePaint ? { BUBBLE_RACE_PRE_PAINT: opts.prePaint } : {}),
    ...(opts.prePaintStrip
      ? { BUBBLE_RACE_STRIP_SELECTOR: opts.prePaintStrip }
      : {}),
  };
  // `--direct` runs d5/d6 via the in-process driver in cli.ts rather than
  // the control-plane worker path. This is REQUIRED for the bubble-race
  // repros because the driver parses privacy-safe settled metadata out of
  // the CLI subprocess's stdout; in
  // control-plane mode, those logs are emitted inside a separate worker
  // process whose stdout never reaches the CLI. The `--direct` switch is
  // exposed by cmd-test.sh (line 17/62) and the harness CLI (cli.ts:80).
  const proc = spawn(
    "bin/showcase",
    ["test", opts.slug, `--${opts.level}`, "--direct", "--verbose"],
    { cwd: SHOWCASE_ROOT, env },
  );
  let stdout = "";
  let stderr = "";
  proc.stdout.on("data", (b) => (stdout += b.toString()));
  proc.stderr.on("data", (b) => (stderr += b.toString()));
  proc.on("error", (err) => {
    console.warn(
      `[bubble-race-repro] spawn error: ${(err as Error).message ?? err}`,
    );
  });
  const exitCode: number = await new Promise((resolve) =>
    proc.on("close", (code) => resolve(code ?? -1)),
  );
  const turns: BubbleRaceTurnResult[] = [];
  const inputLengths = new Map<number, number>();
  const sendRe =
    /\[conversation-runner\] turn (\d+)\/\d+ — sending message \{\s*inputLength:\s*(\d+),/gm;
  let m: RegExpExecArray | null;
  while ((m = sendRe.exec(stdout)) !== null) {
    inputLengths.set(Number(m[1]), Number(m[2]));
  }
  const re =
    /\[conversation-runner\] turn (\d+)\/\d+ — settled metadata \{\s*turnNum:\s*\d+,\s*bubbleIndex:\s*\d+,\s*textLength:\s*(\d+)\s*\}/gm;
  while ((m = re.exec(stdout)) !== null) {
    const turnIndex = Number(m[1]);
    turns.push({
      turnIndex,
      inputLength: inputLengths.get(turnIndex) ?? -1,
      assistantTextLength: Number(m[2]),
    });
  }
  const runDirMatch = stdout.match(/\[harness\] runDir=(\S+)/);
  const runDir = runDirMatch ? runDirMatch[1] : "";
  return { exitCode, turns, runDir, stdout, stderr };
}
