import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "path";
import { globSync } from "glob";
import { loadFixtureFile, validateFixtures } from "@copilotkit/aimock";
import type { ValidationResult } from "@copilotkit/aimock";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const fixtureFiles: string[] = [
  ...globSync("showcase/aimock/shared/*.json", {
    cwd: REPO_ROOT,
    absolute: true,
  }),
  ...globSync("showcase/aimock/d4/**/*.json", {
    cwd: REPO_ROOT,
    absolute: true,
  }),
  ...globSync("showcase/aimock/d6/**/*.json", {
    cwd: REPO_ROOT,
    absolute: true,
  }),
  ...globSync("examples/integrations/*/fixtures/*.json", {
    cwd: REPO_ROOT,
    absolute: true,
  }),
  ...globSync("scripts/doc-tests/fixtures/*.json", {
    cwd: REPO_ROOT,
    absolute: true,
  }),
];

// ---------------------------------------------------------------------------
// Raw fixture entry with context preserved (loadFixtureFile strips context,
// but we need it for collision detection).
// ---------------------------------------------------------------------------
interface RawFixtureEntry {
  match: {
    userMessage?: string;
    toolCallId?: string;
    toolName?: string;
    model?: string;
    hasToolResult?: boolean;
    turnIndex?: number;
    sequenceIndex?: number;
    endpoint?: string;
    context?: string;
    [key: string]: unknown;
  };
  response: unknown;
  [key: string]: unknown;
}

/**
 * Build a deterministic match key from the match object. The key encodes
 * every field that aimock uses for disambiguation so two fixtures with
 * identical keys would always collide at runtime.
 */
function matchKey(match: RawFixtureEntry["match"]): string {
  const parts: string[] = [];
  // Alphabetical, stable order
  if (match.endpoint != null) parts.push(`endpoint=${match.endpoint}`);
  if (match.hasToolResult != null)
    parts.push(`hasToolResult=${match.hasToolResult}`);
  if (match.model != null) parts.push(`model=${match.model}`);
  if (match.sequenceIndex != null)
    parts.push(`sequenceIndex=${match.sequenceIndex}`);
  if (match.toolCallId != null) parts.push(`toolCallId=${match.toolCallId}`);
  if (match.toolName != null) parts.push(`toolName=${match.toolName}`);
  if (match.turnIndex != null) parts.push(`turnIndex=${match.turnIndex}`);
  if (match.userMessage != null) parts.push(`userMessage=${match.userMessage}`);
  return parts.join("|");
}

/** Load raw fixture entries from a JSON file, preserving context. */
function loadRawFixtures(filePath: string): RawFixtureEntry[] {
  try {
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    return (data.fixtures ?? []) as RawFixtureEntry[];
  } catch {
    return [];
  }
}

interface TaggedFixture {
  entry: RawFixtureEntry;
  file: string; // relative path
  index: number; // index within file
}

/** Scope key: the context value, or "__shared__" for context-less fixtures. */
const SHARED_SCOPE = "__shared__";

function scopeOf(entry: RawFixtureEntry): string {
  return entry.match.context ?? SHARED_SCOPE;
}

// ---------------------------------------------------------------------------
// Deployment scopes — d4 and d6 fixtures never coexist at runtime, so
// collision detection must check within each deployment's load set:
//   d4 runtime loads: shared/ + d4/
//   d6 runtime loads: shared/ + d6/
// ---------------------------------------------------------------------------
const sharedFiles = globSync("showcase/aimock/shared/*.json", {
  cwd: REPO_ROOT,
  absolute: true,
});
const d4Files = globSync("showcase/aimock/d4/**/*.json", {
  cwd: REPO_ROOT,
  absolute: true,
});
const d6Files = globSync("showcase/aimock/d6/**/*.json", {
  cwd: REPO_ROOT,
  absolute: true,
});

