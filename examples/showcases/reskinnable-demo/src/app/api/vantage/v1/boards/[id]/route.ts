import * as store from "@/skins/vantage/data/store";

type Ctx = { params: Promise<{ id: string }> };

export const GET = async (_request: Request, { params }: Ctx) => {
  const { id } = await params;
  const board = store.findBoard(id);
  if (!board) {
    return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  return Response.json({ board });
};

export const PATCH = async (request: Request, { params }: Ctx) => {
  const { id } = await params;
  const patch = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const board = store.patchBoard(id, {
    pinned: typeof patch.pinned === "boolean" ? patch.pinned : undefined,
    notes: Array.isArray(patch.notes) ? (patch.notes as string[]) : undefined,
    note: typeof patch.note === "string" ? patch.note : undefined,
  });
  if (!board) {
    return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  return Response.json({ board });
};
