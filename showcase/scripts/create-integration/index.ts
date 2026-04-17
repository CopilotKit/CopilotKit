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
 *     --features agentic-chat,hitl,tool-rendering
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "..", "..");
const PACKAGES_DIR = path.join(ROOT, "packages");
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
  category: string;
  language: string;
  features: string[];
  extraDeps: string[];
}

function parseArgs(): CLIArgs {
  const args = process.argv.slice(2);
  const parsed: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const val = args[i + 1];
      if (val && !val.startsWith("--")) {
        parsed[key] = val;
        i++;
      }
    }
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
    console.error(
      "  --category   One of: popular, agent-framework, enterprise-platform, provider-sdk, protocol, emerging, starter",
    );
    console.error("  --language   One of: python, typescript, dotnet");
    console.error(
      "  --features   Comma-separated feature IDs (e.g. 'agentic-chat,hitl,tool-rendering')",
    );
    console.error("\nOptional flags:");
    console.error(
      "  --deps       Extra npm dependencies (e.g. '@ag-ui/mastra,@mastra/core')",
    );
    process.exit(1);
  }

  return {
    name: parsed.name,
    slug: parsed.slug,
    category: parsed.category,
    language: parsed.language,
    features: parsed.features.split(",").map((f) => f.trim()),
    extraDeps: parsed.deps ? parsed.deps.split(",").map((d) => d.trim()) : [],
  };
}

