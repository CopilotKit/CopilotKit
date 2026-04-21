/*
 * Integration Package Generator
 *
 * Scaffolds a new integration package in showcase/packages/<slug>/
 * with all required files, demo stubs, and deployment configs.
 *
 * Usage:
 *   npx tsx create-integration/index.ts \
 *     --name "Anthropic (Claude Agent SDK)" \
 *     --slug anthropic-claude-sdk \
 *     --category provider-sdk \
 *     --language python \
 *     --features agentic-chat,hitl-in-chat,tool-rendering
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "..", "..");
// Both directories are overridable via env so tests can run the generator
// against an isolated tmpdir — without overrides the generator's writes
// collided with sibling suites reading the real `showcase/packages/` tree
// (ENOENT on partial state) and with concurrent `git checkout HEAD --`
// invocations on `.github/workflows/*.yml` (`.git/index.lock` races). An
// env var (vs a CLI flag) keeps the public flag surface unchanged and is
// trivial for test harnesses to set via `execFileSync`'s `env` option.
const PACKAGES_DIR =
  process.env.CREATE_INTEGRATION_PACKAGES_DIR ?? path.join(ROOT, "packages");
const WORKFLOWS_DIR =
  process.env.CREATE_INTEGRATION_WORKFLOWS_DIR ??
  path.resolve(ROOT, "..", ".github", "workflows");
const FEATURE_REGISTRY_PATH = path.join(
  ROOT,
  "shared",
  "feature-registry.json",
);

interface Feature {
  id: string;
  name: string;
  category: string;
  description: string;
}

interface CLIArgs {
  name: string;
  slug: string;
  category: Category;
  language: Language;
  features: string[];
  extraDeps: string[];
}

const CATEGORIES = [
  "popular",
  "agent-framework",
  "enterprise-platform",
  "provider-sdk",
  "protocol",
  "emerging",
  "starter",
] as const;
type Category = (typeof CATEGORIES)[number];

const LANGUAGES = ["python", "typescript", "dotnet"] as const;
type Language = (typeof LANGUAGES)[number];

/**
 * Probe a filesystem path and classify the result so callers can
 * distinguish "not present" from "present but unreadable". Using
 * fs.existsSync collapses ENOENT and EACCES/EPERM/EIO into a bare
 * boolean, which means a permissions or I/O fault masquerades as
 * "missing" and leads to silently wrong branches (skip-update,
 * overwrite, etc.). statSync + errno discrimination keeps the three
 * outcomes distinct so callers can warn/exit/proceed appropriately.
 */
function probePath(p: string): "missing" | "exists" | "unreadable" {
  try {
    fs.statSync(p);
    return "exists";
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return "missing";
    return "unreadable";
  }
}

/**
 * Escape regex metacharacters in a string so it can be safely embedded
 * into a RegExp source. Used by updateWorkflows() to anchor slug-based
 * idempotency checks to full-line matches — a bare `includes(slug)`
 * collides across unrelated lines and against longer sibling slugs
 * (e.g. `includes("- foo")` matches `"- foo-bar"`), which silently
 * skips the insert and produces a broken workflow file.
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Normalize a feature registry id (e.g. `"agentic-chat"`) into the
 * agent-id convention used by deployed showcase backends, which
 * register under underscore-separated ids (e.g. `"agentic_chat"`). The
 * feature registry keys the demo tree with hyphens; the real backend
 * agents are keyed with underscores. Callers that emit the agent id
 * into runtime code (generateSmokeRoute, generateDemoPage, ...) must
 * apply this rewrite so the emitted default lines up with the backend
 * convention; a hyphen/underscore mismatch surfaces as a 404 /
 * "agent not found" at smoke-test time, not at generator time.
 *
 * Emits a one-shot operator warning when the rewrite actually fires
 * (hyphen present in the input) so that a generator run producing a
 * rewritten default is visible in the console, matching the stronger
 * warning generateSmokeRoute already emitted before this helper was
 * factored out.
 */
function toAgentId(featureId: string, context: string): string {
  const agentId = featureId.replace(/-/g, "_");
  if (agentId !== featureId) {
    console.warn(
      `[create-integration] ${context}: rewrote feature id "${featureId}" → agentId="${agentId}" (hyphens → underscores). ` +
        `Verify this matches the real agent id your backend registers.`,
    );
  }
  return agentId;
}

export function parseArgs(): CLIArgs {
  const args = process.argv.slice(2);
  const parsed: Record<string, string> = {};
  // Track which flags have already been seen so a duplicate occurrence
  // (`--slug a --slug b`) is rejected loudly instead of silently
  // overwriting the earlier value. Matches the strict-parser contract
  // that capture-previews.ts and validate-parity.ts call out in their
  // comments when they mirror this behaviour.
  const seen = new Set<string>();

  // Walk the argv in lockstep. Every `--flag` MUST be followed by a value
  // that does not itself start with `--`; anything else is a usage error
  // we surface immediately rather than silently dropping the flag (which
  // would then trip the missing-required-flag check with a misleading
  // message about the wrong flag).
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      console.error(
        `Error: Unexpected positional argument '${arg}'. All arguments must be --flag value pairs.`,
      );
      process.exit(1);
    }
    const key = arg.slice(2);
    const val = args[i + 1];
    if (val === undefined || val.startsWith("--")) {
      console.error(
        `Error: Flag --${key} expects a value but got ${
          val === undefined ? "end-of-args" : `another flag (${val})`
        }.`,
      );
      process.exit(1);
    }
    if (seen.has(key)) {
      console.error(`Error: --${key} specified more than once.`);
      process.exit(1);
    }
    seen.add(key);
    parsed[key] = val;
    i++;
  }

  // Validate --name shape before any consumer interpolates it unescaped
  // into JSX/markdown/YAML (page.tsx, README, MDX, manifest.yaml). A name
  // like "Hello <script>alert(1)</script>" would otherwise inject raw
  // JSX/markdown into generated files. The character class is a
  // deliberately permissive superset for human-readable display names.
  if (parsed.name !== undefined) {
    if (parsed.name.length < 1) {
      console.error(`Error: --name must be at least 1 character.`);
      process.exit(1);
    }
    if (!/^[A-Za-z0-9 .\-\/()[\]]+$/.test(parsed.name)) {
      console.error(
        `Error: Invalid --name '${parsed.name}'. Allowed characters: letters, digits, spaces, and . - / ( ) [ ]`,
      );
      process.exit(1);
    }
  }

  // Validate --slug shape before any consumer interpolates it into
  // filesystem paths (path.join(PACKAGES_DIR, slug)) or YAML/shell
  // workflow blocks. Without this guard, a value like "../../etc/foo"
  // escapes the packages directory and a value containing "/" creates
  // nested subdirectories. The regex mirrors the format every existing
  // deployed slug already follows (lowercase alnum with hyphen
  // separators starting with a letter or digit).
  if (parsed.slug !== undefined && !/^[a-z0-9][a-z0-9-]*$/.test(parsed.slug)) {
    console.error(
      `Invalid slug '${parsed.slug}'. Slugs must match /^[a-z0-9][a-z0-9-]*$/ (lowercase alphanumeric, hyphen-separated, starting with a letter or digit).`,
    );
    process.exit(1);
  }

  if (
    !parsed.name ||
    !parsed.slug ||
    !parsed.category ||
    !parsed.language ||
    !parsed.features
  ) {
    console.error(
      "Usage: create-integration --name <name> --slug <slug> --category <category> --language <language> --features <comma-separated> [--deps <comma-separated>]",
    );
    console.error("\nRequired flags:");
    console.error(
      "  --name       Display name (e.g. 'Anthropic (Claude Agent SDK)')",
    );
    console.error("  --slug       URL-safe ID (e.g. 'anthropic-claude-sdk')");
    console.error(`  --category   One of: ${CATEGORIES.join(", ")}`);
    console.error(`  --language   One of: ${LANGUAGES.join(", ")}`);
    console.error(
      "  --features   Comma-separated feature IDs (e.g. 'agentic-chat,hitl-in-chat,tool-rendering')",
    );
    console.error("\nOptional flags:");
    console.error(
      "  --deps       Extra npm dependencies (e.g. '@ag-ui/mastra,@mastra/core')",
    );
    process.exit(1);
  }

  // Validate that category and language are in the allowed literal unions;
  // the rest of the generator branches on these values and a typo used to
  // silently produce broken output (unknown category → registry lookup
  // miss; unknown language → skipped runtime files).
  if (!(CATEGORIES as readonly string[]).includes(parsed.category)) {
    console.error(
      `Error: Unknown --category '${parsed.category}'. One of: ${CATEGORIES.join(", ")}`,
    );
    process.exit(1);
  }
  if (!(LANGUAGES as readonly string[]).includes(parsed.language)) {
    console.error(
      `Error: Unknown --language '${parsed.language}'. One of: ${LANGUAGES.join(", ")}`,
    );
    process.exit(1);
  }

  return {
    name: parsed.name,
    slug: parsed.slug,
    category: parsed.category as Category,
    language: parsed.language as Language,
    // Filter empty strings so trailing/leading commas (e.g. "a,b," or ",a")
    // don't produce an empty-string entry that the registry lookup rejects
    // with a confusing "Unknown feature id ''" error.
    features: parsed.features
      .split(",")
      .map((f) => f.trim())
      .filter((f) => f.length > 0),
    extraDeps: parsed.deps
      ? parsed.deps
          .split(",")
          .map((d) => d.trim())
          .filter((d) => d.length > 0)
      : [],
  };
}

