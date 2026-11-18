import * as store from "@/skins/myelin/data/store";
import { actorFrom, errorResponse, jsonBody } from "@/skins/myelin/data/http";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  try {
    const body = await jsonBody(req);
    if (typeof body.message !== "string") throw new Error("INVALID_INPUT");
    return Response.json(
      store.notifyManagers((await params).id, body.message, actorFrom(req)),
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
