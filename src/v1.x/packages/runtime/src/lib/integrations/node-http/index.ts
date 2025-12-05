import { CreateCopilotRuntimeServerOptions, getCommonConfig } from "../shared";
import telemetry, { getRuntimeInstanceTelemetryInfo } from "../../telemetry-client";
import { createCopilotEndpointSingleRoute } from "@copilotkitnext/runtime";
import { IncomingMessage, ServerResponse } from "http";
import { Readable } from "node:stream";

type IncomingWithBody = IncomingMessage & { body?: unknown; complete?: boolean };

export function readableStreamToNodeStream(webStream: ReadableStream): Readable {
  const reader = webStream.getReader();

  return new Readable({
    async read() {
      try {
        const { done, value } = await reader.read();
        if (done) {
          this.push(null);
        } else {
          this.push(Buffer.from(value));
        }
      } catch (err) {
        this.destroy(err as Error);
      }
    },
  });
}

function getFullUrl(req: IncomingMessage): string {
  const expressPath =
    (req as any).originalUrl ??
    ((req as any).baseUrl ? `${(req as any).baseUrl}${req.url ?? ""}` : undefined);
  const path = expressPath || req.url || "/";
  const host =
    (req.headers["x-forwarded-host"] as string) || (req.headers.host as string) || "localhost";
  const proto =
    (req.headers["x-forwarded-proto"] as string) ||
    ((req.socket as any).encrypted ? "https" : "http");

  return `${proto}://${host}${path}`;
}

function toHeaders(rawHeaders: IncomingMessage["headers"]): Headers {
  const headers = new Headers();

  for (const [key, value] of Object.entries(rawHeaders)) {
    if (value === undefined) continue;

    if (Array.isArray(value)) {
      value.forEach((entry) => headers.append(key, entry));
      continue;
    }

    headers.append(key, value);
  }

  return headers;
}

function isStreamConsumed(req: IncomingWithBody): boolean {
  const readableState = (req as any)._readableState;

  return Boolean(
    req.readableEnded || req.complete || readableState?.ended || readableState?.endEmitted,
  );
}

function synthesizeBodyFromParsedBody(
  parsedBody: unknown,
  headers: Headers,
): { body: BodyInit | null; contentType?: string } {
  if (parsedBody === null || parsedBody === undefined) {
    return { body: null };
  }

  if (parsedBody instanceof Buffer || parsedBody instanceof Uint8Array) {
    return { body: parsedBody };
  }

  if (typeof parsedBody === "string") {
    return { body: parsedBody, contentType: headers.get("content-type") ?? "text/plain" };
  }

  return {
    body: JSON.stringify(parsedBody),
    contentType: "application/json",
  };
}

function isDisturbedOrLockedError(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    typeof error.message === "string" &&
    (error.message.includes("disturbed") || error.message.includes("locked"))
  );
}

export function copilotRuntimeNodeHttpEndpoint(options: CreateCopilotRuntimeServerOptions) {
  const commonConfig = getCommonConfig(options);

  telemetry.setGlobalProperties({
    runtime: {
      framework: "node-http",
    },
  });

  if (options.properties?._copilotkit) {
    telemetry.setGlobalProperties({
      _copilotkit: options.properties._copilotkit,
    });
  }

  telemetry.capture("oss.runtime.instance_created", getRuntimeInstanceTelemetryInfo(options));

  const logger = commonConfig.logging;
  logger.debug("Creating Node HTTP endpoint");

  const serviceAdapter = options.serviceAdapter;
  if (serviceAdapter) {
    options.runtime.handleServiceAdapter(serviceAdapter);
  }

  const honoApp = createCopilotEndpointSingleRoute({
    runtime: options.runtime.instance,
    basePath: options.baseUrl ?? options.endpoint,
  });

  return async function handler(req: IncomingWithBody, res: ServerResponse) {
    const url = getFullUrl(req);
    const hasBody = req.method !== "GET" && req.method !== "HEAD";

    const baseHeaders = toHeaders(req.headers);
    const parsedBody = req.body;

    const streamConsumed = isStreamConsumed(req) || parsedBody !== undefined;
    const canStream = hasBody && !streamConsumed;

    let requestBody: BodyInit | null | undefined = undefined;
    let useDuplex = false;

    if (hasBody && canStream) {
      requestBody = req as unknown as BodyInit;
      useDuplex = true;
    }

    if (hasBody && streamConsumed) {
      if (parsedBody !== undefined) {
        const synthesized = synthesizeBodyFromParsedBody(parsedBody, baseHeaders);
        requestBody = synthesized.body ?? undefined;
        baseHeaders.delete("content-length");

        if (synthesized.contentType) {
          baseHeaders.set("content-type", synthesized.contentType);
        }

        logger.debug("Request stream already consumed; using parsed req.body to rebuild request.");
      } else {
        logger.warn("Request stream consumed with no available body; sending empty payload.");
        requestBody = undefined;
      }
    }

    const buildRequest = (body: BodyInit | null | undefined, headers: Headers, duplex: boolean) =>
      new Request(url, {
        method: req.method,
        headers,
        body,
        duplex: duplex ? "half" : undefined,
      } as RequestInit);

    let response: Response;
    try {
      response = await honoApp.fetch(buildRequest(requestBody, baseHeaders, useDuplex));
    } catch (error) {
      if (isDisturbedOrLockedError(error) && hasBody) {
        logger.warn(
          "Encountered disturbed/locked request body; rebuilding request using parsed body or empty payload.",
        );

        const fallbackHeaders = new Headers(baseHeaders);
        let fallbackBody: BodyInit | null | undefined;

        if (parsedBody !== undefined) {
          const synthesized = synthesizeBodyFromParsedBody(parsedBody, fallbackHeaders);
          fallbackBody = synthesized.body ?? undefined;
          fallbackHeaders.delete("content-length");

          if (synthesized.contentType) {
            fallbackHeaders.set("content-type", synthesized.contentType);
          }
        } else {
          fallbackBody = undefined;
        }

        response = await honoApp.fetch(buildRequest(fallbackBody, fallbackHeaders, false));
      } else {
        throw error;
      }
    }

    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    if (response.body) {
      readableStreamToNodeStream(response.body).pipe(res);
    } else {
      res.end();
    }
  };
}