/**
 * Read + parse + shape-check the feature registry JSON. Exported so
 * unit tests can exercise the error branches (ENOENT, invalid JSON,
 * shape-invalid top level) without spawning a subprocess.
 */
export function loadFeatureRegistry(): Feature[] {
  let raw: string;
  try {
    raw = fs.readFileSync(FEATURE_REGISTRY_PATH, "utf-8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to read feature registry at ${FEATURE_REGISTRY_PATH}: ${msg}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Feature registry at ${FEATURE_REGISTRY_PATH} is not valid JSON: ${msg}`,
    );
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as { features?: unknown }).features)
  ) {
    throw new Error(
      `Feature registry at ${FEATURE_REGISTRY_PATH} must be a JSON object with a 'features' array.`,
    );
  }
  return (parsed as { features: Feature[] }).features;
}

function writeFile(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  console.log(`  Created: ${path.relative(ROOT, filePath)}`);
}

function generateManifest(args: CLIArgs, features: Feature[]): string {
  const demos = args.features.map((featureId) => {
    const feature = features.find((f) => f.id === featureId);
    const name = feature?.name || featureId;
    const description = feature?.description || "";
    const tags = [feature?.category || "general"].filter(Boolean);
    return {
      id: featureId,
      name,
      description,
      tags,
      route: `/demos/${featureId}`,
    };
  });

  const manifest = {
    name: args.name,
    slug: args.slug,
    category: args.category,
    language: args.language,
    logo: `/logos/${args.slug}.svg`,
    description: `CopilotKit integration with ${args.name}`,
    partner_docs: null,
    repo: `https://github.com/CopilotKit/CopilotKit/tree/main/showcase/packages/${args.slug}`,
    copilotkit_version: "2.0.0",
    backend_url: `https://showcase-${args.slug}-production.up.railway.app`,
    deployed: false,
    generative_ui: ["constrained-explicit"],
    interaction_modalities: ["chat"],
    features: args.features,
    demos,
    managed_platform: undefined as { name: string; url: string } | undefined,
  };

  const MANAGED_PLATFORMS: Record<string, { name: string; url: string }> = {
    LangGraph: { name: "LangGraph Platform", url: "https://langsmith.com" },
    Mastra: { name: "Mastra Cloud", url: "https://mastra.ai/cloud" },
    CrewAI: { name: "CrewAI Enterprise", url: "https://crewai.com/amp" },
    Agno: { name: "Agent OS", url: "https://os.agno.com" },
    AG2: { name: "Agent OS", url: "https://ag2.ai/product" },
    Strands: {
      name: "AWS Bedrock AgentCore",
      url: "https://aws.amazon.com/bedrock/agents/",
    },
  };

  for (const [prefix, platform] of Object.entries(MANAGED_PLATFORMS)) {
    if (args.name.startsWith(prefix)) {
      manifest.managed_platform = platform;
      break;
    }
  }

  return yaml.stringify(manifest);
}

function generatePackageJson(args: CLIArgs): string {
  return (
    JSON.stringify(
      {
        name: `@copilotkit/showcase-${args.slug}`,
        version: "0.1.0",
        private: true,
        scripts: {
          dev:
            args.language === "typescript"
              ? "next dev --turbopack"
              : 'concurrently "next dev --turbopack" "python -m uvicorn agent_server:app --host 0.0.0.0 --port 8000 --reload"',
          build: "next build",
          start: "next start",
          lint: "next lint",
          "test:e2e": "playwright test",
        },
        dependencies: {
          "@ag-ui/client": "^0.0.43",
          "@copilotkit/react-core": "next",
          "@copilotkit/runtime": "next",
          next: "^15.0.0",
          react: "^19.0.0",
          "react-dom": "^19.0.0",
          zod: "^3.24.0",
          ...Object.fromEntries(args.extraDeps.map((d) => [d, "latest"])),
        },
        devDependencies: {
          "@playwright/test": "^1.50.0",
          "@types/node": "^22.0.0",
          "@types/react": "^19.0.0",
          typescript: "^5.7.0",
          tailwindcss: "^4.0.0",
          "@tailwindcss/postcss": "^4.0.0",
          postcss: "^8.5.0",
          ...(args.language !== "typescript" ? { concurrently: "^9.1.0" } : {}),
        },
      },
      null,
      2,
    ) + "\n"
  );
}

function generateLayout(): string {
  return `import type { Metadata } from "next";
import "@copilotkit/react-core/v2/styles.css";
import "./globals.css";

export const metadata: Metadata = {
    title: "CopilotKit Showcase",
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en">
            <body>
                <script
                    dangerouslySetInnerHTML={{
                        __html: \`
                            console.log('[showcase] Demo loaded:', window.location.href);
                            console.log('[showcase] In iframe:', window.self !== window.top);
                            window.addEventListener('error', function(e) {
                                console.error('[showcase] Uncaught error:', e.message, e.filename, e.lineno);
                            });
                            window.addEventListener('unhandledrejection', function(e) {
                                console.error('[showcase] Unhandled rejection:', e.reason);
                            });
                        \`,
                    }}
                />
                {children}
            </body>
        </html>
    );
}
`;
}

function generatePostcssConfig(): string {
  return `/** @type {import('postcss-load-config').Config} */
const config = {
    plugins: {
        "@tailwindcss/postcss": {},
    },
};

export default config;
`;
}

function generateGlobalsCss(): string {
  return `@import "tailwindcss";
@import "@copilotkit/react-core/v2/styles.css";

:root {
    --copilot-kit-background-color: #f8f9fa;
    --copilot-kit-primary-color: #0066ff;
}

* {
    box-sizing: border-box;
}

body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    min-height: 100vh;
}
`;
}

function generateIndexPage(args: CLIArgs, features: Feature[]): string {
  const demoLinks = args.features
    .map((featureId) => {
      const feature = features.find((f) => f.id === featureId);
      const name = feature?.name || featureId;
      const desc = feature?.description || "";
      return `                    <a key="${featureId}" href="/demos/${featureId}" className="demo-card">
                        <h3>${name}</h3>
                        <p>${desc}</p>
                    </a>`;
    })
    .join("\n");

  return `export default function Home() {
    return (
        <main style={{ padding: "2rem", maxWidth: "800px", margin: "0 auto" }}>
            <h1>${args.name}</h1>
            <p>Integration ID: ${args.slug}</p>
            <h2 style={{ marginTop: "2rem" }}>Demos</h2>
            <div style={{ display: "grid", gap: "1rem", marginTop: "1rem" }}>
${demoLinks}
            </div>
        </main>
    );
}
`;
}

function generateDemoPage(
  featureId: string,
  feature: Feature | undefined,
): string {
  // The generated body only references `CopilotKit`, `CopilotChat`, and
  // `useConfigureSuggestions` — the rest of the v2 hooks (and `z` from
  // zod) were imported eagerly so operators had an autocomplete-friendly
  // starting point. With `strict: true` tsconfig + Next's ESLint the
  // generated package failed lint/typecheck out of the box on every
  // unused-import warning. Derive the import list from the body instead
  // so the emitted file is clean from the first build while preserving
  // the "hooks available" comment block as an author-facing reference.
  // Normalize the agent prop to the backend's underscore-id convention.
  // The feature registry keys the demo tree with hyphens, but real
  // deployed packages (e.g. showcase/packages/langgraph-fastapi/src/app/
  // demos/agentic-chat/page.tsx) register their backend agent under
  // `agent="agentic_chat"`. Emitting the raw featureId here produces a
  // generated page that 404s against every deployed backend; normalize
  // via the shared toAgentId helper so the emitted agent prop matches
  // the same rewrite generateSmokeRoute already applied to
  // SMOKE_AGENT_ID. Shared helper → one source of truth for the
  // convention.
  const agentId = toAgentId(featureId, "generateDemoPage");

  const body = `export default function ${toPascalCase(featureId)}Demo() {
    return (
        <DemoErrorBoundary demoName="${feature?.name || featureId}">
            <CopilotKit runtimeUrl="/api/copilotkit" agent="${agentId}">
                <DemoContent />
            </CopilotKit>
        </DemoErrorBoundary>
    );
}

function DemoContent() {
    // TODO: Implement ${feature?.name || featureId} demo
    // See the LangGraph Python reference implementation for patterns
    //
    // IMPORTANT: Use inline styles for any UI rendered inside the chat
    // (useRenderTool, useHumanInTheLoop callbacks). Tailwind classes get
    // purged by Tailwind v4 in this context. See STYLING-GUIDE.md.
    //
    // Key hooks available:
    //   useFrontendTool({ name, description, parameters: z.object({...}), handler })
    //   useRenderTool({ name: "tool_name", render: ({ args }) => <Component /> })
    //   useHumanInTheLoop({ name, description, parameters, handler: ({ args, respond }) => ... })
    //   useAgentContext({ description, value })
    //   useConfigureSuggestions({ suggestions: [{ title, message }] })
    //   useInterrupt({ render: ({ event, resolve }) => <Component /> })

    useConfigureSuggestions({
        suggestions: [
            { title: "Get started", message: "Hello! What can you do?" },
        ],
    });

    return (
        <div className="flex justify-center items-center h-screen w-full">
            <div className="h-full w-full md:w-4/5 md:h-4/5 rounded-lg">
                <CopilotChat
                    className="h-full rounded-2xl max-w-6xl mx-auto"
                />
            </div>
        </div>
    );
}
`;

  // Candidate hooks exported from @copilotkit/react-core/v2. `CopilotChat`
  // is always emitted (the body unconditionally renders it). Every other
  // hook is included only when the body's *executable code* references
  // it as an identifier, so additions to the body in the future
  // automatically pick up the right imports without reviving dead ones.
  //
  // The "Key hooks available:" documentation block names every hook
  // inside `//` comments — we strip JS line and block comments before
  // scanning so those reference-only mentions don't force the imports
  // back in. Word boundaries also matter: a bare `includes("z")`
  // matches any line containing the letter z (`organize`, `size`, ...).
  const codeOnly = body
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  const v2Candidates = [
    "useFrontendTool",
    "useRenderTool",
    "useAgentContext",
    "useConfigureSuggestions",
    "useHumanInTheLoop",
    "useInterrupt",
  ] as const;
  const v2Imports = ["CopilotChat", ...v2Candidates.filter((h) =>
    new RegExp(`\\b${h}\\b`).test(codeOnly),
  )];
  const zUsed = /\bz\b/.test(codeOnly);

  const importLines = [
    `import React from "react";`,
    `import { CopilotKit } from "@copilotkit/react-core";`,
    `import {\n${v2Imports.map((n) => `    ${n},`).join("\n")}\n} from "@copilotkit/react-core/v2";`,
    ...(zUsed ? [`import { z } from "zod";`] : []),
    `import { DemoErrorBoundary } from "../error-boundary";`,
  ];

  return `"use client";

${importLines.join("\n")}

${body}`;
}

