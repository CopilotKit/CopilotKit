#!/usr/bin/env node
import { exec } from "node:child_process";
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
 * M1 surface: `--root <path>` (optional now — walks up from cwd when
 * omitted), `--port <number>`, `--no-open`. M2+ will add `--runtime`,
 * fixture flags, and the rest.
 */

const DEFAULT_PORT = 4123;

type CliArgs = {
  /** Explicit `--root` value, or `null` if it should be auto-detected. */
  root: string | null;
  port: number;
  open: boolean;
};

function parseArgs(argv: readonly string[]): CliArgs {
  // Skip `node` + script path.
  const args = argv.slice(2);
  let root: string | null = null;
  let port: number | undefined;
  let open = true;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--root") {
      const value = args[++i];
      if (value === undefined) {
        throw new Error("--root expected a path argument.");
      }
      root = value;
    } else if (a === "--port") {
      const value = Number(args[++i]);
      if (!Number.isFinite(value) || value <= 0 || value > 65535) {
        throw new Error(`--port expected an integer 1-65535, got: ${args[i]}`);
      }
      port = value;
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
    port: port ?? DEFAULT_PORT,
    open,
  };
}

function printUsage(): void {
  const lines = [
    "Usage: cpk-studio [--root <path>] [--port <number>] [--no-open]",
    "",
    "Options:",
    "  --root <path>     Project to scan. When omitted, walks up from cwd",
    "                    looking for the nearest package.json that depends",
    "                    on @copilotkit/*.",
    "  --port <number>   TCP port for the launcher (default: 4123).",
    "  --no-open         Don't auto-open the browser.",
    "  -h, --help        Show this message.",
    "",
    "M1 surface — AST-based scanner + file watcher. Sandbox iframe,",
    "fixture loading, arg form, and SSE timeline land in M2-M6.",
    "See .chalk/plans/web-inspector-v1.md.",
  ];
  console.info(lines.join("\n"));
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
        process.exit(1);
      }
      throw err;
    }
  }

  const handle = await startLauncher({
    rootDir,
    port: cli.port,
  });

  console.info(`[studio] Open ${handle.url} in your browser.`);

  if (cli.open) {
    openInBrowser(handle.url);
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
