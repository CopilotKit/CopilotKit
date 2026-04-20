/**
 * Lightweight URL router for framework-agnostic CopilotKit runtime handler.
 *
 * Two strategies:
 * - With `basePath`: strict prefix strip → match remainder
 * - Without `basePath`: suffix matching on known patterns
 *
 * Single-route mode: delegates to `parseMethodCall` for JSON envelope dispatch.
 */

import type { RouteInfo } from "./hooks";

/**
 * Match a request URL against known CopilotKit route patterns.
 *
 * @param pathname - The URL pathname to match
 * @param basePath - Optional base path prefix to strip first
 * @returns RouteInfo if matched, null otherwise
 */
export function matchRoute(
  pathname: string,
  basePath?: string,
): RouteInfo | null {
  let remainder: string;

  if (basePath) {
    // Normalize: ensure basePath doesn't end with /
    const normalizedBase =
      basePath.length > 1 && basePath.endsWith("/")
        ? basePath.slice(0, -1)
        : basePath;

    // Special case: basePath === "/" matches everything
    if (normalizedBase === "/") {
      remainder = pathname;
    } else {
      if (!pathname.startsWith(normalizedBase)) return null;

      // The character after basePath must be "/" or end of string
      const afterBase = pathname.slice(normalizedBase.length);
      if (afterBase.length > 0 && !afterBase.startsWith("/")) return null;

      remainder = afterBase || "/";
    }
  } else {
    // Suffix matching: find known patterns at the end of the pathname
    remainder = pathname;
  }

  return matchSegments(remainder);
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function matchSegments(path: string): RouteInfo | null {
  const segments = path.split("/").filter(Boolean);
  const len = segments.length;

  // Try suffix matching — scan from the end for known patterns

  // /info (1 segment)
  if (len >= 1 && segments[len - 1] === "info") {
    return { method: "info" };
  }

  // /transcribe (1 segment)
  if (len >= 1 && segments[len - 1] === "transcribe") {
    return { method: "transcribe" };
  }

  // /cpk-debug-events (1 segment)
  // Reserved route name: the `cpk-` prefix makes collision with a
  // user-named agent essentially impossible (the router only treats
  // `agent/:agentId/...` patterns as agent lookups, so a bare
  // `cpk-debug-events` segment would never fall through to one —
  // the prefix is the real guard, not this branch's position).
  // Handler returns 404 in production.
  if (len >= 1 && segments[len - 1] === "cpk-debug-events") {
    return { method: "cpk-debug-events" };
  }

  // /agent/:agentId/run (3 segments)
  if (
    len >= 3 &&
    segments[len - 3] === "agent" &&
    segments[len - 1] === "run"
  ) {
    const agentId = safeDecodeURIComponent(segments[len - 2]!);
    if (!agentId) return null;
    return { method: "agent/run", agentId };
  }

  // /agent/:agentId/connect (3 segments)
  if (
    len >= 3 &&
    segments[len - 3] === "agent" &&
    segments[len - 1] === "connect"
  ) {
    const agentId = safeDecodeURIComponent(segments[len - 2]!);
    if (!agentId) return null;
    return { method: "agent/connect", agentId };
  }

  // /agent/:agentId/stop/:threadId (4 segments)
  if (
    len >= 4 &&
    segments[len - 4] === "agent" &&
    segments[len - 2] === "stop"
  ) {
    const agentId = safeDecodeURIComponent(segments[len - 3]!);
    const threadId = safeDecodeURIComponent(segments[len - 1]!);
    if (!agentId || !threadId) return null;
    return { method: "agent/stop", agentId, threadId };
  }

  // /threads/subscribe (2 segments)
  if (
    len >= 2 &&
    segments[len - 2] === "threads" &&
    segments[len - 1] === "subscribe"
  ) {
    return { method: "threads/subscribe" };
  }

  // /threads/:threadId/messages (3 segments)
  if (
    len >= 3 &&
    segments[len - 3] === "threads" &&
    segments[len - 1] === "messages"
  ) {
    const threadId = safeDecodeURIComponent(segments[len - 2]!);
    if (!threadId) return null;
    return { method: "threads/messages", threadId };
  }

  // /threads/:threadId/archive (3 segments)
  if (
    len >= 3 &&
    segments[len - 3] === "threads" &&
    segments[len - 1] === "archive"
  ) {
    const threadId = safeDecodeURIComponent(segments[len - 2]!);
    if (!threadId) return null;
    return { method: "threads/archive", threadId };
  }

  // /threads/:threadId (2 segments) — update or delete
  if (
    len >= 2 &&
    segments[len - 2] === "threads" &&
    segments[len - 1] !== "subscribe"
  ) {
    const threadId = safeDecodeURIComponent(segments[len - 1]!);
    if (!threadId) return null;
    // Disambiguated by HTTP method in the handler
    return { method: "threads/update", threadId };
  }

  // /threads (1 segment) — list
  if (len >= 1 && segments[len - 1] === "threads") {
    return { method: "threads/list" };
  }

  return null;
}
