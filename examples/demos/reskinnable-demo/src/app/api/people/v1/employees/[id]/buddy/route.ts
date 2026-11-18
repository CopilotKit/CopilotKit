import type { NextRequest } from "next/server";
import * as store from "@/skins/people/data/store";
import { errorResponse } from "@/skins/people/data/http";

/** BEAT 5, step 2 — assign an onboarding buddy. */
export const POST = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const { id } = await params;
    const body = await req.json();
    const updated = store.assignBuddy(id, String(body?.buddyId ?? ""));
    return Response.json(updated, { status: 201 });
  } catch (error) {
    return errorResponse(error, "POST employees/[id]/buddy");
  }
};
