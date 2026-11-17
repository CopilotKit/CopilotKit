import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load as loadYaml } from "js-yaml";
import { z } from "zod";

/**
 * Aimock fixture coverage for the shared E2E suite, run for langgraph-python.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS TEST EXISTS
 * ---------------------------------------------------------------------------
 * The shared showcase specs under `showcase/frontends/nextjs/tests/e2e/` run
 * against the showcase app for one integration at a time. When they run for
 * langgraph-python, its agent talks to one of two LLM backends:
 *
 *   1. A real LLM. Prompts can be freeform. Only the spec's assertions judge
 *      the response.
 *   2. The aimock sidecar (the fixture folders in FIXTURE_DIRS). Every user
 *      message must match a fixture's `match.userMessage` substring. If none
 *      matches, the message goes through the proxy to the real LLM (proxy
 *      mode) or fails deterministically (strict mode in CI).
 *
 * When the aimock backend is active, a spec whose prompt has no matching
 * fixture silently drifts. The user message goes through the proxy to the
 * real LLM (costing money and producing non-deterministic assertions), or
 * the assertion fails with a cryptic "no fixture matched" error. This test
 * enforces that EVERY prompt these specs send for langgraph-python has a
 * matching fixture, so operators catch drift at PR time rather than mid-CI.
 *
 * ---------------------------------------------------------------------------
 * WHICH SPECS
 * ---------------------------------------------------------------------------
 * A spec runs for langgraph-python when langgraph-python serves its demo (see
 * `servedDemoIds`). A spec names its demo in `describeDemo("<id>", ...)`. A
 * spec without `describeDemo` runs for every integration, so it is checked
 * too.
 *
 * ---------------------------------------------------------------------------
 * EXTRACTION APPROACH
 * ---------------------------------------------------------------------------
 * Pure regex over spec sources. The specs follow a small set of Playwright
 * idioms for the chat input, so a fragile-but-explicit regex catches them
 * without pulling in a TypeScript AST parser:
 *
 *   - `<var>.fill("prompt")` where <var> is one of `input`, `textarea`,
 *     `chatInput`. Specs bind these names to the chat input by convention.
 *     Other `.fill()` receivers (`editorTextarea`, `getByTestId("ctx-name")`)
 *     target non-chat UI (document editor, context field, etc.) and are
 *     excluded.
 *   - `page.getByPlaceholder("Type a message").fill("prompt")`, also with
 *     `.fill` on its own line, and the `"Type a message..."` variant used by
 *     headless specs.
 *   - Either form with the prompt on its own line and a trailing comma.
 *   - `send(page, "prompt")`, where `send` is any module-level helper of the
 *     spec that types its string parameter into the chat input with one of
 *     the forms above.
 *   - Suggestion-pill clicks. The demo page sets the message a pill sends,
 *     so the hard-coded PILL_MESSAGES table below maps pill titles to
 *     messages.
 *
 * Prompts inside a `test.skip("title", ...)` or `test.fixme("title", ...)`
 * declaration are left out, because Playwright never runs those tests.
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
 * can either add a new fixture to one of FIXTURE_DIRS OR demonstrate the
 * prompt is LLM-text-dependent and legitimately cannot be mocked.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(__dirname, "../../../..");
const SPEC_DIR = path.resolve(
  WORKSPACE_ROOT,
  "showcase/frontends/nextjs/tests/e2e",
);

/**
 * The committed files that say which demos langgraph-python serves in the
 * showcase app. The app's `src/data/` copies are generated, so they are not
 * read here.
 */
const MANIFEST_PATH = path.resolve(
  WORKSPACE_ROOT,
  "showcase/integrations/langgraph-python/manifest.yaml",
);
const EXTRA_DEMOS_PATH = path.resolve(
  WORKSPACE_ROOT,
  "showcase/frontends/nextjs/src/integrations/langgraph-python/extra-demos.json",
);

/**
 * After the D4/D6 reorg the monolithic `feature-parity.json` was split into
 * per-integration files under `showcase/aimock/{d4,d6}/<integration>/*.json`
 * plus a depth-agnostic `showcase/aimock/shared/*.json` bucket. For the
 * langgraph-python coverage check we union every fixture from:
 *   - showcase/aimock/d4/langgraph-python/*.json
 *   - showcase/aimock/d6/langgraph-python/*.json
 *   - showcase/aimock/shared/*.json (no-context, matches any integration)
 * and run the same substring-coverage rule across the union.
 */
