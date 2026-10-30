import express from "express";
import type { AddressInfo } from "node:net";
import { createCopilotExpressHandler } from "../../../endpoints/express";
import { createTestRuntime } from "../helpers/create-test-runtime";
import type { ServerHandle } from "./types";

const BASE_PATH = "/api/copilotkit";

export async function createExpressSingleServer(
  opts: { capturedHeaders?: Record<string, string>[] } = {},
): Promise<ServerHandle> {
  const runtime = createTestRuntime(opts);
  const app = express();
  app.use(
    createCopilotExpressHandler({
      runtime,
      basePath: BASE_PATH,
      mode: "single-route",
      cors: true,
    }),
  );

  return new Promise((resolve) => {
    const server = app.listen(0, () => {
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
