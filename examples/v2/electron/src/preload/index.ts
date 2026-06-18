import { contextBridge, ipcRenderer } from "electron";

export type FsWriteResult = { ok: true; path: string };
export type ShellRunResult = {
  ok: true;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
};

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
};

export type ElectronApi = typeof api;

contextBridge.exposeInMainWorld("electron", api);
