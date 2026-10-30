import { Elysia } from "elysia";
import { createCopilotRuntimeHandler } from "../../../core/fetch-handler";
import { createTestRuntime } from "../helpers/create-test-runtime";
import type { ServerHandle } from "../servers/types";

const BASE_PATH = "/api/copilotkit";

export async function createElysiaSingleServer(
  opts: { capturedHeaders?: Record<string, string>[] } = {},
): Promise<ServerHandle> {
  const runtime = createTestRuntime(opts);
  const handler = createCopilotRuntimeHandler({
    runtime,
    basePath: BASE_PATH,
    mode: "single-route",
    cors: true,
  });

  const app = new Elysia()
    .all(`${BASE_PATH}/*`, ({ request }) => handler(request))
    .all(BASE_PATH, ({ request }) => handler(request));

  const server = app.listen(0);
  const port = server.server!.port;

  return {
    baseUrl: `http://localhost:${port}`,
    basePath: BASE_PATH,
    close: async () => {
      server.stop();
    },
  };
}
