import * as store from "@/skins/myelin/data/store";
import { errorResponse, jsonBody } from "@/skins/myelin/data/http";

export async function POST(req: Request) {
  try {
    const body = await jsonBody<{
      adminId?: unknown;
      page?: unknown;
      journeyId?: unknown;
    }>(req);
    if (typeof body.adminId !== "string" || typeof body.page !== "string")
      throw new Error("INVALID_INPUT");
    store.heartbeat({
      adminId: body.adminId,
      page: body.page.slice(0, 80),
      journeyId: typeof body.journeyId === "string" ? body.journeyId : null,
    });
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
