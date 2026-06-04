// showcase/scripts/split-feature-parity.ts
// One-time migration: split feature-parity.json into d4/ and d6/ files
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AIMOCK_DIR = path.resolve(__dirname, "..", "aimock");

interface Fixture {
  _comment?: string;
  match: Record<string, unknown>;
  response: unknown;
}

interface FixtureFile {
  fixtures: Fixture[];
}

const INTEGRATIONS = [
  "langgraph-python",
  "langgraph-typescript",
  "langgraph-fastapi",
  "google-adk",
  "mastra",
  "crewai-crews",
  "pydantic-ai",
  "claude-sdk-python",
  "claude-sdk-typescript",
  "agno",
  "ag2",
  "llamaindex",
  "strands",
  "langroid",
  "ms-agent-python",
  "ms-agent-dotnet",
  "spring-ai",
  "built-in-agent",
];

const fp: FixtureFile = JSON.parse(
  readFileSync(path.join(AIMOCK_DIR, "feature-parity.json"), "utf-8"),
);

// Also load d5-all.json to find and skip duplicates
const d5All: FixtureFile = JSON.parse(
  readFileSync(path.join(AIMOCK_DIR, "d5-all.json"), "utf-8"),
);
const d5MatchKeys = new Set<string>();
for (const f of d5All.fixtures) {
  d5MatchKeys.add(JSON.stringify(f.match));
}

// Categorize: fixtures with simple userMessage patterns (single-turn
// chat/tool smoke) go to d4/; multi-turn deep conversation fixtures
// go to d6/
const d4Fixtures: Fixture[] = [];
const d6Fixtures: Fixture[] = [];
let skippedDupes = 0;

for (const f of fp.fixtures) {
  // Skip fixtures that already exist in d5-all.json (they'll be in d6/)
  const matchKey = JSON.stringify(f.match);
  if (d5MatchKeys.has(matchKey)) {
    skippedDupes++;
    continue;
  }

  const comment = String(f._comment ?? "").toLowerCase();
  const turnIndex = f.match.turnIndex;

  // Simple heuristic: chat/tools smoke fixtures are single-turn (no
  // turnIndex or turnIndex=0), no multi-step conversation context.
  // Multi-turn fixtures have turnIndex > 0 or reference tool results.
  if (
    (turnIndex !== undefined && (turnIndex as number) > 0) ||
    comment.includes("multi-turn") ||
    comment.includes("conversation") ||
    comment.includes("pill")
  ) {
    d6Fixtures.push(f);
  } else {
    d4Fixtures.push(f);
  }
}

console.log(`Skipped ${skippedDupes} duplicates (already in d5-all.json / d6)`);
console.log(`D4 (chat/tools): ${d4Fixtures.length}`);
console.log(`D6 (deep): ${d6Fixtures.length}`);

// Write D4 fixtures per integration
for (const slug of INTEGRATIONS) {
  const d4Dir = path.join(AIMOCK_DIR, "d4", slug);
  mkdirSync(d4Dir, { recursive: true });

  // Chat fixtures (non-tool related)
  const chatFixtures = d4Fixtures
    .filter((f) => {
      const comment = String(f._comment ?? "").toLowerCase();
      return !comment.includes("tool");
    })
    .map((f) => ({
      ...(f._comment ? { _comment: f._comment } : {}),
      match: { ...f.match, context: slug },
      response: f.response,
    }));

  if (chatFixtures.length > 0) {
    writeFileSync(
      path.join(d4Dir, "chat.json"),
      JSON.stringify(
        {
          _meta: {
            description: `D4 chat fixtures for ${slug}`,
            sourceFile: "feature-parity.json",
            created: new Date().toISOString().split("T")[0],
          },
          fixtures: chatFixtures,
        },
        null,
        2,
      ),
    );
  }

  // Tools fixtures
  const toolsFixtures = d4Fixtures
    .filter((f) => {
      const comment = String(f._comment ?? "").toLowerCase();
      return comment.includes("tool");
    })
    .map((f) => ({
      ...(f._comment ? { _comment: f._comment } : {}),
      match: { ...f.match, context: slug },
      response: f.response,
    }));

  if (toolsFixtures.length > 0) {
    writeFileSync(
      path.join(d4Dir, "tools.json"),
      JSON.stringify(
        {
          _meta: {
            description: `D4 tools fixtures for ${slug}`,
            sourceFile: "feature-parity.json",
            created: new Date().toISOString().split("T")[0],
          },
          fixtures: toolsFixtures,
        },
        null,
        2,
      ),
    );
  }

  console.log(`Wrote d4/${slug}/`);
}

// D6 deep conversation fixtures from feature-parity -- merge into
// existing d6/<integration>/ files or create new ones
for (const slug of INTEGRATIONS) {
  const d6Dir = path.join(AIMOCK_DIR, "d6", slug);
  mkdirSync(d6Dir, { recursive: true });

  // Group by inferred feature type from _comment
  const contextFixtures = d6Fixtures.map((f) => ({
    ...(f._comment ? { _comment: f._comment } : {}),
    match: { ...f.match, context: slug },
    response: f.response,
  }));

  if (contextFixtures.length > 0) {
    // Append to a catch-all file for now; manual review will
    // redistribute to per-feature files
    writeFileSync(
      path.join(d6Dir, "_from-feature-parity.json"),
      JSON.stringify(
        {
          _meta: {
            description: `Deep fixtures from feature-parity.json for ${slug} (needs manual redistribution)`,
            created: new Date().toISOString().split("T")[0],
          },
          fixtures: contextFixtures,
        },
        null,
        2,
      ),
    );
  }
}

console.log(
  `\nDone. D4: ${d4Fixtures.length} per integration, D6 overflow: ${d6Fixtures.length} per integration.`,
);
