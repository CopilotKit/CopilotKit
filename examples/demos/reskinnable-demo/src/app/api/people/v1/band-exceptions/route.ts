import type { NextRequest } from "next/server";
import * as store from "@/skins/people/data/store";
import { errorResponse } from "@/skins/people/data/http";

/**
 * BEAT 6, unlock step 1 — file a band exception against a comp request.
 *
 * Any code from the catalogue files successfully, including the DECOYS. That is
 * deliberate: a decoy is a real exception, genuinely recorded in the history,
 * that simply does not satisfy comp policy. So a successful POST here proves
 * nothing about whether the gate will lift, and an agent that guessed a
 * plausible-sounding code still fails at the approve step.
 *
 * An unrecognized code is refused WITHOUT listing the valid ones.
 */
export const POST = async (req: NextRequest) => {
  try {
    const body = await req.json();
    const exception = store.openBandException(
      String(body?.compRequestId ?? ""),
      String(body?.code ?? ""),
      String(body?.justification ?? "").trim(),
    );
    return Response.json(exception, { status: 201 });
  } catch (error) {
    return errorResponse(error, "POST band-exceptions");
  }
};
