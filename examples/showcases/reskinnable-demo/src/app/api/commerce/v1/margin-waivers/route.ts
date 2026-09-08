import type { NextRequest } from "next/server";
import * as store from "@/skins/commerce/data/store";
import { errorResponse } from "@/skins/commerce/data/http";

/**
 * BEAT 6, unlock step 1 — file a margin waiver against a promotion.
 *
 * Any code from the catalogue files successfully, including the DECOYS. That is
 * deliberate: a decoy is a real waiver, genuinely recorded in the history, that
 * simply does not satisfy trading policy. So a successful POST here proves
 * nothing about whether the gate will lift, and an agent that guessed a
 * plausible-sounding code still fails at the approve step.
 *
 * An unrecognized code is refused WITHOUT listing the valid ones.
 *
 * What a code alone does NOT buy is the waiver: a filing with no written
 * justification (or an unbounded one) is refused with `INVALID_JUSTIFICATION`.
 * That rule lives in the store, next to the catalogue, so it holds for the
 * merchandiser's filing panel as well as for the agent's tool — see
 * `normalizeJustification` in `data/waiver-codes.ts`. This route deliberately
 * does NOT `String()`-coerce the field on the way in: coercion is what would let
 * a non-string body arrive as text long enough to pass the floor.
 */
export const POST = async (req: NextRequest) => {
  try {
    const body = await req.json();
    const waiver = store.openMarginWaiver(
      String(body?.promotionId ?? ""),
      String(body?.code ?? ""),
      body?.justification,
    );
    return Response.json(waiver, { status: 201 });
  } catch (error) {
    return errorResponse(error, "POST margin-waivers");
  }
};
