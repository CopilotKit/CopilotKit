import type { IncomingMessage, Server as HttpServer } from "node:http";

import { WebSocketServer, WebSocket } from "ws";

import type { LauncherCommand, LauncherEvent } from "../shared/types.js";

/**
 * Local WebSocket server bridging the launcher (Node) to the SPA (browser).
 *
 * Path: `ws://localhost:NNNN/__inspector/ws`. Localhost-only trust model —
 * no auth in v1, same as Vite/Next dev servers. Spec:
 * .chalk/plans/web-inspector-v1.md §7.2.
 *
 * On every fresh client connection the server invokes the provided
 * `onConnect` callback so the launcher can push a `registry.snapshot`
 * immediately. M0 has no incoming-command handling yet — that lands with
 * M2's fixture save flow.
 */

const WS_PATH = "/__inspector/ws";

export type LauncherWsServerOptions = {
  /** Existing HTTP server to attach the WS upgrade handler to. */
  httpServer: HttpServer;
  /** Called whenever a new SPA client connects. Use it to send a snapshot. */
  onConnect: (send: (event: LauncherEvent) => void) => void;
  /** Optional command handler — not used in M0; required from M2 onward. */
  onCommand?: (command: LauncherCommand) => void;
};

export type LauncherWsServer = {
  /** Push an event to every connected SPA client. */
  broadcast: (event: LauncherEvent) => void;
  /** Number of currently-connected SPA clients. */
  clientCount: () => number;
  /** Tear down the WS server (does not close the underlying http server). */
  close: () => Promise<void>;
};

export function startWsServer(
  options: LauncherWsServerOptions,
): LauncherWsServer {
  const { httpServer, onConnect, onCommand } = options;

  // `noServer: true` so we own the `upgrade` event and can scope it to the
  // inspector path. This keeps the HTTP server free to serve static SPA
  // assets without colliding with WS upgrades on unrelated paths.
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request: IncomingMessage, socket, head) => {
    const { url } = request;
    if (!url || !url.startsWith(WS_PATH)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  const sendTo = (ws: WebSocket, event: LauncherEvent) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(event));
  };

  wss.on("connection", (ws) => {
    onConnect((event) => sendTo(ws, event));

    if (onCommand) {
      ws.on("message", (data) => {
        try {
          const parsed = JSON.parse(data.toString()) as LauncherCommand;
          onCommand(parsed);
        } catch {
          // Malformed messages are ignored in v1 — same dev-tool tolerance
          // Vite/Next take with HMR clients.
        }
      });
    }
  });

  return {
    broadcast: (event) => {
      const payload = JSON.stringify(event);
      for (const ws of wss.clients) {
        if (ws.readyState === WebSocket.OPEN) ws.send(payload);
      }
    },
    clientCount: () => wss.clients.size,
    close: () =>
      new Promise<void>((resolveClose) => {
        wss.close(() => resolveClose());
      }),
  };
}
