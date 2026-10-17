import { z } from "zod";
import {
  ActionSchema,
  DynamicNumberSchema,
  DynamicStringSchema,
} from "@a2ui/web_core/v0_9";
import type { CatalogDefinitions } from "../../../../create-catalog";
import { bindable, sizeValue } from "./layout";

/**
 * Composite components: the prebuilt widgets ChatGPT ships next to its
 * primitives (LinkCard, Citation, FollowUp pills, entity cards, image grids),
 * expressed as single catalog components so a model can place them with one
 * object instead of assembling eight primitives.
 */

const action = ActionSchema.optional().describe(
  'Dispatched on click. { "event": { "name": "...", "context": { ... } } }',
);
const text = (d: string) => DynamicStringSchema.optional().describe(d);

export const followUpItem = z.union([
  z.string(),
  z.object({
    label: z.string(),
    message: z
      .string()
      .optional()
      .describe("Text sent when clicked; default label"),
  }),
]);
export type FollowUpItem = z.infer<typeof followUpItem>;

export const gridImage = z.object({
  src: z.string(),
  alt: z.string().optional(),
  caption: z.string().optional(),
  href: z
    .string()
    .optional()
    .describe("Opens this URL instead of the lightbox"),
});
export type GridImage = z.infer<typeof gridImage>;

export const cardAction = z.object({
  label: z.string(),
  action: ActionSchema.optional(),
  href: z.string().optional().describe("Opens this URL in a new tab"),
  variant: z.enum(["solid", "soft", "outline", "ghost"]).optional(),
});
export type CardAction = z.infer<typeof cardAction>;

export const compositeDefinitions = {
  LinkCard: {
    description:
      "Preview card for a URL: favicon and domain, title, description and an optional thumbnail. Opens the link in a new tab (or dispatches `action` when given). Use for sources, articles and products with a page.",
    props: z.object({
      href: DynamicStringSchema.describe("URL (http, https)"),
      title: DynamicStringSchema.describe("Page title"),
      description: text("One or two lines"),
      image: text("Thumbnail URL"),
      domain: text("Shown under the favicon; default derived from href"),
      favicon: z.boolean().optional().describe("Default true"),
      action,
    }),
  },
  Citation: {
    description:
      "Inline source marker ([1]) that shows the source on hover or click: title, snippet and a link. Place it inline after the sentence it supports (`inline: true` Text children or a Row).",
    props: z.object({
      index: DynamicNumberSchema.optional().describe(
        "Marker number; default 1",
      ),
      label: text("Marker text instead of the number, e.g. a domain"),
      title: text("Source title"),
      url: text("Source URL (http, https)"),
      snippet: text("Quoted passage, one or two lines"),
      source: text("Publisher or domain; default derived from url"),
    }),
  },
  FollowUp: {
    description:
      "Suggested next prompts as pills. Clicking one sends its message as the user's next turn. Put it at the end of a surface; two to four short items.",
    props: z.object({
      items: bindable(z.array(followUpItem))
        .optional()
        .describe('Strings or { "label", "message"? }, or { "path": "/x" }'),
      title: text("Optional caption above the pills"),
    }),
  },
  EntityCard: {
    description:
      "Card for one thing (product, place, person, listing): image, title, subtitle, description, a price or meta line, a badge, a rating and up to three action buttons. `href` opens a page, `action` dispatches. Use a Grid of EntityCards for several.",
    props: z.object({
      title: DynamicStringSchema.describe("Name"),
      subtitle: text("Second line, e.g. brand or category"),
      description: text("Up to three lines"),
      image: text("Image URL"),
      imageAspectRatio: z.string().optional().describe('Default "4 / 3"'),
      meta: text('Short fact line, e.g. "$29 / month" or "Open until 22:00"'),
      badge: z
        .object({
          label: z.string(),
          color: z
            .enum([
              "secondary",
              "success",
              "danger",
              "warning",
              "info",
              "discovery",
            ])
            .optional(),
        })
        .optional(),
      rating: DynamicNumberSchema.optional().describe("0 to 5, shown as stars"),
      ratingCount: DynamicNumberSchema.optional().describe("Number of ratings"),
      href: text("Opens this URL in a new tab when the card is clicked"),
      action,
      actions: z
        .array(cardAction)
        .max(3)
        .optional()
        .describe("Up to three buttons"),
      layout: z
        .enum(["vertical", "horizontal"])
        .optional()
        .describe('Default "vertical"; horizontal puts the image on the left'),
      width: sizeValue.optional(),
    }),
  },
  ImageGrid: {
    description:
      'Gallery of images in a grid; clicking opens the image full-screen. layout "bento" makes the first image twice as large.',
    props: z.object({
      images: bindable(z.array(gridImage))
        .optional()
        .describe(
          'Array of { "src", "alt"?, "caption"?, "href"? }, or { "path": "/x" }',
        ),
      columns: z.number().optional().describe("Default 3"),
      aspectRatio: z.string().optional().describe('Default "1 / 1"'),
      gap: sizeValue.optional().describe("Default 2"),
      layout: z.enum(["grid", "bento"]).optional().describe('Default "grid"'),
    }),
  },
} satisfies CatalogDefinitions;
