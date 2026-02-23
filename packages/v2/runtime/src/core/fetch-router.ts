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

  // /agent/:agentId/run (3 segments)
  if (
    len >= 3 &&
    segments[len - 3] === "agent" &&
    segments[len - 1] === "run"
  ) {
    return {
      method: "agent/run",
      agentId: decodeURIComponent(segments[len - 2]!),
    };
  }

  // /agent/:agentId/connect (3 segments)
  if (
    len >= 3 &&
    segments[len - 3] === "agent" &&
    segments[len - 1] === "connect"
  ) {
    return {
      method: "agent/connect",
      agentId: decodeURIComponent(segments[len - 2]!),
    };
  }

  // /agent/:agentId/stop/:threadId (4 segments)
  if (
    len >= 4 &&
    segments[len - 4] === "agent" &&
    segments[len - 2] === "stop"
  ) {
    return {
      method: "agent/stop",
      agentId: decodeURIComponent(segments[len - 3]!),
      threadId: decodeURIComponent(segments[len - 1]!),
    };
  }

  return null;
}
