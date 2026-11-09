import * as store from "@/skins/myelin/data/store";
import {
  actorFrom,
  asStringArray,
  errorResponse,
  jsonBody,
} from "@/skins/myelin/data/http";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    return Response.json(store.journey((await params).id));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const body = await jsonBody(req);
    const journey = store.updateJourney(
      (await params).id,
      {
        name: typeof body.name === "string" ? body.name : undefined,
        description:
          typeof body.description === "string" ? body.description : undefined,
        audienceGroupIds: asStringArray(body.audienceGroupIds),
      },
      actorFrom(req),
    );
    return Response.json(journey);
  } catch (error) {
    return errorResponse(error);
  }
}
