import { randomUUID } from "node:crypto";

import { ProxyPolicyError, resolveProxyTarget } from "./proxy-policy.js";
import type { RuntimeIndex } from "./proxy-policy.js";

export interface ProxyLogEvent {
  event:
    | "angular_proxy_start"
    | "angular_proxy_complete"
    | "angular_proxy_rejected"
    | "angular_proxy_failed";
  cellId: string;
  correlationId: string;
  method: string;
  status?: number;
  durationMs?: number;
  errorCode?: string;
}

export interface ProxyHandlerOptions {
  index: RuntimeIndex;
  backendHostPattern: string | undefined;
  production: boolean;
  fetchImpl?: typeof fetch;
  log?: (event: ProxyLogEvent) => void;
}

const REQUEST_HEADER_ALLOWLIST = [
  "accept",
  "accept-language",
  "authorization",
  "content-type",
  "if-none-match",
  "x-aimock-context",
  "x-aimock-strict",
  "x-copilotcloud-public-api-key",
  "x-copilotkit-correlation-id",
  "x-diag-hops",
  "x-diag-run-id",
  "x-test-id",
] as const;

const RESPONSE_HEADER_ALLOWLIST = [
  "cache-control",
  "content-language",
  "content-type",
  "etag",
  "last-modified",
  "retry-after",
] as const;

const CORRELATION_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const PROXY_PATH_RE =
  /^\/api\/copilotkit\/([a-z0-9][a-z0-9-]*[a-z0-9])\/([a-z0-9][a-z0-9-]*[a-z0-9])(?<suffix>\/.*)?$/;

function correlationIdFrom(request: Request): string {
  const supplied = request.headers.get("x-copilotkit-correlation-id");
  return supplied && CORRELATION_ID_RE.test(supplied) ? supplied : randomUUID();
}

function copiedHeaders(source: Headers, allowlist: readonly string[]): Headers {
  const headers = new Headers();
  for (const name of allowlist) {
    const value = source.get(name);
    if (value !== null) headers.set(name, value);
  }
  return headers;
}

function errorResponse(input: {
  code: string;
  status: number;
  correlationId: string;
  integration: string;
  feature: string;
}): Response {
  return Response.json(
    {
      error: {
        code: input.code,
        message: "The Angular Showcase runtime request could not be served.",
      },
      cell: {
        frontend: "angular",
        integration: input.integration,
        feature: input.feature,
      },
      correlationId: input.correlationId,
    },
    {
      status: input.status,
      headers: {
        "cache-control": "no-store",
        "x-copilotkit-correlation-id": input.correlationId,
      },
    },
  );
}

/** Create the host's dependency-injected, port-free-testable proxy handler. */
export function createProxyHandler(
  options: ProxyHandlerOptions,
): (request: Request) => Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const log = options.log ?? (() => {});

  return async (request: Request): Promise<Response> => {
    const startedAt = performance.now();
    const correlationId = correlationIdFrom(request);
    const url = new URL(request.url);
    const match = PROXY_PATH_RE.exec(url.pathname);
    const integration = match?.[1] ?? "unknown";
    const feature = match?.[2] ?? "unknown";
    const tentativeCellId = `angular/${integration}/${feature}`;

    if (!match || url.search !== "" || url.hash !== "") {
      log({
        event: "angular_proxy_rejected",
        cellId: tentativeCellId,
        correlationId,
        method: request.method,
        status: 404,
        errorCode: "malformed-proxy-route",
      });
      return errorResponse({
        code: "malformed-proxy-route",
        status: 404,
        correlationId,
        integration,
        feature,
      });
    }

    if (!options.backendHostPattern) {
      log({
        event: "angular_proxy_rejected",
        cellId: tentativeCellId,
        correlationId,
        method: request.method,
        status: 503,
        errorCode: "missing-backend-config",
      });
      return errorResponse({
        code: "missing-backend-config",
        status: 503,
        correlationId,
        integration,
        feature,
      });
    }

    let resolved: { cellId: string; targetUrl: string };
    try {
      resolved = resolveProxyTarget({
        index: options.index,
        integration,
        feature,
        suffix: match.groups?.suffix ?? "",
        method: request.method,
        backendHostPattern: options.backendHostPattern,
        production: options.production,
      });
    } catch (error) {
      const policyError =
        error instanceof ProxyPolicyError
          ? error
          : new ProxyPolicyError("invalid-runtime-path", 404);
      log({
        event: "angular_proxy_rejected",
        cellId: tentativeCellId,
        correlationId,
        method: request.method,
        status: policyError.status,
        errorCode: policyError.code,
      });
      return errorResponse({
        code: policyError.code,
        status: policyError.status,
        correlationId,
        integration,
        feature,
      });
    }

    log({
      event: "angular_proxy_start",
      cellId: resolved.cellId,
      correlationId,
      method: request.method,
    });

    try {
      const headers = copiedHeaders(request.headers, REQUEST_HEADER_ALLOWLIST);
      headers.set("x-copilotkit-correlation-id", correlationId);
      headers.set("x-showcase-cell-id", resolved.cellId);
      const body =
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : await request.arrayBuffer();
      const upstream = await fetchImpl(resolved.targetUrl, {
        method: request.method,
        headers,
        body,
        redirect: "manual",
        signal: request.signal,
      });

      if (upstream.status >= 300 && upstream.status < 400) {
        log({
          event: "angular_proxy_failed",
          cellId: resolved.cellId,
          correlationId,
          method: request.method,
          status: 502,
          durationMs: performance.now() - startedAt,
          errorCode: "upstream-redirect-rejected",
        });
        return errorResponse({
          code: "upstream-redirect-rejected",
          status: 502,
          correlationId,
          integration,
          feature,
        });
      }

      const responseHeaders = copiedHeaders(
        upstream.headers,
        RESPONSE_HEADER_ALLOWLIST,
      );
      responseHeaders.set("x-copilotkit-correlation-id", correlationId);
      responseHeaders.set("x-showcase-cell-id", resolved.cellId);
      log({
        event: "angular_proxy_complete",
        cellId: resolved.cellId,
        correlationId,
        method: request.method,
        status: upstream.status,
        durationMs: performance.now() - startedAt,
      });
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
      });
    } catch (error) {
      const errorCode =
        error instanceof DOMException && error.name === "AbortError"
          ? "request-cancelled"
          : "upstream-unavailable";
      log({
        event: "angular_proxy_failed",
        cellId: resolved.cellId,
        correlationId,
        method: request.method,
        status: 502,
        durationMs: performance.now() - startedAt,
        errorCode,
      });
      return errorResponse({
        code: errorCode,
        status: 502,
        correlationId,
        integration,
        feature,
      });
    }
  };
}
