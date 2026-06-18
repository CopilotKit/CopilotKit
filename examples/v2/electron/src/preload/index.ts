import { contextBridge, ipcRenderer } from "electron";

export type ElectronApi = { runtime: { getUrl: () => Promise<string | null> } };

const api: ElectronApi = {
  runtime: { getUrl: () => ipcRenderer.invoke("runtime:url") },
};

contextBridge.exposeInMainWorld("electron", api);