const FIXTURE_DIRS = [
  path.resolve(WORKSPACE_ROOT, "showcase/aimock/d4/langgraph-python"),
  path.resolve(WORKSPACE_ROOT, "showcase/aimock/d6/langgraph-python"),
  path.resolve(WORKSPACE_ROOT, "showcase/aimock/shared"),
];

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
 * Hard-coded mapping from demo id -> suggestion pill -> the user message the
 * pill sends. This table mirrors the demo pages under
 * `showcase/frontends/nextjs/src/app/demos/[integration]/`:
 * `beautiful-chat/hooks/use-example-suggestions.tsx` and
 * `chat-slots/suggestions.ts`. Hand-maintained: if a spec clicks a new pill,
 * add its message here.
 *
 * Keys: the demo id of the spec's `describeDemo` call. Every spec of a demo
 * (`beautiful-chat.spec.ts`, `beautiful-chat-pie-chart.spec.ts`, ...) reads
 * the same entry.
 * Values: array of `{ pillText, userMessage }`. pillText is the pill title
 * that the spec passes to its click helper or `getByRole` matcher.
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
    {
      pillText: "Schedule Meeting (Human In The Loop)",
      userMessage:
        "I'd like to schedule a 30-minute meeting to learn about CopilotKit. Please use the scheduleTime tool to let me pick a time.",
    },
    {
      pillText: "Search Flights (A2UI Fixed Schema)",
      userMessage: "Find flights from SFO to JFK for next Tuesday.",
    },
    {
      pillText: "Sales Dashboard (A2UI Dynamic)",
      userMessage:
        "First use the query_data tool to fetch the financial sales data, then using A2UI, show me a sales dashboard with total revenue, new customers, and conversion rate metrics. Include a pie chart of revenue by category and a bar chart of monthly sales.",
    },
    {
      pillText: "Excalidraw Diagram (MCP App)",
      userMessage:
        "Use Excalidraw to create a simple network diagram showing a router connected to two switches, each connected to two computers.",
    },
    {
      pillText: "Calculator App (Open Generative UI)",
      userMessage:
        "Using the generateSandboxedUi tool, build a modern calculator with standard buttons plus labeled metric shortcut buttons that insert their values into the display when clicked. Use sample company data.",
    },
    {
      pillText: "Task Manager (Shared State)",
      userMessage:
        "Enable app mode and add three todos about learning CopilotKit: one about reading the docs, one about building a prototype, and one about exploring agent state.",
    },
  ],
  "chat-slots": [
    {
      pillText: "Tell me a joke",
      userMessage: "Tell me a short joke.",
    },
    {
      pillText: "Write a sonnet",
      userMessage: "Write a short sonnet about AI.",
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
  match: { userMessage?: string };
  response: unknown;
}

interface FeatureParityFile {
  fixtures: Fixture[];
}

interface ExtractedPrompt {
  spec: string;
  line: number;
  prompt: string;
  source: "fill" | "helper" | "pill";
}

// The fields of a manifest.yaml that say which demo pages an integration has.
const ManifestDemosSchema = z.object({
  demos: z.array(z.object({ route: z.string().optional() })),
});

const ExtraDemoIdsSchema = z.array(z.string());

const DEMO_ROUTE_PREFIX = "/demos/";

/**
 * The ids of the demos an integration serves in the showcase app: the route
 * of each manifest demo without its `/demos/` prefix, plus the ids in the
 * app's `src/integrations/<slug>/extra-demos.json`. The app's registry
 * (`src/lib/registry.ts`) uses the same rule. An entry without a route, such
 * as a CLI command, has no page.
 */
function servedDemoIds(manifestYaml: string, extraDemosJson: string) {
  const { demos } = ManifestDemosSchema.parse(loadYaml(manifestYaml));
  const routed = demos.flatMap(({ route }) =>
    route?.startsWith(DEMO_ROUTE_PREFIX)
      ? [route.slice(DEMO_ROUTE_PREFIX.length)]
      : [],
  );
  const extras = ExtraDemoIdsSchema.parse(JSON.parse(extraDemosJson));
  return new Set([...routed, ...extras]);
}

/**
 * The demos a spec runs on: the first argument of each `describeDemo(...)`
 * call, as a string literal or as the name of a `const` in the same file
 * that holds one. Empty when the spec has no `describeDemo` call, because
 * then it runs for every integration.
 */
function specDemoIds(specName: string, src: string) {
  const calls = src.matchAll(
    /\bdescribeDemo\(\s*(?:"([^"]+)"|([A-Za-z_]\w*))/g,
  );
  return [...calls].map(([, literal, constName]) => {
    if (literal !== undefined) return literal;
    const declaration = src.match(
      new RegExp(String.raw`\bconst\s+${constName}\s*=\s*"([^"]+)"`),
    );
    if (declaration === null) {
      throw new Error(
        `${specName}.spec.ts: describeDemo takes ${constName}, which is not a const string in the same file`,
      );
    }
    return declaration[1];
  });
}

/** A double-quoted string literal. Group 1 is its body, still escaped. */
const STRING_LITERAL = String.raw`"((?:[^"\\]|\\.)*)"`;

/**
 * A `.fill(` call on the chat input, up to its first argument. The receiver
 * is a variable bound to the chat input, or the input found by its
 * placeholder.
 */
const CHAT_INPUT_FILL = String.raw`(?:\b(?:input|textarea|chatInput)|getByPlaceholder\(\s*"Type a message[^"]*"\s*\))\s*\.fill\(\s*`;

/** The end of a call after its last argument: a trailing comma, then `)`. */
const CALL_END = String.raw`\s*,?\s*\)`;

const CHAT_INPUT_FILL_RE = new RegExp(
  CHAT_INPUT_FILL + STRING_LITERAL + CALL_END,
  "g",
);

/**
 * A module-level helper of a spec, `async function <name>(page: Page,
 * <param>: string) { ... }`, up to the `}` that closes it at the start of a
 * line. Group 1 is the name, group 2 the parameter, group 3 the body.
 */
const PAGE_TEXT_HELPER_RE =
  /^(?:async\s+)?function\s+(\w+)\(\s*page:\s*Page,\s*(\w+):\s*string,?\s*\)[^{]*\{([\s\S]*?)^\}/gm;

/**
 * A test or hook declaration. Group 1 is the modifier of a test with a
 * string title: `test("title", ...)`, `test.only`, `test.skip` or
 * `test.fixme`. A conditional `test.skip(condition, reason)` inside a test
 * has no string title, so it does not match.
 */
const TEST_DECLARATION_RE =
  /\btest(?:\.(only|skip|fixme))?\(\s*["'`]|\btest\.(?:before|after)(?:Each|All)\(/g;

/**
 * True when the code at `offset` belongs to a `test.skip("title", ...)` or
 * `test.fixme("title", ...)` declaration: the last test or hook declared
 * before `offset` is one of those. Playwright never runs them, so their
 * prompts are never sent.
 */
function isInSkippedTest(src: string, offset: number) {
  const declarations = [...src.slice(0, offset).matchAll(TEST_DECLARATION_RE)];
  const modifier = declarations.at(-1)?.[1];
  return modifier === "skip" || modifier === "fixme";
}

/** The offset of the first mention of `text` outside a skipped test, or -1. */
function firstRunOffset(src: string, text: string) {
  let offset = src.indexOf(text);
  while (offset !== -1 && isInSkippedTest(src, offset)) {
    offset = src.indexOf(text, offset + 1);
  }
  return offset;
}

/** The 1-based line of a character offset in a source. */
function lineAt(src: string, offset: number) {
  return src.slice(0, offset).split("\n").length;
}

/** The text of a string literal body, with its escapes resolved. */
function parseStringBody(body: string): string {
  return JSON.parse(`"${body}"`);
}

/**
 * Extract chat prompts from a single spec source. Line numbers are 1-based
 * and point at the call that sends the prompt, or at the pill title.
 */
function extractPrompts(
  specName: string,
  src: string,
  demoIds: string[],
): ExtractedPrompt[] {
  const out: ExtractedPrompt[] = [];

  // 1) A prompt typed straight into the chat input.
  for (const m of src.matchAll(CHAT_INPUT_FILL_RE)) {
    if (isInSkippedTest(src, m.index)) continue;
    out.push({
      spec: specName,
      line: lineAt(src, m.index),
      prompt: parseStringBody(m[1]),
      source: "fill",
    });
  }

  // 2) A prompt passed to a helper that types its parameter into the chat
  //    input, such as `send(page, "prompt")`.
  for (const [, name, param, body] of src.matchAll(PAGE_TEXT_HELPER_RE)) {
    const typesParam = new RegExp(CHAT_INPUT_FILL + param + CALL_END).test(
      body,
    );
    if (!typesParam) continue;
    const callRe = new RegExp(
      String.raw`\b${name}\(\s*page\s*,\s*${STRING_LITERAL}`,
      "g",
    );
    for (const m of src.matchAll(callRe)) {
      if (isInSkippedTest(src, m.index)) continue;
      out.push({
        spec: specName,
        line: lineAt(src, m.index),
        prompt: parseStringBody(m[1]),
        source: "helper",
      });
    }
  }

  // 3) Suggestion-pill clicks, resolved through PILL_MESSAGES by demo. Only
  //    include a pill if the spec actually references its title.
  for (const demoId of demoIds) {
    for (const entry of PILL_MESSAGES[demoId] ?? []) {
      const offset = firstRunOffset(src, entry.pillText);
      if (offset === -1) continue;
      out.push({
        spec: specName,
        line: lineAt(src, offset),
        prompt: entry.userMessage,
        source: "pill",
      });
    }
  }

  return out;
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
    if (!f.match.userMessage) continue;
    const matchLower = f.match.userMessage.toLowerCase();
    if (lower.includes(matchLower)) return true;
  }
  return false;
}

/** The message of a caught value. */
function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Load and union all fixtures from the per-integration + shared dirs.
 * Each file is expected to be `{fixtures: [...]}` (the same shape the old
 * monolithic feature-parity.json used).
 *
 * Missing fixture DIRECTORIES are a hard error (the reorg layout is
 * load-bearing). Files present but lacking a `fixtures` array are ALSO a
 * hard error — fail loud against schema drift rather than silently skipping.
 * Malformed JSON is rethrown with the offending file path so operators can
 * identify the source file immediately.
 */
export async function loadAllFixtures(dirs: string[]): Promise<Fixture[]> {
  const out: Fixture[] = [];
  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch (err) {
      // Missing dir is a hard error — the reorg layout is load-bearing.
      throw new Error(
        `aimock fixture dir not found: ${dir} (${errorMessage(err)})`,
        { cause: err },
      );
    }
    const jsonFiles = entries.filter((e) => e.endsWith(".json"));
    for (const file of jsonFiles) {
      const fullPath = path.join(dir, file);
      let parsed: Partial<FeatureParityFile>;
      try {
        const raw = await fs.readFile(fullPath, "utf8");
        parsed = JSON.parse(raw);
      } catch (err) {
        throw new Error(
          `failed to parse fixture file ${fullPath}: ${errorMessage(err)}`,
          { cause: err },
        );
      }
      if (!parsed || !Array.isArray(parsed.fixtures)) {
        // Schema drift is a hard error — every fixture file MUST carry a
        // `fixtures` array. Matches the "missing dir is a hard error"
        // stance above.
        throw new Error(`fixture file missing 'fixtures' array: ${fullPath}`);
      }
      out.push(...parsed.fixtures);
    }
  }
  return out;
}

describe("aimock fixture coverage for the shared E2E specs, run for langgraph-python", () => {
  it("every extracted chat prompt has a matching fixture", async () => {
    // Load fixtures from the D4/D6 per-integration dirs + shared bucket.
    const fixtures = await loadAllFixtures(FIXTURE_DIRS);
    expect(fixtures.length).toBeGreaterThan(0);

    const served = servedDemoIds(
      await fs.readFile(MANIFEST_PATH, "utf8"),
      await fs.readFile(EXTRA_DEMOS_PATH, "utf8"),
    );

    // Walk every .spec.ts of the shared suite that runs for langgraph-python.
    const entries = await fs.readdir(SPEC_DIR);
    const specFiles = entries.filter((e) => e.endsWith(".spec.ts"));
    const allPrompts: ExtractedPrompt[] = [];
    let scannedSpecs = 0;
    for (const file of specFiles) {
      const src = await fs.readFile(path.join(SPEC_DIR, file), "utf8");
      const specName = file.replace(/\.spec\.ts$/, "");
      const demoIds = specDemoIds(specName, src);
      const runsForIntegration =
        demoIds.length === 0 || demoIds.some((id) => served.has(id));
      if (!runsForIntegration) continue;
      scannedSpecs += 1;
      allPrompts.push(...extractPrompts(specName, src, demoIds));
    }
    expect(scannedSpecs).toBeGreaterThan(0);

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
        `Found ${uncovered.length} prompt(s) in the shared E2E specs that run for langgraph-python without matching aimock fixtures.\n` +
          `Add a fixture entry (match.userMessage substring + deterministic response) to one of:\n` +
          `  - showcase/aimock/d4/langgraph-python/<file>.json\n` +
          `  - showcase/aimock/d6/langgraph-python/<file>.json\n` +
          `  - showcase/aimock/shared/<file>.json (no-context, depth-agnostic)\n\n` +
          `${listing}\n\n` +
          `Total prompts scanned: ${allPrompts.length}. Specs scanned: ${scannedSpecs} of ${specFiles.length} (the others are for demos langgraph-python does not serve).`,
      );
    }

    // Assert we actually extracted a meaningful number. A silent regex
    // regression that extracts zero prompts would otherwise pass this test
    // trivially. The floor sits below today's count (69 prompts) with margin
    // for future pruning.
    expect(allPrompts.length).toBeGreaterThanOrEqual(50);
  });
});

