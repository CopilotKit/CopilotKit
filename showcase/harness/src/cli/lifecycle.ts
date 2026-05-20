import {
  execSync,
  execFileSync,
  spawn,
  type SpawnOptions,
} from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createLogger } from "../logger.js";

const log = createLogger({ component: "lifecycle" });

// Resolve paths relative to the showcase directory.
// This file lives at showcase/ops/src/cli/lifecycle.ts, so we walk up:
//   cli/ -> src/ -> ops/ -> showcase/
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOWCASE_DIR = path.resolve(__dirname, "../../..");
const COMPOSE_FILE = path.join(SHOWCASE_DIR, "docker-compose.local.yml");
const INTEGRATIONS_DIR = path.join(SHOWCASE_DIR, "integrations");
// Honor LOCAL_PORTS_FILE env var (set by isolation overlay) so the harness
// reads offset ports from a temp file instead of the checked-in original.
const PORTS_FILE =
  process.env.LOCAL_PORTS_FILE ||
  path.join(SHOWCASE_DIR, "shared/local-ports.json");

/** Well-known infra service ports that aren't in local-ports.json. */
const INFRA_PORTS: Record<string, number> = {
  aimock: 4010,
  pocketbase: 8090,
  dashboard: 3200,
};

/** Health-check endpoint overrides per service type. */
const HEALTH_ENDPOINTS: Record<string, string> = {
  aimock: "/health",
  pocketbase: "/api/health",
  dashboard: "/",
};

/** Default health endpoint for integration services. */
const DEFAULT_HEALTH_ENDPOINT = "/health";

export interface LifecycleOptions {
  verbose?: boolean;
}

// ---------------------------------------------------------------------------
// Helper: run docker compose
// ---------------------------------------------------------------------------

/**
 * Run `docker compose -f <compose-file> <args>` synchronously.
 * Returns stdout. Throws on non-zero exit, including stderr in the message.
 */
