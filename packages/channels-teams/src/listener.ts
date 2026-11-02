import type { Server } from "node:http";
import { authorizeJWT } from "@microsoft/agents-hosting";
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
import {
  assertNotLegacyOnlyCredentials,
  resolveTeamsAuth,
} from "./auth-config.js";
import { createEndorsementCheck } from "./endorsements.js";

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
   * Defaults to the auth configuration the `adapter` was constructed with. An
   * override must resolve to the adapter's own app id: one that drops it (for
   * example `{}`) or names another app makes `start()` fail.
   */
  authConfig?: AuthConfiguration;
  /**
   * Connector origins accepted as an inbound activity's `serviceUrl` in
   * addition to the built-in Microsoft hosts (see `TeamsAdapterOptions`).
   * Only enforced when `authConfig` has a `clientId`.
   */
  allowedServiceUrls?: readonly string[];
  /**
   * Interface to listen on. Without credentials the endpoint is
   * unauthenticated, so it defaults to `127.0.0.1` (local Playground only);
   * setting a non-loopback host such as `0.0.0.0` then exposes an
   * unauthenticated bot to the network and is an explicit opt-in. With
   * credentials it defaults to all interfaces, as before.
   */
  host?: string;
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
 * (401 unless the request carries a validly signed, unexpired token for the
 * app), then requires an issuer configured for the app and, on a Bot
 * Connector token, a `serviceurl` claim (401), then checks the activity's
 * `serviceUrl`: it must be an allowed
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

/** The app id a `CloudAdapter` acts as (`authConfig` is protected in its types). */
function adapterAuthConfig(
  adapter: CloudAdapter,
): AuthConfiguration | undefined {
  return (adapter as unknown as { authConfig?: AuthConfiguration }).authConfig;
}

/**
 * The auth configuration to verify inbound requests with, or `undefined` for
 * anonymous mode. The adapter's own identity is read independently and an
 * explicit `authConfig` can never remove or change it: an override that
 * resolves to no app id or another app id fails startup (an empty override is
 * not silently replaced by the adapter's settings, because it most likely
 * means the caller's credentials did not load). Resolved through the SDK so
 * the `connections` map `authorizeJWT` matches the token audience against
 * exists.
 */
function inboundAuthConfig(
  config: TeamsServerConfig,
): AuthConfiguration | undefined {
  const fromAdapter = adapterAuthConfig(config.adapter);
  const adapterAppId = fromAdapter?.clientId || undefined;
  if (config.authConfig === undefined) {
    if (!fromAdapter) {
      assertNotLegacyOnlyCredentials(undefined);
      return undefined;
    }
    const resolved = resolveTeamsAuth(fromAdapter);
    return resolved.clientId ? resolved : undefined;
  }
  let resolved: AuthConfiguration;
  try {
    resolved = resolveTeamsAuth(config.authConfig);
  } catch (err) {
    if (adapterAppId) throw overrideConflict(adapterAppId, undefined, err);
    throw err;
  }
  if (adapterAppId && resolved.clientId !== adapterAppId) {
    throw overrideConflict(adapterAppId, resolved.clientId);
  }
  return resolved.clientId ? resolved : undefined;
}

function overrideConflict(
  adapterAppId: string,
  overrideAppId: string | undefined,
  cause?: unknown,
): Error {
  return new Error(
    "[bot-teams] createTeamsServer: the authConfig override resolves " +
      (overrideAppId ? `app id "${overrideAppId}"` : "no app id") +
      `, but the adapter acts as app "${adapterAppId}". An override cannot ` +
      "remove or change the adapter's app id: omit authConfig to use the " +
      "adapter's own settings, or pass settings for the same app.",
    cause === undefined ? undefined : { cause },
  );
}

/** Loopback interface names, which keep an anonymous endpoint local. */
function isLoopbackHost(host: string): boolean {
  return (
    host === "localhost" ||
    host === "::1" ||
    host === "[::1]" ||
    /^127\.\d+\.\d+\.\d+$/.test(host)
  );
}

/** The botframework.com tenant, as it appears in Microsoft-issued tokens. */
const BOT_FRAMEWORK_TENANT_IDS = [
  "d6d49420-f39b-4df7-a1dc-d59a935871db",
  "f8cdef31-a31e-4b4a-93e4-5f571e91255a",
];

/**
 * Token issuers accepted for the bot's own app id (lowercased; issuer hosts
 * and tenant ids are case-insensitive): the `issuers` the SDK resolved for
 * that connection (Bot Framework, plus the configured
 * tenant's Azure AD v1 and v2 issuers; overridable through the SDK's
 * `Connections__<id>__Settings__Issuers`). `authorizeJWT` checks the
 * signature, audience and expiry but not the issuer, and Azure AD signing keys
 * are shared by every tenant, so without this any tenant could mint an
 * accepted token for a multi-tenant app.
 *
 * Without a `tenantId` the SDK names the tenant `botframework.com`, but real
 * tokens carry that tenant's id, so both ids are accepted in its place.
 */
