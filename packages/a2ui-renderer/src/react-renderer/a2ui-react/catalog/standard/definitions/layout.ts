import { z } from "zod";
import { ChildListSchema } from "@a2ui/web_core/v0_9";
import type { CatalogDefinitions } from "../../../../create-catalog";
import {
  ALIGN,
  JUSTIFY,
  WRAP,
  RADII,
  BACKGROUNDS,
  BORDER_COLORS,
} from "../tokens";

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

/** Layout props shared by every container (ChatGPT's layout element). */
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
    .describe(`One of ${BACKGROUNDS.join("|")} or a CSS color`),
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
    description: "Vertical flex container.",
    props: z.object(layoutProps),
  },
  Row: {
    description: "Horizontal flex container.",
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
    description: "Grid cell with optional span.",
    props: z.object({
      ...layoutProps,
      span: z.number().optional(),
      rowSpan: z.number().optional(),
    }),
  },
  Card: {
    description: "Bordered, padded container with background.",
    props: z.object({
      ...layoutProps,
      variant: z
        .enum(["default", "soft", "elevated", "transparent"])
        .optional(),
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
      showArrows: z.boolean().optional(),
      snap: z.enum(["none", "proximity", "mandatory"]).optional(),
      snapAlign: z.enum(["start", "center", "end"]).optional(),
    }),
  },
  CarouselItem: {
    description: "Carousel slide.",
    props: z.object(layoutProps),
  },
  Spacer: {
    description: "Flexible empty space.",
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
