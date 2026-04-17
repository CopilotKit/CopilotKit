import type * as vscode from "vscode";

export type StoredControls = Record<string, unknown>;

const PREFIX = "copilotkit.hooks.controls";

export class HookControlsStore {
  constructor(
    private readonly memento: vscode.Memento,
    private readonly workspaceRoot: string,
  ) {}

  private key(
    filePath: string,
    hook: string,
    name: string | null,
    line?: number,
  ): string {
    const identity = name ?? `line:${line ?? 0}`;
    return `${PREFIX}::${this.workspaceRoot}::${filePath}::${hook}::${identity}`;
  }

  load(
    filePath: string,
    hook: string,
    name: string | null,
    line?: number,
  ): StoredControls | undefined {
    return this.memento.get(this.key(filePath, hook, name, line));
  }

  async save(
    filePath: string,
    hook: string,
    name: string | null,
    controls: StoredControls,
    line?: number,
  ): Promise<void> {
    await this.memento.update(this.key(filePath, hook, name, line), controls);
  }

  async reset(
    filePath: string,
    hook: string,
    name: string | null,
    line?: number,
  ): Promise<void> {
    await this.memento.update(
      this.key(filePath, hook, name, line),
      undefined,
    );
  }
}
