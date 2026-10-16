import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { runtimeSocket } from "./capture/socket.mjs";
import { captureHandler } from "./capture/transport.mjs";
import {
  captureFramework,
  captureIngestion,
} from "./capture/runtime-agent.mjs";

// This process lives only in the suite's owned container. Config and capture
// mounts must be private; nothing here logs credentials or request headers.
const config = JSON.parse(
  process.env.RICH_THREADS_RUNTIME_CONFIG_JSON ??
    (await readFile(process.env.RICH_THREADS_RUNTIME_CONFIG, "utf8")),
);
const gateway = new URL(config.gatewayUrl);
if (gateway.protocol === "https:") gateway.protocol = "wss:";
if (gateway.protocol === "http:") gateway.protocol = "ws:";
if (!["ws:", "wss:"].includes(gateway.protocol))
  throw new Error("Invalid gateway protocol");
const runtimeModule = await import("@copilotkit/runtime/v2");
const { CopilotRuntime, CopilotKitIntelligence, createCopilotRuntimeHandler } =
  runtimeModule;
const Socket = await runtimeSocket(
  import.meta.resolve("@copilotkit/runtime/v2"),
);
const { HttpAgent } = await import("@ag-ui/client");
const { tap } = await import("rxjs");
captureIngestion({ Socket, directory: config.captureDirectory });
const handlers = new Map();
for (const scope of config.scopes) {
  for (const [mode, nativeUrl] of Object.entries(scope.routes)) {
    if (!nativeUrl)
      throw new Error(`Missing ${mode} backend URL for ${scope.framework}`);
    {
      if (mode !== "rich")
        throw new Error("Only the bounded rich route is included");
      const path = `/api/rich-threads/${scope.framework}/${mode}`;
      const agent = captureFramework({
        agent: new HttpAgent({ url: nativeUrl, agentId: scope.agentId }),
        directory: config.captureDirectory,
        tap,
      });
      const runtime = new CopilotRuntime({
        agents: { [scope.agentId]: agent },
        intelligence: new CopilotKitIntelligence({
          apiUrl: config.apiUrl,
          wsUrl: gateway.href,
          apiKey: config.apiKey,
        }),
        identifyUser: () => ({ id: scope.userId, name: scope.userId }),
        generateThreadNames: false,
        ...(!mode.startsWith("native")
          ? {
              openGenerativeUI: true,
              a2ui: {
                injectA2UITool: scope.injectA2UITool,
                defaultCatalogId: "copilotkit://app-dashboard-catalog",
              },
              mcpApps: { servers: config.mcpServers },
            }
          : {}),
      });
      handlers.set(
        path,
        createCopilotRuntimeHandler({ runtime, basePath: path }),
      );
    }
  }
}
const serveCapture = captureHandler({
  directory: config.captureDirectory,
  token: config.captureToken,
});
const server = createServer(async (req, res) => {
  if (serveCapture(req, res)) return;
  if (req.url === "/health") {
    res.writeHead(200).end("ready");
    return;
  }
  const handler = [...handlers].find(
    ([path]) => req.url === path || req.url.startsWith(path + "/"),
  )?.[1];
  if (!handler) {
    res.writeHead(404).end();
    return;
  }
  try {
    const request = new Request(`http://runtime${req.url}`, {
      method: req.method,
      headers: req.headers,
      ...(!["GET", "HEAD"].includes(req.method)
        ? { body: Readable.toWeb(req), duplex: "half" }
        : {}),
    });
    const response = await handler(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body)
      for await (const chunk of response.body) res.write(chunk);
    res.end();
  } catch (error) {
    console.error("Runtime request failed", error.name);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});
server.listen(config.port ?? 3001, "0.0.0.0");
