import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  GitHubAppTokenProvider,
  StaticTokenProvider,
  createAppJwt,
  createTokenProvider,
} from "./app-auth.js";
import { GitHubApiError } from "./client.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

/** 2023-11-14T22:13:20Z, a whole number of seconds. */
const NOW = 1_700_000_000_000;
const MINUTE = 60_000;

interface RecordedRequest {
  method: string;
  url: string;
  authorization: string | null;
}

function decodeJwt(jwt: string) {
  const [header, payload, signature] = jwt.split(".");
  if (
    header === undefined ||
    payload === undefined ||
    signature === undefined
  ) {
    throw new Error(`not a JWT: ${jwt}`);
  }
  const parse = (part: string): unknown =>
    JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  return {
    header: parse(header),
    payload: parse(payload),
    signatureValid: verify(
      "RSA-SHA256",
      Buffer.from(`${header}.${payload}`),
      publicKey,
      Buffer.from(signature, "base64url"),
    ),
  };
}

function bearer(request: RecordedRequest) {
  return request.authorization?.replace(/^Bearer /, "") ?? "";
}

/** Fake GitHub token endpoint. Each mint returns `tok-<n>`, valid for one hour from the fake clock. */
function createTokenEndpoint(options: { status?: number } = {}) {
  const requests: RecordedRequest[] = [];
  const clock = { now: NOW };
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({
      method: init?.method ?? "GET",
      url: String(input),
      authorization: new Headers(init?.headers).get("authorization"),
    });
    if (options.status !== undefined) {
      return Response.json(
        { message: "Bad credentials" },
        { status: options.status },
      );
    }
    return Response.json(
      {
        token: `tok-${requests.length}`,
        expires_at: new Date(clock.now + 60 * MINUTE).toISOString(),
      },
      { status: 201 },
    );
  };
  const provider = new GitHubAppTokenProvider({
    appId: 123,
    privateKey,
    apiBaseUrl: "https://ghe.test/api/v3",
    fetch: fetchImpl,
    now: () => clock.now,
  });
  return { provider, requests, clock };
}

describe("createAppJwt", () => {
  it("signs an RS256 JWT with iat = now - 60s, exp = now + 9min, iss = appId", () => {
    const jwt = decodeJwt(createAppJwt(123, privateKey, NOW));

    expect(jwt.signatureValid).toBe(true);
    expect(jwt.header).toEqual({ alg: "RS256", typ: "JWT" });
    expect(jwt.payload).toEqual({
      iat: 1_699_999_940,
      exp: 1_700_000_540,
      iss: 123,
    });
  });
});

describe("GitHubAppTokenProvider", () => {
  it("mints an installation token with an App JWT", async () => {
    const { provider, requests } = createTokenEndpoint();

    const token = await provider.getToken(42);

    expect(token).toBe("tok-1");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toBe(
      "https://ghe.test/api/v3/app/installations/42/access_tokens",
    );
    const jwt = decodeJwt(bearer(requests[0]!));
    expect(jwt.signatureValid).toBe(true);
    expect(jwt.payload).toMatchObject({ iss: 123 });
  });

  it("reuses the cached token for the same installation", async () => {
    const { provider, requests } = createTokenEndpoint();

    await provider.getToken(42);
    const second = await provider.getToken(42);

    expect(second).toBe("tok-1");
    expect(requests).toHaveLength(1);
  });

  it("caches tokens per installation", async () => {
    const { provider, requests } = createTokenEndpoint();

    expect(await provider.getToken(1)).toBe("tok-1");
    expect(await provider.getToken(2)).toBe("tok-2");
    expect(await provider.getToken(1)).toBe("tok-1");
    expect(requests.map((r) => r.url)).toEqual([
      "https://ghe.test/api/v3/app/installations/1/access_tokens",
      "https://ghe.test/api/v3/app/installations/2/access_tokens",
    ]);
  });

  it("keeps the token until 5 minutes before expiry, then refreshes", async () => {
    const { provider, requests, clock } = createTokenEndpoint();
    await provider.getToken(42);

    clock.now = NOW + 54 * MINUTE;
    expect(await provider.getToken(42)).toBe("tok-1");

    clock.now = NOW + 56 * MINUTE;
    expect(await provider.getToken(42)).toBe("tok-2");
    expect(requests).toHaveLength(2);
  });

  it("shares one refresh between concurrent callers", async () => {
    const { provider, requests } = createTokenEndpoint();

    const tokens = await Promise.all([
      provider.getToken(42),
      provider.getToken(42),
      provider.getToken(42),
    ]);

    expect(tokens).toEqual(["tok-1", "tok-1", "tok-1"]);
    expect(requests).toHaveLength(1);
  });

  it("throws GitHubApiError when the mint fails, and retries on the next call", async () => {
    const { provider, requests } = createTokenEndpoint({ status: 401 });

    const first = provider.getToken(42);
    await expect(first).rejects.toBeInstanceOf(GitHubApiError);
    await expect(first).rejects.toMatchObject({
      status: 401,
      method: "POST",
      path: "/api/v3/app/installations/42/access_tokens",
    });
    await expect(provider.getToken(42)).rejects.toThrow(/Bad credentials/);
    expect(requests).toHaveLength(2);
  });

  it("throws when no installation id is given", async () => {
    const { provider, requests } = createTokenEndpoint();

    await expect(provider.getToken()).rejects.toThrow(/installation id/);
    expect(requests).toHaveLength(0);
  });
});

describe("token mode", () => {
  it("StaticTokenProvider returns the configured token", async () => {
    expect(await new StaticTokenProvider("ghp_abc").getToken()).toBe("ghp_abc");
  });

  it("createTokenProvider picks token mode for a token and App mode for appId + privateKey", async () => {
    const base = { webhookSecret: "s", botUsername: "bot" };

    const tokenProvider = createTokenProvider({ ...base, token: "ghp_abc" });
    const appProvider = createTokenProvider({
      ...base,
      appId: 123,
      privateKey,
    });

    expect(tokenProvider.kind).toBe("token");
    expect(await tokenProvider.getToken()).toBe("ghp_abc");
    expect(appProvider.kind).toBe("app");
  });
});
