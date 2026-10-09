import { describe, it, expect, beforeEach } from "vitest";
import { GET, POST } from "./route";
import * as store from "@/skins/airline/data/store";
import { HOTEL_CONFIRMATIONS } from "@/skins/airline/data/hotel-confirmations";

beforeEach(() => store.reset());

const call = (body: unknown) =>
  POST(
    new Request("http://localhost/x", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );

/** Exactly what a model that READ the seeded Lima confirmation would send. */
const asRead = (over: Record<string, unknown> = {}) => {
  const entry = HOTEL_CONFIRMATIONS[0];
  return {
    hotelName: entry.hotelName,
    confirmationNumber: entry.confirmationNumber,
    address: entry.address,
    lastCheckInLocal: entry.lastCheckInLocal,
    cancellationDeadlineLocal: entry.cancellationDeadlineLocal,
    nightlyRateUsd: entry.nightlyRateUsd,
    guestName: entry.guestName,
    city: entry.city,
    checkInDate: entry.checkInDate,
    ...over,
  };
};

describe("POST /briefs — the durable artifact", () => {
  it("keeps the DOCUMENT's facts as the model read them", async () => {
    // These exist ONLY in the attachment, and only a reader of it knows them.
    // That is the beat's proof and it must not be settled away.
    const res = await call(asRead());
    expect(res.status).toBe(201);
    const { brief } = await res.json();
    expect(brief.hotelName).toBe("Casa Miraflores");
    expect(brief.confirmationNumber).toBe("CM-77Q4132");
    expect(brief.lastCheckInLocal).toBe("22:30");
    expect(brief.nightlyRateUsd).toBe(148);
  });

  it("belongs to the APPLICATION, not the thread", async () => {
    await call(asRead());
    const listed = await (await GET()).json();
    expect(listed.briefs).toHaveLength(1);
    // Nothing on the record references a thread, a run or a message.
    expect(JSON.stringify(listed)).not.toContain("thread");
    // …and it lands on the trip record too.
    expect(store.findBooking("bkg-av1423")?.log[0].kind).toBe("brief");
  });

  it("computes the collision NEITHER source could state alone", async () => {
    // AV1423 lands 22:05 + 55 late = 23:00; the desk closes at 22:30.
    const { brief } = await (await call(asRead())).json();
    expect(brief.arrivesAfterLastCheckIn).toBe(true);
    expect(brief.headline).toContain("AV1423");
    expect(brief.headline).toContain("23:00");
    expect(brief.headline).toContain("22:30");
  });

  it("says so when the flight is comfortably inside the deadline", async () => {
    const flight = store.flights().find((f) => f.id === "flt-av1423");
    if (!flight) throw new Error("missing flight");
    flight.delayMinutes = 0;
    const { brief } = await (
      await call(asRead({ lastCheckInLocal: "23:59" }))
    ).json();
    expect(brief.arrivesAfterLastCheckIn).toBe(false);
    expect(brief.headline).toContain("inside");
  });
});

describe("the LEDGER's facts are settled, in every direction", () => {
  it("OVERWRITES what the model read, on a unique match", async () => {
    // The over-filled case: a model copying a figure it had no business
    // supplying, so the artifact contradicts the document it was filed from.
    const { brief, settled } = await (
      await call(
        asRead({
          bookingRef: "AV9999",
          travelerName: "Somebody Else",
          arrivalStation: "BOG",
          arrivalLocal: "2026-01-01T00:00:00Z",
        }),
      )
    ).json();
    expect(brief.bookingRef).toBe("AV7QK2");
    expect(brief.travelerName).toBe("Camila Rojas");
    expect(brief.arrivalStation).toBe("LIM");
    expect(brief.arrivalLocal).toBe("2026-07-14T22:05:00-05:00");
    expect(settled).toEqual([
      "bookingRef",
      "travelerName",
      "arrivalStation",
      "arrivalLocal",
    ]);
  });

  it("FILLS what the model omitted, on the same match", async () => {
    // The under-filled mirror: omit the field and the card would otherwise
    // report an absence the app can disprove.
    const { brief } = await (await call(asRead())).json();
    expect(brief.bookingRef).toBe("AV7QK2");
    expect(brief.arrivalStation).toBe("LIM");
  });

  it("DROPS them, and says so, when nothing matches", async () => {
    // Absence of the row IS the answer. `??` is not settlement: it repairs the
    // under-filled case and stores the wrong one.
    const res = await call(
      asRead({ guestName: "Nobody At All", bookingRef: "AV7QK2" }),
    );
    const { brief, settled, unmatched, matchCount } = await res.json();
    expect(matchCount).toBe(0);
    expect(brief.bookingRef).toBeNull();
    expect(brief.travelerName).toBeNull();
    expect(brief.arrivalStation).toBeNull();
    expect(brief.arrivalLocal).toBeNull();
    expect(settled).toEqual([]);
    expect(unmatched).toHaveLength(4);
    // TRI-STATE, never `false`: nobody was able to make the comparison.
    expect(brief.arrivesAfterLastCheckIn).toBeNull();
    expect(brief.headline).toContain("could not be checked");
  });

  it("scopes the match by what the document is a statement ABOUT", async () => {
    // Guest + city + arrival date. Camila holds TWO Lima-side legs on one PNR,
    // so a match on city alone — or on the PNR — would look unsettleable.
    const camilaLimaBookings = store
      .bookings()
      .filter((b) => b.reference === "AV7QK2");
    expect(camilaLimaBookings).toHaveLength(2);
    const { matchCount } = await (await call(asRead())).json();
    expect(matchCount).toBe(1);
  });

  it("drops them when the document is ambiguous rather than picking one", async () => {
    const twin = store.bookings().find((b) => b.id === "bkg-av1188");
    const flight = store.flights().find((f) => f.id === "flt-av1188");
    if (!twin || !flight) throw new Error("missing fixture");
    // Make a second Camila booking arrive in Lima on the same day.
    flight.destinationCity = "Lima";
    flight.destination = "LIM";
    flight.arrivalLocal = "2026-07-14T20:00:00-05:00";

    const { brief, matchCount, unmatched } = await (
      await call(asRead())
    ).json();
    expect(matchCount).toBe(2);
    expect(brief.bookingRef).toBeNull();
    expect(unmatched).toHaveLength(4);
  });
});

describe("the document has to be readable", () => {
  it("names the fields it could not read, so the agent can go back for them", async () => {
    const res = await call(asRead({ hotelName: "  ", confirmationNumber: "" }));
    expect(res.status).toBe(422);
    const { error, message } = await res.json();
    expect(error).toBe("INCOMPLETE_DOCUMENT");
    expect(message).toContain("hotelName");
    expect(message).toContain("confirmationNumber");
    expect(store.briefs()).toEqual([]);
  });

  it("REFUSES a rate it cannot read rather than filing a $0 room", async () => {
    // `Number("")` is 0 and `Number(null)` is 0, so a bare coercion files a free
    // hotel room and nothing downstream can catch it.
    for (const rate of [null, "148", "", -5, 0, Number.NaN]) {
      const res = await call(asRead({ nightlyRateUsd: rate }));
      expect(res.status).toBe(422);
      expect((await res.json()).message).toContain("nightlyRateUsd");
    }
  });

  it("refuses a last check-in that is not a clock time", async () => {
    const res = await call(asRead({ lastCheckInLocal: "half ten" }));
    expect(res.status).toBe(422);
    expect((await res.json()).message).toContain("22:30");
  });

  it("400s a body that is not a JSON object", async () => {
    const res = await POST(
      new Request("http://localhost/x", { method: "POST", body: "nope" }),
    );
    expect(res.status).toBe(400);
  });
});
