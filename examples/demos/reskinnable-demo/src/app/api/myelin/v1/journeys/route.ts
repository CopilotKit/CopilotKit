import * as store from "@/skins/myelin/data/store";
import {
  actorFrom,
  asStringArray,
  errorResponse,
  jsonBody,
} from "@/skins/myelin/data/http";

export async function POST(req: Request) {
  try {
    const body = await jsonBody(req);
    if (typeof body.name !== "string") throw new Error("INVALID_INPUT");
    const journey = store.createJourney(
      {
        name: body.name,
        description:
          typeof body.description === "string" ? body.description : undefined,
        audienceGroupIds: asStringArray(body.audienceGroupIds),
      },
      actorFrom(req),
    );
    return Response.json(journey, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
