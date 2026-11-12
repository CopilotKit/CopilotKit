/**
 * Checks dashboard navigation transport and credentials only.
 * Callers must separately enforce the configured origin and allowed paths.
 * This policy does not authorize server-side requests.
 */
export function isSafeDashboardUrl(url: URL): boolean {
  const local =
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+localhost$/u.test(
      url.hostname,
    );
  return (
    !url.username &&
    !url.password &&
    (url.protocol === "https:" || (url.protocol === "http:" && local))
  );
}
