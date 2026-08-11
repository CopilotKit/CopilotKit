import "reflect-metadata";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { createFinanceAgent } from "@/lib/finance-agent";

/**
 * CopilotKit **v2 / AG-UI** runtime endpoint for the Personal Finance Copilot app.
 *
 * The React Native client (`@copilotkit/react-native` → `@copilotkit/core` →
 * `@ag-ui/client`) speaks the AG-UI HTTP protocol against SUB-PATHS of this
 * endpoint:
 *   - GET  /api/copilotkit/info                  (capability discovery)
 *   - POST /api/copilotkit/agent/default/run     (stream a run)
 *   - POST /api/copilotkit/agent/default/connect (resume/connect a thread)
 *
 * TWO things are required and were the source of earlier 404/405s:
 *   1. Mount at an OPTIONAL CATCH-ALL route (`[[...all]]/route.ts`) so every
 *      sub-path reaches this handler (a plain `route.ts` 404s sub-paths).
 *   2. Use the **v2** fetch handler `createCopilotRuntimeHandler` (+ the v2
 *      `CopilotRuntime`). The v1 `copilotRuntimeNextJSAppRouterEndpoint` does
 *      NOT serve the AG-UI routes and returns 405 for `GET /info`.
 *
 * `createCopilotRuntimeHandler` returns a Web `(Request) => Response` handler;
 * it strips `basePath` itself, so we hand it the raw request for every method.
 * (The Hono adapter would need the `hono` package, which isn't installed here.)
 */

// CopilotKit's runtime relies on Node APIs; force the Node.js runtime.
export const runtime = "nodejs";
// Streamed AG-UI responses must not be statically cached.
export const dynamic = "force-dynamic";

const copilotRuntime = new CopilotRuntime({
  agents: {
    // Must match `agentId: "default"` used by the RN client's useAgent().
    default: createFinanceAgent(),
  },
});

const handler = createCopilotRuntimeHandler({
  runtime: copilotRuntime,
  basePath: "/api/copilotkit",
  mode: "multi-route",
});

const handle = (req: Request): Response | Promise<Response> => handler(req);

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
export const OPTIONS = handle;
