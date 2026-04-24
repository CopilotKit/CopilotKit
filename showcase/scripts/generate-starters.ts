/**
 * Generate self-contained starter projects for each showcase framework.
 *
 * Combines the canonical template frontend with per-framework agent backends
 * to produce standalone clonable starters at showcase/starters/<slug>/.
 *
 * Dockerfiles are emitted from
 * ``showcase/starters/template/dockerfiles/Dockerfile.{typescript,python,
 * java,dotnet}`` as true multi-stage builds: a builder stage carries the
 * full language toolchain (node, pip, maven, dotnet-sdk) and produces
 * compiled/bundled artifacts, a runtime stage ships only a minimal base
 * (node:22-slim, python:3.12-slim, eclipse-temurin:21-jre,
 * mcr.microsoft.com/dotnet/aspnet:9.0) plus the built artifacts. No
 * `pip install`, `pnpm install`, `tsx`, or `*-cli dev` invocations run
 * in the runtime stage — cold start is a straight `node`/`python`/`java`
 * /`dotnet` invocation. Target: ≥40% runtime image-size reduction per
 * slug versus the pre-multi-stage baseline.
 *
 * Per-slug prod-mode compiles (claude-sdk-typescript `tsc`, mastra
 * `mastra build`) are emitted via getAgentBuildSteps() (builder-stage
 * compile commands) and getAgentBuildCopy() (runtime-stage COPY of the
 * compiled artifacts) and substituted into the TS template via the
 * AGENT_BUILD_STEPS / AGENT_BUILD_COPY tokens. Frameworks without a
 * compile step emit empty strings for both — the template falls through
 * to a plain `node`/`npm start` invocation.
 *
 * Local `docker build` MUST pass `--platform linux/amd64`; the deploy
 * workflow (.github/workflows/showcase_deploy.yml) pins the same platform
 * so arm64-only artifacts never reach Railway/GHCR.
 *
 * Usage:
 *   npx tsx generate-starters.ts [--slug langgraph-python] [--dry-run] [--check]
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import * as os from "node:os";
import { pathToFileURL } from "node:url";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SHOWCASE = path.join(ROOT, "showcase");
const TEMPLATE_DIR = path.join(SHOWCASE, "starters", "template");
const STARTERS_DIR = path.join(SHOWCASE, "starters");
const PACKAGES_DIR = path.join(SHOWCASE, "packages");
const SHARED_PYTHON_DIR = path.join(SHOWCASE, "shared", "python");
const SHARED_TS_DIR = path.join(SHOWCASE, "shared", "typescript", "tools");

// Shared regex for rewriting AGENT_URL port 8000 -> 8123 during .env.example
// propagation from packages/ to starters/. Exported so the consistency test
// (showcase/scripts/__tests__/starter-consistency.test.ts) can import this
// exact pattern instead of duplicating a near-copy that drifts. The host
// portion is deliberately scoped to localhost / 127.0.0.1 so documented
// corporate gateways or Azure endpoints on port 8000 are never clobbered.
const AGENT_URL_LOCALHOST_8000_RE = makeAgentUrlLocalhostPortRE(8000);

/**
 * Factory for AGENT_URL host-scoped port matchers. Produces a regex that
 * matches lines of the form `AGENT_URL=http(s)://(localhost|127.0.0.1):<port>`
 * (global+multiline). The consistency test uses this to assert the generator
 * rewrote the documented 8000 port to 8123 in starters — previously that side
 * did `.source.replace(/8000\b/, "8123\b")` string munging which is brittle.
 * Keeping the construction here means a single edit to the host allowlist
 * propagates to every caller.
 */
export function makeAgentUrlLocalhostPortRE(port: number): RegExp {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(
      `makeAgentUrlLocalhostPortRE: port must be a positive integer ≤ 65535, got ${port}`,
    );
  }
  return new RegExp(
    `^(AGENT_URL\\s*=\\s*https?:\\/\\/(?:localhost|127\\.0\\.0\\.1):)${port}\\b`,
    "gm",
  );
}

// Replace floating dist-tags (like 'beta', 'next') with known-good version
// ranges for reproducible Docker installs. The monorepo lockfile keeps the
// demo packages stable, but starters run `npm install` from scratch and can
// hit version drift.
const PIN_OVERRIDES: Record<string, Record<string, string>> = {
  mastra: {
    "@ag-ui/mastra": "0.2.1-beta.2",
    "@mastra/client-js": "^1.13.4",
    "@mastra/core": "^1.25.0",
    "@mastra/libsql": "^1.8.1",
    "@mastra/memory": "^1.15.1",
    mastra: "^1.6.0",
  },
};

// ---------------------------------------------------------------------------
// Framework definitions
// ---------------------------------------------------------------------------

interface FrameworkDef {
  slug: string;
  name: string;
  language: "python" | "typescript" | "java" | "csharp";
  agentSourceDir: string;
  agentDir: string; // Output dir name in generated starter
  devScript: string;
  extraFiles?: Record<string, string>; // destPath -> sourcePath (relative to package dir)
  extraDependencies?: Record<string, string>; // Additional npm dependencies to merge into package.json
  // When true, the generator preserves the slug's existing
  // ``showcase/starters/<slug>/entrypoint.sh`` verbatim across regeneration
  // instead of overwriting it with the shared ``entrypoint.template.sh``
  // output. Used by multi-provider starters (e.g. langroid) whose boot
  // sequence diverges from the OpenAI-hardcoded template UX. The existing
  // file IS the source of truth — editing it is how you change behavior.
  entrypointOverride?: boolean;
}

