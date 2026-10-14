import { z } from "zod";
import { DynamicBooleanSchema, DynamicStringSchema } from "@a2ui/web_core/v0_9";
import type { CatalogDefinitions } from "../../../../create-catalog";
import { childIds, sizeValue } from "./layout";

export const feedbackDefinitions = {
  Loading: {
    description: "Spinner with a label.",
    props: z.object({
      label: z.string().optional().describe('Default "Loading"'),
      size: z.enum(["sm", "md", "lg"]).optional().describe('Default "md"'),
    }),
  },
  LoadingIndicator: {
    description: "Spinner only.",
    props: z.object({
      color: z.string().optional().describe('Default "prose"'),
      size: z.enum(["sm", "md", "lg"]).optional().describe('Default "md"'),
    }),
  },
  LoadingBlock: {
    description: "Shimmering placeholder block.",
    props: z.object({
      label: z.string().optional(),
      background: z.string().optional().describe('Default "surface-tertiary"'),
      duration: z.number().optional().describe("Milliseconds; default 1500"),
    }),
  },
  PulseIndicator: {
    description: "Pulsing dot.",
    props: z.object({
      color: z.string().optional(),
      size: z.number().optional().describe("Pixels; default 12"),
      pulseColor: z.string().optional(),
      duration: z.number().optional().describe("Milliseconds"),
    }),
  },
  Celebration: {
    description:
      "Wraps children; plays a confetti burst on mount and whenever `trigger` changes.",
    props: z.object({
      trigger: DynamicStringSchema.optional(),
      children: childIds,
    }),
  },
  FlashcardFlip: {
    description: "Card that flips between `front` and `back` on click.",
    props: z.object({
      front: DynamicStringSchema.optional(),
      back: DynamicStringSchema.optional(),
      hint: z.string().optional(),
    }),
  },
  Popover: {
    description:
      "Overlay. `children`: one PopoverTrigger and one PopoverContent. Clicking the trigger toggles the content.",
    props: z.object({
      children: childIds,
      open: DynamicBooleanSchema.optional(),
      showOnHover: z.boolean().optional(),
    }),
  },
  PopoverTrigger: {
    description: "Popover trigger; clicking toggles the popover.",
    props: z.object({ children: childIds }),
  },
  PopoverContent: {
    description: "Popover body, shown when open.",
    props: z.object({
      children: childIds,
      side: z
        .enum(["top", "bottom", "left", "right"])
        .optional()
        .describe('Default "bottom"'),
      align: z.enum(["start", "center", "end"]).optional(),
      width: sizeValue.optional(),
    }),
  },
} satisfies CatalogDefinitions;
