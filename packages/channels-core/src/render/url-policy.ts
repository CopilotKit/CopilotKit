/**
 * URL policy for the image renderer's outbound fetches.
 *
 * Takumi fetches remote resources referenced by the JSX it renders (`<img src>`,
 * CSS `url()`, emoji glyphs). A channel's JSX is frequently built from
 * model- or user-supplied data, so an unrestricted fetcher running inside your
 * infrastructure is an SSRF sink: `<img src="http://169.254.169.254/latest/meta-data/">`
 * would have the renderer read cloud instance metadata on the attacker's behalf.
 *
 * The default policy below blocks non-HTTP(S) schemes and hosts that are
 * literally private/loopback/link-local, and allows everything else so public
 * CDN images and emoji sheets keep working. It is a *literal-host* check: the
 * hook Takumi exposes is synchronous, so DNS cannot be resolved here and a
 * public name that resolves to a private address (DNS rebinding) is NOT caught.
 * If you render untrusted URLs, pass an explicit allowlist via
 * `createChannel({ render: { allowImageUrl } })` instead of relying on this.
 */

/** Hostnames that always mean "this machine" or a link-local/internal service. */
const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "[::]",
  "[::1]",
  "::1",
  "metadata.google.internal",
]);

/** Suffixes for internal-only naming schemes (mDNS, k8s/cloud internal zones). */
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain"];

/** Private / loopback / link-local / CGNAT IPv4 ranges, as literal-text patterns. */
const BLOCKED_IPV4 =
  /^(?:10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;

/** IPv6 loopback (::1), unique-local (fc00::/7) and link-local (fe80::/10). */
const BLOCKED_IPV6 = /^(?:::1|f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:)/;

/**
 * Default `allowImageUrl`: deny non-HTTP(S) schemes and literally-private hosts,
 * allow the rest. See the module doc for what this does and does not cover.
 */
export function defaultAllowImageUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Not a URL we can reason about → don't fetch it.
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  // `URL.hostname` keeps the brackets on an IPv6 literal (`[::1]`); compare bare.
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTS.has(host)) return false;
  if (BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return false;
  if (BLOCKED_IPV4.test(host)) return false;
  if (BLOCKED_IPV6.test(host)) return false;
  return true;
}