const FRAMEWORKS: FrameworkDef[] = [
  {
    slug: "langgraph-python",
    name: "LangGraph Python",
    language: "python",
    agentSourceDir: "src/agents",
    agentDir: "src/agents",
    devScript:
      'concurrently "next dev --turbopack" "python -m langgraph_cli dev --config langgraph.json --host 0.0.0.0 --port 8123 --no-browser"',
    extraFiles: { "langgraph.json": "langgraph.json" },
  },
  {
    slug: "langgraph-fastapi",
    name: "LangGraph FastAPI",
    language: "python",
    agentSourceDir: "src/agents",
    agentDir: "src/agents",
    devScript:
      'concurrently "next dev --turbopack" "python -m langgraph_cli dev --config langgraph.json --host 0.0.0.0 --port 8123 --no-browser"',
    extraFiles: { "langgraph.json": "langgraph.json" },
  },
  {
    slug: "langgraph-typescript",
    name: "LangGraph TypeScript",
    language: "typescript",
    agentSourceDir: "src/agent",
    agentDir: "agent",
    devScript:
      'concurrently "next dev --turbopack" "npx @langchain/langgraph-cli dev --config agent/langgraph.json --host 0.0.0.0 --port 8123 --no-browser"',
    // Agent runtime deps — langgraph-cli loads agent/graph.ts in its own
    // module context and needs these to resolve. Previously these lived
    // only in `agent/package.json`, which the typescript Dockerfile
    // deliberately deletes (to collapse the ESM package boundary between
    // the Next.js frontend and the agent subtree). Without merging them
    // into the top-level package.json, the runtime import of graph.ts
    // fails with `Cannot find module '@langchain/openai'` and the agent
    // never starts listening on 8123, so /api/health stays at
    // `agent: "down"`. @langchain/langgraph-cli is here too so `npx`
    // resolves the binary out of /app/node_modules rather than
    // re-downloading it on every container boot.
    extraDependencies: {
      "@copilotkit/sdk-js": "1.51.4",
      "@langchain/core": "^1.0.1",
      "@langchain/langgraph": "1.0.2",
      "@langchain/langgraph-checkpoint": "1.0.0",
      "@langchain/langgraph-cli": "^1.1.17",
      "@langchain/openai": "^1.1.3",
    },
  },
  {
    slug: "pydantic-ai",
    name: "Pydantic AI",
    language: "python",
    agentSourceDir: "src/agents",
    agentDir: "agent",
    devScript:
      'concurrently "next dev --turbopack" "python -m uvicorn agent_server:app --host 0.0.0.0 --port 8123 --reload"',
  },
  {
    slug: "crewai-crews",
    name: "CrewAI Crews",
    language: "python",
    agentSourceDir: "src/agents",
    agentDir: "agent",
    devScript:
      'concurrently "next dev --turbopack" "python -m uvicorn agent_server:app --host 0.0.0.0 --port 8123 --reload"',
  },
  {
    slug: "ag2",
    name: "AG2",
    language: "python",
    agentSourceDir: "src/agents",
    agentDir: "agent",
    devScript:
      'concurrently "next dev --turbopack" "python -m uvicorn agent_server:app --host 0.0.0.0 --port 8123 --reload"',
  },
  {
    slug: "agno",
    name: "Agno",
    language: "python",
    agentSourceDir: "src/agents",
    agentDir: "agent",
    devScript:
      'concurrently "next dev --turbopack" "python -m uvicorn agent_server:app --host 0.0.0.0 --port 8123 --reload"',
  },
  {
    slug: "google-adk",
    name: "Google ADK",
    language: "python",
    agentSourceDir: "src/agents",
    agentDir: "agent",
    devScript:
      'concurrently "next dev --turbopack" "python -m uvicorn agent_server:app --host 0.0.0.0 --port 8123 --reload"',
  },
  {
    slug: "langroid",
    name: "Langroid",
    language: "python",
    agentSourceDir: "src/agents",
    agentDir: "agent",
    devScript:
      'concurrently "next dev --turbopack" "python -m uvicorn agent_server:app --host 0.0.0.0 --port 8123 --reload"',
    // langroid is multi-provider: the starter entrypoint selects the
    // credential env var from LANGROID_MODEL rather than hard-coding
    // OPENAI_API_KEY. Keep the committed file as the source of truth.
    entrypointOverride: true,
  },
  {
    slug: "llamaindex",
    name: "LlamaIndex",
    language: "python",
    agentSourceDir: "src/agents",
    agentDir: "agent",
    devScript:
      'concurrently "next dev --turbopack" "python -m uvicorn agent_server:app --host 0.0.0.0 --port 8123 --reload"',
  },
  {
    slug: "strands",
    name: "Strands",
    language: "python",
    agentSourceDir: "src/agents",
    agentDir: "agent",
    devScript:
      'concurrently "next dev --turbopack" "python -m uvicorn agent_server:app --host 0.0.0.0 --port 8123 --reload"',
  },
  {
    slug: "mastra",
    name: "Mastra",
    language: "typescript",
    agentSourceDir: "src/mastra",
    agentDir: "src/mastra",
    devScript: 'concurrently "next dev --turbopack" "PORT=8123 npx mastra dev"',
    extraDependencies: {
      "@ag-ui/mastra": "beta",
      "@ai-sdk/openai": "^2.0.42",
      "@libsql/client": "^0.15.15",
      "@mastra/client-js": "beta",
      "@mastra/core": "beta",
      "@mastra/libsql": "beta",
      "@mastra/memory": "beta",
      ai: "^4.0.0",
      libsql: "^0.5.22",
      mastra: "beta",
    },
  },
  {
    slug: "claude-sdk-python",
    name: "Claude SDK Python",
    language: "python",
    agentSourceDir: "src/agents",
    agentDir: "agent",
    devScript:
      'concurrently "next dev --turbopack" "python -m uvicorn agent_server:app --host 0.0.0.0 --port 8123 --reload"',
  },
  {
    slug: "claude-sdk-typescript",
    name: "Claude SDK TypeScript",
    language: "typescript",
    agentSourceDir: "src/agent",
    agentDir: "agent",
    devScript: 'concurrently "next dev --turbopack" "npx tsx agent/index.ts"',
    extraDependencies: {
      "@ag-ui/core": "^0.0.48",
      "@ag-ui/encoder": "^0.0.48",
      "@anthropic-ai/sdk": "^0.57.0",
      dotenv: "^16.4.0",
      express: "^4.21.0",
    },
  },
  {
    slug: "ms-agent-python",
    name: "Microsoft Agent Python",
    language: "python",
    agentSourceDir: "src/agents",
    agentDir: "agent",
    devScript:
      'concurrently "next dev --turbopack" "python -m uvicorn agent_server:app --host 0.0.0.0 --port 8123 --reload"',
  },
  {
    slug: "ms-agent-dotnet",
    name: "Microsoft Agent .NET",
    language: "csharp",
    agentSourceDir: "agent",
    agentDir: "agent",
    devScript:
      'concurrently "next dev --turbopack" "cd agent && dotnet run --urls http://0.0.0.0:8123"',
  },
  {
    slug: "spring-ai",
    name: "Spring AI",
    language: "java",
    agentSourceDir: "src/main",
    agentDir: "agent",
    devScript:
      'concurrently "next dev --turbopack" "cd agent && ./mvnw spring-boot:run -Dspring-boot.run.arguments=--server.port=8123"',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function copyDirSync(src: string, dest: string): void {
  if (!fs.existsSync(src)) {
    throw new Error(`copyDirSync: source directory missing: ${src}`);
  }
  fs.mkdirSync(dest, { recursive: true });

  const entries = fs.readdirSync(src, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (
      entry.name === "__pycache__" ||
      entry.name === "node_modules" ||
      entry.name === ".next" ||
      entry.name === "__tests__"
    ) {
      continue;
    }

    // Resolve symlinks — follow them and copy real content
    let realPath: string;
    let stat: fs.Stats;
    try {
      realPath = fs.realpathSync(srcPath);
      stat = fs.statSync(realPath);
    } catch (e: unknown) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        console.warn(
          `  [warn] Broken symlink or missing: ${srcPath} — skipping`,
        );
        continue;
      }
      throw e;
    }

    if (stat.isDirectory()) {
      copyDirSync(realPath, destPath);
    } else if (stat.isFile()) {
      fs.copyFileSync(realPath, destPath);
    }
  }
}

function substituteVars(content: string, vars: Record<string, string>): string {
  let result = content;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }
  const remaining = result.match(/\{\{[A-Z_]+\}\}/g);
  if (remaining) {
    // NOTE: warn-and-pass-through rather than throw. Callers of
    // substituteVars include partial-vars callers (tests,
    // processTemplateVarsInDir scanning JSON/CSS/HTML that may contain
    // ``{{literal}}`` tokens unrelated to our template vars). The
    // callers that REQUIRE full replacement — e.g. the Dockerfile and
    // entrypoint.template.sh writes in generateStarterImpl — already
    // feed a complete ``vars`` map; unreplaced tokens there surface in
    // integration tests or the ``diff -r`` drift check.
    console.warn(
      `  [warn] Unreplaced template variables: ${remaining.join(", ")}`,
    );
  }
  return result;
}

function rewritePythonImports(filePath: string): void {
  if (!filePath.endsWith(".py")) return;
  let content = fs.readFileSync(filePath, "utf-8");

  // Line-based removal of sys.path.insert blocks.
  // Track paren depth to handle multi-line calls.
  const lines = content.split("\n");
  const result: string[] = [];
  let parenDepth = 0;
  let inSysPathBlock = false;
  // Track which line indices to skip (import sys/os before sys.path.insert)
  const skipIndices = new Set<number>();

  // First pass: find sys.path.insert blocks and mark surrounding import sys/os
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimStart().startsWith("sys.path.insert(")) {
      inSysPathBlock = true;
      parenDepth = 0;
      // Look back to mark import sys / import os
      for (let j = i - 1; j >= 0; j--) {
        const trimmed = lines[j].trim();
        if (trimmed === "") continue;
        if (trimmed === "import sys" || trimmed === "import os") {
          skipIndices.add(j);
        } else {
          break;
        }
      }
    }

    if (inSysPathBlock) {
      skipIndices.add(i);
      for (const ch of lines[i]) {
        if (ch === "(") parenDepth++;
        if (ch === ")") parenDepth--;
      }
      if (parenDepth <= 0) {
        inSysPathBlock = false;
      }
    }
  }

  // Before removing `import os`, check if `os` is used elsewhere in non-skipped lines.
  // If so, keep the `import os` line so the file doesn't break.
  const osImportIndices: number[] = [];
  for (const idx of skipIndices) {
    if (lines[idx].trim() === "import os") {
      osImportIndices.push(idx);
    }
  }
  if (osImportIndices.length > 0) {
    // Check if `os` is referenced in any non-skipped, non-import-os line
    const osUsed = lines.some(
      (line, i) => !skipIndices.has(i) && /\bos\b/.test(line),
    );
    if (osUsed) {
      // Keep import os lines — don't skip them
      for (const idx of osImportIndices) {
        skipIndices.delete(idx);
      }
    }
  }

  // After stripping the sys.path.insert block, any remaining top-level
  // `import sys` becomes unused — the shared-tools bootstrap was the ONLY
  // use of `sys` in these generated files. Mirror the `osUsed` logic:
  // scan non-skipped lines for a reference to ``sys`` and, if none exists,
  // mark every standalone ``import sys`` line for removal too. This keeps
  // the regenerated starter import block tidy (no dead ``import sys``
  // lingering once generate-starters is re-run).
  const sysImportIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (skipIndices.has(i)) continue;
    if (lines[i].trim() === "import sys") {
      sysImportIndices.push(i);
    }
  }
  if (sysImportIndices.length > 0) {
    const sysImportSet = new Set(sysImportIndices);
    const sysUsed = lines.some(
      (line, i) =>
        !skipIndices.has(i) && !sysImportSet.has(i) && /\bsys\b/.test(line),
    );
    if (!sysUsed) {
      for (const idx of sysImportIndices) {
        skipIndices.add(idx);
      }
    }
  }

  for (let i = 0; i < lines.length; i++) {
    if (!skipIndices.has(i)) {
      result.push(lines[i]);
    }
  }

  content = result.join("\n");

  // Clean up multiple blank lines
  content = content.replace(/\n{3,}/g, "\n\n");

  // Rewrite "from tools import ..." — context-dependent:
  // Files inside tools/ directory: "from tools import X" → "from . import X"
  // Files outside tools/ directory: "from tools import X" → "from .tools import X"
  const insideTools = filePath.includes("/tools/");
  const pkgPrefix = insideTools ? "." : ".tools";
  const subPrefix = insideTools ? "." : ".tools.";
  content = content.replace(
    /^from tools import /gm,
    `from ${pkgPrefix} import `,
  );
  content = content.replace(
    /^from tools\.(\w+) import /gm,
    `from ${subPrefix}$1 import `,
  );

  // Rewrite "from src.agents.X import ..." to "from .X import ..."
  // This handles main.py style imports like "from src.agents.tools import ..."
  content = content.replace(
    /^(\s*)from src\.agents\.([\w.]+) import /gm,
    "$1from .$2 import ",
  );

  // Rewrite "from agents.X import ..." to "from .X import ..."
  // When the demo "agents/" dir is renamed to "agent/" in starters,
  // intra-package absolute imports break. Convert to relative imports.
  content = content.replace(
    /^(\s*)from agents\.([\w.]+) import /gm,
    "$1from .$2 import ",
  );

  fs.writeFileSync(filePath, content);
}