// Accumulates feature ids that hit the default/placeholder branches of
// getDemoInteraction / getDemoTechnicalDetails. main() surfaces this set
// at the end of the run so operators see exactly which demos need
// authoring before shipping the generated package.
const unauthoredDemoFeatures = new Set<string>();

function getDemoInteraction(featureId: string): string {
  switch (featureId) {
    case "tool-rendering":
      return `- "What's the weather like in San Francisco?"
- "Check the weather in Tokyo and New York"
- "Can you look up the current conditions in London?"`;
    case "hitl-in-chat":
      return `- "Plan a trip to Mars in 5 steps"
- "Please plan a pasta dish in 10 steps"
- "Draft a product launch checklist in 7 steps"

The agent proposes a plan as a **StepSelector** card with a checkbox per step. Toggle individual steps on or off (the selected count updates as "N/N selected"), then click **Perform Steps (N)** / **Confirm (N)** to approve, or **Reject** to cancel. The card reflects the final decision ("Accepted" / "Rejected") and disables its buttons afterward.`;
    case "gen-ui-tool-based":
      return `- "What's the weather forecast for this week in San Francisco?"
- "Show me the weather in Paris"
- "Compare the weather in Tokyo and London"

The agent generates structured data via tools, and the frontend renders it as rich UI components.`;
    default:
      // Unauthored demos land here. Previously returned a bare "TODO" line
      // that was easy to miss in review. Keep the content generator-safe
      // (callers expect a string) but make the placeholder self-describing
      // and include the feature id so search-and-replace is unambiguous.
      // Also record the id so main() can warn about unauthored demos at
      // the end of the run rather than relying on reviewers to spot TODOs.
      unauthoredDemoFeatures.add(featureId);
      return `- TODO(${featureId}): authoring required. Known authored ids: ${KNOWN_AUTHORED_FEATURE_IDS.join(
        ", ",
      )}. See getDemoInteraction in showcase/scripts/create-integration/index.ts.`;
  }
}

// Feature ids that have authored per-demo content in the switches above
// and below. When adding a new id to the registry with custom content,
// add it here and to both switches in the same change.
const KNOWN_AUTHORED_FEATURE_IDS = [
  "tool-rendering",
  "hitl-in-chat",
  "gen-ui-tool-based",
] as const;

function getDemoTechnicalDetails(featureId: string): string {
  switch (featureId) {
    case "tool-rendering":
      return `- **Backend tools** are defined in the agent (e.g., \`get_weather\`) and called by the LLM when the user's query matches
- **\`useRenderTool\`** on the frontend registers a React component that renders whenever the agent calls that tool
- The render function receives \`args\` (input parameters), \`result\` (tool output), and \`status\` ("executing" or "complete") so the UI can show loading states
- The tool result is displayed as a rich UI card instead of plain text — demonstrating how agent actions can produce structured, visual output`;
    case "hitl-in-chat":
      return `- **Human-in-the-Loop (HITL)** lets the agent pause and hand control back to the user to review a proposed plan before continuing
- The agent calls a tool (e.g. \`generate_task_steps\`) whose payload is a list of steps; the frontend renders a **StepSelector** card rather than executing immediately
- \`useHumanInTheLoop\` (frontend-tool flow) or \`useInterrupt\` (interrupt flow, imported from \`@copilotkit/react-core/v2\`) registers a \`render\` that receives \`{ args, respond, status }\` — the StepSelector keeps local state for which steps are enabled and calls \`respond({ accepted, steps })\` on Confirm / Reject (CopilotKit v2 API; existing showcase packages use v1 \`useLangGraphInterrupt\` for the interrupt-flow demo alongside v2 hooks like \`useHumanInTheLoop\` — new integrations generated by \`create-integration\` default to the v2 \`useInterrupt\`.)
- The card exposes per-step checkboxes, a live "N/N selected" count, and Confirm / Reject buttons; after a decision the buttons disable and the card shows "Accepted" or "Rejected" so the outcome is auditable in the transcript
- This pattern is essential for plan-style flows — multi-step actions where the user needs to curate, edit, or veto what the agent is about to do before any of it runs`;
    case "gen-ui-tool-based":
      return `- **Generative UI** means the agent's tool calls produce structured data that the frontend renders as custom React components
- Unlike plain text responses, the agent returns tool results with typed parameters (city, temperature, conditions)
- \`useRenderTool\` maps each tool name to a React component, so \`get_weather\` renders a weather card with icons, temperature displays, and forecast details
- The agent decides when to call the tool based on context — it can mix tool-based UI generation with regular text responses
- This pattern enables agents to create dynamic, data-driven interfaces on demand`;
    default:
      // See getDemoInteraction's default for rationale. Keep the two
      // switches in lockstep.
      unauthoredDemoFeatures.add(featureId);
      return `- TODO(${featureId}): technical details unauthored. Known authored ids: ${KNOWN_AUTHORED_FEATURE_IDS.join(
        ", ",
      )}. Add a switch case in getDemoTechnicalDetails (and the peer getDemoInteraction) when documenting this demo.`;
  }
}

function generateDemoReadme(
  featureId: string,
  feature: Feature | undefined,
): string {
  return `# ${feature?.name || featureId}

## What This Demo Shows

${feature?.description || "TODO: Add description"}

## How to Interact

Try asking your Copilot to:

${getDemoInteraction(featureId)}

## Technical Details

What's happening technically:

${getDemoTechnicalDetails(featureId)}

## Building With This

If you're extending this demo or building something similar, here are key things to know:

### Styling Inside the Chat

Content rendered inside CopilotKit's chat area (via \`useRenderTool\`, \`useHumanInTheLoop\`, \`useFrontendTool\`) runs inside CopilotKit's component tree. Standard Tailwind classes may not work here because Tailwind v4 can't statically detect them.

**Use inline styles** for any UI rendered inside the chat:

\`\`\`tsx
// Do this
<div style={{ padding: "24px", borderRadius: "12px", background: "#fff" }}>

// Not this — Tailwind may purge these classes
<div className="p-6 rounded-xl bg-white">
\`\`\`

### Chat Layout

Wrap \`CopilotChat\` in a constraining div for proper spacing:

\`\`\`tsx
<div className="flex justify-center items-center h-screen w-full">
    <div className="h-full w-full md:w-4/5 md:h-4/5 rounded-lg">
        <CopilotChat className="h-full rounded-2xl max-w-6xl mx-auto" />
    </div>
</div>
\`\`\`

### Overriding CopilotKit Styles

CopilotKit uses \`cpk:\` prefixed classes internally. To override them, create a **separate CSS file** (not in globals.css — Tailwind purges it):

\`\`\`css
/* copilotkit-overrides.css */
.copilotKitInput {
    border-radius: 0.75rem;
    border: 1px solid var(--copilot-kit-separator-color) !important;
}
\`\`\`

Import it in \`layout.tsx\` after \`globals.css\`.

### Images and Icons

- Don't reference local image files from agent-generated content (they won't exist). Add \`onError\` fallbacks.
- Use emoji instead of SVG icons inside chat messages (\`fill="currentColor"\` renders unpredictably in the chat context).

See the full [Styling Guide](https://github.com/CopilotKit/CopilotKit/blob/main/showcase/STYLING-GUIDE.md) for more details.
`;
}

