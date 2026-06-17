import { GoogleAuth, OAuth2Client } from "google-auth-library";
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
    return trimmed.startsWith("{") ? JSON.parse(trimmed) : undefined; // a path → let GoogleAuth read keyFile
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
  return {
    async verify(header) {
      const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
      if (!token) throw new UnauthorizedError("missing bearer token");
      let payload: { aud?: string | string[]; iss?: string } | undefined;
      try {
        const ticket = await client.verifyIdToken({
          idToken: token,
          audience,
          // Chat webhook JWTs are signed by the Chat system service account,
          // not Google's standard OIDC keys.
          certsUrl: CHAT_CERT_URL,
        } as Parameters<OAuth2Client["verifyIdToken"]>[0]);
        payload = ticket.getPayload();
      } catch (e) {
        throw new UnauthorizedError(`token verification failed: ${(e as Error).message}`);
      }
      if (!payload || payload.iss !== CHAT_ISSUER) {
        throw new UnauthorizedError("unexpected token issuer");
      }
    },
  };
}
