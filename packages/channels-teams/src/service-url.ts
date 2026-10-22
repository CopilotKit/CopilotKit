/**
 * Which Bot Connector endpoints the bot may call with its app token.
 *
 * Every inbound activity names a `serviceUrl`, and the M365 Agents SDK sends
 * the bot's Azure AD app token to whatever that field says when it replies or
 * continues the conversation. So a `serviceUrl` is only usable when it points
 * at a known Microsoft connector host. The defaults cover the Teams service
 * URLs Microsoft documents for each cloud, plus Bot Framework's own channel
 * hosts:
 * https://learn.microsoft.com/microsoftteams/platform/bots/how-to/conversations/send-proactive-messages
 */
export const DEFAULT_ALLOWED_SERVICE_URLS: readonly string[] = [
  // Teams, commercial cloud (regional paths such as /amer/, /emea/, /teams/).
  "https://smba.trafficmanager.net",
  // Teams, GCC.
  "https://smba.infra.gcc.teams.microsoft.com",
  // Teams, GCC High.
  "https://smba.infra.gov.teams.microsoft.us",
  // Teams, DoD.
  "https://smba.infra.dod.teams.microsoft.us",
  // Bot Framework channels (Web Chat, Direct Line, ...).
  "https://*.botframework.com",
];

interface OriginPattern {
  protocol: string;
  host: string;
  /** `*.host`: any subdomain of `host` (not `host` itself). */
  wildcard: boolean;
  port: string;
}

const PATTERN = /^(https?):\/\/(\*\.)?([^/:?#*@]+)(?::(\d+))?(?:[/?#].*)?$/i;

function parsePattern(entry: string): OriginPattern | undefined {
  const m = PATTERN.exec(entry.trim());
  if (!m) return undefined;
  const protocol = `${m[1]!.toLowerCase()}:`;
  const port = m[4] ?? "";
  return {
    protocol,
    host: m[3]!.toLowerCase(),
    wildcard: Boolean(m[2]),
    // Normalize an explicit default port the way `URL.port` does.
    port:
      (protocol === "https:" && port === "443") ||
      (protocol === "http:" && port === "80")
        ? ""
        : port,
  };
}

/**
 * Whether `serviceUrl` is an allowed connector endpoint.
 *
 * Entries are origins (`https://host`, `https://host:port`), optionally with a
 * leading `*.` on the host to allow any subdomain. Matching is on scheme, host
 * and port; any path in an entry is ignored. A URL that carries credentials, or
 * that is not a parseable http(s) URL, never matches.
 */
export function isAllowedServiceUrl(
  serviceUrl: unknown,
  allowed: readonly string[],
): boolean {
  if (typeof serviceUrl !== "string" || serviceUrl === "") return false;
  let url: URL;
  try {
    url = new URL(serviceUrl);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return allowed.some((entry) => {
    const p = parsePattern(entry);
    if (!p || p.protocol !== url.protocol || p.port !== url.port) return false;
    return p.wildcard ? host.endsWith(`.${p.host}`) : host === p.host;
  });
}

/** Same scheme, host and port. Unparseable input never matches. */
export function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/** The default allowlist plus any caller-supplied entries. */
export function resolveAllowedServiceUrls(
  extra: readonly string[] | undefined,
): readonly string[] {
  return extra?.length
    ? [...DEFAULT_ALLOWED_SERVICE_URLS, ...extra]
    : DEFAULT_ALLOWED_SERVICE_URLS;
}
