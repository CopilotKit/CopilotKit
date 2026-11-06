import { insertBatch, openLearningDb, parseBatch } from "@/lib/learning-db";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 256 * 1024;

let db: ReturnType<typeof openLearningDb> | undefined;

/** Local sink for the learning demo: stores each batch from the browser collector in SQLite. */
export async function POST(request: Request) {
  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) {
    return Response.json({ error: "Batch too large" }, { status: 413 });
  }

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return Response.json({ error: "Body is not JSON" }, { status: 400 });
  }

  const batch = parseBatch(json);
  if (batch === null) {
    return Response.json({ error: "Body is not a batch" }, { status: 400 });
  }

  db ??= openLearningDb();
  const inserted = insertBatch(db, batch);
  return Response.json({ inserted });
}
