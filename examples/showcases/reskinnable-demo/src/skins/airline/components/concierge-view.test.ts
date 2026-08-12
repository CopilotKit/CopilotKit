/**
 * ONE SUBSTRATE, ONE AV1423.
 *
 * `data/beat-map.md` § "Where the two substrates touch" is explicit that Camila's
 * AV1423 existed in BOTH `data/use-data.ts` (an in-memory `useState` store the
 * shell ran as `skin.useData`) and the REST ledger, and that a later slot had to
 * migrate BOTH readings. This is that slot. The hook is deleted and the ledger is
 * the only authority, and the two assertions below are the ones with no other
 * symptom: a re-added `useData` or a re-introduced seed read compiles, renders and
 * only shows up as two panels quoting different times for the same flight — on
 * stage, in front of the room.
 *
 * The derivations are tested because they REPLACED stored values. The in-memory
 * seed carried a hand-written "delayed roughly 55 minutes" alert that stayed at 55
 * whatever the flight said, so beat 5 could resolve a cancellation while the
 * banner still described a delay.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { disruptionFor, seatMapFor } from "./concierge-view";
import type { Flight } from "../data/trip-types";

const SKIN_ROOT = path.join(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(SKIN_ROOT, rel), "utf8");

/**
 * Source with comments removed. Needed for the negative assertions below because
 * `skin.tsx` and `concierge-view.ts` both EXPLAIN the migration by naming the
 * retired symbols — matching those would fail the guard for documenting the thing
 * it exists to prevent.
 */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");

const flight = (over: Partial<Flight> = {}): Flight => ({
  id: "flt-av1423",
  flightNumber: "AV1423",
  origin: "SCL",
  originCity: "Santiago",
  destination: "LIM",
  destinationCity: "Lima",
  departureLocal: "2026-07-14T18:40:00-04:00",
  arrivalLocal: "2026-07-14T22:05:00-05:00",
  aircraft: "Airbus A320neo",
  gate: "A17",
  status: "on_time",
  delayMinutes: 0,
  scheduleChangeMinutes: 0,
  availableSeats: [],
  ...over,
});

describe("the in-memory store is retired", () => {
  it("has no `data/use-data.ts` left to read", () => {
    expect(() => read(path.join("data", "use-data.ts"))).toThrow();
  });

  it("has no consumer of `useAirlineData` or `useSkinData` anywhere in the skin", () => {
    // The shell's `useSkinData<T>()` returns undefined for a skin with no
    // `useData`, so a leftover call site does not throw — it silently reads
    // `undefined.flight` at render time, or worse, reads nothing and renders an
    // empty panel next to a populated one.
    for (const file of [
      "skin.tsx",
      "tools.tsx",
      "layout.tsx",
      path.join("pages", "trips.tsx"),
      path.join("pages", "loyalty.tsx"),
      path.join("pages", "disruptions.tsx"),
    ]) {
      const source = code(file);
      expect(source, `${file} still reads the retired store`).not.toMatch(
        /useAirlineData/,
      );
      expect(source, `${file} still reads useSkinData`).not.toMatch(
        /useSkinData/,
      );
    }
  });

  it("reads no flight, passenger, disruption or option out of `data/seed.ts`", () => {
    // Those four constants are the ones the REST seed DUPLICATES field for field
    // (`data/store.test.ts` pins the agreement, and is now their only reader).
    // Anything here reading them puts a second authority back in the app.
    const view = code(path.join("components", "concierge-view.ts"));
    for (const constant of [
      "seedFlight",
      "seedPassenger",
      "seedDisruption",
      "seedRebookingOptions",
      "seedSeatMap",
    ]) {
      expect(view, `${constant} is read again`).not.toContain(constant);
    }
    // What it DOES still read is the set the ledger models no counterpart for.
    expect(view).toContain("seedLoyalty");
    expect(view).toContain("seedRedemptions");
    expect(view).toContain("seedBaggage");
  });
});

describe("the disruption is derived, not stored", () => {
  it("follows the flight into a cancellation", () => {
    const alert = disruptionFor(flight({ status: "cancelled" }));
    expect(alert?.type).toBe("cancellation");
    expect(alert?.severity).toBe("critical");
    expect(alert?.message).toContain("AV1423");
    expect(alert?.message).toContain("Lima");
  });

  it("quotes the delay the ledger holds, and the clock it pushes to", () => {
    const alert = disruptionFor(
      flight({ status: "delayed", delayMinutes: 55 }),
    );
    expect(alert?.type).toBe("delay");
    expect(alert?.message).toContain("55 minutes");
    // 18:40 + 55m, read off the string's own offset rather than through `Date` —
    // otherwise an evening departure from Santiago renders as an afternoon one on
    // a CI box in another timezone.
    expect(alert?.new_departure_time).toBe("19:35");
  });

  it("escalates a long delay rather than calling everything a warning", () => {
    expect(
      disruptionFor(flight({ status: "delayed", delayMinutes: 55 }))?.severity,
    ).toBe("warning");
    expect(
      disruptionFor(flight({ status: "delayed", delayMinutes: 180 }))?.severity,
    ).toBe("critical");
  });

  it("says nothing when the flight is running to schedule", () => {
    // `null`, so the page can render its explicit "on schedule" panel and the
    // readable can report a null the agent reads as "told, and there is none".
    expect(disruptionFor(flight())).toBeNull();
    expect(disruptionFor(null)).toBeNull();
  });

  it("resolves once the booking is rebooked, because it was never stored", () => {
    // Beat 5 rebooks the cancelled return. If the alert were a seeded record it
    // would still be on screen afterwards.
    expect(
      disruptionFor(flight({ status: "on_time", delayMinutes: 0 })),
    ).toBeNull();
  });
});

describe("the seat map cannot offer a seat the flight has not got", () => {
  const map = () =>
    seatMapFor(flight({ availableSeats: ["3C", "7C", "12D"] }), "14C");

  it("draws only the ledger's free seats as selectable", () => {
    const selectable = map()
      .seats.filter(
        (s) =>
          s.status !== "occupied" &&
          s.status !== "blocked" &&
          s.status !== "selected",
      )
      .map((s) => s.id);
    expect(selectable).toEqual(["3C", "7C", "12D"]);
  });

  it("keeps the held seat selected even though it is not free", () => {
    // The passenger's own seat is (correctly) absent from `availableSeats`. A map
    // that drew it occupied would tell them they are not sitting where they are.
    const seat = map().seats.find((s) => s.id === "14C");
    expect(seat?.status).toBe("selected");
    expect(map().selected_seat_id).toBe("14C");
  });

  it("keeps the cabin's premium and exit-row shape on the free seats", () => {
    const byId = new Map(map().seats.map((s) => [s.id, s.status]));
    expect(byId.get("3C")).toBe("premium"); // rows 1–4
    expect(byId.get("12D")).toBe("exit"); // the exit row
    expect(byId.get("7C")).toBe("available");
  });

  it("is empty of selectable seats when the ledger has not loaded", () => {
    const empty = seatMapFor(null, null);
    expect(empty.flight_number).toBe("");
    expect(empty.selected_seat_id).toBeNull();
    expect(empty.seats.every((s) => s.status === "occupied")).toBe(true);
  });
});
