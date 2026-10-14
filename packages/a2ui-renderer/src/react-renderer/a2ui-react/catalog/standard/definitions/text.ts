import { z } from "zod";
import { DynamicStringSchema } from "@a2ui/web_core/v0_9";
import type { CatalogDefinitions } from "../../../../create-catalog";
import { TEXT_COLORS, TEXT_SIZES, TITLE_SIZES, WEIGHTS } from "../tokens";
import { childIds, sizeValue } from "./layout";

/**
 * Bindable string: a literal, `{ "path": "/x" }` or a function call. Must be
 * built on `DynamicStringSchema` so the generic binder resolves `{ path }`.
 */
const dynamicString = (description: string) =>
  DynamicStringSchema.describe(description);

const color = z
  .string()
  .optional()
  .describe(`One of ${TEXT_COLORS.join("|")} or a CSS color`);
const weight = z.enum(WEIGHTS).optional();
const textAlign = z.enum(["start", "center", "end"]).optional();

const typography = {
  color,
  weight,
  textAlign,
  italic: z.boolean().optional(),
  truncate: z.boolean().optional(),
  maxLines: z.number().optional(),
  tabularNums: z.boolean().optional(),
  width: sizeValue.optional(),
};

const simpleInline = (description: string) => ({
  description,
  props: z.object({ text: dynamicString("Text content") }),
});

export const textDefinitions = {
  Title: {
    description:
      "Heading. size sm→h4, md→h3 (default), lg→h2, 3xl→h2, xl|2xl|4xl|5xl→h1. Bold by default (strong=true).",
    props: z.object({
      ...typography,
      text: dynamicString("Heading text"),
      size: z.enum(TITLE_SIZES).optional().describe('Default "md"'),
      strong: z.boolean().optional().describe("Default true"),
    }),
  },
  Text: {
    description:
      "Body text. `text` supports inline markdown (**bold**, *italic*, ~~strike~~, ++underline++, `code`, [link](https://…)). `children` ids render inline after the text (e.g. a Badge).",
    props: z.object({
      ...typography,
      text: dynamicString("Text with inline markdown").optional(),
      children: childIds,
      size: z.enum(TEXT_SIZES).optional().describe('Default "md"'),
      strong: z.boolean().optional().describe("Default false"),
      underline: z.boolean().optional(),
      lineThrough: z.boolean().optional(),
      inline: z.boolean().optional(),
      preserveWhitespace: z.boolean().optional(),
      highlight: z
        .union([z.enum(["green", "orange", "pink"]), z.boolean()])
        .optional(),
    }),
  },
  Caption: {
    description: "Small secondary text.",
    props: z.object({
      text: dynamicString("Caption text"),
      color,
      size: z.string().optional().describe('Default "lg"'),
      weight: weight.describe('Default "normal"'),
      textAlign,
      truncate: z.boolean().optional(),
      maxLines: z.number().optional(),
    }),
  },
  Label: {
    description: "Form/field label.",
    props: z.object({
      text: dynamicString("Label text"),
      htmlFor: z.string().optional(),
      color,
      size: z.enum(TEXT_SIZES).optional().describe('Default "sm"'),
      weight: weight.describe('Default "medium"'),
      textAlign,
      truncate: z.boolean().optional(),
      width: sizeValue.optional(),
    }),
  },
  Bold: {
    description: "Inline bold text.",
    props: z.object({ text: dynamicString("Text content"), weight }),
  },
  Italic: simpleInline("Inline italic text."),
  Underline: simpleInline("Inline underlined text."),
  Strikethrough: simpleInline("Inline struck-through text."),
  Badge: {
    description: "Small status pill.",
    props: z.object({
      label: dynamicString("Badge text"),
      color: z
        .enum([
          "secondary",
          "success",
          "danger",
          "warning",
          "info",
          "discovery",
        ])
        .optional()
        .describe('Default "secondary"'),
      size: z.enum(["sm", "md", "lg"]).optional().describe('Default "md"'),
      pill: z.boolean().optional().describe("Default true"),
      variant: z
        .enum(["soft", "solid", "outline"])
        .optional()
        .describe('Default "soft"'),
      weight: weight.describe('Default "medium"'),
      maxWidth: sizeValue.optional(),
      padding: sizeValue.optional(),
    }),
  },
  Blockquote: simpleInline("Block quotation."),
  Code: {
    description: "Preformatted code block.",
    props: z.object({
      text: dynamicString("Source code"),
      language: z.string().optional(),
    }),
  },
  Markdown: {
    description: "Full GitHub-flavoured markdown block.",
    props: z.object({
      text: dynamicString("Markdown source"),
      streaming: z.boolean().optional().describe("Default false"),
    }),
  },
  Math: {
    description: "TeX expression (rendered as source, no typesetting).",
    props: z.object({
      value: dynamicString("TeX source"),
      block: z.boolean().optional().describe("Default false"),
    }),
  },
  ShimmerText: {
    description: "Text with an animated shimmer (pending/loading hint).",
    props: z.object({
      ...typography,
      text: dynamicString("Text content"),
      size: z.enum(TEXT_SIZES).optional().describe('Default "md"'),
      lineThrough: z.boolean().optional(),
    }),
  },
  Link: {
    description: "Hyperlink (http, https and mailto only). Opens in a new tab.",
    props: z.object({
      text: dynamicString("Link label"),
      href: dynamicString("URL"),
      title: z.string().optional(),
    }),
  },
  Tooltip: {
    description: "Shows `content` on hover over its children.",
    props: z.object({
      content: dynamicString("Tooltip text"),
      children: childIds,
    }),
  },
} satisfies CatalogDefinitions;
