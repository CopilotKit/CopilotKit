import * as vscode from "vscode";

export class FileWatcher implements vscode.Disposable {
  private watchers: vscode.FileSystemWatcher[] = [];
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private debounceMs: number;

  constructor(
    private onFileChanged: (filePath: string) => void,
    options?: { debounceMs?: number },
  ) {
    this.debounceMs = options?.debounceMs ?? 200;

    // Watch TypeScript/TSX files
    const tsWatcher = vscode.workspace.createFileSystemWatcher("**/*.{ts,tsx}");
    tsWatcher.onDidChange((uri) => this.handleChange(uri));
    tsWatcher.onDidCreate((uri) => this.handleChange(uri));
    this.watchers.push(tsWatcher);

    // Watch JSON fixture files
    const jsonWatcher =
      vscode.workspace.createFileSystemWatcher("**/*.fixture.json");
    jsonWatcher.onDidChange((uri) => this.handleChange(uri));
    jsonWatcher.onDidCreate((uri) => this.handleChange(uri));
    this.watchers.push(jsonWatcher);
  }

  private handleChange(uri: vscode.Uri): void {
    const filePath = uri.fsPath;

    const existing = this.debounceTimers.get(filePath);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(filePath);
      this.onFileChanged(filePath);
    }, this.debounceMs);

    this.debounceTimers.set(filePath, timer);
  }

  dispose(): void {
    for (const watcher of this.watchers) {
      watcher.dispose();
    }
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }
}
