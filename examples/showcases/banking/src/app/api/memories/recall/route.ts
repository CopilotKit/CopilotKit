import { glassEngineAvailable } from "@/lib/glass-engine";
import { intelligenceEnabled, recallMemories } from "@/lib/intelligence/memory";
import { resolveUserId } from "@/lib/intelligence/user-id";

export async function POST(request: Request): Promise<Response> {
  if (!glassEngineAvailable()) {
    return new Response("Not Found", { status: 404 });
  }
  if (!intelligenceEnabled()) {
    return Response.json({ error: "intelligence_disabled" }, { status: 503 });
  }
  let body: { query?: unknown; scope?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) return Response.json({ memories: [] });
  const scope = typeof body.scope === "string" ? body.scope : undefined;
  const identity = {
    memberId: request.headers.get("x-northwind-user-id") ?? undefined,
    role: request.headers.get("x-northwind-role") ?? undefined,
  };
  try {
    const memories = await recallMemories(
      resolveUserId(identity),
      query,
      scope,
    );
    return Response.json({ memories });
  } catch (err) {
    console.error("[api/memories/recall] failed:", err);
    return Response.json({ error: "recall_failed" }, { status: 502 });
  }
}
