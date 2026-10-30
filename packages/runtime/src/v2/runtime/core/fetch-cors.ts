/**
 * Built-in CORS utility for framework-agnostic CopilotKit runtime handler.
 *
 * This is a lightweight CORS implementation for web-standard
 * Request/Response. It's optional — if your framework already handles CORS,
 * pass `cors: false` or omit it.
 */

export interface CopilotCorsConfig {
  origin?: string | string[] | ((origin: string) => string | null);
  credentials?: boolean;
  allowMethods?: string[];
  allowHeaders?: string[];
  exposeHeaders?: string[];
  maxAge?: number;
}

const DEFAULT_METHODS = [
  "GET",
  "HEAD",
  "PUT",
  "POST",
  "DELETE",
  "PATCH",
  "OPTIONS",
];
const DEFAULT_HEADERS = ["*"];

function resolveOrigin(
  config: CopilotCorsConfig,
  requestOrigin: string | null,
): string | null {
  const { origin } = config;
  if (!origin) return "*";

  if (typeof origin === "string") return origin;

  if (Array.isArray(origin)) {
    if (!requestOrigin) return null;
    return origin.includes(requestOrigin) ? requestOrigin : null;
  }

  if (typeof origin === "function") {
    return requestOrigin ? origin(requestOrigin) : null;
  }

  return "*";
}

function setCorsHeaders(
  headers: Headers,
  config: CopilotCorsConfig,
  requestOrigin: string | null,
): void {
  let allowedOrigin = resolveOrigin(config, requestOrigin);
  if (!allowedOrigin) return;

  // Per the Fetch spec, Access-Control-Allow-Origin: * combined with
  // Access-Control-Allow-Credentials: true causes browsers to reject the
  // response. Auto-resolve wildcard to the request origin when credentials
  // are enabled; if there is no request origin, skip CORS entirely.
  if (config.credentials && allowedOrigin === "*") {
    if (requestOrigin) {
      allowedOrigin = requestOrigin;
    } else {
      return;
    }
  }

  headers.set("Access-Control-Allow-Origin", allowedOrigin);

  if (config.credentials) {
    headers.set("Access-Control-Allow-Credentials", "true");
  }

  if (config.exposeHeaders?.length) {
    headers.set(
      "Access-Control-Expose-Headers",
      config.exposeHeaders.join(", "),
    );
  }

  // Vary on Origin when it's not a fixed wildcard
  if (allowedOrigin !== "*") {
    headers.append("Vary", "Origin");
  }
}

/**
 * Handle CORS preflight (OPTIONS) requests.
 * Returns a 204 Response if it's a preflight, or null if not.
 */
export function handleCors(
  request: Request,
  config: CopilotCorsConfig,
): Response | null {
  if (request.method !== "OPTIONS") return null;

  const requestOrigin = request.headers.get("origin");
  const headers = new Headers();

  setCorsHeaders(headers, config, requestOrigin);

  const methods = config.allowMethods ?? DEFAULT_METHODS;
  headers.set("Access-Control-Allow-Methods", methods.join(", "));

  // On a credentialed request "*" means a header literally named "*", not
  // any header (Fetch spec), so echo back the headers the browser asked for.
  // With none asked for, the request uses only safelisted headers, which
  // need no Allow-Headers at all, so leave it out. Echo only for an origin
  // the config actually allows: when a wildcard is being reflected as the
  // request origin, echoing would let any site send credentialed requests
  // with arbitrary headers, so that case keeps the default list.
  const echoRequestedHeaders =
    config.credentials && resolveOrigin(config, requestOrigin) !== "*";
  const requestedHeaders = request.headers.get(
    "access-control-request-headers",
  );
  const allowHeaders =
    config.allowHeaders ??
    (echoRequestedHeaders
      ? requestedHeaders
        ? [requestedHeaders]
        : []
      : DEFAULT_HEADERS);
  if (allowHeaders.length) {
    headers.set("Access-Control-Allow-Headers", allowHeaders.join(", "));
  }

  if (config.maxAge != null) {
    headers.set("Access-Control-Max-Age", String(config.maxAge));
  }

  // Vary headers for correct CDN caching of preflight responses
  headers.append("Vary", "Access-Control-Request-Headers");
  headers.append("Vary", "Access-Control-Request-Method");

  return new Response(null, { status: 204, headers });
}

/**
 * Add CORS headers to an existing response.
 */
export function addCorsHeaders(
  response: Response,
  config: CopilotCorsConfig,
  requestOrigin: string | null,
): Response {
  const headers = new Headers(response.headers);
  setCorsHeaders(headers, config, requestOrigin);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
