import { z } from "zod";
import {
  ActionSchema,
  ChildListSchema,
  DataBindingSchema,
  DynamicNumberSchema,
} from "@a2ui/web_core/v0_9";
import type { CatalogDefinitions } from "../../../../create-catalog";
import {
  ALIGN,
  JUSTIFY,
  WRAP,
  RADII,
  BACKGROUNDS,
  BORDER_COLORS,
} from "../tokens";

/**
 * A literal value or a `{ "path": "/x" }` data binding, for array/object props
 * that web_core has no Dynamic* schema for. The generic binder classifies any
 * union with a `{ path }` member (and no `componentId`) as DYNAMIC, so it
 * subscribes to the path and hands the renderer the resolved data-model value;
 * literals pass through unchanged. Renderers therefore never see `{ path }`.
 * Relative paths resolve against the component's data context (template item).
 */
export const bindable = <T extends z.ZodTypeAny>(schema: T) =>
  z.union([schema, DataBindingSchema]);

/** Number = 4px steps; string = raw CSS. */
export const sizeValue = z.union([z.number(), z.string()]);

export const radiusValue = z.union([
  z.enum(RADII),
  z.number(),
  z.string(),
  z.object({
    topLeft: z.string().optional(),
    topRight: z.string().optional(),
    bottomLeft: z.string().optional(),
    bottomRight: z.string().optional(),
  }),
]);

/**
 * Child component ids. A plain string array (not A2UI's `ChildListSchema`),
 * so renderers receive ids and render each with `children(id)`.
 */
export const childIds = z
  .array(z.string())
  .optional()
  .describe("Child component IDs");

/**
 * Children as static ids or a template `{ componentId, path }` that repeats
 * `componentId` once per element of the data-model array at `path`. Built on
 * A2UI's `ChildListSchema` so the generic binder expands templates; render
 * with `renderChildList`.
 */
export const childList = ChildListSchema.optional().describe(
  'Child IDs, or a template { "componentId": "row", "path": "/rows" } repeated per array item',
);

/** Layout props shared by every container. */
export const layoutProps = {
  children: childList,
  align: z.enum(ALIGN).optional(),
  justify: z.enum(JUSTIFY).optional(),
  wrap: z.enum(WRAP).optional(),
  gap: sizeValue.optional().describe("4px steps when a number"),
  rowGap: sizeValue.optional(),
  columnGap: sizeValue.optional(),
  padding: sizeValue.optional().describe("4px steps when a number"),
  background: z
    .string()
    .optional()
    .describe(
      `One of ${BACKGROUNDS.join("|")} or a CSS color. Leave unset; at most one summary panel per Card may use "surface-secondary"`,
    ),
  border: z.boolean().optional(),
  borderColor: z.enum(BORDER_COLORS).optional(),
  radius: radiusValue.optional(),
  width: sizeValue.optional(),
  height: sizeValue.optional(),
  minWidth: sizeValue.optional(),
  maxWidth: sizeValue.optional(),
  minHeight: sizeValue.optional(),
  maxHeight: sizeValue.optional(),
  flex: z.number().optional(),
  aspectRatio: z.string().optional(),
  scrollable: z.boolean().optional(),
  clip: z.boolean().optional(),
  shadow: z.boolean().optional(),
  inline: z.boolean().optional(),
  role: z.string().optional().describe("ARIA role"),
  flush: z.boolean().optional().describe("No padding"),
  minSize: sizeValue.optional().describe("Minimum width and height"),
  maxSize: sizeValue.optional().describe("Maximum width and height"),
  disableAutoSpacing: z
    .boolean()
    .optional()
    .describe("No default gap between children"),
  onVisible: ActionSchema.optional().describe(
    "Dispatched once when the container first scrolls into view",
  ),
};

export type LayoutProps = z.infer<z.ZodObject<typeof layoutProps>>;