describe("servedDemoIds", () => {
  it("serves each manifest demo route and each extra demo, and skips an entry without a route", () => {
    const manifest = [
      "demos:",
      "  - id: cli-start",
      "    command: npx copilotkit@latest init",
      "  - id: agentic-chat",
      "    route: /demos/agentic-chat",
      "  - id: hitl-in-chat-booking",
      "    route: /demos/hitl-in-chat",
    ].join("\n");

    expect(servedDemoIds(manifest, '["hitl"]')).toEqual(
      new Set(["agentic-chat", "hitl-in-chat", "hitl"]),
    );
  });
});

describe("specDemoIds", () => {
  it.each([
    {
      form: "a string literal",
      src: 'describeDemo("agentic-chat", "Agentic Chat", () => {});',
      ids: ["agentic-chat"],
    },
    {
      form: "a call split over lines",
      src: 'describeDemo(\n  "hitl-in-app",\n  "HITL In-App",\n  () => {},\n);',
      ids: ["hitl-in-app"],
    },
    {
      form: "a const in the same file",
      src: 'const DEMO = "gen-ui-interrupt";\ndescribeDemo(DEMO, "Gen UI interrupt", () => {});',
      ids: ["gen-ui-interrupt"],
    },
    {
      form: "a spec without describeDemo",
      src: 'test.describe("Showcase app", () => {});',
      ids: [],
    },
  ])("reads the demo from $form", ({ src, ids }) => {
    expect(specDemoIds("example", src)).toEqual(ids);
  });

  it("throws when describeDemo takes a name that is not a const string", () => {
    expect(() =>
      specDemoIds("example", 'describeDemo(demoId, "Example", () => {});'),
    ).toThrow("example.spec.ts: describeDemo takes demoId");
  });
});

