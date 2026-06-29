import { glassEngineAvailable } from "@/lib/glass-engine";
import {
  intelligenceEnabled,
  listRecalledMemories,
} from "@/lib/intelligence/memory";
import { resolveUserId } from "@/lib/intelligence/user-id";

/** The active role the panel passes so the proxy resolves the same identity the
 * runtime asserts (ignored when INTELLIGENCE_USER_ID is pinned). */
function roleFrom(request: Request): string | undefined {
  return request.headers.get("x-northwind-role") ?? undefined;
}

export async function GET(request: Request): Promise<Response> {
  // Security boundary: an un-opted-in deployment exposes no memory surface.
  if (!glassEngineAvailable()) {
    return new Response("Not Found", { status: 404 });
  }
  if (!intelligenceEnabled()) {
    return Response.json({ error: "intelligence_disabled" }, { status: 503 });
  }
  try {
    const memories = await listRecalledMemories(
      resolveUserId(roleFrom(request)),
    );
    return Response.json({ memories });
  } catch (err) {
    console.error("[api/memories] recall failed:", err);
    return Response.json({ error: "recall_failed" }, { status: 502 });
  }
}
