import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createCopilotRuntimeHandler } from "../../../core/fetch-handler";
import { createCopilotNodeHandler } from "../../../endpoints/node-fetch-handler";
import { createTestRuntime } from "../helpers/create-test-runtime";
import type { ServerHandle } from "./types";

const BASE_PATH = "/api/copilotkit";

export async function createNodeMultiServer(
  opts: { capturedHeaders?: Record<string, string>[] } = {},
): Promise<ServerHandle> {
  const runtime = createTestRuntime(opts);

  const handler = createCopilotRuntimeHandler({
    runtime,
    basePath: BASE_PATH,
    cors: true,
  });

  const nodeHandler = createCopilotNodeHandler(handler);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    if (url.pathname.startsWith(BASE_PATH)) {
      return nodeHandler(req, res);
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  return new Promise((resolve) => {
    server.listen(0, () => {
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
