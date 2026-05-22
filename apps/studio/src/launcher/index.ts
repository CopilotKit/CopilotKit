import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { LauncherEvent, ToolDescriptor } from "../shared/types.js";

import type { FileWatcherHandle } from "./file-watcher.js";
import { startFileWatcher } from "./file-watcher.js";
import {
  candidateComponentPaths,
  deleteFixturePreset,
  loadFixtureFile,
  loadFixturesForComponent,
  saveFixturePreset,
} from "./fixture-loader.js";
import { createHttpServer } from "./http-server.js";
import { scanContent, scanWorkspace } from "./scanner.js";
import { startWsServer } from "./ws-server.js";

/**
 * Launcher orchestrator. Owns the lifecycle of:
 *   1. The HTTP server (static SPA assets).
 *   2. The WebSocket server (registry events to/from the SPA).
 *   3. The initial workspace scan + file watcher.
 *
 * M1 added the watcher: any `.ts` / `.tsx` change under `rootDir` triggers a
 * targeted rescan of just the changed files. The launcher diffs the new
 * descriptors against the live snapshot and broadcasts a `registry.delta`
 * event when anything semantically meaningful changed.
 *
 * Why diff at the launcher (not the SPA): the SPA shouldn't have to know how
 * to recompute "what is this file's full set of tools" — that's the
 * launcher's job. The wire protocol carries adds/modifies/removes so the SPA
 * can apply a minimal state update.
 */

export type LauncherOptions = {
  /** Absolute path to the project to scan. */
  rootDir: string;
  /** TCP port for the HTTP + WS server. */
  port: number;
  /**
   * Absolute path to the built SPA directory. Defaults to
   * `<package>/dist/spa`. When the SPA hasn't been built the launcher serves
   * a dev placeholder page so the smoke test can still verify the
   * launcher boots.
   */
  spaDir?: string;
  /**
   * Disable the file watcher. Useful for tests that need a deterministic
   * snapshot. Defaults to false (watcher enabled).
   */
  disableWatcher?: boolean;
};

export type LauncherHandle = {
  url: string;
  shutdown: () => Promise<void>;
};

/**
 * Key for identifying a tool across rescans. A file can host multiple
 * `useCopilotAction` calls with the same `name` (rare but legal in practice
 * — e.g. nested route handlers); include the source line so a rename keeps
 * the wire identity correct.
 *
 * `removed: string[]` in `registry.delta` uses the `name` only (per the type
 * lock at §7.2 of the plan), which is good enough for the SPA's
 * deduplication but not unique. The SPA's `applyDelta` handles that.
 */
const toolKey = (t: ToolDescriptor): string =>
  `${t.filePath}::${t.name}::${t.loc.line}`;

/** Stable hash of the semantic content of a descriptor; used for delta dedup. */
function descriptorHash(t: ToolDescriptor): string {
  // We serialize the fields that matter for downstream consumers. `loc` is
  // included because the SPA shows line numbers; if only the line changes
  // we still want to surface the move. `fixturePath` is included so a
  // newly-created sibling fixture file surfaces as a modified descriptor.
  // `fixtures` is hashed by JSON because the object is small and the order
  // is preserved by the loader.
  const serialized = JSON.stringify({
    name: t.name,
    hook: t.hook,
    description: t.description ?? null,
    parameters: t.parameters,
    enclosingComponent: t.enclosingComponent,
    loc: t.loc,
    filePath: t.filePath,
    fixturePath: t.fixturePath,
    fixtures: t.fixtures,
  });
  return createHash("sha1").update(serialized).digest("hex");
}

