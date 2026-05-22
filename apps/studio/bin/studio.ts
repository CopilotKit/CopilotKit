#!/usr/bin/env node
import { exec } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { platform } from "node:process";

import { startLauncher } from "../src/launcher/index.js";
import {
  ProjectRootNotFoundError,
  findProjectRoot,
} from "../src/launcher/project-root.js";

/**
 * CopilotKit Studio CLI entry — `npx @copilotkit/studio` (alias `cpk-studio`).
 *
 * M7 surface:
 *   --root <path>     project to scan (auto-walks-up when omitted)
 *   --port <number>   launcher port (default: 4123)
 *   --runtime <url>   preset the runtime URL in the SPA (?runtime=<url>)
 *   --no-open         don't auto-open the browser
 *   -h, --help        usage
 *
 * Port-binding falls back to the next free port when the default is taken;
 * the chosen port is printed loudly so users with stale launchers running
 * aren't left wondering why the popup handoff lands somewhere else.
 *
 * Note: the popup's "Open in Web Inspector" button (Agent E's
 * `_buildStudioDeepLink`) hardcodes `localhost:4123`, so the default port
 * stays at 4123 unless the user explicitly overrides it.
 */

const DEFAULT_PORT = 4123;
const MAX_PORT_FALLBACK_ATTEMPTS = 25;

type CliArgs = {
  /** Explicit `--root` value, or `null` if it should be auto-detected. */
  root: string | null;
  /** Explicit `--port` value. `null` → auto (try DEFAULT_PORT, fall back if busy). */
  port: number | null;
  /** Explicit `--runtime` value passed to the SPA via `?runtime=...`. */
  runtimeUrl: string | null;
  open: boolean;
};

function parseArgs(argv: readonly string[]): CliArgs {
  const args = argv.slice(2);
  let root: string | null = null;
  let port: number | null = null;
  let runtimeUrl: string | null = null;
  let open = true;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--root") {
      const value = args[++i];
      if (value === undefined)
        throw new Error("--root expected a path argument.");
      root = value;
    } else if (a === "--port") {
      const raw = args[++i];
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0 || value > 65535) {
        throw new Error(`--port expected an integer 1-65535, got: ${raw}`);
      }
      port = value;
    } else if (a === "--runtime") {
      const value = args[++i];
      if (value === undefined) {
        throw new Error("--runtime expected a URL argument.");
      }
      // Be forgiving: trailing slash either way is fine.
      runtimeUrl = value.replace(/\/+$/, "");
    } else if (a === "--no-open") {
      open = false;
    } else if (a === "--help" || a === "-h") {
      printUsage();
      process.exit(0);
    } else if (a !== undefined) {
      throw new Error(`Unknown argument: ${a}`);
    }
  }

  return {
    root: root ? resolve(root) : null,
    port,
    runtimeUrl,
    open,
  };
}

function printUsage(): void {
  const lines = [
    "Usage: cpk-studio [--root <path>] [--port <number>] [--runtime <url>] [--no-open]",
    "",
    "Options:",
    "  --root <path>     Project to scan. When omitted, walks up from cwd",
    "                    looking for the nearest package.json that depends",
    "                    on @copilotkit/*.",
    `  --port <number>   TCP port for the launcher (default: ${DEFAULT_PORT}).`,
    "                    If the port is in use, the launcher tries the next",
    "                    free port and prints the chosen value.",
    "  --runtime <url>   CopilotKit runtime URL — preselects ?runtime=...",
    "                    in the SPA so the timeline + sandbox iframe wire",
    "                    up immediately. Example: http://localhost:3000",
    "  --no-open         Don't auto-open the browser.",
    "  -h, --help        Show this message.",
    "",
    "What works in v1:",
    "  - Discovery: walks your project for useCopilotAction / useRenderTool",
    "    call sites and broadcasts a live registry to the SPA.",
    "  - Sandbox: renders the selected tool inside the user's dev server via",
    "    an iframe using the ?__cpk_sandbox=... query param.",
    "  - Args form: descriptor-driven editable form per parameter.",
    "  - Fixture presets: sibling *.fixture.json files become preset chips.",
    "  - Live timeline (when --runtime is set): SSE-streamed invocations",
    "    from the runtime's /cpk-debug-events endpoint.",
    "",
    "See .chalk/plans/web-inspector-v1.md for the full design.",
  ];
  console.info(lines.join("\n"));
}

/**
 * Probe whether `port` is free on localhost. Resolves to the port number on
 * success; rejects with the underlying error otherwise.
 *
 * We use a real `net.createServer` (rather than just calling the launcher and
 * catching `EADDRINUSE`) so the fallback loop can iterate without partially
 * booting the launcher each time.
 */