function generateRuntimeRoute(args: CLIArgs): string {
  if (args.language === "typescript") {
    return `import { NextRequest } from "next/server";
import {
    CopilotRuntime,
    ExperimentalEmptyAdapter,
    copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";

// TODO: Import the appropriate agent adapter for ${args.name}
// Examples:
//   import { LangGraphAgent } from "@copilotkit/runtime/langgraph";
//   import { MastraAgent } from "@ag-ui/mastra";

export const POST = async (req: NextRequest) => {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
        endpoint: "/api/copilotkit",
        serviceAdapter: new ExperimentalEmptyAdapter(),
        runtime: new CopilotRuntime({
            // TODO: Configure agents for ${args.name}
            // agents: { default: new YourAgent({ ... }) },
        }),
    });

    return handleRequest(req);
};
`;
  }

  return `import { NextRequest } from "next/server";
import {
    CopilotRuntime,
    ExperimentalEmptyAdapter,
    copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";

// The agent backend runs as a separate process on port 8000.
// This runtime proxies CopilotKit requests to it via AG-UI protocol.

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

export const POST = async (req: NextRequest) => {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
        endpoint: "/api/copilotkit",
        serviceAdapter: new ExperimentalEmptyAdapter(),
        runtime: new CopilotRuntime({
            // TODO: Configure the agent adapter for ${args.name}
            // The adapter should point to AGENT_URL
        }),
    });

    return handleRequest(req);
};
`;
}

function generateHealthRoute(args: CLIArgs): string {
  const isLangGraph = args.name.startsWith("LangGraph");
  const isInProcess = args.language === "typescript" && !isLangGraph;

  const agentUrl = isInProcess
    ? ""
    : isLangGraph
      ? "http://localhost:8123"
      : "http://localhost:8000";

  // LangGraph Platform (dev server default `:8123`) exposes `/ok`; our
  // custom FastAPI backends expose `/health`. Individual starters may
  // override the port (e.g. `examples/v2/interrupts-langgraph` uses
  // `:8125`) — the template's constant below is only the default for
  // newly-generated packages.
  const probePath = isLangGraph ? "/ok" : "/health";

  return `import { NextRequest, NextResponse } from "next/server";

// Baked at generation time (template-literal substitution) so the
// generated route can skip the fetch entirely for TypeScript in-process
// integrations rather than probing a bogus URL.
const IS_IN_PROCESS = ${isInProcess ? "true" : "false"};
// Resolve env first so we can distinguish "unset" (unconfigured) from
// "set but unreachable" (down). The baked fallback "${agentUrl}" keeps
// local dev working out-of-the-box but is only used when nothing is set.
const RAW_AGENT_URL = process.env.AGENT_URL || process.env.LANGGRAPH_DEPLOYMENT_URL;
const AGENT_URL = RAW_AGENT_URL || "${agentUrl}";

export async function GET(req: NextRequest) {
    // Check agent backend reachability
    let agentStatus: "unknown" | "in-process" | "ok" | "error" | "down" | "unconfigured" = "unknown";
    let agentDetail = "";
    if (IS_IN_PROCESS) {
        // No out-of-process agent to probe; the runtime lives in this
        // Next.js process, so treat it as healthy unconditionally.
        agentStatus = "in-process";
    } else if (!RAW_AGENT_URL) {
        // Neither AGENT_URL nor LANGGRAPH_DEPLOYMENT_URL is set — surface this
        // as a distinct status so operators can tell "missing config" apart
        // from "network/backend down" without digging through logs.
        agentStatus = "unconfigured";
        agentDetail = "AGENT_URL / LANGGRAPH_DEPLOYMENT_URL env var not set";
    } else {
        try {
            const res = await fetch(\`\${AGENT_URL}${probePath}\`, { signal: AbortSignal.timeout(3000) });
            agentStatus = res.ok ? "ok" : "error";
            agentDetail = \`HTTP \${res.status}\`;
        } catch (err) {
            agentStatus = "down";
            agentDetail = err instanceof Error ? err.message : String(err);
            // Log the underlying error so operators can see timeout vs DNS
            // vs connection-refused without needing a debug token.
            console.error(\`[health] agent probe failed (\${AGENT_URL}${probePath}): \${agentDetail}\`);
        }
    }

    // Public response: safe to expose
    const publicResponse: Record<string, unknown> = {
        status: "ok",
        integration: "${args.slug}",
        agent: agentStatus,
        timestamp: new Date().toISOString(),
    };

    // Extended diagnostics: only with debug token
    const token = req.headers.get("x-debug-token") || req.nextUrl.searchParams.get("debug");
    const expectedToken = process.env.SHOWCASE_DEBUG_TOKEN;

    if (token && expectedToken && token === expectedToken) {
        publicResponse.diagnostics = {
            agent_url: IS_IN_PROCESS ? "(in-process)" : AGENT_URL,
            agent_detail: agentDetail || undefined,
            env: {
                OPENAI_API_KEY: process.env.OPENAI_API_KEY ? "set" : "NOT SET",
                ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? "set" : "NOT SET",
                NODE_ENV: process.env.NODE_ENV,
                PORT: process.env.PORT,
            },
        };
    }

    const httpStatus = agentStatus === "ok" || agentStatus === "in-process" ? 200 : 503;
    return NextResponse.json(publicResponse, { status: httpStatus });
}
`;
}

function generateDebugRoute(args: CLIArgs): string {
  const isLangGraph = args.name.startsWith("LangGraph");
  // LangGraph Platform exposes /ok; our backends expose /health
  const probePath = isLangGraph ? "/ok" : "/health";

  return `import { NextRequest, NextResponse } from "next/server";

// Request log (in-memory ring buffer, last 50 requests)
const requestLog: Array<{ time: string; method: string; path: string; status: number; durationMs: number }> = [];
const MAX_LOG_SIZE = 50;

export function logRequest(method: string, path: string, status: number, durationMs: number) {
    requestLog.push({ time: new Date().toISOString(), method, path, status, durationMs });
    if (requestLog.length > MAX_LOG_SIZE) requestLog.shift();
}

export async function GET(req: NextRequest) {
    // Token-gated: SHOWCASE_DEBUG_TOKEN must be set in env and matched
    const token = req.headers.get("x-debug-token") || req.nextUrl.searchParams.get("token");
    const expectedToken = process.env.SHOWCASE_DEBUG_TOKEN;

    if (!expectedToken || !token || token !== expectedToken) {
        return NextResponse.json({ error: "unauthorized" }, { status: 403 });
    }

    // Distinguish "env var not set" (unconfigured) from "set but unreachable"
    // (down). Previously we fell back to the literal string "unknown" and
    // then fetched "unknown${probePath}", which always TypeError'd and was
    // reported as agent=down — indistinguishable from a real network failure.
    const RAW_AGENT_URL = process.env.AGENT_URL || process.env.LANGGRAPH_DEPLOYMENT_URL;
    const AGENT_URL = RAW_AGENT_URL || "unknown";

    // Agent connectivity
    let agentStatus = "unknown";
    let agentDetail = "";
    if (!RAW_AGENT_URL) {
        agentStatus = "unconfigured";
        agentDetail = "AGENT_URL / LANGGRAPH_DEPLOYMENT_URL env var not set";
    } else {
        try {
            const res = await fetch(\`\${AGENT_URL}${probePath}\`, { signal: AbortSignal.timeout(3000) });
            agentStatus = res.ok ? "ok" : "error";
            agentDetail = \`HTTP \${res.status}\`;
        } catch (e: unknown) {
            agentStatus = "down";
            agentDetail = e instanceof Error ? e.message : String(e);
            console.error(\`[debug] agent probe failed (\${AGENT_URL}${probePath}): \${agentDetail}\`);
        }
    }

    const uptime = process.uptime();
    const mem = process.memoryUsage();

    return NextResponse.json({
        integration: "${args.slug}",
        uptime: \`\${Math.floor(uptime / 60)}m \${Math.floor(uptime % 60)}s\`,
        agent: { url: AGENT_URL, status: agentStatus, detail: agentDetail },
        memory: {
            rss: \`\${Math.round(mem.rss / 1024 / 1024)}MB\`,
            heapUsed: \`\${Math.round(mem.heapUsed / 1024 / 1024)}MB\`,
        },
        env: {
            NODE_ENV: process.env.NODE_ENV,
            OPENAI_API_KEY: process.env.OPENAI_API_KEY ? "set" : "NOT SET",
            ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? "set" : "NOT SET",
            LANGSMITH_API_KEY: process.env.LANGSMITH_API_KEY ? "set" : "NOT SET",
        },
        recentRequests: requestLog.slice(-20),
        nodeVersion: process.version,
    });
}
`;
}

