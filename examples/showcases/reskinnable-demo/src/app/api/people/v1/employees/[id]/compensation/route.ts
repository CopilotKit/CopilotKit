import type { NextRequest } from "next/server";
import * as store from "@/skins/people/data/store";
import { errorResponse } from "@/skins/people/data/http";

/**
 * BEAT 3a — a merit increase.
 *
 * The figure arrives here from the chat card the USER typed it into, over a
 * plain fetch from the browser. It was never a tool argument the model authored
 * and it is never written back into the transcript: the frontend tool's
 * `respond()` returns only a label ("Base salary updated for Priya Raman"). The
 * response body below is read by the CLIENT to refresh the roster, not by the
 * agent.
 *
 * The in-band check here is the same rule beat 6's gate enforces on comp
 * requests. That is intentional — one policy, two entry points — but note the
 * difference in framing: this path is for adjustments a People Ops lead makes
 * inside the band, so a rejection is a plain validation error, not the
 * teachable gate.
 */
export const PATCH = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const { id } = await params;
    const body = await req.json();
    const salary = Number(body?.baseSalary);
    const updated = store.setBaseSalary(id, salary);
    return Response.json(updated, { status: 200 });
  } catch (error) {
    return errorResponse(error, "PATCH employees/[id]/compensation");
  }
};
