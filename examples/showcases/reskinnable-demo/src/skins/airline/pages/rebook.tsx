"use client";

/**
 * BEAT 3c — the lever surface.
 *
 * Departure window, stops, cabin and sort — plus a top-N — ALL arrive from the
 * QUERY STRING, which is what lets the agent perform a MANEUVER rather than
 * follow a link: it confirms the levers it is about to pull, navigates to
 * `?window=…&stops=…&cabin=…&sort=…&top=…`, and this page reads them back
 * through the one shared record in `../data/rebooking-levers`.
 *
 * FOUR levers rather than one, on purpose. A single filter looks like a link
 * with extra steps. And this particular four is the argument for the whole
 * surface: it is the flight search everyone in the room has personally used, so
 * nobody has to be told what a departure-window filter is.
 *
 * The controls it set are then VISIBLY tinted, which is the half of the beat
 * that is easy to skip and impossible to recover: if the page merely shows the
 * right rows, the audience sees a filtered list and has to take on faith that
 * the assistant did it. Note it is the CONTROLS that light up, not the rows.
 *
 * ⚠️ THE TRIP PICKER IS NOT A FIFTH LEVER. It chooses the SUBJECT of the search
 * — which of the passenger's own bookings is being rebooked — and it always has
 * a value, so it can never be "unset". Tinting it would tell the room the agent
 * pulled a control it did not touch, which is the same lie as a chip for a lever
 * nobody set (demo-beats.md § 3c). It is styled as idle, always.
 *
 * NOT REACHABLE YET: `skin.tsx` still routes only the three in-memory pages, and
 * nothing mounts `AirlineLedgerProvider`. See `ledger-context.tsx`'s header.
 */

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAgentContext } from "@copilotkit/react-core/v2";
import { cn } from "@/lib/utils";
import { useSkin } from "@/shell/skin-provider";
import { useSkinHref } from "@/shell/skin-path";
import { useAirlineLedger } from "../ledger-context";
import {
  CABIN_FILTERS,
  CABIN_LABELS,
  DEPARTURE_WINDOWS,
  DEPARTURE_WINDOW_LABELS,
  OPTION_SORTS,
  OPTION_SORT_LABELS,
  STOP_FILTERS,
  STOP_LABELS,
  readLevers,
} from "../data/rebooking-levers";
import { applyLevers, optionsForBooking } from "../data/rebooking-options";
import {
  CABIN_LABEL,
  FARE_BRAND_LABELS,
  OptionBoard,
  stopsLabel,
} from "../components/option-board";
import type { BookingDto, Flight, RebookingOption } from "../data/trip-types";

/** This page's own route segment. One constant, used for every link it builds. */
export const REBOOK_SEGMENT = "rebook";

/**
 * Which booking the search opens on when the URL does not say.
 *
 * DETERMINISTIC and derived, never hardcoded to a seed id: the demo's subject is
 * "the trip that most needs rebooking", and after the presenter resolves it the
 * page should move on rather than keep offering a booking that is already
 * reissued. Cancelled outranks delayed, and a booking with no options at all is
 * never chosen — an empty board on arrival is indistinguishable from a broken
 * filter.
 *
 * With the shipped seed this resolves to `bkg-av1466`, Camila's cancelled
 * return, which is the record `data/beat-map.md` § "Beat 3c" builds the fat
 * option board on.
 */
