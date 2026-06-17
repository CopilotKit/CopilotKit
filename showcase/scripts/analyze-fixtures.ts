// showcase/scripts/analyze-fixtures.ts
// One-time migration tool: categorize existing monolith fixture files
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface FixtureMatch {
  provider?: string;
  model?: string;
  userMessage?: string;
  hasToolResult?: boolean;
  turnIndex?: number;
  toolCallId?: string;
  toolName?: string;
  context?: string;
}

interface Fixture {
  _comment?: string;
  match: FixtureMatch;
  response: unknown;
}

interface FixtureFile {
  _comment?: string;
  fixtures: Fixture[];
}

const AIMOCK_DIR = path.resolve(__dirname, "..", "aimock");

// Read the three monolith files
const d5All: FixtureFile = JSON.parse(
  readFileSync(path.join(AIMOCK_DIR, "d5-all.json"), "utf-8"),
);
const featureParity: FixtureFile = JSON.parse(
  readFileSync(path.join(AIMOCK_DIR, "feature-parity.json"), "utf-8"),
);
const smoke: FixtureFile = JSON.parse(
  readFileSync(path.join(AIMOCK_DIR, "smoke.json"), "utf-8"),
);

console.log(`d5-all.json: ${d5All.fixtures.length} fixtures`);
console.log(`feature-parity.json: ${featureParity.fixtures.length} fixtures`);
console.log(`smoke.json: ${smoke.fixtures.length} fixtures`);

// Find duplicates
const seen = new Map<string, { source: string; index: number }>();
let dupeCount = 0;
for (const [file, data] of [
  ["d5-all.json", d5All],
  ["feature-parity.json", featureParity],
] as const) {
  for (let i = 0; i < data.fixtures.length; i++) {
    const key = JSON.stringify(data.fixtures[i].match);
    const existing = seen.get(key);
    if (existing) {
      dupeCount++;
      console.log(
        `DUPE: ${file}[${i}] == ${existing.source}[${existing.index}] match=${key.slice(0, 80)}...`,
      );
    } else {
      seen.set(key, { source: file, index: i });
    }
  }
}
console.log(`\nTotal exact duplicates: ${dupeCount}`);

// Categorize by _comment field to identify demo cells
const byComment = new Map<string, Fixture[]>();
for (const f of [...d5All.fixtures, ...featureParity.fixtures]) {
  const comment = f._comment ?? "unknown";
  const list = byComment.get(comment) ?? [];
  list.push(f);
  byComment.set(comment, list);
}
console.log(`\nDistinct _comment groups: ${byComment.size}`);
for (const [comment, fixtures] of byComment) {
  console.log(`  ${comment}: ${fixtures.length} fixtures`);
}
