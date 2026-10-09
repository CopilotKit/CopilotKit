/**
 * BEAT 1 — "How often do I fly?" as a cadence timeline.
 *
 * Turns the ledger's flights + bookings into the markers a horizontal strip
 * draws: one per trip, laid out on a day scale, split at TODAY, with the
 * disrupted ones flagged.
 *
 * WHY A TIMELINE AND NOT MONTHLY BARS. The seeded account holds seven trips
 * across three months, so bars give three of them and hide which trips are
 * disrupted — and a three-bar chart on a projector reads as a stub rather than
 * as data. The strip uses every trip, shows the gaps between them (which IS the
 * answer to "how often"), and puts the cancelled return on screen where the
 * later beats pick it up.
 *
 * TWO RULES THIS MODULE KEEPS, both learned elsewhere in this app:
 *
 *   1. `now` is PASSED IN, never read from the clock. The ledger publishes its
 *      own `now`, and the server render and the client render must agree about
 *      which trips are behind us. A `Date.now()` here would put the divider in
 *      one place on the server and another in the browser — a hydration
 *      mismatch, and a "3 flown" that disagrees with the picture beside it.
 *   2. Dates are read out of the ISO STRING, never through `new Date()`. Every
 *      timestamp in this substrate carries its airport's UTC offset, so
 *      `new Date(iso).getDate()` re-expresses a 23:00 Lima departure as the
 *      next day wherever the process happens to run. `components/local-clock.ts`
 *      makes the same argument for the display side; this is its data-side
 *      counterpart and the two must agree or the strip and the labels drift.
 *
 * Anything unparseable is DROPPED and counted, never coerced. A trip drawn at
 * the wrong point on the strip is worse than a trip left off it: the strip
 * claims a cadence, and a silently relocated marker makes that claim false.
 */
import type { Flight } from "./trip-types";

/**
 * The only two fields the cadence needs off a booking, declared structurally so
 * this works with BOTH the server's `Booking` and the client's `BookingDto`.
 *
 * Not an accident, and not just convenience: `BookingDto` is the shape with
 * `waiverGround` stripped — beat 6's sixth leak channel — and a helper that
 * demanded the full `Booking` would either force a cast at the call site or
 * quietly pull the withheld field into the client bundle. Asking for exactly
 * what it uses makes that impossible.
 */
export interface CadenceBooking {
  id: string;
  flightId: string;
}

/** Days either side of `now` the strip covers. Trips outside are dropped. */
export const CADENCE_WINDOW_DAYS = 75;

export interface CadenceMarker {
  flightId: string;
  flightNumber: string;
  /** Where the city label comes from — the arrival airport's city. */
  destinationCity: string;
  destination: string;
  /** ISO date only, `YYYY-MM-DD`, straight from the departure string. */
  date: string;
  /** Day offset from `now`. Negative is behind us. */
  dayOffset: number;
  /** 0..1 across the drawn window, so the component does no date maths. */
  position: number;
  flown: boolean;
  /** `cancelled` or `delayed` — what the later beats act on. */
  disruption: "cancelled" | "delayed" | null;
}

export interface FlightCadence {
  markers: CadenceMarker[];
  /** Month buckets spanning the drawn window, for the axis labels. */
  months: { label: string; position: number }[];
  flown: number;
  ahead: number;
  disrupted: number;
  /** Trips dropped because their departure string could not be read. */
  unreadable: number;
  /** Mean days between consecutive trips, or null under two trips. */
  averageGapDays: number | null;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * Days since 1970 for a `YYYY-MM-DD`, by arithmetic rather than `Date`.
 *
 * `Date.UTC` would be correct here and is deliberately avoided anyway: the
 * moment this module reaches for a Date it invites the next edit to call
 * `new Date(iso)` on a string that carries an offset, which is the bug the
 * header warns about. Civil-day arithmetic cannot make that mistake.
 */
function civilDay(year: number, month: number, day: number): number {
  // Howard Hinnant's days_from_civil. Exact for any Gregorian date.
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (month + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function dayNumberOf(iso: string): { day: number; date: string } | null {
  const m = ISO_DATE.exec(String(iso ?? "").trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { day: civilDay(year, month, day), date: `${m[1]}-${m[2]}-${m[3]}` };
}

function disruptionOf(flight: Flight): CadenceMarker["disruption"] {
  if (flight.status === "cancelled") return "cancelled";
  if (flight.status === "delayed" || (flight.delayMinutes ?? 0) > 0)
    return "delayed";
  return null;
}

/**
 * Build the cadence from a ledger snapshot.
 *
 * Only flights the traveller actually HOLDS a booking on are drawn — the
 * ledger's `flights` also carries the replacement candidates behind the
 * rebooking search, and those are options, not trips. Counting them would
 * inflate "how often do I fly" with flights nobody has taken or will.
 */
export function buildFlightCadence(
  flights: Flight[],
  bookings: CadenceBooking[],
  now: string,
  windowDays: number = CADENCE_WINDOW_DAYS,
): FlightCadence {
  const today = dayNumberOf(now);
  const byId = new Map(flights.map((f) => [f.id, f]));

  // One marker per BOOKING, so a passenger holding two seats on one flight is
  // one trip, not two — and a flight with no booking is not a trip at all.
  const bookedFlightIds = [...new Set(bookings.map((b) => b.flightId))];

  let unreadable = 0;
  const raw = bookedFlightIds
    .map((id) => {
      const flight = byId.get(id);
      if (!flight) return null;
      const when = dayNumberOf(flight.departureLocal);
      if (!when || !today) {
        unreadable += 1;
        return null;
      }
      return { flight, when };
    })
    .filter((x): x is { flight: Flight; when: { day: number; date: string } } =>
      Boolean(x),
    )
    .filter(({ when }) => Math.abs(when.day - today!.day) <= windowDays)
    .sort((a, b) => a.when.day - b.when.day);

  const span = windowDays * 2;
  const markers: CadenceMarker[] = raw.map(({ flight, when }) => {
    const dayOffset = when.day - today!.day;
    return {
      flightId: flight.id,
      flightNumber: flight.flightNumber,
      destinationCity: flight.destinationCity,
      destination: flight.destination,
      date: when.date,
      dayOffset,
      position: (dayOffset + windowDays) / span,
      flown: dayOffset < 0,
      disruption: disruptionOf(flight),
    };
  });

  // Month ticks across the window, positioned by their first day so the axis
  // lines up with the markers rather than being spaced evenly.
  const months: FlightCadence["months"] = [];
  if (today) {
    const seen = new Set<string>();
    for (const marker of markers) {
      const key = marker.date.slice(0, 7);
      if (seen.has(key)) continue;
      seen.add(key);
      const [y, m] = key.split("-").map(Number);
      const firstOfMonth = civilDay(y!, m!, 1);
      const offset = firstOfMonth - today.day;
      months.push({
        label: MONTH_LABELS[m! - 1]!,
        position: Math.min(1, Math.max(0, (offset + windowDays) / span)),
      });
    }
  }

  const gaps = markers
    .slice(1)
    .map((marker, i) => marker.dayOffset - markers[i]!.dayOffset);
  const averageGapDays = gaps.length
    ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length)
    : null;

  return {
    markers,
    months,
    flown: markers.filter((m) => m.flown).length,
    ahead: markers.filter((m) => !m.flown).length,
    disrupted: markers.filter((m) => m.disruption).length,
    unreadable,
    averageGapDays,
  };
}
