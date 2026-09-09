import * as store from "@/skins/people/data/store";
import { buildOfferLetterPdf } from "@/skins/people/data/offer-letter-pdf";

/**
 * BEAT 3d — serves the offer letter the demo attaches.
 *
 * Generated per request from the live employee record, so the start date in the
 * document always agrees with the seeded hire (whose dates are materialized
 * relative to now). See `offer-letter-pdf.ts` for why this is not a static file
 * in `public/`.
 *
 * Defaults to whoever is currently onboarding, so the letter follows the seed
 * rather than hard-coding a name that a future reseed could rename.
 */
export const GET = async (req: Request) => {
  const requested = new URL(req.url).searchParams.get("employeeId");
  const employee =
    (requested ? store.employee(requested) : undefined) ??
    store.employees().find((e) => e.status === "onboarding");

  if (!employee) {
    return Response.json(
      { error: "NOT_FOUND", message: "Nobody is onboarding right now." },
      { status: 404 },
    );
  }

  const manager = employee.managerId
    ? store.employee(employee.managerId)
    : undefined;
  const pdf = buildOfferLetterPdf({
    name: employee.name,
    title: employee.title,
    level: employee.level,
    team: employee.team,
    managerName: manager?.name ?? "the hiring manager",
    location: employee.location,
    startDate: employee.startDate,
  });

  return new Response(pdf as BodyInit, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="offer-letter-${employee.name
        .toLowerCase()
        .replace(/\s+/g, "-")}.pdf"`,
      // Never cache: the start date is computed from `now`, and a cached copy
      // would quietly go stale in exactly the way a static file would.
      "cache-control": "no-store",
    },
  });
};
