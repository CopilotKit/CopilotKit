import type { RequestHandler } from "express";

export const DEFAULT_FRAME_ANCESTORS = [
  "https://docs.copilotkit.ai",
  "https://*.copilotkit.ai",
  "http://localhost:*",
  "http://127.0.0.1:*",
] as const;

export function parseDeploymentList(value: string | undefined) {
  if (value === undefined) {
    return undefined;
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function createBrowserRequestGuard(
  allowedOrigins: readonly string[] | undefined,
): RequestHandler {
  const allowed = allowedOrigins ? new Set(allowedOrigins) : undefined;

  return (request, response, next) => {
    if (!allowed) {
      next();
      return;
    }

    const origin = request.get("origin");
    if (!origin || !allowed.has(origin)) {
      response.status(403).json({ error: "Forbidden browser origin" });
      return;
    }

    next();
  };
}

export function createFrameAncestorHeaders(
  frameAncestors: readonly string[],
): RequestHandler {
  const sources =
    frameAncestors.length > 0 ? frameAncestors.join(" ") : "'none'";
  const policy = `frame-ancestors ${sources}`;

  return (_request, response, next) => {
    response.setHeader("Content-Security-Policy", policy);
    next();
  };
}