export async function startLauncher(
  options: LauncherOptions,
): Promise<LauncherHandle> {
  const rootDir = resolve(options.rootDir);
  const spaDir = options.spaDir ?? resolveDefaultSpaDir();
  const port = options.port;

  /**
   * Live registry of detected tools.
   *
   * `tools` is the authoritative `ToolDescriptor[]` we broadcast on connect.
   * `byFile` indexes them by source file so a per-file rescan can update
   * only the affected entries. `hashes` lets us short-circuit no-op rescans
   * (e.g. format-on-save touched the file but the descriptors didn't move).
   */
  const tools = new Map<string, ToolDescriptor>(); // key = toolKey
  const byFile = new Map<string, string[]>(); // filePath -> toolKey[]
  const hashes = new Map<string, string>(); // toolKey -> sha1

  let snapshotEvent: Extract<
    LauncherEvent,
    { type: "registry.snapshot" }
  > | null = null;
  let workspaceReadyEvent: Extract<
    LauncherEvent,
    { type: "workspace.ready" }
  > | null = null;

  const httpServer = createHttpServer({
    spaDir,
    devPlaceholderHtml: buildDevPlaceholderHtml(port),
  });

  /**
   * Forward-declared command handlers — defined after the scan path is set
   * up, but referenced from the WS server's onCommand callback. Held in a
   * single mutable ref so the linter doesn't flag the placeholders as
   * "doesn't capture any variables from parent scope". Until the handlers
   * resolve to their real implementations, command-loss is safe (the WS
   * upgrade can't fire until `httpServer.listen()` resolves below, and the
   * handlers are assigned before that point).
   */
  const commandHandlers: {
    onScanRefresh: () => void;
    onFixtureSave: (
      toolName: string,
      presetName: string,
      args: unknown,
    ) => void;
    onFixtureDelete: (toolName: string, presetName: string) => void;
  } = {
    onScanRefresh: () => {},
    onFixtureSave: () => {},
    onFixtureDelete: () => {},
  };

  const ws = startWsServer({
    httpServer,
    onConnect: (send) => {
      // Replay the latest snapshot to the freshly-connected client so the
      // SPA can render without waiting for the next event.
      if (workspaceReadyEvent) send(workspaceReadyEvent);
      if (snapshotEvent) send(snapshotEvent);
    },
    onCommand: (command) => {
      // M1: scan.refresh. M2: fixture.save / fixture.delete.
      if (command.type === "scan.refresh") {
        commandHandlers.onScanRefresh();
      } else if (command.type === "fixture.save") {
        commandHandlers.onFixtureSave(
          command.toolName,
          command.presetName,
          command.args,
        );
      } else if (command.type === "fixture.delete") {
        commandHandlers.onFixtureDelete(command.toolName, command.presetName);
      }
    },
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    httpServer.once("error", rejectListen);
    httpServer.listen(port, "127.0.0.1", () => {
      httpServer.off("error", rejectListen);
      resolveListen();
    });
  });

  console.info(`[studio] Listening on http://localhost:${port}`);
  console.info(`[studio] Scanning ${rootDir} ...`);

  /**
   * Inverse index from a fixture file path → set of tool keys whose
   * descriptor was populated from that fixture. Lets the fixture-file
   * watcher map a single `change` event back to the affected tools in O(1).
   *
   * Populated alongside the main `tools` map any time we set a descriptor's
   * `fixturePath`; cleared on descriptor removal.
   */
  const fixtureToTools = new Map<string, Set<string>>(); // fixturePath -> set<toolKey>

  /**
   * Mutate `tool.fixtures` + `tool.fixturePath` from the sibling fixture
   * file (if any). Best-effort: returns the same descriptor on success or
   * on a recoverable failure with `tool.fixtures` left as `null` / `{}`.
   * Parse errors surface via the returned `error` field so the caller can
   * emit a `scan.error` event.
   */
  const applyFixturesToTool = async (
    tool: ToolDescriptor,
  ): Promise<{ tool: ToolDescriptor; error?: string }> => {
    const result = await loadFixturesForComponent(tool.filePath);
    const next: ToolDescriptor = {
      ...tool,
      fixturePath: result.fixturePath,
      fixtures: result.fixtures,
    };
    return result.error ? { tool: next, error: result.error } : { tool: next };
  };

  const indexFixtureForTool = (tool: ToolDescriptor): void => {
    if (!tool.fixturePath) return;
    const key = toolKey(tool);
    let set = fixtureToTools.get(tool.fixturePath);
    if (!set) {
      set = new Set();
      fixtureToTools.set(tool.fixturePath, set);
    }
    set.add(key);
  };

  const unindexFixtureForTool = (tool: ToolDescriptor): void => {
    if (!tool.fixturePath) return;
    const key = toolKey(tool);
    const set = fixtureToTools.get(tool.fixturePath);
    if (!set) return;
    set.delete(key);
    if (set.size === 0) fixtureToTools.delete(tool.fixturePath);
  };

  const initialScan = await scanWorkspace(rootDir);
  // Populate fixtures for every freshly-discovered tool before we register
  // it. This means the first `registry.snapshot` carries fixture data,
  // saving the SPA a round-trip on connect.
  for (const tool of initialScan.tools) {
    const { tool: enriched, error } = await applyFixturesToTool(tool);
    tools.set(toolKey(enriched), enriched);
    appendToByFile(byFile, enriched);
    indexFixtureForTool(enriched);
    hashes.set(toolKey(enriched), descriptorHash(enriched));
    if (error) {
      initialScan.errors.push({
        filePath: enriched.fixturePath ?? enriched.filePath,
        message: error,
      });
    }
  }

  workspaceReadyEvent = {
    type: "workspace.ready",
    rootDir,
    scannedFiles: initialScan.scannedFiles,
  };
  snapshotEvent = {
    type: "registry.snapshot",
    tools: [...tools.values()],
    scannedAt: new Date().toISOString(),
  };

  console.info(
    `[studio] Scan complete: ${tools.size} tool${tools.size === 1 ? "" : "s"} ` +
      `across ${initialScan.scannedFiles} file${initialScan.scannedFiles === 1 ? "" : "s"}.`,
  );

  // Broadcast to anyone already connected (rare race, but cheap).
  ws.broadcast(workspaceReadyEvent);
  ws.broadcast(snapshotEvent);

  // Surface initial-scan parse errors as scan.error events.
  for (const err of initialScan.errors) {
    ws.broadcast({
      type: "scan.error",
      filePath: err.filePath,
      message: err.message,
      at: new Date().toISOString(),
    });
  }

  /**
   * Targeted per-file rescan. Computes the descriptors for *just these
   * files*, diffs against the live registry, and broadcasts a single
   * `registry.delta` event.
   *
   * `changedFiles` may include files that were deleted between the watcher
   * event firing and the rescan landing — those are detected by an ENOENT on
   * `fs.readFile` and reported as removals.
   */
  const rescanFiles = async (changedFiles: string[]): Promise<void> => {
    const added: ToolDescriptor[] = [];
    const modified: ToolDescriptor[] = [];
    const removed: string[] = [];

    // Track keys that should remain after this rescan; whatever was in
    // `byFile[filePath]` before this run and isn't in the new descriptor
    // list is a removal.
    for (const filePath of changedFiles) {
      const previousKeys = new Set(byFile.get(filePath) ?? []);
      let nextDescriptors: ToolDescriptor[] = [];

      try {
        const content = await fs.readFile(filePath, "utf8");
        const result = scanContent(filePath, content);
        if (result.parseError) {
          ws.broadcast({
            type: "scan.error",
            filePath,
            message: result.parseError,
            at: new Date().toISOString(),
          });
          // Treat parse errors as "no descriptors for this file right now"
          // — same effect as a delete. Once the user fixes the syntax error
          // the next change event will re-add the descriptors.
          nextDescriptors = [];
        } else {
          nextDescriptors = result.tools;
        }
      } catch (err) {
        // ENOENT etc. — most commonly a delete or a rename. Drop all
        // previous descriptors for this file.
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") {
          ws.broadcast({
            type: "scan.error",
            filePath,
            message: (err as Error).message ?? "Read failed",
            at: new Date().toISOString(),
          });
        }
        nextDescriptors = [];
      }

      const nextKeys = new Set<string>();
      for (const rawDesc of nextDescriptors) {
        // Re-attach sibling fixture data — the scanner returns descriptors
        // with `fixtures: null, fixturePath: null` so the fixture-loader has
        // to run during every rescan. The cost is one `existsSync` + at
        // most one small file read per tool, which is well below the 300 ms
        // debounce budget.
        const { tool: desc, error: fixtureError } =
          await applyFixturesToTool(rawDesc);
        if (fixtureError) {
          ws.broadcast({
            type: "scan.error",
            filePath: desc.fixturePath ?? desc.filePath,
            message: fixtureError,
            at: new Date().toISOString(),
          });
        }
        const key = toolKey(desc);
        nextKeys.add(key);
        const hash = descriptorHash(desc);
        if (!tools.has(key)) {
          tools.set(key, desc);
          hashes.set(key, hash);
          indexFixtureForTool(desc);
          added.push(desc);
        } else if (hashes.get(key) !== hash) {
          const prev = tools.get(key)!;
          unindexFixtureForTool(prev);
          tools.set(key, desc);
          hashes.set(key, hash);
          indexFixtureForTool(desc);
          modified.push(desc);
        }
        // else: descriptor unchanged — no need to broadcast.
      }
      // Anything that was previously assigned to this file but isn't in the
      // new set was removed.
      for (const previousKey of previousKeys) {
        if (!nextKeys.has(previousKey)) {
          const prev = tools.get(previousKey);
          if (prev) {
            unindexFixtureForTool(prev);
            tools.delete(previousKey);
            hashes.delete(previousKey);
            removed.push(prev.name);
          }
        }
      }
      // Update byFile to the new key set.
      byFile.set(filePath, [...nextKeys]);
      if (nextKeys.size === 0) byFile.delete(filePath);
    }

    if (added.length === 0 && modified.length === 0 && removed.length === 0) {
      // Nothing changed semantically — likely a format-on-save with no
      // meaningful diff. Avoid the wire noise.
      return;
    }

    const delta: Extract<LauncherEvent, { type: "registry.delta" }> = {
      type: "registry.delta",
      added,
      removed,
      modified,
      at: new Date().toISOString(),
    };
    ws.broadcast(delta);

    // Refresh the cached snapshot so late-joining clients see post-delta
    // state without replaying every delta from boot.
    snapshotEvent = {
      type: "registry.snapshot",
      tools: [...tools.values()],
      scannedAt: new Date().toISOString(),
    };

    console.info(
      `[studio] Delta: +${added.length} ~${modified.length} -${removed.length} ` +
        `(now ${tools.size} tool${tools.size === 1 ? "" : "s"}).`,
    );
  };

  /**
   * Full-workspace rescan triggered by the `scan.refresh` command. Replaces
   * the live registry wholesale and broadcasts a fresh snapshot. M1 keeps
   * this path simple; per-file rescans handle the live-edit case. M2
   * enriches each descriptor with sibling fixture data before publishing.
   */
  const rescanWorkspaceAndBroadcast = async (): Promise<void> => {
    const scan = await scanWorkspace(rootDir);
    tools.clear();
    byFile.clear();
    hashes.clear();
    fixtureToTools.clear();
    for (const tool of scan.tools) {
      const { tool: enriched, error } = await applyFixturesToTool(tool);
      tools.set(toolKey(enriched), enriched);
      appendToByFile(byFile, enriched);
      indexFixtureForTool(enriched);
      hashes.set(toolKey(enriched), descriptorHash(enriched));
      if (error) {
        scan.errors.push({
          filePath: enriched.fixturePath ?? enriched.filePath,
          message: error,
        });
      }
    }
    snapshotEvent = {
      type: "registry.snapshot",
      tools: [...tools.values()],
      scannedAt: new Date().toISOString(),
    };
    ws.broadcast(snapshotEvent);
    for (const err of scan.errors) {
      ws.broadcast({
        type: "scan.error",
        filePath: err.filePath,
        message: err.message,
        at: new Date().toISOString(),
      });
    }
    console.info(
      `[studio] Refresh: ${tools.size} tool${tools.size === 1 ? "" : "s"}.`,
    );
  };

  /**
   * Handle a fixture-file change event from the watcher.
   *
   * For each changed fixture file:
   *   1. Reload the fixture (best-effort; parse errors surface as
   *      `scan.error`).
   *   2. Find the descriptors that point at this fixture via the inverse
   *      `fixtureToTools` index. For *new* fixture files (just added next
   *      to an existing component), the index has no entry yet — we
   *      fall back to `candidateComponentPaths` to find the owning
   *      source file and look it up via `byFile`.
   *   3. Update each affected descriptor in-place (fixture data + hash);
   *      emit a single dedicated `fixture.changed` event listing the tool
   *      names that picked up the change.
   *
   * We do not emit a `registry.delta` for fixture-only updates — the SPA
   * can react to `fixture.changed` and update its local descriptor cache
   * directly. Late-joining clients still get the fresh fixture data via
   * the next `registry.snapshot` (we refresh that here too).
   */
  const onFixtureFilesChanged = async (
    changedFixtureFiles: string[],
  ): Promise<void> => {
    for (const fixturePath of changedFixtureFiles) {
      // Step 1: re-read the fixture from disk.
      const result = await loadFixtureFile(fixturePath);
      if (result.error) {
        ws.broadcast({
          type: "scan.error",
          filePath: fixturePath,
          message: result.error,
          at: new Date().toISOString(),
        });
      }

      // Step 2: find affected descriptors. The inverse index is the fast
      // path; for fixtures that didn't exist on disk during the last
      // applyFixturesToTool() call, we walk back from the fixture path to
      // its sibling component files.
      const affectedKeys = new Set<string>(
        fixtureToTools.get(fixturePath) ?? [],
      );
      if (affectedKeys.size === 0) {
        // Fixture is new (or its sibling source file was rescanned without
        // the loader finding it). Look up by candidate component paths.
        for (const candidate of candidateComponentPaths(fixturePath)) {
          const keys = byFile.get(candidate);
          if (!keys) continue;
          for (const key of keys) affectedKeys.add(key);
        }
      }

      // Step 3: rewrite descriptors in place.
      const affectedToolNames: string[] = [];
      const modifiedDescriptors: ToolDescriptor[] = [];
      for (const key of affectedKeys) {
        const prev = tools.get(key);
        if (!prev) continue;
        unindexFixtureForTool(prev);
        const next: ToolDescriptor = {
          ...prev,
          fixturePath: result.fixtures ? fixturePath : null,
          fixtures: result.fixtures ?? null,
        };
        tools.set(key, next);
        indexFixtureForTool(next);
        const newHash = descriptorHash(next);
        if (hashes.get(key) !== newHash) {
          hashes.set(key, newHash);
          modifiedDescriptors.push(next);
        }
        if (!affectedToolNames.includes(next.name)) {
          affectedToolNames.push(next.name);
        }
      }

      // Always emit fixture.changed when the file actually parsed — the
      // SPA wants to know about new presets even if no tool descriptor
      // was changed yet (the fixture might be ahead of a not-yet-saved
      // component file). Skip when the parse failed AND nothing was
      // populated — scan.error has already covered that.
      if (result.fixtures !== null || affectedToolNames.length > 0) {
        const fixtureChanged: Extract<
          LauncherEvent,
          { type: "fixture.changed" }
        > = {
          type: "fixture.changed",
          filePath: fixturePath,
          tools: affectedToolNames,
          fixtures: result.fixtures ?? {},
          at: new Date().toISOString(),
        };
        ws.broadcast(fixtureChanged);
      }

      // Refresh the cached snapshot so future connectors see post-change
      // state. We only refresh when descriptors actually moved — otherwise
      // the snapshot is byte-for-byte identical.
      if (modifiedDescriptors.length > 0) {
        snapshotEvent = {
          type: "registry.snapshot",
          tools: [...tools.values()],
          scannedAt: new Date().toISOString(),
        };
        console.info(
          `[studio] Fixture changed: ${fixturePath} ` +
            `(updated ${modifiedDescriptors.length} tool${modifiedDescriptors.length === 1 ? "" : "s"}).`,
        );
      } else {
        console.info(
          `[studio] Fixture changed: ${fixturePath} (no tools yet).`,
        );
      }
    }
  };

  /**
   * Handle a `fixture.save` WS command from the SPA. Persists the preset to
   * the sibling `.fixture.json` file and re-emits a `fixture.changed` event
   * so other connected clients reflect the change immediately. The watcher
   * will also fire its own event when chokidar notices the write — the
   * resulting double-broadcast is intentional: it makes the round-trip
   * obvious in the SPA's network panel and the second event is idempotent.
   */
  const handleFixtureSave = async (
    toolName: string,
    presetName: string,
    args: unknown,
  ): Promise<void> => {
    // Find the tool. There may be more than one (same name across files);
    // we save to the first match — the SPA addresses tools by name + line in
    // future milestones; v1's fixture.save uses name only per §7.2.
    let target: ToolDescriptor | null = null;
    for (const tool of tools.values()) {
      if (tool.name === toolName) {
        target = tool;
        break;
      }
    }
    if (!target) {
      ws.broadcast({
        type: "scan.error",
        filePath: "(fixture.save)",
        message: `Unknown tool: ${toolName}`,
        at: new Date().toISOString(),
      });
      return;
    }

    try {
      const written = await saveFixturePreset({
        componentPath: target.filePath,
        presetName,
        presetArgs: args,
      });
      // Apply the change in-memory immediately so we don't rely on the
      // watcher round-trip for correctness.
      await onFixtureFilesChanged([written.fixturePath]);
    } catch (err) {
      ws.broadcast({
        type: "scan.error",
        filePath: target.filePath,
        message: `fixture.save failed: ${(err as Error).message}`,
        at: new Date().toISOString(),
      });
    }
  };

  const handleFixtureDelete = async (
    toolName: string,
    presetName: string,
  ): Promise<void> => {
    let target: ToolDescriptor | null = null;
    for (const tool of tools.values()) {
      if (tool.name === toolName) {
        target = tool;
        break;
      }
    }
    if (!target) return;
    try {
      const result = await deleteFixturePreset({
        componentPath: target.filePath,
        presetName,
      });
      if (result) {
        await onFixtureFilesChanged([result.fixturePath]);
      }
    } catch (err) {
      ws.broadcast({
        type: "scan.error",
        filePath: target.filePath,
        message: `fixture.delete failed: ${(err as Error).message}`,
        at: new Date().toISOString(),
      });
    }
  };

  // Wire the forward-declared handlers to their real implementations.
  commandHandlers.onScanRefresh = () => {
    void rescanWorkspaceAndBroadcast();
  };
  commandHandlers.onFixtureSave = (toolName, presetName, args) => {
    void handleFixtureSave(toolName, presetName, args);
  };
  commandHandlers.onFixtureDelete = (toolName, presetName) => {
    void handleFixtureDelete(toolName, presetName);
  };

  let watcher: FileWatcherHandle | null = null;
  if (!options.disableWatcher) {
    watcher = startFileWatcher({
      rootDir,
      onChanged: (changedFiles) => {
        void rescanFiles(changedFiles);
      },
      onFixtureChanged: (changedFixtureFiles) => {
        void onFixtureFilesChanged(changedFixtureFiles);
      },
    });
    console.info(`[studio] Watching ${rootDir} for changes.`);
  }

  return {
    url: `http://localhost:${port}`,
    shutdown: async () => {
      if (watcher) await watcher.close();
      await ws.close();
      await new Promise<void>((resolveClose) =>
        httpServer.close(() => resolveClose()),
      );
    },
  };
}

