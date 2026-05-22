import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { LauncherEvent } from "../shared/types.js";

import { createHttpServer } from "./http-server.js";
import { scanWorkspace } from "./scanner.js";
import { startWsServer } from "./ws-server.js";

/**
 * Launcher orchestrator. Owns the lifecycle of:
 *   1. The HTTP server (static SPA assets).
 *   2. The WebSocket server (registry events to/from the SPA).
 *   3. The initial workspace scan.
 *
 * File watching (chokidar) and project-root walk-up are M1's job; for M0 we
 * accept the `--root` flag verbatim and do a single scan on boot.
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
};

export type LauncherHandle = {
  url: string;
  shutdown: () => Promise<void>;
};

export async function startLauncher(
  options: LauncherOptions,
): Promise<LauncherHandle> {
  const rootDir = resolve(options.rootDir);
  const spaDir = options.spaDir ?? resolveDefaultSpaDir();
  const port = options.port;

  let snapshot: LauncherEvent | null = null;
  let workspaceReady: LauncherEvent | null = null;

  const httpServer = createHttpServer({
    spaDir,
    devPlaceholderHtml: buildDevPlaceholderHtml(port),
  });

  const ws = startWsServer({
    httpServer,
    onConnect: (send) => {
      // Replay the latest snapshot to the freshly-connected client so the
      // SPA can render without waiting for the next event.
      if (workspaceReady) send(workspaceReady);
      if (snapshot) send(snapshot);
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

  const scan = await scanWorkspace(rootDir);

  workspaceReady = {
    type: "workspace.ready",
    rootDir,
    scannedFiles: scan.scannedFiles,
  };
  snapshot = {
    type: "registry.snapshot",
    tools: scan.tools,
    scannedAt: new Date().toISOString(),
  };

  console.info(
    `[studio] Scan complete: ${scan.tools.length} tool${scan.tools.length === 1 ? "" : "s"} ` +
      `across ${scan.scannedFiles} file${scan.scannedFiles === 1 ? "" : "s"}.`,
  );

  // Broadcast to anyone already connected (rare race, but cheap).
  ws.broadcast(workspaceReady);
  ws.broadcast(snapshot);

  return {
    url: `http://localhost:${port}`,
    shutdown: async () => {
      await ws.close();
      await new Promise<void>((resolveClose) =>
        httpServer.close(() => resolveClose()),
      );
    },
  };
}

function resolveDefaultSpaDir(): string {
  // When compiled, this file lives at `dist/src/launcher/index.js` and the
  // built SPA lives at `dist/spa/`. When run via tsx during dev it's
  // `src/launcher/index.ts`, so the SPA is at `<package>/dist/spa`.
  const here = dirname(fileURLToPath(import.meta.url));
  // Path separator differs by platform, but `dist` always appears as a
  // standalone path segment. Splitting and testing each segment is
  // platform-portable and avoids hard-coded slashes.
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
 * enough for the M0 smoke test to confirm the wire works end-to-end.
 */
function buildDevPlaceholderHtml(port: number): string {
  const wsUrl = `ws://localhost:${port}/__inspector/ws`;
  // Keep this string self-contained — no template-literal interpolation
  // beyond `wsUrl`. Browser-side code lives in src/spa/.
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>CopilotKit Studio (M0 dev placeholder)</title>
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
    </style>
  </head>
  <body>
    <h1>CopilotKit Studio</h1>
    <p>M0 dev placeholder. Run <code>nx run @copilotkit/studio:build</code> to serve the full SPA.</p>
    <div id="status" class="empty">Connecting to launcher...</div>
    <ul id="tools"></ul>
    <script>
      (function () {
        var status = document.getElementById("status");
        var list = document.getElementById("tools");
        var ws = new WebSocket(${JSON.stringify(wsUrl)});

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
            list.innerHTML = "";
            if (msg.tools.length === 0) {
              var li = document.createElement("li");
              li.className = "empty";
              li.textContent = "(no useCopilotAction call sites found)";
              list.appendChild(li);
              return;
            }
            msg.tools.forEach(function (tool) {
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
        });
      })();
    </script>
  </body>
</html>`;
}

// Re-export the public types for downstream agents that import from
// `@copilotkit/studio/src/launcher` rather than the shared module.
export type { LauncherEvent };
