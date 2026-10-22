import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  afterEach,
} from "vitest";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { generateKeyPairSync, sign as rsaSign, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import {
  CloudAdapter,
  ConnectorClient,
  MsalTokenProvider,
} from "@microsoft/agents-hosting";
import { Activity } from "@microsoft/agents-activity";
import type { IngressSink } from "@copilotkit/channels-core";
import { TeamsAdapter } from "./adapter.js";
import { createTeamsServer } from "./listener.js";
import type { TeamsReplyTarget } from "./types.js";

/**
 * End-to-end coverage of the `POST /api/messages` trust boundary, on real HTTP
 * through the real `TeamsAdapter`, express listener and M365 Agents SDK.
 *
 * - With a `clientId`, a request without a valid Bot Framework / Azure AD JWT
 *   is rejected 401 and never reaches the turn handler.
 * - The bot's app token is only ever sent to an allowed connector host, and
 *   (when the token carries one) to the origin in its `serviceurl` claim. A
 *   valid token does not make a forged `serviceUrl` acceptable.
 * - Only the issuers configured for the app are accepted, and Bot Connector
 *   tokens must carry a `serviceurl` claim.
 * - Credentials supplied only through the SDK's own env vars count too.
 * - Without a `clientId` (local Playground) the endpoint stays anonymous.
 *
 * Local stand-ins, so nothing leaves the machine:
 * - Azure AD signing keys: a local JWKS server, reached through the SDK's
 *   `authorityEndpoint` setting; tokens are signed here with a local RSA key.
 * - MSAL token acquisition: `MsalTokenProvider.getAccessToken` returns a fixed
 *   fake app token, so we can see exactly where the token is sent.
 * - Bot Framework-issued tokens: the SDK's key lookup for
 *   `login.botframework.com` is redirected to the same local JWKS.
 * - A real Teams `serviceUrl` (smba.trafficmanager.net) is redirected to the
 *   local connector at `ConnectorClient.createClientWithToken`.
 */

const SMBA = "https://smba.trafficmanager.net/amer/";
const BOT_FRAMEWORK_KEYS = "https://login.botframework.com/v1/.well-known/keys";

/** The SDK's own `jwks-rsa` instance (resolved from the SDK, not from here). */
interface JwksClientLike {
  options: { jwksUri: string };
  getKeys(): Promise<unknown>;
}
const jwksRsa = createRequire(
  createRequire(import.meta.url).resolve("@microsoft/agents-hosting"),
)("jwks-rsa") as { JwksClient: { prototype: JwksClientLike } };

const APP_ID = "00000000-aaaa-bbbb-cccc-000000000123";
const TENANT = "tenant-1";
const FAKE_TOKEN = "FAKE-BOT-APP-TOKEN";
const KID = "local-test-key";

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

/** An RS256 JWT for the bot, signed with the local key. */
function signToken(claims: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: KID }));
  const payload = b64url(
    JSON.stringify({
      aud: APP_ID,
      iss: `https://sts.windows.net/${TENANT}/`,
      iat: now,
      exp: now + 300,
      ...claims,
    }),
  );
  const signature = rsaSign(
    "sha256",
    Buffer.from(`${header}.${payload}`),
    privateKey,
  );
  return `${header}.${payload}.${b64url(signature)}`;
}

interface Hit {
  url: string;
  authorization: string | undefined;
}

function recorder() {
  const hits: Hit[] = [];
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      hits.push({
        url: req.url ?? "",
        authorization: req.headers.authorization,
      });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ id: "activity-1" }));
    });
  });
  return { hits, server };
}

