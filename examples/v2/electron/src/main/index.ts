import dotenv from "dotenv";
import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import { startRuntimeServer } from "./runtime/server";

// Load provider keys (OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_API_KEY) from .env
dotenv.config();

let runtime: { url: string; close: () => Promise<void> } | null = null;

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
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
