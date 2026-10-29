import { z } from "zod";
import { NO_ARGS, sizeValue } from "./layout";

// ---- Schemas ----

const text = (description: string) =>
  z.string().optional().describe(description);

export const linkCardSchema = z.object({
  href: z.string().describe("The URL (http, https)"),
  title: z.string().describe("The page title"),
  description: text("One or two lines"),
  image: text("A thumbnail URL"),
  domain: text("Shown next to the favicon. Default: the host of href"),
  favicon: z.boolean().optional().describe("Default true"),
});
export const citationSchema = z.object({
  index: z.number().optional().describe("The marker number. Default 1"),
  label: text("Marker text instead of the number, for example a domain"),
  title: text("The source title"),
  url: text("The source URL (http, https)"),
  snippet: text("The quoted passage, one or two lines"),
  source: text("The publisher or domain. Default: the host of url"),
});
export const followUpItem = z.union([
  z.string(),
  z.object({
    label: z.string(),
    message: text("The text sent when the user clicks. Default: label"),
  }),
]);
export const followUpSchema = z.object({
  items: z
    .array(followUpItem)
    .optional()
    .describe('Strings or { "label", "message"? }, or { "@path": "/x" }'),
  title: text("A caption above the pills"),
});
export const followUpArgs = z.object({
  message: z.string().describe("The message of the clicked pill"),
});
const BADGE_COLORS = [
  "secondary",
  "success",
  "danger",
  "warning",
  "info",
  "discovery",
] as const;
export const cardAction = z.object({
  label: z.string(),
  href: text("Opens this URL in a new tab"),
  variant: z.enum(["solid", "soft", "outline", "ghost"]).optional(),
});
export const entityCardSchema = z.object({
  title: z.string().describe("The name"),
  subtitle: text("A second line, for example the brand or category"),
  description: text("Up to three lines"),
  image: text("An image URL"),
  imageAspectRatio: z.string().optional().describe('Default "4 / 3"'),
  meta: text(
    'A short fact line, for example "$29 / month" or "Open until 22:00"',
  ),
  badge: z
    .object({ label: z.string(), color: z.enum(BADGE_COLORS).optional() })
    .optional(),
  rating: z.number().optional().describe("0 to 5, shown as stars"),
  ratingCount: z.number().optional().describe("The number of ratings"),
  href: text("Opens this URL in a new tab when the user clicks the card"),
  actions: z
    .array(cardAction)
    .max(3)
    .optional()
    .describe(
      "Up to three buttons. A button without href sends onAction with its label",
    ),
  layout: z
    .enum(["vertical", "horizontal"])
    .optional()
    .describe('Default "vertical". "horizontal" puts the image on the left'),
  width: sizeValue.optional(),
});
export const entityActionArgs = z.object({
  label: z.string().describe("The label of the clicked button"),
});
export const gridImage = z.object({
  url: z.string(),
  description: z.string().optional().describe("What the image shows"),
  caption: z.string().optional(),
  href: text("Opens this URL instead of the full-screen view"),
});
export const imageGridSchema = z.object({
  images: z
    .array(gridImage)
    .optional()
    .describe(
      'A list of { "url", "description"?, "caption"?, "href"? }, or { "@path": "/x" }',
    ),
  columns: z.number().optional().describe("Default 3"),
  aspectRatio: z.string().optional().describe('Default "1 / 1"'),
  gap: sizeValue.optional().describe("Default 2"),
  layout: z
    .enum(["grid", "bento"])
    .optional()
    .describe('Default "grid". "bento" makes the first image twice as large'),
});

/**
 * The standard composite components, without their framework components.
 *
 * - LinkCard and EntityCard open `href`, or send `onClick` when it is bound.
 * - FollowUp sends `onFollowUp` with the message of the pill. Unbound, the
 *   engine turns it into a visible user message with that text.
 * - EntityCard buttons without href send `onAction` with their label.
 */
export const compositeDeclarations = {
  LinkCard: {
    description:
      "A preview card of a URL: the favicon and domain, the title, a description and a thumbnail. A click opens the link in a new tab, or sends onClick when it is bound. Use it for sources, articles and products that have a page.",
    props: linkCardSchema,
    events: {
      onClick: {
        description: "Sent when the user clicks the card, instead of the link.",
        parameters: NO_ARGS,
      },
    },
  },
  Citation: {
    description:
      "An inline source marker ([1]) that shows the source on hover or click: the title, a snippet and a link. Put it inline after the sentence it supports, as a child of a Text or in a Row.",
    props: citationSchema,
  },
  FollowUp: {
    description:
      "Suggested next prompts as pills. A click sends the message of the pill as the next turn of the user, with no event binding needed. Put it at the end of a surface, with two to four short items.",
    props: followUpSchema,
    events: {
      onFollowUp: {
        description:
          "Sent when the user clicks a pill. The args carry the message of the pill.",
        parameters: followUpArgs,
      },
    },
  },
  EntityCard: {
    description:
      "A card for one thing (a product, place, person or listing): an image, title, subtitle, description, a price or meta line, a badge, a rating and up to three buttons. href opens a page, and onClick is sent when it is bound. Use a Grid of EntityCards for several things.",
    props: entityCardSchema,
    events: {
      onClick: {
        description: "Sent when the user clicks the card and it has no href.",
        parameters: NO_ARGS,
      },
      onAction: {
        description:
          "Sent when the user clicks a button without href. The args carry the label of the button.",
        parameters: entityActionArgs,
      },
    },
  },
  ImageGrid: {
    description:
      'A gallery of images in a grid. A click opens the image full-screen, with arrows to the other images. layout "bento" makes the first image twice as large.',
    props: imageGridSchema,
  },
};
