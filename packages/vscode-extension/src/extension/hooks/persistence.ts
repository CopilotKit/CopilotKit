import type * as vscode from "vscode";

export type StoredControls = Record<string, unknown>;

const PREFIX = "copilotkit.hooks.controls";

/**
 * Wraps a VS Code Memento with a key scheme specific to hook controls.
 *
 * Callers must pass canonical (absolute, normalized) file paths — the store
 * uses paths verbatim for key construction and does not deduplicate between
 * different string representations of the same file.
 */
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
    const raw = this.memento.get<unknown>(this.key(filePath, hook, name, line));
    // Defensive: Memento round-trips arbitrary JSON, but a user hand-editing
    // workspaceState could leave junk. Reject anything that isn't a plain object.
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return undefined;
    }
    return raw as StoredControls;
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
    await this.memento.update(this.key(filePath, hook, name, line), undefined);
  }
}