function tagFiles(files: string[]): TaggedFixture[] {
  return files.flatMap((fp) => {
    const rel = path.relative(REPO_ROOT, fp);
    return loadRawFixtures(fp).map((entry, i) => ({
      entry,
      file: rel,
      index: i,
    }));
  });
}

const sharedTagged = tagFiles(sharedFiles);
const d4Tagged = tagFiles(d4Files);
const d6Tagged = tagFiles(d6Files);

/** Build a Map<contextScope, TaggedFixture[]> for a deployment's fixture set. */
function groupByContext(
  fixtures: TaggedFixture[],
): Map<string, TaggedFixture[]> {
  const map = new Map<string, TaggedFixture[]>();
  for (const t of fixtures) {
    const scope = scopeOf(t.entry);
    if (!map.has(scope)) map.set(scope, []);
    map.get(scope)!.push(t);
  }
  return map;
}

// Two deployment scopes: shared+d4 and shared+d6
const deploymentScopes: {
  name: string;
  byContext: Map<string, TaggedFixture[]>;
}[] = [
  { name: "d4", byContext: groupByContext([...sharedTagged, ...d4Tagged]) },
  { name: "d6", byContext: groupByContext([...sharedTagged, ...d6Tagged]) },
];

describe("aimock fixtures across repo", () => {
  it("discovers at least one fixture file", () => {
    expect(
      fixtureFiles.length,
      "fixture discovery returned 0 files — misconfigured glob or missing fixtures",
    ).toBeGreaterThan(0);
  });

  for (const filePath of fixtureFiles) {
    const relative = path.relative(REPO_ROOT, filePath);
    it(`${relative} loads and validates with zero errors`, () => {
      const fixtures = loadFixtureFile(filePath);

      // If loadFixtureFile returns [], the file itself is broken (unreadable,
      // invalid JSON, or missing "fixtures" array). Treat as fatal.
      expect(
        fixtures.length,
        `${relative} produced 0 fixtures — file is unreadable or malformed`,
      ).toBeGreaterThan(0);

      const results = validateFixtures(fixtures);
      const errors = results.filter(
        (r: ValidationResult) => r.severity === "error",
      );

      if (errors.length > 0) {
        const detail = errors
          .map((e: ValidationResult) => `  [${e.fixtureIndex}] ${e.message}`)
          .join("\n");
        throw new Error(
          `${relative} has ${errors.length} fixture validation error(s):\n${detail}`,
        );
      }

      expect(errors).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// Fixture collision detection
//
// Each test iterates over deployment scopes (d4, d6) independently because
// d4 and d6 fixtures never coexist at runtime.
// ---------------------------------------------------------------------------
describe("fixture collision detection", () => {
  it("no exact duplicate match keys within the same context scope", () => {
    const collisions: string[] = [];

    for (const { name: deploy, byContext } of deploymentScopes) {
      for (const [ctx, fixtures] of byContext) {
        const seen = new Map<string, TaggedFixture>();
        for (const t of fixtures) {
          const key = matchKey(t.entry.match);
          const prev = seen.get(key);
          if (prev) {
            collisions.push(
              `[${deploy}] context="${ctx}" key="${key}"\n` +
                `    first:  ${prev.file}[${prev.index}]\n` +
                `    second: ${t.file}[${t.index}]`,
            );
          } else {
            seen.set(key, t);
          }
        }
      }
    }

    if (collisions.length > 0) {
      throw new Error(
        `Found ${collisions.length} exact duplicate match key(s):\n\n${collisions.join("\n\n")}`,
      );
    }
  });

  it("no substring shadow collisions within the same context scope", () => {
    // A "substring shadow" is when fixture A's userMessage is a substring
    // of fixture B's userMessage, AND they share the same values for all
    // other differentiating fields (toolName, toolCallId, hasToolResult,
    // turnIndex, sequenceIndex, endpoint). In that case aimock's substring
    // matching would cause A to shadow B (or vice versa depending on load
    // order), leading to non-deterministic behavior.
    //
    // Known baseline: 126 pre-existing shadows across d4+d6 (tracked for
    // cleanup). This test fails if the count INCREASES, preventing new
    // shadows from being introduced.
    const KNOWN_SHADOW_CEILING = 126;

    const shadows: string[] = [];

    for (const { name: deploy, byContext } of deploymentScopes) {
      for (const [ctx, fixtures] of byContext) {
        // Only consider fixtures that have a userMessage
        const withMsg = fixtures.filter(
          (t) => typeof t.entry.match.userMessage === "string",
        );

        for (let i = 0; i < withMsg.length; i++) {
          for (let j = i + 1; j < withMsg.length; j++) {
            const a = withMsg[i];
            const b = withMsg[j];
            const msgA = a.entry.match.userMessage!;
            const msgB = b.entry.match.userMessage!;

            // Skip if messages are identical (caught by exact-duplicate test)
            if (msgA === msgB) continue;

            // Check substring relationship
            const aInB = msgB.includes(msgA);
            const bInA = msgA.includes(msgB);
            if (!aInB && !bInA) continue;

            // Check if other differentiating criteria are identical
            const diffFields = [
              "toolName",
              "toolCallId",
              "hasToolResult",
              "turnIndex",
              "sequenceIndex",
              "endpoint",
            ] as const;
            const sameOtherCriteria = diffFields.every(
              (f) => a.entry.match[f] === b.entry.match[f],
            );
            if (!sameOtherCriteria) continue;

            const shorter = aInB ? a : b;
            const longer = aInB ? b : a;
            shadows.push(
              `[${deploy}] context="${ctx}"\n` +
                `    shorter: "${shorter.entry.match.userMessage}" ` +
                `(${shorter.file}[${shorter.index}])\n` +
                `    longer:  "${longer.entry.match.userMessage}" ` +
                `(${longer.file}[${longer.index}])`,
            );
          }
        }
      }
    }

    // Ratchet: fail if new shadows are introduced; lower the ceiling as
    // pre-existing shadows are cleaned up.
    expect(
      shadows.length,
      `Substring shadow count (${shadows.length}) exceeds ceiling (${KNOWN_SHADOW_CEILING}).\n` +
        `New shadows:\n${shadows.slice(KNOWN_SHADOW_CEILING).join("\n\n")}`,
    ).toBeLessThanOrEqual(KNOWN_SHADOW_CEILING);
  });

  it("shared (no-context) fixtures have no exact userMessage collisions with scoped fixtures", () => {
    // Shared fixtures (no context field) match ANY context at runtime.
    // If a shared fixture has the same userMessage as a scoped fixture,
    // the match is ambiguous — load order determines which wins.
    const sharedWithMsg = sharedTagged.filter(
      (t) => typeof t.entry.match.userMessage === "string",
    );

    if (sharedWithMsg.length === 0) return; // nothing to check

    const collisions: string[] = [];

    for (const { name: deploy, byContext } of deploymentScopes) {
      for (const [ctx, fixtures] of byContext) {
        if (ctx === SHARED_SCOPE) continue;

        for (const s of sharedWithMsg) {
          for (const t of fixtures) {
            if (typeof t.entry.match.userMessage !== "string") continue;
            if (s.entry.match.userMessage !== t.entry.match.userMessage)
              continue;

            collisions.push(
              `[${deploy}] userMessage="${s.entry.match.userMessage}"\n` +
                `    shared: ${s.file}[${s.index}]\n` +
                `    scoped: ${t.file}[${t.index}] (context="${ctx}")`,
            );
          }
        }
      }
    }

    if (collisions.length > 0) {
      throw new Error(
        `Found ${collisions.length} shared-vs-scoped userMessage collision(s):\n\n${collisions.join("\n\n")}`,
      );
    }
  });
});
