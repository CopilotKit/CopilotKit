import type { NextRequest } from "next/server";
import * as store from "@/skins/commerce/data/store";
import { errorResponse, readJsonBody } from "@/skins/commerce/data/http";

/**
 * Approve or decline a return request from the Returns desk.
 *
 * The body is decoded by `readJsonBody` BEFORE the `try` opens, so an unreadable
 * one is a deliberate 400 naming the return rather than a `SyntaxError` that
 * `errorResponse` cannot tell apart from a store defect.
 */
export const PATCH = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const parsed = await readJsonBody(req, "PATCH returns/[id]", id);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  try {
    const status = String(body.status ?? "");
    if (status !== "approved" && status !== "declined") {
      return Response.json(
        { error: "BAD_REQUEST", message: "Unknown return status." },
        { status: 400 },
      );
    }
    return Response.json(store.decideReturn(id, status), { status: 200 });
  } catch (error) {
    return errorResponse(error, `PATCH returns/[id] id=${id}`);
  }
};
