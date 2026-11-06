import { describe, it, expect, beforeEach } from "vitest";
import * as store from "./store";
import {
  INVOLUNTARY_SCHEDULE_CHANGE_MINUTES,
  amountDueUsd,
  authorizableOptions,
  blockedByFareRules,
  checkFareChange,
} from "./fare-rules";
import { optionsForBooking } from "./rebooking-options";
import type { FareException } from "./trip-types";

beforeEach(() => store.reset());

const booking = (id: string) => {
  const found = store.findBooking(id);
  if (!found) throw new Error(`no booking ${id}`);
  return found;
};
const flightOf = (id: string) => {
  const found = store.flightFor(booking(id));
  if (!found) throw new Error(`no flight for ${id}`);
  return found;
};
const check = (id: string) =>
  checkFareChange({
    booking: booking(id),
    flight: flightOf(id),
    exceptions: store.exceptions(),
  });

describe("checkFareChange — the gate", () => {
  it("permits a changeable fare", () => {
    // bkg-av7702 is Flex.
    expect(check("bkg-av7702")).toEqual({
      allowed: true,
      permission: "fare_permits",
    });
  });

  it("REFUSES a Basic Economy fare, naming the fare condition", () => {
    const verdict = check("bkg-av2214");
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) throw new Error("unreachable");
    expect(verdict.code).toBe("FARE_NOT_CHANGEABLE");
    expect(verdict.message).toContain("AV3PL9");
    expect(verdict.message).toContain("Basic Economy");
  });

  it("REFUSES a non-refundable promo fare, saying it is non-refundable", () => {
    const verdict = check("bkg-av0918");
    if (verdict.allowed) throw new Error("expected a refusal");
    expect(verdict.message).toContain("Promo Saver");
    expect(verdict.message).toContain("non-refundable");
  });

  it("never names the way through", () => {
    // A 4xx body is one of the five channels that leak a gate's vocabulary.
    // Asserting the ABSENCE alone would be satisfied by an empty string, so the
    // presence of the symptom is asserted above and the absence here.
    for (const id of ["bkg-av2214", "bkg-av0918", "bkg-av1188"]) {
      const verdict = check(id);
      if (verdict.allowed) throw new Error(`expected ${id} to be refused`);
      const lowered = verdict.message.toLowerCase();
      for (const leak of [
        "exception",
        "waiver",
        "category",
        "code",
        "document",
        "agent",
        "call us",
      ]) {
        expect(lowered).not.toContain(leak);
      }
    }
  });
});

describe("involuntary disruption short-circuits the fare entirely", () => {
  it("permits a change on a CANCELLED flight regardless of the fare", () => {
    // This is what keeps beat 5 clear of beat 6. bkg-av1466's flight is
    // cancelled; its fare happens to be changeable, so the check is repeated
    // below on a Basic Economy ticket where the fare would otherwise refuse.
    expect(check("bkg-av1466")).toEqual({
      allowed: true,
      permission: "involuntary",
    });
  });

  it("permits a Basic Economy change once the schedule moves past the threshold", () => {
    const flight = flightOf("bkg-av2214");
    expect(flight.scheduleChangeMinutes).toBeLessThan(
      INVOLUNTARY_SCHEDULE_CHANGE_MINUTES,
    );
    // Below the threshold it is refused (asserted above). At it, it is not.
    flight.scheduleChangeMinutes = INVOLUNTARY_SCHEDULE_CHANGE_MINUTES;
    expect(check("bkg-av2214")).toEqual({
      allowed: true,
      permission: "involuntary",
    });
  });

  it("keeps the seeded gated case BELOW the threshold", () => {
    // If a reseed ever pushed it to or past 240, beat 6 would silently have no
    // gated case at all: the change would just work and the teach arc would
    // never fire.
    expect(flightOf("bkg-av2214").scheduleChangeMinutes).toBe(190);
  });
});

describe("an approved exception, and only a GROUNDED one, lifts the gate", () => {
  const approveOn = (bookingId: string, code: string): FareException => {
    const filed = store.fileException(
      booking(bookingId),
      code,
      "notice AV-88214",
      "",
    );
    if (!filed.ok) throw new Error(`could not file ${code}`);
    const approved = store.approveException(filed.exception.id);
    if (!approved.ok) throw new Error("could not approve");
    return approved.exception;
  };

  it("lifts under the category the booking's record supports", () => {
    approveOn("bkg-av2214", "SCHEDULE_CHANGE_TRIGGERED");
    expect(check("bkg-av2214")).toEqual({
      allowed: true,
      permission: "exception",
    });
  });

  it("does NOT lift under a decoy, though the exception is filed and linked", () => {
    approveOn("bkg-av2214", "ELITE_COURTESY");
    expect(booking("bkg-av2214").activeExceptionId).not.toBeNull();
    expect(check("bkg-av2214").allowed).toBe(false);
  });

  it("does NOT lift under a justifying category the record does not support", () => {
    approveOn("bkg-av2214", "MEDICAL_DOCUMENTED");
    expect(check("bkg-av2214").allowed).toBe(false);
  });

  it("does NOT lift a booking that documents nothing, under ANY category", () => {
    // The honest wall: bkg-av1188 has no ground at all.
    for (const code of [
      "SCHEDULE_CHANGE_TRIGGERED",
      "MEDICAL_DOCUMENTED",
      "BEREAVEMENT_DOCUMENTED",
      "MILITARY_ORDERS",
      "CHANGED_PLANS",
      "FOUND_LOWER_FARE",
      "ELITE_COURTESY",
    ]) {
      store.reset();
      approveOn("bkg-av1188", code);
      expect(check("bkg-av1188").allowed).toBe(false);
    }
  });

  it("does NOT lift while the exception is still a draft", () => {
    const filed = store.fileException(
      booking("bkg-av2214"),
      "SCHEDULE_CHANGE_TRIGGERED",
      "notice AV-88214",
      "",
    );
    if (!filed.ok) throw new Error("could not file");
    // Not approved, so not linked either — and the gate stays shut.
    expect(check("bkg-av2214").allowed).toBe(false);
  });
});

