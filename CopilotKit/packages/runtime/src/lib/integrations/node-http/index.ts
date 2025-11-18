import { CreateCopilotRuntimeServerOptions, getCommonConfig } from "../shared";
import telemetry, { getRuntimeInstanceTelemetryInfo } from "../../telemetry-client";
import { createCopilotEndpointSingleRoute } from "@copilotkitnext/runtime";
import { IncomingMessage, ServerResponse } from "http";
import { Readable } from "node:stream";

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
  const path = req.url || "/";
  const host =
    (req.headers["x-forwarded-host"] as string) || (req.headers.host as string) || "localhost";
  const proto =
    (req.headers["x-forwarded-proto"] as string) ||
    ((req.socket as any).encrypted ? "https" : "http");

  return `${proto}://${host}${path}`;
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
  options.runtime.handleServiceAdapter(serviceAdapter);

  const honoApp = createCopilotEndpointSingleRoute({
    runtime: options.runtime.instance,
    basePath: options.baseUrl ?? options.endpoint,
  });

  return async function handler(req: IncomingMessage, res: ServerResponse) {
    const url = getFullUrl(req);
    const hasBody = req.method !== "GET" && req.method !== "HEAD";

    const request = new Request(url, {
      method: req.method,
      headers: req.headers as any,
      body: hasBody ? (req as any) : undefined,
      // Node/undici extension
      duplex: hasBody ? "half" : undefined,
    } as any);

    const response = await honoApp.fetch(request);

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
