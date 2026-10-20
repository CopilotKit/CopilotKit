import * as store from "@/skins/myelin/data/store";
import { actorFrom, errorResponse, jsonBody } from "@/skins/myelin/data/http";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  try {
    const body = await jsonBody(req);
    return Response.json(
      store.setEnrollmentWindow(
        (await params).id,
        Number(body.days),
        actorFrom(req),
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
