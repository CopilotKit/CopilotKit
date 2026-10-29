import { z } from "zod";
import { CHILDREN_SLOT, sizeValue, weightProp } from "./layout";

export const pulseIndicatorSchema = z.object({
  label: z
    .string()
    .optional()
    .describe(
      "What the dot means, for screen readers. Leave it unset when text next to the dot says the same",
    ),
  color: z.string().optional().describe('Text color token. Default "success"'),
  size: z.number().optional().describe("Pixels. Default 12"),
  pulseColor: z.string().optional(),
  duration: z.number().optional().describe("Milliseconds. Default 1500"),
  endScale: z.number().optional().describe("Default 2.4"),
  startOpacity: z.number().optional().describe("Default 0.6"),
});
export const flashcardSchema = z.object({
  front: z.string().optional().describe("The text on the front"),
  back: z.string().optional().describe("The text on the back"),
  hint: z
    .string()
    .optional()
    .describe('A small line under the front, for example "Click to flip"'),
});
export const popoverSchema = z.object({
  open: z.boolean().optional().describe("Default false"),
  showOnHover: z.boolean().optional(),
  hoverOpenDelay: z
    .number()
    .optional()
    .describe("Milliseconds before a hover opens it. Default 0"),
});
export const popoverTriggerSchema = z.object({
  block: z.boolean().optional().describe("Full width"),
});
export const popoverContentSchema = z.object({
  side: z
    .enum(["top", "bottom", "left", "right"])
    .optional()
    .describe('Default "bottom"'),
  sideOffset: z
    .number()
    .optional()
    .describe("Pixels between the trigger and the content. Default 6"),
  align: z
    .enum(["start", "center", "end"])
    .optional()
    .describe('Default "center"'),
  width: sizeValue.optional().describe("4px steps when a number"),
});
export const modalSchema = z.object({
  title: z.string().optional().describe("The heading of the dialog"),
  open: z
    .boolean()
    .optional()
    .describe('Default false. Bind it with { "@path": "/x" } to read it'),
  maxWidth: sizeValue.optional().describe("Default 480"),
  weight: weightProp,
});

/**
 * The standard feedback components, without their framework components: a
 * pulse dot, a flashcard, a popover and a modal. Popover, PopoverTrigger and
 * PopoverContent have a "multiple" `children` slot. Popover and Modal `open`
 * is writable, so the component gets a `setOpen` prop.
 */
export const feedbackDeclarations = {
  PulseIndicator: {
    description:
      'A small dot that pulses, for example next to the text "Live". Set label when no text next to the dot says what it means.',
    props: pulseIndicatorSchema,
  },
  FlashcardFlip: {
    description:
      "A card that shows the front text. A click or the Enter key flips it to the back text, and again to the front.",
    props: flashcardSchema,
  },
  Popover: {
    description:
      "A small overlay next to a trigger. Put exactly two children in it: one PopoverTrigger, then one PopoverContent. A click on the trigger opens and closes the content. Escape or a click outside closes it.",
    props: popoverSchema,
    slots: CHILDREN_SLOT,
    writable: ["open"] as const,
  },
  PopoverTrigger: {
    description:
      "The trigger of a Popover. Its children are the label of the trigger: a Text or an Icon. Do not put a Button in it, because the trigger is already a button.",
    props: popoverTriggerSchema,
    slots: CHILDREN_SLOT,
  },
  PopoverContent: {
    description:
      "The body of a Popover. It shows only when the Popover is open.",
    props: popoverContentSchema,
    slots: CHILDREN_SLOT,
  },
  Modal: {
    description:
      "A dialog over the page. A click on the trigger (a Button or a Text) opens the content in the dialog. Escape, the close button or a click on the backdrop closes it.",
    props: modalSchema,
    slots: { trigger: "single", content: "single" } as const,
    writable: ["open"] as const,
  },
};
