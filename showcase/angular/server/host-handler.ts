import type { HostConfig } from "./host-config.js";
import type { RuntimeIndex } from "./proxy-policy.js";

export interface HostHandlerOptions {
  config: HostConfig;
  runtimeIndex: RuntimeIndex;
  proxy: (request: Request) => Promise<Response>;
  serveStatic: (pathname: string) => Promise<Response | undefined>;
  commitSha?: string;
}

const CELL_PATH_RE =
  /^\/([a-z0-9][a-z0-9-]*[a-z0-9])\/([a-z0-9][a-z0-9-]*[a-z0-9])\/?$/;
const ASSET_PATH_RE = /^\/[A-Za-z0-9._/-]+\.[A-Za-z0-9]+$/;

function securityHeaders(config: HostConfig, contentType?: string): Headers {
  const headers = new Headers({
    "content-security-policy": [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      `frame-ancestors ${config.frameAncestors.join(" ")}`,
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
    "cross-origin-resource-policy": "same-origin",
    "permissions-policy":
      "camera=(), geolocation=(), payment=(), usb=(), microphone=(self)",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  if (contentType) headers.set("content-type", contentType);
  return headers;
}

function secured(config: HostConfig, response: Response): Response {
  const headers = securityHeaders(config);
  for (const [name, value] of response.headers) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function json(config: HostConfig, body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: securityHeaders(config, "application/json; charset=utf-8"),
  });
}

/** Create a security-header-complete error without including request content. */
export function createHostErrorResponse(
  config: HostConfig,
  code: string,
  message: string,
  status: number,
): Response {
  return json(config, { error: { code, message } }, status);
}

function fatalConfiguration(config: HostConfig): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Angular Showcase configuration error</title></head><body><main role="alert"><h1>Angular Showcase is not configured</h1><p>The backend routing configuration is ${config.backendConfigStatus}. No demo or fallback backend was loaded.</p></main></body></html>`,
    {
      status: 503,
      headers: securityHeaders(config, "text/html; charset=utf-8"),
    },
  );
}

/** Create the port-free HTTP application for the canonical Angular host. */
export function createHostHandler(
  options: HostHandlerOptions,
): (request: Request) => Promise<Response> {
  const { config, runtimeIndex } = options;
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.search !== "" || url.hash !== "") {
      return createHostErrorResponse(
        config,
        "not-found",
        "The requested route was not found.",
        404,
      );
    }
    if (url.pathname === "/healthz") {
      return json(
        config,
        {
          status: config.backendConfigStatus === "valid" ? "ok" : "not-ready",
          frontend: "angular",
          backendConfig: config.backendConfigStatus,
        },
        config.backendConfigStatus === "valid" ? 200 : 503,
      );
    }
    if (url.pathname === "/__diagnostics") {
      return json(config, {
        frontend: "angular",
        backendConfig: config.backendConfigStatus,
        runnableCells: [...runtimeIndex.values()].filter(
          (entry) => entry.runnable,
        ).length,
        frameAncestorCount: config.frameAncestors.length,
        commit: options.commitSha?.slice(0, 12) ?? "unknown",
      });
    }
    if (url.pathname.startsWith("/api/copilotkit/")) {
      return secured(config, await options.proxy(request));
    }
    if (ASSET_PATH_RE.test(url.pathname)) {
      const asset = await options.serveStatic(url.pathname);
      if (asset) return secured(config, asset);
    }

    const match = CELL_PATH_RE.exec(url.pathname);
    const knownCell =
      match !== null && runtimeIndex.has(`${match[1]}/${match[2]}`);
    if (url.pathname === "/" || knownCell) {
      if (config.backendConfigStatus !== "valid") {
        return fatalConfiguration(config);
      }
      const index = await options.serveStatic("/index.html");
      if (index) return secured(config, index);
    }

    return createHostErrorResponse(
      config,
      "not-found",
      "The requested route was not found.",
      404,
    );
  };
}
