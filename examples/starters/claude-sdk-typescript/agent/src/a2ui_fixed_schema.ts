/**
 * Fixed-schema A2UI tool — flight search results.
 *
 * The A2UI component schema is loaded from JSON; only the flight data changes
 * per call. The tool result carries `a2ui_operations`, which the frontend renders.
 */

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import {
  createSurface,
  loadSchema,
  render,
  updateComponents,
  updateDataModel,
} from "./a2ui";

export const CATALOG_ID = "copilotkit://app-dashboard-catalog";
const FLIGHT_SURFACE_ID = "flight-search-results";
const FLIGHT_SCHEMA: unknown[] = loadSchema("a2ui/schemas/flight_schema.json");

const flightSchema = {
  flights: z
    .array(
      z.object({
        id: z.string(),
        airline: z.string(),
        airlineLogo: z.string(),
        flightNumber: z.string(),
        origin: z.string(),
        destination: z.string(),
        date: z.string(),
        departureTime: z.string(),
        arrivalTime: z.string(),
        duration: z.string(),
        status: z.string(),
        statusIcon: z.string(),
        price: z.string(),
      }),
    )
    .describe("The list of flights to display as cards."),
};

export const searchFlights = tool(
  "search_flights",
  "Search for flights and display the results as rich cards. Return exactly " +
    "2 flights. Each flight must have: id, airline, airlineLogo (Google favicon " +
    "API URL for the airline domain), flightNumber, origin, destination, date " +
    '(e.g. "Tue, Mar 18" — use near-future dates), departureTime, arrivalTime, ' +
    'duration (e.g. "4h 25m"), status (e.g. "On Time" or "Delayed"), statusIcon ' +
    "(colored dot URL: https://placehold.co/12/22c55e/22c55e.png for On Time, " +
    "https://placehold.co/12/eab308/eab308.png for Delayed), and price " +
    '(e.g. "$289").',
  flightSchema,
  async (args) => ({
    content: [
      {
        type: "text" as const,
        text: render([
          createSurface(FLIGHT_SURFACE_ID, CATALOG_ID),
          updateComponents(FLIGHT_SURFACE_ID, FLIGHT_SCHEMA),
          updateDataModel(FLIGHT_SURFACE_ID, { flights: args.flights ?? [] }),
        ]),
      },
    ],
  }),
);
