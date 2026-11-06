import { createCopilotRuntimeHandler } from "../../../core/fetch-handler";
import { Hono } from "hono";

import { createTestRuntime } from "../helpers/create-test-runtime";
import type { ServerHandle } from "../servers/types";

const BASE_PATH = "/api/copilotkit";

export async function createHonoBunMultiServer(
  opts: { capturedHeaders?: Record<string, string>[] } = {},
): Promise<ServerHandle> {
  const runtime = createTestRuntime(opts);
  const app = new Hono();
  const handler = createCopilotRuntimeHandler({
    cors: true,
    runtime,
    basePath: BASE_PATH,
  });
  app.all("*", (c) => handler(c.req.raw));

  const server = Bun.serve({ fetch: app.fetch, port: 0 });
  const port = server.port;

  return {
    baseUrl: `http://localhost:${port}`,
    basePath: BASE_PATH,
    close: async () => {
      server.stop();
    },
  };
}
