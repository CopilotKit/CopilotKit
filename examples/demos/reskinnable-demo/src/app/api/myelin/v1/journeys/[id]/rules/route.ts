import * as store from "@/skins/myelin/data/store";
import { actorFrom, errorResponse, jsonBody } from "@/skins/myelin/data/http";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  try {
    const body = await jsonBody(req);
    if (typeof body.rule !== "string") throw new Error("INVALID_INPUT");
    return Response.json(
      store.applyAudienceRule((await params).id, body.rule, actorFrom(req)),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
