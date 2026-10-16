import { z } from "zod";
import { DynamicStringSchema } from "@a2ui/web_core/v0_9";
import type { CatalogDefinitions } from "../../../../create-catalog";
import { radiusValue, sizeValue } from "./layout";

const colorProp = z.string().optional();

export const mediaDefinitions = {
  Image: {
    description: "Image.",
    props: z.object({
      src: DynamicStringSchema.describe("Image URL"),
      alt: z.string().optional(),
      aspectRatio: z.string().optional(),
      fit: z.enum(["cover", "contain"]).optional().describe('Default "cover"'),
      radius: radiusValue.optional(),
      width: sizeValue.optional(),
      height: sizeValue.optional(),
      maxWidth: sizeValue.optional(),
      maxHeight: sizeValue.optional(),
      background: z.string().optional(),
      frame: z.boolean().optional(),
      hideOnFailure: z.boolean().optional().describe("Default false"),
      lightbox: z
        .boolean()
        .optional()
        .describe("Default true: clicking opens the image full-screen"),
    }),
  },
  Icon: {
    description: 'Lucide icon by kebab-case name (e.g. "arrow-right").',
    props: z.object({
      name: z.string().describe("Lucide icon name, kebab-case"),
      size: z
        .union([z.enum(["sm", "md", "lg", "xl"]), z.number()])
        .optional()
        .describe('Default "md"'),
      color: colorProp,
      inline: z.boolean().optional().describe("Default false"),
      weight: z.enum(["normal", "medium", "semibold", "bold"]).optional(),
    }),
  },
  Favicon: {
    description: "Site favicon for a URL.",
    props: z.object({
      url: z.string(),
      alt: z.string().optional(),
      size: z.number().optional().describe("Pixels; default 16"),
      inline: z.boolean().optional().describe("Default false"),
      frame: z.boolean().optional().describe("Default false"),
    }),
  },
  Svg: {
    description:
      "Vector drawing from primitive shapes. Colors accept text color tokens or CSS colors.",
    props: z.object({
      viewBox: z.string().optional(),
      width: sizeValue.optional(),
      height: sizeValue.optional(),
      size: sizeValue.optional(),
      color: colorProp.describe('Default "prose"'),
      fill: colorProp.describe('Default "currentColor"'),
      stroke: colorProp,
      strokeWidth: z.number().optional(),
      paths: z
        .array(
          z.object({
            d: z.string(),
            fill: colorProp,
            stroke: colorProp,
            strokeWidth: z.number().optional(),
          }),
        )
        .optional(),
      circles: z
        .array(
          z.object({
            cx: z.number(),
            cy: z.number(),
            r: z.number(),
            fill: colorProp,
            stroke: colorProp,
          }),
        )
        .optional(),
      rects: z
        .array(
          z.object({
            x: z.number(),
            y: z.number(),
            width: z.number(),
            height: z.number(),
            rx: z.number().optional(),
            fill: colorProp,
            stroke: colorProp,
          }),
        )
        .optional(),
      lines: z
        .array(
          z.object({
            x1: z.number(),
            y1: z.number(),
            x2: z.number(),
            y2: z.number(),
            stroke: colorProp,
          }),
        )
        .optional(),
      texts: z
        .array(
          z.object({
            x: z.number(),
            y: z.number(),
            text: z.string(),
            size: z.number().optional(),
            fill: colorProp,
            anchor: z.enum(["start", "middle", "end"]).optional(),
          }),
        )
        .optional(),
    }),
  },
  YouTube: {
    description: "Embedded YouTube video (privacy-enhanced mode).",
    props: z.object({
      videoId: z.string(),
      title: z.string().optional(),
      aspectRatio: z.string().optional().describe('Default "16 / 9"'),
      width: sizeValue.optional().describe('Default "100%"'),
      maxWidth: sizeValue.optional().describe('Default "100%"'),
    }),
  },
  HtmlView: {
    description:
      "Raw HTML in a fully sandboxed iframe (no scripts, no same-origin access).",
    props: z.object({
      html: z.string(),
      height: sizeValue
        .optional()
        .describe("Pixels when a number; default 360"),
      width: sizeValue.optional().describe('Default "100%"'),
      title: z.string().optional(),
    }),
  },
} satisfies CatalogDefinitions;
