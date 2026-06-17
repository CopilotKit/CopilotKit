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

export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedError";
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
  async function getCerts(forceRefresh = false): Promise<Certificates> {
    if (cachedCerts && !forceRefresh) return cachedCerts;
    const res = await fetch(CHAT_CERT_URL);
    if (!res.ok) {
      throw new Error(`failed to fetch Chat x509 certs: ${res.status}`);
    }
    cachedCerts = (await res.json()) as Certificates;
    return cachedCerts;
  }

  return {
    async verify(header) {
      const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
      if (!token) throw new UnauthorizedError("missing bearer token");
      // Validates signature against the Chat system certs AND enforces the
      // required audience and issuer in one call.
      try {
        const certs = await getCerts();
        await client.verifySignedJwtWithCertsAsync(token, certs, audience, [CHAT_ISSUER]);
      } catch {
        // Verification failed: the cached certs may be stale after a Google key
        // rotation. Clear the cache, refetch once, and retry a single time
        // before deciding the token is genuinely bad.
        console.warn(
          "bot-google-chat: JWT verification failed; refetching Chat x509 certs (possible key rotation) and retrying once",
        );
        cachedCerts = undefined;
        try {
          const freshCerts = await getCerts(true);
          await client.verifySignedJwtWithCertsAsync(token, freshCerts, audience, [CHAT_ISSUER]);
        } catch (e) {
          throw new UnauthorizedError(`token verification failed: ${(e as Error).message}`);
        }
      }
    },
  };
}
