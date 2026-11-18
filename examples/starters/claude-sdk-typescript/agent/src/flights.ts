/**
 * Flight search tool — returns the flights as data.
 *
 * The agent renders them with the runtime's `render_ui` tool, as `FlightCard`
 * components of the app's generative UI catalog
 * (src/app/declarative-generative-ui/).
 */

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const flightSchema = z.object({
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
  price: z.string(),
});

export const searchFlights = tool(
  "search_flights",
  `Search for flights. Return exactly 2 flights.

Each flight must have: id, airline (e.g. "United Airlines"),
airlineLogo (use Google favicon API: https://www.google.com/s2/favicons?domain={airline_domain}&sz=128
e.g. "https://www.google.com/s2/favicons?domain=united.com&sz=128" for United,
"https://www.google.com/s2/favicons?domain=delta.com&sz=128" for Delta,
"https://www.google.com/s2/favicons?domain=aa.com&sz=128" for American,
"https://www.google.com/s2/favicons?domain=alaskaair.com&sz=128" for Alaska),
flightNumber, origin, destination,
date (short readable format like "Tue, Mar 18" — use near-future dates),
departureTime, arrivalTime,
duration (e.g. "4h 25m"), status ("On Time", "Delayed" or "Cancelled"),
and price (e.g. "$289").

Then show the flights with render_ui: a Row with one FlightCard per
flight, each value copied from the result.`,
  { flights: z.array(flightSchema) },
  async (args) => ({
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ flights: args.flights ?? [] }),
      },
    ],
  }),
);
