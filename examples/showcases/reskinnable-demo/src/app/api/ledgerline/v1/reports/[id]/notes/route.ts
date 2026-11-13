import * as store from "@/skins/ledgerline/data/store";
import { errorResponse, readJson } from "@/skins/ledgerline/data/http";

export const POST = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const { text } = await readJson(req);
    return Response.json(store.addNote((await params).id, String(text ?? "")));
  } catch (error) {
    return errorResponse(error, "POST reports/[id]/notes");
  }
};
