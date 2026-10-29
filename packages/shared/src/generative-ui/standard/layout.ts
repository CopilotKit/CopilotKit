import { z } from "zod";
import { child } from "../catalog/refs";
import {
  ALIGN,
  BACKGROUNDS,
  BORDER_COLORS,
  JUSTIFY,
  RADII,
  WRAP,
} from "./tokens";

/** A number is a count of 4px steps. A string is raw CSS. */
export const sizeValue = z.union([z.number(), z.string()]);

/** The A2UI `weight`: how much of the free space of a Row or Column to take. */
export const weightProp = z
  .number()
  .optional()
  .describe("flex-grow in a Row or Column");

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
 * The layout props of every container. Spread them into a props schema:
 * `z.object({ ...layoutProps, variant: ... })`. The children of a container
 * are a slot, not a prop.
 */
export const layoutProps = {
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
      `One of ${BACKGROUNDS.join("|")} or a CSS color. Leave it unset. Only one summary panel in a Card can use "surface-secondary"`,
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
  weight: weightProp,
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
};

const layoutSchema = z.object(layoutProps);

/** The arguments of a click or visibility event: none. */
export const NO_ARGS = z.object({});

/**
 * The `onVisible` event of every container: sent once, the first time the
 * container scrolls into view.
 */
export const VISIBLE_EVENT = {
  onVisible: {
    description:
      "Sent once, the first time the container scrolls into view. Use it to load more content lazily.",
    parameters: NO_ARGS,
  },
} as const;

export type LayoutProps = z.output<typeof layoutSchema>;

/** The slot of every container: a list of children or a template. */
export const CHILDREN_SLOT = { children: "multiple" } as const;

export const boxSchema = z.object({
  ...layoutProps,
  direction: z.enum(["col", "row"]).optional().describe('Default "col"'),
});
export const gridSchema = z.object({
  ...layoutProps,
  columns: z
    .union([z.number(), z.string()])
    .optional()
    .describe("Column count or CSS template. Default 2"),
  minChildWidth: sizeValue.optional(),
  rows: z.union([z.number(), z.string()]).optional(),
});
export const gridItemSchema = z.object({
  ...layoutProps,
  span: z.number().optional(),
  rowSpan: z.number().optional(),
});
export const cardSchema = z.object({
  ...layoutProps,
  variant: z
    .enum(["default", "outline", "section", "soft", "elevated", "transparent"])
    .optional(),
  shadowStyle: z
    .enum(["none", "sm", "md"])
    .optional()
    .describe("Overrides the shadow of the variant"),
  size: z
    .enum(["sm", "md", "lg"])
    .optional()
    .describe('The padding preset: 8, 16 or 24px. Default "md"'),
});
export const flowSchema = z.object({
  ...layoutProps,
  columns: z.number().optional(),
  rows: z.number().optional(),
  layout: z.enum(["pack", "fixed"]).optional().describe('Default "pack"'),
});
export const flowItemSchema = z.object({
  ...layoutProps,
  span: z.number().optional(),
  rowSpan: z.number().optional(),
  aspectRatio: z.string().optional().describe('Default "1 / 1"'),
  aspectMode: z.enum(["soft", "fixed"]).optional(),
});
export const carouselSchema = z.object({
  ...layoutProps,
  label: z
    .string()
    .optional()
    .describe("A short name of the carousel for screen readers"),
  visibleItems: z.number().optional(),
  showArrows: z.boolean().optional().describe("Default true"),
  activeIndex: z
    .number()
    .optional()
    .describe(
      'The index of the slide in view. Bind it with { "@path": "/x" } to read or set it',
    ),
  previousLabel: z.string().optional().describe('Default "Previous"'),
  nextLabel: z.string().optional().describe('Default "Next"'),
  snap: z.enum(["none", "proximity", "mandatory"]).optional(),
  snapAlign: z.enum(["start", "center", "end"]).optional(),
});
export const CAROUSEL_MEDIA_SIZES = ["sm", "md", "lg"] as const;
export const carouselMediaItemSchema = z.object({
  ...layoutProps,
  url: z.string().describe("Image URL"),
  description: z
    .string()
    .optional()
    .describe("What the image shows, for screen readers"),
  size: z
    .enum(CAROUSEL_MEDIA_SIZES)
    .optional()
    .describe('The width: "sm" 160px, "md" 240px, "lg" 320px. Default "md"'),
  aspectRatio: z.string().optional().describe('Default "4 / 3"'),
  href: z.string().optional().describe("Opens this URL in a new tab"),
  lightbox: z
    .boolean()
    .optional()
    .describe("Default true: a click opens all slides full-screen"),
});
export const spacerSchema = z.object({ minSize: sizeValue.optional() });
export const tabsSchema = z.object({
  tabs: z
    .array(
      z.object({
        title: z.string().describe("The tab title"),
        child: child("The id of the panel component"),
      }),
    )
    .describe("One entry per tab"),
  selectedIndex: z
    .number()
    .optional()
    .describe(
      'The open tab. Default 0. Bind it with { "@path": "/x" } to read it',
    ),
  weight: weightProp,
});
export const dividerSchema = z.object({
  axis: z
    .enum(["horizontal", "vertical"])
    .optional()
    .describe('Default "horizontal"'),
  weight: weightProp,
  color: z.enum(BORDER_COLORS).optional(),
  size: z.number().optional(),
  spacing: sizeValue.optional(),
  flush: z.boolean().optional(),
});

