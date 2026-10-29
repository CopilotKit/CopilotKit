import { z } from "zod";
import { CHILDREN_SLOT, sizeValue, weightProp } from "./layout";
import { TEXT_COLORS, TEXT_SIZES, TITLE_SIZES, WEIGHTS } from "./tokens";

// ---- Schemas ----

const colorProp = z
  .string()
  .optional()
  .describe(`One of ${TEXT_COLORS.join("|")} or a CSS color`);
const fontWeight = z.enum(WEIGHTS).optional();
const textAlign = z.enum(["start", "center", "end"]).optional();

const typographyProps = {
  color: colorProp,
  fontWeight,
  textAlign,
  italic: z.boolean().optional(),
  truncate: z.boolean().optional(),
  maxLines: z.number().optional(),
  tabularNums: z.boolean().optional(),
  width: sizeValue.optional(),
};

export const typographySchema = z.object(typographyProps);
export const titleSchema = z.object({
  ...typographyProps,
  text: z.string().describe("Heading text"),
  size: z.enum(TITLE_SIZES).optional().describe('Default "md"'),
  strong: z.boolean().optional().describe("Default true"),
});
export const textSchema = z.object({
  ...typographyProps,
  weight: weightProp,
  text: z
    .union([z.string(), z.number()])
    .optional()
    .describe("Text with inline markdown. A bound number shows as text"),
  size: z.enum(TEXT_SIZES).optional().describe('Default "md"'),
  fontSize: sizeValue
    .optional()
    .describe("Pixels when a number. Wins over size"),
  lineHeight: z
    .union([z.number(), z.string()])
    .optional()
    .describe("A unitless ratio, or CSS"),
  minLines: z
    .number()
    .optional()
    .describe("Reserves the height of this many lines"),
  strong: z.boolean().optional().describe("Default false"),
  underline: z.boolean().optional(),
  lineThrough: z.boolean().optional(),
  inline: z.boolean().optional(),
  preserveWhitespace: z.boolean().optional(),
  highlight: z
    .union([z.enum(["green", "orange", "pink"]), z.boolean()])
    .optional(),
});
export const CAPTION_SIZES = ["sm", "md", "lg"] as const;
export const captionSchema = z.object({
  text: z.union([z.string(), z.number()]).describe("Caption text"),
  color: colorProp,
  size: z.enum(CAPTION_SIZES).optional().describe('Default "lg"'),
  fontWeight: fontWeight.describe('Default "normal"'),
  textAlign,
  truncate: z.boolean().optional(),
  maxLines: z.number().optional(),
});
export const labelSchema = z.object({
  text: z.union([z.string(), z.number()]).describe("Label text"),
  htmlFor: z.string().optional(),
  color: colorProp,
  size: z.enum(TEXT_SIZES).optional().describe('Default "sm"'),
  fontWeight: fontWeight.describe('Default "medium"'),
  textAlign,
  truncate: z.boolean().optional(),
  width: sizeValue.optional(),
});
export const boldSchema = z.object({ text: z.string(), fontWeight });
export const inlineTextSchema = z.object({ text: z.string() });
export const blockquoteSchema = z.object({
  text: z.string().describe("The quoted text, with inline markdown"),
});
export const BADGE_SIZES = ["sm", "md", "lg"] as const;
export const badgeSchema = z.object({
  label: z.string().describe("Badge text"),
  color: z
    .enum(["secondary", "success", "danger", "warning", "info", "discovery"])
    .optional()
    .describe('Default "secondary"'),
  size: z.enum(BADGE_SIZES).optional().describe('Default "md"'),
  pill: z.boolean().optional().describe("Default true"),
  variant: z
    .enum(["soft", "solid", "outline"])
    .optional()
    .describe('Default "soft"'),
  fontWeight: fontWeight.describe('Default "medium"'),
  maxWidth: sizeValue.optional(),
  padding: sizeValue.optional(),
});
export const codeSchema = z.object({
  text: z.string().describe("Source code"),
  language: z.string().optional(),
});
export const markdownSchema = z.object({
  text: z.string().describe("Markdown source"),
  streaming: z.boolean().optional().describe("Default false"),
});
export const mathSchema = z.object({
  value: z.string().describe("TeX source"),
  block: z.boolean().optional().describe("Default false"),
});
export const shimmerSchema = z.object({
  ...typographyProps,
  text: z.string(),
  size: z.enum(TEXT_SIZES).optional().describe('Default "md"'),
  lineThrough: z.boolean().optional(),
});
export const linkSchema = z.object({
  text: z.string().describe("Link text"),
  href: z.string().describe("URL"),
  title: z.string().optional(),
});

/**
 * The standard text components, without their framework components.
 *
 * - Text has a "multiple" `children` slot. The children render inline
 *   after the text.
 * - Tooltip has two "single" slots: `trigger` and `content`.
 * - Link is a plain link. It opens http, https and mailto URLs only.
 */
export const textDeclarations = {
  Title: {
    description:
      'A heading inside a Card or next to another component. A heading alone is markdown outside the fence. Use size "2xl" at most once in a surface, and "lg" for section headings. Size "sm" is an h4, "md" and "lg" are an h3 (default "md"), "xl" and larger are an h2. It is bold unless strong is false.',
    props: titleSchema,
  },
  Text: {
    description:
      'Body text inside a Card or next to another component. A paragraph alone is markdown outside the fence. Use color "default" or "secondary". `text` can have inline markdown: **bold**, *italic*, ~~strike~~, ++underline++, `code` and [link](https://example.com). The `children` ids render inline after the text, for example a Badge.',
    props: textSchema,
    slots: CHILDREN_SLOT,
  },
  Caption: {
    description:
      "Small secondary text: a hint under a control, or a label in a Row. `text` can have inline markdown.",
    props: captionSchema,
  },
  Label: {
    description: "The label of a form field.",
    props: labelSchema,
  },
  Bold: {
    description: "Bold inline text.",
    props: boldSchema,
  },
  Italic: {
    description: "Italic inline text.",
    props: inlineTextSchema,
  },
  Underline: {
    description: "Underlined inline text.",
    props: inlineTextSchema,
  },
  Strikethrough: {
    description: "Struck-through inline text.",
    props: inlineTextSchema,
  },
  Badge: {
    description:
      "A small status pill. Use the colors success, danger and warning only to show a status, not for decoration.",
    props: badgeSchema,
  },
  Blockquote: {
    description:
      "A block quotation with a line on the left. `text` can have inline markdown.",
    props: blockquoteSchema,
  },
  Code: {
    description: "A block of code in a monospace font.",
    props: codeSchema,
  },
  Markdown: {
    description:
      "A block of GitHub-flavored markdown. Use it only next to other components, for example in a table cell or next to a chart. Markdown alone goes outside the fence.",
    props: markdownSchema,
  },
  Math: {
    description:
      "A TeX math formula, typeset with KaTeX. Set block to true for a centered formula on its own line.",
    props: mathSchema,
  },
  ShimmerText: {
    description:
      "Text with a moving shimmer. It shows that something is loading or pending.",
    props: shimmerSchema,
  },
  Link: {
    description:
      "A link. Only http, https and mailto URLs work. It opens in a new tab.",
    props: linkSchema,
  },
  Tooltip: {
    description:
      "Shows `content` when the user points at `trigger` or moves keyboard focus to it. `trigger` is one child id: a Text, Icon or Badge, not a Button or Link. `content` is one child id of short text, for example a Text. Do not put links or buttons in `content`.",
    slots: { trigger: "single", content: "single" } as const,
  },
};
