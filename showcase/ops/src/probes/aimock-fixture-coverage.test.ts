import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Aimock fixture coverage for the langgraph-python E2E suite.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS TEST EXISTS
 * ---------------------------------------------------------------------------
 * The langgraph-python showcase specs under
 * `showcase/packages/langgraph-python/tests/e2e/*.spec.ts` run against one of
 * two agent backends:
 *
 *   1. Railway deployment with a real LLM — prompts can be freeform; the
 *      agent's response is judged by the spec's assertions only.
 *   2. The aimock sidecar (`showcase/aimock/feature-parity.json`) — every
 *      user message must match a fixture's `match.userMessage` substring or
 *      the agent will either fall through to the real LLM (proxy mode) OR
 *      fail deterministically (strict mode in CI).
 *
 * When the aimock backend is active, a spec whose prompt has no matching
 * fixture silently drifts — the user message goes through the proxy to the
 * real LLM (costing money and producing non-deterministic assertions), or
 * the assertion fails with a cryptic "no fixture matched" error. This test
 * enforces that EVERY prompt issued from these specs has a matching fixture
 * before any run of the aimock-backed suite, so operators catch drift at
 * PR time rather than mid-CI.
 *
 * ---------------------------------------------------------------------------
 * EXTRACTION APPROACH
 * ---------------------------------------------------------------------------
 * Pure regex over spec sources. The specs follow a small set of Playwright
 * idioms for the chat input, so a fragile-but-explicit regex catches them
 * without pulling in a TypeScript AST parser:
 *
 *   - `<var>.fill("prompt")` where <var> is one of `input`, `textarea`,
 *     `chatInput`. These variables are bound to the chat input locator by
 *     convention across every spec (see the `.find the one true input` grep
 *     in the driver directory). Other .fill() sites use distinct variable
 *     names (`editorTextarea`, `ctx-name`) and are excluded because they
 *     target non-chat UI (document editor, context-field, etc.).
 *   - `page.getByPlaceholder("Type a message").fill("prompt")` and the
 *     `"Type a message..."` variant used by headless specs.
 *   - `filter({ hasText: "Pill Title" }).click()` on `copilot-suggestion`
 *     locators — the suggestion-pill -> user-message mapping is resolved
 *     via a hard-coded table keyed by spec file (see PILL_MESSAGES below).
 *
 * Specs that use pills with a different mechanism (beautiful-chat's
 * `getByRole("button", { name: "Pie Chart (Controlled Generative UI)" })`)
 * resolve through the same hard-coded table.
 *
 * Multi-line `.fill(` calls (opening paren on one line, string on the next)
 * are handled by collapsing whitespace before matching.
 *
 * ---------------------------------------------------------------------------
 * FIXTURE COVERAGE RULE
 * ---------------------------------------------------------------------------
 * A prompt is considered "covered" if:
 *   - It is shorter than MIN_PROMPT_LEN (trivial greeting like "hi"/"hello"
 *     — the feature-parity.json already carries both "hi" and "hello"
 *     fixtures, so this predicate acts as a safety-net only).
 *   - At least one fixture's `match.userMessage` value is a substring of
 *     the prompt (aimock's actual match semantics — see
 *     `showcase/aimock/README.md#fixture-match-semantics`).
 *
 * Prompts that fail both predicates fail the test with a listing that
 * identifies the spec file, the line, and the prompt text, so an operator
 * can either add a new fixture to `feature-parity.json` OR demonstrate the
 * prompt is LLM-text-dependent and legitimately cannot be mocked.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(__dirname, "../../../..");
const SPEC_DIR = path.resolve(
  WORKSPACE_ROOT,
  "showcase/packages/langgraph-python/tests/e2e",
);
const FIXTURE_FILE = path.resolve(
  WORKSPACE_ROOT,
  "showcase/aimock/feature-parity.json",
);

/**
 * Threshold below which a prompt is trivially short enough that its
 * coverage is treated as implicit. In practice "hi"/"hello" already live
 * in feature-parity.json so any prompt that's this short AND passes the
 * substring check is already covered; this exists as an exemption for the
 * rare future case where a spec types a single-word prompt that isn't
 * plausibly mockable (e.g. a placeholder typo that the operator will fix
 * in the spec itself, not in fixtures).
 */