function probePort(port: number): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.unref();
    const onError = (err: NodeJS.ErrnoException) => {
      server.close(() => rejectPort(err));
    };
    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", onError);
      server.close(() => resolvePort(port));
    });
  });
}

/**
 * Pick a port to bind to. Tries the requested port first; if it's in use, we
 * walk forward up to `MAX_PORT_FALLBACK_ATTEMPTS` times and return the first
 * free port. If the user explicitly passed `--port`, we honor only that
 * port — failing loudly rather than silently moving the launcher.
 */
async function pickPort(
  requested: number,
  userOverride: boolean,
): Promise<number> {
  try {
    return await probePort(requested);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EADDRINUSE") throw err;
    if (userOverride) {
      throw new Error(
        `Port ${requested} is in use. Pass a different --port or stop the conflicting process.`,
        { cause: err },
      );
    }
  }
  for (let offset = 1; offset <= MAX_PORT_FALLBACK_ATTEMPTS; offset++) {
    const candidate = requested + offset;
    if (candidate > 65535) break;
    try {
      const got = await probePort(candidate);
      return got;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EADDRINUSE") throw err;
    }
  }
  throw new Error(
    `Could not find a free port in [${requested}, ${requested + MAX_PORT_FALLBACK_ATTEMPTS}]. Pass --port explicitly.`,
  );
}

function buildSpaUrl(port: number, runtimeUrl: string | null): string {
  const base = `http://localhost:${port}/`;
  if (!runtimeUrl) return base;
  const params = new URLSearchParams();
  params.set("runtime", runtimeUrl);
  return `${base}?${params.toString()}`;
}

function openInBrowser(url: string): void {
  const command =
    platform === "darwin"
      ? `open "${url}"`
      : platform === "win32"
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;
  exec(command, (err) => {
    if (err) {
      console.warn(`[studio] Could not auto-open browser: ${err.message}`);
      console.warn(`[studio] Open ${url} manually.`);
    }
  });
}

async function main(): Promise<void> {
  let cli: CliArgs;
  try {
    cli = parseArgs(process.argv);
  } catch (err) {
    console.error(`[studio] ${(err as Error).message}\n`);
    printUsage();
    process.exit(1);
  }

  // Resolve the project root before we touch the network so a bad config
  // bails fast with a clear message.
  let rootDir: string;
  if (cli.root) {
    rootDir = cli.root;
  } else {
    try {
      const detected = await findProjectRoot(process.cwd());
      rootDir = detected.rootDir;
      console.info(`[studio] Detected project root: ${rootDir}`);
    } catch (err) {
      if (err instanceof ProjectRootNotFoundError) {
        console.error(`[studio] ${err.message}`);
        console.error(
          `[studio] Hint: pass --root <path> to point at a CopilotKit project.`,
        );
        process.exit(1);
      }
      throw err;
    }
  }

  const requestedPort = cli.port ?? DEFAULT_PORT;
  const userOverride = cli.port !== null;
  let port: number;
  try {
    port = await pickPort(requestedPort, userOverride);
  } catch (err) {
    console.error(`[studio] ${(err as Error).message}`);
    process.exit(1);
  }
  if (port !== requestedPort) {
    console.warn(
      `[studio] Port ${requestedPort} was in use — falling back to ${port}.`,
    );
    console.warn(
      `[studio] Note: the in-app popup handoff hardcodes ${DEFAULT_PORT}, so to`,
    );
    console.warn(
      `[studio] receive "Open in Web Inspector" links, free up port ${DEFAULT_PORT} and restart.`,
    );
  }

  const handle = await startLauncher({ rootDir, port });

  const url = buildSpaUrl(port, cli.runtimeUrl);

  // Header banner — concise + scannable.
  console.info("");
  console.info(`  CopilotKit Studio`);
  console.info(`  ────────────────────────────────────────────`);
  console.info(`  URL:     ${url}`);
  console.info(`  Root:    ${rootDir}`);
  console.info(
    `  Runtime: ${cli.runtimeUrl ?? "(none — set in the header or pass --runtime)"}`,
  );
  console.info("");

  if (cli.open) {
    openInBrowser(url);
  } else {
    console.info(`[studio] --no-open set; open ${url} manually.`);
  }

  const shutdown = async (signal: string) => {
    console.info(`[studio] Received ${signal}, shutting down...`);
    try {
      await handle.shutdown();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[studio] Fatal error:", err);
  process.exit(1);
});
