/**
 * A2UI catalog DEFINITIONS — platform-agnostic.
 *
 * Each entry declares a component name + its Zod props schema. The basic
 * catalog (Card, Column, Row, Text, Button, …) ships with CopilotKit and
 * is mixed in via `createCatalog(..., { includeBasicCatalog: true })`, so
 * we only declare the project-specific additions here.
 *
 * Paths like `{ path: "/origin" }` are resolved by the A2UI binder before
 * the React renderer runs — so props are typed as their *resolved* value
 * (plain `z.string()`), not as a path-or-literal union.
 */
import { z } from "zod";
import type { CatalogDefinitions } from "@copilotkit/a2ui-renderer";

// @region[definitions-types]
export const flightDefinitions = {
  Title: {
    description: "A prominent heading for the flight card.",
    props: z.object({
      text: z.string(),
    }),
  },
  Airport: {
    description: "A 3-letter airport code, displayed large.",
    props: z.object({
      code: z.string(),
    }),
  },
  Arrow: {
    description: "A right-pointing arrow used between airports.",
    props: z.object({}),
  },
  AirlineBadge: {
    description: "A pill-styled airline name tag.",
    props: z.object({
      name: z.string(),
    }),
  },
  PriceTag: {
    description: "A stylized price display (e.g. '$289').",
    props: z.object({
      amount: z.string(),
    }),
  },
} satisfies CatalogDefinitions;
// @endregion[definitions-types]

export type FlightDefinitions = typeof flightDefinitions;