describe("extractPrompts", () => {
  it.each([
    {
      form: "a chat-input variable",
      src: 'await input.fill("What recipe am I making?");',
      prompts: ["What recipe am I making?"],
    },
    {
      form: "a prompt on its own line with a trailing comma",
      src: 'await input.fill(\n  "Plan a trip to mars in 5 steps",\n);',
      prompts: ["Plan a trip to mars in 5 steps"],
    },
    {
      form: "the placeholder locator split over lines",
      src: 'await page\n  .getByPlaceholder("Type a message")\n  .fill("Tell me a one-line joke");',
      prompts: ["Tell me a one-line joke"],
    },
    {
      form: "a helper that types its parameter into the chat input",
      src: [
        "async function send(page: Page, text: string) {",
        '  const input = page.getByPlaceholder("Type a message");',
        "  await input.fill(text);",
        "}",
        'await send(page, "Say hello in one short sentence");',
      ].join("\n"),
      prompts: ["Say hello in one short sentence"],
    },
  ])("extracts a prompt typed through $form", ({ src, prompts }) => {
    expect(extractPrompts("example", src, []).map((p) => p.prompt)).toEqual(
      prompts,
    );
  });

  it.each([
    {
      form: "a non-chat input",
      src: 'await page.getByTestId("ctx-name").fill("Jamie");',
    },
    {
      form: "a helper that fills a non-chat input",
      src: [
        "async function rename(page: Page, name: string) {",
        '  await page.getByTestId("pref-name").fill(name);',
        "}",
        'await rename(page, "Ada");',
      ].join("\n"),
    },
  ])("ignores text typed into $form", ({ src }) => {
    expect(extractPrompts("example", src, [])).toEqual([]);
  });

  it("leaves out prompts of skipped tests, and keeps the next test's prompt", () => {
    const src = [
      'test.fixme("downgrade flow", async () => {});',
      'test.skip("draws a diagram", async ({ page }) => {',
      "  await input.fill(",
      '    "Use Excalidraw to draw exactly 2 rectangles",',
      "  );",
      "});",
      'test("plans a trip", async ({ page }) => {',
      '  await input.fill("Plan a trip to mars in 5 steps");',
      "});",
    ].join("\n");

    expect(extractPrompts("example", src, []).map((p) => p.prompt)).toEqual([
      "Plan a trip to mars in 5 steps",
    ]);
  });

  it("keeps a prompt that follows a conditional test.skip in a running test", () => {
    const src = [
      'test("reads forwardedProps", async ({ page }) => {',
      '  test.skip(readsContext, "The agent reads the agent context.");',
      '  await input.fill("Show me the sales dashboard");',
      "});",
    ].join("\n");

    expect(extractPrompts("example", src, []).map((p) => p.prompt)).toEqual([
      "Show me the sales dashboard",
    ]);
  });

  it("resolves a pill click to its message through the spec's demo", () => {
    const src =
      'await clickBeautifulChatPill(page, "Toggle Theme (Frontend Tools)");';

    expect(
      extractPrompts("beautiful-chat-toggle-theme", src, ["beautiful-chat"]),
    ).toEqual([
      {
        spec: "beautiful-chat-toggle-theme",
        line: 1,
        prompt: "Toggle the app theme using the toggleTheme tool.",
        source: "pill",
      },
    ]);
  });

  it("reads a pill from its first mention outside a skipped test", () => {
    const src = [
      'test.skip("toggles twice", async ({ page }) => {',
      '  await clickBeautifulChatPill(page, "Toggle Theme (Frontend Tools)");',
      "});",
      'test("toggles the theme", async ({ page }) => {',
      '  await clickBeautifulChatPill(page, "Toggle Theme (Frontend Tools)");',
      "});",
    ].join("\n");

    expect(extractPrompts("beautiful-chat", src, ["beautiful-chat"])).toEqual([
      {
        spec: "beautiful-chat",
        line: 5,
        prompt: "Toggle the app theme using the toggleTheme tool.",
        source: "pill",
      },
    ]);
  });
});

