/**
 * Fixture ↔ demo-tool-surface drift validator.
 *
 * In production we route showcase LLM traffic through aimock for cost
 * reasons. Fixtures substring-match the user message and return hardcoded
 * tool calls. When a fixture returns a tool name the target demo's agent
 * doesn't actually register, the tool call dangles and the demo silently
 * breaks. That was the April 22 regression. This script catches that
 * class of drift at CI time before it reaches prod.
 *
 * Usage:
 *   npx tsx showcase/scripts/validate-fixture-tool-surface.ts
 *
 * Exit 0 = clean. Exit 1 = drift detected, with a per-fixture report.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface Fixture {
  match: { userMessage?: string };
  response: {
    toolCalls?: Array<{ name: string; arguments?: string }>;
    content?: string;
  };
}

export interface DemoSurface {
  /** Package slug, e.g. "langgraph-python". */
  slug: string;
  /** Demo id, e.g. "gen-ui-tool-based" — the URL segment under /demos. */
  demoId: string;
  /** CopilotKit `agent=` prop value used by this demo page. */
  agentId: string;
  /** Suggestion message strings from useConfigureSuggestions(...). */
  suggestions: string[];
  /** Union of every tool name this demo's agent can legitimately call
   *  (frontend useComponent/useHumanInTheLoop/useFrontendTool + backend). */
  tools: string[];
}

export interface Violation {
  fixtureMatch: string;
  fixtureTool: string;
  demo: { slug: string; demoId: string };
  matchedSuggestion: string;
}

// -----------------------------------------------------------------------------
// Pure validation
// -----------------------------------------------------------------------------

export function validate(
  fixtures: Fixture[],
  demos: DemoSurface[],
): Violation[] {
  const violations: Violation[] = [];

  for (const fixture of fixtures) {
    const toolCalls = fixture.response.toolCalls;
    if (!toolCalls || toolCalls.length === 0) continue;

    const match = fixture.match.userMessage;
    if (!match) continue;
    const needle = match.toLowerCase();

    for (const demo of demos) {
      const matchedSuggestion = demo.suggestions.find((s) =>
        s.toLowerCase().includes(needle),
      );
      if (!matchedSuggestion) continue;

      const registered = new Set(demo.tools);
      // Wildcard renderers (useDefaultRenderTool — represented as "*" in
      // the tool set) match every fixture tool — skip all checks for this demo.
      if (registered.has("*")) continue;
      for (const tc of toolCalls) {
        if (registered.has(tc.name)) continue;
        violations.push({
          fixtureMatch: match,
          fixtureTool: tc.name,
          demo: { slug: demo.slug, demoId: demo.demoId },
          matchedSuggestion,
        });
      }
    }
  }

  return violations;
}

// -----------------------------------------------------------------------------
// File loaders (used by the CLI, not the pure `validate()` function).
// Regex-based parsing is good enough for the showcase conventions; if a demo
// diverges from the conventions it will silently produce an empty tool list
// and any fixture targeting it will flag as drift — which is the loud, safe
// failure mode.
// -----------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOWCASE_ROOT = path.resolve(__dirname, "..");

export function loadFixtures(aimockDir: string): Fixture[] {
  const out: Fixture[] = [];
  if (!fs.existsSync(aimockDir)) return out;
  for (const file of fs.readdirSync(aimockDir)) {
    if (!file.endsWith(".json")) continue;
    const raw = fs.readFileSync(path.join(aimockDir, file), "utf-8");
    const parsed = JSON.parse(raw) as { fixtures?: Fixture[] };
    if (Array.isArray(parsed.fixtures)) out.push(...parsed.fixtures);
  }
  return out;
}

const SUGGESTION_MESSAGE_RE =
  /message:\s*(`[^`]*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;