function acceptedIssuers(authConfig: AuthConfiguration): Set<string> {
  const connection = [...(authConfig.connections?.values() ?? [])].find(
    (c) => c.clientId === authConfig.clientId,
  );
  const accepted = new Set<string>();
  for (const configured of connection?.issuers ?? authConfig.issuers ?? []) {
    const iss = configured.toLowerCase();
    accepted.add(iss);
    if (iss.includes("/botframework.com/")) {
      for (const id of BOT_FRAMEWORK_TENANT_IDS) {
        accepted.add(iss.replace("/botframework.com/", `/${id}/`));
      }
    }
  }
  return accepted;
}

/**
 * A Bot Connector token (issued by Bot Framework rather than Azure AD). The
 * Bot Connector auth spec requires these to carry a `serviceurl` claim that
 * matches the activity's `serviceUrl`.
 */
function isBotConnectorIssuer(iss: string): boolean {
  return iss.toLowerCase().startsWith("https://api.botframework.");
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
        const appId = authConfig.clientId;
        const issuers = acceptedIssuers(authConfig);
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
        // 2. Accept only tokens for the bot's own app id (`authorizeJWT` also
        //    accepts any other configured connection's app id), from the
        //    issuers configured for it, and require the `serviceurl` claim on
        //    Bot Connector tokens.
        app.post("/api/messages", (req, res, next) => {
          const user = (req as unknown as AgentsRequest).user;
          if (user?.aud !== appId) {
            console.warn(
              "[bot-teams] rejected token: audience is not this bot",
            );
            res.status(401).send({ error: "token audience not accepted" });
            return;
          }
          const iss: unknown = user?.iss;
          if (typeof iss !== "string" || !issuers.has(iss.toLowerCase())) {
            console.warn("[bot-teams] rejected token: issuer not accepted");
            res.status(401).send({ error: "token issuer not accepted" });
            return;
          }
          if (
            isBotConnectorIssuer(iss) &&
            typeof user?.serviceurl !== "string"
          ) {
            console.warn("[bot-teams] rejected token: no serviceurl claim");
            res.status(401).send({ error: "token has no serviceurl claim" });
            return;
          }
          next();
        });
        // 3. Parse the body only for authenticated callers, and check that a
        //    Bot Connector signing key is endorsed for the claimed channel.
        const checkEndorsement = createEndorsementCheck();
        app.post("/api/messages", express.json(), (req, res, next) => {
          const iss = String((req as unknown as AgentsRequest).user?.iss);
          const channelId: unknown = (
            req.body as { channelId?: unknown } | undefined
          )?.channelId;
          checkEndorsement(iss, req.headers.authorization, channelId).then(
            (result) => {
              if (result.ok) {
                next();
                return;
              }
              console.warn(`[bot-teams] rejected activity: ${result.reason}`);
              res.status(result.status).send({ error: result.reason });
            },
            (err: unknown) => {
              console.error("[bot-teams] could not check endorsements:", err);
              if (!res.headersSent) res.status(503).end();
            },
          );
        });
        // 4. Only reply to a connector we trust, and to the one the token was
        //    issued for. This runs before any app token is minted or sent.
        app.post("/api/messages", (req, res, next) => {
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
        if (config.host && !isLoopbackHost(config.host)) {
          console.warn(
            `[bot-teams] no clientId configured and host "${config.host}" ` +
              "is not loopback: POST /api/messages accepts UNAUTHENTICATED " +
              "requests from the network. Anyone who can reach it can drive " +
              "the bot.",
          );
        } else {
          console.warn(
            "[bot-teams] no clientId configured: POST /api/messages accepts " +
              "unauthenticated requests (local M365 Agents Playground mode), " +
              `listening on ${config.host ?? "127.0.0.1"} only.`,
          );
        }
        app.post("/api/messages", express.json());
      }
      // Anonymous mode stays on loopback unless a host is chosen explicitly.
      const host = config.host ?? (authConfig ? undefined : "127.0.0.1");

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

      return new Promise<Server>((resolve, reject) => {
        // Express 5 passes a listen error (e.g. EADDRINUSE) to this callback;
        // Express 4 only emits it. Either way, don't report a server that
        // isn't listening as started.
        const ready = (err?: Error) => {
          if (err) reject(err);
          else resolve(server as Server);
        };
        server =
          host === undefined
            ? app.listen(config.port, ready)
            : app.listen(config.port, host, ready);
        server.once("error", reject);
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