/**
 * Fail-loud coverage for the two throw branches in `loadAllFixtures`.
 *
 * These tests exist because the loader was hardened to throw (rather than
 * silently `continue`) on (a) malformed JSON and (b) a file missing the
 * `fixtures` array. Without these tests, a future revert to silent-skip
 * would pass CI green. Each test isolates a temp dir, writes the offending
 * file, calls the helper directly, and asserts the rejection message
 * mentions both the failure mode and the file path.
 */
describe("loadAllFixtures fail-loud", () => {
  it("throws with file path when a fixture file has malformed JSON", async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "aimock-fixture-malformed-"),
    );
    try {
      const badPath = path.join(tmpDir, "bad.json");
      await fs.writeFile(badPath, "{ not valid json", "utf8");

      await expect(loadAllFixtures([tmpDir])).rejects.toThrow(
        /failed to parse fixture file/,
      );
      await expect(loadAllFixtures([tmpDir])).rejects.toThrow(badPath);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("throws with file path when a fixture file is missing the 'fixtures' array", async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "aimock-fixture-missing-"),
    );
    try {
      const badPath = path.join(tmpDir, "no-fixtures.json");
      await fs.writeFile(badPath, JSON.stringify({ notFixtures: [] }), "utf8");

      await expect(loadAllFixtures([tmpDir])).rejects.toThrow(
        /missing 'fixtures' array/,
      );
      await expect(loadAllFixtures([tmpDir])).rejects.toThrow(badPath);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
