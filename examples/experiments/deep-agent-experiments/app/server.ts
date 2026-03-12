import Fastify, { type FastifyRequest, type FastifyReply } from "fastify";
import FastifyVite from "@fastify/vite";
import { Readable } from "node:stream";
import { resolve } from "node:path";
import { readdirSync } from "node:fs";

// Prevent unhandled errors from crashing the process
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err.message);
});
process.on("unhandledRejection", (err: any) => {
  console.error("[unhandledRejection]", err?.message ?? err);
});

import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNodeHttpEndpoint,
} from "@copilotkit/runtime";
import { LangGraphHttpAgent } from "@copilotkit/runtime/langgraph";

const server = Fastify();

const agentBaseUrl = process.env.LANGGRAPH_DEPLOYMENT_URL || "http://localhost:8000";

const researchAgent = new LangGraphHttpAgent({
  url: agentBaseUrl,
});

const researchAgentHitl = new LangGraphHttpAgent({
  url: `${agentBaseUrl}/hitl`,
});

const serviceAdapter = new ExperimentalEmptyAdapter();
const runtime = new CopilotRuntime({
  agents: {
    research_agent: researchAgent,
    research_agent_hitl: researchAgentHitl,
  },
});

// Create the CopilotKit runtime handler once (uses Hono internally)
const runtimeHandler = copilotRuntimeNodeHttpEndpoint({
  runtime,
  serviceAdapter,
  endpoint: "/api/copilot",
});

await server.register(FastifyVite, {
  root: import.meta.dirname,
  dev: process.argv.includes("--dev"),
  spa: true,
});

// Forward everything to Vite/SPA except API routes
server.setNotFoundHandler((req, reply) => {
  if (req.url.startsWith("/api")) {
    return reply.status(404).send({ error: "Not found" });
  }
  return reply.html();
});

// Bridge any CopilotKit runtime handler to a Fastify route handler
type RuntimeHandler = ReturnType<typeof copilotRuntimeNodeHttpEndpoint>;

function createBridgeHandler(handler: RuntimeHandler) {
  return async function (req: FastifyRequest, reply: FastifyReply) {
    try {
      const url = `http://${req.hostname}:3000${req.url}`;
      const headers = new Headers();
      for (const [key, val] of Object.entries(req.headers)) {
        if (val !== undefined) {
          if (Array.isArray(val)) {
            val.forEach((v) => headers.append(key, v));
          } else {
            headers.set(key, val);
          }
        }
      }

      const init: RequestInit = { method: req.method, headers };
      if (req.method !== "GET" && req.method !== "HEAD" && req.body) {
        init.body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
      }

      const webRequest = new Request(url, init);
      const response = (await handler(webRequest)) as Response;

      reply.status(response.status);
      for (const [key, value] of response.headers.entries()) {
        reply.header(key, value);
      }

      if (response.body) {
        const readable = Readable.fromWeb(response.body as any);
        readable.on("error", (err) => {
          console.error("[copilot] upstream stream error:", err.message);
          readable.destroy();
        });
        return reply.send(readable);
      }
      return reply.send(await response.text());
    } catch (err: any) {
      const code = err?.code ?? "";
      console.error(`[copilot] request failed (${code}):`, err.message);
      if (!reply.sent) {
        return reply.status(502).send({ error: "Agent connection failed" });
      }
    }
  };
}

server.all("/api/copilot", createBridgeHandler(runtimeHandler));

// Discover and mount ticket-specific CopilotKit endpoints
const ticketsDir = resolve(import.meta.dirname, "server/tickets");
const ticketDirs = readdirSync(ticketsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name.startsWith("tkt-"))
  .map((d) => d.name);
for (const ticketId of ticketDirs) {
  const mod = await import(`./server/tickets/${ticketId}/index.ts`);
  if (mod.handler) {
    const endpoint = `/api/tickets/${ticketId}/copilot`;
    server.all(endpoint, createBridgeHandler(mod.handler));
    // const bridged = createBridgeHandler(mod.handler);
    // server.all(endpoint, bridged);
    // server.all(`${endpoint}/*`, bridged);
    console.log(`[tickets] mounted ${endpoint}`);
  }
}

await server.vite.ready();
await server.listen({ port: 3000 });