function loadFeatureRegistry(): Feature[] {
  const raw = fs.readFileSync(FEATURE_REGISTRY_PATH, "utf-8");
  return JSON.parse(raw).features;
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
  const devCmd =
    args.language === "typescript"
      ? '"dev": "next dev --turbopack"'
      : '"dev": "concurrently \\"next dev --turbopack\\" \\"python -m uvicorn agent_server:app --host 0.0.0.0 --port 8000 --reload\\""';

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
                        __html: \\\`
                            console.log('[showcase] Demo loaded:', window.location.href);
                            console.log('[showcase] In iframe:', window.self !== window.top);
                            window.addEventListener('error', function(e) {
                                console.error('[showcase] Uncaught error:', e.message, e.filename, e.lineno);
                            });
                            window.addEventListener('unhandledrejection', function(e) {
                                console.error('[showcase] Unhandled rejection:', e.reason);
                            });
                        \\\`,
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
  args: CLIArgs,
): string {
  return `"use client";

import React from "react";
import { CopilotKit } from "@copilotkit/react-core";
import {
    CopilotChat,
    useFrontendTool,
    useRenderTool,
    useAgentContext,
    useConfigureSuggestions,
    useHumanInTheLoop,
    useInterrupt,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { DemoErrorBoundary } from "../error-boundary";

export default function ${toPascalCase(featureId)}Demo() {
    return (
        <DemoErrorBoundary demoName="${feature?.name || featureId}">
            <CopilotKit runtimeUrl="/api/copilotkit" agent="${featureId}">
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
}

function getDemoInteraction(featureId: string): string {
  switch (featureId) {
    case "tool-rendering":
      return `- "What's the weather like in San Francisco?"
- "Check the weather in Tokyo and New York"
- "Can you look up the current conditions in London?"`;
    case "hitl":
      return `- "Change the background color to a warm sunset gradient"
- "Set the theme to dark mode"
- "Make the background a calming blue-green gradient"

When the agent proposes an action, you'll see an approval prompt. Click **Approve** to let it proceed or **Reject** to cancel.`;
    case "gen-ui-tool-based":
      return `- "What's the weather forecast for this week in San Francisco?"
- "Show me the weather in Paris"
- "Compare the weather in Tokyo and London"

The agent generates structured data via tools, and the frontend renders it as rich UI components.`;
    default:
      return `- "TODO: Add example prompts"
- "TODO: Add more examples"`;
  }
}

function getDemoTechnicalDetails(featureId: string): string {
  switch (featureId) {
    case "tool-rendering":
      return `- **Backend tools** are defined in the agent (e.g., \\\`get_weather\\\`) and called by the LLM when the user's query matches
- **\\\`useRenderTool\\\`** on the frontend registers a React component that renders whenever the agent calls that tool
- The render function receives \\\`args\\\` (input parameters), \\\`result\\\` (tool output), and \\\`status\\\` ("executing" or "complete") so the UI can show loading states
- The tool result is displayed as a rich UI card instead of plain text — demonstrating how agent actions can produce structured, visual output`;
    case "hitl":
      return `- **Human-in-the-Loop (HITL)** lets the agent propose actions that require user approval before execution
- The agent calls a tool (like \\\`change_background\\\`), and CopilotKit intercepts it to show a confirmation dialog
- \\\`useHumanInTheLoop\\\` registers a frontend tool with \\\`requireConfirmation: true\\\`, adding the approval step
- The user sees what the agent wants to do (with the proposed arguments) and can approve or reject
- This pattern is essential for high-stakes actions — database writes, API calls, or any irreversible operation`;
    case "gen-ui-tool-based":
      return `- **Generative UI** means the agent's tool calls produce structured data that the frontend renders as custom React components
- Unlike plain text responses, the agent returns tool results with typed parameters (city, temperature, conditions)
- \\\`useRenderTool\\\` maps each tool name to a React component, so \\\`get_weather\\\` renders a weather card with icons, temperature displays, and forecast details
- The agent decides when to call the tool based on context — it can mix tool-based UI generation with regular text responses
- This pattern enables agents to create dynamic, data-driven interfaces on demand`;
    default:
      return `- TODO: Describe the technical implementation
- TODO: Explain the hooks and components used
- TODO: Note any framework-specific patterns`;
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

Content rendered inside CopilotKit's chat area (via \\\`useRenderTool\\\`, \\\`useHumanInTheLoop\\\`, \\\`useFrontendTool\\\`) runs inside CopilotKit's component tree. Standard Tailwind classes may not work here because Tailwind v4 can't statically detect them.

**Use inline styles** for any UI rendered inside the chat:

\\\`\\\`\\\`tsx
// Do this
<div style={{ padding: "24px", borderRadius: "12px", background: "#fff" }}>

// Not this — Tailwind may purge these classes
<div className="p-6 rounded-xl bg-white">
\\\`\\\`\\\`

### Chat Layout

Wrap \\\`CopilotChat\\\` in a constraining div for proper spacing:

\\\`\\\`\\\`tsx
<div className="flex justify-center items-center h-screen w-full">
    <div className="h-full w-full md:w-4/5 md:h-4/5 rounded-lg">
        <CopilotChat className="h-full rounded-2xl max-w-6xl mx-auto" />
    </div>
</div>
\\\`\\\`\\\`

### Overriding CopilotKit Styles

CopilotKit uses \\\`cpk:\\\` prefixed classes internally. To override them, create a **separate CSS file** (not in globals.css — Tailwind purges it):

\\\`\\\`\\\`css
/* copilotkit-overrides.css */
.copilotKitInput {
    border-radius: 0.75rem;
    border: 1px solid var(--copilot-kit-separator-color) !important;
}
\\\`\\\`\\\`

Import it in \\\`layout.tsx\\\` after \\\`globals.css\\\`.

### Images and Icons

- Don't reference local image files from agent-generated content (they won't exist). Add \\\`onError\\\` fallbacks.
- Use emoji instead of SVG icons inside chat messages (\\\`fill="currentColor"\\\` renders unpredictably in the chat context).

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
    ? "N/A (in-process)"
    : isLangGraph
      ? "http://localhost:8123"
      : "http://localhost:8000";

  // LangGraph Platform exposes /ok; our backends expose /health
  const probePath = isLangGraph ? "/ok" : "/health";

  return `import { NextRequest, NextResponse } from "next/server";

const AGENT_URL = process.env.AGENT_URL || process.env.LANGGRAPH_DEPLOYMENT_URL || "${agentUrl}";

export async function GET(req: NextRequest) {
    // Check agent backend reachability
    let agentStatus = "unknown";
    try {
        const res = await fetch(\`\${AGENT_URL}${probePath}\`, { signal: AbortSignal.timeout(3000) });
        agentStatus = res.ok ? "ok" : "error";
    } catch {
        agentStatus = "down";
    }

    // Public response: safe to expose
    const publicResponse: Record<string, any> = {
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
            agent_url: AGENT_URL,
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

    const AGENT_URL = process.env.AGENT_URL || process.env.LANGGRAPH_DEPLOYMENT_URL || "unknown";

    // Agent connectivity
    let agentStatus = "unknown";
    let agentDetail = "";
    try {
        const res = await fetch(\`\${AGENT_URL}${probePath}\`, { signal: AbortSignal.timeout(3000) });
        agentStatus = res.ok ? "ok" : "error";
        agentDetail = \`HTTP \${res.status}\`;
    } catch (e: any) {
        agentStatus = "down";
        agentDetail = e.message;
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
  return `import { NextResponse } from "next/server";

const INTEGRATION_SLUG = "${args.slug}";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
    const start = Date.now();
    // Hit our own /api/copilotkit endpoint — tests the full deployed stack
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL
        || \\\`http://localhost:\${process.env.PORT || 10000}\\\`;

    try {
        const res = await fetch(\\\`\${baseUrl}/api/copilotkit\\\`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                method: "agent/run",
                params: { agentId: "agentic_chat" },
                body: {
                    threadId: \\\`smoke-\${Date.now()}\\\`,
                    runId: \\\`smoke-run-\${Date.now()}\\\`,
                    state: {},
                    messages: [
                        {
                            id: \\\`smoke-msg-\${Date.now()}\\\`,
                            role: "user",
                            content: "Respond with exactly: OK",
                        },
                    ],
                    tools: [],
                    context: [],
                    forwardedProps: {},
                },
            }),
            signal: AbortSignal.timeout(25000),
        });

        const latency = Date.now() - start;

        if (!res.ok) {
            const errBody = await res.text().catch(() => "");
            return NextResponse.json({
                status: "error",
                integration: INTEGRATION_SLUG,
                stage: "runtime_response",
                error: \\\`Runtime returned \${res.status}: \${errBody.slice(0, 200)}\\\`,
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
        if (err.name === "AbortError" || err.message.includes("timeout")) stage = "timeout";
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
        await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
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
                        key: "X-Frame-Options",
                        value: "ALLOWALL",
                    },
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

async function main() {
  const args = parseArgs();
  const features = loadFeatureRegistry();
  const packageDir = path.join(PACKAGES_DIR, args.slug);

  if (fs.existsSync(packageDir)) {
    console.error(`Error: Package directory already exists: ${packageDir}`);
    process.exit(1);
  }

  console.log(`\nCreating integration package: ${args.name}\n`);
  console.log(`  Slug:     ${args.slug}`);
  console.log(`  Category: ${args.category}`);
  console.log(`  Language: ${args.language}`);
  console.log(`  Features: ${args.features.join(", ")}`);
  console.log("");

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
      generateDemoPage(featureId, feature, args),
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
  } catch (e: any) {
    console.log(`  Migration skipped: ${e.message}`);
    console.log("  (Run migrate-integration-examples.ts manually if needed)");
  }

  // Auto-update CI workflows to include this integration
  console.log("\n--- Updating CI workflows ---\n");
  updateWorkflows(args);

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
}

function updateWorkflows(args: CLIArgs) {
  const workflowsDir = path.resolve(ROOT, "..", ".github", "workflows");

  // 1. Update showcase_deploy.yml — add change detection + build job
  const deployPath = path.join(workflowsDir, "showcase_deploy.yml");
  if (fs.existsSync(deployPath)) {
    let deploy = fs.readFileSync(deployPath, "utf-8");
    const slug = args.slug;
    const slugVar = slug.replace(/-/g, "_");

    // Add to workflow_dispatch options if not present
    if (!deploy.includes(`- ${slug}`)) {
      deploy = deploy.replace(
        /(\s+options:\n(?:\s+- .+\n)+)/,
        `$1          - ${slug}\n`,
      );
    }

    // Add change detection filter if not present
    if (!deploy.includes(`${slug}:`)) {
      // Add output (match only lines containing ${{ to avoid matching `steps:`)
      deploy = deploy.replace(
        /(outputs:\n(?:\s+\w+:.*\$\{\{.*\n)+)/,
        `$1      ${slugVar}: \${{ steps.changes.outputs.${slugVar} }}\n`,
      );
      // Add filter
      deploy = deploy.replace(
        /(filters: \|\n(?:\s+\w+:\n(?:\s+- .+\n)+)+)/,
        `$1            ${slugVar}:\n              - 'showcase/packages/${slug}/**'\n`,
      );
    }

    // Add build job if not present
    if (!deploy.includes(`build-${slugVar}`)) {
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
          curl -sf -X POST https://backboard.railway.com/graphql/v2 \\
            -H "Authorization: Bearer \${{ secrets.RAILWAY_TOKEN }}" \\
            -H "Content-Type: application/json" \\
            -d '{"query":"mutation { serviceInstanceRedeploy(serviceId: \\"RAILWAY_SERVICE_ID\\", environmentId: \\"b14919f4-6417-429f-848d-c6ae2201e04f\\") }"}' \\
            && echo "${slug} deploy triggered"
`;
      deploy += buildJob;
    }

    fs.writeFileSync(deployPath, deploy);
    console.log("  Updated showcase_deploy.yml");
  }

  // 2. Update showcase_drift-detection.yml — add to E2E matrix
  const driftPath = path.join(workflowsDir, "showcase_drift-detection.yml");
  if (fs.existsSync(driftPath)) {
    let drift = fs.readFileSync(driftPath, "utf-8");
    const slug = args.slug;

    if (!drift.includes(`slug: ${slug}`)) {
      // Add to matrix includes
      const entry = `          - slug: ${slug}\n            name: "${args.name}"\n            url: https://showcase-${slug}-production.up.railway.app`;
      drift = drift.replace(
        /(matrix:\n\s+include:\n(?:\s+- slug:.*\n\s+name:.*\n\s+url:.*\n)+)/,
        `$1${entry}\n`,
      );
      fs.writeFileSync(driftPath, drift);
      console.log("  Updated showcase_drift-detection.yml");
    }
  }

  // 3. Update starter-smoke.yml — add to matrix (block sequence format)
  const smokePath = path.join(workflowsDir, "starter-smoke.yml");
  if (fs.existsSync(smokePath)) {
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
    let entryIndent = "";

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s+starter:\s*$/.test(line)) {
        inStarterBlock = true;
        continue;
      }
      if (inStarterBlock) {
        const entryMatch = line.match(/^(\s+- )\S/);
        if (entryMatch) {
          lastEntryIndex = i;
          entryIndent = entryMatch[1];
          if (line.trim() === `- ${slug}`) {
            // Already present
            lastEntryIndex = -1;
            break;
          }
        } else {
          // End of block sequence
          break;
        }
      }
    }

    if (lastEntryIndex >= 0) {
      lines.splice(lastEntryIndex + 1, 0, `${entryIndent}${slug}`);
      smoke = lines.join("\n");
      fs.writeFileSync(smokePath, smoke);
      console.log("  Updated starter-smoke.yml");
    }
  }
}

main();
