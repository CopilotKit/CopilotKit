import { CreateCopilotRuntimeServerOptions, getCommonConfig } from "../shared";
import telemetry, { getRuntimeInstanceTelemetryInfo } from "../../telemetry-client";
import { createCopilotEndpointSingleRoute } from "@copilotkitnext/runtime";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  getFullUrl,
  IncomingWithBody,
  isDisturbedOrLockedError,
  isStreamConsumed,
  nodeStreamToReadableStream,
  readableStreamToNodeStream,
  synthesizeBodyFromParsedBody,
  toHeaders,
} from "./request-handler";

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

  // Note: cors option requires @copilotkitnext/runtime with credentials support
  const honoApp = createCopilotEndpointSingleRoute({
    runtime: options.runtime.instance,
    basePath: options.baseUrl ?? options.endpoint,
    ...(options.cors && { cors: options.cors }),
  } as any);

  const handle = async function handler(req: IncomingWithBody, res: ServerResponse) {
    const url = getFullUrl(req);
    const hasBody = req.method !== "GET" && req.method !== "HEAD";

    const baseHeaders = toHeaders(req.headers);
    const parsedBody = req.body;

    const streamConsumed = isStreamConsumed(req) || parsedBody !== undefined;
    const canStream = hasBody && !streamConsumed;

    let requestBody: BodyInit | null | undefined = undefined;
    let useDuplex = false;

    if (hasBody && canStream) {
      requestBody = nodeStreamToReadableStream(req);
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

  return function (
    reqOrRequest: IncomingMessage | Request,
    res?: ServerResponse,
  ): Promise<void> | Promise<Response> | Response {
    if (reqOrRequest instanceof Request) {
      return honoApp.fetch(reqOrRequest as Request);
    }
    if (!res) {
      throw new TypeError("ServerResponse is required for Node HTTP requests");
    }
    return handle(reqOrRequest as IncomingMessage, res);
  };
}
