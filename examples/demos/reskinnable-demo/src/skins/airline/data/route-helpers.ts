/**
 * The two things every Aeronova write route does before it does anything else:
 * read a JSON body, and resolve the booking the caller named.
 *
 * Shared rather than copied because five routes do both, and two copies of the
 * ambiguity rule would be two different opinions about what "change AV7QK2"
 * means when the passenger holds two legs on that PNR. See `resolveBooking`.
 *
 * Server-safe: plain TypeScript, no React, no JSX, no `"use client"`.
 */

import * as store from "./store";
import type { Booking } from "./trip-types";

export const jsonError = (
  error: string,
  message: string,
  status: number,
): Response => Response.json({ error, message }, { status });

/** `null` when the request carried no readable JSON object. */
export const readJsonObject = async (
  req: Request,
): Promise<Record<string, unknown> | null> => {
  const body = await req.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
};

export type BookingOrResponse =
  | { ok: true; booking: Booking }
  | { ok: false; response: Response };

/**
 * Resolve the booking a route was called for, or the exact refusal to return.
 *
 * `AMBIGUOUS_REFERENCE` names the candidate ids so the caller can retry with an
 * exact one. That is not a vocabulary leak: booking ids are already all over the
 * ledger, and the alternative — picking the first leg — reissues the wrong
 * flight while reporting success.
 */
export const resolveBookingOr404 = (ref: string): BookingOrResponse => {
  const lookup = store.resolveBooking(ref);
  if (lookup.ok) return { ok: true, booking: lookup.booking };
  if (lookup.error === "AMBIGUOUS_REFERENCE") {
    return {
      ok: false,
      response: Response.json(
        {
          error: "AMBIGUOUS_REFERENCE",
          message:
            `More than one booking is held under "${ref}". Name one of them ` +
            `exactly.`,
          matches: lookup.matches,
        },
        { status: 409 },
      ),
    };
  }
  return {
    ok: false,
    response: jsonError("NOT_FOUND", "No such booking.", 404),
  };
};
