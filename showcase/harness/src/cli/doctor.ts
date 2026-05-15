import { execFileSync, execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { createLogger } from "../logger.js";

const log = createLogger({ component: "doctor" });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOWCASE_DIR = path.resolve(__dirname, "../../..");
const COMPOSE_FILE = path.join(SHOWCASE_DIR, "docker-compose.local.yml");
const PORTS_FILE =
  process.env.LOCAL_PORTS_FILE ||
  path.join(SHOWCASE_DIR, "shared/local-ports.json");

/** Well-known infra service ports. */
const INFRA_PORTS: Record<string, number> = {
  aimock: 4010,
  pocketbase: 8090,
  dashboard: 3200,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Check {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

function checkDockerEngine(): Check {
  try {
    execFileSync("docker", ["info"], {
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
      timeout: 10_000,
    });
    return { name: "Docker engine", status: "ok", detail: "running" };
  } catch (err) {
    return {
      name: "Docker engine",
      status: "fail",
      detail: `not reachable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function checkDepotInterception(): Check {
  try {
    const depotPath = execSync("which depot 2>/dev/null", {
      encoding: "utf-8",
      timeout: 5_000,
    }).trim();

    // Check if docker is shimmed by depot
    try {
      const dockerPath = execSync("which docker 2>/dev/null", {
        encoding: "utf-8",
        timeout: 5_000,
      }).trim();

      if (dockerPath.includes("depot")) {
        return {
          name: "Depot interception",
          status: "warn",
          detail: `depot found at ${depotPath}; docker appears shimmed (${dockerPath}). Set DEPOT_DISABLE=1 for local builds.`,
        };
      }
    } catch {
      // docker not found — already caught by Docker engine check
    }

    return {
      name: "Depot interception",
      status: "ok",
      detail: `depot at ${depotPath}, docker not shimmed`,
    };
  } catch {
    return {
      name: "Depot interception",
      status: "ok",
      detail: "depot not installed (fine for local dev)",
    };
  }
}

function checkComposeFile(): Check {
  if (fs.existsSync(COMPOSE_FILE)) {
    return {
      name: "Compose file",
      status: "ok",
      detail: COMPOSE_FILE,
    };
  }
  return {
    name: "Compose file",
    status: "fail",
    detail: `not found at ${COMPOSE_FILE}`,
  };
}

function checkEnvFile(): Check {
  const envPath = path.join(SHOWCASE_DIR, ".env");
  if (fs.existsSync(envPath)) {
    return { name: ".env file", status: "ok", detail: envPath };
  }
  return {
    name: ".env file",
    status: "warn",
    detail: `not found at ${envPath}. Some services may need environment variables.`,
  };
}

function checkStaleImages(): Check {
  try {
    const output = execFileSync(
      "docker",
      [
        "compose",
        "-f",
        COMPOSE_FILE,
        "--profile",
        "all",
        "images",
        "--format",
        "json",
      ],
      {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        cwd: SHOWCASE_DIR,
        timeout: 15_000,
      },
    );

    // Each line is a JSON object
    const lines = output
      .trim()
      .split("\n")
      .filter((l) => l.trim().length > 0);
    const stale: string[] = [];
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

    for (const line of lines) {
      try {
        const img = JSON.parse(line) as {
          Repository?: string;
          Tag?: string;
          CreatedAt?: string;
        };
        if (img.CreatedAt) {
          const created = new Date(img.CreatedAt).getTime();
          if (created < oneDayAgo) {
            stale.push(`${img.Repository ?? "?"}:${img.Tag ?? "?"}`);
          }
        }
      } catch {
        // Skip unparseable lines
      }
    }

    if (stale.length > 0) {
      return {
        name: "Stale images",
        status: "warn",
        detail: `${stale.length} image(s) older than 24h: ${stale.slice(0, 5).join(", ")}${stale.length > 5 ? "..." : ""}`,
      };
    }
    return { name: "Stale images", status: "ok", detail: "all images recent" };
  } catch {
    return {
      name: "Stale images",
      status: "warn",
      detail: "could not check image ages (compose images failed)",
    };
  }
}

/**
 * Try to connect to a port. Returns true if something is listening.
 */
async function isPortListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();

    socket.setTimeout(1_000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });

    socket.connect(port, "127.0.0.1");
  });
}

async function checkPorts(): Promise<Check> {
  const allPorts: Record<string, number> = { ...INFRA_PORTS };

  try {
    const raw = fs.readFileSync(PORTS_FILE, "utf-8");
    const integrationPorts = JSON.parse(raw) as Record<string, number>;
    Object.assign(allPorts, integrationPorts);
  } catch {
    // If we can't read ports file, just check infra
  }

  // Check which ports have something listening
  const listening: string[] = [];
  const portChecks = Object.entries(allPorts).map(async ([name, port]) => {
    const inUse = await isPortListening(port);
    if (inUse) {
      listening.push(`${name}:${port}`);
    }
  });

  await Promise.all(portChecks);

  if (listening.length > 0) {
    return {
      name: "Port usage",
      status: "ok",
      detail: `${listening.length} port(s) in use: ${listening.slice(0, 8).join(", ")}${listening.length > 8 ? "..." : ""}`,
    };
  }

  return {
    name: "Port usage",
    status: "ok",
    detail: "no ports in use (stack appears down)",
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Run all diagnostic checks and return a formatted report string.
 */
export async function doctor(): Promise<string> {
  log.info("running diagnostics");

  const checks: Check[] = [];

  // Synchronous checks
  checks.push(checkDockerEngine());
  checks.push(checkDepotInterception());
  checks.push(checkComposeFile());
  checks.push(checkEnvFile());
  checks.push(checkStaleImages());

  // Async checks
  checks.push(await checkPorts());

  // Format report
  const lines: string[] = ["\n  Showcase Doctor\n"];

  for (const check of checks) {
    const icon =
      check.status === "ok"
        ? "\x1b[32m✓\x1b[0m"
        : check.status === "warn"
          ? "\x1b[33m!\x1b[0m"
          : "\x1b[31m✗\x1b[0m";

    lines.push(`  ${icon} ${check.name}: ${check.detail}`);
  }

  const failCount = checks.filter((c) => c.status === "fail").length;
  const warnCount = checks.filter((c) => c.status === "warn").length;

  lines.push("");
  if (failCount > 0) {
    lines.push(
      `  \x1b[31m${failCount} issue(s) need attention\x1b[0m${warnCount > 0 ? `, ${warnCount} warning(s)` : ""}`,
    );
  } else if (warnCount > 0) {
    lines.push(`  \x1b[33m${warnCount} warning(s)\x1b[0m, no blockers`);
  } else {
    lines.push("  \x1b[32mAll checks passed\x1b[0m");
  }

  return lines.join("\n");
}
