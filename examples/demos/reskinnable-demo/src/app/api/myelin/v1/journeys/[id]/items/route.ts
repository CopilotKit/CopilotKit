import * as store from "@/skins/myelin/data/store";
import {
  actorFrom,
  asStringArray,
  errorResponse,
  jsonBody,
} from "@/skins/myelin/data/http";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  try {
    const body = await jsonBody(req);
    if (typeof body.title !== "string" || typeof body.kind !== "string")
      throw new Error("INVALID_INPUT");
    const created = store.addItem(
      (await params).id,
      {
        title: body.title,
        kind: body.kind,
        minutes: Number(body.minutes),
        dependsOn: asStringArray(body.dependsOn),
        delayDays: body.delayDays === undefined ? 0 : Number(body.delayDays),
        required: typeof body.required === "boolean" ? body.required : true,
      },
      actorFrom(req),
    );
    return Response.json(created, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
