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
 *
 * The same comma-join hazard exists if the SERVER CONFIG ITSELF contains two
 * case-variants of one header (e.g. both `Authorization` and `authorization`
 * in `agent.headers`). A plain `{ ...serverHeaders }` spread would keep both,
 * so we additionally collapse server-self case-collisions to a SINGLE entry,
 * FIRST-OCCURRENCE WINS: the first key seen (in `Object.keys` order) keeps its
 * exact casing and value, and any later case-variant of that name is dropped.
 * Server-wins-over-inbound and case-insensitive inbound suppression are
 * otherwise unchanged.
 */
export function mergeForwardableHeaders(
  serverHeaders: Record<string, string> | undefined,
  request: Request,
): Record<string, string> {
  const base = serverHeaders ?? {};
  const merged: Record<string, string> = {};
  const serverHeaderNames = new Set<string>();
  // Collapse server-self case-collisions: first occurrence wins, later
  // case-variants of the same name are dropped.
  for (const [name, value] of Object.entries(base)) {
    const lower = name.toLowerCase();
    if (serverHeaderNames.has(lower)) {
      continue;
    }
    serverHeaderNames.add(lower);
    merged[name] = value;
  }
  for (const [name, value] of Object.entries(
    extractForwardableHeaders(request),
  )) {
    if (!serverHeaderNames.has(name.toLowerCase())) {
      merged[name] = value;
    }
  }
  return merged;
}
