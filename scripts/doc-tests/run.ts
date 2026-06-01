import * as fs from "node:fs";
import * as path from "node:path";
import { execSync, spawn } from "node:child_process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ManifestEntry {
  id: string;
  file: string;
  lang: string;
  category: string;
  source: string;
}

interface DoctestConfig {
  python?: { deps: string[] };
  typescript?: { deps: string[] };
  node?: { deps: string[] };
}

interface Result {
  id: string;
  category: string;
  status: "pass" | "fail";
  error?: string;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const OUTPUT_DIR = path.resolve(__dirname, "../../.doctest-output");
const MANIFEST_PATH = path.join(OUTPUT_DIR, "manifest.json");

const DEFAULT_ENV: Record<string, string> = {
  OPENAI_API_KEY: "test-key",
  OPENAI_BASE_URL: "http://localhost:4010",
};

const SERVER_TIMEOUT_MS = 30_000;
const SERVER_POLL_MS = 500;
const SCRIPT_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateDepName(dep: string): string {
  if (!/^[@\w][\w./-]*(?:@[\w.^~>=<*-]+)?$/.test(dep)) {
    throw new Error(`Invalid dependency name: ${dep}`);
  }
  return dep;
}

function loadDoctestConfig(snippetDir: string): DoctestConfig {
  const configPath = path.join(snippetDir, "doctest.json");
  if (fs.existsSync(configPath)) {
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
  }
  return {};
}

function mergeEnv(extra?: Record<string, string>): Record<string, string> {
  return { ...process.env, ...DEFAULT_ENV, ...extra } as Record<string, string>;
}

async function waitForPort(
  port: number,
  timeoutMs: number,
  pollMs: number,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await fetch(`http://localhost:${port}/`).catch(() => null);
      if (resp) return true;
    } catch {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return false;
}

function detectPort(code: string): number {
  // Look for port=NNNN or PORT=NNNN or --port NNNN
  const match = code.match(/\bport[=\s:]+(\d{4,5})/i);
  return match ? parseInt(match[1], 10) : 8000;
}

// ---------------------------------------------------------------------------
// Runners
// ---------------------------------------------------------------------------

async function runPythonServer(
  snippetDir: string,
  entryFile: string,
  config: DoctestConfig,
): Promise<Result> {
  const id = path.basename(snippetDir);
  const venvDir = path.join(snippetDir, ".venv");

  try {
    // Create virtualenv
    execSync(`python3 -m venv ${venvDir}`, { cwd: snippetDir, stdio: "pipe" });

    const pip = path.join(venvDir, "bin", "pip");
    const python = path.join(venvDir, "bin", "python");

    // Install deps
    const deps = config.python?.deps || [];
    if (deps.length > 0) {
      const safeDeps = deps.map(validateDepName);
      execSync(`${pip} install ${safeDeps.join(" ")}`, {
        cwd: snippetDir,
        stdio: "pipe",
        timeout: 120_000,
      });
    }

    const code = fs.readFileSync(path.join(snippetDir, entryFile), "utf-8");
    const port = detectPort(code);

    // Start server
    const proc = spawn(python, [entryFile], {
      cwd: snippetDir,
      env: mergeEnv(),
      stdio: "pipe",
    });

    try {
      const ready = await waitForPort(port, SERVER_TIMEOUT_MS, SERVER_POLL_MS);

      if (!ready) {
        return {
          id,
          category: "server",
          status: "fail",
          error: `Server did not bind to port ${port} within ${SERVER_TIMEOUT_MS}ms`,
        };
      }

      return { id, category: "server", status: "pass" };
    } finally {
      try {
        proc.kill("SIGTERM");
      } catch {}
    }
  } catch (e: any) {
    return {
      id,
      category: "server",
      status: "fail",
      error: e.message || String(e),
    };
  }
}

async function runTypeScriptServer(
  snippetDir: string,
  entryFile: string,
  config: DoctestConfig,
): Promise<Result> {
  const id = path.basename(snippetDir);

  try {
    // Init and install deps
    execSync("npm init -y", { cwd: snippetDir, stdio: "pipe" });

    const deps = config.typescript?.deps || config.node?.deps || [];
    if (deps.length > 0) {
      const safeDeps = deps.map(validateDepName);
      execSync(`npm install ${safeDeps.join(" ")}`, {
        cwd: snippetDir,
        stdio: "pipe",
        timeout: 120_000,
      });
    }

    const code = fs.readFileSync(path.join(snippetDir, entryFile), "utf-8");
    const port = detectPort(code);

    // Determine runner
    const runner = entryFile.endsWith(".ts") ? "npx tsx" : "node";
    const proc = spawn(
      runner.split(" ")[0],
      [...runner.split(" ").slice(1), entryFile],
      {
        cwd: snippetDir,
        env: mergeEnv(),
        stdio: "pipe",
      },
    );

    try {
      const ready = await waitForPort(port, SERVER_TIMEOUT_MS, SERVER_POLL_MS);

      if (!ready) {
        return {
          id,
          category: "server",
          status: "fail",
          error: `Server did not bind to port ${port} within ${SERVER_TIMEOUT_MS}ms`,
        };
      }

      return { id, category: "server", status: "pass" };
    } finally {
      try {
        proc.kill("SIGTERM");
      } catch {}
    }
  } catch (e: any) {
    return {
      id,
      category: "server",
      status: "fail",
      error: e.message || String(e),
    };
  }
}

async function runScript(
  snippetDir: string,
  entryFile: string,
  lang: string,
  config: DoctestConfig,
): Promise<Result> {
  const id = path.basename(snippetDir);

  try {
    if (lang === "python") {
      const venvDir = path.join(snippetDir, ".venv");
      execSync(`python3 -m venv ${venvDir}`, {
        cwd: snippetDir,
        stdio: "pipe",
      });
      const pip = path.join(venvDir, "bin", "pip");
      const python = path.join(venvDir, "bin", "python");

      const deps = config.python?.deps || [];
      if (deps.length > 0) {
        const safeDeps = deps.map(validateDepName);
        execSync(`${pip} install ${safeDeps.join(" ")}`, {
          cwd: snippetDir,
          stdio: "pipe",
          timeout: 120_000,
        });
      }

      execSync(`${python} ${entryFile}`, {
        cwd: snippetDir,
        env: mergeEnv(),
        stdio: "pipe",
        timeout: SCRIPT_TIMEOUT_MS,
      });
    } else {
      execSync("npm init -y", { cwd: snippetDir, stdio: "pipe" });
      const deps = config.typescript?.deps || config.node?.deps || [];
      if (deps.length > 0) {
        const safeDeps = deps.map(validateDepName);
        execSync(`npm install ${safeDeps.join(" ")}`, {
          cwd: snippetDir,
          stdio: "pipe",
          timeout: 120_000,
        });
      }

      const runner = entryFile.endsWith(".ts") ? "npx tsx" : "node";
      execSync(`${runner} ${entryFile}`, {
        cwd: snippetDir,
        env: mergeEnv(),
        stdio: "pipe",
        timeout: SCRIPT_TIMEOUT_MS,
      });
    }

    return { id, category: "script", status: "pass" };
  } catch (e: any) {
    return {
      id,
      category: "script",
      status: "fail",
      error: e.message || String(e),
    };
  }
}

async function runComponent(
  snippetDir: string,
  entryFile: string,
  config: DoctestConfig,
): Promise<Result> {
  const id = path.basename(snippetDir);

  try {
    execSync("npm init -y", { cwd: snippetDir, stdio: "pipe" });

    const deps = config.typescript?.deps || [];
    const baseDeps = ["typescript", "@types/react", "@types/node"];
    const allDeps = [...new Set([...baseDeps, ...deps])];
    const safeAllDeps = allDeps.map(validateDepName);

    execSync(`npm install ${safeAllDeps.join(" ")}`, {
      cwd: snippetDir,
      stdio: "pipe",
      timeout: 120_000,
    });

    // Write minimal tsconfig if none exists
    const tsconfigPath = path.join(snippetDir, "tsconfig.json");
    if (!fs.existsSync(tsconfigPath)) {
      fs.writeFileSync(
        tsconfigPath,
        JSON.stringify(
          {
            compilerOptions: {
              target: "ES2020",
              module: "ESNext",
              moduleResolution: "bundler",
              jsx: "react-jsx",
              strict: true,
              noEmit: true,
              esModuleInterop: true,
              skipLibCheck: true,
            },
            include: [entryFile],
          },
          null,
          2,
        ),
        "utf-8",
      );
    }

    execSync("npx tsc --noEmit", {
      cwd: snippetDir,
      stdio: "pipe",
      timeout: SCRIPT_TIMEOUT_MS,
    });

    return { id, category: "component", status: "pass" };
  } catch (e: any) {
    return {
      id,
      category: "component",
      status: "fail",
      error: e.message || String(e),
    };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(
      `Manifest not found at ${MANIFEST_PATH}. Run extract.ts first.`,
    );
    process.exit(1);
  }

  const manifest: ManifestEntry[] = JSON.parse(
    fs.readFileSync(MANIFEST_PATH, "utf-8"),
  );

  if (manifest.length === 0) {
    console.log("No doctest snippets found in manifest.");
    process.exit(0);
  }

  console.log(`Running ${manifest.length} doctest snippet(s)...\n`);

  const results: Result[] = [];

  for (const entry of manifest) {
    const snippetDir = path.join(OUTPUT_DIR, path.dirname(entry.file));
    const entryFile = path.basename(entry.file);
    const config = loadDoctestConfig(snippetDir);

    console.log(`  Running: ${entry.id} [${entry.category}/${entry.lang}]`);

    let result: Result;

    if (entry.category === "server") {
      if (entry.lang === "python") {
        result = await runPythonServer(snippetDir, entryFile, config);
      } else {
        result = await runTypeScriptServer(snippetDir, entryFile, config);
      }
    } else if (entry.category === "script") {
      result = await runScript(snippetDir, entryFile, entry.lang, config);
    } else if (entry.category === "component") {
      result = await runComponent(snippetDir, entryFile, config);
    } else {
      result = {
        id: entry.id,
        category: entry.category,
        status: "fail",
        error: `Unknown category: ${entry.category}`,
      };
    }

    results.push(result);

    const icon = result.status === "pass" ? "PASS" : "FAIL";
    console.log(
      `  ${icon}: ${entry.id}${result.error ? ` — ${result.error}` : ""}\n`,
    );
  }

  // Summary
  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;

  console.log("─".repeat(60));
  console.log(
    `Results: ${passed} passed, ${failed} failed, ${results.length} total`,
  );
  console.log("─".repeat(60));

  if (failed > 0) {
    console.log("\nFailed snippets:");
    for (const r of results.filter((r) => r.status === "fail")) {
      console.log(`  ${r.id}: ${r.error}`);
    }
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Unexpected error:", e);
  process.exit(1);
});
