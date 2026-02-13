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
