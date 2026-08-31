import { describe, it, expect, beforeEach } from "vitest";
import { GET } from "./route";
import * as store from "@/skins/airline/data/store";

beforeEach(() => store.reset());

const call = (id: string) =>
  GET(new Request("http://localhost/x"), {
    params: Promise.resolve({ id }),
  });

describe("GET /bookings/[id]", () => {
  it("resolves by id and by PNR", async () => {
    expect((await (await call("bkg-av2214")).json()).booking.reference).toBe(
      "AV3PL9",
    );
    expect((await (await call("AV3PL9")).json()).booking.id).toBe("bkg-av2214");
  });

  it("409s a PNR held by two legs rather than picking one", async () => {
    const res = await call("AV7QK2");
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("AMBIGUOUS_REFERENCE");
    expect(body.matches.sort()).toEqual(["bkg-av1423", "bkg-av1466"]);
  });

  it("404s an unknown booking", async () => {
    expect((await call("ZZ0000")).status).toBe(404);
  });

  it("derives `changeable` from the SAME gate the write path runs", async () => {
    // A read that advertised a change the gate would refuse (or hid one it would
    // allow) is the confident falsehood version of this endpoint.
    const permitted = await (await call("bkg-av7702")).json();
    expect(permitted.changeable).toBe(true);
    expect(permitted.permission).toBe("fare_permits");
    expect(permitted.refusal).toBeNull();

    const refused = await (await call("bkg-av2214")).json();
    expect(refused.changeable).toBe(false);
    expect(refused.permission).toBeNull();
    expect(refused.refusal).toContain("Basic Economy");
  });

  it("does not leak the ground or the way through", async () => {
    const body = await (await call("bkg-av2214")).text();
    expect(body).not.toContain("waiverGround");
    expect(body).not.toContain("schedule_change");
    expect(body.toLowerCase()).not.toContain("exception categor");
  });

  it("carries the flight and the traveler the booking belongs to", async () => {
    const body = await (await call("bkg-av0918")).json();
    expect(body.flight.flightNumber).toBe("AV0918");
    expect(body.traveler.name).toBe("Inés Vidal");
  });
});
