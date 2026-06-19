import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { app, BrowserWindow, ipcMain } from "electron";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startRuntimeServer } from "./runtime/server";
import { createReadOnlyFsTools } from "./tools/server-tools";
import { writeFile as wsWriteFile } from "./tools/fs-tools";
import { formatShellCommand, runShell } from "./tools/shell";
import { loadMcpConfig } from "./mcp/config";
import { McpManager } from "./mcp/manager";
import { BridgeServer } from "./bridge/server";
import { createBrowserReadTools } from "./bridge/browser-tools";

// Load provider keys (OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_API_KEY) from .env
dotenv.config();

// This file is ESM (package.json "type": "module") so it imports the runtime's
// ESM build, which transitively uses ESM-only deps. Derive __dirname accordingly.
const __dirname = dirname(fileURLToPath(import.meta.url));

const WORKSPACE_ROOT =
  process.env.COPILOT_WORKSPACE_ROOT?.trim() ||
  join(app.getPath("documents"), "copilotkit-electron-workspace");
mkdirSync(WORKSPACE_ROOT, { recursive: true });

const USER_MCP_CONFIG = join(app.getPath("userData"), "mcp.config.json");
const BUNDLED_MCP_CONFIG = existsSync(
  join(app.getAppPath(), "mcp.config.example.json"),
)
  ? join(app.getAppPath(), "mcp.config.example.json")
  : join(__dirname, "../../mcp.config.example.json");

function loadConfiguredServers() {
  const read = (p: string) => readFileSync(p, "utf8");
  const user = loadMcpConfig(read, USER_MCP_CONFIG);
  return user.length > 0 ? user : loadMcpConfig(read, BUNDLED_MCP_CONFIG);
}

const BRIDGE_TOKEN = randomUUID();
let bridge: BridgeServer | null = null;
let bridgePort = 0;

let mcpManager: McpManager | null = null;
let runtime: { url: string; close: () => Promise<void> } | null = null;

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    webPreferences: {
      // Preload MUST be CommonJS — Electron's sandboxed renderer cannot load an
      // ESM preload. electron.vite.config.ts forces this entry to emit index.cjs.
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(async () => {
  let servers: ReturnType<typeof loadConfiguredServers>;
  try {
    servers = loadConfiguredServers();
  } catch (err) {
    console.error(
      "[mcp] failed to load config; starting with no servers:",
      err,
    );
    servers = [];
  }
  mcpManager = new McpManager(servers);
  bridge = new BridgeServer({ token: BRIDGE_TOKEN });
  const { port: bp } = await bridge.start();
  bridgePort = bp;
  runtime = await startRuntimeServer({
    tools: [
      ...createReadOnlyFsTools(WORKSPACE_ROOT),
      ...createBrowserReadTools(bridge),
    ],
    mcpClients: mcpManager.getProviders(),
  });
  ipcMain.handle("runtime:url", () => runtime?.url ?? null);
  ipcMain.handle("mcp:listServers", () => mcpManager?.getStatuses() ?? []);
  ipcMain.handle("mcp:setEnabled", (_e, name: string, enabled: boolean) => {
    mcpManager?.setEnabled(name, enabled);
    return mcpManager?.getStatuses() ?? [];
  });
  ipcMain.handle("workspace:getRoot", () => WORKSPACE_ROOT);
  ipcMain.handle("fs:write", async (_e, relPath: string, content: string) => ({
    ok: true as const,
    path: await wsWriteFile(WORKSPACE_ROOT, relPath, content),
  }));
  ipcMain.handle("shell:run", async (_e, command: string, args: unknown) => {
    const argv = Array.isArray(args) ? (args as string[]) : [];
    const result = await runShell({ command, args: argv, cwd: WORKSPACE_ROOT });
    return {
      ok: true as const,
      command: formatShellCommand(command, argv),
      ...result,
    };
  });
  ipcMain.handle("bridge:getInfo", () => ({
    port: bridgePort,
    token: BRIDGE_TOKEN,
    connected: bridge?.isConnected() ?? false,
  }));
  ipcMain.handle(
    "bridge:action",
    async (
      _e,
      method: "click" | "fill" | "navigate",
      params: Record<string, unknown>,
    ) => {
      if (!bridge) return { ok: false as const, error: "bridge not started" };
      try {
        const data = await bridge.request(method, params);
        return { ok: true as const, data };
      } catch (e) {
        return {
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  );
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  void mcpManager.connectAll(); // background; window already open, panel polls for status
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  void bridge?.close();
  void runtime?.close();
  void mcpManager?.closeAll();
});
