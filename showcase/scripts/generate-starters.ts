/**
 * Generate self-contained starter projects for each showcase framework.
 *
 * Combines the canonical template frontend with per-framework agent backends
 * to produce standalone clonable starters at showcase/starters/<slug>/.
 *
 * Usage:
 *   npx tsx generate-starters.ts [--slug langgraph-python] [--dry-run] [--check]
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import * as os from "node:os";

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
    devScript:
      'concurrently "next dev --turbopack" "npx mastra dev --port 8123"',
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
    console.warn(
      `  [warn] Unreplaced template variables: ${remaining.join(", ")}`,
    );
  }
  return result;
}

function rewritePythonImports(filePath: string, _agentDir: string): void {
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

  for (let i = 0; i < lines.length; i++) {
    if (!skipIndices.has(i)) {
      result.push(lines[i]);
    }
  }

  content = result.join("\n");

  // Clean up multiple blank lines
  content = content.replace(/\n{3,}/g, "\n\n");

  // Rewrite "from tools import ..." to "from .tools import ..."
  content = content.replace(/^from tools import /gm, "from .tools import ");
  content = content.replace(
    /^from tools\.(\w+) import /gm,
    "from .tools.$1 import ",
  );

  // Rewrite "from src.agents.X import ..." to "from .X import ..."
  // This handles main.py style imports like "from src.agents.tools import ..."
  content = content.replace(
    /^(\s*)from src\.agents\.(\w+) import /gm,
    "$1from .$2 import ",
  );

  fs.writeFileSync(filePath, content);
}

function rewriteTypeScriptSharedImports(filePath: string): void {
  if (!filePath.endsWith(".ts") && !filePath.endsWith(".tsx")) return;
  let content = fs.readFileSync(filePath, "utf-8");

  // Rewrite @copilotkit/showcase-shared-tools to relative ./shared-tools
  content = content.replace(
    /@copilotkit\/showcase-shared-tools/g,
    "./shared-tools",
  );

  fs.writeFileSync(filePath, content);
}

/**
 * Extract the uvicorn module path (e.g. "agent.agent:app") from a framework's
 * devScript. Falls back to "agent.main:app" if no uvicorn invocation is found.
 */
