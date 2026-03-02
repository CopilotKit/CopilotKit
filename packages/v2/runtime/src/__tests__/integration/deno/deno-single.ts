/* eslint-disable @typescript-eslint/no-namespace */
declare namespace Deno {
  interface NetAddr {
    port: number;
  }
  interface HttpServer {
    addr: NetAddr;
    shutdown(): Promise<void>;
  }
  function serve(
    opts: { port: number; onListen?: () => void },
    handler: (request: Request) => Response | Promise<Response>,
  ): HttpServer;
}

import { createCopilotRuntimeHandler } from "../../../core/fetch-handler";
import { createTestRuntime } from "../helpers/create-test-runtime";
import type { ServerHandle } from "../servers/types";

const BASE_PATH = "/api/copilotkit";

export async function createDenoSingleServer(
  opts: { capturedHeaders?: Record<string, string>[] } = {},
): Promise<ServerHandle> {
  const runtime = createTestRuntime(opts);
  const handler = createCopilotRuntimeHandler({
    runtime,
    basePath: BASE_PATH,
    mode: "single-route",
    cors: true,
  });

  const server = Deno.serve({ port: 0, onListen: () => {} }, handler);
  const port = server.addr.port;

  return {
    baseUrl: `http://localhost:${port}`,
    basePath: BASE_PATH,
    close: async () => {
      await server.shutdown();
    },
  };
}
