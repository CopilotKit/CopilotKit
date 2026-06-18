import dotenv from "dotenv";
import { app, BrowserWindow, ipcMain } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startRuntimeServer } from "./runtime/server";

// Load provider keys (OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_API_KEY) from .env
dotenv.config();

// This file is ESM (package.json "type": "module") so it imports the runtime's
// ESM build, which transitively uses ESM-only deps. Derive __dirname accordingly.
const __dirname = dirname(fileURLToPath(import.meta.url));

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
  runtime = await startRuntimeServer();
  ipcMain.handle("runtime:url", () => runtime?.url ?? null);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  void runtime?.close();
});