function rewriteTypeScriptSharedImports(
  filePath: string,
  agentDestDir: string,
  starterOutDir?: string,
): void {
  if (!filePath.endsWith(".ts") && !filePath.endsWith(".tsx")) return;
  let content = fs.readFileSync(filePath, "utf-8");

  // Compute correct relative path from file to shared-tools dir
  const fileDir = path.dirname(filePath);
  const sharedToolsDir = path.join(agentDestDir, "shared-tools");
  let relativePath = path.relative(fileDir, sharedToolsDir);
  // Ensure it starts with ./ for files at the same level
  if (!relativePath.startsWith(".")) {
    relativePath = "./" + relativePath;
  }

  // Rewrite @copilotkit/showcase-shared-tools to correct relative path
  content = content.replace(
    /@copilotkit\/showcase-shared-tools/g,
    relativePath,
  );

  // Rewrite Next.js path aliases (@/...) to relative imports.
  // In the source packages, @/ maps to src/ via tsconfig paths. But tools
  // like mastra dev use rollup which doesn't resolve tsconfig aliases.
  if (starterOutDir) {
    const srcDir = path.join(starterOutDir, "src");
    content = content.replace(
      /from\s+["']@\/([^"']+)["']/g,
      (_match, aliasPath) => {
        const targetPath = path.join(srcDir, aliasPath);
        let relPath = path.relative(fileDir, targetPath);
        if (!relPath.startsWith(".")) {
          relPath = "./" + relPath;
        }
        return `from "${relPath}"`;
      },
    );
  }

  fs.writeFileSync(filePath, content);
}

/**
 * Extract the uvicorn module path (e.g. "agent_server:app") from a framework's
 * devScript. Falls back to "agent.main:app" if no uvicorn invocation is found.
 */
function extractUvicornModule(fw: FrameworkDef): string {
  const match = fw.devScript.match(/uvicorn\s+([\w.:]+)/);
  if (!match) {
    // Non-uvicorn devScripts (e.g. langgraph-python uses langgraph_cli)
    // legitimately have no uvicorn module — fall back to the conventional
    // default. This helper is currently called only by tests; the real
    // entrypoint block is built by getEntrypointBlock with a hardcoded
    // module path per language. If future callers require strict
    // extraction, gate that at the call site rather than here.
    console.warn(
      `  [warn] Could not extract uvicorn module from devScript for ${fw.slug}, using default "agent.main:app"`,
    );
  }
  return match ? match[1] : "agent.main:app";
}

const AGENT_HEALTH_CHECK = `if kill -0 $AGENT_PID 2>/dev/null; then
  echo "[entrypoint] Agent server started (PID: $AGENT_PID)"
else
  echo "[entrypoint] ERROR: Agent server failed to start — exiting"
  exit 1
fi`;

/**
 * Per-framework agent health URL (probed by the silent-hang watchdog).
 *
 * The watchdog runs AFTER the initial startup check, while the agent is
 * serving traffic on its starter-local port (8123). Mapping: each framework's
 * HTTP health endpoint path as verified against the source:
 *   * FastAPI / uvicorn agents (ag2, agno, claude-sdk-python, crewai-crews,
 *     google-adk, langroid, llamaindex, ms-agent-python, pydantic-ai, strands)
 *     -> /health (served via middleware short-circuit in agent_server.py)
 *   * langgraph-python, langgraph-fastapi, langgraph-typescript
 *     -> /ok (exposed by langgraph_cli dev)
 *   * claude-sdk-typescript -> /health (express app.get("/health"))
 *   * ms-agent-dotnet -> /health (app.MapGet("/health", ...))
 *   * spring-ai -> /health (custom @GetMapping in AgentController)
 *   * mastra -> /health (Mastra pre-built server exposes GET /health
 *                        returning {"success":true} with HTTP 200)
 */
function getAgentHealthPath(fw: FrameworkDef): string {
  if (fw.slug.startsWith("langgraph-")) return "/ok";
  if (fw.slug === "mastra") return "/health";
  return "/health";
}

/**
 * Emit the silent-hang watchdog block. Runs as a backgrounded subshell after
 * the agent PID is captured and before Next.js starts. Polls the agent's
 * health endpoint every 30s; after 3 consecutive failures (~90s of
 * unreachable agent), kills the agent so `wait -n` returns and Railway/ECS
 * restart the container.
 *
 * Generalized from showcase/packages/crewai-crews/entrypoint.sh (commits
 * 9ce651330 + 9379b8855) which proved the shape in production.
 *
 * Parameters (substituted into the emitted shell):
 *   - AGENT_HEALTH_URL: the `http://127.0.0.1:<agent-port><health-path>` URL
 *     the watchdog probes. Computed per-framework from getAgentHealthPath().
 *
 * Consumes shell vars defined earlier in the entrypoint:
 *   - $AGENT_PID: captured after backgrounded agent launch. All frameworks'
 *     getEntrypointBlock() outputs set this.
 */
/**
 * Per-framework startup grace (seconds) — how long the watchdog waits after
 * agent spawn before its first strike counts. Lets slow-starting agents
 * reach their health endpoint without the 90s (3-strike) watchdog killing
 * the process in a restart loop.
 *
 * `langgraph-*` agents use `langgraph-cli dev`, which on first boot does a
 * Studio browser handshake + `@langchain/langgraph-api` JIT spawn + graph
 * compile; on cold Railway containers this routinely exceeds the 90s
 * strike threshold, producing the 04-20 restart loop on deployment
 * 58bbebe8-7a94-4f99-b6e4-ffcbb4eb78b9. 180s is the observed upper bound
 * across cold-start samples plus a safety margin.
 *
 * `mastra` starters use the pre-built Mastra server, which starts in ~2s
 * locally. 30s grace is generous margin for Railway cold containers.
 *
 * `claude-sdk-typescript` starters spawn `tsx agent/index.ts` which
 * performs a full tsx type-strip + @anthropic-ai/claude-agent-sdk init;
 * observed restart-looping on Railway starting 04-20 16:54 UTC on the
 * package-level deploy (same generator-emitted watchdog shape).
 *
 * All other starters keep the 0s grace they had before PR #4116: crewai-
 * crews and the other uvicorn-based agents are responsive within the
 * 2–3s `sleep` that precedes `AGENT_HEALTH_CHECK`, so adding a grace
 * here would only delay legitimate restart on true hangs.
 */
function getWatchdogGraceSeconds(fw: FrameworkDef): number {
  if (fw.slug.startsWith("langgraph-")) return 180;
  if (fw.slug === "mastra") return 30;
  if (fw.slug === "claude-sdk-typescript") return 180;
  return 0;
}

