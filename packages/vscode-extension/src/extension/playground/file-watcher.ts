import * as vscode from "vscode";

/**
 * Watches the user's workspace for source-level changes that should trigger
 * a playground re-scan + re-bundle, so the chat tab reflects edits without
 * requiring an extension reload.
 *
 * Watches `**\/*.{ts,tsx,css}` — TypeScript/TSX so hook registrations,
 * provider trees, and component definitions stay current; CSS so the
 * Tailwind compile pass re-runs when the user touches their globals.css
 * (theme tokens, plugin imports, etc.).
 *
 * All change/create/delete events feed a single shared debounce timer so
 * a burst of saves (e.g. a `Format on Save` followed by a manual save, or
 * a multi-file refactor) coalesces into one rebuild.
 */
export class PlaygroundFileWatcher implements vscode.Disposable {
  private watchers: vscode.FileSystemWatcher[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private debounceMs: number;
  private ignorePatterns: RegExp[];

  constructor(
    private onAnyChange: () => void,
    options?: { debounceMs?: number; ignorePatterns?: RegExp[] },
  ) {
    this.debounceMs = options?.debounceMs ?? 300;
    // Hot-reload triggers from these directories would either be redundant
    // (build outputs the user doesn't author) or cause loops (codegen output
    // lives in os.tmpdir, but a user could in theory open it as a folder).
    // VS Code's default `files.watcherExclude` already excludes
    // `node_modules` from the FS watcher; we layer on a defensive path
    // filter for cross-platform safety.
    this.ignorePatterns = options?.ignorePatterns ?? [
      /[/\\]node_modules[/\\]/,
      /[/\\]dist[/\\]/,
      /[/\\]build[/\\]/,
      /[/\\]\.next[/\\]/,
      /[/\\]\.turbo[/\\]/,
      /[/\\]\.git[/\\]/,
      /[/\\]out[/\\]/,
      /[/\\]coverage[/\\]/,
    ];

    const watcher =
      vscode.workspace.createFileSystemWatcher("**/*.{ts,tsx,css}");
    const handle = (uri: vscode.Uri): void => this.handleChange(uri);
    watcher.onDidChange(handle);
    watcher.onDidCreate(handle);
    watcher.onDidDelete(handle);
    this.watchers.push(watcher);
  }

  private handleChange(uri: vscode.Uri): void {
    const p = uri.fsPath;
    if (this.ignorePatterns.some((re) => re.test(p))) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.onAnyChange();
    }, this.debounceMs);
  }

  dispose(): void {
    for (const w of this.watchers) w.dispose();
    this.watchers = [];
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
