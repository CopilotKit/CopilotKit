import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createLogger } from "../logger.js";
import { healthCheck } from "./lifecycle.js";

const log = createLogger({ component: "aimock-rebuild" });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOWCASE_DIR = path.resolve(__dirname, "../../..");
const COMPOSE_FILE = path.join(SHOWCASE_DIR, "docker-compose.local.yml");

// ---------------------------------------------------------------------------
// Default aimock source locations (relative to showcase dir)
// ---------------------------------------------------------------------------

const DEFAULT_AIMOCK_PATHS = [
  path.resolve(SHOWCASE_DIR, "../../aimock"),
  path.resolve(SHOWCASE_DIR, "../aimock"),
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findAimockSource(fromPath?: string): string {
  if (fromPath) {
    const resolved = path.resolve(fromPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Aimock source not found at: ${resolved}`);
    }
    if (!fs.existsSync(path.join(resolved, "package.json"))) {
      throw new Error(
        `No package.json found at: ${resolved} — not an aimock checkout`,
      );
    }
    return resolved;
  }

  for (const candidate of DEFAULT_AIMOCK_PATHS) {
    if (
      fs.existsSync(candidate) &&
      fs.existsSync(path.join(candidate, "package.json"))
    ) {
      return candidate;
    }
  }

  throw new Error(
    `Aimock source not found at default locations: ${DEFAULT_AIMOCK_PATHS.join(", ")}. Use --from <path> to specify.`,
  );
}

function compose(...args: string[]): string {
  const fullArgs = ["compose", "-f", COMPOSE_FILE, ...args];
  log.debug("exec", { cmd: ["docker", ...fullArgs].join(" ") });
  return execFileSync("docker", fullArgs, {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    cwd: SHOWCASE_DIR,
  }).trim();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export interface AimockRebuildOptions {
  from?: string;
}

/**
 * Rebuild aimock from a local source checkout and redeploy the container.
 *
 * Steps:
 *   1. npm run build in aimock source dir
 *   2. DEPOT_DISABLE=1 docker buildx build --builder desktop-linux --load -t aimock:local
 *   3. docker compose up -d --force-recreate aimock
 *   4. Health check
 */
export async function aimockRebuild(
  opts?: AimockRebuildOptions,
): Promise<void> {
  const srcDir = findAimockSource(opts?.from);
  log.info("rebuilding aimock from source", { srcDir });

  // Step 1: npm run build
  console.log(`\n  \x1b[36mBuilding aimock...\x1b[0m (${srcDir})`);
  try {
    execFileSync("npm", ["run", "build"], {
      cwd: srcDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120_000,
    });
    log.info("aimock build succeeded");
  } catch (err) {
    const e = err as { stderr?: string };
    const stderr = typeof e.stderr === "string" ? e.stderr.trim() : "";
    throw new Error(`aimock build failed:\n${stderr}`);
  }

  // Step 2: Docker buildx build
  console.log("  \x1b[36mBuilding Docker image...\x1b[0m");
  try {
    execFileSync(
      "docker",
      [
        "buildx",
        "build",
        "--builder",
        "desktop-linux",
        "--load",
        "-t",
        "aimock:local",
        ".",
      ],
      {
        cwd: srcDir,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, DEPOT_DISABLE: "1" },
        timeout: 300_000,
      },
    );
    log.info("docker image build succeeded");
  } catch (err) {
    const e = err as { stderr?: string };
    const stderr = typeof e.stderr === "string" ? e.stderr.trim() : "";
    throw new Error(`Docker image build failed:\n${stderr}`);
  }

  // Step 3: Force-recreate aimock container
  console.log("  \x1b[36mRecreating aimock container...\x1b[0m");
  compose("--profile", "infra", "up", "-d", "--force-recreate", "aimock");

  // Step 4: Health check
  console.log("  \x1b[36mWaiting for health...\x1b[0m");
  const results = await healthCheck(["aimock"]);
  const healthy = results.get("aimock");

  if (!healthy) {
    throw new Error(
      "aimock failed health check after rebuild. Check logs with: showcase logs aimock",
    );
  }

  console.log("  \x1b[32maimock rebuilt and healthy\x1b[0m\n");
}
