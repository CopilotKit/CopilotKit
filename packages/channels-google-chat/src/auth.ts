import { GoogleAuth, OAuth2Client } from "google-auth-library";
import type { Certificates } from "google-auth-library";
import type { GoogleChatAdapterOptions } from "./types.js";

const CHAT_BOT_SCOPE = "https://www.googleapis.com/auth/chat.bot";
const CHAT_ISSUER = "chat@system.gserviceaccount.com";
/** x509 cert endpoint for the account that signs inbound Chat webhook JWTs. */
const CHAT_CERT_URL =
  "https://www.googleapis.com/service_accounts/v1/metadata/x509/chat@system.gserviceaccount.com";
/**
 * Minimum interval between cert refetches triggered by a verification failure.
 * Google rotates the Chat signing keys ~daily, so a 5-minute window still
 * self-heals a genuine rotation promptly while capping the refetch rate to at
 * most one per window — so a flood of forged/garbage tokens from unauthenticated
 * callers can't amplify into unbounded outbound HTTPS fetches and cache thrash.
 */
const CERT_REFETCH_MIN_INTERVAL_MS = 5 * 60_000;

export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/**
 * Thrown when fetching/parsing the Chat x509 certs fails (network error or
 * non-2xx from CHAT_CERT_URL). This is an infrastructure failure on OUR side,
 * NOT a bad inbound token, so it must NOT be reported as Unauthorized: the
 * request handler maps UnauthorizedError to 401 and everything else to 500, and
 * a transient cert-endpoint outage should surface as 500 so Google Chat retries
 * rather than treating the app's auth as permanently broken.
 */
export class CertFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CertFetchError";
  }
}

export interface TokenProvider {
  getToken(): Promise<string>;
}

function resolveCredentials(
  opts: GoogleChatAdapterOptions,
): object | undefined {
  const c = opts.credentials ?? process.env.GOOGLE_CHAT_CREDENTIALS;
  if (!c) return undefined; // GoogleAuth falls back to ADC / GOOGLE_APPLICATION_CREDENTIALS
  if (typeof c === "string") {
    const trimmed = c.trim();
    if (!trimmed.startsWith("{")) return undefined; // a path → let GoogleAuth read keyFile
    try {
      return JSON.parse(trimmed);
    } catch {
      throw new Error(
        "channels-google-chat: GOOGLE_CHAT_CREDENTIALS is not valid JSON",
      );
    }
  }
  return c;
}

export function createTokenProvider(
  opts: GoogleChatAdapterOptions,
): TokenProvider {
  const scopes = [CHAT_BOT_SCOPE];
  const credentials = resolveCredentials(opts);
  // Same precedence (opts over env) and same source as resolveCredentials, so a
  // key-file PATH supplied via GOOGLE_CHAT_CREDENTIALS is honored as keyFile
  // rather than silently dropped (which would let GoogleAuth fall back to ADC).
  const credSource = opts.credentials ?? process.env.GOOGLE_CHAT_CREDENTIALS;
  const keyFile =
    typeof credSource === "string" && !credSource.trim().startsWith("{")
      ? credSource
      : undefined;
  const auth = new GoogleAuth({
    scopes,
    ...(credentials ? { credentials } : {}),
    ...(keyFile ? { keyFile } : {}),
  });
  return {
    async getToken(): Promise<string> {
      const client = await auth.getClient();
      const { token } = await client.getAccessToken();
      if (!token) throw new Error("google-auth: failed to mint access token");
      return token;
    },
  };
}

export interface InboundVerifier {
  verify(authorizationHeader: string | undefined): Promise<void>;
}

const ADDON_SERVICE_ACCOUNT =
  /^service-\d+@gcp-sa-gsuiteaddons\.iam\.gserviceaccount\.com$/;

/**
 * Build the webhook verifier. Google signs Chat webhooks in one of two ways,
 * set by the Chat app's "Authentication audience":
 *
 * - "HTTP endpoint URL" (and every Workspace add-on Chat app): a Google OIDC
 *   ID token whose `aud` is the endpoint URL. Anyone can mint such a token
 *   for a public URL, so the `email` claim must also be Chat's system
 *   account or this app's own add-on service account.
 * - "Project number": a JWT signed by chat@system.gserviceaccount.com with
 *   `aud` = the project number, checked against that account's x509 certs.
 *
 * When both are configured, either token is accepted.
 */
