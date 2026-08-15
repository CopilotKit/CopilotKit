import { describe, expect, it } from "vitest";
import { buildFlightCadence, CADENCE_WINDOW_DAYS } from "./flight-cadence";
import { SEED_NOW, seedBookings, seedFlights } from "./trip-seed";
import type { Booking, Flight } from "./trip-types";

const flight = (over: Partial<Flight> & { id: string }): Flight =>
  ({
    flightNumber: "AV1000",
    origin: "LIM",
    originCity: "Lima",
    destination: "SCL",
    destinationCity: "Santiago",
    departureLocal: "2026-08-20T09:00:00-05:00",
    arrivalLocal: "2026-08-20T15:00:00-04:00",
    aircraft: "A320",
    gate: null,
    status: "on_time",
    delayMinutes: 0,
    ...over,
  }) as Flight;

const booking = (id: string, flightId: string): Booking =>
  ({ id, flightId }) as Booking;

const NOW = "2026-08-13T12:00:00-05:00";

describe("buildFlightCadence — what the strip is drawn from", () => {
  it("splits trips at `now`, not at the machine's clock", () => {
    const flights = [
      flight({ id: "f1", departureLocal: "2026-07-14T08:00:00-05:00" }),
      flight({ id: "f2", departureLocal: "2026-08-27T08:00:00-05:00" }),
    ];
    const cadence = buildFlightCadence(
      flights,
      [booking("b1", "f1"), booking("b2", "f2")],
      NOW,
    );
    expect(cadence.flown).toBe(1);
    expect(cadence.ahead).toBe(1);
    expect(cadence.markers.map((m) => m.flown)).toEqual([true, false]);
  });

  it("reads the day off the ISO STRING, so an offset cannot move a trip", () => {
    // 23:00 in Lima is already the next day in UTC. `new Date(iso).getDate()`
    // would report the 14th; the strip must say the 13th, because that is the
    // date on the passenger's ticket.
    const late = flight({
      id: "f1",
      departureLocal: "2026-08-13T23:00:00-05:00",
    });
    const cadence = buildFlightCadence([late], [booking("b1", "f1")], NOW);
    expect(cadence.markers[0]!.date).toBe("2026-08-13");
    expect(cadence.markers[0]!.dayOffset).toBe(0);
  });

  it("counts one trip per booking, not per seat on a flight", () => {
    const one = flight({ id: "f1" });
    const cadence = buildFlightCadence(
      [one],
      [booking("b1", "f1"), booking("b2", "f1")],
      NOW,
    );
    expect(cadence.markers).toHaveLength(1);
  });

  it("draws only flights someone HOLDS, never the rebooking candidates", () => {
    // The ledger's `flights` also carries the replacement options behind the
    // rebooking search. Those are offers, not trips, and counting them would
    // inflate the answer to "how often do I fly".
    const held = flight({ id: "f1" });
    const candidate = flight({ id: "f2" });
    const cadence = buildFlightCadence(
      [held, candidate],
      [booking("b1", "f1")],
      NOW,
    );
    expect(cadence.markers.map((m) => m.flightId)).toEqual(["f1"]);
  });

  it("flags cancelled and delayed separately, and counts them", () => {
    const flights = [
      flight({ id: "f1", status: "cancelled" }),
      flight({ id: "f2", status: "on_time", delayMinutes: 45 }),
      flight({ id: "f3" }),
    ];
    const cadence = buildFlightCadence(
      flights,
      [booking("b1", "f1"), booking("b2", "f2"), booking("b3", "f3")],
      NOW,
    );
    expect(cadence.markers.map((m) => m.disruption)).toEqual([
      "cancelled",
      "delayed",
      null,
    ]);
    expect(cadence.disrupted).toBe(2);
  });

  it("DROPS an unreadable departure and says so, rather than placing it at day 0", () => {
    // A marker at the wrong point on the strip is worse than a missing one:
    // the strip asserts a cadence, and a silently relocated trip makes that
    // assertion false while still looking like data.
    const bad = flight({ id: "f1", departureLocal: "not-a-date" });
    const cadence = buildFlightCadence([bad], [booking("b1", "f1")], NOW);
    expect(cadence.markers).toHaveLength(0);
    expect(cadence.unreadable).toBe(1);
  });

  it("drops trips outside the drawn window instead of clamping them onto its edge", () => {
    const far = flight({ id: "f1", departureLocal: "2020-01-01T09:00:00-05:00" });
    const cadence = buildFlightCadence([far], [booking("b1", "f1")], NOW);
    expect(cadence.markers).toHaveLength(0);
  });

  it("puts every drawn marker inside 0..1 so the component does no date maths", () => {
    const cadence = buildFlightCadence(
      [
        flight({ id: "f1", departureLocal: "2026-07-01T09:00:00-05:00" }),
        flight({ id: "f2", departureLocal: "2026-09-19T09:00:00-05:00" }),
      ],
      [booking("b1", "f1"), booking("b2", "f2")],
      NOW,
    );
    for (const marker of cadence.markers) {
      expect(marker.position).toBeGreaterThanOrEqual(0);
      expect(marker.position).toBeLessThanOrEqual(1);
    }
  });

  it("reports the average gap, and null when there is nothing to average", () => {
    const spaced = buildFlightCadence(
      [
        flight({ id: "f1", departureLocal: "2026-08-01T09:00:00-05:00" }),
        flight({ id: "f2", departureLocal: "2026-08-11T09:00:00-05:00" }),
        flight({ id: "f3", departureLocal: "2026-08-21T09:00:00-05:00" }),
      ],
      [booking("b1", "f1"), booking("b2", "f2"), booking("b3", "f3")],
      NOW,
    );
    expect(spaced.averageGapDays).toBe(10);

    const single = buildFlightCadence(
      [flight({ id: "f1" })],
      [booking("b1", "f1")],
      NOW,
    );
    expect(single.averageGapDays).toBeNull();
  });

  it("survives an unreadable `now` without inventing a today", () => {
    const cadence = buildFlightCadence(
      [flight({ id: "f1" })],
      [booking("b1", "f1")],
      "",
    );
    expect(cadence.markers).toHaveLength(0);
    expect(cadence.months).toEqual([]);
  });
});

