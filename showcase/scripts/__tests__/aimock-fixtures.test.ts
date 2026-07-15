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
    // Known baseline: 230 duplicates across D6 feature files where different
    // demos share the same pill prompts and toolCallIds. Bumped from 11 → 230
    // when D6 per-integration fixtures were added — each integration's new
    // feature-type fixtures (gen-ui-declarative, multimodal, prebuilt-*,
    // tool-rendering-*-catchall, etc.) naturally share match keys with the
    // pre-existing demo fixtures (render-a2ui, agentic-chat, tool-rendering,
    // gen-ui-tool-based) for the same integration. At runtime these are
    // disambiguated by the active demo / probe path.
    //
    // Bumped 230 → 276 (+46) when the gen-ui-headless-complete.json alias was
    // added across all 18 slugs. The gen-ui-headless-complete probe references
    // a dedicated fixtureFile but drives the same 4 headless-complete pills
    // (weather/stock/highlight/revenue), so its 8 fixtures per slug share
    // match keys with the pre-existing headless-complete.json for that
    // context. These are disambiguated at runtime by the probe's fixtureFile
    // / demo route, exactly like the other cross-feature key overlaps above.
    //
    // Bumped 276 → 288 (+12) when the declarative-gen-ui demo moved to the
    // CopilotKitMiddleware auto-A2UI path across the 3 langgraph integrations
    // (langgraph-python / -typescript / -fastapi). The middleware's inner
    // forced tool is `render_a2ui`, so each integration's gen-ui-declarative.json
    // gained 4 `render_a2ui` fixtures (KPI dashboard / pie / bar / status) that
    // share match keys with the pre-existing render_a2ui entries in that
    // integration's render-a2ui.json (the a2ui_fixed demo). 4 pills × 3
    // integrations = 12. Disambiguated at runtime by the probe's fixtureFile /
    // demo route, like the other cross-feature overlaps above.
    //
    // Bumped 288 → 290 (+2) when the hitl / gen-ui-interrupt / threadid demos
    // were ported to google-adk (W3 parity). The new per-demo google-adk
    // fixtures reuse google-adk's standard prebuilt-probe pills ("hi from the
    // popup/sidebar test"), so they share match keys with the pre-existing
    // prebuilt-popup.json / prebuilt-sidebar.json entries for that context.
    // Disambiguated at runtime by the probe's fixtureFile / demo route, like
    // the other cross-feature overlaps above.
    //
    // Bumped 290 → 291 (+1) in #5427 when BIA tool-rendering.json's bare 'AAPL'
    // matchers were tightened to 'current price of AAPL' to stop shadowing
    // gen-ui-headless-complete.json's 'price of AAPL right now' headless pill.
    // The tightened matchers share keys with tool-rendering-custom-catchall.json's
    // pre-existing 'current price of AAPL' entries in the same BIA context (the
    // hasToolResult:false emitter pair and the hasToolResult:true narration pair).
    // Disambiguated at runtime by feature route (tool-rendering vs custom-catchall
    // fixtureFile) plus the catchall's distinct first prompt ('check Tokyo weather
    // forecast') that gates the multi-pill session before the AAPL pill fires.
    //
    // NOTE: the a2ui-recovery demos (langgraph python/fastapi/typescript +
    // strands python/typescript) deliberately use UNIQUE recovery prompts per
    // framework. Inner render_a2ui fixtures cannot be context-scoped (the in-graph
    // render sub-agent's model client does not forward x-aimock-context), and
    // aimock loads every framework's d6 dir into one process, so identical prompts
    // would let the first-loaded framework's fixture hijack another's render calls.
    // Unique prompts keep each framework's inner fixtures distinct → no new
    // shared-scope duplicates, so this ceiling stays at the pre-recovery baseline.
    //
    // Bumped 291 → 297 (+6) for the Claude SDK demo parity port after
    // de-duplicating avoidable no-context beautiful-chat fallbacks. The
    // remaining new overlaps are context-scoped cross-demo fixture aliases
    // (interrupt/gen-ui-interrupt, declarative/render_a2ui, and copied
    // LangGraph headless/feature-parity routes) that are disambiguated by
    // fixtureFile/demo route like the existing integration parity copies above.
    //
    // Bumped 297 → 301 (+4) after merging main into the Mastra Partner Refresh
    // branch: main added cross-demo fixture aliases (e.g. ag2
    // headless-complete/gen-ui-headless-complete + prebuilt-popup/agentic-chat
    // greeting reuse) of the same runtime-disambiguated-by-fixtureFile kind.
    // Verified the +4 are NOT in the mastra context (the refresh's new fixtures —
    // a2ui-recovery unique prompts, interrupt cells — introduce zero new exact
    // dupes); they are the merged main integrations' existing alias pattern.
    //
    // Bumped 301 → 303 (+2) by the native-interrupt resume-loop fix: the
    // gen-ui-interrupt + interrupt-headless suspend fixtures gained
    // `hasToolResult:false` so they stop re-matching once the resolved tool
    // result is present (letting the resume fall through to the toolCallId
    // confirmation fixture). That aligns them with the schedule_meeting suspend
    // fixtures hitl-in-chat.json already carried, so all three mastra cells now
    // share the same two match keys ("intro call with the sales team" +
    // "1:1 with Alice", each hasToolResult:false|toolName:schedule_meeting).
    // These are disambiguated at runtime by route/fixtureFile like every other
    // cross-demo alias above — one exact-key pair per pill × 2 pills = +2.
    const KNOWN_DUPLICATE_CEILING = 303;

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

    expect(
      collisions.length,
      `Exact duplicate count (${collisions.length}) exceeds ceiling (${KNOWN_DUPLICATE_CEILING}).\n` +
        `Entries beyond the ceiling (iteration order — NOT necessarily the newly introduced ones; diff against the baseline to find the real offenders):\n${collisions.slice(KNOWN_DUPLICATE_CEILING).join("\n\n")}`,
    ).toBeLessThanOrEqual(KNOWN_DUPLICATE_CEILING);
  });

  it("no substring shadow collisions within the same context scope", () => {
    // A "substring shadow" is when fixture A's userMessage is a substring
    // of fixture B's userMessage, AND they share the same values for all
    // other differentiating fields (toolName, toolCallId, hasToolResult,
    // turnIndex, sequenceIndex, endpoint). In that case aimock's substring
    // matching would cause A to shadow B (or vice versa depending on load
    // order), leading to non-deterministic behavior.
    //
    // Known baseline: 128 pre-existing shadows across d4+d6 (tracked for
    // cleanup). The D6 per-integration feature-type fixtures
    // (tool-rendering-*-catchall, agent-config, gen-ui-interrupt) create
    // expected substring overlaps with pre-existing fixtures in the same
    // context (e.g. "What's the current price of AAPL?" vs "AAPL" in
    // tool-rendering.json, or "tone:professional — ..." vs
    // "tone:professional" in chat-css.json). These are disambiguated at
    // runtime by other match fields (toolCallId, toolName, turnIndex).
    // This test fails if the count INCREASES, preventing new shadows
    // from being introduced. Ratchet down as shadows are cleaned up.
    // Bumped 123→128 in #5412: 5 new substring overlaps in d6/{ag2,cst}
    // gen-ui-declarative + cst/tool-rendering fixtures, runtime-disambiguated
    // by toolCallId chunk boundaries and load-order ordering of inner-call
    // mirrors before outer fixtures (see _meta._note in those files).
    // Bumped 128→134 in #5427: 6 new substring overlaps in
    // d6/built-in-agent/{tool-rendering, tool-rendering-reasoning-chain}
    // fixtures from the BIA 5-tool D6 port (weather/flight/stock/d20/
    // catchall pill variants), runtime-disambiguated by toolName +
    // toolCallId.
    //
    // Ratcheted 134→132 (-2) in #5427 follow-up: BIA tool-rendering.json's
    // bare 'AAPL' matchers were tightened to 'current price of AAPL' (no
    // longer a substring of gen-ui-headless-complete's 'price of AAPL right
    // now' pill), removing 2 pre-existing shadow pairs. The companion
    // sequenceIndex-gated emitter + narration-fallback pairs in
    // gen-ui-headless-complete.json do not introduce new shadows — the
    // narration fallbacks share the same userMessage prefix as the emitters
    // (which the shadow detector skips because identical strings are caught
    // by the exact-duplicate test, not the shadow test).
    // Bumped 132→137: +5 substring shadows from the strands-typescript D6 port
    // (its per-integration fixtures mirror the Python strands sibling —
    // calculator + tool-rendering pill variants), runtime-disambiguated by
    // toolCallId / toolName / turnIndex like the other per-integration copies.
    // Bumped 139→142 after this PR rebased against current main. The remaining
    // counted shadows are pre-existing D4/D6 baseline overlaps (for example
    // weather/AAPL/project-planning/calculator prompt variants), not Claude SDK
    // local fallback aliases. Browser-local Claude demos now get an AIMock
    // context header from server-side HttpAgent defaults instead of relying on
    // context-less prompt aliases.
    const KNOWN_SHADOW_CEILING = 142;

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
        `Entries beyond the ceiling (iteration order — NOT necessarily the newly introduced ones; diff against the baseline to find the real offenders):\n${shadows.slice(KNOWN_SHADOW_CEILING).join("\n\n")}`,
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
