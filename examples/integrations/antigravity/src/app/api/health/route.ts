/**
 * Liveness for the Next.js app itself. Deliberately does not probe the agent:
 * this answers "is the web tier up", which is what the container healthcheck
 * and the smoke suite ask. The agent has its own /health on :8000.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok" });
}
