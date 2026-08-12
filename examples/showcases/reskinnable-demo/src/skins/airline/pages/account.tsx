"use client";

/**
 * Camila's account — the REST ledger's face.
 *
 * ⚠️ THIS PAGE IS WHERE AN OPS-CONSOLE REFRAME WOULD CREEP BACK IN, so the shape
 * is deliberate. Aeronova is ONE traveller's account and the user is a passenger
 * looking at their own trips — never an irregular-operations control desk. See
 * `data/beat-map.md` § "Where the passenger framing genuinely fights the beats",
 * point 3, which names this page: the profile must read as visibly Camila's
 * rather than letting the trips page read as an agency console.
 *
 * Three structural choices do that work, and none of them is cosmetic:
 *
 *  1. **The account holder is the page's subject, by name, in the header.** Not
 *     "Travellers (3)". The tier, member number, join date and card on file are
 *     HERS, stated once at the top, so everything below is read as belonging to
 *     the person whose account this is.
 *  2. **Her trips come first, under "Your trips", in the second person.** A
 *     board sorted by urgency across three people is an ops queue no matter what
 *     it is called.
 *  3. **The companions are SAVED TRAVELLERS, nested under their own named cards
 *     with their relationship to Camila.** "Tomás Aguirre — your partner",
 *     holding trips "booked on your account". Never a traveller COLUMN in a
 *     shared table, which is exactly what would turn them into a customer list.
 *
 * If a future edit flattens these three sections into one table with a traveller
 * column, the skin has quietly become an agency console again.
 *
 * REACHABLE: `skin.tsx` routes this page through `resolveAirlinePage` and mounts
 * the ledger through `providers.tsx`.
 */

import { useMemo } from "react";
import { useAgentContext } from "@copilotkit/react-core/v2";
import { useAirlineLedger } from "../ledger-context";
import { buildAccountTrips, TripList } from "../components/trip-list";
import type { AccountTrip } from "../components/trip-list";
import { FareExceptionForm } from "../components/fare-exception-form";