export function createInboundVerifier(
  opts: GoogleChatAdapterOptions,
): InboundVerifier {
  if (opts.disableSignatureVerification) {
    return { async verify() {} };
  }
  const projectNumber = opts.googleChatProjectNumber;
  if (!projectNumber && !opts.endpointUrl) {
    throw new Error(
      "channels-google-chat: provide googleChatProjectNumber, endpointUrl, or disableSignatureVerification",
    );
  }
  const endpoint = opts.endpointUrl
    ? createEndpointUrlVerifier(
        opts.endpointUrl,
        opts.workspaceAddOnServiceAccountEmail,
      )
    : undefined;
  const project = projectNumber
    ? createProjectNumberVerifier(projectNumber)
    : undefined;
  return {
    async verify(header) {
      const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
      if (!token) throw new UnauthorizedError("missing bearer token");
      try {
        await verifyToken(token);
      } catch (e) {
        // google-auth-library puts the token in its error messages. Never
        // let a bearer token reach the logs.
        if (e instanceof UnauthorizedError)
          throw new UnauthorizedError(redactToken(e.message, token));
        throw e;
      }
    },
  };

  async function verifyToken(token: string): Promise<void> {
    let endpointError: unknown;
    if (endpoint) {
      try {
        await endpoint(token);
        return;
      } catch (e) {
        if (!project) throw e;
        endpointError = e;
      }
    }
    if (project) {
      try {
        await project(token);
        return;
      } catch (e) {
        if (e instanceof CertFetchError) throw e;
        throw endpointError instanceof UnauthorizedError
          ? new UnauthorizedError(
              `${endpointError.message}; ${(e as Error).message}`,
            )
          : e;
      }
    }
  }
}

/** Replace the token, and each of its segments, in an error message. */
function redactToken(message: string, token: string): string {
  let out = message;
  for (const part of [token, ...token.split(".")]) {
    if (part.length >= 8) out = out.split(part).join("[redacted]");
  }
  return out.split(token).join("[redacted]");
}

/** Verify an endpoint-URL-audience OIDC token and who it was issued to. */
function createEndpointUrlVerifier(
  audience: string,
  addOnServiceAccount: string | undefined,
): (token: string) => Promise<void> {
  const client = new OAuth2Client();
  return async (token) => {
    let payload: { email?: string; email_verified?: boolean } | undefined;
    try {
      const ticket = await client.verifyIdToken({ idToken: token, audience });
      payload = ticket.getPayload();
    } catch (e) {
      throw new UnauthorizedError(
        `endpoint-URL token verification failed: ${(e as Error).message}`,
      );
    }
    const email = payload?.email;
    if (!email || payload?.email_verified !== true) {
      throw new UnauthorizedError("endpoint-URL token has no verified email");
    }
    if (email === CHAT_ISSUER) return;
    if (ADDON_SERVICE_ACCOUNT.test(email) && email === addOnServiceAccount)
      return;
    throw new UnauthorizedError(
      ADDON_SERVICE_ACCOUNT.test(email) && !addOnServiceAccount
        ? `token is from Workspace add-on ${email}; set workspaceAddOnServiceAccountEmail to accept your own add-on`
        : `token was issued to ${email}, not Google Chat`,
    );
  };
}

