/**
 * Which Bot Connector endpoints the bot may call with its app token.
 *
 * Every inbound activity names a `serviceUrl`, and the M365 Agents SDK sends
 * the bot's Azure AD app token to whatever that field says when it replies or
 * continues the conversation. So a `serviceUrl` is only usable when it points
 * at a known Microsoft connector host. The defaults cover the Teams service
 * URLs Microsoft documents for each cloud, plus Bot Framework's own channel
 * hosts:
 * - Teams commercial, GCC, GCC High, DoD:
 *   https://learn.microsoft.com/microsoftteams/platform/bots/how-to/conversations/send-proactive-messages
 * - Teams operated by 21Vianet (`msteams.botframework.azure.cn`):
 *   https://docs.azure.cn/en-us/bot-service/channel-connect-teams and
 *   https://learn.microsoft.com/microsoftteams/platform/concepts/sovereign-cloud
 * - Azure Government Bot Framework (`botframework.azure.us`):
 *   https://learn.microsoft.com/azure/bot-service/how-to-deploy-gov-cloud-high
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
  // Teams operated by 21Vianet.
  "https://msteams.botframework.azure.cn",
  // Azure Government Bot Framework.
  "https://*.botframework.azure.us",
];

/** Hosts a plain-http entry may name (local tools such as the Emulator). */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

interface OriginPattern {
  protocol: string;
  host: string;
  /** `*.host`: any subdomain of `host` (not `host` itself). */
  wildcard: boolean;
  port: string;
}

const PATTERN =
  /^(https?):\/\/(\*\.)?(\[[0-9a-f:.]+\]|[^/:?#*@[\]]+)(?::(\d+))?(?:[/?#].*)?$/i;

/**
 * Parse one allowlist entry, or `undefined` when it is malformed or too broad:
 * plain `http` is only accepted for a loopback host, and a wildcard must keep
 * at least two labels after `*.` (`*.botframework.com`, never `*.com`).
 */
function parsePattern(entry: string): OriginPattern | undefined {
  const m = PATTERN.exec(entry.trim());
  if (!m) return undefined;
  const protocol = `${m[1]!.toLowerCase()}:`;
  const host = m[3]!.toLowerCase();
  const wildcard = Boolean(m[2]);
  if (protocol === "http:" && (wildcard || !LOOPBACK_HOSTS.has(host))) {
    return undefined;
  }
  if (wildcard && host.split(".").length < 2) return undefined;
  const port = m[4] ?? "";
  return {
    protocol,
    host,
    wildcard,
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

/**
 * The default allowlist plus any caller-supplied entries. An entry that does
 * not parse, or is too broad, is dropped with a warning so a typo can't
 * silently widen (or quietly fail to extend) the list.
 */
export function resolveAllowedServiceUrls(
  extra: readonly string[] | undefined,
): readonly string[] {
  if (!extra?.length) return DEFAULT_ALLOWED_SERVICE_URLS;
  const valid = extra.filter((entry) => {
    if (parsePattern(entry)) return true;
    console.warn(
      `[bot-teams] ignoring allowedServiceUrls entry ${JSON.stringify(entry)}: ` +
        "expected an https origin (optionally https://*.<two or more labels>), " +
        "or http only for localhost / 127.0.0.1 / [::1]",
    );
    return false;
  });
  return [...DEFAULT_ALLOWED_SERVICE_URLS, ...valid];
}
