import { Hono } from "hono";
import { createCopilotHonoHandler } from "../../../endpoints/hono";
import { createTestRuntime } from "../helpers/create-test-runtime";
import type { ServerHandle } from "../servers/types";

const BASE_PATH = "/api/copilotkit";

export async function createHonoBunSingleServer(
  opts: { capturedHeaders?: Record<string, string>[] } = {},
): Promise<ServerHandle> {
  const runtime = createTestRuntime(opts);
  const app = new Hono();
  app.route(
    "/",
    createCopilotHonoHandler({
      runtime,
      basePath: BASE_PATH,
      mode: "single-route",
    }),
  );

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
