import { describe, it, expect, beforeEach } from "vitest";
import * as store from "./store";
import { NOTE_MARKER } from "./handling";
import { seedFlight, seedRebookingOptions } from "./seed";

beforeEach(() => store.reset());

const booking = (id: string) => {
  const found = store.findBooking(id);
  if (!found) throw new Error(`no booking ${id}`);
  return found;
};

describe("the ledger snapshot WITHHOLDS the gate's ground", () => {
  it("strips `waiverGround` from every published booking", () => {
    // ⚠️ This is a beat-6 vocabulary channel the failure-modes list does not
    // name, because no other skin has a GROUNDED gate. `waiverGround` is a
    // code-shaped token mapping one-to-one onto a justifying category, so
    // publishing it would hand the agent half the catalogue through the ledger
    // readable. The passenger reads the same fact as prose in `fareNotes`.
    const published = store.snapshot().bookings;
    expect(published.length).toBeGreaterThan(0);
    for (const b of published) {
      expect(b).not.toHaveProperty("waiverGround");
    }
    expect(JSON.stringify(store.snapshot())).not.toContain("waiverGround");
  });

  it("keeps the ground on the internal record, where the gate reads it", () => {
    expect(booking("bkg-av2214").waiverGround).toBe("schedule_change");
    expect(booking("bkg-av0918").waiverGround).toBe("medical");
    expect(booking("bkg-av1188").waiverGround).toBeNull();
  });

  it("publishes the same fact as prose the passenger can read", () => {
    const notes = booking("bkg-av2214").fareNotes.join(" ");
    expect(notes).toContain("3h 10m");
    // …and never as a token that looks like a category.
    expect(notes).not.toMatch(/[A-Z]{4,}_[A-Z]/);
  });
});

describe("the seed agrees with the in-memory concierge store", () => {
  it("carries the same AV1423 as `seed.ts`", () => {
    // Both substrates are live in the same demo, so a divergence here is two
    // panels on one screen disagreeing about the passenger's own flight.
    const rest = store.flights().find((f) => f.flightNumber === "AV1423");
    expect(rest).toBeDefined();
    expect(rest?.origin).toBe(seedFlight.origin);
    expect(rest?.destination).toBe(seedFlight.destination);
    expect(rest?.originCity).toBe(seedFlight.origin_city);
    expect(rest?.destinationCity).toBe(seedFlight.destination_city);
    expect(rest?.departureLocal).toBe(seedFlight.departure_time);
    expect(rest?.arrivalLocal).toBe(seedFlight.arrival_time);
    expect(rest?.aircraft).toBe(seedFlight.aircraft);
    expect(rest?.gate).toBe(seedFlight.gate);
    expect(rest?.status).toBe(seedFlight.status);
  });

  it("offers the same three alternatives on AV1423", () => {
    const rest = store
      .options()
      .filter((o) => o.bookingId === "bkg-av1423")
      .map((o) => ({
        flightNumber: o.flightNumber,
        departureLocal: o.departureLocal,
        stops: o.stops,
        fareDifferenceUsd: o.fareDifferenceUsd,
      }));
    expect(rest).toEqual(
      seedRebookingOptions.map((o) => ({
        flightNumber: o.flight_number,
        departureLocal: o.departure_time,
        stops: o.stops,
        fareDifferenceUsd: o.price_difference,
      })),
    );
  });
});

