/**
 * A2UI catalog DEFINITIONS — platform-agnostic.
 *
 * Each entry declares a component name + its Zod props schema. The basic
 * catalog (Card, Column, Row, Text, Button, …) ships with CopilotKit and
 * is mixed in via `createCatalog(..., { includeBasicCatalog: true })`.
 */
import { z } from "zod";
import type { CatalogDefinitions } from "@copilotkit/a2ui-renderer";

/** Dynamic string: literal OR a data-model path binding. */
const DynString = z.union([z.string(), z.object({ path: z.string() })]);

// @region[definitions-types]
export const flightDefinitions = {
  Title: {
    description: "A prominent heading for the flight card.",
    props: z.object({
      text: DynString,
    }),
  },
  Airport: {
    description: "A 3-letter airport code, displayed large.",
    props: z.object({
      code: DynString,
    }),
  },
  Arrow: {
    description: "A right-pointing arrow used between airports.",
    props: z.object({}),
  },
  AirlineBadge: {
    description: "A pill-styled airline name tag.",
    props: z.object({
      name: DynString,
    }),
  },
  PriceTag: {
    description: "A stylized price display (e.g. '$289').",
    props: z.object({
      amount: DynString,
    }),
  },
  Button: {
    description:
      "An interactive button with an action event. Use 'child' with a Text component ID for the label.",
    props: z.object({
      child: z
        .string()
        .describe(
          "The ID of the child component (e.g. a Text component for the label).",
        ),
      variant: z.enum(["primary", "secondary", "ghost"]).optional(),
      action: z
        .union([
          z.object({
            event: z.object({
              name: z.string(),
              context: z.record(z.any()).optional(),
            }),
          }),
          z.null(),
        ])
        .optional(),
    }),
  },
} satisfies CatalogDefinitions;
// @endregion[definitions-types]

export type FlightDefinitions = typeof flightDefinitions;