function getWatchdogBlock(fw: FrameworkDef): string {
  const healthPath = getAgentHealthPath(fw);
  const agentPort = 8123; // Starter agents all bind to :8123.
  const healthUrl = `http://127.0.0.1:${agentPort}${healthPath}`;
  const graceSeconds = getWatchdogGraceSeconds(fw);
  // Grace loop: wait for first successful health probe up to `graceSeconds`
  // before handing off to the steady-state strike counter. If the agent
  // reports ready sooner, fall through immediately so the watchdog becomes
  // effective as early as possible. If the agent hasn't reported ready by
  // the deadline, still hand off — the watchdog will then strike and kill
  // per normal, but only after giving slow cold-starts a fair shot.
  //
  // We deliberately do NOT `exit 1` on grace timeout (contrast with
  // spring-ai's startup wait which exits): an agent that's still loading
  // after 180s might just be a very cold container, and the steady-state
  // watchdog handles the true-hang case in another 90s.
  const graceBlock =
    graceSeconds > 0
      ? `  GRACE=${graceSeconds}
  echo "[watchdog] Startup grace: waiting up to \${GRACE}s for first successful health probe before arming strike counter"
  ELAPSED=0
  while [ $ELAPSED -lt $GRACE ]; do
    if ! kill -0 $AGENT_PID 2>/dev/null; then
      # Agent died during startup — wait -n in the main shell will handle it.
      exit 0
    fi
    if curl -fsS --max-time 5 ${healthUrl} > /dev/null 2>&1; then
      echo "[watchdog] Agent healthy after \${ELAPSED}s — arming strike counter"
      break
    fi
    sleep 5
    ELAPSED=$((ELAPSED + 5))
  done
  if [ $ELAPSED -ge $GRACE ]; then
    echo "[watchdog] Grace window elapsed without successful probe — arming strike counter anyway"
  fi
`
      : "";
  return `# Watchdog: Railway deploys of showcase starters have been observed to hit a
# silent agent hang — the agent process stays alive (so \`wait -n\` never
# fires and the container never restarts) but stops responding on its health
# endpoint. Poll every 30s; after 3 consecutive failures (~90s of
# unreachable agent), kill the agent so \`wait -n\` returns and the platform
# restarts the container. We kill the agent (not the whole script) so
# \`set -e\` + \`wait -n; exit $?\` handles the restart through the normal
# path rather than a forced \`exit\` that bypasses logging.
#
# Some frameworks (langgraph-*) have slow cold-start paths that can exceed
# the 90s strike budget on a fresh Railway container. For those, an
# initial startup-grace window waits for the first healthy probe (or a
# per-framework ceiling) before the strike counter is armed. See
# getWatchdogGraceSeconds() for the mapping.
(
${graceBlock}  FAILS=0
  while sleep 30; do
    if ! kill -0 $AGENT_PID 2>/dev/null; then
      # Agent already dead — wait -n in the main shell will handle it.
      break
    fi
    if curl -fsS --max-time 5 ${healthUrl} > /dev/null 2>&1; then
      FAILS=0
    else
      FAILS=$((FAILS + 1))
      echo "[watchdog] Agent health probe failed (count=$FAILS)"
      if [ $FAILS -ge 3 ]; then
        echo "[watchdog] Agent unresponsive for ~90s — killing PID $AGENT_PID to trigger container restart"
        kill -9 $AGENT_PID 2>/dev/null || true
        break
      fi
    fi
  done
) &
WATCHDOG_PID=$!
echo "[entrypoint] Watchdog started (PID: $WATCHDOG_PID, probing ${healthUrl}${graceSeconds > 0 ? `, startup grace ${graceSeconds}s` : ""})"`;
}

// Previously the entrypoint used:
//
//   cmd 2>&1 | sed 's/^/[agent] /' &
//   AGENT_PID=$!
//
// After a pipeline, `$!` points to the LAST command in the pipe (the `sed`
// process), not the agent. Every subsequent `kill -0 $AGENT_PID` and
// `wait -n $AGENT_PID` was therefore monitoring `sed`, which stays alive
// until its stdin closes — long after the agent has crashed. That masked
// real crashes from the health probe and kept the container "alive" while
// the agent was dead. `sed` also line-buffers by default, so a stack trace
// emitted at module import could sit in userspace memory until the pipe
// closed and never reach the container log.
//
// Process substitution (`&> >(awk …)`) redirects both streams without
// creating a pipeline, so `$!` remains the agent's PID. `awk` with
// `fflush()` line-flushes each prefixed line so crash output reaches the
// container log immediately. Paired with `PYTHONUNBUFFERED=1` in
// entrypoint.template.sh so Python-based agents don't buffer before awk.
const AGENT_LOG_PREFIX = `&> >(awk '{print "[agent] " $0; fflush()}')`;

function getEntrypointBlock(fw: FrameworkDef): string {
  switch (fw.language) {
    case "python":
      if (fw.slug === "langgraph-python" || fw.slug === "langgraph-fastapi") {
        // `python -u` forces unbuffered stdout/stderr at the interpreter
        // level so langgraph_cli boot failures surface in the log stream
        // immediately (paired with PYTHONUNBUFFERED=1 in the template).
        return `echo "[entrypoint] Starting LangGraph agent server on port 8123..."
python -u -m langgraph_cli dev \\
  --config langgraph.json \\
  --host 0.0.0.0 \\
  --port 8123 \\
  --no-browser ${AGENT_LOG_PREFIX} &
AGENT_PID=$!
sleep 3
${AGENT_HEALTH_CHECK}`;
      }
      // `python -u` pairs with PYTHONUNBUFFERED=1: the env var exports the
      // hint, the `-u` flag forces unbuffered streams at the interpreter
      // level (not overridable by user code), and `awk ... fflush()` in
      // AGENT_LOG_PREFIX line-flushes the prefixer. Combined, a silent
      // crash during module import reaches the container log immediately.
      // See crewai-crews entrypoint.sh for the reference shape.
      return `echo "[entrypoint] Starting Python agent server on port 8123..."
cd /app && python -u -m uvicorn agent_server:app --host 0.0.0.0 --port 8123 ${AGENT_LOG_PREFIX} &
AGENT_PID=$!
sleep 2
${AGENT_HEALTH_CHECK}`;
    case "typescript":
      if (fw.slug === "langgraph-typescript") {
        return `echo "[entrypoint] Starting LangGraph TS agent on port 8123..."
npx @langchain/langgraph-cli dev \\
  --config agent/langgraph.json \\
  --host 0.0.0.0 \\
  --port 8123 \\
  --no-browser ${AGENT_LOG_PREFIX} &
AGENT_PID=$!
sleep 3
${AGENT_HEALTH_CHECK}`;
      }
      if (fw.slug === "mastra") {
        // Prod-mode: the Dockerfile frontend stage runs `mastra build` which
        // bundles the Mastra server into `.mastra/output/index.mjs`. Booting
        // via `node` (instead of `npx mastra dev`) skips the tsx-based
        // first-request build path that was blowing past the 180s watchdog
        // grace on Railway cold containers — same failure class as
        // langgraph-typescript pre-#4132. The per-slug build step lives in
        // getAgentBuildSteps() above.
        return `echo "[entrypoint] Starting Mastra agent on port 8123..."
PORT=8123 node /app/.mastra/output/index.mjs ${AGENT_LOG_PREFIX} &
AGENT_PID=$!
sleep 3
${AGENT_HEALTH_CHECK}`;
      }
      if (fw.slug === "claude-sdk-typescript") {
        // Prod-mode: the Dockerfile frontend stage runs `tsc` over
        // agent/index.ts into /app/dist/agent/index.js so boot is a straight
        // `node` invocation. Previous `npx tsx agent/index.ts` did a full
        // in-process TS compile on every cold start and was blowing past
        // the 180s watchdog grace on Railway (same class as langgraph-ts
        // pre-#4132). Flags in getAgentBuildSteps() match the package.
        return `echo "[entrypoint] Starting TypeScript agent on port 8123..."
PORT=8123 node /app/dist/agent/index.js ${AGENT_LOG_PREFIX} &
AGENT_PID=$!
sleep 2
${AGENT_HEALTH_CHECK}`;
      }
      return `echo "[entrypoint] Starting TypeScript agent on port 8123..."
npx tsx agent/index.ts ${AGENT_LOG_PREFIX} &
AGENT_PID=$!
sleep 2
${AGENT_HEALTH_CHECK}`;
    case "java":
      // Spring Boot cold-start can legitimately exceed 30s under load (JVM
      // warmup + context refresh), so a plain `sleep 5` + PID check would
      // falsely pass the startup gate while /health is not yet serving.
      // Probe /health for up to 60s before handing off to the watchdog
      // which then takes over steady-state monitoring. If the java process
      // dies during startup, the PID probe inside the loop fails-fast so
      // a crash-looping boot exits quickly.
      return `echo "[entrypoint] Starting Spring AI agent on port 8123..."
java -jar agent/app.jar --server.port=8123 ${AGENT_LOG_PREFIX} &
AGENT_PID=$!
STARTUP_TIMEOUT=60
echo "[entrypoint] Waiting for Spring Boot /health (timeout=\${STARTUP_TIMEOUT}s)..."
SPRING_READY=0
for i in $(seq 1 "$STARTUP_TIMEOUT"); do
  if curl -fsS --max-time 5 http://127.0.0.1:8123/health > /dev/null 2>&1; then
    echo "[entrypoint] Spring Boot ready after \${i}s"
    SPRING_READY=1
    break
  fi
  if ! kill -0 "$AGENT_PID" 2>/dev/null; then
    echo "[entrypoint] ERROR: Spring Boot (pid=$AGENT_PID) died during startup"
    exit 1
  fi
  sleep 1
done
if [ "$SPRING_READY" -ne 1 ]; then
  if kill -0 "$AGENT_PID" 2>/dev/null; then
    echo "[entrypoint] ERROR: Spring Boot still alive (pid=$AGENT_PID) but /health did not return 2xx within \${STARTUP_TIMEOUT}s — exiting"
  else
    echo "[entrypoint] ERROR: Spring Boot exited before reporting healthy"
  fi
  exit 1
fi
${AGENT_HEALTH_CHECK}`;
    case "csharp":
      return `echo "[entrypoint] Starting .NET agent on port 8123..."
cd agent && dotnet ProverbsAgent.dll --urls http://0.0.0.0:8123 ${AGENT_LOG_PREFIX} &
AGENT_PID=$!
cd /app
sleep 3
${AGENT_HEALTH_CHECK}`;
  }
}

