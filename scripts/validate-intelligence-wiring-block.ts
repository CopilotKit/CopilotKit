import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Holds the starters' Intelligence wiring block to one shape.
 *
 * Every starter ends its runtime construction with the same marked region: a
 * spread that reads `COPILOTKIT_LICENSE_TOKEN` and either wires the managed
 * platform or falls back to a local runner. It is the region a hosted reader
 * copies verbatim, and nothing gated it (OSS-982). Both gaps that could have
 * caught drift are deliberate:
 *
 * - The parity manifest lists `src/app/api/copilotkit/**` under
 *   `allowedDivergence` for every instance it tracks, so the drift check skips
 *   the route on purpose. What it does hold byte-identical is the demo
 *   frontend.
 * - No `docker-compose.test.yml` sets `COPILOTKIT_LICENSE_TOKEN`, so every
 *   smoke-tested starter takes the else arm. The `intelligence:` arm has never
 *   run in CI.
 *
 * The cost was already visible. The block's code was byte-identical in 21 of 22
 * starters, but its warning comment had drifted into five variants and two
 * starters shipped the `demo-user` stub with no warning at all. Comment drift
 * is harmless by itself; it is the tracer showing nothing held the region
 * still, and it is how the localhost default of OSS-981 survived in all 22
 * copies at once.
 *
 * The check compares each site against the north-star starter rather than
 * against a literal kept here, so improving the block means editing the north
 * star and running the other 21 to match. Two normalisations keep it honest
 * without weakening it: the block is dedented, because `agentcore` nests it
 * deeper, and the else arm's runner name is masked, because that name is the
 * one thing a starter may legitimately choose. Everything else, comment text
 * included, must match to the byte.
 *
 * This is a shape gate, not a content gate. It cannot tell a good block from a
 * bad one — 22 identically wrong copies still pass. What it guarantees is that
 * a fix reaches all of them or none.
 */

const REPO_ROOT = path.resolve(__dirname, "..");

/** Opens every wiring site. Selects the code sites and nothing else. */
export const OPEN_MARKER =
  "// --- copilotkit:intelligence (remove this block to opt out) ---";

/** Closes every wiring site. */
export const CLOSE_MARKER = "// --- /copilotkit:intelligence ---";

/**
 * The starter every other site is compared against, matching `northStar` in
 * `examples/integrations/_parity/manifest.json`.
 */
const NORTH_STAR =
  "examples/integrations/langgraph-python/src/app/api/copilotkit/[[...slug]]/route.ts";

/** Stands in for the else arm's runner while the rest is compared exactly. */
const RUNNER_PLACEHOLDER = "«runner»";

/**
 * The runner each starter is expected to name in its else arm.
 *
 * Anything absent from this map must use `InMemoryAgentRunner`. `agentcore` is
 * the one exception in the tree: its runtime is a Lambda handler in front of a
 * Bedrock AgentCore session, so an in-process runner has nothing to run.
 * Adding an entry is a deliberate act, which is the point — a runner swapped in
 * by accident fails instead.
 */
const EXPECTED_RUNNER: Record<string, string> = {
  agentcore: "AgentCoreRunner",
};

/** Used for every starter with no {@link EXPECTED_RUNNER} entry. */
const DEFAULT_RUNNER = "InMemoryAgentRunner";

/**
 * Returns the marked wiring region of one source file, markers included.
 *
 * @param source - The file's full text.
 * @returns The region, or `null` when the file has no opening marker or the
 *   block is never closed. The caller reports the unterminated case; discovery
 *   already guarantees the opening marker is present.
 */
export function extractBlock(source: string): string | null {
  const start = source.indexOf(OPEN_MARKER);
  if (start === -1) return null;

  const end = source.indexOf(CLOSE_MARKER, start + OPEN_MARKER.length);
  if (end === -1) return null;

  const lineStart = source.lastIndexOf("\n", start) + 1;
  return source.slice(lineStart, end + CLOSE_MARKER.length);
}

/**
 * Removes the block's own indentation and any trailing whitespace.
 *
 * The block sits two levels deeper in `agentcore` than in a Next.js route.
 * Nesting depth is a property of the file around the block, not of the block,
 * so it is normalised away; relative indentation inside the block is kept.
 *
 * @param block - A wiring region, as returned by {@link extractBlock}.
 * @returns The block, dedented to its shallowest line and newline-normalised.
 */
export function normalizeBlock(block: string): string {
  const lines = block.replace(/\r\n?/g, "\n").split("\n");
  const indents = lines
    .filter((line) => line.trim() !== "")
    .map((line) => line.length - line.trimStart().length);
  const base = indents.length > 0 ? Math.min(...indents) : 0;

  return lines
    .map((line) => line.slice(base).trimEnd())
    .join("\n")
    .trim();
}

/**
 * Returns the runner the else arm constructs, or `null`.
 *
 * @param block - A wiring region.
 * @returns The constructor name, or `null` when the arm constructs nothing —
 *   which is itself a violation, since the fallback is what makes the starter
 *   run without a license.
 */
