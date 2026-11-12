import assert from "node:assert/strict";
import test from "node:test";

import { type Flight, searchFlights } from "./flights.js";

const flight: Flight = {
  id: "1",
  airline: "United Airlines",
  airlineLogo: "https://www.google.com/s2/favicons?domain=united.com&sz=128",
  flightNumber: "UA 123",
  origin: "SFO",
  destination: "JFK",
  date: "Tue, Mar 18",
  departureTime: "08:00",
  arrivalTime: "16:25",
  duration: "5h 25m",
  status: "On Time",
  price: "$289",
};

test("returns the flights as data for render_ui", async () => {
  const flights = [flight, { ...flight, id: "2", flightNumber: "UA 456" }];
  const result = await searchFlights.invoke({ flights });
  assert.equal(result, JSON.stringify({ flights }));
});

test("takes the same flight fields as the north star", () => {
  const { inputSchema } = searchFlights.toolSpec;
  const items = (
    inputSchema as {
      properties: {
        flights: { items: { required: string[]; properties: object } };
      };
    }
  ).properties.flights.items;
  const fields = [
    "id",
    "airline",
    "airlineLogo",
    "flightNumber",
    "origin",
    "destination",
    "date",
    "departureTime",
    "arrivalTime",
    "duration",
    "status",
    "price",
  ];
  assert.deepEqual(Object.keys(items.properties), fields);
  assert.deepEqual(items.required, fields);
});
