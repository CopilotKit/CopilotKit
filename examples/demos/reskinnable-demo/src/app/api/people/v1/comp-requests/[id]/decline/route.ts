import * as store from "@/skins/people/data/store";
import { errorResponse } from "@/skins/people/data/http";

/** Decline a comp request. Ungated — turning someone down never needs a band. */
export const POST = async (
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const { id } = await params;
    return Response.json(store.declineCompRequest(id), { status: 201 });
  } catch (error) {
    return errorResponse(error, "POST comp-requests/[id]/decline");
  }
};