export function runnerName(block: string): string | null {
  return /:\s*\{\s*runner:\s*new\s+(\w+)\s*\(/.exec(block)?.[1] ?? null;
}

/**
 * Replaces the else arm's runner name with {@link RUNNER_PLACEHOLDER}.
 *
 * @param block - A wiring region.
 * @returns The block with the runner masked, leaving every other difference
 *   visible to {@link blockDiff}.
 */
export function maskRunner(block: string): string {
  return block.replace(
    /(:\s*\{\s*runner:\s*new\s+)\w+(\s*\()/,
    `$1${RUNNER_PLACEHOLDER}$2`,
  );
}

/** One line where two blocks disagree. `null` means the line is absent. */
export interface BlockDiff {
  line: number;
  expected: string | null;
  actual: string | null;
}

/**
 * Returns the first line where two blocks disagree, or `null`.
 *
 * @param expected - The north star's normalised block.
 * @param actual - The site's normalised block.
 * @returns The first disagreement, numbered from one, or `null` when the two
 *   are identical.
 */
export function blockDiff(expected: string, actual: string): BlockDiff | null {
  const want = expected.split("\n");
  const got = actual.split("\n");

  for (let i = 0; i < Math.max(want.length, got.length); i++) {
    if (want[i] === got[i]) continue;
    return {
      line: i + 1,
      expected: want[i] ?? null,
      actual: got[i] ?? null,
    };
  }
  return null;
}

/**
 * Returns every file carrying a wiring marker, repository-relative.
 *
 * Discovery is a grep rather than a list, so a starter added later is covered
 * the day it lands. Two things are excluded by construction rather than by an
 * allowlist: the `.env.example` files, which use a different marker text, and
 * this file and its test, which quote the marker and sit outside `examples`.
 */
export function markerFiles(): string[] {
  let out: string;
  try {
    out = execFileSync(
      "git",
      ["grep", "-l", "--fixed-strings", OPEN_MARKER, "--", "examples"],
      { cwd: REPO_ROOT, encoding: "utf-8" },
    );
  } catch {
    // git grep exits 1 when there are no matches.
    return [];
  }
  return out.split("\n").filter(Boolean).sort();
}

/** The starter directory a wiring site belongs to. */
function starterOf(file: string): string {
  return file.split("/")[2] ?? file;
}

function readBlock(file: string): string | null {
  const source = fs.readFileSync(path.join(REPO_ROOT, file), "utf-8");
  const block = extractBlock(source);
  return block === null ? null : normalizeBlock(block);
}

interface Violation {
  file: string;
  reason: string;
}

/** Collects every wiring site that disagrees with the north star. */
export function findViolations(): Violation[] {
  const violations: Violation[] = [];

  const canonical = readBlock(NORTH_STAR);
  if (canonical === null) {
    return [
      {
        file: NORTH_STAR,
        reason: "north-star wiring block is missing or unterminated",
      },
    ];
  }

  for (const file of markerFiles()) {
    const block = readBlock(file);
    if (block === null) {
      violations.push({
        file,
        reason: `block is never closed; add ${CLOSE_MARKER}`,
      });
      continue;
    }

    const runner = runnerName(block);
    const wanted = EXPECTED_RUNNER[starterOf(file)] ?? DEFAULT_RUNNER;
    if (runner === null) {
      violations.push({
        file,
        reason: `else arm constructs no runner; expected new ${wanted}()`,
      });
    } else if (runner !== wanted) {
      violations.push({
        file,
        reason: `else arm uses ${runner}; expected ${wanted}`,
      });
    }

    const diff = blockDiff(maskRunner(canonical), maskRunner(block));
    if (diff !== null) {
      violations.push({
        file,
        reason:
          `line ${diff.line} differs from the north star\n` +
          `      expected: ${diff.expected ?? "(no line)"}\n` +
          `      actual:   ${diff.actual ?? "(no line)"}`,
      });
    }
  }

  return violations;
}

function main(): void {
  const files = markerFiles();
  const violations = findViolations();

  if (files.length === 0) {
    console.log(
      "Found no Intelligence wiring markers. Either every starter lost its\n" +
        `wiring or OPEN_MARKER no longer matches the tree:\n  ${OPEN_MARKER}`,
    );
    process.exit(1);
  }

  if (violations.length === 0) {
    console.log(
      `All ${files.length} Intelligence wiring sites match ${starterOf(NORTH_STAR)}.`,
    );
    process.exit(0);
  }

  console.log(
    `Found ${violations.length} Intelligence wiring site${
      violations.length === 1 ? "" : "s"
    } out of shape:\n`,
  );
  for (const v of violations) {
    console.log(`  ${v.file}\n      ${v.reason}`);
  }
  console.log(
    `\nEvery starter's wiring block must match ${NORTH_STAR}, ignoring nesting\n` +
      "depth and the else arm's runner name. To change the block, edit the north star and\n" +
      "run the other sites to match; a fix that reaches one starter must reach all of them.\n" +
      "To let a starter name a different runner, add it to EXPECTED_RUNNER in\n" +
      "scripts/validate-intelligence-wiring-block.ts with the reason.",
  );
  process.exit(1);
}

const isDirectRun = typeof require !== "undefined" && require.main === module;

if (isDirectRun) {
  main();
}
