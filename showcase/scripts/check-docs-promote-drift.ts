#!/usr/bin/env npx tsx
/**
 * check-docs-promote-drift.ts — reports docs content merged to main but not promoted.
 *
 * `docs.copilotkit.ai` only changes when a human dispatches `showcase_promote.yml`
 * ("Humans trigger. No automatic prod promotes."). That is a deliberate release gate,
 * and this gate does not argue with it. What was missing is any way to see what the
 * gate is currently holding.
 *
 * The consequence is not cosmetic. A merged page returns an honest 404 on prod, which
 * is indistinguishable from a page that was never written:
 *
 *   - OSS-948  — "Angular's Inspector fix is written but unpublished".
 *   - OSS-1005 — closed by a commit whose page was still not live four days later.
 *   - OSS-1037 — filed on the wrong diagnosis. A 404 was read as a routing defect and
 *                a fix was proposed for a route that was never broken.
 *
 * It reaches the onboarding graph too: the graph fetches `docs.copilotkit.ai/*.md` at
 * run time and reads a failed fetch as "documentation does not support the selection",
 * routing to `unsupported/no-validated-path`. An un-promoted page therefore fails a run
 * for a documentation gap that does not exist.
 *
 * No secret is needed. The shell already renders its own build SHA into every page
 * (`shell-docs-commit-label`, see showcase/shell-docs/src/app/layout.tsx), so the
 * deployed commit is public. This reads it, resolves it in the checkout, and diffs the
 * docs content tree against HEAD.
 *
 * Usage:
 *   npx tsx showcase/scripts/check-docs-promote-drift.ts
 *   npx tsx showcase/scripts/check-docs-promote-drift.ts --host docs.staging.copilotkit.ai
 *   npx tsx showcase/scripts/check-docs-promote-drift.ts --max-age-days 5
 *   npx tsx showcase/scripts/check-docs-promote-drift.ts --json
 *
 * Exit: 0 when prod is current, or when the drift is younger than the age budget.
 *       1 when the oldest unpromoted page is past the budget, or when the deployed
 *       commit cannot be read or resolved — an unreadable label must never be
 *       reported as "prod is current".
 */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Content the docs site serves. A change under here is reader-visible once promoted. */
export const DOCS_CONTENT_PATH = "showcase/shell-docs/src/content";

const DEFAULT_HOST = "docs.copilotkit.ai";

/**
 * Days of unpromoted content treated as normal pipeline latency.
 *
 * Drift is the expected state between promotes, so failing the moment a PR merges would
 * make this check noise, and a check that is always red is a check nobody reads. Past
 * this, the promote was forgotten rather than pending.
 */
const DEFAULT_MAX_AGE_DAYS = 3;

/** Labels the shell renders when it has no commit to report. Neither is a SHA. */
const NON_COMMIT_LABELS = new Set(["dev", "unknown"]);

export interface ContentDrift {
  /** Pages that do not exist on prod at all. A reader gets a 404. */
  readonly added: string[];
  /** Pages that exist on prod with older content, and give no sign of it. */
  readonly modified: string[];
  /** Pages prod still serves that main has removed. */
  readonly deleted: string[];
}

export interface DocsDriftSummary {
  readonly shouldFail: boolean;
  readonly lines: string[];
}

export interface SummarizeDocsDriftInput {
  /** The host the label was read from. Named in the report: this also runs on staging. */
  readonly host: string;
  /** Short or full SHA read from the deployed page, or null when unreadable. */
  readonly deployedSha: string | null;
  readonly headSha: string;
  readonly drift: ContentDrift;
  /** Age of the oldest commit carrying unpromoted content, or null when there is none. */
  readonly oldestUnpromotedAgeDays: number | null;
  readonly maxAgeDays: number;
  /** False when the deployed SHA does not resolve in this checkout. Defaults to true. */
  readonly resolved?: boolean;
}

