/**
 * A2UI catalog DEFINITIONS — platform-agnostic.
 *
 * Each entry declares a component name + its Zod props schema. The basic
 * catalog (Card, Column, Row, Text, Button, …) ships with CopilotKit and
 * is mixed in via `createCatalog(..., { includeBasicCatalog: true })`, so
 * we only declare the project-specific additions and the visual overrides
 * here. (Custom entries with the same name as a basic component override
 * the basic one — Catalog dedupes by `comp.name`, last-write-wins.)
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
export const definitions = {
  /**
   * Card override: gives the outer flight-card container a ShadCN look
   * (rounded-xl, neutral-200 border, soft shadow). The basic catalog's
   * Card uses inline styles; overriding here lets the demo's renderer
   * adopt the demo's Tailwind aesthetic without touching the schema JSON.
   */
  Card: {
    description: "A container card with a single child.",
    props: z.object({
      child: z.string(),
    }),
  },
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
  /**
   * Button override: swaps in an ActionButton renderer that tracks
   * its own `done` state so clicking "Book flight" visually updates to
   * a "Booked ✓" confirmation. The basic catalog's Button is stateless,
   * so without this override the click fires the action but the button
   * looks unchanged. Mirrors the pattern in beautiful-chat
   * (src/app/demos/beautiful-chat/declarative-generative-ui/renderers.tsx).
   */
  Button: {
    description:
      "An interactive button with an action event. Use 'child' with a Text component ID for the label. After click, the button shows a confirmation state.",
    props: z.object({
      child: z
        .string()
        .describe(
          "The ID of the child component (e.g. a Text component for the label).",
        ),
      variant: z.enum(["primary", "secondary", "ghost"]).optional(),
      // Union with { event } so GenericBinder resolves this as ACTION → callable () => void.
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

export type Definitions = typeof definitions;