function generateErrorBoundary(): string {
  return `"use client";

import React from "react";

interface ErrorBoundaryState { hasError: boolean; error: Error | null; }

export class DemoErrorBoundary extends React.Component<
    { children: React.ReactNode; demoName: string },
    ErrorBoundaryState
> {
    constructor(props: { children: React.ReactNode; demoName: string }) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error(\`[DemoErrorBoundary] \${this.props.demoName} crashed:\`, error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{
                    display: "flex", flexDirection: "column", alignItems: "center",
                    justifyContent: "center", height: "100vh", padding: "2rem",
                    fontFamily: "system-ui, sans-serif", color: "#888", textAlign: "center",
                }}>
                    <div style={{ fontSize: "48px", marginBottom: "16px" }}>Warning</div>
                    <h2 style={{ fontSize: "18px", fontWeight: 600, color: "#ccc", marginBottom: "8px" }}>
                        {this.props.demoName} — Demo Error
                    </h2>
                    <p style={{ fontSize: "14px", maxWidth: "400px", lineHeight: 1.5 }}>
                        The demo encountered an error. This usually means the agent backend is not responding.
                        Check the server logs and /api/health endpoint.
                    </p>
                    <pre style={{
                        marginTop: "16px", padding: "12px 16px", background: "#1a1a2e",
                        borderRadius: "8px", fontSize: "12px", color: "#f87171",
                        maxWidth: "500px", overflow: "auto", textAlign: "left",
                    }}>
                        {this.state.error?.message}
                    </pre>
                    <button
                        onClick={() => this.setState({ hasError: false, error: null })}
                        style={{
                            marginTop: "16px", padding: "8px 20px", background: "#333",
                            border: "1px solid #555", borderRadius: "8px", color: "#ccc",
                            cursor: "pointer", fontSize: "13px",
                        }}
                    >
                        Try Again
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}
`;
}

function generateDockerfile(args: CLIArgs): string {
  if (args.language === "typescript") {
    return `FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-slim AS runner
WORKDIR /app
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/public ./public

EXPOSE 10000
ENV NODE_ENV=production
CMD ["npm", "start"]
`;
  }

  return `# Stage 1: Build Next.js frontend
FROM node:20-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

# Stage 2: Production image with Node.js + Python
FROM python:3.12-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends \\
    curl && \\
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \\
    apt-get install -y nodejs && \\
    npm install -g corepack && \\
    corepack enable && \\
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Next.js build artifacts
COPY --from=frontend /app/.next ./.next
COPY --from=frontend /app/node_modules ./node_modules
COPY --from=frontend /app/package.json ./
COPY --from=frontend /app/public ./public

# Agent code
COPY src/agent_server.py ./
COPY src/app/demos/*/agent.py ./agents/

# Entrypoint
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

EXPOSE 10000
ENV NODE_ENV=production
CMD ["./entrypoint.sh"]
`;
}

function generateEntrypoint(args: CLIArgs): string {
  if (args.language === "typescript") {
    return `#!/bin/bash
exec npx next start --port \${PORT:-10000}
`;
  }

  return `#!/bin/bash
set -e

# Start agent backend
python -m uvicorn agent_server:app --host 0.0.0.0 --port 8000 &

# Start Next.js frontend
npx next start --port \${PORT:-10000} &

# Wait for either process to exit
wait -n
exit $?
`;
}

function generateSmokeRoute(args: CLIArgs): string {
  // Derive the default agentId from the package's primary feature so the
  // generated smoke route doesn't hard-code `agentic_chat` for every
  // package. If the caller didn't pass any --features we fall back to
  // "agentic_chat" and log a warning so the operator knows to replace it
  // before merging.
  //
  // TODO(operator): the agentId baked in below is a best-effort default.
  // Replace it with the real agent id your backend registers (e.g. the
  // string passed to `agent="…"` on <CopilotKit>) before shipping.
  const primaryFeature = args.features[0];
  let agentId: string;
  if (primaryFeature) {
    // Most agents register with an underscore id; the feature registry
    // uses hyphens. Normalize via toAgentId so the default is a
    // plausible backend key (and any rewrite is announced). The helper
    // is shared with generateDemoPage so the agent prop and SMOKE_AGENT_ID
    // stay in sync — see also the operator-replacement TODO in
    // src/app/api/smoke/route.ts.
    agentId = toAgentId(primaryFeature, "generateSmokeRoute");
  } else {
    agentId = "agentic_chat";
    console.warn(
      `[create-integration] generateSmokeRoute: no --features supplied for ${args.slug}; falling back to agentId="agentic_chat". Replace this with the real agent id before committing.`,
    );
  }

  return `import { NextResponse } from "next/server";

const INTEGRATION_SLUG = "${args.slug}";
// TODO(operator): replace the agentId below with the real agent id your
// backend registers. The generator chose "${agentId}" as a best-effort
// default based on the package's primary feature.
const SMOKE_AGENT_ID = "${agentId}";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
    const start = Date.now();
    // Hit our own /api/copilotkit endpoint — tests the full deployed stack
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL
        || \`http://localhost:\${process.env.PORT || 10000}\`;

    try {
        const res = await fetch(\`\${baseUrl}/api/copilotkit\`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                method: "agent/run",
                params: { agentId: SMOKE_AGENT_ID },
                body: {
                    threadId: \`smoke-\${Date.now()}\`,
                    runId: \`smoke-run-\${Date.now()}\`,
                    state: {},
                    messages: [
                        {
                            id: \`smoke-msg-\${Date.now()}\`,
                            role: "user",
                            content: "Respond with exactly: OK",
                        },
                    ],
                    tools: [],
                    context: [],
                    forwardedProps: {},
                },
            }),
            signal: AbortSignal.timeout(45000),
        });

        const latency = Date.now() - start;

        if (!res.ok) {
            const errBody = await res.text().catch(() => "");
            return NextResponse.json({
                status: "error",
                integration: INTEGRATION_SLUG,
                stage: "runtime_response",
                error: \`Runtime returned \${res.status}: \${errBody.slice(0, 200)}\`,
                latency_ms: latency,
                timestamp: new Date().toISOString(),
            }, { status: 502 });
        }

        // Response is SSE stream — just verify we got content
        const body = await res.text();
        if (body.length === 0) {
            return NextResponse.json({
                status: "error",
                integration: INTEGRATION_SLUG,
                stage: "response_empty",
                error: "Runtime returned empty response body",
                latency_ms: latency,
                timestamp: new Date().toISOString(),
            }, { status: 502 });
        }

        return NextResponse.json({
            status: "ok",
            integration: INTEGRATION_SLUG,
            latency_ms: latency,
            timestamp: new Date().toISOString(),
        });
    } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        const latency = Date.now() - start;

        let stage = "unknown";
        if (err.name === "AbortError" || err.name === "TimeoutError" || err.message.includes("timeout")) stage = "timeout";
        else if (err.message.includes("fetch") || err.message.includes("ECONNREFUSED")) stage = "agent_unreachable";
        else stage = "pipeline_error";

        return NextResponse.json({
            status: "error",
            integration: INTEGRATION_SLUG,
            stage,
            error: err.message,
            latency_ms: latency,
            timestamp: new Date().toISOString(),
        }, { status: 502 });
    }
}
`;
}

function generateEnvExample(args: CLIArgs): string {
  const lines = [
    "# API Keys (shared across integrations)",
    "OPENAI_API_KEY=sk-...",
    "ANTHROPIC_API_KEY=sk-ant-...",
    "",
  ];

  if (args.language !== "typescript") {
    lines.push("# Agent backend URL (for the CopilotKit runtime proxy)");
    lines.push("AGENT_URL=http://localhost:8000");
    lines.push("");
  }

  lines.push("# Showcase");
  lines.push("NEXT_PUBLIC_BASE_URL=http://localhost:3000");

  return lines.join("\n") + "\n";
}

function generateAgentServer(args: CLIArgs): string {
  if (args.language === "typescript") {
    return "";
  }

  return `"""
Agent Server for ${args.name}

FastAPI server that hosts the agent backend.
The Next.js CopilotKit runtime proxies requests here.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="${args.name} Agent Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok"}


# TODO: Add CopilotKit agent endpoint
# See the LangGraph Python reference implementation for patterns
# @app.post("/copilotkit")
# async def copilotkit(request: Request):
#     ...
`;
}

function generateRequirementsTxt(args: CLIArgs): string {
  if (args.language === "typescript") {
    return "";
  }

  return `fastapi>=0.115.0
uvicorn>=0.34.0
copilotkit>=0.1.0
# TODO: Add framework-specific dependencies
`;
}

function generateE2ETest(
  featureId: string,
  feature: Feature | undefined,
): string {
  return `import { test, expect } from "@playwright/test";

test.describe("${feature?.name || featureId}", () => {
    test("page loads and chat renders", async ({ page }) => {
        await page.goto("/demos/${featureId}");

        // Chat interface should be visible
        await expect(page.getByPlaceholder("Type a message")).toBeVisible();
    });

    test("can send a message and receive a response", async ({ page }) => {
        await page.goto("/demos/${featureId}");

        const input = page.getByPlaceholder("Type a message");
        await input.fill("Hello");
        await input.press("Enter");

        // Wait for agent response (adjust timeout as needed)
        await expect(page.locator('.copilotKitAssistantMessage').first()).toBeVisible({
            timeout: 30000,
        });
    });

    // TODO: Add feature-specific assertions
});
`;
}

