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
import {
  isAllowedServiceUrl,
  resolveAllowedServiceUrls,
  sameOrigin,
} from "./service-url.js";

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
   * Auth settings used to verify inbound requests. When it has a `clientId`,
   * every `POST /api/messages` must carry a valid Bot Framework / Azure AD JWT
   * for that app, or it is rejected with 401 before it reaches the adapter.
   * Without a `clientId` the endpoint runs in anonymous mode (local M365
   * Agents Playground only).
   *
   * Defaults to the auth configuration the `adapter` was constructed with.
   */
  authConfig?: AuthConfiguration;
  /**
   * Connector origins accepted as an inbound activity's `serviceUrl` in
   * addition to the built-in Microsoft hosts (see `TeamsAdapterOptions`).
   * Only enforced when `authConfig` has a `clientId`.
   */
  allowedServiceUrls?: readonly string[];
}

export interface TeamsServer {
  start(): Promise<Server>;
  stop(): Promise<void>;
}

/**
 * Stand up the bot's `POST /api/messages` endpoint.
 *
 * The M365 Agents Playground (and Azure Bot Service) deliver activities here as
 * JSON. `CloudAdapter.process` does NOT authenticate the request: it trusts
 * `req.user` and treats a request without one as anonymous. So when a
 * `clientId` is configured this route first runs the SDK's `authorizeJWT`
 * (401 unless the request carries a valid Bot Framework / Azure AD token for
 * the app), then checks the activity's `serviceUrl`: it must be an allowed
 * Microsoft connector host and, when the token has a `serviceurl` claim, the
 * same origin as that claim (403 otherwise). The bot later sends its app token
 * to that `serviceUrl`, so an unchecked one would leak the token.
 *
 * Without a `clientId` the route is anonymous, for the local M365 Agents
 * Playground only: any caller can drive a turn, and no app token exists to
 * leak. Do not expose an anonymous bot to a network.
 *
 * `CloudAdapter.process` then builds the `TurnContext`, runs the middleware
 * pipeline, and writes the HTTP response once `onTurnContext` resolves.
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

/**
 * The auth configuration to verify inbound requests with: the explicit one, or
 * the one the adapter was built with (`CloudAdapter.authConfig`, protected in
 * the SDK's types, so read structurally). Resolved through the SDK so the
 * `connections` map `authorizeJWT` matches the token audience against exists.
 */
function inboundAuthConfig(
  config: TeamsServerConfig,
): AuthConfiguration | undefined {
  const raw =
    config.authConfig ??
    (config.adapter as unknown as { authConfig?: AuthConfiguration })
      .authConfig;
  if (!raw?.clientId) return undefined;
  return raw.connections?.size ? raw : getAuthConfigWithDefaults(raw);
}

export function createTeamsServer(config: TeamsServerConfig): TeamsServer {
  let server: Server | undefined;

  return {
    async start() {
      const express = await loadExpress();
      const app = express();

      // Express runs same-path handlers in registration order, so the gates
      // below run before the `adapter.process` handler at the end.
      const authConfig = inboundAuthConfig(config);
      if (authConfig) {
        const verifyJwt = authorizeJWT(authConfig);
        const allowed = resolveAllowedServiceUrls(config.allowedServiceUrls);
        // 1. Authenticate. `authorizeJWT` answers 401 itself on a missing or
        //    invalid token and only calls `next` once `req.user` is set.
        app.post("/api/messages", (req, res, next) => {
          verifyJwt(
            // Same cross-`express`-types cast as `adapter.process` below.
            req as unknown as AgentsRequest,
            res as unknown as Parameters<typeof verifyJwt>[1],
            next,
          ).catch((err: unknown) => {
            console.error("[bot-teams] token validation failed:", err);
            if (!res.headersSent) res.status(401).end();
          });
        });
        // 2. Parse the body only for authenticated callers. 3. Only reply to a
        //    connector we trust, and to the one the token was issued for. This
        //    runs before any app token is minted or sent.
        app.post("/api/messages", express.json(), (req, res, next) => {
          const serviceUrl: unknown = (
            req.body as { serviceUrl?: unknown } | undefined
          )?.serviceUrl;
          const claim: unknown = (req as unknown as AgentsRequest).user
            ?.serviceurl;
          if (!isAllowedServiceUrl(serviceUrl, allowed)) {
            console.warn(
              "[bot-teams] rejected activity: serviceUrl is not an allowed connector host",
            );
            res.status(403).send({ error: "serviceUrl not allowed" });
            return;
          }
          if (
            typeof claim === "string" &&
            !sameOrigin(claim, serviceUrl as string)
          ) {
            console.warn(
              "[bot-teams] rejected activity: serviceUrl does not match the token's serviceurl claim",
            );
            res.status(403).send({ error: "serviceUrl does not match token" });
            return;
          }
          next();
        });
      } else {
        console.warn(
          "[bot-teams] no clientId configured: POST /api/messages accepts " +
            "unauthenticated requests (local M365 Agents Playground mode). " +
            "Do not expose this endpoint to a network.",
        );
        app.post("/api/messages", express.json());
      }

      app.post("/api/messages", (req, res) => {
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
