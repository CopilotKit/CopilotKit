"use client";

/**
 * Fixed A2UI catalog for the demo.
 *
 * `createCatalog` pins the agent's `component: "FlightCard"` ops to the
 * React `FlightCard` impl. Zod defines the prop shape; anything the agent
 * ships outside that shape is ignored. Each prop accepts either a literal
 * value or a `{ path }` binding into the A2UI data model.
 */

import { z } from "zod";
import { createCatalog } from "@copilotkit/a2ui-renderer";

import { FlightCard } from "./flight-card";

export const CATALOG_ID = "copilotkit://flight-fixed-catalog";

const pathBinding = z.object({ path: z.string() });
const stringOrBinding = z.union([z.string(), pathBinding]);

const flightCardDefinitions = {
  FlightCard: {
    description: "A flight card with origin, destination, airline, and price.",
    props: z.object({
      origin: stringOrBinding,
      destination: stringOrBinding,
      airline: stringOrBinding,
      price: stringOrBinding,
    }),
  },
};

export const fixedCatalog = createCatalog(
  flightCardDefinitions,
  { FlightCard },
  { catalogId: CATALOG_ID },
);