/** Verify a project-number-audience JWT against Chat's own x509 certs. */
function createProjectNumberVerifier(
  audience: string,
): (token: string) => Promise<void> {
  const client = new OAuth2Client();

  // Chat webhook JWTs are signed by the Chat system service account, NOT
  // Google's standard federated OIDC keys, so we must verify against that
  // account's x509 certs rather than verifyIdToken's default cert source.
  // Google rotates these signing keys ~daily, so the in-memory cache must
  // self-heal: on a verification failure we treat the cache as possibly stale,
  // refetch once, and retry (see verify below).
  let cachedCerts: Certificates | undefined;
  // Timestamp (ms, Date.now) of the last self-heal refetch. Used to debounce
  // those refetches so bad-token volume can't drive outbound fetch volume.
  // Starts at -Infinity so the first verification failure is always allowed to
  // refetch (the certs are, by definition, "stale enough" before any refetch).
  let lastRefetchAt = Number.NEGATIVE_INFINITY;
  // In-flight self-heal refetch, if any. The debounce window below bounds
  // SEQUENTIAL refetches, but the time-check and the lastRefetchAt assignment
  // are separated by awaits, so N concurrent failing verifications could all
  // observe the old timestamp, pass the window check, and each fire their own
  // outbound fetch. This guard collapses concurrent refetches onto a single
  // in-flight promise so "at most one refetch per window" holds under
  // concurrency too. Cleared when the refetch settles.
  let inFlightRefetch: Promise<Certificates> | undefined;
  // In-flight cold-cache initial load, if any. The initial getCerts() path is
  // hit by every verify() before the cache is warm, so right after process
  // start N concurrent verify() calls would each fire their own outbound
  // fetch(CHAT_CERT_URL) — a thundering herd. This guard collapses concurrent
  // cold callers onto a single in-flight fetch; they all await the same
  // promise. Cleared when it settles (so a failed initial fetch does not poison
  // a permanent cache — the next caller retries).
  let inFlightInitial: Promise<Certificates> | undefined;
  async function fetchCerts(): Promise<Certificates> {
    let res: Response;
    try {
      res = await fetch(CHAT_CERT_URL);
    } catch (e) {
      // Network error reaching the cert endpoint — our infrastructure, not the
      // caller's token. Surface as a CertFetchError so verify() rethrows it
      // (→ 500), never as UnauthorizedError (→ 401).
      throw new CertFetchError(
        `failed to fetch Chat x509 certs: ${(e as Error).message}`,
      );
    }
    if (!res.ok) {
      throw new CertFetchError(
        `failed to fetch Chat x509 certs: ${res.status}`,
      );
    }
    try {
      cachedCerts = (await res.json()) as Certificates;
    } catch (e) {
      throw new CertFetchError(
        `failed to parse Chat x509 certs: ${(e as Error).message}`,
      );
    }
    return cachedCerts;
  }
  async function getCerts(forceRefresh = false): Promise<Certificates> {
    if (cachedCerts && !forceRefresh) return cachedCerts;
    // Collapse concurrent cold-cache loads onto one in-flight fetch so a burst
    // of verify() calls at startup doesn't fan out into N outbound fetches.
    if (inFlightInitial) return inFlightInitial;
    const p = fetchCerts().finally(() => {
      if (inFlightInitial === p) inFlightInitial = undefined;
    });
    inFlightInitial = p;
    return p;
  }
  /**
   * Self-heal refetch with an in-flight guard: concurrent callers share one
   * outbound fetch. The caller is responsible for the time-window debounce.
   */
  function refetchCerts(): Promise<Certificates> {
    if (inFlightRefetch) return inFlightRefetch;
    cachedCerts = undefined;
    const p = fetchCerts()
      .then((certs) => {
        // Advance the debounce window only on a SUCCESSFUL refetch. A failed
        // refetch (cert-endpoint outage → CertFetchError) must NOT consume the
        // window: otherwise a genuine post-rotation token arriving during the
        // outage would be rejected 401 without a refetch attempt for the next
        // CERT_REFETCH_MIN_INTERVAL_MS.
        lastRefetchAt = Date.now();
        return certs;
      })
      .finally(() => {
        if (inFlightRefetch === p) inFlightRefetch = undefined;
      });
    inFlightRefetch = p;
    return p;
  }

  return async (token) => {
    // Obtain the certs first. A failure here is a cert-endpoint outage on our
    // side (CertFetchError), not a bad token — let it propagate so the
    // request handler maps it to 500 (Google retries) rather than 401.
    const certs = await getCerts();
    // Validates signature against the Chat system certs AND enforces the
    // required audience and issuer in one call.
    try {
      await client.verifySignedJwtWithCertsAsync(token, certs, audience, [
        CHAT_ISSUER,
      ]);
    } catch (initialErr) {
      // Genuine verification failure: the cached certs may be stale after a
      // Google key rotation. Refetch once and retry a single time before
      // deciding the token is genuinely bad.
      //
      // But a forged/garbage token from an unauthenticated caller fails here
      // too, so refetching on EVERY failure would let a flood of bad tokens
      // amplify into one outbound fetch (and cache thrash) per request. Only
      // refetch if we haven't already refetched within
      // CERT_REFETCH_MIN_INTERVAL_MS. This still self-heals a genuine rotation
      // promptly (the first failure in a window always refetches) while
      // capping refetches to at most one per window regardless of bad-token
      // volume. The in-flight guard inside refetchCerts() extends that cap to
      // concurrent failures too.
      if (Date.now() - lastRefetchAt < CERT_REFETCH_MIN_INTERVAL_MS) {
        throw new UnauthorizedError(
          `token verification failed: ${(initialErr as Error).message}`,
        );
      }
      // lastRefetchAt is advanced inside refetchCerts() only on success, so a
      // failed refetch below does NOT burn the debounce window.
      console.warn(
        "channels-google-chat: JWT verification failed; refetching Chat x509 certs (possible key rotation) and retrying once",
      );
      // A cert-fetch failure during the self-heal is again an outage on our
      // side, so let CertFetchError propagate (→ 500). Only a second
      // verifySignedJwtWithCertsAsync rejection means the token is bad (→ 401).
      const freshCerts = await refetchCerts();
      try {
        await client.verifySignedJwtWithCertsAsync(
          token,
          freshCerts,
          audience,
          [CHAT_ISSUER],
        );
      } catch (e) {
        throw new UnauthorizedError(
          `token verification failed: ${(e as Error).message}`,
        );
      }
    }
  };
}
