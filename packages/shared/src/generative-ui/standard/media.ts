import { z } from "zod";
import { NO_ARGS, radiusValue, sizeValue, weightProp } from "./layout";
import { WEIGHTS } from "./tokens";

// ---- Schemas ----

const colorProp = z.string().optional();

export const ICON_SIZES = ["sm", "md", "lg", "xl"] as const;
export type IconSize = (typeof ICON_SIZES)[number] | number;

export const IMAGE_VARIANTS = [
  "icon",
  "avatar",
  "smallFeature",
  "mediumFeature",
  "largeFeature",
  "header",
] as const;
export const imageSchema = z.object({
  url: z.string().describe("Image URL"),
  description: z
    .string()
    .optional()
    .describe(
      "What the image shows, for screen readers. Leave it unset only for a decorative image",
    ),
  variant: z
    .enum(IMAGE_VARIANTS)
    .optional()
    .describe(
      'The size: "icon" 24px, "avatar" 40px round, "smallFeature" 160px wide, "largeFeature" and "header" full width. Default "mediumFeature": the natural size',
    ),
  weight: weightProp,
  aspectRatio: z.string().optional(),
  fit: z
    .enum(["cover", "contain", "fill", "none", "scaleDown"])
    .optional()
    .describe('CSS object-fit. Default "cover"'),
  radius: radiusValue.optional(),
  width: sizeValue.optional(),
  height: sizeValue.optional(),
  maxWidth: sizeValue.optional(),
  maxHeight: sizeValue.optional(),
  minWidth: sizeValue.optional(),
  minHeight: sizeValue.optional(),
  background: z.string().optional(),
  frame: z.boolean().optional(),
  position: z
    .string()
    .optional()
    .describe('CSS object-position, for example "top" or "50% 20%"'),
  hideOnFailure: z.boolean().optional().describe("Default false"),
  fallback: z
    .string()
    .optional()
    .describe("Text shown in place of the image when it does not load"),
  hoverZoom: z.boolean().optional().describe("A slight zoom on hover"),
  lightbox: z
    .boolean()
    .optional()
    .describe("Default true: a click opens the image full-screen"),
  actionOverlay: z
    .object({
      label: z.string(),
      icon: z.string().optional().describe("Lucide icon name"),
      href: z.string().optional().describe("Opens this URL in a new tab"),
    })
    .optional()
    .describe(
      "A button over the bottom-right corner of the image. Without href, it sends onOverlayClick",
    ),
});
export const iconSchema = z.object({
  name: z
    .union([z.string(), z.object({ svgPath: z.string() })])
    .describe(
      'A Lucide icon name in kebab-case ("arrow-right"), an A2UI icon name ("arrowBack"), or { "svgPath" } on a 24px grid',
    ),
  label: z
    .string()
    .optional()
    .describe(
      "What the icon means, for screen readers. Leave it unset when text next to the icon says the same",
    ),
  size: z
    .union([z.enum(ICON_SIZES), z.number()])
    .optional()
    .describe('Default "md"'),
  color: colorProp,
  inline: z.boolean().optional().describe("Default false"),
  strokeWeight: z.enum(WEIGHTS).optional().describe("The stroke width"),
  weight: weightProp,
});
export const faviconSchema = z.object({
  url: z.string(),
  alt: z.string().optional(),
  size: z.number().optional().describe("Pixels. Default 16"),
  inline: z.boolean().optional().describe("Default false"),
  frame: z.boolean().optional().describe("Default false"),
});
export const svgSchema = z.object({
  viewBox: z.string().optional(),
  label: z
    .string()
    .optional()
    .describe(
      "What the drawing shows, for screen readers. Leave it unset for a decorative drawing",
    ),
  width: sizeValue.optional(),
  height: sizeValue.optional(),
  size: sizeValue.optional(),
  color: colorProp.describe('Default "prose"'),
  fill: colorProp.describe('Default "currentColor"'),
  stroke: colorProp,
  strokeWidth: z.number().optional(),
  strokeLinecap: z.enum(["butt", "round", "square"]).optional(),
  strokeLinejoin: z.enum(["miter", "round", "bevel"]).optional(),
  preserveAspectRatio: z.string().optional(),
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
});
const captionTrack = z.object({
  url: z.string().describe("The URL of a WebVTT file"),
  language: z.string().optional().describe('BCP 47, for example "en"'),
  label: z.string().optional().describe("Shown in the captions menu"),
  kind: z.enum(["subtitles", "captions", "descriptions"]).optional(),
});
export const videoSchema = z.object({
  url: z
    .string()
    .describe(
      "The URL of a video file, or of a YouTube video or short. A page on another video site shows as a link",
    ),
  posterUrl: z
    .string()
    .optional()
    .describe("The image shown before the video plays"),
  title: z.string().optional().describe("Names the video for screen readers"),
  captions: z
    .array(captionTrack)
    .optional()
    .describe("Caption tracks of a video file"),
  aspectRatio: z.string().optional().describe('Default "16 / 9"'),
  width: sizeValue.optional().describe('Default "100%"'),
  maxWidth: sizeValue.optional().describe('Default "100%"'),
  weight: weightProp,
});
export const audioPlayerSchema = z.object({
  url: z.string().describe("The URL of the audio file"),
  description: z
    .string()
    .optional()
    .describe("A title or summary of the audio, shown above the player"),
  weight: weightProp,
});
export const htmlViewSchema = z.object({
  html: z.string(),
  height: sizeValue.optional().describe("Pixels when a number. Default 360"),
  width: sizeValue.optional().describe('Default "100%"'),
  title: z.string().optional(),
});

/**
 * The standard media components, without their framework components. Each
 * framework adds its components with `withComponents`.
 */
export const mediaDeclarations = {
  Image: {
    description:
      "An image from a URL. A click opens it full-screen. Set description to say what the image shows, unless it is only decoration.",
    props: imageSchema,
    events: {
      onOverlayClick: {
        description:
          "Sent when the user clicks the actionOverlay button and it has no href.",
        parameters: NO_ARGS,
      },
    },
  },
  Icon: {
    description:
      'A Lucide icon by kebab-case name (for example "arrow-right"), or an A2UI icon name (for example "arrowBack"). Set label when no text next to the icon says what it means.',
    props: iconSchema,
  },
  Favicon: {
    description: "The favicon of the site at a URL.",
    props: faviconSchema,
  },
  Svg: {
    description:
      "A vector drawing from primitive shapes (paths, circles, rects, lines, texts). Colors take text color tokens or CSS colors.",
    props: svgSchema,
  },
  Video: {
    description:
      "A video player for a video file URL (with optional captions), or a YouTube link in privacy-enhanced mode: the poster shows first, and the player loads when the user presses play. A page on another video site shows as a link to it. Set title to name the video.",
    props: videoSchema,
  },
  AudioPlayer: {
    description:
      "An audio player for an audio file URL, with the description above it.",
    props: audioPlayerSchema,
  },
  HtmlView: {
    description:
      "Raw HTML in a fully sandboxed iframe: no scripts, no same-origin access. Set title to name the content.",
    props: htmlViewSchema,
  },
};