describe("resolveBooking refuses to guess", () => {
  it("resolves an exact id", () => {
    const lookup = store.resolveBooking("bkg-av1466");
    expect(lookup).toEqual({ ok: true, booking: booking("bkg-av1466") });
  });

  it("resolves a PNR held by exactly one booking", () => {
    const lookup = store.resolveBooking("AV3PL9");
    expect(lookup.ok && lookup.booking.id).toBe("bkg-av2214");
  });

  it("REFUSES a PNR held by two legs, naming both", () => {
    // Camila's outbound and her return share AV7QK2, which is how a real
    // reservation works. Silently taking the first would reissue the wrong leg
    // while reporting success.
    const lookup = store.resolveBooking("AV7QK2");
    expect(lookup.ok).toBe(false);
    if (lookup.ok) throw new Error("unreachable");
    expect(lookup.error).toBe("AMBIGUOUS_REFERENCE");
    if (lookup.error !== "AMBIGUOUS_REFERENCE") throw new Error("unreachable");
    expect(lookup.matches.sort()).toEqual(["bkg-av1423", "bkg-av1466"]);
  });

  it("misses cleanly", () => {
    expect(store.resolveBooking("ZZ0000")).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
  });
});

describe("the beat-5 writes", () => {
  it("reissues, clears the seat and logs it", () => {
    const b = booking("bkg-av1466");
    const option = store.options().find((o) => o.id === "o-1478-e");
    if (!option) throw new Error("missing option");
    store.reissueBooking(b, option, 0, "involuntary");
    expect(b.status).toBe("changed");
    expect(b.reissued?.flightNumber).toBe("AV1478");
    // The seat does not travel onto a different aircraft; a stale seat number
    // on the new itinerary is a falsehood the reseat step then "confirms".
    expect(b.seat).toBeNull();
    expect(b.log[0].kind).toBe("change");
  });

  it("reseats from the pool of whatever itinerary the booking is on now", () => {
    const b = booking("bkg-av1466");
    // Before the reissue the cancelled flight has no seats at all.
    expect(store.seatPoolFor(b)).toEqual([]);
    expect(store.reseatBooking(b, "aisle")).toEqual({
      ok: false,
      error: "NO_SEAT_AVAILABLE",
    });

    const option = store.options().find((o) => o.id === "o-1478-e");
    if (!option) throw new Error("missing option");
    store.reissueBooking(b, option, 0, "involuntary");
    const result = store.reseatBooking(b, "aisle");
    expect(result.ok).toBe(true);
    expect(b.seat).toBe("6C");
    expect(b.log[0].text).toContain("6C");
  });

  it("rejects a preference outside the given vocabulary", () => {
    expect(store.reseatBooking(booking("bkg-av1423"), "bulkhead")).toEqual({
      ok: false,
      error: "INVALID_PREFERENCE",
    });
  });

  it("notifies a party from the BOOKING's own contact list, with the marker", () => {
    const b = booking("bkg-av1466");
    const result = store.notifyParty(b, "arrival-pickup", "new-arrival-time");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    // Copied off the booking, never taken from the caller: a client-supplied
    // name is a name the model spelled.
    expect(result.notice.sentTo).toBe("Diego Rojas");
    expect(result.notice.channel).toBe("sms");
    expect(b.log[0].text.startsWith(NOTE_MARKER)).toBe(true);
  });

  it("REFUSES a party the booking cannot reach", () => {
    // Aeronova must never claim to have told someone it has no contact for.
    expect(
      store.notifyParty(booking("bkg-av1466"), "hotel", "room-hold-request"),
    ).toEqual({ ok: false, error: "NO_CONTACT_ON_FILE" });
    expect(booking("bkg-av1466").notices).toEqual([]);
  });

  it("rejects a party or template outside the given vocabulary", () => {
    const b = booking("bkg-av1466");
    expect(store.notifyParty(b, "landlord", "new-arrival-time").ok).toBe(false);
    expect(store.notifyParty(b, "arrival-pickup", "shout").ok).toBe(false);
  });
});

