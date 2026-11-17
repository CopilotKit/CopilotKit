/**
 * A2UI catalog definitions for the flight card.
 *
 * Each entry declares a component name and its Zod props schema. The basic
 * catalog (Card, Column, Row, Text, Button, ...) ships with CopilotKit and is
 * mixed in with `createCatalog(..., { includeBasicCatalog: true })`, so this
 * file declares only the additions and the visual overrides. A custom entry
 * with the name of a basic component replaces it.
 *
 * Path bindings: a field that the fixed schema binds to a data-model path
 * (for example `{ path: "/origin" }`) must accept both a string and
 * `{ path: string }`. The A2UI binder sees that union, treats the field as
 * dynamic and resolves the path against the data model at render time. With
 * a plain `z.string()`, the raw `{ path }` object would reach the renderer,
 * and React would throw (error #31, "object with keys {path}").
 *
 * A description that starts with `REF:common_types.json#/$defs/<Name>` marks
 * an A2UI common type. The catalog serializer turns it into a `$ref`.
 */
// @region[definitions-types]
import type { CatalogDefinitions } from "@copilotkit/a2ui-renderer";
import { z } from "../../_shared/a2ui-zod";

/**
 * Dynamic string: a literal or a data-model path binding. The A2UI binder
 * resolves a path binding to its value at render time.
 */
const DynString = z
  .union([z.string(), z.object({ path: z.string() })])
  .describe("REF:common_types.json#/$defs/DynamicString");

export const definitions = {
  /**
   * Card override: gives the outer flight card a ShadCN look (rounded-xl,
   * neutral-200 border, soft shadow) instead of the basic catalog's inline
   * styles, without changing the schema JSON.
   */
  Card: {
    description: "A container card with a single child.",
    props: z.object({
      child: z.string().describe("REF:common_types.json#/$defs/ComponentId"),
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
   * Button override: the renderer tracks its own `done` state, so after a
   * click "Book flight" changes to a "Booked" confirmation. The basic
   * catalog's Button is stateless: the click would send the action, but the
   * button would look unchanged.
   */
  Button: {
    description:
      "An interactive button with an action event. Use 'child' with a Text component ID for the label. After click, the button shows a confirmation state.",
    props: z.object({
      child: z
        .string()
        .describe(
          "REF:common_types.json#/$defs/ComponentId|The ID of the child component for the label.",
        ),
      variant: z.enum(["primary", "secondary", "ghost"]).optional(),
      // The union with `{ event }` makes the binder resolve this prop as an
      // action: the renderer receives a function that sends it.
      action: z
        .union([
          z.object({
            event: z.object({
              name: z.string(),
              context: z.record(z.unknown()).optional(),
            }),
          }),
          z.null(),
        ])
        .optional()
        .describe("REF:common_types.json#/$defs/Action"),
    }),
  },
} satisfies CatalogDefinitions;
// @endregion[definitions-types]

export type Definitions = typeof definitions;
