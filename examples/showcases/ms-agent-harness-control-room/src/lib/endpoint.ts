/**
 * Endpoint validation for the MS Agent Harness Control Room.
 *
 * The Control Room can switch between agent endpoints at runtime. To avoid
 * proxying traffic to arbitrary remote hosts, we restrict the allowed set:
 *
 *  - `http://localhost` and `http://127.0.0.1` (any port, any path) — for
 *    local development against the bundled .NET agent.
 *  - `https://*` (any host) — for remote agents that terminate TLS.
 *
 * Everything else (plain HTTP remote hosts, `file:`, `javascript:`, malformed
 * URLs, empty strings) is rejected.
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export const DEFAULT_ENDPOINT = "http://localhost:8000/";

/**
 * Request header used by the Control Room UI to communicate the active agent
 * endpoint to the Next.js API routes. The value, when present, must satisfy
 * `isAllowedEndpoint`.
 */
export const CONTROL_ROOM_ENDPOINT_HEADER = "x-control-room-endpoint";

/**
 * Returns true only for endpoints we trust.
 */
export function isAllowedEndpoint(url: string): boolean {
  if (typeof url !== "string" || url.length === 0) {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const { protocol, hostname } = parsed;

  if (!hostname) {
    return false;
  }

  if (protocol === "https:") {
    return true;
  }

  if (protocol === "http:") {
    return hostname === "localhost" || hostname === "127.0.0.1";
  }

  return false;
}

/**
 * Normalizes a validated endpoint to a stable form. The returned URL always
 * ends with `/` so that joining `features` / `fixture/reset` is straightforward.
 * Any query string or fragment on the input is stripped — the Control Room
 * proxy routes append their own paths and must not inherit caller-supplied
 * search params or hashes.
 *
 * Throws if `isAllowedEndpoint(url)` returns false.
 */
export function normalizeEndpoint(url: string): string {
  if (!isAllowedEndpoint(url)) {
    throw new Error(`Endpoint not allowed: ${url}`);
  }

  const parsed = new URL(url);
  parsed.search = "";
  parsed.hash = "";
  let result = parsed.toString();
  if (!result.endsWith("/")) {
    result += "/";
  }
  return result;
}

/**
 * Reads the optional `x-control-room-endpoint` header off `req`, validates and
 * normalizes it, and returns either the resolved endpoint or a 400 response
 * for the caller to return directly.
 */
export function resolveEndpoint(
  req: NextRequest,
): { endpoint: string } | { errorResponse: NextResponse } {
  const headerValue = req.headers.get(CONTROL_ROOM_ENDPOINT_HEADER);
  if (!headerValue) {
    return { endpoint: DEFAULT_ENDPOINT };
  }
  if (!isAllowedEndpoint(headerValue)) {
    return {
      errorResponse: NextResponse.json(
        { error: `Endpoint not allowed: ${headerValue}` },
        { status: 400 },
      ),
    };
  }
  return { endpoint: normalizeEndpoint(headerValue) };
}