function appendToByFile(
  byFile: Map<string, string[]>,
  tool: ToolDescriptor,
): void {
  const list = byFile.get(tool.filePath) ?? [];
  list.push(toolKey(tool));
  byFile.set(tool.filePath, list);
}

function resolveDefaultSpaDir(): string {
  // When compiled, this file lives at `dist/src/launcher/index.js` and the
  // built SPA lives at `dist/spa/`. When run via tsx during dev it's
  // `src/launcher/index.ts`, so the SPA is at `<package>/dist/spa`.
  const here = dirname(fileURLToPath(import.meta.url));
  const segments = here.split(/[\\/]+/);
  const distIndex = segments.lastIndexOf("dist");
  if (distIndex >= 0) {
    // Compiled path: <pkg>/dist/src/launcher/index.js → <pkg>/dist/spa
    return resolve(here, "../../spa");
  }
  // Dev path: <pkg>/src/launcher/index.ts → <pkg>/dist/spa
  return resolve(here, "../../dist/spa");
}

/**
 * Tiny HTML page served when the SPA hasn't been built yet. Connects to the
 * launcher WS and renders the detected tool list as a plain bulleted list —
 * enough for the M0/M1 smoke test to confirm the wire works end-to-end.
 */
function buildDevPlaceholderHtml(port: number): string {
  const wsUrl = `ws://localhost:${port}/__inspector/ws`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>CopilotKit Studio (dev placeholder)</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; padding: 2rem; color: #111; }
      h1 { font-size: 1.25rem; margin-bottom: 0.5rem; }
      p { color: #555; margin-top: 0; }
      ul { padding-left: 1rem; }
      li { margin-bottom: 0.5rem; line-height: 1.4; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
      .name { color: #0a6; font-weight: 600; }
      .path { color: #555; }
      .line { color: #888; }
      .empty { color: #999; font-style: italic; }
      .delta { background: #f5f9ff; }
    </style>
  </head>
  <body>
    <h1>CopilotKit Studio</h1>
    <p>Dev placeholder. Run <code>nx run @copilotkit/studio:build</code> to serve the full SPA.</p>
    <div id="status" class="empty">Connecting to launcher...</div>
    <ul id="tools"></ul>
    <script>
      (function () {
        var status = document.getElementById("status");
        var list = document.getElementById("tools");
        var ws = new WebSocket(${JSON.stringify(wsUrl)});

        function render(tools) {
          list.innerHTML = "";
          if (tools.length === 0) {
            var li = document.createElement("li");
            li.className = "empty";
            li.textContent = "(no useCopilotAction call sites found)";
            list.appendChild(li);
            return;
          }
          tools.forEach(function (tool) {
            var li = document.createElement("li");
            var nameEl = document.createElement("span");
            nameEl.className = "name";
            nameEl.textContent = tool.name;
            var pathEl = document.createElement("span");
            pathEl.className = "path";
            pathEl.textContent = " — " + tool.filePath;
            var lineEl = document.createElement("span");
            lineEl.className = "line";
            lineEl.textContent = ":" + tool.loc.line;
            li.appendChild(nameEl);
            li.appendChild(pathEl);
            li.appendChild(lineEl);
            list.appendChild(li);
          });
        }

        var current = [];
        function keyOf(t) { return t.filePath + "::" + t.name + "::" + t.loc.line; }

        ws.addEventListener("open", function () {
          status.textContent = "Connected. Waiting for snapshot...";
        });
        ws.addEventListener("close", function () {
          status.textContent = "Disconnected.";
        });
        ws.addEventListener("error", function () {
          status.textContent = "WebSocket error.";
        });
        ws.addEventListener("message", function (ev) {
          var msg;
          try { msg = JSON.parse(ev.data); } catch (e) { return; }

          if (msg.type === "workspace.ready") {
            status.textContent = "Scanned " + msg.scannedFiles + " files in " + msg.rootDir + ".";
          } else if (msg.type === "registry.snapshot") {
            current = msg.tools.slice();
            render(current);
          } else if (msg.type === "registry.delta") {
            var removedNames = {};
            msg.removed.forEach(function (n) { removedNames[n] = true; });
            var modifiedKeys = {};
            msg.modified.forEach(function (t) { modifiedKeys[keyOf(t)] = true; });
            current = current.filter(function (t) {
              return !removedNames[t.name] && !modifiedKeys[keyOf(t)];
            }).concat(msg.modified).concat(msg.added);
            render(current);
          } else if (msg.type === "scan.error") {
            status.textContent = "Scan error in " + msg.filePath + ": " + msg.message;
          }
        });
      })();
    </script>
  </body>
</html>`;
}

// Re-export the public types for downstream agents that import from
// `@copilotkit/studio/src/launcher` rather than the shared module.
export type { LauncherEvent };
