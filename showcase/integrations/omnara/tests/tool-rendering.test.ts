import assert from "node:assert/strict";
import { test } from "node:test";
import { toolRenderingHandlers } from "../src/lib/tool-rendering";
import { weatherTool } from "../src/lib/weather-tool";

test("weather exposes its schema and rejects malformed input", async () => {
  assert.equal(weatherTool.name, "get_weather");
  assert.deepEqual(weatherTool.parameters.required, ["location"]);
  assert.equal(weatherTool.parameters.properties.location.type, "string");
  assert.equal(toolRenderingHandlers.get_weather, weatherTool.handler);
  assert.deepEqual(await weatherTool.handler({ location: "Paris" }), {
    city: "Paris",
    temperature: 68,
    humidity: 55,
    wind_speed: 10,
    conditions: "Sunny",
  });
  for (const input of [undefined, null, [], "Paris", {}, { location: 42 }]) {
    await assert.rejects(
      weatherTool.handler(input),
      /location must be a string/,
    );
  }
});

test("fixture-controlled stock quotes and dice results remain deterministic", async () => {
  assert.deepEqual(
    await toolRenderingHandlers.get_stock_price({
      ticker: "aapl",
      price_usd: 123.456,
      change_pct: -1.236,
    }),
    { ticker: "AAPL", price_usd: 123.46, change_pct: -1.24 },
  );
  assert.deepEqual(await toolRenderingHandlers.roll_d20({ value: 17 }), {
    sides: 20,
    value: 17,
    result: 17,
  });
  const rolled = await toolRenderingHandlers.roll_d20({ value: 200 });
  assert.ok(rolled.value >= 1 && rolled.value <= 20);
});

test("flight results retain the reference demo contract", async () => {
  const result = await toolRenderingHandlers.search_flights({
    origin: "SFO",
    destination: "JFK",
  });
  assert.equal(result.origin, "SFO");
  assert.equal(result.destination, "JFK");
  assert.ok(result.flights.some((flight) => flight.flight === "UA231"));
});