function generateQATemplate(
  featureId: string,
  feature: Feature | undefined,
  args: CLIArgs,
): string {
  return `# QA: ${feature?.name || featureId} — ${args.name}

## Prerequisites
- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

### 1. Basic Functionality
- [ ] Navigate to the demo page
- [ ] Verify the chat interface loads
- [ ] Send a basic message
- [ ] Verify the agent responds

### 2. Feature-Specific Checks
- [ ] TODO: Add checks specific to ${feature?.name || featureId}

### 3. Error Handling
- [ ] Send an empty message (should be handled gracefully)
- [ ] Verify no console errors during normal usage

## Expected Results
- Chat loads within 3 seconds
- Agent responds within 10 seconds
- No UI errors or broken layouts
`;
}

function generatePlaywrightConfig(): string {
  return `import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
    testDir: "./tests/e2e",
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: "html",
    use: {
        baseURL: process.env.BASE_URL || "http://localhost:3000",
        trace: "on-first-retry",
    },
    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
        },
    ],
    webServer: process.env.CI
        ? undefined
        : {
              command: "pnpm dev",
              url: "http://localhost:3000",
              reuseExistingServer: true,
          },
});
`;
}

function generateNextConfig(): string {
  return `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    // Allow iframe embedding from the showcase shell
    async headers() {
        return [
            {
                source: "/(.*)",
                headers: [
                    {
                        key: "Content-Security-Policy",
                        value: "frame-ancestors *;",
                    },
                ],
            },
        ];
    },
};

export default nextConfig;
`;
}

function generateTsConfig(): string {
  return (
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2017",
          lib: ["dom", "dom.iterable", "esnext"],
          allowJs: true,
          skipLibCheck: true,
          strict: true,
          noEmit: true,
          esModuleInterop: true,
          module: "esnext",
          moduleResolution: "bundler",
          resolveJsonModule: true,
          isolatedModules: true,
          jsx: "preserve",
          incremental: true,
          plugins: [{ name: "next" }],
          paths: { "@/*": ["./src/*"] },
        },
        include: [
          "next-env.d.ts",
          "**/*.ts",
          "**/*.tsx",
          ".next/types/**/*.ts",
        ],
        exclude: ["node_modules"],
      },
      null,
      2,
    ) + "\n"
  );
}

function generateDockerComposeTest(): string {
  return `# Docker Compose stack for e2e smoke testing with aimock.
# Usage: docker compose -f docker-compose.test.yml up -d
services:
  aimock:
    image: ghcr.io/copilotkit/aimock:latest
    ports:
      - "4010:4010"
    volumes:
      - ./fixtures:/fixtures:ro
    command: ["--fixtures", "/fixtures", "--host", "0.0.0.0", "--validate-on-load"]

  app:
    build:
      context: .
      dockerfile: Dockerfile
      args:
        INSTALL_MODE: fresh
    ports:
      - "3000:3000"
    environment:
      - OPENAI_API_KEY=test-key-for-aimock
      - OPENAI_BASE_URL=http://aimock:4010/v1
    depends_on:
      aimock:
        condition: service_started
    healthcheck:
      test: ["CMD", "curl", "-sf", "http://localhost:3000/"]
      interval: 5s
      timeout: 5s
      retries: 30
      start_period: 60s
`;
}

function generateDefaultFixtures(slug: string): string {
  return JSON.stringify(
    {
      fixtures: [
        {
          match: { userMessage: "Hello" },
          response: {
            content: `Hello! I'm the ${slug} AI assistant. How can I help you?`,
          },
        },
        {
          match: {},
          response: {
            content:
              "You're currently running against aimock (a mock LLM server). This response is a catch-all for requests that don't match any test fixture. To use a real LLM: (1) Add your OPENAI_API_KEY to .env, (2) Remove or unset OPENAI_BASE_URL from your environment so requests go to OpenAI instead of aimock, (3) Restart with `pnpm dev`.",
          },
        },
      ],
    },
    null,
    2,
  );
}

function generateGitignore(): string {
  return `node_modules/
.next/
.env.local
.env
*.pyc
__pycache__/
.venv/
dist/
playwright-report/
test-results/
`;
}

function toPascalCase(str: string): string {
  return str
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
}

// Languages with fully-implemented generator branches. `dotnet` is declared
// in LANGUAGES so the CLI validates the surface, but no .NET-specific code
// path exists (Dockerfile, entrypoint, dev script, agent server, etc. all
// fall through to the Python paths). Running with --language dotnet would
// produce a broken package (Python Dockerfile, uvicorn dev script, .py
// agent server), so gate it behind an explicit allowlist.
const FULLY_SUPPORTED_LANGUAGES: readonly Language[] = [
  "typescript",
  "python",
] as const;

