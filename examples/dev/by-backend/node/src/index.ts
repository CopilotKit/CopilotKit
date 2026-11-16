import { createServer } from "node:http";
import {
  CopilotKitRuntime,
  createCopilotKitRuntimeHandler,
} from "@copilotkit/runtime";
import { BuiltInAgent } from "@copilotkit/runtime/agent";
import { openaiText } from "@tanstack/ai-openai";
import { createCopilotKitNodeHandler } from "@copilotkit/runtime/node";

const runtime = new CopilotKitRuntime({
  agents: {
    default: new BuiltInAgent({ model: openaiText("gpt-6-luna") }),
  },
});

const copilotHandler = createCopilotKitRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
  cors: true,
});

const copilotNodeHandler = createCopilotKitNodeHandler(copilotHandler);

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  // CopilotKit endpoints
  if (url.pathname.startsWith("/api/copilotkit")) {
    return copilotNodeHandler(req, res);
  }

  // Root
  if (url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ status: "ok", message: "CopilotKit Node runtime" }),
    );
    return;
  }

  // Health check
  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "healthy" }));
    return;
  }

  // 404
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

const port = Number(process.env.PORT ?? 4001);
server.listen(port, () => {
  console.log(`Node runtime listening on http://localhost:${port}`);
  console.log(`  CopilotKit: http://localhost:${port}/api/copilotkit`);
});
