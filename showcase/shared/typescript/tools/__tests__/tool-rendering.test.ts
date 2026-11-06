import { describe, expect, it } from "vitest";

describe("shared tool-rendering handlers", () => {
  it("preserves fixture-controlled quotes and dice results", async () => {
    const { toolRenderingHandlers } = await import("../tool-rendering");
    expect(
      await toolRenderingHandlers.get_stock_price({
        ticker: "aapl",
        price_usd: 123.456,
        change_pct: -1.236,
      }),
    ).toEqual({
      ticker: "AAPL",
      price_usd: 123.46,
      change_pct: -1.24,
    });
    expect(await toolRenderingHandlers.roll_d20({ value: 17 })).toEqual({
      sides: 20,
      value: 17,
      result: 17,
    });
    const rolled = await toolRenderingHandlers.roll_d20({ value: 200 });
    expect(rolled.value).toBeGreaterThanOrEqual(1);
    expect(rolled.value).toBeLessThanOrEqual(20);
  });

  it("retains the reference weather and flight contracts", async () => {
    const { toolRenderingHandlers } = await import("../tool-rendering");
    expect(
      await toolRenderingHandlers.get_weather({ location: "Paris" }),
    ).toMatchObject({ city: "Paris", temperature: 68 });
    expect(
      await toolRenderingHandlers.search_flights({
        origin: "SFO",
        destination: "JFK",
      }),
    ).toMatchObject({
      origin: "SFO",
      destination: "JFK",
      flights: expect.arrayContaining([
        expect.objectContaining({ flight: "UA231" }),
      ]),
    });
  });
});
