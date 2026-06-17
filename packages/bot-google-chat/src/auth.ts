import { GoogleAuth, OAuth2Client } from "google-auth-library";
import type { Certificates } from "google-auth-library";
import type { GoogleChatAdapterOptions } from "./types.js";

const CHAT_BOT_SCOPE = "https://www.googleapis.com/auth/chat.bot";
const DWD_SCOPES = [
  "https://www.googleapis.com/auth/chat.spaces",
  "https://www.googleapis.com/auth/chat.messages",
  "https://www.googleapis.com/auth/chat.spaces.readonly",
  "https://www.googleapis.com/auth/chat.messages.readonly",
];
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

function resolveCredentials(opts: GoogleChatAdapterOptions): object | undefined {
  const c = opts.credentials ?? process.env.GOOGLE_CHAT_CREDENTIALS;
  if (!c) return undefined; // GoogleAuth falls back to ADC / GOOGLE_APPLICATION_CREDENTIALS
  if (typeof c === "string") {
    const trimmed = c.trim();
    if (!trimmed.startsWith("{")) return undefined; // a path → let GoogleAuth read keyFile
    try {
      return JSON.parse(trimmed);
    } catch {
      throw new Error("bot-google-chat: GOOGLE_CHAT_CREDENTIALS is not valid JSON");
    }
  }
  return c;
}

export function createTokenProvider(opts: GoogleChatAdapterOptions): TokenProvider {
  const scopes = opts.impersonateUser ? [CHAT_BOT_SCOPE, ...DWD_SCOPES] : [CHAT_BOT_SCOPE];
  const credentials = resolveCredentials(opts);
  const keyFile =
    typeof opts.credentials === "string" && !opts.credentials.trim().startsWith("{")
      ? opts.credentials
      : undefined;
  const auth = new GoogleAuth({
    scopes,
    ...(credentials ? { credentials } : {}),
    ...(keyFile ? { keyFile } : {}),
    ...(opts.impersonateUser ? { clientOptions: { subject: opts.impersonateUser } } : {}),
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

export function createInboundVerifier(opts: GoogleChatAdapterOptions): InboundVerifier {
  if (opts.disableSignatureVerification) {
    return { async verify() {} };
  }
  const audience = opts.audience ?? opts.googleChatProjectNumber;
  if (!audience) {
    throw new Error(
      "bot-google-chat: provide googleChatProjectNumber, audience, or disableSignatureVerification",
    );
  }
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
  async function fetchCerts(): Promise<Certificates> {
    let res: Response;
    try {
      res = await fetch(CHAT_CERT_URL);
    } catch (e) {
      // Network error reaching the cert endpoint — our infrastructure, not the
      // caller's token. Surface as a CertFetchError so verify() rethrows it
      // (→ 500), never as UnauthorizedError (→ 401).
      throw new CertFetchError(`failed to fetch Chat x509 certs: ${(e as Error).message}`);
    }
    if (!res.ok) {
      throw new CertFetchError(`failed to fetch Chat x509 certs: ${res.status}`);
    }
    try {
      cachedCerts = (await res.json()) as Certificates;
    } catch (e) {
      throw new CertFetchError(`failed to parse Chat x509 certs: ${(e as Error).message}`);
    }
    return cachedCerts;
  }
  async function getCerts(forceRefresh = false): Promise<Certificates> {
    if (cachedCerts && !forceRefresh) return cachedCerts;
    return fetchCerts();
  }
  /**
   * Self-heal refetch with an in-flight guard: concurrent callers share one
   * outbound fetch. The caller is responsible for the time-window debounce.
   */
  function refetchCerts(): Promise<Certificates> {
    if (inFlightRefetch) return inFlightRefetch;
    cachedCerts = undefined;
    const p = fetchCerts().finally(() => {
      if (inFlightRefetch === p) inFlightRefetch = undefined;
    });
    inFlightRefetch = p;
    return p;
  }

  return {
    async verify(header) {
      const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
      if (!token) throw new UnauthorizedError("missing bearer token");
      // Obtain the certs first. A failure here is a cert-endpoint outage on our
      // side (CertFetchError), not a bad token — let it propagate so the
      // request handler maps it to 500 (Google retries) rather than 401.
      const certs = await getCerts();
      // Validates signature against the Chat system certs AND enforces the
      // required audience and issuer in one call.
      try {
        await client.verifySignedJwtWithCertsAsync(token, certs, audience, [CHAT_ISSUER]);
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
        lastRefetchAt = Date.now();
        console.warn(
          "bot-google-chat: JWT verification failed; refetching Chat x509 certs (possible key rotation) and retrying once",
        );
        // A cert-fetch failure during the self-heal is again an outage on our
        // side, so let CertFetchError propagate (→ 500). Only a second
        // verifySignedJwtWithCertsAsync rejection means the token is bad (→ 401).
        const freshCerts = await refetchCerts();
        try {
          await client.verifySignedJwtWithCertsAsync(token, freshCerts, audience, [CHAT_ISSUER]);
        } catch (e) {
          throw new UnauthorizedError(`token verification failed: ${(e as Error).message}`);
        }
      }
    },
  };
}