async function main() {
  const args = parseArgs();

  if (
    !(FULLY_SUPPORTED_LANGUAGES as readonly string[]).includes(args.language)
  ) {
    console.error(
      `Error: Language '${args.language}' is not yet supported by this generator. ` +
        `Supported: ${FULLY_SUPPORTED_LANGUAGES.join(", ")}.`,
    );
    process.exit(1);
  }

  const features = loadFeatureRegistry();

  // Fail fast on unknown feature ids. Without this check, a typo in the
  // --features flag silently produces manifest/demo entries with TODO
  // placeholder text (the default branch of getDemoInteraction etc.),
  // which then drift into PRs. Enumerate the valid ids so the user can
  // copy the correct value.
  const knownFeatureIds = new Set(features.map((f) => f.id));
  const unknownFeatures = args.features.filter(
    (id) => !knownFeatureIds.has(id),
  );
  if (unknownFeatures.length > 0) {
    const known = [...knownFeatureIds].sort().join(", ");
    console.error(
      `Error: Unknown feature id(s): ${unknownFeatures.join(", ")}.\nKnown ids: ${known}`,
    );
    process.exit(1);
  }

  const packageDir = path.join(PACKAGES_DIR, args.slug);

  const packageDirState = probePath(packageDir);
  if (packageDirState === "unreadable") {
    console.error(
      `Error: Package directory exists but is unreadable: ${packageDir}`,
    );
    process.exit(1);
  }
  if (packageDirState === "exists") {
    console.error(`Error: Package directory already exists: ${packageDir}`);
    process.exit(1);
  }

  console.log(`\nCreating integration package: ${args.name}\n`);
  console.log(`  Slug:     ${args.slug}`);
  console.log(`  Category: ${args.category}`);
  console.log(`  Language: ${args.language}`);
  console.log(`  Features: ${args.features.join(", ")}`);
  console.log("");

  // Validate CI workflows BEFORE writing the package tree so a regex
  // mismatch (layout drift in showcase_deploy.yml / test_smoke-starter.yml)
  // throws early rather than leaving a half-scaffolded package on disk that
  // the next run rejects via the packageDirState === "exists" guard above.
  // updateWorkflows() is self-contained — it reads only args and mutates
  // files in WORKFLOWS_DIR, so reordering is safe. Respect the same
  // CREATE_INTEGRATION_SKIP_WORKFLOWS opt-out here; the original call
  // below is now a no-op once workflows already include this slug
  // (idempotent re-run), and is retained as a safety net.
  if (process.env.CREATE_INTEGRATION_SKIP_WORKFLOWS === "1") {
    console.log(
      "--- Skipping CI workflow updates (CREATE_INTEGRATION_SKIP_WORKFLOWS=1) ---\n",
    );
  } else {
    console.log("--- Updating CI workflows ---\n");
    updateWorkflows(args);
    console.log("");
  }

  // Root files
  writeFile(
    path.join(packageDir, "manifest.yaml"),
    generateManifest(args, features),
  );
  writeFile(path.join(packageDir, "package.json"), generatePackageJson(args));
  writeFile(path.join(packageDir, "Dockerfile"), generateDockerfile(args));
  writeFile(path.join(packageDir, "entrypoint.sh"), generateEntrypoint(args));
  writeFile(path.join(packageDir, ".env.example"), generateEnvExample(args));
  writeFile(path.join(packageDir, ".gitignore"), generateGitignore());
  writeFile(path.join(packageDir, "next.config.ts"), generateNextConfig());
  writeFile(path.join(packageDir, "tsconfig.json"), generateTsConfig());
  writeFile(
    path.join(packageDir, "postcss.config.mjs"),
    generatePostcssConfig(),
  );
  writeFile(
    path.join(packageDir, "playwright.config.ts"),
    generatePlaywrightConfig(),
  );

  // E2E test infrastructure
  writeFile(
    path.join(packageDir, "docker-compose.test.yml"),
    generateDockerComposeTest(),
  );
  writeFile(
    path.join(packageDir, "fixtures", "default.json"),
    generateDefaultFixtures(args.slug),
  );

  if (args.language !== "typescript") {
    writeFile(
      path.join(packageDir, "requirements.txt"),
      generateRequirementsTxt(args),
    );
    writeFile(
      path.join(packageDir, "src", "agent_server.py"),
      generateAgentServer(args),
    );
  }

  // App source
  writeFile(
    path.join(packageDir, "src", "app", "layout.tsx"),
    generateLayout(),
  );
  writeFile(
    path.join(packageDir, "src", "app", "globals.css"),
    generateGlobalsCss(),
  );
  writeFile(
    path.join(packageDir, "src", "app", "page.tsx"),
    generateIndexPage(args, features),
  );
  writeFile(
    path.join(packageDir, "src", "app", "api", "copilotkit", "route.ts"),
    generateRuntimeRoute(args),
  );
  writeFile(
    path.join(packageDir, "src", "app", "api", "health", "route.ts"),
    generateHealthRoute(args),
  );
  writeFile(
    path.join(packageDir, "src", "app", "api", "debug", "route.ts"),
    generateDebugRoute(args),
  );
  writeFile(
    path.join(packageDir, "src", "app", "api", "smoke", "route.ts"),
    generateSmokeRoute(args),
  );
  writeFile(
    path.join(packageDir, "src", "app", "demos", "error-boundary.tsx"),
    generateErrorBoundary(),
  );

  // Demo stubs
  for (const featureId of args.features) {
    const feature = features.find((f) => f.id === featureId);
    writeFile(
      path.join(packageDir, "src", "app", "demos", featureId, "page.tsx"),
      generateDemoPage(featureId, feature),
    );
    writeFile(
      path.join(packageDir, "src", "app", "demos", featureId, "README.md"),
      generateDemoReadme(featureId, feature),
    );

    if (args.language !== "typescript") {
      writeFile(
        path.join(packageDir, "src", "app", "demos", featureId, "agent.py"),
        `"""
Agent implementation for ${feature?.name || featureId}

TODO: Implement the agent logic for ${args.name}
See the LangGraph Python reference implementation for patterns.
"""
`,
      );
    } else {
      writeFile(
        path.join(packageDir, "src", "app", "demos", featureId, "agent.ts"),
        `/**
 * Agent implementation for ${feature?.name || featureId}
 *
 * TODO: Implement the agent logic for ${args.name}
 * See the LangGraph Python reference implementation for patterns.
 */
`,
      );
    }

    // E2E test stub
    writeFile(
      path.join(packageDir, "tests", "e2e", `${featureId}.spec.ts`),
      generateE2ETest(featureId, feature),
    );

    // QA template
    writeFile(
      path.join(packageDir, "qa", `${featureId}.md`),
      generateQATemplate(featureId, feature, args),
    );
  }

  console.log(`\nPackage created at: showcase/packages/${args.slug}/`);

  // Auto-migrate agent code from examples/integrations/ if available
  console.log("\n--- Migrating agent code from examples/integrations/ ---\n");
  try {
    const { migrateForSlug } =
      await import("../migrate-integration-examples.js");
    const migResult = migrateForSlug(args.slug);

    if (migResult.errors.length > 0) {
      console.error(`  Migration FAILED for ${args.slug}:`);
      for (const err of migResult.errors) console.error(`    ${err}`);
      process.exit(1);
    } else if (migResult.files.length > 0) {
      console.log(
        `  Migrated ${migResult.files.length} agent files from examples/integrations/`,
      );
      for (const f of migResult.files) console.log(`    ${f}`);
    } else if (migResult.skipped.length > 0) {
      console.log(`  No migration needed: ${migResult.skipped[0]}`);
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    // Node sets `code` on module-resolution failures; narrow the
    // "skippable" branch to exactly those so real errors (TypeError,
    // SyntaxError, fs EACCES, etc.) surface as failures instead of
    // being swallowed with a misleading "skipped" message.
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") {
      // Route the skip notice to stderr so pipeline consumers that
      // capture stdout (for manifests, reports, etc.) still see it.
      console.error(`  Migration skipped (module not found): ${detail}`);
      console.error(
        "  (Run migrate-integration-examples.ts manually if needed)",
      );
    } else {
      console.error(`  Migration FAILED: ${detail}`);
      process.exit(1);
    }
  }

  // (CI workflow updates already ran pre-write at the top of main() so a
  // regex-mismatch fails before any filesystem mutation. Do not re-run
  // here — a second call would attempt a duplicate append and throw on
  // the options/outputs/filters anchored-idempotency checks.)

  console.log("\nNext steps:");
  console.log("  1. Write/customize the agent code in src/agents/");
  console.log(
    "  2. Pin framework deps to exact versions from the Dojo example",
  );
  console.log("  3. Fill in E2E test assertions");
  console.log(
    `  4. Deploy to Railway: npx tsx showcase/scripts/deploy-to-railway.ts ${args.slug}`,
  );
  console.log(
    `  5. Go live: npx tsx showcase/scripts/deploy-to-railway.ts --go-live ${args.slug}`,
  );
  console.log("  6. Open a PR to the monorepo\n");

  // Final warning: surface every feature that landed in the TODO
  // placeholder branches of getDemoInteraction / getDemoTechnicalDetails
  // so operators see them at the end of the run rather than hunting for
  // `TODO(` strings across the generated tree.
  if (unauthoredDemoFeatures.size > 0) {
    const ids = [...unauthoredDemoFeatures].sort();
    console.warn(
      `\nWARNING: ${ids.length} demo(s) used unauthored placeholder content:`,
    );
    for (const id of ids) {
      const demoPath = `showcase/packages/${args.slug}/src/app/demos/${id}/README.md`;
      console.warn(`  - ${id}  (edit: ${demoPath})`);
    }
    console.warn(
      "  Add switch cases to getDemoInteraction and getDemoTechnicalDetails",
    );
    console.warn(
      "  in showcase/scripts/create-integration/index.ts before shipping.\n",
    );
  }
}

