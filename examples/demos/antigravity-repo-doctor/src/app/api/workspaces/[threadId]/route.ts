import { serverEnv } from "@/lib/env";

/**
 * Deletes a conversation's working files: its local folders, its harness
 * history and its folder in the Cloud Storage bucket. The thread list calls
 * this after Intelligence deleted the thread. The agent itself only listens on
 * 127.0.0.1, so this route is the one way in.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const { threadId } = await params;
  const url = new URL(
    `threads/${encodeURIComponent(threadId)}/workspace`,
    serverEnv().AGENT_URL,
  );
  try {
    const response = await fetch(url, {
      method: "DELETE",
      signal: AbortSignal.timeout(30_000),
    });
    return Response.json(
      { ok: response.ok },
      { status: response.ok ? 200 : 502 },
    );
  } catch {
    return Response.json({ ok: false }, { status: 502 });
  }
}
