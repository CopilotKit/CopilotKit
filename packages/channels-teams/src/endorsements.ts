/**
 * Bot Framework channel endorsements.
 *
 * Every key in the Bot Connector's signing-key document carries an
 * `endorsements` list: the channel ids that key may sign activities for. Bot
 * Connector authentication requires that an activity claiming a channel is
 * signed by a key endorsed for that channel:
 * https://learn.microsoft.com/azure/bot-service/rest-api/bot-framework-rest-connector-authentication#step-3-get-the-list-of-valid-signing-keys
 * The M365 Agents SDK's `authorizeJWT` verifies the signature but not the
 * endorsement, so this module does that part.
 *
 * Scope matches the Bot Framework SDK's reference implementation
 * (botframework-connector `JwtTokenExtractor` / `EndorsementsValidator`): only
 * keys whose metadata has a non-empty `endorsements` array are checked. Azure
 * AD keys (single-tenant Azure Bot Service, the Bot Framework Emulator) have
 * no endorsements, so tokens verified with them are not affected.
 */

/** The issuer the SDK verifies against the Bot Connector's own keys. */
export const BOT_FRAMEWORK_ISSUER = "https://api.botframework.com";

/** Where the SDK fetches keys for {@link BOT_FRAMEWORK_ISSUER} tokens. */
export const BOT_FRAMEWORK_KEYS_URL =
  "https://login.botframework.com/v1/.well-known/keys";

/** Re-read the key document at least this often. */
const KEYS_TTL_MS = 60 * 60 * 1000;
/** On an unknown key id, refetch no more often than this. */
const MIN_REFRESH_MS = 30 * 1000;

interface SigningKey {
  kid?: unknown;
  endorsements?: unknown;
}

export type EndorsementResult =
  | { ok: true }
  | { ok: false; status: 401 | 403; reason: string };

/** The `kid` from a (signature-verified) bearer token's header. */
export function tokenKeyId(authorization: unknown): string | undefined {
  if (typeof authorization !== "string") return undefined;
  const token = authorization.split(" ")[1] ?? "";
  try {
    const header: unknown = JSON.parse(
      Buffer.from(token.split(".")[0] ?? "", "base64url").toString("utf8"),
    );
    const kid = (header as { kid?: unknown } | null)?.kid;
    return typeof kid === "string" ? kid : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A per-listener checker with a small cache of the Bot Connector key document.
 */
export function createEndorsementCheck() {
  let cached: { keys: SigningKey[]; fetchedAt: number } | undefined;

  async function load(): Promise<SigningKey[]> {
    const res = await fetch(BOT_FRAMEWORK_KEYS_URL);
    if (!res.ok) throw new Error(`signing keys: HTTP ${res.status}`);
    const body = (await res.json()) as { keys?: unknown };
    const keys = Array.isArray(body.keys) ? (body.keys as SigningKey[]) : [];
    cached = { keys, fetchedAt: Date.now() };
    return keys;
  }

  async function keyFor(kid: string): Promise<SigningKey | undefined> {
    const age = cached ? Date.now() - cached.fetchedAt : Infinity;
    let keys = cached?.keys;
    if (
      !keys ||
      age > KEYS_TTL_MS ||
      (!keys.some((k) => k.kid === kid) && age > MIN_REFRESH_MS)
    ) {
      keys = await load();
    }
    return keys.find((k) => k.kid === kid);
  }

  /**
   * Check a token that `authorizeJWT` has already verified. Only tokens
   * issued by {@link BOT_FRAMEWORK_ISSUER} are checked; others pass.
   */
  return async function check(
    iss: string,
    authorization: unknown,
    channelId: unknown,
  ): Promise<EndorsementResult> {
    if (iss !== BOT_FRAMEWORK_ISSUER) return { ok: true };
    const kid = tokenKeyId(authorization);
    if (!kid) return { ok: false, status: 401, reason: "token has no key id" };
    const key = await keyFor(kid);
    if (!key)
      return { ok: false, status: 401, reason: "signing key not found" };
    const endorsements = key.endorsements;
    if (!Array.isArray(endorsements) || endorsements.length === 0) {
      return { ok: true };
    }
    if (typeof channelId !== "string" || channelId === "") {
      return { ok: false, status: 403, reason: "activity has no channelId" };
    }
    return endorsements.includes(channelId)
      ? { ok: true }
      : {
          ok: false,
          status: 403,
          reason: "signing key is not endorsed for this channel",
        };
  };
}
