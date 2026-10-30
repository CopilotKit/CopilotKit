import { getAuthConfigWithDefaults } from "@microsoft/agents-hosting";
import type { AuthConfiguration } from "@microsoft/agents-hosting";

/**
 * How to configure credentials, for startup errors. Names only: errors never
 * include a secret value.
 */
const SUPPORTED_CREDENTIALS =
  "Configure the bot's app id with the clientId / clientSecret / tenantId " +
  "options, the clientId / clientSecret / tenantId environment variables, or " +
  "Connections__<id>__Settings__ClientId / ClientSecret / TenantId.";

/**
 * Bot Framework SDK-style variables (`MicrosoftAppId`, `MICROSOFT_APP_ID`,
 * ...). The M365 Agents SDK path this package uses does not read them, so on
 * their own they leave the bot without an app id.
 */
const LEGACY_CREDENTIAL_VARS = new Set([
  "MICROSOFTAPPID",
  "MICROSOFTAPPPASSWORD",
  "MICROSOFTAPPTENANTID",
]);

/** Names (never values) of legacy credential env vars that are set. */
function legacyCredentialVars(): string[] {
  return Object.entries(process.env)
    .filter(
      ([key, value]) =>
        Boolean(value) &&
        LEGACY_CREDENTIAL_VARS.has(key.toUpperCase().replace(/_/g, "")),
    )
    .map(([key]) => key);
}

/**
 * Fail before listening when only legacy credential env vars are set and no
 * app id resolved: the operator meant to configure credentials, and running
 * anyway would serve the endpoint anonymously.
 */
export function assertNotLegacyOnlyCredentials(
  resolvedAppId: string | undefined,
  cause?: unknown,
): void {
  if (resolvedAppId) return;
  const legacy = legacyCredentialVars();
  if (legacy.length === 0) return;
  throw new Error(
    `[bot-teams] ${legacy.join(", ")} ${legacy.length === 1 ? "is" : "are"} ` +
      "set, but the M365 Agents SDK does not read these variables, so no app " +
      `id was resolved and the endpoint would run unauthenticated. ` +
      SUPPORTED_CREDENTIALS,
    cause === undefined ? undefined : { cause },
  );
}

/**
 * Fail closed when the SDK resolved a different app id than the one asked
 * for. When any `Connections__*` env var exists, the SDK builds its settings
 * from those alone and drops an explicit `clientId`, which would otherwise
 * leave the endpoint anonymous (or acting as another app) without a word.
 */
export function assertResolvedAppId(
  requested: string | undefined,
  resolved: AuthConfiguration,
): void {
  if (!requested || resolved.clientId === requested) return;
  throw new Error(
    `[bot-teams] clientId "${requested}" is configured (option or clientId ` +
      `env var), but the M365 Agents SDK resolved ` +
      (resolved.clientId ? `app id "${resolved.clientId}"` : "no app id") +
      " because Connections__* environment settings take precedence over " +
      "it. Remove the Connections__* variables, or set " +
      "Connections__<id>__Settings__ClientId (and its secret) to the same app.",
  );
}

/**
 * Resolve auth settings the way `CloudAdapter` does, then apply the startup
 * checks above. A config that already carries a `connections` map is taken as
 * resolved.
 */
export function resolveTeamsAuth(raw: AuthConfiguration): AuthConfiguration {
  let resolved: AuthConfiguration;
  try {
    resolved = raw.connections?.size ? raw : getAuthConfigWithDefaults(raw);
  } catch (err) {
    // The SDK's "ClientId required in production" means no app id resolved:
    // explain legacy-only credentials when that is why. Any other SDK error
    // (e.g. a bad ConnectionsMap) is surfaced as is.
    if (err instanceof Error && /ClientId required/i.test(err.message)) {
      assertNotLegacyOnlyCredentials(undefined, err);
    }
    throw err;
  }
  assertResolvedAppId(raw.clientId, resolved);
  assertNotLegacyOnlyCredentials(resolved.clientId);
  return resolved;
}
