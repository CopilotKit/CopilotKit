/**
 * Determines if a header should be forwarded based on the allowlist.
 * Forwards: authorization header and all x-* custom headers.
 */
export function shouldForwardHeader(headerName: string): boolean {
  const lower = headerName.toLowerCase();
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

/**
 * Merges forwardable inbound request headers onto the headers a server
 * explicitly configured on an agent, letting the SERVER-CONFIGURED headers WIN
 * on collision — a server-set service-to-service token (e.g. an IAM bearer)
 * must never be silently overridden by a browser/edge/platform-injected inbound
 * header (#5712).
 *
 * The collision check is case-insensitive: `extractForwardableHeaders`
 * normalizes inbound keys to lowercase (`authorization`) while the server
 * typically configures canonical casing (`Authorization`). A plain object
 * spread would treat those as distinct keys and emit BOTH — which downstream
 * (undici) comma-joins into a single invalid "multiple JWTs" value. So we drop
 * any forwarded header the agent already sets, matched case-insensitively, and
 * let non-colliding inbound headers pass through unchanged.
 */
export function mergeForwardableHeaders(
  serverHeaders: Record<string, string> | undefined,
  request: Request,
): Record<string, string> {
  const base = serverHeaders ?? {};
  const serverHeaderNames = new Set(
    Object.keys(base).map((name) => name.toLowerCase()),
  );
  const merged: Record<string, string> = { ...base };
  for (const [name, value] of Object.entries(
    extractForwardableHeaders(request),
  )) {
    if (!serverHeaderNames.has(name.toLowerCase())) {
      merged[name] = value;
    }
  }
  return merged;
}
