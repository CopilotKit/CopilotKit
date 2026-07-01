/**
 * Hop-by-hop and platform/proxy headers that describe the inbound
 * client→runtime hop and must not leak to the upstream agent. They match the
 * `x-*` allowlist but shouldn't cross the trust boundary — e.g. Cloud Run
 * validates `x-serverless-authorization` in preference to `authorization`, so
 * forwarding it lets a platform-injected token shadow the service-to-service
 * token the server set on the agent (see #5712).
 */
const NON_FORWARDABLE_HEADERS = new Set(["x-real-ip", "x-cloud-trace-context"]);
const NON_FORWARDABLE_PREFIXES = ["x-forwarded-", "x-serverless-", "x-vercel-"];

/**
 * Determines if a header should be forwarded based on the allowlist.
 * Forwards the authorization header and x-* custom headers, except hop-by-hop
 * and platform/proxy headers that belong to the inbound hop.
 */
export function shouldForwardHeader(headerName: string): boolean {
  const lower = headerName.toLowerCase();
  if (
    NON_FORWARDABLE_HEADERS.has(lower) ||
    NON_FORWARDABLE_PREFIXES.some((prefix) => lower.startsWith(prefix))
  ) {
    return false;
  }
  return lower === "authorization" || lower.startsWith("x-");
}

/**
 * Extracts headers that should be forwarded from a Request object.
 * Forwards only authorization and x-* headers.
 */
export function extractForwardableHeaders(
  request: Request,
): Record<string, string> {
  const forwardableHeaders: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    if (shouldForwardHeader(key)) {
      forwardableHeaders[key] = value;
    }
  });
  return forwardableHeaders;
}
