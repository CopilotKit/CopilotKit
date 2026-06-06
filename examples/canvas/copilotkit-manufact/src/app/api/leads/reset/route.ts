import { NextResponse } from "next/server";
import { unlink } from "node:fs/promises";
import path from "node:path";

/**
 * Reset the bundled local lead store back to the seed.
 *
 * The agent's `LocalJsonStore` writes user edits to
 * `agent/data/leads.local.json`. This route deletes that file; the next
 * `fetch_notion_leads` call materializes it again from the committed
 * `agent/data/leads.seed.json`. Effectively a "reload starter data" button.
 *
 * Returns:
 * - 204 on success (or when no local file exists — idempotent).
 * - 409 when Notion is the active store. We don't try to clear Notion
 *   data; that's destructive and out of scope for a hackathon kit.
 * - 500 only on filesystem errors that aren't "file already gone".
 *
 * Why a Next.js route instead of an agent endpoint: `langgraph dev`
 * serves only the graph, not custom HTTP routes, and the BFF runs in a
 * separate process. The Next.js server already has access to the same
 * filesystem and the UI button calling this route is the closest thing
 * to a control surface the user has. In production you'd point this at
 * a real management API.
 */
export async function DELETE(): Promise<Response> {
  // When the user has wired Notion, there is no local cache to clear.
  // Refuse explicitly so the UI button can show a clear error toast
  // rather than silently appearing to do something.
  if (process.env.NOTION_TOKEN && process.env.NOTION_LEADS_DATABASE_ID) {
    return NextResponse.json(
      {
        error: "notion-active",
        message:
          "Notion is the active lead store; nothing to reset locally. " +
          "Unset NOTION_TOKEN or NOTION_LEADS_DATABASE_ID to switch to local mode.",
      },
      { status: 409 },
    );
  }

  // The agent and the Next.js app are sibling processes started from the
  // same project root. `cwd()` is the Next.js root (v2a-notion-lead-form),
  // so the local cache sits at `agent/data/leads.local.json` — relative
  // path resolves the same way in dev (npm run dev) and prod (next start).
  const localPath = path.join(
    process.cwd(),
    "agent",
    "data",
    "leads.local.json",
  );

  try {
    await unlink(localPath);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      // Nothing to delete — already in the seed state. Idempotent OK.
      return new NextResponse(null, { status: 204 });
    }
    return NextResponse.json(
      {
        error: "unlink-failed",
        message: `Could not delete ${localPath}: ${(err as Error).message}`,
      },
      { status: 500 },
    );
  }
}
