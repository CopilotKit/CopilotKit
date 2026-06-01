import { z } from "zod";
import { tool } from "@langchain/core/tools";
import {
  createSurface,
  loadSchema,
  render,
  updateComponents,
  updateDataModel,
} from "./a2ui.js";

const CATALOG_ID = "copilotkit://app-dashboard-catalog";
const SURFACE_ID = "flight-search-results";

const FlightSchema = z.object({
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
});

let _cachedSchema: unknown[] | null = null;
async function flightSchema(): Promise<unknown[]> {
  if (_cachedSchema === null) {
    _cachedSchema = await loadSchema("a2ui/schemas/flight_schema.json");
  }
  return _cachedSchema;
}

export const search_flights = tool(
  async (input: { flights: z.infer<typeof FlightSchema>[] }) => {
    const schema = await flightSchema();
    return render([
      createSurface(SURFACE_ID, CATALOG_ID),
      updateComponents(SURFACE_ID, schema),
      updateDataModel(SURFACE_ID, { flights: input.flights }),
    ]);
  },
  {
    name: "search_flights",
    description:
      "Search for flights and display the results as rich cards. Return exactly 2 flights. " +
      "Each flight must have id, airline, airlineLogo (Google favicon API URL), flightNumber, " +
      "origin, destination, date (short readable), departureTime, arrivalTime, duration, " +
      "status, statusIcon (colored dot URL), and price.",
    schema: z.object({ flights: z.array(FlightSchema) }),
  },
);
