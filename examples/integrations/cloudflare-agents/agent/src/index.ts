/**
 * The Worker's entry point.
 *
 * The Next.js app posts every run to /agents/assistant with a plain
 * `HttpAgent`. `toThreadRequest` moves the thread id from the request body
 * into the path, and the Agents SDK's `routeAgentRequest` hands
 * /agents/assistant/<thread id> to that thread's Durable Object, which streams
 * the run back as server-sent events.
 */
import { routeAgentRequest } from "agents";
import { toThreadRequest } from "@ag-ui/cloudflare-agents";
import type { Env } from "./agent";

export { Assistant } from "./agent";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ status: "ok" });
    }
    return (
      (await routeAgentRequest(await toThreadRequest(request), env)) ??
      new Response("Not found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