const MIN_PROMPT_LEN = 12;

/**
 * Hard-coded mapping from spec-file -> suggestion-pill -> actual user
 * message sent. This table mirrors the `useConfigureSuggestions` hook in
 * `showcase/packages/langgraph-python/src/app/demos/beautiful-chat/hooks/
 * use-example-suggestions.tsx` and the `suggestions` prop on the chat-slots
 * and prebuilt-sidebar/popup demos. Hand-maintained — if a spec adds a new
 * pill click, its message must be added here.
 *
 * Keys: spec file basename (without `.spec.ts`).
 * Values: array of `{ pillText, userMessage }` — pillText is the substring
 * used in the spec's filter/getByRole matcher.
 */
const PILL_MESSAGES: Record<
  string,
  { pillText: string; userMessage: string }[]
> = {
  "beautiful-chat": [
    {
      pillText: "Toggle Theme (Frontend Tools)",
      userMessage: "Toggle the app theme using the toggleTheme tool.",
    },
    {
      pillText: "Pie Chart (Controlled Generative UI)",
      userMessage:
        "Show me a pie chart of our revenue distribution by category. Use the query_data tool to fetch the data first, then render it with the pieChart component.",
    },
    {
      pillText: "Bar Chart (Controlled Generative UI)",
      userMessage:
        "Show me a bar chart of our expenses by category. Use the query_data tool to fetch the data first, then render it with the barChart component.",
    },
  ],
  "chat-slots": [
    {
      pillText: "Tell me a joke",
      userMessage: "Tell me a short joke.",
    },
  ],
};

/**
 * Specs whose prompts are intentionally LLM-text-dependent and legitimately
 * cannot be mocked deterministically. Add a justification comment next to
 * each entry. This list is inspected in the failure message so reviewers
 * can audit exemptions.
 */
const EXEMPT_PROMPTS: { spec: string; prompt: string; reason: string }[] = [];

interface Fixture {
  match: { userMessage: string };
  response: unknown;
}

interface FeatureParityFile {
  fixtures: Fixture[];
}

interface ExtractedPrompt {
  spec: string;
  line: number;
  prompt: string;
  source: "fill" | "pill";
}

/**
 * Collapse `.fill(<newline><indent>"..."<newline><indent>)` to
 * `.fill("...")` on a single line so a line-level regex can match both
 * shapes uniformly.
 */
function collapseMultilineFill(src: string): string {
  return src.replace(/\.fill\(\s*\n\s*/g, ".fill(");
}

/**
 * Extract chat prompts from a single spec source. Returns a list of
 * `{line, prompt, source}` tuples (line numbers are 1-indexed and refer
 * to the ORIGINAL, un-collapsed source for operator-friendly reporting).
 */
function extractPrompts(specName: string, rawSrc: string): ExtractedPrompt[] {
  const out: ExtractedPrompt[] = [];
  const collapsed = collapseMultilineFill(rawSrc);
  // Build a line index against the ORIGINAL source. We search the collapsed
  // text but report positions from the original by re-finding each match.
  const lines = rawSrc.split("\n");

  // 1) <var>.fill("...") where var is a chat-input binding.
  //    Matches `input.fill("...")`, `textarea.fill("...")`, `chatInput.fill("...")`.
  const varFillRe =
    /\b(?:input|textarea|chatInput)\.fill\(\s*"((?:[^"\\]|\\.)*)"\s*\)/g;
  for (const m of collapsed.matchAll(varFillRe)) {
    const prompt = JSON.parse(`"${m[1]}"`);
    out.push({
      spec: specName,
      line: findLineForPrompt(lines, prompt),
      prompt,
      source: "fill",
    });
  }

  // 2) page.getByPlaceholder("Type a message[...]").fill("...") — inline form.
  const placeholderFillRe =
    /getByPlaceholder\(\s*"Type a message[^"]*"\s*\)\.fill\(\s*"((?:[^"\\]|\\.)*)"\s*\)/g;
  for (const m of collapsed.matchAll(placeholderFillRe)) {
    const prompt = JSON.parse(`"${m[1]}"`);
    out.push({
      spec: specName,
      line: findLineForPrompt(lines, prompt),
      prompt,
      source: "fill",
    });
  }

  // 3) Suggestion-pill clicks — resolve via PILL_MESSAGES table.
  const pillEntries = PILL_MESSAGES[specName] ?? [];
  for (const entry of pillEntries) {
    // Only include if the spec actually references the pill text.
    if (rawSrc.includes(entry.pillText)) {
      out.push({
        spec: specName,
        line: findLineForSubstring(lines, entry.pillText),
        prompt: entry.userMessage,
        source: "pill",
      });
    }
  }

  return out;
}

function findLineForPrompt(lines: string[], prompt: string): number {
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].includes(prompt)) return i + 1;
  }
  return 0;
}

