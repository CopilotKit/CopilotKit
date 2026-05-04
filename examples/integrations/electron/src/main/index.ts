import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { startRuntimeServer, type RuntimeServerHandle } from "./runtime-server";

let runtime: RuntimeServerHandle | null = null;

async function createWindow() {
  runtime = await startRuntimeServer();

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  ipcMain.handle("copilotkit:get-runtime-url", () => runtime?.url ?? "");

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(createWindow);

app.on("window-all-closed", async () => {
  await runtime?.close();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
