import { Hono } from "hono";
import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { createCopilotHonoHandler } from "../../../endpoints/hono";
import { createTestRuntime } from "../helpers/create-test-runtime";
import type { ServerHandle } from "./types";

const BASE_PATH = "/api/copilotkit";

export async function createHonoSingleServer(
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

  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port: 0 }, () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://localhost:${port}`,
        basePath: BASE_PATH,
        close: () =>
          new Promise<void>((res, rej) =>
            server.close((err) => (err ? rej(err) : res())),
          ),
      });
    });
  });
}
