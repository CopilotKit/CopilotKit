import * as store from "@/skins/airline/data/store";
import { buildHotelConfirmationPdf } from "@/skins/airline/data/hotel-confirmation-pdf";
import { hotelConfirmationFor } from "@/skins/airline/data/hotel-confirmations";

/**
 * BEAT 3d — serves the hotel confirmation the demo attaches.
 *
 * Generated per request from the live ledger, so the document is always about a
 * trip the app still holds; see `hotel-confirmation-pdf.ts` for why this is not
 * a static file in `public/`.
 *
 * DEFAULTS TO CAMILA'S LIMA TRIP, which is the pill's own case. `?booking=` may
 * name a booking id or a PNR.
 */
const DEFAULT_BOOKING = "bkg-av1423";

/**
 * Resolves the `booking` lever, treating an absent value and an unusable one as
 * the same request.
 *
 * `searchParams.get("booking") ?? DEFAULT_BOOKING` would be wrong: `??` only
 * falls back on nullish, but `?booking=` — the shape a cleared field produces —
 * yields the EMPTY STRING, so the default would never apply and the route would
 * 404 on a booking nobody named. Downstream, `stageAttachment`
 * (`@/shell/attach`) maps the non-2xx to `staged === false`, which ABORTS the
 * pill — so the beat does not run at all, and the only clue is whatever this
 * route left in the log.
 */
const requestedBooking = (url: string): string =>
  new URL(url).searchParams.get("booking")?.trim() || DEFAULT_BOOKING;

/**
 * Why the WHOLE body is inside the `try`.
 *
 * This route is beat 3d's document source and the only place a failure here can
 * be diagnosed. `stageAttachment` treats any non-2xx as `staged === false` and
 * `sendMessageWithAttachment` then ABORTS the pill and alerts the presenter — so
 * the beat fails loudly rather than sending "read the attached confirmation"
 * with no file attached, which would leave the model to invent the document's
 * contents and the demo to prove the exact opposite of its point. But the alert
 * can only say "HTTP 500 — see the server logs", so if this handler leaves no
 * record the presenter is stuck. Three distinct throw sites live in here:
 * `new URL(...)`, `buildHotelConfirmationPdf`, and the `Response` constructor,
 * whose `content-disposition` interpolates a derived filename and rejects
 * anything outside ISO-8859-1.
 */
export const GET = async (req: Request) => {
  // Hoisted out of the `try` only so the `catch` can name it: it is the one
  // request-varying input, and therefore the only thing that distinguishes one
  // failing request from another in the log.
  let ref = DEFAULT_BOOKING;
  try {
    ref = requestedBooking(req.url);
    const resolved = hotelConfirmationFor({
      booking: store.findBooking(ref),
      flights: store.flights(),
      travelers: store.travelers(),
    });

    if (!resolved) {
      // A reseed that renames a booking, moves a flight to another city or
      // renames a traveler is otherwise an INVISIBLE way to disable beat 3d: the
      // pill fetches this route with no `booking` at all, so `DEFAULT_BOOKING`
      // stops resolving and the abort chain above fires with only "HTTP 404" to
      // show for it. `console.warn`, not `console.error`: this is a deliberate
      // domain answer, not a fault. See `hotelConfirmationFor` for the three
      // ways it declines.
      console.warn(
        `[airline/api] GET hotel-confirmation?booking=${ref} — no reservation ` +
          `the ledger still supports; bookings on file: ` +
          `${
            store
              .bookings()
              .map((b) => b.id)
              .join(", ") || "(none)"
          }`,
      );
      return Response.json(
        {
          error: "NOT_FOUND",
          message: "No hotel reservation is on file for that booking.",
        },
        { status: 404 },
      );
    }

    const pdf = buildHotelConfirmationPdf(resolved.entry);
    const filename = `hotel-confirmation-${resolved.entry.confirmationNumber.toLowerCase()}.pdf`;

    return new Response(pdf as BodyInit, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${filename}"`,
        // Never cache: the document is built from live ledger rows, and a cached
        // copy would go stale in exactly the way a static file would.
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    console.error(
      `[airline/api] GET hotel-confirmation?booking=${ref} failed:`,
      error,
    );
    return Response.json(
      {
        error: "SERVER_ERROR",
        message: "Could not build the hotel confirmation.",
      },
      { status: 500 },
    );
  }
};