export function pickDefaultBooking(
  bookings: BookingDto[],
  flights: Flight[],
  options: RebookingOption[],
): BookingDto | null {
  const flightOf = new Map(flights.map((f) => [f.id, f]));
  const hasOptions = (b: BookingDto) =>
    options.some((o) => o.bookingId === b.id);
  const rank = (b: BookingDto) => {
    const status = flightOf.get(b.flightId)?.status;
    if (status === "cancelled") return 0;
    if (status === "delayed") return 1;
    return 2;
  };
  const candidates = bookings.filter(
    (b) => b.status === "ticketed" && hasOptions(b),
  );
  if (candidates.length === 0) return null;
  // Stable: ties fall back to ledger order rather than an arbitrary one.
  return [...candidates].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/**
 * The booking named by `?booking=`, or null.
 *
 * Matches an id first, then a UNIQUE reference. A PNR held by more than one leg
 * (Camila's outbound and her return both sit under AV7QK2, which is how a real
 * reservation works) resolves to NOTHING rather than to whichever came first —
 * silently searching replacements for the wrong leg is the failure the API's own
 * `409 AMBIGUOUS_REFERENCE` exists to prevent, and the page must not undo it.
 */
export function resolveRequestedBooking(
  bookings: BookingDto[],
  requested: string | null,
): BookingDto | null {
  if (!requested) return null;
  const byId = bookings.find((b) => b.id === requested);
  if (byId) return byId;
  const byRef = bookings.filter((b) => b.reference === requested);
  return byRef.length === 1 ? byRef[0]! : null;
}

const baseControl =
  "rounded-md border px-2.5 py-1.5 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-brand";
// The same tinted pair banking's charges.tsx and logistics' control-tower.tsx
// use — one "the agent set this" look across every skin that lets the agent
// reach a control.
const activeControl =
  "border-brand/50 bg-brand-soft font-semibold text-brand-indigo dark:text-brand-violet";
const idleControl = "border-hairline bg-surface font-medium text-ink";

export function RebookPage() {
  const { ready, travelers, bookings, flights, options } = useAirlineLedger();
  const skin = useSkin();
  const skinHref = useSkinHref(skin.id);
  const router = useRouter();
  const params = useSearchParams();

  const query = params?.toString() ?? "";

  // ONE normalized record, the same one a confirm card would draw its chips
  // from. An unrecognised value (`?sort=by_vibes`) comes back null, so the view
  // renders exactly as it does with the lever absent and the control stays
  // untinted — never a filter the page claims and does not apply.
  // Aliased away from `window`: the lever's name in the URL and in the shared
  // record is `window`, but a local by that name shadows the global inside a
  // client component, which is a trap nobody should have to notice twice.
  const {
    window: departureWindow,
    stops,
    cabin,
    sort,
    top,
  } = readLevers(new URLSearchParams(query));

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(query);
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
    const search = next.toString();
    // Through skinHref, never a hardcoded `/airline/rebook` — under LOCK_SKIN
    // this deploy is served at `/` and a literal prefix would reappear in the
    // address bar on the first click. `pnpm lint` fails the hardcoded form.
    router.replace(`${skinHref(REBOOK_SEGMENT)}${search ? `?${search}` : ""}`, {
      scroll: false,
    });
  };

  const booking = useMemo(
    () =>
      resolveRequestedBooking(bookings, params?.get("booking") ?? null) ??
      pickDefaultBooking(bookings, flights, options),
    [bookings, flights, options, params],
  );

  const traveler = travelers.find((t) => t.id === booking?.travelerId) ?? null;
  const flight = flights.find((f) => f.id === booking?.flightId) ?? null;

  /** Every booking the passenger could search replacements for, for the picker. */
  const searchable = useMemo(
    () =>
      bookings.filter(
        (b) =>
          b.status === "ticketed" && options.some((o) => o.bookingId === b.id),
      ),
    [bookings, options],
  );

  // ONE pipeline, TWO published lengths, straight out of the shared
  // `applyLevers` the API route also runs — so the page and
  // `GET /bookings/[id]/options` cannot form two different opinions about what
  // "evening nonstops" means. `matching` is the count under the levers BEFORE
  // truncation, `visible` is what the board renders. The caption, the rows and
  // the beat-3b readable all read these. Commerce shipped a "Top 10 of 22"
  // caption whose denominator came from the unfiltered collection while 13 rows
  // matched, so the single number the room is asked to read as proof of the
  // maneuver instead said the filters did nothing.
  const { all, matching, visible } = useMemo(() => {
    const forBooking = booking ? optionsForBooking(options, booking.id) : [];
    const levered = applyLevers(forBooking, {
      window: departureWindow,
      stops,
      cabin,
      sort,
      top,
    });
    return { all: forBooking, ...levered };
  }, [options, booking, departureWindow, stops, cabin, sort, top]);

  // ── BEAT 3b, part 2 — what is VISIBLY on this screen ─────────────────────
  // `visible` is the exact array handed to <OptionBoard> below, in the exact
  // order it paints. NEVER re-derive or re-slice the source for a readable: a
  // readable listing 5 rows against a panel showing 6 describes the screen
  // wrongly, silently, and a confidently wrong description is indistinguishable
  // from a correct one to the room. `pages/on-screen-readables.test.tsx`
  // asserts that identity against the rendered DOM — a grep cannot see it.
  //
  // The three counts are named by SCOPE. `total` is every replacement this trip
  // has before any lever, and it is the one figure here that does NOT describe
  // the view — the description says so, because a total beside filtered rows is
  // the same misread one step removed.
  //
  // ONE MECHANICAL CONSTRAINT before rewording any of this: `readables.test.tsx`
  // anchors its omission guard on a `useAgentContext(` window terminated by the
  // statement's own semicolon, so a SEMICOLON in the description below ends that
  // window early and fails the guard for reasons the message will not explain.
  // Use dashes and full stops.
  useAgentContext({
    description:
      "What is on the rebooking search screen right now. `trip` is the " +
      "passenger's own booking being rebooked. `filters` are the active " +
      "departure window, stops, cabin, sort and top-N levers — an absent one " +
      "is not being applied. `matching` is how many replacement flights those " +
      "levers admit before the limit, and `visible` how many `rows` remain " +
      "after it — the rows actually on screen, in the order shown. `total` is " +
      "every replacement this trip has before any filter, so never report it " +
      "as the contents of this view.",
    value: JSON.stringify({
      page: "Rebooking search",
      loading: !ready,
      trip: booking
        ? {
            confirmation: booking.reference,
            traveler: traveler?.name ?? null,
            flight: flight?.flightNumber ?? null,
            route: flight
              ? `${flight.originCity} → ${flight.destinationCity}`
              : null,
            status: flight?.status ?? null,
            fare: booking.fare.brandLabel,
            fare_changeable: booking.fare.changeable,
          }
        : null,
      filters: { window: departureWindow, stops, cabin, sort, top },
      total: all.length,
      matching: matching.length,
      visible: visible.length,
      rows: visible.map((o) => ({
        flight: o.flightNumber,
        departs_local: o.departureLocal,
        arrives_local: o.arrivalLocal,
        duration_minutes: o.durationMinutes,
        stops: stopsLabel(o.stops),
        cabin: CABIN_LABEL[o.cabin],
        fare: FARE_BRAND_LABELS[o.fareBrand],
        fare_difference_usd: o.fareDifferenceUsd,
        seats_available: o.seatsAvailable,
      })),
    }),
  });

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold text-ink">Find another flight</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {booking && flight
            ? `Replacements for ${flight.flightNumber}, ${flight.originCity} to ${flight.destinationCity}.`
            : ready
              ? "None of your trips has replacement flights to show."
              : "Loading your trips…"}
        </p>
      </header>

      {/* The SUBJECT of the search: whose trip, which leg, and what condition
          it is in. This is what keeps the page a passenger's rebooking search
          rather than a dispatcher's board — the row of controls below filters
          replacements for ONE of the passenger's own bookings, named here. */}
      {booking && flight && (
        <section className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-hairline bg-surface p-4 shadow-soft">
          <div className="flex flex-col">
            <span className="text-xs uppercase tracking-wider text-ink-muted">
              Rebooking
            </span>
            <span className="font-mono text-sm font-semibold text-ink">
              {flight.flightNumber} · {booking.reference}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs uppercase tracking-wider text-ink-muted">
              Traveller
            </span>
            <span className="text-sm text-ink">{traveler?.name ?? "—"}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs uppercase tracking-wider text-ink-muted">
              Ticketed fare
            </span>
            <span className="text-sm text-ink">{booking.fare.brandLabel}</span>
          </div>
          {flight.status === "cancelled" && (
            <span className="rounded-full bg-negative-soft px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-negative">
              Cancelled — a replacement is owed at no cost
            </span>
          )}
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
          Replacement flights
        </h2>

        {/* The four levers, plus the limit. Each carries the brand tint whenever
            it is SET in the URL rather than sitting at its default — arriving
            from the copilot is exactly that case, so the controls the agent just
            pulled are the ones that light up and the room can see WHAT changed,
            not merely that the page changed. Keyed on the PARSED value, so an
            unrecognised `?sort=banana` tints nothing: it is not a sort the view
            is applying. */}
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-hairline bg-surface p-3 shadow-soft">
          {/* The subject picker — deliberately never tinted. See the header. */}
          {searchable.length > 1 && (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-ink-muted">Trip</span>
              <select
                aria-label="Trip to rebook"
                value={booking?.id ?? ""}
                onChange={(e) => setParam("booking", e.target.value)}
                className={cn(baseControl, idleControl)}
              >
                {searchable.map((b) => {
                  const f = flights.find((x) => x.id === b.flightId);
                  return (
                    <option key={b.id} value={b.id}>
                      {f
                        ? `${f.flightNumber} — ${f.originCity} → ${f.destinationCity}`
                        : b.reference}
                    </option>
                  );
                })}
              </select>
            </label>
          )}

          <label className="flex items-center gap-2 text-sm">
            <span className="text-ink-muted">Departs</span>
            <select
              aria-label="Departure window"
              value={departureWindow ?? ""}
              onChange={(e) => setParam("window", e.target.value)}
              className={cn(
                baseControl,
                departureWindow ? activeControl : idleControl,
              )}
            >
              <option value="">Any time</option>
              {DEPARTURE_WINDOWS.map((w) => (
                <option key={w} value={w}>
                  {DEPARTURE_WINDOW_LABELS[w]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm">
            <span className="text-ink-muted">Stops</span>
            <select
              aria-label="Stops"
              value={stops ?? ""}
              onChange={(e) => setParam("stops", e.target.value)}
              className={cn(baseControl, stops ? activeControl : idleControl)}
            >
              <option value="">Any number of stops</option>
              {STOP_FILTERS.map((s) => (
                <option key={s} value={s}>
                  {STOP_LABELS[s]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm">
            <span className="text-ink-muted">Cabin</span>
            <select
              aria-label="Cabin"
              value={cabin ?? ""}
              onChange={(e) => setParam("cabin", e.target.value)}
              className={cn(baseControl, cabin ? activeControl : idleControl)}
            >
              <option value="">Any cabin</option>
              {CABIN_FILTERS.map((c) => (
                <option key={c} value={c}>
                  {CABIN_LABELS[c]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm">
            <span className="text-ink-muted">Sort</span>
            <select
              aria-label="Sort order"
              value={sort ?? ""}
              onChange={(e) => setParam("sort", e.target.value)}
              className={cn(baseControl, sort ? activeControl : idleControl)}
            >
              <option value="">As offered</option>
              {OPTION_SORTS.map((s) => (
                <option key={s} value={s}>
                  {OPTION_SORT_LABELS[s]}
                </option>
              ))}
            </select>
          </label>

          {/* A number input, not a select: `parseTopLever` honours ANY positive
              integer, so a fixed 5/10/20 dropdown would be a control unable to
              represent every value the agent can set — the same class of
              mismatch this whole beat is about. */}
          <label className="flex items-center gap-2 text-sm">
            <span className="text-ink-muted">Top</span>
            <input
              aria-label="Result limit"
              type="number"
              min={1}
              step={1}
              placeholder="All"
              value={top ?? ""}
              onChange={(e) => setParam("top", e.target.value)}
              className={cn(
                baseControl,
                "w-24",
                top !== null ? activeControl : idleControl,
              )}
            />
          </label>
        </div>

        {/* Numerator and denominator BOTH off the one pipeline above: `visible`
            is what the board renders, `matching` is what the levers admit before
            the limit. Rendered unconditionally so the count on screen is always
            the FILTERED one. */}
        <p className="text-xs text-ink-muted">
          {top !== null
            ? `Top ${visible.length} of ${matching.length} matching flight${matching.length === 1 ? "" : "s"}`
            : `${matching.length} matching flight${matching.length === 1 ? "" : "s"}`}
          {matching.length !== all.length && ` — ${all.length} in total`}
        </p>

        <OptionBoard options={visible} showRank={sort !== null} />
      </section>
    </div>
  );
}

export default RebookPage;