describe("the beat-6 writes", () => {
  it("stores the code EXACTLY as entered, decoy included", () => {
    // A record that quietly corrected the passenger would report a procedure
    // nobody demonstrated.
    const filed = store.fileException(
      booking("bkg-av2214"),
      "ELITE_COURTESY",
      "membership AN-5518844",
      "",
    );
    expect(filed.ok).toBe(true);
    if (!filed.ok) throw new Error("unreachable");
    expect(filed.exception.code).toBe("ELITE_COURTESY");
    expect(filed.exception.status).toBe("draft");
  });

  it("refuses an uncatalogued code and a filing with nothing behind it", () => {
    const b = booking("bkg-av2214");
    expect(store.fileException(b, "SCHEDULE_CHANGE", "notice", "")).toEqual({
      ok: false,
      error: "INVALID_CODE",
    });
    expect(
      store.fileException(b, "SCHEDULE_CHANGE_TRIGGERED", "   ", ""),
    ).toEqual({ ok: false, error: "MISSING_DOCUMENTATION" });
    expect(store.exceptions()).toEqual([]);
  });

  it("links an approved exception to its booking, whatever the code", () => {
    // Linking is not lifting. A decoy is approved, linked, visible — and
    // releases nothing, which `fare-rules.test.ts` asserts.
    const filed = store.fileException(
      booking("bkg-av1188"),
      "CHANGED_PLANS",
      "email 4 Aug",
      "",
    );
    if (!filed.ok) throw new Error("unreachable");
    expect(store.approveException(filed.exception.id).ok).toBe(true);
    expect(booking("bkg-av1188").activeExceptionId).toBe(filed.exception.id);
    expect(store.approveException(filed.exception.id)).toEqual({
      ok: false,
      error: "ALREADY_APPROVED",
    });
  });

  it("carries no `lifts` flag anywhere on the record", () => {
    // A `lifts` field would hand over the whole withheld catalogue one probe at
    // a time. The only way to find out is to retry the change.
    const filed = store.fileException(
      booking("bkg-av2214"),
      "SCHEDULE_CHANGE_TRIGGERED",
      "notice AV-88214",
      "",
    );
    if (!filed.ok) throw new Error("unreachable");
    expect(Object.keys(filed.exception)).not.toContain("lifts");
    expect(JSON.stringify(store.exceptions())).not.toContain("lift");
  });
});

describe("reset", () => {
  it("puts everything the beats wrote back", () => {
    const b = booking("bkg-av1466");
    const option = store.options()[0];
    store.reissueBooking(b, option, 0, "involuntary");
    store.notifyParty(b, "arrival-pickup", "new-arrival-time");
    const filed = store.fileException(
      booking("bkg-av2214"),
      "SCHEDULE_CHANGE_TRIGGERED",
      "notice AV-88214",
      "",
    );
    if (!filed.ok) throw new Error("unreachable");
    store.approveException(filed.exception.id);
    store.fileTripBrief({
      hotelName: "Casa Miraflores",
      confirmationNumber: "CM-77Q4132",
      address: "x",
      lastCheckInLocal: "22:30",
      cancellationDeadlineLocal: "18:00",
      nightlyRateUsd: 148,
      bookingRef: "AV7QK2",
      travelerName: "Camila Rojas",
      arrivalStation: "LIM",
      arrivalLocal: "2026-07-14T22:05:00-05:00",
      arrivesAfterLastCheckIn: true,
      headline: "…",
    });

    store.reset();

    // A trip that opens with last run's 🚨 notice already on it makes the stored
    // procedure look like it ran before anyone asked.
    expect(store.exceptions()).toEqual([]);
    expect(store.briefs()).toEqual([]);
    expect(booking("bkg-av1466").status).toBe("ticketed");
    expect(booking("bkg-av1466").reissued).toBeNull();
    expect(booking("bkg-av1466").notices).toEqual([]);
    expect(booking("bkg-av1466").log).toEqual([]);
    expect(booking("bkg-av2214").activeExceptionId).toBeNull();
  });

  it("does not let a mutation bleed back into the seed", () => {
    booking("bkg-av1423").seat = "1A";
    store.reset();
    expect(booking("bkg-av1423").seat).toBe("14C");
  });
});
