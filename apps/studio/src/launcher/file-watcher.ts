/**
 * chokidar wrapper that watches the user's project for source changes that
 * should trigger a registry rescan + delta broadcast.
 *
 * Replaces the VS Code extension's `PlaygroundFileWatcher` (which uses
 * `vscode.workspace.createFileSystemWatcher`) with a node-side equivalent.
 * The semantics — debounce all events into a single rescan, then push deltas
 * — are the same.
 *
 * Why not naive per-file watching: bursty save sequences (`Format on Save`
 * followed by manual save, large refactors touching many files) would
 * otherwise generate one rescan per file. 300 ms debounce coalesces them.
 *
 * Why identity-hash dedup at the scan layer (not here): debouncing solves
 * "many events in a short window"; identity hashing solves "same content
 * after save". They're different problems. The watcher just reports `which
 * files changed`; the launcher's diff logic in `index.ts` decides whether
 * the change is semantically meaningful and worth broadcasting.
 */

import type { FSWatcher } from "chokidar";
import { watch as chokidarWatch } from "chokidar";

const DEFAULT_DEBOUNCE_MS = 300;

const SKIP_DIRS_PATTERNS: ReadonlyArray<RegExp> = [
  /[/\\]node_modules[/\\]/,
  /[/\\]dist[/\\]/,
  /[/\\]build[/\\]/,
  /[/\\]\.next[/\\]/,
  /[/\\]\.turbo[/\\]/,
  /[/\\]\.nx[/\\]/,
  /[/\\]\.git[/\\]/,
  /[/\\]out[/\\]/,
  /[/\\]coverage[/\\]/,
  /[/\\]\.angular[/\\]/,
  /[/\\]storybook-static[/\\]/,
  /[/\\]\.venv[/\\]/,
  /[/\\]__pycache__[/\\]/,
];

export type FileWatcherOptions = {
  /** Project root to watch. Must be absolute. */
  rootDir: string;
  /** Called when the debounced batch of changes lands. */
  onChanged: (changedFiles: string[]) => void;
  /** Override the debounce window (ms). Defaults to 300. */
  debounceMs?: number;
};

export type FileWatcherHandle = {
  /** Tear down the watcher; resolves after chokidar reports closed. */
  close: () => Promise<void>;
};

/**
 * Start watching `rootDir` for `.ts` / `.tsx` changes. Returns a handle the
 * launcher can use to tear the watcher down on shutdown.
 *
 * The callback receives a deduped array of absolute file paths that changed
 * within the debounce window — additions, modifications, and deletions all
 * land in the same callback. Deletions are not distinguished from edits
 * here; the scanner re-reads each file and adjusts the registry accordingly
 * (a missing file produces zero descriptors, which the diff logic reads as
 * removals).
 */
export function startFileWatcher(
  options: FileWatcherOptions,
): FileWatcherHandle {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  const watcher: FSWatcher = chokidarWatch(options.rootDir, {
    ignored: (filePath, stats) => {
      // chokidar v4 calls this for both files and dirs. Bail early when the
      // path matches a skip pattern — applies to directories too, which
      // prunes whole subtrees.
      if (matchesSkipPattern(filePath)) return true;
      if (!stats) return false; // unknown — let chokidar decide
      if (stats.isDirectory()) return false;
      if (!stats.isFile()) return true;
      if (!filePath.endsWith(".ts") && !filePath.endsWith(".tsx")) return true;
      return false;
    },
    ignoreInitial: true, // don't fire `add` for every existing file on boot
    persistent: true,
    awaitWriteFinish: {
      // Defends against editors that write large files in two phases (e.g.
      // VS Code writing a temp file then renaming). 50 ms stability window
      // is enough for any normal editor save and adds no perceptible latency
      // on top of the debounce.
      stabilityThreshold: 50,
      pollInterval: 25,
    },
  });

  let pending: Set<string> = new Set();
  let timer: NodeJS.Timeout | null = null;
  let closed = false;

  const schedule = (filePath: string) => {
    if (closed) return;
    if (!filePath.endsWith(".ts") && !filePath.endsWith(".tsx")) return;
    pending.add(filePath);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const batch = [...pending];
      pending = new Set();
      if (batch.length > 0) options.onChanged(batch);
    }, debounceMs);
  };

  watcher.on("add", schedule);
  watcher.on("change", schedule);
  watcher.on("unlink", schedule);

  return {
    close: async () => {
      closed = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await watcher.close();
    },
  };
}

function matchesSkipPattern(filePath: string): boolean {
  return SKIP_DIRS_PATTERNS.some((re) => re.test(filePath));
}
