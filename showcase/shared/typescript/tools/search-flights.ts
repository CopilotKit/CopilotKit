/** Fixed-schema A2UI flight results shared by TypeScript showcase agents. */
import type { Flight } from "./types";
import type { A2UIOperation } from "./generate-a2ui";

const SURFACE_ID = "flight-search-results";

/** Return the surface, component template, and data needed for live and saved rendering. */
export function searchFlightsImpl(flights: Flight[]): {
  flights: Flight[];
  a2ui_operations: A2UIOperation[];
} {
  return {
    // Plain tool renderers in Strands and Mastra still consume this field.
    flights,
    a2ui_operations: [
      {
        version: "v0.9",
        createSurface: {
          surfaceId: SURFACE_ID,
          catalogId: "copilotkit://app-dashboard-catalog",
        },
      },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: SURFACE_ID,
          components: [
            {
              id: "root",
              component: "Row",
              children: { componentId: "flight-card", path: "/flights" },
              gap: 16,
            },
            {
              id: "flight-card",
              component: "FlightCard",
              airline: { path: "airline" },
              airlineLogo: { path: "airlineLogo" },
              flightNumber: { path: "flightNumber" },
              origin: { path: "origin" },
              destination: { path: "destination" },
              date: { path: "date" },
              departureTime: { path: "departureTime" },
              arrivalTime: { path: "arrivalTime" },
              duration: { path: "duration" },
              status: { path: "status" },
              statusColor: { path: "statusColor" },
              price: { path: "price" },
              action: {
                event: {
                  name: "book_flight",
                  context: {
                    flightNumber: { path: "flightNumber" },
                    origin: { path: "origin" },
                    destination: { path: "destination" },
                    price: { path: "price" },
                  },
                },
              },
            },
          ],
        },
      },
      {
        version: "v0.9",
        updateDataModel: {
          surfaceId: SURFACE_ID,
          path: "/",
          value: { flights },
        },
      },
    ],
  };
}
