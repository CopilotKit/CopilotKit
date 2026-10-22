import type { Server } from "node:http";
import {
  authorizeJWT,
  getAuthConfigWithDefaults,
} from "@microsoft/agents-hosting";
import type {
  AuthConfiguration,
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
  /**
   * Auth settings used to verify each request's Bot Framework JWT. Defaults to
   * the same environment-derived settings `CloudAdapter` uses. Without a
   * `clientId` (and outside production) requests are accepted anonymously,
   * which is what the M365 Agents Playground needs for local development.
   */
  authConfig?: AuthConfiguration;
  /** Extra trusted `serviceUrl` host suffixes; see {@link isTrustedServiceUrl}. */
  allowedServiceUrlHosts?: readonly string[];
}

/**
 * Hosts the Bot Framework delivers `serviceUrl`s from (public, GCC/GCC High/DoD,
 * and China clouds). Exact names, or suffixes when they start with a dot.
 */
const TRUSTED_SERVICE_URL_HOSTS = [
  "smba.trafficmanager.net",
  ".botframework.com",
  ".botframework.us",
  ".botframework.azure.us",
  ".botframework.azure.cn",
  ".teams.microsoft.com",
  ".teams.microsoft.us",
];

/**
 * Whether an activity's `serviceUrl` points at a Microsoft Bot Connector host.
 *
 * The adapter sends replies, and therefore the bot's access token, to this URL.
 * The SDK only compares it with the token's `serviceurl` claim, and skips that
 * check when the claim is absent, so the host is pinned here as well.
 */
export function isTrustedServiceUrl(
  serviceUrl: unknown,
  extraHosts: readonly string[] = [],
): boolean {
  if (typeof serviceUrl !== "string") return false;
  let url: URL;
  try {
    url = new URL(serviceUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  return [...TRUSTED_SERVICE_URL_HOSTS, ...extraHosts].some((entry) => {
    const e = entry.toLowerCase();
    return e.startsWith(".") ? host.endsWith(e) : host === e;
  });
}

export interface TeamsServer {
  start(): Promise<Server>;
  stop(): Promise<void>;
}

/**
 * Stand up the bot's `POST /api/messages` endpoint.
 *
 * The M365 Agents Playground (and Azure Bot Service) deliver activities here as
 * JSON. The SDK's `authorizeJWT` middleware verifies the Bot Framework token
 * first (anonymous only in local Playground mode, with no `clientId`), and when
 * credentials are configured the activity's `serviceUrl` must be a Bot
 * Connector host. Only then does `CloudAdapter.process` build the
 * `TurnContext`, run the middleware pipeline, and write the HTTP response once
 * `onTurnContext` resolves.
 *
 * `express` is imported lazily, inside `start()`, and this function is the only
 * place the package uses it. It is an OPTIONAL peer dependency (OSS-1177), so a
 * static import here would make it a hard install requirement of the package's
 * root entry point for every self-hosted bot — including the ones that bring
 * their own HTTP server and never call this function, as `examples/teams` does.
 * Pinned by `listener-lazy-express.test.ts`.
 */
/**
 * Load `express`, turning a missing optional peer into an actionable message.
 *
 * Node's raw `ERR_MODULE_NOT_FOUND` names the package but not what to do about
 * it, and does not say that serving the endpoint yourself is a supported
 * alternative. Anything other than a missing module is rethrown untouched, so
 * a genuine failure inside express is not disguised as an install problem.
 */
async function loadExpress() {
  try {
    return (await import("express")).default;
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ERR_MODULE_NOT_FOUND") {
      throw new Error(
        "createTeamsServer() requires 'express', an optional peer dependency of " +
          "@copilotkit/channels-teams. Install it (`npm install express`), or " +
          "serve POST /api/messages from your own HTTP server and do not call " +
          "createTeamsServer().",
        { cause: err },
      );
    }
    throw err;
  }
}

export function createTeamsServer(config: TeamsServerConfig): TeamsServer {
  let server: Server | undefined;
  const authConfig = getAuthConfigWithDefaults(config.authConfig);

  return {
    async start() {
      const express = await loadExpress();
      const app = express();
      app.use(express.json());

      // Cast across HTTP-layer types, as for `process` below.
      const requireJwt = authorizeJWT(authConfig) as unknown as Parameters<
        typeof app.post
      >[1];

      app.post("/api/messages", requireJwt, (req, res) => {
        if (
          authConfig.clientId &&
          !isTrustedServiceUrl(
            (req.body as { serviceUrl?: unknown } | undefined)?.serviceUrl,
            config.allowedServiceUrlHosts,
          )
        ) {
          console.error("[bot-teams] rejected activity: untrusted serviceUrl");
          res.status(400).end();
          return;
        }
        config.adapter
          .process(
            // Cast across HTTP-layer types: the M365 SDK types `process` against
            // its own `express` types, which can differ in major (and `Response`
            // generic arity) from the one resolved here. Express's req/res
            // satisfy the SDK's structural Request/Response at runtime
            // regardless.
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
