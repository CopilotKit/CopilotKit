import { describe, it, expect, beforeEach } from "vitest";
import { POST } from "./route";
import * as store from "@/skins/airline/data/store";
import { SEAT_PREFERENCES } from "@/skins/airline/data/handling";

beforeEach(() => store.reset());

const call = (id: string, body: unknown) =>
  POST(
    new Request("http://localhost/x", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );

describe("POST /bookings/[id]/seat — beat 5, step 2", () => {
  it("takes a PREFERENCE and picks the seat itself", async () => {
    // The caller never names a seat: a model would invent one, and a booking
    // confirming a seat that does not exist is the confident falsehood this app
    // fails toward.
    const res = await call("bkg-av1423", { preference: "aisle" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.seat).toBe("3C");
    expect(body.preference).toBe("aisle");
    expect(store.findBooking("bkg-av1423")?.seat).toBe("3C");
  });

  it("honours every preference the vocabulary advertises", async () => {
    for (const preference of SEAT_PREFERENCES) {
      store.reset();
      const res = await call("bkg-av1423", { preference });
      expect(res.status).toBe(200);
    }
  });

  it("REFUSES rather than approximating when nothing matches", async () => {
    const flight = store.flights().find((f) => f.id === "flt-av1423");
    if (!flight) throw new Error("missing flight");
    flight.availableSeats = ["11B", "14E"];
    const res = await call("bkg-av1423", { preference: "aisle" });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("NO_SEAT_AVAILABLE");
    // The passenger keeps the seat they had.
    expect(store.findBooking("bkg-av1423")?.seat).toBe("14C");
  });

  it("enumerates the vocabulary in its refusal — it is GIVEN to the agent", async () => {
    // The exact opposite of beat 6's catalogue, and the contrast is the point.
    const res = await call("bkg-av1423", { preference: "bulkhead" });
    expect(res.status).toBe(422);
    const message = (await res.json()).message;
    for (const preference of SEAT_PREFERENCES) {
      expect(message).toContain(preference);
    }
  });

  it("reseats onto the itinerary the booking is on NOW", async () => {
    const booking = store.findBooking("bkg-av1466");
    const option = store.options().find((o) => o.id === "o-1478-j");
    if (!booking || !option) throw new Error("missing fixture");
    store.reissueBooking(booking, option, 0, "involuntary");
    const res = await call("bkg-av1466", { preference: "aisle" });
    // Business cabin, so the seat comes from the business pool, not economy's —
    // whose most forward aisle seat is 6C, a row the business pool does not have.
    expect((await res.json()).seat).toBe("2D");
  });

  it("400s a bad body, 404s an unknown booking, 409s an ambiguous PNR", async () => {
    const bad = await POST(
      new Request("http://localhost/x", { method: "POST", body: "nope" }),
      { params: Promise.resolve({ id: "bkg-av1423" }) },
    );
    expect(bad.status).toBe(400);
    expect((await call("nope", { preference: "aisle" })).status).toBe(404);
    expect((await call("AV7QK2", { preference: "aisle" })).status).toBe(409);
  });
});