export function updateWorkflows(args: CLIArgs) {
  const workflowsDir = WORKFLOWS_DIR;

  // 1. Update showcase_deploy.yml — add change detection + build job
  const deployPath = path.join(workflowsDir, "showcase_deploy.yml");
  const deployState = probePath(deployPath);
  if (deployState === "unreadable") {
    console.error(
      `Error: ${deployPath} exists but is unreadable; refusing to silently skip workflow update.`,
    );
    process.exit(1);
  }
  if (deployState === "missing") {
    console.warn(
      `  [WARN] ${deployPath} not found; skipping showcase_deploy.yml update.`,
    );
  }
  if (deployState === "exists") {
    let deploy = fs.readFileSync(deployPath, "utf-8");
    const slug = args.slug;
    const slugVar = slug.replace(/-/g, "_");

    // Add to workflow_dispatch options if not present. If the regex doesn't
    // match the expected structure, assert loudly rather than silently
    // shipping a no-op change to the workflow file.
    //
    // The indent of the appended line is derived from the LAST existing
    // `- <entry>` line in the block (captured as `$2`) instead of being
    // hardcoded, so a YAML reflow that changes the block's indent doesn't
    // produce a misaligned insertion.
    // Anchor to a full option list line (leading whitespace, `- <slug>`,
    // trailing whitespace, end-of-line). A bare `includes("- <slug>")`
    // collides against longer sibling slugs (adding `foo` when `foo-bar`
    // exists already matches `"- foo-bar"`) and against stray
    // occurrences in comments/env vars/step names.
    const optionRe = new RegExp(`^\\s+- ${escapeRegex(slug)}\\s*$`, "m");
    if (!optionRe.test(deploy)) {
      const before = deploy;
      deploy = deploy.replace(
        /(\s+options:\n(?:(\s+)- .+\n)+)/,
        `$1$2- ${slug}\n`,
      );
      if (deploy === before) {
        throw new Error(
          `updateWorkflows: failed to locate the 'options:' block in ${deployPath}. ` +
            "The workflow file layout may have changed; update the regex in updateWorkflows().",
        );
      }
    }

    // Anchor the outputs-block idempotency check to a line that starts
    // with `<slugVar>:` (optionally indented) — `includes("<slug>:")`
    // matches slug-shaped substrings inside env vars, step names, or
    // YAML comments and silently skips the insert. The guard MUST use
    // `slugVar` (underscore form) because the insertion below writes
    // `${slugVar}:` as the key; for hyphenated slugs (e.g.
    // `sales-dashboard` → `sales_dashboard`) matching on `slug`
    // (hyphen form) would never hit on a re-run and would duplicate
    // the outputs+filters entries every time. Mirrors the same fix
    // applied to the `build-<slugVar>:` idempotency regex below.
    const outputRe = new RegExp(`^\\s+${escapeRegex(slugVar)}:`, "m");
    if (!outputRe.test(deploy)) {
      // Add output (match only lines containing ${{ to avoid matching `steps:`).
      // The indent is captured from the last existing output entry and
      // reused below so YAML reflows don't desync the appended line.
      const beforeOutputs = deploy;
      deploy = deploy.replace(
        /(outputs:\n(?:(\s+)\w+:.*\$\{\{.*\n)+)/,
        `$1$2${slugVar}: \${{ steps.changes.outputs.${slugVar} }}\n`,
      );
      if (deploy === beforeOutputs) {
        throw new Error(
          `updateWorkflows: failed to locate the 'outputs:' block in ${deployPath}. ` +
            "The workflow file layout may have changed; update the regex in updateWorkflows().",
        );
      }
      // Add filter. Two indents matter here: the filter key's own indent
      // (captured at the `<slug>:` line via `$2`) and the nested list
      // entry indent (captured via `$3`). Both are pulled from the last
      // existing filter block so the new entry tracks any reflow.
      const beforeFilters = deploy;
      deploy = deploy.replace(
        /(filters: \|\n(?:(\s+)\w+:\n(?:(\s+)- .+\n)+)+)/,
        `$1$2${slugVar}:\n$3- 'showcase/packages/${slug}/**'\n`,
      );
      if (deploy === beforeFilters) {
        throw new Error(
          `updateWorkflows: failed to locate the 'filters:' block in ${deployPath}. ` +
            "The workflow file layout may have changed; update the regex in updateWorkflows().",
        );
      }
    }

    // Add build job if not present. Anchor to `^\s*build-<slugVar>:` at
    // start of a line so a longer sibling slug (e.g. `build-foo_bar` when
    // adding `foo`) or an incidental `build-foo` mention inside a
    // comment, env var, or step name doesn't silently skip the insert.
    // Mirrors the anchored idempotency checks above at lines 1852/1871.
    const buildJobRe = new RegExp(`^\\s*build-${escapeRegex(slugVar)}:`, "m");
    if (!buildJobRe.test(deploy)) {
      const buildJob = `
  build-${slugVar}:
    name: Build & Push ${args.name}
    needs: [detect-changes, check-lockfile]
    if: |
      needs.detect-changes.outputs.${slugVar} == 'true' ||
      github.event.inputs.service == '${slug}' ||
      github.event.inputs.service == 'all'
    runs-on: ubuntu-latest
    timeout-minutes: 15
    permissions:
      packages: write
    steps:
      - uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}

      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: showcase/packages/${slug}
          push: true
          tags: |
            ghcr.io/copilotkit/showcase-${slug}:latest
            ghcr.io/copilotkit/showcase-${slug}:\${{ github.sha }}
          cache-from: type=gha,scope=${slugVar}
          cache-to: type=gha,scope=${slugVar},mode=max

      - name: Trigger Railway deploy
        run: |
          if [ "\${SERVICE_ID:-RAILWAY_SERVICE_ID}" = "RAILWAY_SERVICE_ID" ] \\
             || [ "\${ENV_ID:-RAILWAY_ENVIRONMENT_ID}" = "RAILWAY_ENVIRONMENT_ID" ]; then
            echo "::error::Railway placeholders not replaced" >&2
            exit 1
          fi
          curl -sf -X POST https://backboard.railway.com/graphql/v2 \\
            -H "Authorization: Bearer \${{ secrets.RAILWAY_TOKEN }}" \\
            -H "Content-Type: application/json" \\
            -d '{"query":"mutation { serviceInstanceRedeploy(serviceId: \\"RAILWAY_SERVICE_ID\\", environmentId: \\"RAILWAY_ENVIRONMENT_ID\\") }"}' \\
            && echo "${slug} deploy triggered"
`;
      deploy += buildJob;
      console.warn(
        `  [WARN] Appended build-${slugVar} job to showcase_deploy.yml with placeholder serviceId "RAILWAY_SERVICE_ID" and environmentId "RAILWAY_ENVIRONMENT_ID".`,
      );
      console.warn(
        '         Replace "RAILWAY_SERVICE_ID" and "RAILWAY_ENVIRONMENT_ID" with the real Railway ids before committing.',
      );
    }

    fs.writeFileSync(deployPath, deploy);
    console.log("  Updated showcase_deploy.yml");
  }

  // 2. showcase_drift-detection.yml was replaced by the showcase-ops
  // service's aimock_wiring / image-drift probes; no per-integration
  // workflow edit is needed anymore. The probes enumerate services from
  // Railway at runtime.

  // 3. Update starter-smoke.yml — add to matrix (block sequence format)
  const smokePath = path.join(workflowsDir, "starter-smoke.yml");
  const smokeState = probePath(smokePath);
  if (smokeState === "unreadable") {
    console.error(
      `Error: ${smokePath} exists but is unreadable; refusing to silently skip workflow update.`,
    );
    process.exit(1);
  }
  if (smokeState === "missing") {
    console.warn(
      `  [WARN] ${smokePath} not found; skipping starter-smoke.yml update.`,
    );
  }
  if (smokeState === "exists") {
    let smoke = fs.readFileSync(smokePath, "utf-8");
    const slug = args.slug;

    // The matrix uses YAML block sequence format:
    //   starter:
    //     - langgraph-python
    //     - mastra
    // Find the last `- <slug>` entry after `starter:` under `matrix:` and append.
    const lines = smoke.split("\n");
    let lastEntryIndex = -1;
    let inStarterBlock = false;
    let sawStarterBlock = false;
    let slugAlreadyPresent = false;
    let entryIndent = "";

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s+starter:\s*$/.test(line)) {
        inStarterBlock = true;
        sawStarterBlock = true;
        continue;
      }
      if (inStarterBlock) {
        // Skip blank lines and YAML comments inside the block rather
        // than treating them as the end of the sequence — either one
        // can appear between list items without actually closing the
        // block, and bailing early produced an "append to previous"
        // placement that subtly broke formatting (and, for a comment
        // line at the top of the block, no-op'd the insertion).
        if (line.trim() === "" || /^\s*#/.test(line)) {
          continue;
        }
        const entryMatch = line.match(/^(\s+- )\S/);
        if (entryMatch) {
          lastEntryIndex = i;
          entryIndent = entryMatch[1];
          if (line.trim() === `- ${slug}`) {
            // Idempotent re-run — the slug is already wired into the
            // matrix. Flag it distinctly from the "no entries" /
            // "no block" error branches below; previously this path
            // set `lastEntryIndex = -1` and fell into the same else
            // branch as the zero-entries degenerate case, producing
            // a misleading "block has zero entries" error on the
            // second generator run against the same slug.
            slugAlreadyPresent = true;
            break;
          }
        } else {
          // End of block sequence — a non-indented key (or any other
          // line that isn't a list entry, blank, or comment) closes
          // the sequence.
          break;
        }
      }
    }

    if (slugAlreadyPresent) {
      console.info(
        `  test_smoke-starter.yml: slug "${slug}" already present in starter matrix, skipping.`,
      );
    } else if (lastEntryIndex >= 0) {
      lines.splice(lastEntryIndex + 1, 0, `${entryIndent}${slug}`);
      smoke = lines.join("\n");
      fs.writeFileSync(smokePath, smoke);
      console.log("  Updated starter-smoke.yml");
    } else if (!sawStarterBlock) {
      // The file exists but our regex-based parser could not find a
      // `starter:` block to append to. Symmetric with the deploy/drift
      // branches above: throw so a starter can't silently ship without
      // smoke-test coverage. Operators can set
      // CREATE_INTEGRATION_SKIP_WORKFLOWS=1 to skip the workflow-edit
      // pass entirely, or edit the workflow file manually after.
      throw new Error(
        `updateWorkflows: failed to locate the 'starter:' block in ${smokePath}. ` +
          "The workflow file layout may have changed; update the parser in updateWorkflows().",
      );
    } else {
      // Degenerate case: the `starter:` block was located but contains
      // zero entries, so we have no existing `- <slug>` line to derive
      // indentation from and no insertion point to append after.
      // Without this guard the append silently no-ops and the new
      // starter ships without smoke coverage. Auto-seeding the first
      // entry is intentionally out of scope — the indentation for a
      // fresh block depends on workflow layout we shouldn't guess at.
      // The operator hand-seeds the first entry once; subsequent
      // starters append normally.
      throw new Error(
        `updateWorkflows: found 'starter:' block in ${smokePath} but it has zero entries; ` +
          "cannot determine indentation or insertion point. Hand-seed at least one " +
          "existing entry in the block before running create-integration.",
      );
    }
  }
}

// Only run main() when executed directly (tsx / node). Importing this
// module for tests must not trigger argv parsing / filesystem writes.
// Resolve both sides through path.resolve so symlinks introduced by tsx
// shims, pnpm, and bin links don't break the comparison (a raw ===
// check compares the physical path from import.meta.url against argv[1]
// which can be a symlink — they never match and main() silently
// no-ops). Mirrors the pattern used in validate-parity.ts. argv[1] is
// `undefined` when the module is imported via `node -e` / dynamic
// import without an entrypoint script, so short-circuit in that case
// to avoid a TypeError out of path.resolve.
if (process.argv[1]) {
  const invokedAs = path.resolve(process.argv[1]);
  const modulePath = path.resolve(fileURLToPath(import.meta.url));
  if (invokedAs === modulePath) {
    // Attach a top-level .catch so any rejected promise out of main()
    // surfaces with a diagnostic prefix and a stable exit code rather
    // than an UnhandledPromiseRejection warning (or, under
    // --unhandled-rejections=strict, a silent non-zero exit with no
    // stderr). Mirrors the [INTERNAL ERROR] / exit-4 convention used
    // by audit.ts and validate-parity.ts.
    main().catch((err) => {
      const message =
        err instanceof Error ? (err.stack ?? err.message) : String(err);
      console.error(
        `[INTERNAL ERROR] create-integration crashed: ${message}`,
      );
      process.exitCode = 4;
    });
  }
}