function compose(...args: string[]): string {
  const fullArgs = ["compose", "-f", COMPOSE_FILE, ...args];
  log.debug("exec", { cmd: ["docker", ...fullArgs].join(" ") });
  try {
    return execFileSync("docker", fullArgs, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      cwd: SHOWCASE_DIR,
    }).trim();
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      throw new Error(
        "Docker not found. Please install Docker Desktop and ensure 'docker' is on your PATH.",
      );
    }
    const e = err as { stderr?: string; status?: number };
    const stderr = typeof e.stderr === "string" ? e.stderr.trim() : "";
    throw new Error(
      `docker compose failed (exit ${e.status ?? "?"}): docker ${fullArgs.join(" ")}\n${stderr}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Port resolution
// ---------------------------------------------------------------------------

let _portsCache: Record<string, number> | null = null;

function loadPortsFile(): Record<string, number> {
  if (_portsCache) return _portsCache;
  try {
    const raw = fs.readFileSync(PORTS_FILE, "utf-8");
    _portsCache = JSON.parse(raw) as Record<string, number>;
    return _portsCache;
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      log.warn("local-ports.json not found, health checks may fail", {
        path: PORTS_FILE,
      });
      return {};
    }
    throw err;
  }
}

function resolvePort(service: string): number | undefined {
  if (INFRA_PORTS[service] !== undefined) return INFRA_PORTS[service];
  const ports = loadPortsFile();
  return ports[service];
}

function resolveHealthEndpoint(service: string): string {
  return HEALTH_ENDPOINTS[service] ?? DEFAULT_HEALTH_ENDPOINT;
}

// ---------------------------------------------------------------------------
// Shared-module staging (mirrors dev-local.sh stage_shared)
// ---------------------------------------------------------------------------

/**
 * For each integration package directory, replace `tools` and `shared-tools`
 * symlinks with real directory copies so Docker can access them inside the
 * build context. This mirrors the `stage_shared()` function in dev-local.sh.
 */
export function stageSharedModules(): void {
  log.info("staging shared modules for Docker build contexts");

  if (!fs.existsSync(INTEGRATIONS_DIR)) {
    log.warn("integrations directory not found, skipping staging", {
      path: INTEGRATIONS_DIR,
    });
    return;
  }

  const packages = fs
    .readdirSync(INTEGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory());

  for (const pkg of packages) {
    const pkgDir = path.join(INTEGRATIONS_DIR, pkg.name);

    for (const linkName of ["tools", "shared-tools"]) {
      const linkPath = path.join(pkgDir, linkName);

      // Only process if it's a symlink
      try {
        const stat = fs.lstatSync(linkPath);
        if (!stat.isSymbolicLink()) continue;
      } catch {
        // Doesn't exist -- skip
        continue;
      }

      // Resolve the symlink target
      let target = fs.readlinkSync(linkPath);
      if (!path.isAbsolute(target)) {
        target = path.resolve(path.dirname(linkPath), target);
      }

      if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
        log.warn("symlink target missing or not a directory", {
          link: linkPath,
          target,
        });
        continue;
      }

      // Remove the symlink, copy the real directory in its place
      fs.rmSync(linkPath);
      fs.cpSync(target, linkPath, { recursive: true });
      log.debug("staged shared module", {
        pkg: pkg.name,
        link: linkName,
        from: target,
      });
    }
  }

  log.info("shared module staging complete");
}

/**
 * Restore symlinks that `stageSharedModules()` replaced with real dirs.
 * Delegates to `git checkout` on the known paths, same as dev-local.sh.
 */
export function restoreSymlinks(): void {
  log.debug("restoring symlinks via git checkout");
  try {
    execSync(
      "git checkout -- integrations/*/tools integrations/*/shared-tools",
      {
        cwd: SHOWCASE_DIR,
        stdio: "pipe",
        encoding: "utf-8",
      },
    );
  } catch {
    // Non-fatal: some dirs may not have symlinks
    log.debug("git checkout for symlink restore returned non-zero (ok)");
  }
}

// ---------------------------------------------------------------------------
// Timestamp file for diff-logs --since last-test
// ---------------------------------------------------------------------------

const LAST_TEST_TS_FILE = path.join(SHOWCASE_DIR, ".last-test-ts");

/**
 * Write the current timestamp to `.last-test-ts` so `diff-logs --since last-test`
 * can reference when the last test run started.
 */
export function writeLastTestTimestamp(): void {
  fs.writeFileSync(LAST_TEST_TS_FILE, new Date().toISOString(), "utf-8");
  log.debug("wrote last-test timestamp", { path: LAST_TEST_TS_FILE });
}

/**
 * Read the last-test timestamp. Returns null if the file doesn't exist.
 */
function readLastTestTimestamp(): string | null {
  try {
    return fs.readFileSync(LAST_TEST_TS_FILE, "utf-8").trim();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Lifecycle functions
// ---------------------------------------------------------------------------

/**
 * Start services via docker compose.
 *
 * - If `slugs` is empty, starts only the `infra` profile.
 * - If `slugs` are provided, starts the `infra` profile plus one profile per slug.
 * - After starting, runs health checks on all started services.
 */
export async function up(
  slugs: string[],
  opts?: LifecycleOptions,
): Promise<void> {
  try {
    stageSharedModules();
    const profileArgs: string[] = ["--profile", "infra"];
    for (const slug of slugs) {
      profileArgs.push("--profile", slug);
    }

    const verboseFlag = opts?.verbose ? ["--progress", "plain"] : [];
    const args = [...profileArgs, "up", "-d", "--build", ...verboseFlag];

    log.info("starting services", { slugs: slugs.length ? slugs : ["infra"] });
    compose(...args);

    // Determine which services to health-check
    const servicesToCheck =
      slugs.length > 0
        ? [...Object.keys(INFRA_PORTS), ...slugs]
        : Object.keys(INFRA_PORTS);

    const results = await healthCheck(servicesToCheck);
    const unhealthy = [...results.entries()]
      .filter(([, ok]) => !ok)
      .map(([name]) => name);

    if (unhealthy.length > 0) {
      throw new Error(
        `Health check failed for: ${unhealthy.join(", ")}. Check logs with: showcase logs <slug>`,
      );
    }

    log.info("all services healthy");
  } finally {
    restoreSymlinks();
  }
}

/**
 * Stop services via docker compose.
 *
 * - If `slugs` is empty, tears down the entire compose stack.
 * - If `slugs` are provided, stops only those specific services.
 */
export async function down(
  slugs: string[],
  _opts?: LifecycleOptions,
): Promise<void> {
  if (slugs.length === 0) {
    log.info("tearing down all services");
    compose("--profile", "all", "down");
  } else {
    log.info("stopping services", { slugs });
    const profileArgs = slugs.flatMap((s) => ["--profile", s]);
    compose(...profileArgs, "stop", ...slugs);
  }
}

/**
 * Rebuild Docker images, optionally for specific services.
 *
 * Stages shared modules first, builds images, then restarts any services
 * that were running before the rebuild.
 */
export async function rebuild(
  slugs: string[],
  _opts?: LifecycleOptions,
): Promise<void> {
  try {
    stageSharedModules();
    // When no specific slugs, check ALL running services for restart
    const servicesToCheck = slugs.length > 0 ? slugs : listRunningServices();
    const runningBefore: string[] = [];
    if (slugs.length > 0) {
      for (const slug of servicesToCheck) {
        if (await isRunning(slug)) {
          runningBefore.push(slug);
        }
      }
    } else {
      runningBefore.push(...servicesToCheck);
    }

    log.info("rebuilding images", {
      slugs: slugs.length ? slugs : ["all"],
    });

    if (slugs.length > 0) {
      const profileArgs = slugs.flatMap((s) => ["--profile", s]);
      compose(...profileArgs, "build", ...slugs);
    } else {
      compose("--profile", "all", "build");
    }

    if (runningBefore.length > 0) {
      log.info("restarting previously-running services", {
        services: runningBefore,
      });
      const restartProfiles = runningBefore.flatMap((s) => ["--profile", s]);
      compose(...restartProfiles, "up", "-d", ...runningBefore);
    }
  } finally {
    restoreSymlinks();
  }
}

/**
 * Return docker compose ps output as a string.
 */
export function ps(_opts?: LifecycleOptions): string {
  return compose("--profile", "all", "ps");
}

/**
 * Stream logs for a specific service to the terminal.
 * Uses spawn with inherited stdio so output streams directly.
 */
export async function logs(
  slug: string,
  _opts?: LifecycleOptions,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      "docker",
      ["compose", "-f", COMPOSE_FILE, "logs", "-f", slug],
      {
        cwd: SHOWCASE_DIR,
        stdio: "inherit",
      } satisfies SpawnOptions,
    );

    child.on("error", (err) => {
      reject(new Error(`Failed to stream logs for ${slug}: ${err.message}`));
    });

    child.on("close", (code) => {
      if (code === 0 || code === null) {
        resolve();
      } else {
        reject(new Error(`Log streaming for ${slug} exited with code ${code}`));
      }
    });
  });
}

/**
 * Build Docker images without starting containers.
 *
 * - If `slugs` is empty, builds all images.
 * - If `slugs` are provided, builds only those service images.
 */
export async function build(
  slugs: string[],
  _opts?: LifecycleOptions,
): Promise<void> {
  try {
    stageSharedModules();

    log.info("building images", {
      slugs: slugs.length ? slugs : ["all"],
    });

    if (slugs.length > 0) {
      const profileArgs = slugs.flatMap((s) => ["--profile", s]);
      compose(...profileArgs, "build", ...slugs);
    } else {
      compose("--profile", "all", "build");
    }

    log.info("build complete");
  } finally {
    restoreSymlinks();
  }
}

/**
 * Force-recreate a service container, optionally rebuilding the image first.
 * Runs a health check after recreating.
 */
export async function recreate(
  slug: string,
  opts?: { build?: boolean },
): Promise<void> {
  log.info("recreating service", { slug, build: opts?.build ?? false });

  const args = [
    "--profile",
    slug,
    "up",
    "-d",
    "--force-recreate",
    ...(opts?.build ? ["--build"] : []),
    slug,
  ];

  if (opts?.build) {
    try {
      stageSharedModules();
      compose(...args);
    } finally {
      restoreSymlinks();
    }
  } else {
    compose(...args);
  }

  // Health check
  const results = await healthCheck([slug]);
  const healthy = results.get(slug);

  if (!healthy) {
    throw new Error(
      `Health check failed for ${slug} after recreate. Check logs with: showcase logs ${slug}`,
    );
  }

  log.info("recreate complete, service healthy", { slug });
}

/**
 * Return a formatted slug-to-port mapping table.
 */
export function ports(): string {
  const integrationPorts = loadPortsFile();

  const lines: string[] = ["\n  Slug                        Port"];
  lines.push("  " + "-".repeat(40));

  // Print infra ports first, then integration ports alphabetically
  const infraEntries = Object.entries(INFRA_PORTS).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const integrationEntries = Object.entries(integrationPorts).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  for (const [slug, port] of infraEntries) {
    lines.push(`  ${slug.padEnd(28)} ${port}  (infra)`);
  }

  if (integrationEntries.length > 0) {
    lines.push("  " + "-".repeat(40));
    for (const [slug, port] of integrationEntries) {
      lines.push(`  ${slug.padEnd(28)} ${port}`);
    }
  }

  return lines.join("\n");
}

/**
 * Show filtered logs for a service within a time window.
 *
 * @param slug - Service name
 * @param opts.since - Duration string (e.g. "5m", "30s") or "last-test"
 * @param opts.grep - Optional pattern filter
 */
export async function diffLogs(
  slug: string,
  opts?: { since?: string; grep?: string },
): Promise<void> {
  let sinceArg = opts?.since ?? "5m";

  // Resolve "last-test" to a duration
  if (sinceArg === "last-test") {
    const ts = readLastTestTimestamp();
    if (!ts) {
      throw new Error(
        "No last-test timestamp found. Run a test first: showcase test <target>",
      );
    }
    // Calculate seconds since last test
    const elapsed = Math.max(
      1,
      Math.ceil((Date.now() - new Date(ts).getTime()) / 1000),
    );
    sinceArg = `${elapsed}s`;
    log.info("resolved last-test to duration", { ts, sinceArg });
  }

  const args: string[] = [
    "compose",
    "-f",
    COMPOSE_FILE,
    "logs",
    "--since",
    sinceArg,
  ];

  if (opts?.grep) {
    // docker compose logs doesn't have --grep, so we filter with a pipe
    // Instead, use the native --no-log-prefix and filter ourselves
  }

  args.push(slug);

  log.debug("exec", { cmd: ["docker", ...args].join(" ") });

  return new Promise<void>((resolve, reject) => {
    const child = spawn("docker", args, {
      cwd: SHOWCASE_DIR,
      stdio: opts?.grep ? ["pipe", "pipe", "inherit"] : "inherit",
    } satisfies SpawnOptions);

    if (opts?.grep && child.stdout) {
      const pattern = new RegExp(opts.grep, "i");
      child.stdout.on("data", (chunk: Buffer) => {
        const lines = chunk.toString().split("\n");
        for (const line of lines) {
          if (pattern.test(line)) {
            process.stdout.write(line + "\n");
          }
        }
      });
    }

    child.on("error", (err) => {
      reject(new Error(`Failed to get logs for ${slug}: ${err.message}`));
    });

    child.on("close", (code) => {
      if (code === 0 || code === null) {
        resolve();
      } else {
        reject(new Error(`Log retrieval for ${slug} exited with code ${code}`));
      }
    });
  });
}

/**
 * Check health of the given services by hitting their HTTP health endpoints.
 *
 * Retries each service for up to 30 seconds with 2-second intervals.
 * Returns a map of service name to healthy boolean.
 */
export async function healthCheck(
  services: string[],
): Promise<Map<string, boolean>> {
  const results = new Map<string, boolean>();
  const maxWaitMs = 30_000;
  const intervalMs = 2_000;

  log.info("running health checks", { services });

  const checks = services.map(async (service) => {
    const port = resolvePort(service);
    if (port === undefined) {
      log.error("no port mapping for service — marking unhealthy", { service });
      results.set(service, false);
      return;
    }

    const endpoint = resolveHealthEndpoint(service);
    const url = `http://localhost:${port}${endpoint}`;
    const deadline = Date.now() + maxWaitMs;

    log.info("waiting for service", { service, url });

    while (Date.now() < deadline) {
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(5_000),
        });
        if (response.ok) {
          log.info("service healthy", { service, status: response.status });
          results.set(service, true);
          return;
        }
        log.debug("health check returned non-ok", {
          service,
          status: response.status,
        });
      } catch (err) {
        log.debug("health check not ready yet", {
          service,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      await sleep(intervalMs);
    }

    log.error("service failed health check after timeout", {
      service,
      url,
      timeoutMs: maxWaitMs,
    });
    results.set(service, false);
  });

  await Promise.all(checks);
  return results;
}

/**
 * Check whether a specific docker compose service is currently running.
 */
export async function isRunning(slug: string): Promise<boolean> {
  try {
    const output = compose(
      "--profile",
      "all",
      "ps",
      "--status",
      "running",
      slug,
    );
    const lines = output.split("\n").filter((l) => l.trim().length > 0);
    return lines.length > 1;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("no such service") || msg.includes("is not valid")) {
      return false;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function listRunningServices(): string[] {
  try {
    const output = compose(
      "--profile",
      "all",
      "ps",
      "--status",
      "running",
      "--format",
      "{{.Service}}",
    );
    return output
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  } catch {
    return [];
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
