import { describe, it, expect } from "vitest";
import { searchFlightsImpl } from "../search-flights";
import type { Flight } from "../types";

describe("searchFlightsImpl", () => {
  const mockFlight: Flight = {
    airline: "Test Air",
    airlineLogo: "https://example.com/logo.png",
    flightNumber: "TA100",
    origin: "SFO",
    destination: "JFK",
    date: "Tue, Apr 15",
    departureTime: "08:00",
    arrivalTime: "16:00",
    duration: "5h",
    status: "On Time",
    statusColor: "#22c55e",
    price: "$299",
    currency: "USD",
  };

  it("returns flights and schema", () => {
    const result = searchFlightsImpl([mockFlight]);
    expect(result).toHaveProperty("flights");
    expect(result).toHaveProperty("schema");
  });

  it("passes flights through unchanged", () => {
    const result = searchFlightsImpl([mockFlight]);
    expect(result.flights).toHaveLength(1);
    expect(result.flights[0]).toEqual(mockFlight);
  });

  it("returns empty schema object", () => {
    const result = searchFlightsImpl([mockFlight]);
    expect(result.schema).toEqual({});
  });

  it("handles empty flights array", () => {
    const result = searchFlightsImpl([]);
    expect(result.flights).toHaveLength(0);
  });

  it("handles multiple flights", () => {
    const result = searchFlightsImpl([
      mockFlight,
      { ...mockFlight, flightNumber: "TA200" },
    ]);
    expect(result.flights).toHaveLength(2);
    expect(result.flights[1].flightNumber).toBe("TA200");
  });
});