export const layoutDefinitions = {
  Box: {
    description:
      "Generic flex container (column by default). Use for grouping with gap/padding/border/radius/background.",
    props: z.object({
      ...layoutProps,
      direction: z.enum(["col", "row"]).optional().describe('Default "col"'),
    }),
  },
  Column: {
    description:
      "Vertical flex container. The default gap already separates sections: no padding, background or Spacer to compensate.",
    props: z.object(layoutProps),
  },
  Row: {
    description:
      'Horizontal flex container. A label/value pair is a Row with justify "between": Caption on the left, Text weight "medium" on the right. Buttons go in a Row at the bottom of a Card: one primary Button, the rest variant "ghost".',
    props: z.object(layoutProps),
  },
  Grid: {
    description: "CSS grid container.",
    props: z.object({
      ...layoutProps,
      columns: z
        .union([z.number(), z.string()])
        .optional()
        .describe("Column count or CSS template; default 2"),
      minChildWidth: sizeValue.optional(),
      rows: z.union([z.number(), z.string()]).optional(),
    }),
  },
  GridItem: {
    description:
      "Grid cell with optional span; a span covering every rendered column fills the row.",
    props: z.object({
      ...layoutProps,
      span: z.number().optional(),
      rowSpan: z.number().optional(),
    }),
  },
  Card: {
    description:
      'Bordered, padded container for an interactive panel only (controls, a form, a configurator); tables, charts and text never need one. Give it a Title and a Caption; separate groups inside with Divider or plain gap, never a nested Card or a bordered Box. variant "section" = heading plus content without a box; "outline" = always boxed. In markdown mode a Card without controls renders as "section" unless it sets variant or border.',
    props: z.object({
      ...layoutProps,
      variant: z
        .enum([
          "default",
          "outline",
          "section",
          "soft",
          "elevated",
          "transparent",
        ])
        .optional(),
      shadowStyle: z
        .enum(["none", "sm", "md"])
        .optional()
        .describe("Overrides the variant's shadow"),
      size: z
        .enum(["sm", "md", "lg"])
        .optional()
        .describe('Padding preset 8/16/24px; default "md"'),
    }),
  },
  Flow: {
    description: "Masonry-like flow grid.",
    props: z.object({
      ...layoutProps,
      columns: z.number().optional(),
      rows: z.number().optional(),
      layout: z.enum(["pack", "fixed"]).optional().describe('Default "pack"'),
    }),
  },
  FlowItem: {
    description: "Flow cell.",
    props: z.object({
      ...layoutProps,
      span: z.number().optional(),
      rowSpan: z.number().optional(),
      aspectRatio: z.string().optional().describe('Default "1 / 1"'),
      aspectMode: z.enum(["soft", "fixed"]).optional(),
    }),
  },
  Carousel: {
    description: "Horizontally scrolling row with snap.",
    props: z.object({
      ...layoutProps,
      visibleItems: z.number().optional(),
      showArrows: z.boolean().optional().describe("Default true"),
      activeIndex: DynamicNumberSchema.optional().describe(
        'Index of the snapped item; bind with { "path": "/x" } to read or set it',
      ),
      previousLabel: z.string().optional().describe('Default "Previous"'),
      nextLabel: z.string().optional().describe('Default "Next"'),
      ariaLabel: z.string().optional(),
      snap: z.enum(["none", "proximity", "mandatory"]).optional(),
      snapAlign: z.enum(["start", "center", "end"]).optional(),
    }),
  },
  CarouselItem: {
    description: "Carousel slide.",
    props: z.object(layoutProps),
  },
  CarouselMediaItem: {
    description:
      'Carousel slide with an image on top and children (a caption, a Text) under it. size "sm" 160px, "md" 240px (default), "lg" 320px wide.',
    props: z.object({
      ...layoutProps,
      media: z.string().describe("Image URL"),
      alt: z.string().optional(),
      size: z.enum(["sm", "md", "lg"]).optional().describe('Default "md"'),
      aspectRatio: z.string().optional().describe('Default "4 / 3"'),
    }),
  },
  Spacer: {
    description:
      "Flexible empty space. Rarely needed: rely on the default gap.",
    props: z.object({ minSize: sizeValue.optional() }),
  },
  Divider: {
    description: "Horizontal rule.",
    props: z.object({
      color: z.enum(BORDER_COLORS).optional(),
      size: z.number().optional(),
      spacing: sizeValue.optional(),
      flush: z.boolean().optional(),
    }),
  },
  Animate: {
    description: "Pass-through container (animation hint).",
    props: z.object(layoutProps),
  },
  AnimateGroup: {
    description: "Pass-through container (animation hint).",
    props: z.object(layoutProps),
  },
  AnimateItem: {
    description: "Pass-through container (animation hint).",
    props: z.object(layoutProps),
  },
  Transition: {
    description: "Pass-through container (animation hint).",
    props: z.object(layoutProps),
  },
} satisfies CatalogDefinitions;