/**
 * Per-slug Dockerfile build steps emitted in the frontend (builder) stage,
 * AFTER `npm run build` (the Next.js build). Lets TS starters whose agents
 * need a prod-mode compile push that work off the cold-start hot path.
 *
 * Pairs with getAgentBuildCopy() (runs in the runner stage) and with
 * getEntrypointBlock() (invokes the compiled artifact at boot).
 *
 * Only emitted for TS starters that explicitly opt in — other slugs get ""
 * and their Dockerfile rebuild cache stays identical to pre-change.
 *
 * Mirrors PR #4132's langgraph-typescript fix: dev-mode `npx tsx` / `mastra
 * dev` at container boot was doing a fresh in-process TS compile on every
 * cold start, routinely blowing past the 180s watchdog grace on Railway
 * cold containers. Pushing the compile to image build time turns cold
 * start into a straight `node` invocation.
 */
function getAgentBuildSteps(fw: FrameworkDef): string {
  if (fw.slug === "claude-sdk-typescript") {
    // Compile agent/index.ts → /app/dist/agent/index.js. Flags match
    // showcase/packages/claude-sdk-typescript/Dockerfile so starter and
    // package produce equivalent runtime shapes.
    return `# Compile TypeScript agent server to JS so boot is a straight \`node\` call
# instead of \`npx tsx\` (which does a fresh in-process TS compile on each
# cold start). Flags match showcase/packages/claude-sdk-typescript/Dockerfile
# so the starter and package produce equivalent runtime shapes. See also
# getAgentBuildSteps() in showcase/scripts/generate-starters.ts.
RUN npx tsc --outDir /app/dist --rootDir . \\
    --module commonjs --moduleResolution node \\
    --target es2020 --esModuleInterop true --skipLibCheck true \\
    agent/index.ts
`;
  }
  if (fw.slug === "mastra") {
    // Run `mastra build` which bundles the server into
    // .mastra/output/index.mjs. The runner stage then invokes it via
    // `node` so cold start doesn't pay the tsx-based first-request build.
    return `# Build Mastra application to .mastra/output/index.mjs so boot is a
# straight \`node\` call instead of \`npx mastra dev\` (which does a
# tsx-based build on first request — observed blowing past 180s watchdog
# grace on Railway, same failure class as langgraph-typescript pre-#4132).
# See also getAgentBuildSteps() in showcase/scripts/generate-starters.ts.
RUN npx mastra build --dir src/mastra
`;
  }
  return "";
}

/**
 * Per-slug Dockerfile COPY lines emitted in the runner stage AFTER the base
 * agent-code COPY. Moves compiled artifacts produced by getAgentBuildSteps()
 * from the frontend stage into the runner image.
 */
function getAgentBuildCopy(fw: FrameworkDef): string {
  if (fw.slug === "claude-sdk-typescript") {
    return `# Precompiled agent entry (from frontend stage). entrypoint.sh invokes
# \`node /app/dist/agent/index.js\` instead of \`npx tsx agent/index.ts\`.
COPY --chown=app:app --from=frontend /app/dist ./dist
`;
  }
  if (fw.slug === "mastra") {
    return `# Precompiled Mastra server (from frontend stage). entrypoint.sh invokes
# \`node /app/.mastra/output/index.mjs\` instead of \`npx mastra dev\`.
COPY --chown=app:app --from=frontend /app/.mastra ./.mastra
`;
  }
  return "";
}

// ---------------------------------------------------------------------------
// Copy shared Python tools into agent dir (making it self-contained)
// ---------------------------------------------------------------------------

