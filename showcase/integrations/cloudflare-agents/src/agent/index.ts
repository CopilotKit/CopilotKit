/**
 * The Cloudflare Agents showcase Worker.
 *
 * Each backend is an Agents SDK agent (./agents.ts) and each AG-UI thread is
 * one instance of it, a Durable Object. The Next.js routes post every run to
 * `/agents/<agent>` with a plain `HttpAgent`; `toThreadRequest` moves the
 * thread id from the body into the path, and the Agents SDK's
 * `routeAgentRequest` hands `/agents/<agent>/<threadId>` to that thread's
 * Durable Object, which streams the run back over SSE.
 *
 * `wrangler dev` runs it on workerd in the showcase container (:8000).
 */
import { routeAgentRequest } from "agents";
import { toThreadRequest } from "@ag-ui/cloudflare-agents";
import type { Env } from "./agents";
import { withCvdiag } from "./cvdiag";
import { chatModelId } from "./model";

export {
  A2uiFixedSchema,
  A2uiRecovery,
  BeautifulChat,
  ByocHashbrown,
  ByocJsonRender,
  DeclarativeGenUi,
  Interrupt,
  Reasoning,
  ReasoningChain,
  Showcase,
  Voice,
} from "./agents";

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ status: "ok" });
    }
    return withCvdiag(
      request,
      env,
      ctx,
      {
        slug: "cloudflare-agents",
        agentName: url.pathname.split("/")[2] ?? "unknown",
        provider: "openai",
        modelId: chatModelId(env),
      },
      async (req) =>
        (await routeAgentRequest(await toThreadRequest(req), env)) ??
        new Response("Not found", { status: 404 }),
    );
  },
} satisfies ExportedHandler<Env>;