function findLineForSubstring(lines: string[], needle: string): number {
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].includes(needle)) return i + 1;
  }
  return 0;
}

/**
 * True iff the prompt is covered by at least one fixture. A fixture's
 * userMessage is a substring match against the outgoing user message —
 * this mirrors aimock's runtime matcher (see feature-parity README).
 *
 * Case-insensitive to tolerate the "Hello" vs "hello" drift that
 * feature-parity.json already maintains duplicates for.
 */
function isCovered(prompt: string, fixtures: Fixture[]): boolean {
  if (prompt.length < MIN_PROMPT_LEN) {
    // Short prompts are exempt — "hi"/"hello" fixtures exist but we don't
    // want to brittle on exact casing.
    return true;
  }
  const lower = prompt.toLowerCase();
  for (const f of fixtures) {
    const matchLower = f.match.userMessage.toLowerCase();
    if (lower.includes(matchLower)) return true;
  }
  return false;
}

describe("aimock feature-parity fixture coverage for langgraph-python E2E specs", () => {
  it("every extracted chat prompt has a matching fixture", async () => {
    // Load fixtures.
    const fixtureRaw = await fs.readFile(FIXTURE_FILE, "utf8");
    const { fixtures } = JSON.parse(fixtureRaw) as FeatureParityFile;
    expect(Array.isArray(fixtures)).toBe(true);
    expect(fixtures.length).toBeGreaterThan(0);

    // Walk every .spec.ts under the e2e dir.
    const entries = await fs.readdir(SPEC_DIR);
    const specFiles = entries.filter((e) => e.endsWith(".spec.ts"));
    expect(specFiles.length).toBeGreaterThan(0);

    const allPrompts: ExtractedPrompt[] = [];
    for (const file of specFiles) {
      const src = await fs.readFile(path.join(SPEC_DIR, file), "utf8");
      const specName = file.replace(/\.spec\.ts$/, "");
      allPrompts.push(...extractPrompts(specName, src));
    }

    // Partition into covered / exempt / uncovered.
    const exemptSet = new Set(
      EXEMPT_PROMPTS.map((e) => `${e.spec}::${e.prompt}`),
    );
    const uncovered: ExtractedPrompt[] = [];
    for (const p of allPrompts) {
      if (exemptSet.has(`${p.spec}::${p.prompt}`)) continue;
      if (isCovered(p.prompt, fixtures)) continue;
      uncovered.push(p);
    }

    if (uncovered.length > 0) {
      const listing = uncovered
        .map(
          (u) => `  - ${u.spec}.spec.ts:${u.line} [${u.source}] "${u.prompt}"`,
        )
        .join("\n");
      throw new Error(
        `Found ${uncovered.length} langgraph-python spec prompt(s) without matching aimock fixtures.\n` +
          `Add a fixture entry (match.userMessage substring + deterministic response) to\n` +
          `showcase/aimock/feature-parity.json for each:\n\n${listing}\n\n` +
          `Total prompts scanned: ${allPrompts.length}. Specs scanned: ${specFiles.length}.`,
      );
    }

    // Assert we actually extracted a meaningful number — a silent regex
    // regression that extracts zero prompts would otherwise pass this test
    // trivially. Floor chosen from the current count (roughly 50+) with
    // margin for future pruning.
    expect(allPrompts.length).toBeGreaterThanOrEqual(30);
  });
});
