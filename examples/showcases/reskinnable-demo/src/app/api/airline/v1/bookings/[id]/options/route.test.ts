import { describe, it, expect, beforeEach } from "vitest";
import { GET } from "./route";
import * as store from "@/skins/airline/data/store";

beforeEach(() => store.reset());

const call = (id: string, query = "") =>
  GET(new Request(`http://localhost/x${query ? `?${query}` : ""}`), {
    params: Promise.resolve({ id }),
  });

describe("GET /bookings/[id]/options", () => {
  it("returns every option unfiltered when no lever is pulled", async () => {
    const body = await (await call("bkg-av1466")).json();
    expect(body.total).toBe(30);
    expect(body.matchingCount).toBe(30);
    expect(body.visibleCount).toBe(30);
    expect(body.levers).toEqual({
      window: null,
      stops: null,
      cabin: null,
      sort: null,
      top: null,
    });
  });

  it("publishes BOTH counts under beat 3c's own lever set", async () => {
    // `matchingCount` is what a "Top 5 of N" caption's denominator must be.
    // Commerce shipped the unfiltered length there and the one number the room
    // reads as proof of the maneuver said the filters did nothing.
    const body = await (
      await call(
        "bkg-av1466",
        "window=evening&stops=nonstop&sort=price_asc&top=5",
      )
    ).json();
    expect(body.total).toBe(30);
    expect(body.matchingCount).toBe(10);
    expect(body.visibleCount).toBe(5);
    expect(body.options).toHaveLength(5);
    const prices = body.options.map(
      (o: { fareDifferenceUsd: number }) => o.fareDifferenceUsd,
    );
    expect([...prices].sort((a: number, b: number) => a - b)).toEqual(prices);
  });

  it("leaves several rows under a realistic filter", async () => {
    // "A one-row board is indistinguishable from a broken filter on stage."
    const body = await (
      await call("bkg-av1466", "window=evening&stops=nonstop")
    ).json();
    expect(body.matchingCount).toBeGreaterThanOrEqual(5);
  });

  it("ignores a lever value the page cannot honour", async () => {
    const body = await (
      await call("bkg-av1466", "window=midnight&cabin=first&top=-3")
    ).json();
    expect(body.levers).toEqual({
      window: null,
      stops: null,
      cabin: null,
      sort: null,
      top: null,
    });
    expect(body.matchingCount).toBe(30);
  });

  it("drops the not-pulled sentinel to no filter at all", async () => {
    const body = await (
      await call("bkg-av1466", "window=all&stops=all&cabin=all&sort=all&top=0")
    ).json();
    expect(body.matchingCount).toBe(30);
  });

  it("scopes to the booking asked for", async () => {
    const body = await (await call("bkg-av7702")).json();
    expect(body.total).toBe(3);
    expect(
      body.options.every(
        (o: { bookingId: string }) => o.bookingId === "bkg-av7702",
      ),
    ).toBe(true);
  });

  it("404s an unknown booking and 409s an ambiguous PNR", async () => {
    expect((await call("nope")).status).toBe(404);
    expect((await call("AV7QK2")).status).toBe(409);
  });
});
