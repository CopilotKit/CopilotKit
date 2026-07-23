#!/usr/bin/env tsx
/**
 * merge-recorded-fixtures.ts
 *
 * Reads raw aimock recordings (one fixture per file, as produced by the
 * context-aware recorder), groups them by integration (match.context) and
 * demo cell (_comment prefix), and writes organized fixture files into
 * d6/<integration>/<demo-cell>.json.
 *
 * Exported helpers (groupByContext, groupByDemoCell, mergeIntoFixtureFile)
 * are unit-testable; the main() CLI wires them together with filesystem IO.
 *
 * Usage:
 *   npx tsx showcase/scripts/merge-recorded-fixtures.ts \
 *     --input  showcase/aimock/d6-recorded/raw \
 *     --output showcase/aimock/d6
 */

import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Fixture {
  _comment?: string;
  match: {
    context?: string;
    _comment?: string;
    userMessage?: string;
    turnIndex?: number;
    hasToolResult?: boolean;
    toolCallId?: string;
    [key: string]: unknown;
  };
  response: {
    content?: string;
    reasoning?: string;
    toolCalls?: unknown[];
    [key: string]: unknown;
  };
}

export interface FixtureMeta {
  _comment: string;
  _recordedAt: string;
  _source: string;
}

export interface FixtureFile {
  _meta?: FixtureMeta;
  fixtures: Fixture[];
}

// ---------------------------------------------------------------------------
// Grouping helpers
// ---------------------------------------------------------------------------

/**
 * Groups an array of fixtures by their `match.context` field.
 * Fixtures without a context are placed under the key "__shared__".
 */
export function groupByContext(fixtures: Fixture[]): Map<string, Fixture[]> {
  const map = new Map<string, Fixture[]>();
  for (const fx of fixtures) {
    const key = fx.match.context ?? "__shared__";
    const list = map.get(key);
    if (list) {
      list.push(fx);
    } else {
      map.set(key, [fx]);
    }
  }
  return map;
}

/**
 * Groups fixtures by the first whitespace-delimited token of the `_comment`
 * field (on either the fixture itself or `match._comment`). This token is
 * conventionally the demo-cell slug, e.g. "agentic-chat turn 1" → key
 * "agentic-chat". Fixtures without a _comment are grouped under "__unknown__".
 */
export function groupByDemoCell(fixtures: Fixture[]): Map<string, Fixture[]> {
  const map = new Map<string, Fixture[]>();
  for (const fx of fixtures) {
    const comment = fx._comment ?? fx.match._comment ?? "";
    // First whitespace-delimited token is the demo-cell slug.
    const slug = comment.split(/\s+/)[0] || "__unknown__";
    const list = map.get(slug);
    if (list) {
      list.push(fx);
    } else {
      map.set(slug, [fx]);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Merge helper
// ---------------------------------------------------------------------------

/** Build a dedup key for a fixture based on its match criteria. */
function dedupKey(fx: Fixture): string {
  const parts = [
    fx.match.userMessage ?? "",
    String(fx.match.turnIndex ?? ""),
    String(fx.match.hasToolResult ?? ""),
    fx.match.toolCallId ?? "",
  ];
  return parts.join("|");
}

/**
 * Merges incoming fixtures into an existing FixtureFile (or creates a new one).
 * Deduplicates by userMessage + turnIndex + hasToolResult + toolCallId.
 * Incoming fixtures overwrite duplicates from the existing file.
 */
export function mergeIntoFixtureFile(
  existing: FixtureFile | null,
  incoming: Fixture[],
  meta: FixtureMeta,
): FixtureFile {
  const result: FixtureFile = {
    _meta: meta,
    fixtures: [],
  };

  // Index incoming by dedup key — incoming wins on collision.
  const incomingByKey = new Map<string, Fixture>();
  for (const fx of incoming) {
    incomingByKey.set(dedupKey(fx), fx);
  }

  // Carry forward existing fixtures that are NOT superseded by incoming.
  if (existing?.fixtures) {
    for (const fx of existing.fixtures) {
      const key = dedupKey(fx);
      if (!incomingByKey.has(key)) {
        result.fixtures.push(fx);
      }
    }
  }

  // Append all incoming fixtures.
  for (const fx of incoming) {
    result.fixtures.push(fx);
  }

  return result;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage(): never {
  console.error("Usage: merge-recorded-fixtures --input <dir> --output <dir>");
  process.exit(1);
}

function parseArgs(argv: string[]): { input: string; output: string } {
  let input = "";
  let output = "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--input" && argv[i + 1]) {
      input = argv[++i];
    } else if (argv[i] === "--output" && argv[i + 1]) {
      output = argv[++i];
    }
  }
  if (!input || !output) usage();
  return { input, output };
}

/**
 * Reads all .json files from the input directory, parses them as fixture
 * files, and returns a flat array of all fixtures found.
 */
function readInputFixtures(inputDir: string): Fixture[] {
  if (!fs.existsSync(inputDir)) {
    console.error(`Input directory does not exist: ${inputDir}`);
    process.exit(1);
  }
  const files = fs
    .readdirSync(inputDir)
    .filter((f) => f.endsWith(".json"))
    .sort();

  const all: Fixture[] = [];
  for (const file of files) {
    const raw = fs.readFileSync(path.join(inputDir, file), "utf-8");
    const parsed = JSON.parse(raw) as { fixtures?: Fixture[] } | Fixture;
    if (Array.isArray((parsed as { fixtures?: Fixture[] }).fixtures)) {
      for (const fx of (parsed as { fixtures: Fixture[] }).fixtures) {
        all.push(fx);
      }
    } else if ((parsed as Fixture).match) {
      // Single-fixture file (aimock recorder writes one fixture per file).
      all.push(parsed as Fixture);
    }
  }
  return all;
}

export function main(): void {
  const { input, output } = parseArgs(process.argv.slice(2));

  const allFixtures = readInputFixtures(input);
  if (allFixtures.length === 0) {
    console.log("No fixtures found in input directory.");
    return;
  }
  console.log(`Read ${allFixtures.length} fixture(s) from ${input}`);

  // Step 1: Group by context (integration).
  const byContext = groupByContext(allFixtures);

  let totalFiles = 0;

  for (const [context, contextFixtures] of byContext) {
    // Step 2: Within each context, group by demo cell.
    const byCell = groupByDemoCell(contextFixtures);

    for (const [cell, cellFixtures] of byCell) {
      // Determine output path: d6/<integration>/<demo-cell>.json
      const integration = context === "__shared__" ? "shared" : context;
      const outDir = path.join(output, integration);
      fs.mkdirSync(outDir, { recursive: true });

      const outPath = path.join(outDir, `${cell}.json`);

      // Load existing file if present (for merge).
      let existing: FixtureFile | null = null;
      if (fs.existsSync(outPath)) {
        const raw = fs.readFileSync(outPath, "utf-8");
        existing = JSON.parse(raw) as FixtureFile;
      }

      const meta: FixtureMeta = {
        _comment: `D6 fixtures for ${integration}/${cell}`,
        _recordedAt: new Date().toISOString(),
        _source: "merge-recorded-fixtures.ts",
      };

      const merged = mergeIntoFixtureFile(existing, cellFixtures, meta);

      fs.writeFileSync(outPath, JSON.stringify(merged, null, 2) + "\n");
      console.log(
        `  ${integration}/${cell}.json: ${merged.fixtures.length} fixture(s)`,
      );
      totalFiles++;
    }
  }

  console.log(`\nWrote ${totalFiles} fixture file(s) to ${output}`);
}

// Run CLI when invoked directly (not imported).
const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isDirectRun) {
  main();
}