function listen(server: http.Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

function sinkSpy() {
  const onTurn = vi.fn().mockResolvedValue(undefined);
  const noop = vi.fn().mockResolvedValue(undefined);
  const sink = {
    onTurn,
    onInteraction: noop,
    onWelcome: noop,
    onCommand: noop,
    onThreadStarted: noop,
    onReaction: noop,
    onModalSubmit: noop,
    onModalClose: noop,
  } satisfies IngressSink;
  return { sink, onTurn };
}

function activity(serviceUrl: string) {
  return {
    type: "message",
    id: `m-${randomUUID()}`,
    text: "hi",
    channelId: "msteams",
    serviceUrl,
    conversation: { id: "conv-1" },
    from: { id: "user-1", role: "user", name: "User" },
    recipient: { id: `28:${APP_ID}`, name: "bot" },
  };
}

/** Set one `Connections__<name>__Settings__*` env connection for the SDK. */
function setEnvConnection(name: string, settings: Record<string, string>) {
  for (const [k, v] of Object.entries(settings)) {
    process.env[`Connections__${name}__Settings__${k}`] = v;
  }
}

const settle = () => new Promise((r) => setTimeout(r, 300));

describe("POST /api/messages trust boundary", () => {
  const idp = http.createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        keys: [
          {
            ...publicKey.export({ format: "jwk" }),
            kid: KID,
            use: "sig",
            alg: "RS256",
          },
        ],
      }),
    );
  });
  const attacker = recorder();
  const connector = recorder();
  let attackerUrl = "";
  let connectorUrl = "";
  const savedEnv: Record<string, string | undefined> = {};
  const ENV_CONNECTION = "Connections__serviceConnection__Settings__";
  const envKeys = [
    "TEST_MODE",
    "authorityEndpoint",
    "clientId",
    "clientSecret",
    "tenantId",
    ...["ClientId", "ClientSecret", "TenantId", "AuthorityEndpoint"].map(
      (k) => `${ENV_CONNECTION}${k}`,
    ),
  ];
  let adapter: TeamsAdapter | undefined;
  let getAccessToken: ReturnType<typeof vi.spyOn>;
  let createClient: ReturnType<typeof vi.spyOn>;
  const origGetKeys = jwksRsa.JwksClient.prototype.getKeys;

  beforeAll(async () => {
    for (const k of envKeys) savedEnv[k] = process.env[k];
    const idpUrl = await listen(idp);
    attackerUrl = `${await listen(attacker.server)}/`;
    connectorUrl = `${await listen(connector.server)}/`;
    // Make the SDK re-read env, and point its key lookup at the local JWKS.
    process.env.TEST_MODE = "true";
    process.env.authorityEndpoint = idpUrl;
    delete process.env.clientId;
    delete process.env.clientSecret;
    delete process.env.tenantId;
    getAccessToken = vi
      .spyOn(MsalTokenProvider.prototype, "getAccessToken")
      .mockResolvedValue(FAKE_TOKEN);
    jwksRsa.JwksClient.prototype.getKeys = function (this: JwksClientLike) {
      if (this.options.jwksUri === BOT_FRAMEWORK_KEYS) {
        this.options.jwksUri = `${idpUrl}/botframework/keys`;
      }
      return origGetKeys.call(this);
    };
    const realCreate =
      ConnectorClient.createClientWithToken.bind(ConnectorClient);
    createClient = vi
      .spyOn(ConnectorClient, "createClientWithToken")
      .mockImplementation((serviceUrl, token, headers) =>
        realCreate(
          serviceUrl.startsWith(SMBA) ? connectorUrl : serviceUrl,
          token,
          headers,
        ),
      );
  });

  afterEach(async () => {
    await adapter?.stop();
    adapter = undefined;
    attacker.hits.length = 0;
    connector.hits.length = 0;
    getAccessToken.mockClear();
    createClient.mockClear();
    for (const k of Object.keys(process.env)) {
      if (/^Connections(Map)?__/i.test(k)) delete process.env[k];
    }
  });

  afterAll(async () => {
    getAccessToken.mockRestore();
    createClient.mockRestore();
    jwksRsa.JwksClient.prototype.getKeys = origGetKeys;
    for (const k of envKeys) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    await Promise.all(
      [idp, attacker.server, connector.server].map(
        (s) => new Promise((r) => s.close(r)),
      ),
    );
  });

  type Mode = "credentialed" | "upperTenant" | "multiTenant" | "anonymous";
  const credentials: Record<Mode, object> = {
    credentialed: {
      clientId: APP_ID,
      clientSecret: "local-secret",
      tenantId: TENANT,
    },
    upperTenant: {
      clientId: APP_ID,
      clientSecret: "local-secret",
      tenantId: TENANT.toUpperCase(),
    },
    multiTenant: { clientId: APP_ID, clientSecret: "local-secret" },
    anonymous: {},
  };

  async function start(mode: Mode) {
    const port = await freePort();
    const { sink, onTurn } = sinkSpy();
    adapter = new TeamsAdapter({
      port,
      ...credentials[mode],
      allowedServiceUrls: [connectorUrl],
    });
    await adapter.start(sink);
    const post = (serviceUrl: string, token?: string) =>
      fetch(`http://127.0.0.1:${port}/api/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(activity(serviceUrl)),
      });
    return { post, onTurn };
  }

  it("rejects an unauthenticated request with 401 when credentialed", async () => {
    const { post, onTurn } = await start("credentialed");
    const res = await post(attackerUrl);
    await settle();
    expect(res.status).toBe(401);
    expect(onTurn).not.toHaveBeenCalled();
    expect(attacker.hits).toEqual([]);
  });

  it("rejects a token that is not a valid signed JWT with 401", async () => {
    const { post, onTurn } = await start("credentialed");
    const forged = signToken().replace(/\.[^.]+$/, ".AAAA");
    const res = await post(attackerUrl, forged);
    await settle();
    expect(res.status).toBe(401);
    expect(onTurn).not.toHaveBeenCalled();
    expect(attacker.hits).toEqual([]);
  });

  it("refuses a forged serviceUrl even with a valid token, and never sends the app token there", async () => {
    const { post, onTurn } = await start("credentialed");
    const res = await post(
      attackerUrl,
      signToken({ serviceurl: "https://smba.trafficmanager.net/amer/" }),
    );
    await settle();
    expect(res.status).toBe(403);
    expect(onTurn).not.toHaveBeenCalled();
    expect(attacker.hits).toEqual([]);
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it("refuses a non-allowlisted serviceUrl when the token has no serviceurl claim", async () => {
    const { post, onTurn } = await start("credentialed");
    const res = await post(attackerUrl, signToken());
    await settle();
    expect(res.status).toBe(403);
    expect(onTurn).not.toHaveBeenCalled();
    expect(attacker.hits).toEqual([]);
  });

  it("refuses an allowed serviceUrl that differs from the token's serviceurl claim", async () => {
    const { post, onTurn } = await start("credentialed");
    const res = await post(
      connectorUrl,
      signToken({ serviceurl: "https://smba.trafficmanager.net/amer/" }),
    );
    await settle();
    expect(res.status).toBe(403);
    expect(onTurn).not.toHaveBeenCalled();
    expect(connector.hits).toEqual([]);
  });

  it("runs a valid request end to end and replies to its own connector", async () => {
    const { post, onTurn } = await start("credentialed");
    const res = await post(
      connectorUrl,
      signToken({ serviceurl: connectorUrl }),
    );
    await settle();
    expect(res.status).toBe(200);
    expect(onTurn).toHaveBeenCalledTimes(1);
    expect(connector.hits.length).toBeGreaterThan(0);
    expect(connector.hits[0]!.authorization).toBe(`Bearer ${FAKE_TOKEN}`);
    expect(attacker.hits).toEqual([]);
  });

  it("keeps the anonymous Playground mode working without a clientId", async () => {
    const { post, onTurn } = await start("anonymous");
    const res = await post(connectorUrl);
    await settle();
    expect(res.status).toBe(200);
    expect(onTurn).toHaveBeenCalledTimes(1);
    expect(connector.hits[0]?.authorization).toBeUndefined();
  });

  it("refuses an out-of-turn send to a non-allowlisted serviceUrl", async () => {
    await start("credentialed");
    const target: TeamsReplyTarget = {
      conversationKey: "conv-1",
      // A complete reference, as captured from an inbound activity, so the
      // SDK would otherwise go on to send.
      reference: Activity.fromObject(
        activity(attackerUrl),
      ).getConversationReference(),
    };
    const result = await adapter!.postFile(target, {
      bytes: new Uint8Array([1, 2, 3]),
      filename: "x.png",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not an allowed connector host/);
    expect(attacker.hits).toEqual([]);
    expect(getAccessToken).not.toHaveBeenCalled();
  });
  it.each([
    ["a foreign tenant", "https://sts.windows.net/attacker-tenant/"],
    ["an arbitrary issuer", "https://evil.example/"],
    ["no issuer at all", undefined],
  ])("rejects a validly signed token from %s with 401", async (_label, iss) => {
    const { post, onTurn } = await start("credentialed");
    const res = await post(
      connectorUrl,
      signToken({ iss, serviceurl: connectorUrl }),
    );
    await settle();
    expect(res.status).toBe(401);
    expect(onTurn).not.toHaveBeenCalled();
    expect(connector.hits).toEqual([]);
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it("rejects a Bot Connector token without a serviceurl claim with 401", async () => {
    const { post, onTurn } = await start("credentialed");
    const res = await post(
      connectorUrl,
      signToken({ iss: "https://api.botframework.com" }),
    );
    await settle();
    expect(res.status).toBe(401);
    expect(onTurn).not.toHaveBeenCalled();
    expect(connector.hits).toEqual([]);
  });

  it("accepts Teams-shaped traffic: a Bot Connector token for smba.trafficmanager.net", async () => {
    const { post, onTurn } = await start("credentialed");
    const res = await post(
      SMBA,
      signToken({ iss: "https://api.botframework.com", serviceurl: SMBA }),
    );
    await settle();
    expect(res.status).toBe(200);
    expect(onTurn).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledWith(SMBA, FAKE_TOKEN, undefined);
    expect(connector.hits[0]?.authorization).toBe(`Bearer ${FAKE_TOKEN}`);
  });

  it("accepts the botframework.com tenant issuer when no tenantId is configured", async () => {
    const { post, onTurn } = await start("multiTenant");
    const res = await post(
      connectorUrl,
      signToken({
        iss: "https://sts.windows.net/d6d49420-f39b-4df7-a1dc-d59a935871db/",
      }),
    );
    await settle();
    expect(res.status).toBe(200);
    expect(onTurn).toHaveBeenCalledTimes(1);
  });

  it("requires a token when credentials come only from the SDK's env vars", async () => {
    process.env[`${ENV_CONNECTION}ClientId`] = APP_ID;
    process.env[`${ENV_CONNECTION}ClientSecret`] = "local-secret";
    process.env[`${ENV_CONNECTION}TenantId`] = TENANT;
    process.env[`${ENV_CONNECTION}AuthorityEndpoint`] =
      process.env.authorityEndpoint;
    const { post, onTurn } = await start("anonymous");

    const unauth = await post(connectorUrl);
    await settle();
    expect(unauth.status).toBe(401);
    expect(onTurn).not.toHaveBeenCalled();

    const ok = await post(
      connectorUrl,
      signToken({ serviceurl: connectorUrl }),
    );
    await settle();
    expect(ok.status).toBe(200);
    expect(onTurn).toHaveBeenCalledTimes(1);
    // ...and it replies as that app, with its token.
    expect(connector.hits[0]?.authorization).toBe(`Bearer ${FAKE_TOKEN}`);
  });

  it("protects createTeamsServer called directly with a credentialed CloudAdapter", async () => {
    const port = await freePort();
    const onTurnContext = vi.fn().mockResolvedValue(undefined);
    const server = createTeamsServer({
      adapter: new CloudAdapter({
        clientId: APP_ID,
        clientSecret: "local-secret",
        tenantId: TENANT,
      }),
      port,
      onTurnContext,
    });
    await server.start();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(activity(connectorUrl)),
      });
      expect(res.status).toBe(401);
      expect(onTurnContext).not.toHaveBeenCalled();
    } finally {
      await server.stop();
    }
  });
  const OTHER_APP = "11111111-2222-3333-4444-555555555555";

  it("fails to start when Connections__ env settings drop the configured clientId", async () => {
    setEnvConnection("serviceConnection", { TenantId: TENANT });
    await expect(start("credentialed")).rejects.toThrow(
      /clientId .* is configured .* resolved no app id .*Connections__/s,
    );
  });

  it("fails to start when Connections__ env settings resolve a different app id", async () => {
    setEnvConnection("serviceConnection", {
      ClientId: OTHER_APP,
      ClientSecret: "s",
      TenantId: TENANT,
    });
    await expect(start("credentialed")).rejects.toThrow(
      new RegExp(`resolved app id "${OTHER_APP}"`),
    );
  });

  it("fails closed in createTeamsServer when the explicit clientId is dropped", async () => {
    setEnvConnection("serviceConnection", { TenantId: TENANT });
    const server = createTeamsServer({
      adapter: { process: vi.fn() } as unknown as CloudAdapter,
      authConfig: { clientId: APP_ID, clientSecret: "s", tenantId: TENANT },
      port: await freePort(),
      onTurnContext: vi.fn(),
    });
    await expect(server.start()).rejects.toThrow(/Connections__/);
  });

  it("accepts only the bot's own app id as the token audience", async () => {
    const authority = process.env.authorityEndpoint ?? "";
    setEnvConnection("serviceConnection", {
      ClientId: APP_ID,
      ClientSecret: "s",
      TenantId: TENANT,
      AuthorityEndpoint: authority,
    });
    setEnvConnection("graph", {
      ClientId: OTHER_APP,
      ClientSecret: "s",
      TenantId: TENANT,
      AuthorityEndpoint: authority,
    });
    process.env.ConnectionsMap__0__ServiceUrl = "*";
    process.env.ConnectionsMap__0__Connection = "serviceConnection";
    const { post, onTurn } = await start("anonymous");
    const res = await post(
      connectorUrl,
      signToken({ aud: OTHER_APP, serviceurl: connectorUrl }),
    );
    await settle();
    expect(res.status).toBe(401);
    expect(onTurn).not.toHaveBeenCalled();

    const ok = await post(
      connectorUrl,
      signToken({ serviceurl: connectorUrl }),
    );
    await settle();
    expect(ok.status).toBe(200);
  });

  it("matches issuers case-insensitively (uppercase tenantId, lowercase token)", async () => {
    const { post, onTurn } = await start("upperTenant");
    const res = await post(
      connectorUrl,
      signToken({ serviceurl: connectorUrl }),
    );
    await settle();
    expect(res.status).toBe(200);
    expect(onTurn).toHaveBeenCalledTimes(1);
  });
});
