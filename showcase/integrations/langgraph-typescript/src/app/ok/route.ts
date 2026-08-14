import { NextResponse } from "next/server";

/**
 * Liveness probe served at `/ok`, mirroring `/api/health` exactly.
 *
 * Why a second path: this container runs TWO processes — Next.js on `$PORT`
 * and the LangGraph agent on `$AGENT_PORT`. Railway's `healthcheckPath` hits
 * Next.js, so it must stay valid both now and after the Next.js half is
 * deleted and the agent becomes the only listener.
 *
 * The other showcase integrations solve that by teaching THEIR agent to also
 * answer `/api/health`. That is not possible here: the agent is the
 * third-party `@langchain/langgraph-api` server started by
 * `src/agent/server.mjs`, which owns its own routing and natively serves
 * `/ok` (not `/health`, and not `/api/health`). Adding a route to it would
 * mean introducing a custom `http.app` in `langgraph.json` — an architecture
 * change, not a no-op.
 *
 * So the path moves the other way: Next.js learns the agent's path instead.
 * With both processes answering `/ok`, `healthcheckPath` can be flipped from
 * `/api/health` to `/ok` at any time, with no ordering hazard, and it keeps
 * working unchanged once only the agent remains.
 *
 * Body matches `src/app/api/health/route.ts`. The agent's native `/ok` (and
 * the `src/agent/liveness.mjs` sidecar on :8124) return different payloads;
 * the contract that matters to Railway is the 200.
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    integration: "langgraph-typescript",
    timestamp: new Date().toISOString(),
  });
}
