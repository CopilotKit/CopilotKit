import express from "express";
import type { Server } from "node:http";
import type {
  CloudAdapter,
  TurnContext,
  Request as AgentsRequest,
} from "@microsoft/agents-hosting";

export interface TeamsServerConfig {
  adapter: CloudAdapter;
  port: number;
  /**
   * Invoked for every inbound activity, inside the adapter's turn (so
   * `context.sendActivity` replies on the originating request). Throwing here
   * is surfaced through the adapter's `onTurnError`.
   */
  onTurnContext: (context: TurnContext) => Promise<void>;
}

export interface TeamsServer {
  start(): Promise<Server>;
  stop(): Promise<void>;
}

/**
 * Stand up the bot's `POST /api/messages` endpoint.
 *
 * The M365 Agents Playground (and Azure Bot Service) deliver activities here as
 * JSON; `CloudAdapter.process` authenticates the request (anonymous in local
 * Playground mode), builds the `TurnContext`, runs the middleware pipeline, and
 * writes the HTTP response once `onTurnContext` resolves.
 */
export function createTeamsServer(config: TeamsServerConfig): TeamsServer {
  const app = express();
  app.use(express.json());

  app.post("/api/messages", (req, res) => {
    config.adapter
      .process(
        // Cast across HTTP-layer types: the M365 SDK types `process` against its
        // own `express` types, which can differ in major (and `Response` generic
        // arity) from the one resolved here. Express's req/res satisfy the SDK's
        // structural Request/Response at runtime regardless.
        req as unknown as AgentsRequest,
        res as unknown as Parameters<CloudAdapter["process"]>[1],
        async (context) => {
          await config.onTurnContext(context);
        },
      )
      // A failed turn (e.g. an auth error talking to the Bot Connector) must
      // not become an unhandled rejection, which crashes the whole Node
      // process and takes every other conversation down with it. Contain it:
      // log, and make sure the inbound request still gets a response so the
      // channel doesn't hang.
      .catch((err: unknown) => {
        console.error("[bot-teams] POST /api/messages failed:", err);
        if (!res.headersSent) res.status(500).end();
      });
  });

  // A trivial liveness probe, handy when running behind a tunnel.
  app.get("/healthz", (_req, res) => {
    res.status(200).send("ok");
  });

  let server: Server | undefined;

  return {
    start() {
      return new Promise<Server>((resolve) => {
        server = app.listen(config.port, () => resolve(server as Server));
      });
    },
    stop() {
      return new Promise<void>((resolve, reject) => {
        if (!server) {
          resolve();
          return;
        }
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
