import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { searchXDiscourse } from "@/lib/x-search";
import { readCache, writeCache } from "@/lib/search-cache";

export const maxDuration = 300;

/**
 * Plain route behind the `searchX` FRONTEND tool.
 *
 * The search used to be a backend `ToolDefinition` on BuiltInAgent. Passing
 * backend tools alongside client-registered frontend tools stopped the frontend
 * tools from reaching the model — it reported them as "not available in my
 * current setup" and narrated instead of rendering. Every tool is a frontend
 * tool now; this endpoint is just where the search executes.
 */
export async function POST(req: NextRequest) {
  const { topic, fresh } = await req.json();
  if (!topic || typeof topic !== "string") {
    return NextResponse.json({ error: "topic required" }, { status: 400 });
  }

  // Cache hit skips the 45-75s search. The entry was written by a real search,
  // so what renders is identical to a live run.
  if (!fresh) {
    const hit = await readCache(topic);
    if (hit) {
      console.log(`[x-search] cache hit "${topic}" (captured ${hit.cachedAt})`);
      return NextResponse.json(hit);
    }
  }

  try {
    const report = await searchXDiscourse(topic);
    await writeCache(topic, report);
    return NextResponse.json(report);
  } catch (err) {
    console.error("[x-search] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "search failed" },
      { status: 500 },
    );
  }
}
