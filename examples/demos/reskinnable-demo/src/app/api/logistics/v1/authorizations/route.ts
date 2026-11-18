import * as store from "@/skins/logistics/data/store";
import { findOption } from "@/skins/logistics/data/mitigation-options";
import { checkAuthority } from "@/skins/logistics/data/authority";
import { readPlannerPin } from "@/skins/logistics/data/planner-pin";

/**
 * BEAT 3a — the PIN-confirmed release of a mitigation.
 *
 * The planner types their approval PIN into a card in the chat and this route
 * receives it directly; the agent's `respond()` only ever gets the confirmation
 * sentence the card composes afterwards. The PIN is never echoed back in any
 * response body either — a refusal says "not accepted", never what was typed.
 *
 * ⚠️ THE PIN IS A SECOND FACTOR, NOT AN AUTHORITY OVERRIDE. It confirms WHO is
 * acting; it never changes HOW MUCH they may spend. So this route runs the SAME
 * `checkAuthority()` gate as `/shipments/:id/mitigate` on a cost it recomputes
 * itself, and a valid PIN on an over-authority option is still refused with
 * `OVER_AUTHORITY`. If a PIN could release an over-authority cost it would
 * become a second unlock path around beat 6's escalation gate — the agent would
 * route around the gate, the teach arc would never fire, and NOTHING would fail.
 * `route.test.ts` pins that separation; it is the only symptom the failure has.
 *
 * Cost is recomputed here from lane + shipment, exactly as the mitigate route
 * does: any `costUsd` in the body is ignored, or the gate would be theater.
 *
 * ⚠️ PIN VALIDITY IS FORMAT-ONLY, BY DESIGN — READ THIS BEFORE TRUSTING IT.
 * There is NO secret to match against: no planner carries a PIN or a digest in
 * the seed, so ANY six digits are accepted, for any planner. `readPlannerPin`
 * checks the SHAPE and nothing else, and `INVALID_PIN` means "not six digits",
 * never "wrong PIN". That is deliberate for a stage demo — a memorized number is
 * a thing to fumble on stage, and the beat's claim is about WHERE the value
 * travels (never into the transcript), not about authenticating anyone. Nothing
 * here is an authentication control; the real control on this route is
 * `checkAuthority()` below. If this app ever needs a genuine second factor, that
 * is a per-planner secret plus a constant-time comparison, and this comment is
 * the thing to delete.
 */
export const POST = async (req: Request) => {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json(
      { error: "BAD_REQUEST", message: "A JSON body is required." },
      { status: 400 },
    );
  }
  const { shipment: ref, kind, pin, rationale, plannerId } = body;

  // THE PIN IS CHECKED FIRST, before anything that reads the ledger. It is only
  // a format check (see the header), but the 404 and 422 below are ANSWERS: they
  // tell an unauthenticated caller which shipments exist and which mitigations
  // are available on them. Refusing an unreadable request before consulting the
  // store means those answers are never handed out for free. The SAME predicate
  // the card's submit button compared against — imported, not restated, so the
  // server cannot drift into accepting a shape the card refuses (or refusing one
  // it invited).
  const verdict = readPlannerPin(typeof pin === "string" ? pin : "");
  if (!verdict.ok) {
    return Response.json(
      // Never echo what was typed.
      { error: "INVALID_PIN", message: "That PIN was not accepted." },
      { status: 401 },
    );
  }

  if (!plannerId) {
    return Response.json(
      { error: "BAD_REQUEST", message: "plannerId is required." },
      { status: 400 },
    );
  }
  const planner = store.findPlanner(plannerId);
  if (!planner) {
    return Response.json(
      { error: "BAD_REQUEST", message: "Unknown planner." },
      { status: 400 },
    );
  }

  // The card sends the human-facing reference (PO-88213); accept the id too.
  const shipment = store
    .shipments()
    .find((s) => s.id === ref || s.reference === ref);
  if (!shipment) {
    return Response.json(
      { error: "NOT_FOUND", message: "Shipment not found." },
      { status: 404 },
    );
  }

  const option = findOption(shipment, store.lanes(), kind);
  if (!option) {
    return Response.json(
      {
        error: "UNAVAILABLE_OPTION",
        message: `"${kind}" is not an available mitigation for this shipment.`,
      },
      { status: 422 },
    );
  }

  const authority = checkAuthority({
    costUsd: option.costUsd,
    planner,
    shipment,
    escalations: store.escalations(),
  });
  if (!authority.allowed) {
    return Response.json(
      { error: authority.code, message: authority.message },
      { status: 403 },
    );
  }

  const updated = store.updateShipment(shipment.id, {
    appliedMitigation: {
      kind: option.kind,
      costUsd: option.costUsd,
      decidedAt: new Date().toISOString(),
    },
    status: option.slaMet ? "resolved" : "at_risk",
    etaCurrent: option.etaDate,
  });
  store.addDecision({
    shipmentId: shipment.id,
    kind: option.kind,
    costUsd: option.costUsd,
    rationale: rationale ?? `PIN-authorized by ${planner.name}.`,
    decidedBy: planner.name,
    role: planner.role,
    status: "committed",
  });
  return Response.json({ shipment: updated, option });
};
