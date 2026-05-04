import { contextBridge, ipcRenderer } from "electron";

const api = {
  getRuntimeUrl: (): Promise<string> =>
    ipcRenderer.invoke("copilotkit:get-runtime-url"),
};

contextBridge.exposeInMainWorld("copilotkit", api);

export type CopilotKitBridge = typeof api;
