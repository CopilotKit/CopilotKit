import { z } from "zod";
import {
  DynamicNumberSchema,
  DynamicStringSchema,
  AccessibilityAttributesSchema,
} from "@a2ui/web_core/v0_9";

const CommonProps = {
  accessibility: AccessibilityAttributesSchema.optional(),
  weight: z.number().optional(),
};

export const StarRatingApi = {
  name: "StarRating" as const,
  schema: z.object({
    ...CommonProps,
    value: DynamicNumberSchema.describe("Rating value from 0 to maxStars"),
    maxStars: z
      .number()
      .default(5)
      .optional()
      .describe("Maximum number of stars"),
    label: DynamicStringSchema.optional().describe(
      "Label text displayed above the rating",
    ),
  }),
};
