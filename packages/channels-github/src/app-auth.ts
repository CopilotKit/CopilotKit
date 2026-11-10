import { createSign } from "node:crypto";
import {
  DEFAULT_GITHUB_API_BASE_URL,
  githubHeaders,
  toGitHubApiError,
} from "./client.js";
import type { GitHubAdapterOptions } from "./types.js";

/** GitHub rejects App JWTs that live longer than 10 minutes. */
const JWT_LIFETIME_SECONDS = 9 * 60;
/** Back-date `iat` to absorb clock drift between this host and GitHub. */
const JWT_CLOCK_DRIFT_SECONDS = 60;
/** Mint a new installation token when the cached one expires within this window. */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

function base64UrlJson(value: object) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/**
 * Create a GitHub App JWT, signed with RS256.
 *
 * @param appId - GitHub App id (or client id). Sent as the `iss` claim.
 * @param privateKeyPem - The App's private key, PEM encoded.
 * @param now - Current time in milliseconds since the epoch.
 *
 * `iat` is `now - 60s` and `exp` is `now + 9min`, inside GitHub's 10-minute limit.
 */
export function createAppJwt(
  appId: string | number,
  privateKeyPem: string,
  now: number,
) {
  const nowSeconds = Math.floor(now / 1000);
  const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
  const payload = base64UrlJson({
    iat: nowSeconds - JWT_CLOCK_DRIFT_SECONDS,
    exp: nowSeconds + JWT_LIFETIME_SECONDS,
    iss: appId,
  });
  const signingInput = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256")
    .update(signingInput)
    .sign(privateKeyPem, "base64url");
  return `${signingInput}.${signature}`;
}

/** Options for {@link GitHubAppTokenProvider}. */
export interface GitHubAppTokenProviderOptions {
  /** GitHub App id (or client id). */
  appId: string | number;
  /** GitHub App private key, PEM encoded. */
  privateKey: string;
  /** GitHub REST API base URL (default `"https://api.github.com"`). */
  apiBaseUrl?: string;
  /** `fetch` implementation (default `globalThis.fetch`). */
  fetch?: typeof fetch;
  /** Clock in milliseconds since the epoch (default `Date.now`). */
  now?: () => number;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

interface InstallationTokenResponse {
  token: string;
  expires_at: string;
}

/**
 * GitHub App auth. Signs an App JWT and mints installation access tokens.
 *
 * Tokens are cached per installation. A token is refreshed when it expires
 * within 5 minutes. Concurrent requests for the same installation share one
 * refresh.
 */
export class GitHubAppTokenProvider {
  readonly kind = "app";
  private readonly appId: string | number;
  private readonly privateKey: string;
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly cache = new Map<number, CachedToken>();
  private readonly inflight = new Map<number, Promise<string>>();

  constructor(options: GitHubAppTokenProviderOptions) {
    this.appId = options.appId;
    this.privateKey = options.privateKey;
    this.apiBaseUrl = options.apiBaseUrl ?? DEFAULT_GITHUB_API_BASE_URL;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
  }

  /** A fresh App JWT. Use it for `/app` endpoints, which do not take installation tokens. */
  createJwt() {
    return createAppJwt(this.appId, this.privateKey, this.now());
  }

  /**
   * An installation access token for `installationId`.
   *
   * Throws when `installationId` is missing (the webhook delivery had no
   * installation), or a `GitHubApiError` when GitHub rejects the request.
   */
  async getToken(installationId?: number) {
    if (installationId === undefined) {
      throw new Error(
        "GitHub App auth needs an installation id, but the event has none",
      );
    }
    const cached = this.cache.get(installationId);
    const isFresh =
      cached !== undefined &&
      cached.expiresAt - this.now() > TOKEN_REFRESH_MARGIN_MS;
    if (isFresh) return cached.token;

    const pending = this.inflight.get(installationId);
    if (pending !== undefined) return pending;

    const refresh = this.mintToken(installationId).finally(() => {
      this.inflight.delete(installationId);
    });
    this.inflight.set(installationId, refresh);
    return refresh;
  }

  private async mintToken(installationId: number) {
    const url = `${this.apiBaseUrl}/app/installations/${installationId}/access_tokens`;
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: githubHeaders(this.createJwt()),
    });
    if (!res.ok) throw await toGitHubApiError(res, "POST", url, this.now);
    const json = (await res.json()) as InstallationTokenResponse;
    this.cache.set(installationId, {
      token: json.token,
      expiresAt: Date.parse(json.expires_at),
    });
    return json.token;
  }
}

/** Token (PAT) auth: the same token is used for every call. */
export class StaticTokenProvider {
  readonly kind = "token";
  private readonly token: string;

  constructor(token: string) {
    this.token = token;
  }

  /** The static token. Installation ids are ignored in token mode. */
  async getToken() {
    return this.token;
  }
}

/** Auth for {@link GitHubApiClient}: GitHub App or a static token. */
export type GitHubTokenProvider = GitHubAppTokenProvider | StaticTokenProvider;

/**
 * Pick the auth mode from adapter options: a `token` means token (PAT) mode,
 * otherwise GitHub App mode with `appId` + `privateKey`.
 */
export function createTokenProvider(options: GitHubAdapterOptions) {
  if (options.token !== undefined) {
    return new StaticTokenProvider(options.token);
  }
  return new GitHubAppTokenProvider({
    appId: options.appId,
    privateKey: options.privateKey,
    apiBaseUrl: options.apiBaseUrl,
    fetch: options.fetch,
  });
}