/**
 * Reads the deployed commit out of a rendered page.
 *
 * @param html - The page body.
 * @returns The short SHA, or null when the page carries no commit.
 */
export function parseDeployedCommit(html: string): string | null {
  const match =
    /<div[^>]*class="[^"]*\bshell-docs-commit-label\b[^"]*"[^>]*>\s*([^<\s]+)\s*</.exec(
      html,
    );
  const label = match?.[1];
  if (!label) return null;
  // `dev` (ARG unset) and `unknown` (ARG empty) are the shell's own words for "no
  // commit". Resolving either would find nothing and report the whole tree as drifted.
  if (NON_COMMIT_LABELS.has(label)) return null;
  return /^[0-9a-f]{7,40}$/.test(label) ? label : null;
}

/**
 * Splits a `git diff --name-status` block into the three reader-visible outcomes.
 *
 * @param nameStatus - Raw `--name-status` output, one record per line.
 * @returns Paths grouped by what a reader would experience before the promote.
 */
export function classifyContentDrift(nameStatus: string): ContentDrift {
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];

  for (const line of nameStatus.split("\n")) {
    if (!line.trim()) continue;
    const [status, ...paths] = line.split("\t");
    if (!status || paths.length === 0) continue;

    if (status.startsWith("R") && paths.length >= 2) {
      // A rename is two findings at once: the new URL 404s and the old one still
      // resolves. Counting it as a modification would hide both.
      deleted.push(paths[0]!);
      added.push(paths[1]!);
      continue;
    }

    const path = paths[paths.length - 1]!;
    if (status.startsWith("A")) added.push(path);
    else if (status.startsWith("D")) deleted.push(path);
    else modified.push(path);
  }

  return { added, modified, deleted };
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Renders at most `limit` paths, then says how many were withheld. */
function listPaths(paths: string[], limit = 20): string[] {
  const shown = paths.slice(0, limit).map((path) => `    ${path}`);
  if (paths.length > limit) {
    shown.push(`    … and ${paths.length - limit} more`);
  }
  return shown;
}

/**
 * Turns a measured drift into a verdict and the lines a human reads.
 *
 * @param input - The deployed commit, the diff against HEAD, and the age budget.
 * @returns Whether to fail, and the report.
 */
export function summarizeDocsDrift(
  input: SummarizeDocsDriftInput,
): DocsDriftSummary {
  const {
    host,
    deployedSha,
    headSha,
    drift,
    oldestUnpromotedAgeDays,
    maxAgeDays,
  } = input;
  const resolved = input.resolved ?? true;
  const lines: string[] = [];

  if (deployedSha === null) {
    return {
      shouldFail: true,
      lines: [
        `✗ could not read the deployed commit from ${host}.`,
        "  Every page renders it in `.shell-docs-commit-label` (see shell-docs/src/app/layout.tsx).",
        "  A `dev` or `unknown` label means the build ARG was unset or empty — fix the",
        "  Dockerfile ARG scope rather than treating prod as current.",
      ],
    };
  }

  if (!resolved) {
    return {
      shouldFail: true,
      lines: [
        `✗ the deployed commit ${deployedSha} on ${host} does not resolve in this checkout.`,
        "  Fetch full history (`fetch-depth: 0`) — a shallow clone cannot reach an older",
        "  build. If it resolves nowhere, prod is serving a commit that left main.",
      ],
    };
  }

  const total =
    drift.added.length + drift.modified.length + drift.deleted.length;
  if (total === 0) {
    return {
      shouldFail: false,
      lines: [
        `✓ ${host} is serving ${deployedSha.slice(0, 7)} and no docs content is waiting to be promoted.`,
      ],
    };
  }

  const age = oldestUnpromotedAgeDays;
  const overdue = age !== null && age > maxAgeDays;

  lines.push(
    overdue
      ? `✗ docs content has been waiting ${Math.floor(age)}+ days to be promoted, past the ${maxAgeDays}-day budget.`
      : `• docs content is waiting to be promoted, within the ${maxAgeDays}-day budget.`,
  );
  lines.push(
    `  ${host} ${deployedSha.slice(0, 7)} → main ${headSha.slice(0, 7)}: ${plural(total, "page")} differ under ${DOCS_CONTENT_PATH}.`,
  );

  if (drift.added.length > 0) {
    lines.push(
      overdue
        ? `  ${plural(drift.added.length, "page")} merged and still returning 404:`
        : `  ${plural(drift.added.length, "page")} not live yet:`,
    );
    lines.push(...listPaths(drift.added));
  }
  if (drift.modified.length > 0) {
    lines.push(
      `  ${plural(drift.modified.length, "page")} serving older content:`,
    );
    lines.push(...listPaths(drift.modified));
  }
  if (drift.deleted.length > 0) {
    lines.push(
      `  ${plural(drift.deleted.length, "page")} removed from main but still served:`,
    );
    lines.push(...listPaths(drift.deleted));
  }

  if (overdue) {
    lines.push(
      "  Promote shell-docs: run the `Showcase: Promote (staging → prod)` workflow",
      "  with service `shell-docs`. Prod does not move on its own.",
    );
  }

  return { shouldFail: overdue, lines };
}

