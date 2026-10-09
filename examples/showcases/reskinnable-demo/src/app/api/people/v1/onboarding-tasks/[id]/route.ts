import type { NextRequest } from "next/server";
import * as store from "@/skins/people/data/store";
import { errorResponse } from "@/skins/people/data/http";

/** Tick a checklist item off — used by the Onboarding page's own checkboxes. */
export const PATCH = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const { id } = await params;
    const body = await req.json();
    const updated = store.setTaskDone(id, Boolean(body?.done));
    return Response.json(updated, { status: 200 });
  } catch (error) {
    return errorResponse(error, "PATCH onboarding-tasks/[id]");
  }
};
