import type { NextRequest } from "next/server";
import * as store from "@/skins/people/data/store";
import { errorResponse } from "@/skins/people/data/http";

/** Approve or decline a queue request (time off, equipment, training, …). */
export const PATCH = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const { id } = await params;
    const body = await req.json();
    const status = body?.status;
    if (status !== "approved" && status !== "declined") {
      return Response.json(
        {
          error: "BAD_REQUEST",
          message: 'status must be "approved" or "declined".',
        },
        { status: 400 },
      );
    }
    const updated = store.decideRequest(id, status);
    return Response.json(updated, { status: 200 });
  } catch (error) {
    return errorResponse(error, "PATCH requests/[id]");
  }
};
