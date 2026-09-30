import * as store from "@/skins/myelin/data/store";
import {
  actorFrom,
  asStringArray,
  errorResponse,
  jsonBody,
} from "@/skins/myelin/data/http";

type Ctx = { params: Promise<{ id: string; itemId: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const { id, itemId } = await params;
    const body = await jsonBody(req);
    const updated = store.updateItem(
      id,
      itemId,
      {
        title: typeof body.title === "string" ? body.title : undefined,
        kind: typeof body.kind === "string" ? body.kind : undefined,
        minutes: body.minutes === undefined ? undefined : Number(body.minutes),
        delayDays:
          body.delayDays === undefined ? undefined : Number(body.delayDays),
        required:
          typeof body.required === "boolean" ? body.required : undefined,
        dependsOn: asStringArray(body.dependsOn),
      },
      actorFrom(req),
    );
    return Response.json(updated);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const { id, itemId } = await params;
    store.removeItem(id, itemId, actorFrom(req));
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
