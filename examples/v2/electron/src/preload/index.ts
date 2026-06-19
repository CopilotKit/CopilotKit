import { contextBridge, ipcRenderer } from "electron";

export type FsWriteResult = { ok: true; path: string };
export type ShellRunResult = {
  ok: true;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
};
export type McpServerStatus = {
  name: string;
  kind: "stdio" | "remote";
  enabled: boolean;
  status: "disabled" | "connecting" | "ready" | "error";
  toolNames: string[];
  logs: string[];
};
export type BridgeInfo = { port: number; token: string; connected: boolean };
export type BridgeActionResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

const api = {
  runtime: {
    getUrl: (): Promise<string | null> => ipcRenderer.invoke("runtime:url"),
  },
  workspace: {
    getRoot: (): Promise<string> => ipcRenderer.invoke("workspace:getRoot"),
  },
  fs: {
    write: (path: string, content: string): Promise<FsWriteResult> =>
      ipcRenderer.invoke("fs:write", path, content),
  },
  shell: {
    run: (command: string, args: string[]): Promise<ShellRunResult> =>
      ipcRenderer.invoke("shell:run", command, args),
  },
  mcp: {
    listServers: (): Promise<McpServerStatus[]> =>
      ipcRenderer.invoke("mcp:listServers"),
    setEnabled: (name: string, enabled: boolean): Promise<McpServerStatus[]> =>
      ipcRenderer.invoke("mcp:setEnabled", name, enabled),
  },
  bridge: {
    getInfo: (): Promise<BridgeInfo> => ipcRenderer.invoke("bridge:getInfo"),
    action: (
      method: "click" | "fill" | "navigate",
      params: Record<string, unknown>,
    ): Promise<BridgeActionResult> =>
      ipcRenderer.invoke("bridge:action", method, params),
  },
};

export type ElectronApi = typeof api;

contextBridge.exposeInMainWorld("electron", api);