function copySharedPythonTools(agentDestDir: string): void {
  const toolsSrc = path.join(SHARED_PYTHON_DIR, "tools");
  if (!fs.existsSync(toolsSrc)) {
    throw new Error(`Shared Python tools directory missing: ${toolsSrc}`);
  }
  const toolsDest = path.join(agentDestDir, "tools");
  copyDirSync(toolsSrc, toolsDest);

  // Copy data/db.csv
  const dataSrc = path.join(SHARED_PYTHON_DIR, "data");
  const dataDest = path.join(agentDestDir, "data");
  copyDirSync(dataSrc, dataDest);

  // Remove test files from the copied tools
  const testDir = path.join(toolsDest, "__tests__");
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Copy shared TypeScript tools into agent dir
// ---------------------------------------------------------------------------

function copySharedTypeScriptTools(agentDestDir: string): void {
  const toolsSrc = SHARED_TS_DIR;
  const toolsDest = path.join(agentDestDir, "shared-tools");

  if (!fs.existsSync(toolsSrc)) {
    throw new Error(`Shared TypeScript tools directory missing: ${toolsSrc}`);
  }

  fs.mkdirSync(toolsDest, { recursive: true });

  const entries = fs.readdirSync(toolsSrc).sort();
  for (const entry of entries) {
    if (entry === "__tests__" || entry === "node_modules") continue;
    const srcPath = path.join(toolsSrc, entry);
    const destPath = path.join(toolsDest, entry);
    if (fs.statSync(srcPath).isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }

  // Also copy the data/db.csv for queryData
  const dataSrc = path.join(SHARED_PYTHON_DIR, "data");
  const dataDest = path.join(agentDestDir, "data");
  if (fs.existsSync(dataSrc)) {
    copyDirSync(dataSrc, dataDest);
  }
}

// ---------------------------------------------------------------------------
// Generate a single starter
// ---------------------------------------------------------------------------

/**
 * Core generation logic shared by generateStarter() and generateStarterToDir().
 * Writes a fully self-contained starter into `outDir`.
 */
function generateStarterImpl(fw: FrameworkDef, outDir: string): void {
  // Preserve the per-slug entrypoint.sh override (if any) across the
  // rmSync+regen cycle. ``entrypointOverride: true`` declares that the
  // slug's committed ``entrypoint.sh`` is canonical; snapshot it from the
  // canonical committed location (``STARTERS_DIR/<slug>/entrypoint.sh``)
  // before wiping outDir and restore it after the template-based
  // entrypoint write step below.
  //
  // Reading from the canonical committed path (NOT ``outDir``) matters for
  // --check mode: runCheckMode writes each starter to a *fresh* temp
  // directory, so ``path.join(outDir, "entrypoint.sh")`` doesn't exist
  // there. Sourcing from STARTERS_DIR means --check reads the same
  // canonical override that a normal regen does, which is exactly what the
  // drift test needs. Without this, every --check would regenerate langroid
  // against the generic OpenAI-hardcoded template and falsely flag drift.
  let preservedEntrypoint: { content: Buffer; mode: number } | null = null;
  if (fw.entrypointOverride) {
    const canonicalEntrypoint = path.join(
      STARTERS_DIR,
      fw.slug,
      "entrypoint.sh",
    );
    if (fs.existsSync(canonicalEntrypoint)) {
      preservedEntrypoint = {
        content: fs.readFileSync(canonicalEntrypoint),
        mode: fs.statSync(canonicalEntrypoint).mode,
      };
    } else {
      // A declared override with no committed file is a repo-integrity
      // failure, not a degradable warning — silently falling back to the
      // shared template would reintroduce the OpenAI-hardcoded entrypoint
      // on the next regen and quietly revert provider-agnostic behavior.
      throw new Error(
        `${fw.slug} declares entrypointOverride=true but the canonical override file ${canonicalEntrypoint} does not exist. Commit the override file before regenerating.`,
      );
    }
  }

  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true });
  }
  fs.mkdirSync(outDir, { recursive: true });

  // Extra Dockerfile COPY lines for frameworks that need root-level config files
  let dockerExtraCopy =
    fw.extraFiles &&
    Object.keys(fw.extraFiles).some((dest) => !dest.includes("/"))
      ? Object.keys(fw.extraFiles)
          .filter((dest) => !dest.includes("/"))
          .map(
            (dest) => `\n# Framework config\nCOPY --chown=app:app ${dest} ./`,
          )
          .join("")
      : "";

  // Non-langgraph Python starters need agent_server.py at the root. When the
  // package ships a sibling aimock_toggle.py (required by agent_server.py's
  // `from aimock_toggle import configure_aimock`), bundle both files into a
  // single COPY layer — they always move together, so splitting them into two
  // layers just doubled the rebuild cache churn.
  if (
    fw.language === "python" &&
    fw.slug !== "langgraph-python" &&
    fw.slug !== "langgraph-fastapi"
  ) {
    const aimockToggleSrc = path.join(
      PACKAGES_DIR,
      fw.slug,
      "src",
      "aimock_toggle.py",
    );
    const hasAimockToggle = fs.existsSync(aimockToggleSrc);
    const copyTargets = hasAimockToggle
      ? "agent_server.py aimock_toggle.py"
      : "agent_server.py";
    dockerExtraCopy += `\n# FastAPI agent server entrypoint\nCOPY --chown=app:app ${copyTargets} ./`;
  }

  // Only langgraph starters need `/app/.langgraph_api` (langgraph_cli writes
  // scratch state there). Non-langgraph Python starters (crewai, agno, etc.)
  // never touch that dir — creating it was copy-paste residue that burned a
  // layer per image for nothing. Gate the mkdir to langgraph starters only.
  //
  // Ownership is assigned in the same RUN so we never pay the cost of a
  // recursive chown over `/app` (see Dockerfile templates — every other path
  // under `/app` lands with `--chown=app:app` at COPY time).
  const langgraphMkdir = fw.slug.startsWith("langgraph-")
    ? "RUN mkdir -p /app/.langgraph_api && chown app:app /app/.langgraph_api\n"
    : "";

  // Guard: an empty AGENT_DIR would turn the Dockerfile's
  // `RUN rm -f {{AGENT_DIR}}/package.json {{AGENT_DIR}}/package-lock.json`
  // into a root-level `rm -f /package.json /package-lock.json` after
  // substitution, quietly wiping /app roots. Keep `rm -f` for tolerance of
  // already-missing files, but never let this field be empty or root-like.
  if (!fw.agentDir || fw.agentDir === "/" || fw.agentDir.startsWith("/")) {
    throw new Error(
      `Invalid agentDir for ${fw.slug}: ${JSON.stringify(fw.agentDir)} — must be non-empty and relative.`,
    );
  }

  const vars: Record<string, string> = {
    SLUG: fw.slug,
    NAME: fw.name,
    LANGUAGE: fw.language,
    AGENT_DIR: fw.agentDir,
    DEV_SCRIPT: fw.devScript,
    AGENT_PORT: "8123",
    DEV_SCRIPT_BLOCK: getEntrypointBlock(fw),
    WATCHDOG_BLOCK: getWatchdogBlock(fw),
    DOCKER_EXTRA_COPY: dockerExtraCopy,
    LANGGRAPH_MKDIR: langgraphMkdir,
    AGENT_BUILD_STEPS: getAgentBuildSteps(fw),
    AGENT_BUILD_COPY: getAgentBuildCopy(fw),
  };

  // 1. Copy frontend files into src/
  const frontendSrc = path.join(TEMPLATE_DIR, "frontend");
  const frontendDest = path.join(outDir, "src");
  copyDirSync(frontendSrc, frontendDest);
  processTemplateVarsInDir(frontendDest, vars);

  // 1a. langgraph starters use langgraph_cli which exposes /ok (not /health).
  // Rewrite the probe path in the copilotkit + health routes for these starters only.
  if (fw.slug.startsWith("langgraph-")) {
    const probeFiles = [
      path.join(frontendDest, "app/api/copilotkit/route.ts"),
      path.join(frontendDest, "app/api/health/route.ts"),
    ];
    for (const file of probeFiles) {
      if (fs.existsSync(file)) {
        const content = fs.readFileSync(file, "utf-8");
        const updated = content.replace(
          /\$\{AGENT_URL\}\/health/g,
          "${AGENT_URL}/ok",
        );
        if (updated !== content) {
          fs.writeFileSync(file, updated);
        }
      }
    }
  }

  // 2. Copy template config files
  const templateConfigs: Array<[string, string]> = [
    ["package.template.json", "package.json"],
    ["next.config.template.ts", "next.config.ts"],
    ["tsconfig.template.json", "tsconfig.json"],
    ["postcss.config.template.mjs", "postcss.config.mjs"],
    [".gitignore.template", ".gitignore"],
  ];

  for (const [templateFile, outputFile] of templateConfigs) {
    const templatePath = path.join(TEMPLATE_DIR, templateFile);
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Required template config missing: ${templatePath}`);
    }
    let content = fs.readFileSync(templatePath, "utf-8");
    content = substituteVars(content, vars);

    if (outputFile === "package.json") {
      const pkg = JSON.parse(content);
      pkg.scripts.dev = fw.devScript;
      if (fw.devScript.includes("concurrently")) {
        pkg.devDependencies = pkg.devDependencies || {};
        pkg.devDependencies.concurrently = "^9.1.0";
      }
      // Merge framework-specific dependencies
      if (fw.extraDependencies) {
        pkg.dependencies = pkg.dependencies || {};
        Object.assign(pkg.dependencies, fw.extraDependencies);
        // Sort dependencies keys for deterministic output
        const sorted: Record<string, string> = {};
        for (const key of Object.keys(pkg.dependencies).sort()) {
          sorted[key] = pkg.dependencies[key];
        }
        pkg.dependencies = sorted;
      }
      // Sort devDependencies keys for deterministic output
      if (pkg.devDependencies) {
        const sorted: Record<string, string> = {};
        for (const key of Object.keys(pkg.devDependencies).sort()) {
          sorted[key] = pkg.devDependencies[key];
        }
        pkg.devDependencies = sorted;
      }
      const pins = PIN_OVERRIDES[fw.slug];
      if (pins && pkg.dependencies) {
        for (const [dep, version] of Object.entries(pins)) {
          if (pkg.dependencies[dep]) {
            pkg.dependencies[dep] = version;
          } else {
            // A PIN_OVERRIDES entry for a dep that isn't in the package's
            // dependencies is stale config — the package was updated and
            // the pin wasn't cleaned up, OR the pin targets the wrong
            // package. Silently warning means the dep keeps floating (the
            // whole point of PIN_OVERRIDES is reproducibility) without any
            // CI signal. Fail loudly so the pin gets removed or corrected.
            throw new Error(
              `PIN_OVERRIDES: ${dep} not found in ${fw.slug} dependencies — pin is stale, remove or correct the entry in PIN_OVERRIDES`,
            );
          }
        }
      }
      content = JSON.stringify(pkg, null, 2) + "\n";
    }

    fs.writeFileSync(path.join(outDir, outputFile), content);
  }

  // 3. Copy agent code
  const pkgDir = path.join(PACKAGES_DIR, fw.slug);
  const agentSrc = path.join(pkgDir, fw.agentSourceDir);
  const agentDest = path.join(outDir, fw.agentDir);

  if (!fs.existsSync(agentSrc)) {
    throw new Error(
      `Agent source directory missing for ${fw.slug}: ${agentSrc}`,
    );
  } else {
    copyDirSync(agentSrc, agentDest);
  }

  // Strip files that only exist in the PACKAGE for prod-mode and are dead
  // code / broken-dep-resolution in the STARTER. langgraph-typescript's
  // server.mjs imports @langchain/langgraph-api/server (not in starter
  // extraDependencies — resolution relies on transitive hoist through
  // @langchain/langgraph-cli), and the starter's entrypoint uses
  // `npx @langchain/langgraph-cli dev` — server.mjs is never invoked.
  if (fw.slug === "langgraph-typescript") {
    const serverMjs = path.join(agentDest, "server.mjs");
    if (fs.existsSync(serverMjs)) {
      fs.unlinkSync(serverMjs);
    }
    // Also drop the `start` script that references the now-deleted
    // server.mjs — otherwise `npm start` from the cloned starter fails
    // with "Cannot find module 'server.mjs'". The Docker path uses
    // `npx @langchain/langgraph-cli dev` via entrypoint.sh, not npm start.
    const agentPkgPath = path.join(agentDest, "package.json");
    if (fs.existsSync(agentPkgPath)) {
      const agentPkg = JSON.parse(fs.readFileSync(agentPkgPath, "utf8"));
      if (agentPkg.scripts && "start" in agentPkg.scripts) {
        delete agentPkg.scripts.start;
        fs.writeFileSync(
          agentPkgPath,
          JSON.stringify(agentPkg, null, 2) + "\n",
        );
      }
    }
  }

  // For spring-ai: the source copies src/main/{java,resources} flattened into
  // agent/{java,resources}, but Maven requires the standard src/main/ layout.
  // Restructure: agent/java/ → agent/src/main/java/, agent/resources/ → agent/src/main/resources/
  if (fw.slug === "spring-ai") {
    const srcMainDir = path.join(agentDest, "src", "main");
    fs.mkdirSync(srcMainDir, { recursive: true });
    for (const sub of ["java", "resources"]) {
      const flat = path.join(agentDest, sub);
      if (fs.existsSync(flat)) {
        fs.renameSync(flat, path.join(srcMainDir, sub));
      }
    }
  }

  // For Python: make self-contained by copying shared tools + rewriting imports
  if (fw.language === "python") {
    copySharedPythonTools(agentDest);

    // Always rewrite: remove sys.path.insert and convert shared tool imports
    forEachPyFile(agentDest, rewritePythonImports);

    // Handle tools.py / tools/ naming collision:
    // If both tools.py (wrapper) and tools/ (shared tools dir) exist,
    // rename tools.py to tool_wrappers.py and update imports
    const toolsPy = path.join(agentDest, "tools.py");
    const toolsDir = path.join(agentDest, "tools");
    if (fs.existsSync(toolsPy) && fs.existsSync(toolsDir)) {
      const newName = path.join(agentDest, "tool_wrappers.py");
      fs.renameSync(toolsPy, newName);
      // Update imports in OTHER .py files (not tool_wrappers.py itself)
      // to reference tool_wrappers instead of tools (the wrapper file, not the dir)
      const agentMod = fw.agentDir.replace(/\//g, ".");
      forEachPyFile(agentDest, (fp) => {
        if (path.basename(fp) === "tool_wrappers.py") return;
        let content = fs.readFileSync(fp, "utf-8");
        // from <agentMod>.tools import X -> from <agentMod>.tool_wrappers import X
        content = content.replace(
          new RegExp(`from ${agentMod}\\.tools import`, "g"),
          `from ${agentMod}.tool_wrappers import`,
        );
        // from .tools import X -> from .tool_wrappers import X
        // (but NOT from .tools.submodule — those reference the tools/ dir)
        content = content.replace(
          /^from \.tools import/gm,
          "from .tool_wrappers import",
        );
        fs.writeFileSync(fp, content);
      });
    }

    // For langgraph starters: convert relative imports to absolute
    // because langgraph_cli loads modules standalone, not as packages.
    //
    // Resolution-aware: `from .<X> import ...` resolves to the CURRENT
    // package, but sibling imports cross directories. For
    // langgraph-fastapi, `agent.py` sits at `<agentDir>/src/agent.py` and
    // references `.tools`, but `tools/` lives at `<agentDir>/tools/` (one
    // level up, not inside `src/`). A flat rewrite at the file's own
    // depth produces `<agentDir>.src.tools` which doesn't exist, and the
    // agent crashes with `ModuleNotFoundError` during module load.
    //
    // For each `from .<firstSeg>... import ...`, walk UP from the file's
    // own dir toward agentDest and rebase the absolute import on the
    // shallowest directory that actually contains `<firstSeg>/` or
    // `<firstSeg>.py`. This is correct both for co-located files
    // (tools/get_weather.py importing `.types`) and for files that
    // previously depended on `sys.path.insert` shims to reach a sibling
    // directory (src/agent.py importing `.tools` from `../tools`).
    if (fw.slug.startsWith("langgraph-")) {
      const lgAgentMod = fw.agentDir.replace(/\//g, ".");
      forEachPyFile(agentDest, (fp) => {
        let content = fs.readFileSync(fp, "utf-8");
        const fileDir = path.dirname(fp);
        const relFromAgent = path.relative(agentDest, fileDir);
        const subPkgParts = relFromAgent.split(path.sep).filter(Boolean);
        content = content.replace(
          /^from \.([\w.]+) import/gm,
          (_match, dotted: string) => {
            // dotted is e.g. "tools" or "tools.types"; the first segment
            // must resolve to a real package dir or module file.
            const firstSeg = dotted.split(".")[0];
            const parts = [...subPkgParts];
            while (parts.length >= 0) {
              const candidateDir = path.join(agentDest, ...parts);
              const asDir = path.join(candidateDir, firstSeg);
              const asFile = path.join(candidateDir, `${firstSeg}.py`);
              if (fs.existsSync(asDir) || fs.existsSync(asFile)) {
                const basePkg = parts.length
                  ? `${lgAgentMod}.${parts.join(".")}`
                  : lgAgentMod;
                return `from ${basePkg}.${dotted} import`;
              }
              if (parts.length === 0) break;
              parts.pop();
            }
            // Fallback: preserve the original flat-rewrite behavior.
            return `from ${lgAgentMod}.${dotted} import`;
          },
        );
        fs.writeFileSync(fp, content);
      });
    }

    const reqSrc = path.join(pkgDir, "requirements.txt");
    if (fs.existsSync(reqSrc)) {
      fs.copyFileSync(reqSrc, path.join(agentDest, "requirements.txt"));
    }

    const initPath = path.join(agentDest, "__init__.py");
    if (!fs.existsSync(initPath)) {
      fs.writeFileSync(initPath, "");
    }

    // Copy agent_server.py from demo package into starter root for non-langgraph starters
    if (fw.slug !== "langgraph-python" && fw.slug !== "langgraph-fastapi") {
      const agentServerSrc = path.join(pkgDir, "src", "agent_server.py");
      if (fs.existsSync(agentServerSrc)) {
        let serverContent = fs.readFileSync(agentServerSrc, "utf-8");
        // Rewrite imports: demo packages use "agents/" dir, starters use "agent/"
        serverContent = serverContent.replace(
          /^from agents\./gm,
          "from agent.",
        );
        fs.writeFileSync(path.join(outDir, "agent_server.py"), serverContent);
      } else {
        // Non-langgraph Python starters all depend on ``agent_server.py``
        // being present at the starter root — the Dockerfile COPYs it in
        // and the generated entrypoint execs ``uvicorn agent_server:app``.
        // A missing source file is a repo-integrity failure (either the
        // package was deleted or FRAMEWORKS needs to add this slug to the
        // langgraph-exempt allowlist); silently skipping produces a
        // starter that won't boot.
        throw new Error(
          `agent_server.py missing for ${fw.slug}: expected ${agentServerSrc} to exist. Add the file or extend the langgraph-exempt slug list if this starter does not need a FastAPI shim.`,
        );
      }

      // Copy aimock_toggle.py sibling if the package ships one. agent_server.py
      // imports from aimock_toggle so they must move together to keep starter
      // parity with the demo package.
      const aimockToggleSrc = path.join(pkgDir, "src", "aimock_toggle.py");
      if (fs.existsSync(aimockToggleSrc)) {
        fs.copyFileSync(aimockToggleSrc, path.join(outDir, "aimock_toggle.py"));
      }
    }
  }

  // Copy .env.example (when the package ships one) for ALL starters, not just
  // non-langgraph Python. Every framework benefits from the scaffolded env
  // docs; gating this in the Python branch was a propagation gap.
  //
  // Starter dev scripts bind the agent on port 8123 (see FRAMEWORKS devScript).
  // Package .env.example files list AGENT_URL=http://localhost:8000 because
  // the package's own dev script uses 8000. Rewrite the port during the copy
  // so a scaffolded `cp .env.example .env && npm run dev` actually connects.
  const envExampleSrc = path.join(pkgDir, ".env.example");
  if (fs.existsSync(envExampleSrc)) {
    let envContent = fs.readFileSync(envExampleSrc, "utf-8");
    // Rewrite AGENT_URL port 8000 -> 8123 to match the starter's dev script.
    // Uses the exported shared regex (AGENT_URL_LOCALHOST_8000_RE) so the
    // starter-consistency test and the generator cannot drift.
    envContent = envContent.replace(AGENT_URL_LOCALHOST_8000_RE, "$18123");
    fs.writeFileSync(path.join(outDir, ".env.example"), envContent);
  }

  // For TypeScript: copy shared tools and rewrite imports
  if (fw.language === "typescript") {
    copySharedTypeScriptTools(agentDest);
    rewriteTypeScriptImportsInDir(agentDest, undefined, outDir);
  }

  // 4. Copy extra files
  if (fw.extraFiles) {
    for (const [dest, src] of Object.entries(fw.extraFiles)) {
      const srcPath = path.join(pkgDir, src);
      const destPath = path.join(outDir, dest);
      if (!fs.existsSync(srcPath)) {
        // ``fw.extraFiles`` is an explicit declaration that this file is
        // required by the starter (e.g. langgraph.json for langgraph-*).
        // A missing source is a repo-integrity failure — silently skipping
        // produces a generator-good but runtime-broken starter.
        throw new Error(
          `Extra file missing for ${fw.slug}: ${srcPath} was declared in fw.extraFiles but does not exist. Add the source file or remove the extraFiles entry.`,
        );
      }
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);

      // Rewrite langgraph.json graph paths for the starter layout.
      // Only rewrite paths when agents are flattened into a different dir
      // (e.g. src/agents/ -> agent/). Skip rewriting when the starter
      // preserves the same directory structure as the package.
      if (
        dest.endsWith("langgraph.json") &&
        fw.agentDir !== fw.agentSourceDir
      ) {
        let lgContent = fs.readFileSync(destPath, "utf-8");
        lgContent = lgContent.replace(/\.\/src\/agents\//g, "./");
        lgContent = lgContent.replace(/\.\/src\/agent\//g, "./");
        fs.writeFileSync(destPath, lgContent);
      }
    }
  }

  // 5. Copy Dockerfile
  const dockerfileKey = fw.language === "csharp" ? "dotnet" : fw.language;
  const dockerfileSrc = path.join(
    TEMPLATE_DIR,
    "dockerfiles",
    `Dockerfile.${dockerfileKey}`,
  );
  if (!fs.existsSync(dockerfileSrc)) {
    throw new Error(`Dockerfile missing for ${fw.slug}: ${dockerfileSrc}`);
  }
  let dockerfileContent = fs.readFileSync(dockerfileSrc, "utf-8");
  dockerfileContent = substituteVars(dockerfileContent, vars);
  fs.writeFileSync(path.join(outDir, "Dockerfile"), dockerfileContent);

  // 6. Generate entrypoint.sh
  //
  // Slugs with ``entrypointOverride: true`` opt out of the shared template
  // and carry their own ``entrypoint.sh`` in the committed starter tree.
  // For those slugs, restore the pre-rmSync snapshot (captured above) and
  // skip the template substitution entirely — otherwise every regeneration
  // would silently overwrite the provider-aware entrypoint with the
  // generic OpenAI-hardcoded template.
  if (preservedEntrypoint) {
    // Force executable mode on the restored override regardless of the
    // source mode. Editors, filesystem copies across platforms, and
    // archive round-trips can strip the +x bit — trusting the source mode
    // would ship a non-executable entrypoint.sh into the starter output
    // and break container startup with a permission-denied at exec time.
    fs.writeFileSync(
      path.join(outDir, "entrypoint.sh"),
      preservedEntrypoint.content,
      { mode: 0o755 },
    );
  } else {
    const entrypointTemplate = fs.readFileSync(
      path.join(TEMPLATE_DIR, "entrypoint.template.sh"),
      "utf-8",
    );
    const entrypoint = substituteVars(entrypointTemplate, vars);
    fs.writeFileSync(path.join(outDir, "entrypoint.sh"), entrypoint, {
      mode: 0o755,
    });
  }

  // 7. Generate showcase.json
  const showcaseJson = {
    slug: fw.slug,
    name: fw.name,
    language: fw.language,
    agentDir: fw.agentDir,
    agentPort: 8123,
    generated: true,
  };
  fs.writeFileSync(
    path.join(outDir, "showcase.json"),
    JSON.stringify(showcaseJson, null, 2) + "\n",
  );

  // 8. Copy flight-schema.json for A2UI
  const flightSchemaSrc = path.join(
    SHOWCASE,
    "shared",
    "frontend",
    "src",
    "a2ui",
    "flight-schema.json",
  );
  if (fs.existsSync(flightSchemaSrc)) {
    if (fw.language === "python") {
      const flightDest = path.join(agentDest, "data", "flight-schema.json");
      fs.mkdirSync(path.dirname(flightDest), { recursive: true });
      fs.copyFileSync(flightSchemaSrc, flightDest);
    }
  }

  // For spring-ai: copy pom.xml and Java source
  if (fw.slug === "spring-ai") {
    const pomSrc = path.join(pkgDir, "pom.xml");
    if (fs.existsSync(pomSrc)) {
      fs.copyFileSync(pomSrc, path.join(agentDest, "pom.xml"));
    }
    for (const f of ["mvnw", "mvnw.cmd"]) {
      const src = path.join(pkgDir, f);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(agentDest, f));
        fs.chmodSync(path.join(agentDest, f), 0o755);
      }
    }
    const mvnDir = path.join(pkgDir, ".mvn");
    if (fs.existsSync(mvnDir)) {
      copyDirSync(mvnDir, path.join(agentDest, ".mvn"));
    }
    // resources/ already placed at agent/src/main/resources/ by the restructure step above
  }
}

function generateStarter(fw: FrameworkDef, dryRun: boolean): void {
  const outDir = path.join(STARTERS_DIR, fw.slug);
  if (dryRun) {
    console.log(`  [dry-run] Would generate: ${outDir}`);
    return;
  }
  generateStarterImpl(fw, outDir);
}

function processTemplateVarsInDir(
  dir: string,
  vars: Record<string, string>,
): void {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      processTemplateVarsInDir(fullPath, vars);
    } else {
      const ext = path.extname(entry.name);
      if ([".ts", ".tsx", ".json", ".css", ".html", ".mjs"].includes(ext)) {
        let content = fs.readFileSync(fullPath, "utf-8");
        const replaced = substituteVars(content, vars);
        if (replaced !== content) {
          fs.writeFileSync(fullPath, replaced);
        }
      }
    }
  }
}

/** Recursively walk `dir` and invoke `callback` for every .py file, skipping `data/` dirs. */
function forEachPyFile(
  dir: string,
  callback: (filePath: string) => void,
): void {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "data") {
        forEachPyFile(fullPath, callback);
      }
    } else if (entry.name.endsWith(".py")) {
      callback(fullPath);
    }
  }
}

function rewriteTypeScriptImportsInDir(
  dir: string,
  agentDestDir?: string,
  starterOutDir?: string,
): void {
  if (!fs.existsSync(dir)) return;
  const rootDir = agentDestDir ?? dir;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "shared-tools" && entry.name !== "data") {
        rewriteTypeScriptImportsInDir(fullPath, rootDir, starterOutDir);
      }
    } else {
      rewriteTypeScriptSharedImports(fullPath, rootDir, starterOutDir);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  // Validate slug uniqueness at startup
  const slugs = FRAMEWORKS.map((f) => f.slug);
  const dupes = slugs.filter((s, i) => slugs.indexOf(s) !== i);
  if (dupes.length) {
    throw new Error(`Duplicate framework slugs: ${dupes.join(", ")}`);
  }

  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const checkMode = args.includes("--check");
  const slugIdx = args.indexOf("--slug");
  const filterSlug = slugIdx >= 0 ? args[slugIdx + 1] : null;

  const targets = filterSlug
    ? FRAMEWORKS.filter((f) => f.slug === filterSlug)
    : FRAMEWORKS;

  if (targets.length === 0) {
    console.error(`Unknown slug: ${filterSlug}`);
    console.error(`Available: ${FRAMEWORKS.map((f) => f.slug).join(", ")}`);
    process.exit(1);
  }

  if (checkMode) {
    runCheckMode(targets);
    return;
  }

  console.log(`Generating ${targets.length} starter(s)...`);

  for (const fw of targets) {
    console.log(`\n--- ${fw.slug} (${fw.language}) ---`);
    generateStarter(fw, dryRun);
    console.log(`  Generated: showcase/starters/${fw.slug}/`);
  }

  console.log(`\nDone. Generated ${targets.length} starter(s).`);
}

/**
 * --check mode: generate to a temp directory, diff against committed starters,
 * and exit non-zero if any drift is detected.
 */
function runCheckMode(targets: FrameworkDef[]): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "starter-check-"));
  const tmpStartersDir = path.join(tmpDir, "starters");
  fs.mkdirSync(tmpStartersDir, { recursive: true });

  let drifted = false;

  console.log(`[check] Generating ${targets.length} starter(s) to temp dir...`);

  for (const fw of targets) {
    const outDir = path.join(tmpStartersDir, fw.slug);
    generateStarterToDir(fw, tmpStartersDir);

    const committedDir = path.join(STARTERS_DIR, fw.slug);
    if (!fs.existsSync(committedDir)) {
      console.error(
        `[check] DRIFT: ${fw.slug}/ does not exist in committed starters`,
      );
      drifted = true;
      continue;
    }

    try {
      execSync(
        `diff -r --exclude=node_modules --exclude=.next --exclude=next-env.d.ts --exclude=package-lock.json "${committedDir}" "${outDir}"`,
        { stdio: "pipe" },
      );
    } catch (e: unknown) {
      const stdout = (e as { stdout?: Buffer }).stdout?.toString() || "";
      const stderr = (e as { stderr?: Buffer }).stderr?.toString() || "";
      console.error(`[check] DRIFT in ${fw.slug}:`);
      if (stdout.trim()) console.error(stdout.trim());
      if (stderr.trim()) console.error(stderr.trim());
      drifted = true;
    }
  }

  // Clean up
  fs.rmSync(tmpDir, { recursive: true });

  if (drifted) {
    console.error(
      "\n[check] FAILED: Starters are out of date. Run: npx tsx generate-starters.ts",
    );
    process.exit(1);
  } else {
    console.log("[check] OK: All starters are up to date.");
  }
}

/**
 * Generate a single starter into a specified output base directory.
 */
function generateStarterToDir(fw: FrameworkDef, startersBase: string): void {
  generateStarterImpl(fw, path.join(startersBase, fw.slug));
}

// Only execute main() when this file is run directly (e.g. `tsx
// generate-starters.ts` or via the npm script). Tests that `import` from this
// module must NOT trigger generation — previously `import { ... } from
// "../generate-starters"` was re-running main() and effectively asserting
// against its own output, masking regressions in the generator itself.
const invokedAsScript =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedAsScript) {
  main();
}

export {
  AGENT_URL_LOCALHOST_8000_RE,
  FRAMEWORKS,
  PIN_OVERRIDES,
  generateStarter,
  // Exported so tests can regenerate a single starter into a temp directory
  // and diff against the committed canonical tree — specifically used to
  // regression-guard the ``entrypointOverride`` branch of generateStarterImpl.
  generateStarterToDir,
  substituteVars,
  rewritePythonImports,
  forEachPyFile,
  extractUvicornModule,
  getEntrypointBlock,
  getWatchdogBlock,
  getAgentHealthPath,
  getAgentBuildSteps,
  getAgentBuildCopy,
};
