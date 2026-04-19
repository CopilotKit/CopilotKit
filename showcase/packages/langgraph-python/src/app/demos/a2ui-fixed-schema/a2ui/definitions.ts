/**
 * A2UI catalog DEFINITIONS — platform-agnostic.
 *
 * Each entry declares a component name + its Zod props schema. The basic
 * catalog (Card, Column, Row, Text, Button, …) ships with CopilotKit and
 * is mixed in via `createCatalog(..., { includeBasicCatalog: true })`, so
 * we only declare the project-specific additions here.
 *
 * IMPORTANT — path bindings: fields that can be bound to a data-model path
 * (e.g. `{ path: "/origin" }` in the fixed schema JSON) must declare their
 * Zod type as a union of `z.string()` and `z.object({ path: z.string() })`.
 * The A2UI `GenericBinder` uses this union to detect the field as dynamic
 * and resolve the path against the current data model at render time. Using
 * plain `z.string()` causes the raw `{ path }` object to reach the
 * renderer, which React then throws on (error #31 "object with keys {path}").
 * This matches the canonical catalog's `DynString` helper:
 *   examples/integrations/langgraph-python/src/app/declarative-generative-ui/definitions.ts
 */
import { z } from "zod";
import type { CatalogDefinitions } from "@copilotkit/a2ui-renderer";

/**
 * Dynamic string: literal OR a data-model path binding. The GenericBinder
 * resolves path bindings to the actual value at render time.
 */
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
} satisfies CatalogDefinitions;
// @endregion[definitions-types]

export type FlightDefinitions = typeof flightDefinitions;