/** Runs git in the repository and returns trimmed stdout. */
function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const host = readArg("host") ?? DEFAULT_HOST;
  const maxAgeDays = Number(readArg("max-age-days") ?? DEFAULT_MAX_AGE_DAYS);
  const asJson = process.argv.includes("--json");

  const response = await fetch(`https://${host}/`, {
    headers: { "user-agent": "check-docs-promote-drift" },
  });
  if (!response.ok) {
    console.error(`✗ ${host} answered ${response.status}`);
    process.exit(1);
  }

  const deployedSha = parseDeployedCommit(await response.text());
  const headSha = git(["rev-parse", "HEAD"]);

  let resolved = false;
  let drift: ContentDrift = { added: [], modified: [], deleted: [] };
  let oldestUnpromotedAgeDays: number | null = null;

  if (deployedSha !== null) {
    try {
      git(["cat-file", "-e", `${deployedSha}^{commit}`]);
      resolved = true;
    } catch {
      resolved = false;
    }
  }

  if (deployedSha !== null && resolved) {
    drift = classifyContentDrift(
      git([
        "diff",
        "--name-status",
        "-M",
        `${deployedSha}..HEAD`,
        "--",
        DOCS_CONTENT_PATH,
      ]),
    );

    // Age comes from the oldest unpromoted commit that touched content, not from the
    // deployed commit's own date: a promote can be old while the content it is missing
    // is new, and the second is what a reader is waiting on.
    const oldest = git([
      "log",
      "--reverse",
      "--format=%cI",
      `${deployedSha}..HEAD`,
      "--",
      DOCS_CONTENT_PATH,
    ])
      .split("\n")
      .find((line) => line.trim().length > 0);
    if (oldest) {
      oldestUnpromotedAgeDays =
        (Date.now() - new Date(oldest).getTime()) / 86_400_000;
    }
  }

  const summary = summarizeDocsDrift({
    host,
    deployedSha,
    headSha,
    drift,
    oldestUnpromotedAgeDays,
    maxAgeDays,
    resolved,
  });

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          host,
          deployedSha,
          headSha,
          resolved,
          drift,
          oldestUnpromotedAgeDays,
          maxAgeDays,
          shouldFail: summary.shouldFail,
        },
        null,
        2,
      ),
    );
  } else {
    for (const line of summary.lines) {
      (summary.shouldFail ? console.error : console.log)(line);
    }
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Docs promote drift (${host})\n\n\`\`\`\n${summary.lines.join("\n")}\n\`\`\`\n`,
    );
  }

  process.exit(summary.shouldFail ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
