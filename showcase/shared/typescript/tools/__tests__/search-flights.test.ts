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

  it("emits a renderable A2UI surface with the flight data", () => {
    expect(searchFlightsImpl([mockFlight])).toMatchObject({
      a2ui_operations: [
        {
          version: "v0.9",
          createSurface: {
            surfaceId: "flight-search-results",
            catalogId: "copilotkit://app-dashboard-catalog",
          },
        },
        {
          version: "v0.9",
          updateComponents: {
            surfaceId: "flight-search-results",
            components: expect.arrayContaining([
              {
                id: "root",
                component: "Row",
                children: { componentId: "flight-card", path: "/flights" },
                gap: 16,
              },
              expect.objectContaining({
                id: "flight-card",
                component: "FlightCard",
                airline: { path: "airline" },
                price: { path: "price" },
              }),
            ]),
          },
        },
        {
          version: "v0.9",
          updateDataModel: {
            surfaceId: "flight-search-results",
            path: "/",
            value: { flights: [mockFlight] },
          },
        },
      ],
    });
  });

  it.each(
    [
      [],
      [mockFlight],
      [mockFlight, { ...mockFlight, flightNumber: "TA200" }],
    ].map((flights) => ({ flights })),
  )(
    "provides the same flights to plain renderers and A2UI: %j",
    ({ flights }) => {
      const result = searchFlightsImpl(flights);
      expect(result.flights).toEqual(flights);
      expect(result).toMatchObject({
        a2ui_operations: expect.arrayContaining([
          {
            version: "v0.9",
            updateDataModel: {
              surfaceId: "flight-search-results",
              path: "/",
              value: { flights },
            },
          },
        ]),
      });
    },
  );
});