describe("amountDueUsd", () => {
  const anyOption = (bookingId: string) =>
    optionsForBooking(store.options(), bookingId)[0];

  it("charges nothing on an involuntary change", () => {
    const option = anyOption("bkg-av1466");
    expect(amountDueUsd(booking("bkg-av1466"), option, "involuntary")).toBe(0);
  });

  it("charges the change fee PLUS the difference when the fare permits", () => {
    const b = booking("bkg-av1423");
    const option = optionsForBooking(store.options(), "bkg-av1423").find(
      (o) => o.fareDifferenceUsd > 0,
    );
    if (!option) throw new Error("seed has no paid option on bkg-av1423");
    expect(amountDueUsd(b, option, "fare_permits")).toBe(
      b.fare.changeFeeUsd + option.fareDifferenceUsd,
    );
  });

  it("waives the change fee under an exception but keeps the difference", () => {
    const b = booking("bkg-av1423");
    const option = optionsForBooking(store.options(), "bkg-av1423").find(
      (o) => o.fareDifferenceUsd > 0,
    );
    if (!option) throw new Error("seed has no paid option on bkg-av1423");
    expect(amountDueUsd(b, option, "exception")).toBe(option.fareDifferenceUsd);
  });

  it("never returns a negative amount from a negative difference", () => {
    const option = { ...anyOption("bkg-av1466"), fareDifferenceUsd: -500 };
    expect(amountDueUsd(booking("bkg-av1466"), option, "fare_permits")).toBe(
      booking("bkg-av1466").fare.changeFeeUsd,
    );
  });
});

describe("authorizableOptions — what the card may be offered on", () => {
  const forBooking = (id: string) =>
    authorizableOptions({
      booking: booking(id),
      flight: flightOf(id),
      options: store.options(),
      exceptions: store.exceptions(),
    });

  it("offers nothing at all on a refused fare", () => {
    // A second factor never releases what the fare refuses. Empty means the card
    // must say so, rather than render a box that cannot succeed.
    expect(forBooking("bkg-av2214")).toEqual([]);
    expect(forBooking("bkg-av0918")).toEqual([]);
    expect(forBooking("bkg-av1188")).toEqual([]);
  });

  it("offers nothing on an involuntary change, because nothing is due", () => {
    // Asking for a card to move $0 is a formality dressed as an authorization.
    expect(forBooking("bkg-av1466")).toEqual([]);
  });

  it("offers the paid options on a permitted fare, cheapest first", () => {
    const offered = forBooking("bkg-av7702");
    expect(offered.length).toBeGreaterThan(1);
    expect(offered.every((o) => o.amountDueUsd > 0)).toBe(true);
    const amounts = offered.map((o) => o.amountDueUsd);
    expect([...amounts].sort((a, b) => a - b)).toEqual(amounts);
  });

  it("never offers an option belonging to another booking", () => {
    const offered = forBooking("bkg-av7702");
    expect(offered.every((o) => o.option.bookingId === "bkg-av7702")).toBe(
      true,
    );
  });
});

describe("blockedByFareRules — what the exception form may offer", () => {
  const blocked = () =>
    blockedByFareRules({
      bookings: store.bookings(),
      flights: store.flights(),
      exceptions: store.exceptions(),
    });

  it("names exactly the three seeded gated bookings", () => {
    expect(
      blocked()
        .map((b) => b.booking.id)
        .sort(),
    ).toEqual(["bkg-av0918", "bkg-av1188", "bkg-av2214"]);
  });

  it("seeds them deliberately UNLIKE each other", () => {
    // The proof of beat 6 is the agent handling a DIFFERENT case unaided, which
    // only means something if the second case is not the first one repeated.
    const cases = blocked();
    const distinct = <T>(values: T[]) => new Set(values).size;
    expect(distinct(cases.map((c) => c.booking.travelerId))).toBe(3);
    expect(distinct(cases.map((c) => c.flight.destination))).toBe(3);
    expect(distinct(cases.map((c) => c.booking.waiverGround))).toBe(3);
  });

  it("publishes the gate's own message, not a second copy of the rule", () => {
    for (const entry of blocked()) {
      const verdict = check(entry.booking.id);
      if (verdict.allowed) throw new Error("expected a refusal");
      expect(entry.message).toBe(verdict.message);
    }
  });

  it("drops a booking once it has been reissued", () => {
    const b = booking("bkg-av2214");
    b.status = "changed";
    expect(blocked().map((x) => x.booking.id)).not.toContain("bkg-av2214");
  });
});