const TIER_LABEL: Record<string, string> = {
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
  platinum: "Platinum",
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "March 2014" from "2014-03-19". Parsed off the string, never through `Date`. */
function memberSinceLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(String(iso ?? "").trim());
  if (!m) return "";
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${m[1]}` : "";
}

/** The readable's row shape. One mapper, used for every list on the page. */
const describeTrip = (trip: AccountTrip) => ({
  confirmation: trip.reference,
  flight: trip.flightNumber,
  route: trip.route,
  departs_local: trip.departsLocal,
  status: trip.statusLabel,
  fare: trip.fareLabel,
  changeable: trip.changeable,
  seat: trip.seat,
  // Prose the passenger reads on their own booking. Beat 6's learned procedure
  // is "read what the booking documents, then file the category that matches
  // it", so these sentences have to reach the agent — and they are deliberately
  // free of catalogue vocabulary, which is why they can. See `trip-types.ts`'s
  // `fareNotes` and `store.snapshot()`, which strips the code-shaped
  // `waiverGround` for exactly this reason.
  notes: trip.notes,
});

export function AccountPage() {
  const { ready, profile, travelers, bookings, flights } = useAirlineLedger();

  // ONE memo. Every list the page paints and every list the readable reports
  // comes out of here, so the two cannot disagree — the commerce failure that
  // demo-beats.md § 3b calls out (a readable slicing 5 against a panel showing
  // 6, which the agent then narrates wrongly and silently).
  const { holder, yourTrips, companionGroups, totalTrips } = useMemo(() => {
    const accountHolder = travelers.find((t) => t.accountHolder) ?? null;
    const own = accountHolder
      ? buildAccountTrips(bookings, flights, accountHolder)
      : [];
    const groups = travelers
      .filter((t) => !t.accountHolder)
      .map((traveler) => ({
        traveler,
        trips: buildAccountTrips(bookings, flights, traveler),
      }));
    return {
      holder: accountHolder,
      yourTrips: own,
      companionGroups: groups,
      totalTrips:
        own.length + groups.reduce((sum, g) => sum + g.trips.length, 0),
    };
  }, [travelers, bookings, flights]);

  // ── BEAT 3b, part 2 — what is VISIBLY on this screen ─────────────────────
  // The nesting MIRRORS the page: the account holder's own trips under
  // `your_trips`, the companions' under `saved_travellers[].trips`. That is not
  // decoration either — a flat row list with a traveller field would invite the
  // agent to describe this screen as a queue of three people, which is the
  // framing this page exists to prevent.
  //
  // `loading` is reported rather than inferred: before the first fetch settles
  // the ledger is legitimately empty, and an agent told "0 trips" about a screen
  // that is still spinning describes it wrongly with total confidence.
  //
  // ONE MECHANICAL CONSTRAINT before rewording any of this: `readables.test.tsx`
  // anchors its omission guard on a `useAgentContext(` window terminated by the
  // statement's own semicolon, so a SEMICOLON in the description below ends that
  // window early and fails the guard for reasons the message will not explain.
  // Use dashes and full stops.
  useAgentContext({
    description:
      "What is on the account screen right now. This is ONE traveller's " +
      "account — `account` is its holder, `your_trips` are her own bookings, " +
      "and `saved_travellers` are the companions saved on her profile with the " +
      "trips booked for them. It is not a queue of customers. `visible` is the " +
      "total number of trip rows on screen. `loading` is true while the first " +
      "read is still in flight — say so rather than reporting an empty account.",
    value: JSON.stringify({
      page: "Your account",
      loading: !ready,
      account: holder
        ? {
            holder: holder.name,
            member_id: holder.memberId,
            tier: holder.tier,
            home_timezone: holder.homeTimezone,
            member_since: profile?.memberSince ?? null,
            payment_card: profile?.paymentCardLabel ?? null,
          }
        : null,
      visible: totalTrips,
      your_trips: yourTrips.map(describeTrip),
      saved_travellers: companionGroups.map(({ traveler, trips }) => ({
        name: traveler.name,
        relationship: traveler.relationship,
        tier: traveler.tier,
        trips: trips.map(describeTrip),
      })),
    }),
  });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      {/* 1. The account is HERS, and says so before anything else. */}
      <header>
        <h1 className="text-2xl font-bold text-ink">Your account</h1>
        {holder ? (
          <>
            <p className="mt-1 text-lg font-semibold text-ink">{holder.name}</p>
            <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-ink-muted">
              <span>
                Aeronova Club {TIER_LABEL[holder.tier] ?? holder.tier}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">{holder.memberId}</span>
              {profile?.memberSince && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>
                    Member since {memberSinceLabel(profile.memberSince)}
                  </span>
                </>
              )}
              {profile?.paymentCardLabel && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{profile.paymentCardLabel}</span>
                </>
              )}
            </p>
          </>
        ) : (
          <p className="mt-1 text-sm text-ink-muted">
            {ready ? "No account on file." : "Loading your account…"}
          </p>
        )}
      </header>

      {/* 2. Her own trips, first, in the second person. */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
          Your trips
        </h2>
        <TripList
          label="Your trips"
          trips={yourTrips}
          empty={ready ? "You have no upcoming trips." : "Loading your trips…"}
        />
      </section>

      {/* 3. The companions — saved travellers on HER profile, each under their
             own card with their relationship to her, never a shared table with
             a traveller column. */}
      {companionGroups.length > 0 && (
        <section className="flex flex-col gap-4">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
              Saved travellers
            </h2>
            <p className="mt-1 text-xs text-ink-muted">
              People you book for. Their trips sit on your account, and you can
              manage them here.
            </p>
          </div>

          {companionGroups.map(({ traveler, trips }) => (
            <div
              key={traveler.id}
              className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surface-muted/40 p-4"
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <h3 className="text-sm font-semibold text-ink">
                  {traveler.name}
                </h3>
                <span className="text-xs text-ink-muted">
                  your {traveler.relationship.toLowerCase()} · Aeronova Club{" "}
                  {TIER_LABEL[traveler.tier] ?? traveler.tier}
                </span>
              </div>
              <TripList
                label={`Trips booked for ${traveler.name}`}
                trips={trips}
                empty={`No trips booked for ${traveler.name}.`}
              />
            </div>
          ))}
        </section>
      )}

      {/* BEAT 6 — the filing form. It sits on THIS page because this is the page
          that already shows every ticket's fare condition, so a refused reissue
          and the way to have it reconsidered are read in one place.

          ⚠️ IT IS THE ONE PLACE THE WAIVER VOCABULARY MAY APPEAR, and it is not
          leaked to the agent by being here: the readable above reports each
          booking's `notes` (the passenger-facing `fareNotes` prose) and never a
          category. The form's <select> is DOM, not context. See
          `../components/fare-exception-form.tsx` and
          `../data/fare-waiver-codes.ts`. */}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
            Fare exceptions
          </h2>
          <p className="mt-1 text-xs text-ink-muted">
            When a ticket&rsquo;s fare will not permit a change, file an
            exception with the documentation behind it and try the change again.
          </p>
        </div>
        <FareExceptionForm />
      </section>
    </div>
  );
}

export default AccountPage;