const USE_COMPONENT_BLOCK_RE =
  /use(?:Component|HumanInTheLoop|FrontendTool|RenderTool|DefaultRenderTool)\s*\(\s*\{[\s\S]*?name:\s*["']([^"']+)["']/g;
const AGENT_PROP_RE = /<CopilotKit[^>]*\bagent\s*=\s*["']([^"']+)["']/;
// Detects useDefaultRenderTool({ ... }) — the wildcard catch-all renderer
// that matches ALL tool calls. No `name:` property needed.
const USE_DEFAULT_RENDER_TOOL_RE = /useDefaultRenderTool\s*\(/;

function extractStringLiteral(rawLiteral: string): string {
  // Strip outer quotes and unescape — conservative: only \" \' \\ \n
  const stripped = rawLiteral.slice(1, -1);
  return stripped
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, "\\")
    .replace(/\\n/g, "\n");
}

function parseDemoPage(pageTsxPath: string): {
  agentId: string | null;
  suggestions: string[];
  frontendTools: string[];
} {
  const src = fs.readFileSync(pageTsxPath, "utf-8");
  const agentMatch = src.match(AGENT_PROP_RE);
  const suggestions: string[] = [];
  for (const m of src.matchAll(SUGGESTION_MESSAGE_RE)) {
    suggestions.push(extractStringLiteral(m[1]));
  }
  const frontendTools: string[] = [];
  for (const m of src.matchAll(USE_COMPONENT_BLOCK_RE)) {
    frontendTools.push(m[1]);
  }
  // useDefaultRenderTool is a wildcard renderer — it registers "*" which
  // matches every fixture tool, so no drift violation can occur.
  if (USE_DEFAULT_RENDER_TOOL_RE.test(src)) {
    frontendTools.push("*");
  }
  return {
    agentId: agentMatch ? agentMatch[1] : null,
    suggestions,
    frontendTools,
  };
}

const PY_TOOLS_ARRAY_RE = /tools\s*=\s*\[([^\]]*)\]/g;
const PY_NAME_TOKEN_RE = /[a-zA-Z_][a-zA-Z0-9_]*/g;
const PY_TOOL_DECORATOR_DEF_RE =
  /@tool\b[\s\S]*?def\s+([a-zA-Z_][a-zA-Z0-9_]*)/g;

function parseBackendTools(agentFilePath: string): string[] {
  if (!fs.existsSync(agentFilePath)) return [];
  const src = fs.readFileSync(agentFilePath, "utf-8");
  const names = new Set<string>();

  for (const m of src.matchAll(PY_TOOL_DECORATOR_DEF_RE)) {
    names.add(m[1]);
  }
  for (const m of src.matchAll(PY_TOOLS_ARRAY_RE)) {
    const body = m[1];
    // Skip LangGraph's `tools=[]` empty case and middleware-only agents.
    if (!body.trim()) continue;
    for (const tok of body.matchAll(PY_NAME_TOKEN_RE)) {
      const name = tok[0];
      // Filter obvious non-tool tokens (keywords, literals).
      if (["None", "True", "False", "self", "cls"].includes(name)) continue;
      names.add(name);
    }
  }
  return [...names];
}

/**
 * Parse packages/<slug>/src/app/api/copilotkit/route.ts for the
 * agentId→graphId map. Recognizes the two patterns the showcase uses:
 *   agents["agent-id"] = createAgent("graph_id")
 *   agents["agent-id"] = createAgent()         // defaults to sample_agent
 * and the `for (const name of neutralAssistantCells)` loop that bulk-assigns
 * the default graph. Packages without a route.ts (or without this pattern —
 * e.g. TS/Mastra) return {} and the caller falls back to file-name guessing.
 */
const routeCache = new Map<string, Record<string, string>>();
function loadAgentRoutes(
  packagesDir: string,
  slug: string,
): Record<string, string> {
  const cached = routeCache.get(slug);
  if (cached) return cached;

  // Walk every src/app/api/copilotkit*/route.ts — some demos (beautiful-chat,
  // declarative-gen-ui, mcp-apps, ogui, a2ui-fixed-schema) live on their own
  // dedicated runtime endpoint with its own createAgent wiring.
  const apiDir = path.join(packagesDir, slug, "src", "app", "api");
  const out: Record<string, string> = {};
  if (!fs.existsSync(apiDir)) {
    routeCache.set(slug, out);
    return out;
  }

  for (const entry of fs.readdirSync(apiDir)) {
    if (!entry.startsWith("copilotkit")) continue;
    const routePath = path.join(apiDir, entry, "route.ts");
    if (!fs.existsSync(routePath)) continue;
    const src = fs.readFileSync(routePath, "utf-8");

    for (const m of src.matchAll(
      /agents\[\s*["']([^"']+)["']\s*\]\s*=\s*createAgent\(\s*["']([^"']+)["']/g,
    )) {
      out[m[1]] = m[2];
    }
    for (const m of src.matchAll(
      /agents\[\s*["']([^"']+)["']\s*\]\s*=\s*createAgent\(\s*\)/g,
    )) {
      if (!(m[1] in out)) out[m[1]] = "sample_agent";
    }
    // new LangGraphAgent({ ..., graphId: "X" }) — the dedicated routes
    // (e.g. copilotkit-beautiful-chat) construct the agent inline instead of
    // going through createAgent.
    for (const m of src.matchAll(/graphId\s*:\s*["']([^"']+)["']/g)) {
      // In single-agent dedicated routes the URL segment IS the agent ID.
      // entry looks like "copilotkit-beautiful-chat" → "beautiful-chat".
      const agentFromUrl = entry.replace(/^copilotkit-?/, "");
      if (agentFromUrl && !(agentFromUrl in out)) out[agentFromUrl] = m[1];
    }
    const listMatch = src.match(
      /const\s+neutralAssistantCells\s*=\s*\[([\s\S]*?)\]/,
    );
    if (listMatch) {
      for (const nameMatch of listMatch[1].matchAll(/["']([^"']+)["']/g)) {
        if (!(nameMatch[1] in out)) out[nameMatch[1]] = "sample_agent";
      }
    }
  }

  routeCache.set(slug, out);
  return out;
}

const graphCache = new Map<string, Record<string, string>>();
function loadGraphs(packagesDir: string, slug: string): Record<string, string> {
  const cached = graphCache.get(slug);
  if (cached) return cached;

  const lgPath = path.join(packagesDir, slug, "langgraph.json");
  const out: Record<string, string> = {};
  if (!fs.existsSync(lgPath)) {
    graphCache.set(slug, out);
    return out;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(lgPath, "utf-8")) as {
      graphs?: Record<string, string>;
    };
    const graphs = parsed.graphs ?? {};
    for (const [name, ref] of Object.entries(graphs)) {
      // "./src/agents/foo.py:graph" → absolute path to foo.py
      const relPath = ref.split(":")[0];
      out[name] = path.resolve(packagesDir, slug, relPath);
    }
  } catch {
    // Malformed langgraph.json → skip silently; caller falls back to heuristics.
  }

  graphCache.set(slug, out);
  return out;
}

/**
 * Scan the showcase tree and produce a DemoSurface per discovered demo page.
 *
 * Conventions assumed (see showcase/packages/*):
 *   - One demo per directory under packages/<slug>/src/app/demos/<demoId>/
 *   - The demo's entry is page.tsx with `<CopilotKit agent="..." ...>`
 *   - Suggestions live in a useConfigureSuggestions({ suggestions: [...] }) call
 *     in the same file (or one of its hook imports — we walk hooks/*.tsx too)
 *   - Backend tools for each agentId live in packages/<slug>/src/agents/<agentId>.py
 *     with hyphens mapped to underscores
 */
export function collectDemoSurfaces(showcaseRoot: string): DemoSurface[] {
  const packagesDir = path.join(showcaseRoot, "packages");
  if (!fs.existsSync(packagesDir)) return [];

  const surfaces: DemoSurface[] = [];

  for (const slug of fs.readdirSync(packagesDir)) {
    const demosDir = path.join(packagesDir, slug, "src", "app", "demos");
    if (!fs.existsSync(demosDir)) continue;

    for (const demoId of fs.readdirSync(demosDir)) {
      const pageTsx = path.join(demosDir, demoId, "page.tsx");
      if (!fs.existsSync(pageTsx)) continue;

      const { agentId, suggestions, frontendTools } = parseDemoPage(pageTsx);
      if (!agentId) continue;

      // Collect suggestions from sibling hooks/*.tsx — Beautiful Chat puts
      // its useConfigureSuggestions in hooks/use-example-suggestions.tsx.
      const hooksDir = path.join(demosDir, demoId, "hooks");
      if (fs.existsSync(hooksDir)) {
        for (const f of fs.readdirSync(hooksDir)) {
          if (!f.endsWith(".tsx") && !f.endsWith(".ts")) continue;
          const parsed = parseDemoPage(path.join(hooksDir, f));
          suggestions.push(...parsed.suggestions);
          frontendTools.push(...parsed.frontendTools);
        }
      }

      // Backend agent file resolution:
      //   1. Use the authoritative agentId→graphId map parsed from route.ts
      //      (handles the common pattern where multiple demos share one graph,
      //      e.g. tool-rendering-custom-catchall routes to the tool_rendering
      //      graph, not a file named after the demo).
      //   2. Use the graphId to look up the Python file via langgraph.json.
      //   3. Fall back to file-name heuristics for packages without that
      //      wiring (TypeScript/Mastra/etc.).
      const agentRoutes = loadAgentRoutes(packagesDir, slug);
      const graphs = loadGraphs(packagesDir, slug);
      const graphId = agentRoutes[agentId];
      const agentFileFromGraph = graphId ? graphs[graphId] : undefined;

      const candidates = [
        agentFileFromGraph,
        path.join(
          packagesDir,
          slug,
          "src",
          "agents",
          agentId.replace(/-/g, "_") + ".py",
        ),
        path.join(packagesDir, slug, "src", "agents", agentId + ".py"),
        path.join(
          packagesDir,
          slug,
          "src",
          "agents",
          agentId.replace(/-/g, "_") + "_agent.py",
        ),
      ].filter((p): p is string => Boolean(p));

      let backendTools: string[] = [];
      for (const c of candidates) {
        if (fs.existsSync(c)) {
          backendTools = parseBackendTools(c);
          break;
        }
      }

      surfaces.push({
        slug,
        demoId,
        agentId,
        suggestions: [...new Set(suggestions)],
        tools: [...new Set([...frontendTools, ...backendTools])],
      });
    }
  }

  return surfaces;
}

// -----------------------------------------------------------------------------
// CLI
// -----------------------------------------------------------------------------

function cli(): void {
  const aimockDir = path.join(SHOWCASE_ROOT, "aimock");
  const fixtures = loadFixtures(aimockDir);
  const demos = collectDemoSurfaces(SHOWCASE_ROOT);
  const violations = validate(fixtures, demos);

  if (violations.length === 0) {
    console.log(
      `✓ validate-fixture-tool-surface: ${fixtures.length} fixtures × ${demos.length} demos — no drift`,
    );
    return;
  }

  console.error(
    `✗ validate-fixture-tool-surface: ${violations.length} drift violation(s)\n`,
  );
  for (const v of violations) {
    console.error(
      `  - fixture match "${v.fixtureMatch}" → tool "${v.fixtureTool}" is NOT in ${v.demo.slug}/${v.demo.demoId}'s tool surface`,
    );
    console.error(`    triggering suggestion: "${v.matchedSuggestion}"`);
  }
  process.exit(1);
}

// Run CLI when invoked directly.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  cli();
}
