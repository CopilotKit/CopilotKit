interface SingleRouteResourceRequest {
  input: RequestInfo | URL;
  init: RequestInit;
}

/** Returns true when a path belongs to an Intelligence resource API. */
function isIntelligenceResourcePath(path: string): boolean {
  return (
    path === "/threads" ||
    path.startsWith("/threads/") ||
    path === "/memories" ||
    path.startsWith("/memories/") ||
    path === "/annotate"
  );
}

/** Reads a JSON resource body without changing invalid JSON error behavior. */
async function readResourceBody(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  headers: Headers,
  method: string,
): Promise<unknown | undefined> {
  if (method === "GET" || method === "HEAD") return undefined;

  let text: string | undefined;
  if (init?.body != null) {
    text = await new Response(init.body).text();
  } else if (input instanceof Request) {
    text = await input.clone().text();
  }
  if (!text) return undefined;

  if (headers.get("content-type")?.includes("application/json")) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  return text;
}

/**
 * Converts one Runtime resource fetch into a single-route JSON envelope.
 * Requests outside the mounted Runtime or outside its resource APIs pass
 * through unchanged.
 */
export async function createSingleRouteResourceRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  runtimeUrl: string,
): Promise<SingleRouteResourceRequest | null> {
  const runtime = new URL(runtimeUrl);
  const inputUrl =
    input instanceof Request
      ? input.url
      : input instanceof URL
        ? input.href
        : input;
  const target = new URL(inputUrl, runtime);
  const runtimePath = runtime.pathname.replace(/\/$/, "");
  if (target.origin !== runtime.origin) return null;
  if (!target.pathname.startsWith(`${runtimePath}/`)) return null;

  const resourcePath = target.pathname.slice(runtimePath.length);
  if (!isIntelligenceResourcePath(resourcePath)) return null;

  const method = (
    init?.method ?? (input instanceof Request ? input.method : "GET")
  ).toUpperCase();
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  const body = await readResourceBody(input, init, headers, method);
  headers.set("content-type", "application/json");
  headers.delete("content-length");

  const requestDefaults: RequestInit =
    input instanceof Request
      ? {
          cache: input.cache,
          credentials: input.credentials,
          integrity: input.integrity,
          keepalive: input.keepalive,
          mode: input.mode,
          redirect: input.redirect,
          referrer: input.referrer,
          referrerPolicy: input.referrerPolicy,
          signal: input.signal,
        }
      : {};

  return {
    input: runtimeUrl,
    init: {
      ...requestDefaults,
      ...init,
      method: "POST",
      headers,
      body: JSON.stringify({
        method: "resource/request",
        params: {
          path: `${resourcePath}${target.search}`,
          httpMethod: method,
        },
        ...(body === undefined ? {} : { body }),
      }),
    },
  };
}