function extractUvicornModule(fw: FrameworkDef): string {
  const match = fw.devScript.match(/uvicorn\s+([\w.:]+)/);
  if (!match) {
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

function getEntrypointBlock(fw: FrameworkDef): string {
  switch (fw.language) {
    case "python":
      if (fw.slug === "langgraph-python" || fw.slug === "langgraph-fastapi") {
        return `echo "[entrypoint] Starting LangGraph agent server on port 8123..."
python -m langgraph_cli dev \\
  --config langgraph.json \\
  --host 0.0.0.0 \\
  --port 8123 \\
  --no-browser 2>&1 | sed 's/^/[agent] /' &
AGENT_PID=$!
sleep 3
${AGENT_HEALTH_CHECK}`;
      }
      return `echo "[entrypoint] Starting Python agent server on port 8123..."
cd /app && python -m uvicorn agent_server:app --host 0.0.0.0 --port 8123 2>&1 | sed 's/^/[agent] /' &
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
  --no-browser 2>&1 | sed 's/^/[agent] /' &
AGENT_PID=$!
sleep 3
${AGENT_HEALTH_CHECK}`;
      }
      if (fw.slug === "mastra") {
        return `echo "[entrypoint] Starting Mastra agent on port 8123..."
npx mastra dev --port 8123 2>&1 | sed 's/^/[agent] /' &
AGENT_PID=$!
sleep 3
${AGENT_HEALTH_CHECK}`;
      }
      return `echo "[entrypoint] Starting TypeScript agent on port 8123..."
npx tsx agent/index.ts 2>&1 | sed 's/^/[agent] /' &
AGENT_PID=$!
sleep 2
${AGENT_HEALTH_CHECK}`;
    case "java":
      return `echo "[entrypoint] Starting Spring AI agent on port 8123..."
java -jar agent/app.jar --server.port=8123 2>&1 | sed 's/^/[agent] /' &
AGENT_PID=$!
sleep 5
${AGENT_HEALTH_CHECK}`;
    case "csharp":
      return `echo "[entrypoint] Starting .NET agent on port 8123..."
cd agent && dotnet ProverbsAgent.dll --urls http://0.0.0.0:8123 2>&1 | sed 's/^/[agent] /' &
AGENT_PID=$!
cd /app
sleep 3
${AGENT_HEALTH_CHECK}`;
  }
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
          .map((dest) => `\n# Framework config\nCOPY ${dest} ./`)
          .join("")
      : "";

  // Non-langgraph Python starters need agent_server.py at the root
  if (
    fw.language === "python" &&
    fw.slug !== "langgraph-python" &&
    fw.slug !== "langgraph-fastapi"
  ) {
    dockerExtraCopy +=
      "\n# FastAPI agent server entrypoint\nCOPY agent_server.py ./";
  }

  const vars: Record<string, string> = {
    SLUG: fw.slug,
    NAME: fw.name,
    LANGUAGE: fw.language,
    AGENT_DIR: fw.agentDir,
    DEV_SCRIPT: fw.devScript,
    AGENT_PORT: "8123",
    DEV_SCRIPT_BLOCK: getEntrypointBlock(fw),
    DOCKER_EXTRA_COPY: dockerExtraCopy,
  };

  // 1. Copy frontend files into src/
  const frontendSrc = path.join(TEMPLATE_DIR, "frontend");
  const frontendDest = path.join(outDir, "src");
  copyDirSync(frontendSrc, frontendDest);
  processTemplateVarsInDir(frontendDest, vars);

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
      // Sort devDependencies keys for deterministic output
      if (pkg.devDependencies) {
        const sorted: Record<string, string> = {};
        for (const key of Object.keys(pkg.devDependencies).sort()) {
          sorted[key] = pkg.devDependencies[key];
        }
        pkg.devDependencies = sorted;
      }
      content = JSON.stringify(pkg, null, 2) + "\n";
    }

    fs.writeFileSync(path.join(outDir, outputFile), content);
  }

  // 3. Copy agent code
  const pkgDir = path.join(PACKAGES_DIR, fw.slug);
  const agentSrc = path.join(pkgDir, fw.agentSourceDir);
  const agentDest = path.join(outDir, fw.agentDir);

  const KNOWN_INCOMPLETE_AGENTS = ["claude-sdk-typescript"];
  if (!fs.existsSync(agentSrc)) {
    if (KNOWN_INCOMPLETE_AGENTS.includes(fw.slug)) {
      console.warn(
        `  [warn] Agent source directory missing for ${fw.slug}: ${agentSrc} (known incomplete — continuing)`,
      );
      fs.mkdirSync(agentDest, { recursive: true });
    } else {
      throw new Error(
        `Agent source directory missing for ${fw.slug}: ${agentSrc}`,
      );
    }
  } else {
    copyDirSync(agentSrc, agentDest);
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
    rewritePythonImportsInDir(agentDest, fw.agentDir);

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
      for (const pyFile of fs
        .readdirSync(agentDest)
        .filter((f) => f.endsWith(".py") && f !== "tool_wrappers.py")) {
        const fp = path.join(agentDest, pyFile);
        let content = fs.readFileSync(fp, "utf-8");
        const agentMod = fw.agentDir.replace(/\//g, ".");
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
      }
    }

    // For langgraph starters: convert relative imports to absolute
    // because langgraph_cli loads modules standalone, not as packages
    if (fw.slug.startsWith("langgraph-")) {
      const agentMod = fw.agentDir.replace(/\//g, ".");
      for (const pyFile of fs
        .readdirSync(agentDest)
        .filter((f) => f.endsWith(".py"))) {
        const fp = path.join(agentDest, pyFile);
        let content = fs.readFileSync(fp, "utf-8");
        // from .X import -> from <agentMod>.X import
        content = content.replace(
          /^from \.([\w.]+) import/gm,
          `from ${agentMod}.$1 import`,
        );
        fs.writeFileSync(fp, content);
      }
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
        console.warn(
          `  [warn] agent_server.py missing for ${fw.slug}: ${agentServerSrc} — skipping`,
        );
      }
    }
  }

  // For TypeScript: copy shared tools and rewrite imports
  if (fw.language === "typescript") {
    copySharedTypeScriptTools(agentDest);
    rewriteTypeScriptImportsInDir(agentDest);
  }

  // 4. Copy extra files
  if (fw.extraFiles) {
    for (const [dest, src] of Object.entries(fw.extraFiles)) {
      const srcPath = path.join(pkgDir, src);
      const destPath = path.join(outDir, dest);
      if (!fs.existsSync(srcPath)) {
        console.warn(
          `  [warn] Extra file missing for ${fw.slug}: ${srcPath} — skipping`,
        );
        continue;
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
  const entrypointTemplate = fs.readFileSync(
    path.join(TEMPLATE_DIR, "entrypoint.template.sh"),
    "utf-8",
  );
  const entrypoint = substituteVars(entrypointTemplate, vars);
  fs.writeFileSync(path.join(outDir, "entrypoint.sh"), entrypoint, {
    mode: 0o755,
  });

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

function rewritePythonImportsInDir(dir: string, agentDir: string): void {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip data dirs but process everything else including tools/
      if (entry.name !== "data") {
        rewritePythonImportsInDir(fullPath, agentDir);
      }
    } else {
      rewritePythonImports(fullPath, agentDir);
    }
  }
}

function rewriteTypeScriptImportsInDir(dir: string): void {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "shared-tools" && entry.name !== "data") {
        rewriteTypeScriptImportsInDir(fullPath);
      }
    } else {
      rewriteTypeScriptSharedImports(fullPath);
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

main();

export {
  FRAMEWORKS,
  generateStarter,
  substituteVars,
  rewritePythonImports,
  extractUvicornModule,
  getEntrypointBlock,
};