/**
 * The standard layout components, without their framework components:
 * containers, Spacer and Divider. Every container has a "multiple"
 * `children` slot, so it takes a list of child ids or a template
 * `{ componentId, path }`.
 */
export const layoutDeclarations = {
  Box: {
    description:
      'A flex container. It stacks its children in a column (direction "row" puts them in a row). Use it to group children with gap, padding, border, radius or background.',
    props: boxSchema,
    events: VISIBLE_EVENT,
    slots: CHILDREN_SLOT,
  },
  Column: {
    description:
      "A vertical flex container. Its default gap already separates sections, so do not add padding, background or a Spacer for space.",
    props: layoutSchema,
    events: VISIBLE_EVENT,
    slots: CHILDREN_SLOT,
  },
  Row: {
    description:
      'A horizontal flex container. For a label and value pair, use a Row with justify "spaceBetween": a Caption on the left and a Text with fontWeight "medium" on the right. Put buttons in a Row at the bottom of a Card: one Button with variant "primary", and the default or "borderless" for the others.',
    props: layoutSchema,
    events: VISIBLE_EVENT,
    slots: CHILDREN_SLOT,
  },
  Grid: {
    description:
      "A CSS grid container. On a narrow screen, its columns collapse towards one column.",
    props: gridSchema,
    events: VISIBLE_EVENT,
    slots: CHILDREN_SLOT,
  },
  GridItem: {
    description:
      "A cell of a Grid, with an optional span. A span that covers all rendered columns fills the row.",
    props: gridItemSchema,
    events: VISIBLE_EVENT,
    slots: CHILDREN_SLOT,
  },
  Card: {
    description:
      'A bordered, padded container, only for an interactive panel (controls, a form, a configurator). Tables, charts and text do not need one. Give it a Title and a Caption. Separate the groups in it with a Divider or the plain gap, never with a nested Card or a bordered Box. Variant "section" is a heading and content without a box. Variant "outline" always has a box. In markdown mode, a Card without controls renders as "section" unless it sets variant or border.',
    props: cardSchema,
    events: VISIBLE_EVENT,
    slots: { child: "single", children: "multiple" } as const,
  },
  Flow: {
    description:
      "A masonry-like grid that packs cells of different sizes. Put FlowItem children in it.",
    props: flowSchema,
    events: VISIBLE_EVENT,
    slots: CHILDREN_SLOT,
  },
  FlowItem: {
    description: "A cell of a Flow, with an optional span.",
    props: flowItemSchema,
    events: VISIBLE_EVENT,
    slots: CHILDREN_SLOT,
  },
  Carousel: {
    description:
      'A row that scrolls horizontally and snaps to its slides, with previous and next arrows. Put CarouselItem or CarouselMediaItem children in it. Bind activeIndex with { "@path": "/x" } to read or set the slide in view.',
    props: carouselSchema,
    events: VISIBLE_EVENT,
    slots: CHILDREN_SLOT,
    writable: ["activeIndex"] as const,
  },
  CarouselItem: {
    description: "A slide of a Carousel.",
    props: layoutSchema,
    events: VISIBLE_EVENT,
    slots: CHILDREN_SLOT,
  },
  CarouselMediaItem: {
    description:
      'A slide of a Carousel with an image on top and its children (a Caption, a Text) under it. size "sm" is 160px, "md" 240px (default), "lg" 320px wide. A click on the image opens all slides full-screen, unless href or onClick is set.',
    props: carouselMediaItemSchema,
    events: {
      ...VISIBLE_EVENT,
      onClick: {
        description:
          "Sent when the user clicks the image. It replaces the full-screen view.",
        parameters: NO_ARGS,
      },
    },
    slots: CHILDREN_SLOT,
  },
  Spacer: {
    description:
      "Flexible empty space. You almost never need it: use the default gap.",
    props: spacerSchema,
  },
  Divider: {
    description:
      'A line between two groups: horizontal, or vertical with axis "vertical" in a Row.',
    props: dividerSchema,
  },
  Tabs: {
    description:
      'Tabs that show one panel at a time. Each tab has a title and the id of its panel component: "tabs":[{"title":"Specs","child":"specs"}].',
    props: tabsSchema,
    writable: ["selectedIndex"] as const,
  },
};
