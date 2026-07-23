import { execSync, execFileSync, spawn } from "node:child_process";
import type { SpawnOptions } from "node:child_process";
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
// Honor SHOWCASE_COMPOSE_FILE env var (set by isolation overlay) so the harness
// uses the offset/renamed temp compose file instead of the checked-in original.
// Without this override, every `docker compose` call would target the default
// project's compose file → concurrent --isolate runs collide on container names.
const COMPOSE_FILE =
  process.env.SHOWCASE_COMPOSE_FILE ||
  path.join(SHOWCASE_DIR, "docker-compose.local.yml");
const INTEGRATIONS_DIR = path.join(SHOWCASE_DIR, "integrations");
const ANGULAR_BROWSER_DIR = path.join(
  SHOWCASE_DIR,
  "angular",
  "dist",
  "showcase-angular",
  "browser",
);
// Honor LOCAL_PORTS_FILE env var (set by isolation overlay) so the harness
// reads offset ports from a temp file instead of the checked-in original.
const PORTS_FILE =
  process.env.LOCAL_PORTS_FILE ||
  path.join(SHOWCASE_DIR, "shared/local-ports.json");

/** Well-known infra service ports that aren't in local-ports.json.
 *
 * Honor SHOWCASE_INFRA_PORT_OFFSET (set by --isolate) so health checks hit
 * the offset host ports of the isolated stack instead of the default
 * project's :4010/:8090/:3210 (which would silently report "healthy"
 * against the WRONG containers). */
const _INFRA_OFFSET = Number(process.env.SHOWCASE_INFRA_PORT_OFFSET) || 0;
const INFRA_PORTS: Record<string, number> = {
  aimock: 4010 + _INFRA_OFFSET,
  pocketbase: 8090 + _INFRA_OFFSET,
  dashboard: 3210 + _INFRA_OFFSET,
};

/** Health-check endpoint overrides per service type. */
const HEALTH_ENDPOINTS: Record<string, string> = {
  aimock: "/health",
  pocketbase: "/api/health",
  dashboard: "/",
};

/** Default health endpoint for integration services.
 *  Matches the compose-level integration healthcheck
 *  (`curl -f http://localhost:10000/api/health`) in docker-compose.local.yml. */