describe("against the real seed — the figures the demo will actually show", () => {
  it("draws all seven seeded trips and finds the disrupted ones", () => {
    // Pinned against the SHIPPED seed AND the app's own clock, so a reseed that
    // changes the demo's opening figures fails here rather than on stage.
    //
    // NOTE `SEED_NOW`, not the wall clock. This app runs on a FIXED demo clock
    // (`store.ts` publishes `now: SEED_NOW`), so "today" is 2026-07-14 whatever
    // the date is when you read this. Every seeded trip is therefore AHEAD, and
    // the strip is forward-looking: the honest answer to "how often do I fly"
    // is the average gap, not a count of flights behind us.
    const cadence = buildFlightCadence(seedFlights, seedBookings, SEED_NOW);

    expect(cadence.markers).toHaveLength(7);
    expect(cadence.flown + cadence.ahead).toBe(cadence.markers.length);
    expect(cadence.flown).toBe(0);
    expect(cadence.ahead).toBe(7);
    expect(cadence.unreadable).toBe(0);

    // The two the later beats act on: AV1423 is delayed (beat 3a's check-in
    // trip) and AV1466 is the cancelled return beat 5 handles. If a reseed
    // clears either, the opening chart stops setting up the demo.
    expect(cadence.disrupted).toBe(2);
    expect(
      cadence.markers.filter((m) => m.disruption === "cancelled"),
    ).toHaveLength(1);

    // The figure the prose is supposed to quote.
    expect(cadence.averageGapDays).toBe(11);
  });

  it("keeps the window wide enough to hold the seeded spread", () => {
    expect(CADENCE_WINDOW_DAYS).toBeGreaterThanOrEqual(45);
  });
});
