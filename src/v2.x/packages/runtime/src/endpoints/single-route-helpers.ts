const METHOD_NAMES = [
  "agent/run",
  "agent/connect",
  "agent/stop",
  "info",
  "transcribe",
] as const;

export type EndpointMethod = (typeof METHOD_NAMES)[number];

interface JsonEnvelope {
  method?: string;
  params?: Record<string, unknown>;
  body?: unknown;
}

export interface MethodCall {
  method: EndpointMethod;
  params?: Record<string, unknown>;
  body?: unknown;
}

export async function parseMethodCall(request: Request): Promise<MethodCall> {
  const contentType = request.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
    throw createResponseError("Single-route endpoint expects JSON payloads", 415);
  }

  let jsonEnvelope: JsonEnvelope;
  try {
    jsonEnvelope = (await request.clone().json()) as JsonEnvelope;
  } catch (error) {
    throw createResponseError("Invalid JSON payload", 400);
  }

  const method = validateMethod(jsonEnvelope.method);

  return {
    method,
    params: jsonEnvelope.params,
    body: jsonEnvelope.body,
  };
}

export function expectString(params: Record<string, unknown> | undefined, key: string): string {
  const value = params?.[key];
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  throw createResponseError(`Missing or invalid parameter '${key}'`, 400);
}

export function createJsonRequest(base: Request, body: unknown): Request {
  if (body === undefined || body === null) {
    throw createResponseError("Missing request body for JSON handler", 400);
  }

  const headers = new Headers(base.headers);
  headers.set("content-type", "application/json");
  headers.delete("content-length");

  const serializedBody = serializeJsonBody(body);

  return new Request(base.url, {
    method: "POST",
    headers,
    body: serializedBody,
    signal: base.signal,
  });
}

export function createResponseError(message: string, status: number): Response {
  return new Response(
    JSON.stringify({
      error: "invalid_request",
      message,
    }),
    {
      status,
      headers: {
        "Content-Type": "application/json",
      },
    },
  );
}

function validateMethod(method: string | undefined): EndpointMethod {
  if (!method) {
    throw createResponseError("Missing method field", 400);
  }

  if ((METHOD_NAMES as readonly string[]).includes(method)) {
    return method as EndpointMethod;
  }

  throw createResponseError(`Unsupported method '${method}'`, 400);
}

function serializeJsonBody(body: unknown): BodyInit {
  if (typeof body === "string") {
    return body;
  }

  if (body instanceof Blob || body instanceof ArrayBuffer || body instanceof Uint8Array) {
    return body;
  }

  if (body instanceof FormData || body instanceof URLSearchParams) {
    return body;
  }

  return JSON.stringify(body);
}