const DEFAULT_HEALTH_ENDPOINT = "/api/health";

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
        { cause: err },
      );
    }
    const e = err as { stderr?: string; status?: number };
    const stderr = typeof e.stderr === "string" ? e.stderr.trim() : "";
    throw new Error(
      `docker compose failed (exit ${e.status ?? "?"}): docker ${fullArgs.join(" ")}\n${stderr}`,
      { cause: err },
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
 * For each integration package directory, replace `tools`, `shared-tools`,
 * `_shared`, and `public/angular` symlinks with real directory copies so
 * Docker can access them inside the build context. This mirrors
 * `stage_shared()` in `scripts/cli/_common.sh`. `_shared` carries the
 * single-source CVDIAG bootstrap module (`showcase/integrations/_shared/`)
 * into each Python integration's context, while `public/angular` carries one
 * shared Angular browser build into every integration image.
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

    for (const linkName of ["tools", "shared-tools", "_shared"]) {
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

    const angularLink = path.join(pkgDir, "public", "angular");
    let angularIsSymlink = false;
    try {
      angularIsSymlink = fs.lstatSync(angularLink).isSymbolicLink();
    } catch {
      // Missing Angular link means this package does not host the shared app.
    }
    if (!angularIsSymlink) continue;

    if (!fs.existsSync(ANGULAR_BROWSER_DIR)) {
      log.info("building shared Angular browser artifact");
      execFileSync(
        "pnpm",
        ["nx", "run", "@copilotkit/showcase-angular-host:build"],
        {
          cwd: path.dirname(SHOWCASE_DIR),
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
    }
    if (!fs.existsSync(ANGULAR_BROWSER_DIR)) {
      throw new Error(
        `Angular browser build did not produce ${ANGULAR_BROWSER_DIR}`,
      );
    }

    fs.rmSync(angularLink);
    fs.cpSync(ANGULAR_BROWSER_DIR, angularLink, { recursive: true });
    fs.writeFileSync(
      path.join(angularLink, "runtime-config.js"),
      `globalThis.__COPILOTKIT_SHOWCASE__ = Object.freeze({"frontendId":"angular","integrationId":"${pkg.name}"});\n`,
      "utf-8",
    );
    log.debug("staged Angular browser artifact", {
      pkg: pkg.name,
      from: ANGULAR_BROWSER_DIR,
    });
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
    // NOTE: the `integrations/*/_shared` glob restores the per-integration
    // `_shared` symlinks that staging replaced with real copies. It also
    // matches the canonical source dir `integrations/_shared` (a real tracked
    // dir, never a symlink) — a no-op restore there is harmless.
    execSync(
      "git checkout -- integrations/*/tools integrations/*/shared-tools integrations/*/_shared integrations/*/public/angular",
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
    // Two-call strategy to preserve A21's BuildKit-contention fix (target-only
    // rebuild) WITHOUT regressing the infra startup that A21 inadvertently
    // dropped (A21b, issue #5495).
    //
    // docker compose semantics: positional service names after `up` restrict
    // WHICH services start to the named ones + their `depends_on` chain — not
    // just which ones get `--build`-rebuilt. A21 passed the target slug as a
    // positional after `up -d --build`, which (correctly) scoped the rebuild
    // to the slug but (incorrectly) prevented infra services without an
    // explicit `depends_on` from the target (pocketbase, dashboard, harness,
    // harness-pool-worker) from coming up. Under `--isolate` with a sibling
    // stack holding the same host ports, health checks then crossed onto the
    // foreign containers and the cell silently misrouted → 0.0s red.
    //
    // Fix: split into two calls when slugs is non-empty.
    //   1. compose <profiles> up -d              — start ALL services in the
    //      active profiles using cached images. No `--build`, no positional
    //      services. Brings up the full infra profile + the slug's profile.
    //   2. compose <profiles> up -d --build <slug...>
    //      Force-rebuild ONLY the named services and ensure they're up. Other
    //      services already running from call (1) are no-ops.
    //
    // When slugs is empty (infra-only bring-up), keep the single blanket call
    // so first-time bootstrap still builds whatever infra images are missing.
    log.info("starting services", { slugs: slugs.length ? slugs : ["infra"] });
    // Track which compose call most recently ran so a downstream health
    // failure can name the call that touched the unhealthy service. Without
    // this, an operator seeing "Health check failed for: <slug>" cannot tell
    // whether infra-up (call 1) crossed onto a foreign container or whether
    // the target's rebuild (call 2) produced a broken image.
    let lastComposeCall: string;
    if (slugs.length > 0) {
      // Call 1: bring up all services (no build, cached images).
      lastComposeCall = "call 1 (infra-up: profiles up -d, no build)";
      compose(...profileArgs, "up", "-d", ...verboseFlag);
      // Call 2: rebuild target slug(s) and ensure they're up.
      lastComposeCall =
        "call 2 (target rebuild: profiles up -d --build <slug>...)";
      compose(...profileArgs, "up", "-d", "--build", ...verboseFlag, ...slugs);
    } else {
      // Infra-only: single call with blanket --build for first-time bootstrap.
      lastComposeCall = "infra-only (profiles up -d --build, no slugs)";
      compose(...profileArgs, "up", "-d", "--build", ...verboseFlag);
    }

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
        `Health check failed for: ${unhealthy.join(", ")} after ${lastComposeCall}. Check logs with: showcase logs <slug>`,
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
 * Stages shared modules first, builds images, then force-recreates the
 * targeted services so a stale running container is always replaced with
 * the freshly-built image (a rebuild that left the old container running
 * was a silent no-op — see the 36h-stale-image false-positive).
 *
 * The `infra` profile is always included alongside the targeted slugs so
 * compose can resolve infra `depends_on` deps (e.g. `aimock`). Without it,
 * `docker compose --profile <slug> build <slug>` fails with
 * "service <slug> depends on undefined service aimock".
 */
export async function rebuild(
  slugs: string[],
  _opts?: LifecycleOptions,
): Promise<void> {
  try {
    stageSharedModules();

    log.info("rebuilding images", {
      slugs: slugs.length ? slugs : ["all"],
    });

    if (slugs.length > 0) {
      // Always include the infra profile so infra `depends_on` deps
      // (aimock, pocketbase, dashboard) are defined for the targeted slugs.
      const profileArgs = ["--profile", "infra"];
      for (const slug of slugs) {
        profileArgs.push("--profile", slug);
      }
      compose(...profileArgs, "build", ...slugs);

      // Force-recreate the targeted containers so the freshly-built image
      // is actually adopted even if they were already running. `up -d`
      // without --force-recreate would leave a stale container in place.
      log.info("recreating services with freshly-built images", {
        services: slugs,
      });
      compose(...profileArgs, "up", "-d", "--force-recreate", ...slugs);
    } else {
      // No specific slugs: rebuild everything, then recreate whatever was
      // running before so we don't spin up services that were down.
      const runningBefore = listRunningServices();
      compose("--profile", "all", "build");

      if (runningBefore.length > 0) {
        log.info("recreating previously-running services", {
          services: runningBefore,
        });
        const restartProfiles = runningBefore.flatMap((s) => ["--profile", s]);
        compose(
          ...restartProfiles,
          "up",
          "-d",
          "--force-recreate",
          ...runningBefore,
        );
      }
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
  // Honor SHOWCASE_HEALTHCHECK_TIMEOUT_MS so cold-start isolated stacks
  // (slower than the warm default project) have time to come up. Default
  // bumped from 30s to 90s — Next.js + Python/JVM agents commonly need 60s+
  // on first boot inside a fresh project.
  const maxWaitMs =
    Number(process.env.SHOWCASE_HEALTHCHECK_TIMEOUT_MS) || 90_000;
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
