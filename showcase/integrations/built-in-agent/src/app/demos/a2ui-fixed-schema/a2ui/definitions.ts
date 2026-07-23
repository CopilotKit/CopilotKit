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
 *
 * ZOD VERSION (load-bearing): these defs are authored with **Zod 3** (the
 * `zod-v3` alias), NOT the package's root `zod@4`. `@a2ui/web_core@0.9.0`'s
 * `GenericBinder.scrapeSchemaBehavior` classifies a field as DYNAMIC (and thus
 * resolves its `{ path }` binding) by inspecting **Zod 3** schema internals
 * (`_def.typeName === "ZodUnion"`, the union's `_def.options`, an option's
 * `_def.shape().path`). A Zod-4 schema reports `_def.typeName === undefined`
 * (Zod 4 moved to `_def.type === "union"`), so the binder MISCLASSIFIES the
 * field STATIC and passes the raw `{ path: "/origin" }` object through to the
 * renderer → React error #31 ("object with keys {path}") crashes the page.
 * web_core bundles its own `zod@3.25.x`; authoring these defs with a matching
 * Zod 3 makes the union recognizable so the binder resolves `{ path }` → "SFO".
 * (`scrapeSchemaBehavior` compares `_def.typeName` by string, not `instanceof`,
 * so a separate Zod-3 module instance is recognized identically.)
 */
// @region[definitions-types]
import { z } from "zod-v3";
import type { CatalogDefinitions } from "@copilotkit/a2ui-renderer";

/**
 * Dynamic string: literal OR a data-model path binding. The GenericBinder
 * resolves path bindings to the actual value at render time.
 */
const DynString = z.union([z.string(), z.object({ path: z.string() })]);

export const flightDefinitions = {
  /**
   * Card override: gives the outer flight-card container a stable
   * `data-testid` for D6 e2e selectors. The basic catalog's Card ships
   * its own renderer; declaring `Card` here lets us swap in a thin React
   * component without otherwise altering layout.
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
              context: z.record(z.string(), z.any()).optional(),
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
