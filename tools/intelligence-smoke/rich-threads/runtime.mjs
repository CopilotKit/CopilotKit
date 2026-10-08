import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import {
  captureFramework,
  captureIngestion,
} from "./capture/runtime-agent.mjs";

// This process lives only in the suite's owned container. Config and capture
// mounts must be private; nothing here logs credentials or request headers.
const config = JSON.parse(
  await readFile(process.env.RICH_THREADS_RUNTIME_CONFIG, "utf8"),
);
const runtimeModule = await import("@copilotkit/runtime/v2");
const { CopilotRuntime, CopilotKitIntelligence, createCopilotRuntimeHandler } =
  runtimeModule;
const requireRuntime = createRequire(
  import.meta.resolve("@copilotkit/runtime/v2"),
);
const { Socket } = await import(
  pathToFileURL(requireRuntime.resolve("phoenix"))
);
const { HttpAgent } = await import("@ag-ui/client");
const { tap } = await import("rxjs");
captureIngestion({ Socket, directory: config.captureDirectory });
const handlers = new Map();
for (const scope of config.scopes) {
  for (const [mode, nativeUrl] of Object.entries(scope.routes)) {
    if (!nativeUrl)
      throw new Error(`Missing ${mode} backend URL for ${scope.framework}`);
    for (const nativeOnly of [false, true]) {
      const path = `/api/rich-threads/${nativeOnly ? "source/" : ""}${scope.framework}/${mode}`;
      const agent = captureFramework({
        agent: new HttpAgent({ url: nativeUrl, agentId: scope.agentId }),
        directory: config.captureDirectory,
        tap,
      });
      const runtime = new CopilotRuntime({
        agents: { [scope.agentId]: agent },
        ...(!nativeOnly
          ? {
              intelligence: new CopilotKitIntelligence({
                apiUrl: config.apiUrl,
                wsUrl: config.gatewayUrl,
                apiKey: config.apiKey,
              }),
            }
          : {}),
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
const server = createServer(async (req, res) => {
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
