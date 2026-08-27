import { describe, it, expect, beforeEach } from "vitest";
import * as store from "./store";
import {
  HOTEL_CONFIRMATIONS,
  arrivesAfterLastCheckIn,
  clockMinutes,
  effectiveArrival,
  hotelConfirmationFor,
} from "./hotel-confirmations";
import type { Flight } from "./trip-types";

beforeEach(() => store.reset());

const resolve = (ref: string) =>
  hotelConfirmationFor({
    booking: store.findBooking(ref),
    flights: store.flights(),
    travelers: store.travelers(),
  });

describe("every reservation belongs to the party it is addressed to", () => {
  it("resolves the seeded reservations", () => {
    expect(resolve("bkg-av1423")?.entry.hotelName).toBe("Casa Miraflores");
    expect(resolve("bkg-av2214")?.entry.hotelName).toBe("Bayfront Suites");
  });

  it("keys entries to bookings that exist, in cities those flights reach", () => {
    // Commerce appended one hard-coded row to EVERY vendor's price sheet and
    // thereby asserted a supplier relationship that does not exist. Checked
    // against the live ledger rather than trusted.
    for (const entry of HOTEL_CONFIRMATIONS) {
      const resolved = resolve(entry.bookingId);
      expect(resolved).toBeDefined();
      expect(resolved?.flight.destinationCity).toBe(entry.city);
      expect(resolved?.traveler.name).toBe(entry.guestName);
    }
  });

  it("DROPS the entry rather than misattributing it when the city moves", () => {
    const flight = store.flights().find((f) => f.id === "flt-av1423") as Flight;
    flight.destinationCity = "Bogotá";
    expect(resolve("bkg-av1423")).toBeUndefined();
  });

  it("DROPS the entry when the traveler is renamed", () => {
    const traveler = store.travelers().find((t) => t.id === "tv-camila");
    if (!traveler) throw new Error("missing traveler");
    traveler.name = "C. Rojas";
    expect(resolve("bkg-av1423")).toBeUndefined();
  });

  it("has nothing to say about a booking with no room behind it", () => {
    expect(resolve("bkg-av0431")).toBeUndefined();
    expect(resolve("nope")).toBeUndefined();
  });
});

describe("effectiveArrival applies today's delay in the ARRIVAL airport's clock", () => {
  const flight = (over: Partial<Flight>): Flight => ({
    ...(store.flights()[0] as Flight),
    ...over,
  });

  it("adds the delay to the scheduled arrival", () => {
    const arrival = effectiveArrival(
      flight({ arrivalLocal: "2026-07-14T22:05:00-05:00", delayMinutes: 55 }),
    );
    expect(arrival?.clock).toBe("23:00");
    expect(arrival?.nextDay).toBe(false);
  });

  it("does NOT wrap the comparison value past midnight", () => {
    // Wrapping is the bug this type exists to prevent: 23:15 pushed 90 minutes
    // late becomes 00:45, and `"00:45" > "22:30"` is FALSE — so the one flight
    // that misses the hotel by the widest margin would report as being in time.
    const arrival = effectiveArrival(
      flight({ arrivalLocal: "2026-07-21T23:15:00-04:00", delayMinutes: 90 }),
    );
    expect(arrival?.clock).toBe("00:45");
    expect(arrival?.nextDay).toBe(true);
    expect(arrival?.minutes).toBeGreaterThan(24 * 60);
    expect(arrivesAfterLastCheckIn(arrival, "22:30")).toBe(true);
  });

  it("reads out of the ISO string, not through the process timezone", () => {
    const here = effectiveArrival(
      flight({ arrivalLocal: "2026-07-14T22:05:00-05:00", delayMinutes: 0 }),
    );
    const there = effectiveArrival(
      flight({ arrivalLocal: "2026-07-14T22:05:00+09:00", delayMinutes: 0 }),
    );
    expect(here?.clock).toBe("22:05");
    expect(there?.clock).toBe("22:05");
  });

  it("refuses an unreadable timestamp and a negative delay", () => {
    expect(effectiveArrival(flight({ arrivalLocal: "tonight" }))).toBeNull();
    expect(
      effectiveArrival(
        flight({
          arrivalLocal: "2026-07-14T22:05:00-05:00",
          delayMinutes: -30,
        }),
      )?.clock,
    ).toBe("22:05");
  });
});

describe("the collision verdict is TRI-STATE", () => {
  it("is null when either clock is unreadable — never false", () => {
    // A `false` here would tell the model "checked, and fine" about a comparison
    // nobody was able to make, which it would then say out loud.
    expect(arrivesAfterLastCheckIn(null, "22:30")).toBeNull();
    expect(
      arrivesAfterLastCheckIn(
        { minutes: 1380, clock: "23:00", nextDay: false },
        "half ten",
      ),
    ).toBeNull();
    expect(
      arrivesAfterLastCheckIn(
        { minutes: 1380, clock: "23:00", nextDay: false },
        "26:00",
      ),
    ).toBeNull();
  });

  it("compares minutes, not strings", () => {
    const late = { minutes: 23 * 60, clock: "23:00", nextDay: false };
    const early = { minutes: 21 * 60 + 40, clock: "21:40", nextDay: false };
    expect(arrivesAfterLastCheckIn(late, "22:30")).toBe(true);
    expect(arrivesAfterLastCheckIn(early, "22:30")).toBe(false);
  });

  it("the seeded Lima trip actually collides — the beat depends on it", () => {
    const resolved = resolve("bkg-av1423");
    if (!resolved) throw new Error("missing reservation");
    expect(
      arrivesAfterLastCheckIn(
        effectiveArrival(resolved.flight),
        resolved.entry.lastCheckInLocal,
      ),
    ).toBe(true);
  });
});

describe("clockMinutes", () => {
  it("reads HH:MM and refuses everything else", () => {
    expect(clockMinutes("22:30")).toBe(1350);
    expect(clockMinutes("00:00")).toBe(0);
    expect(clockMinutes(" 09:05 ")).toBe(545);
    expect(clockMinutes("9:05")).toBeNull();
    expect(clockMinutes("24:00")).toBeNull();
    expect(clockMinutes("22:70")).toBeNull();
    expect(clockMinutes("")).toBeNull();
  });
});
