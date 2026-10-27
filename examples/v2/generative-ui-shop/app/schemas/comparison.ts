import { z } from "zod";
import { withJsonSchema } from "#app/schemas/json-schema.ts";

/**
 * The shape the model writes into on every comparison turn.
 *
 * Every `.describe(...)` call below ends up inside the JSON Schema the
 * model sees. The model reads those descriptions to decide what each field
 * should contain — so treat them as prompt engineering, not documentation.
 * Be specific about format ("$129", not "the price"), about who decides
 * (the customer's stated criteria, not yours), and about what counts as
 * "good enough" (one or two sentences, at least 2 dimensions, etc.).
 *
 * Constraints (`.min`, `.int`, `.nullable`) are how you tell the model
 * "this field is required to make sense" — an empty array of dimensions
 * is technically valid JSON but useless for a comparison, so we require
 * at least two.
 */
export const ComparisonSchema = withJsonSchema(
  z.object({
    criteria: z
      .string()
      .describe(
        'The lens the customer wants this comparison through, in their own words. Examples: "Best price-to-quality ratio", "Most durable for hiking", "Best for everyday use". Use "Overall comparison" if the customer has not stated a preference yet.',
      ),
    dimensions: z
      .array(
        z.object({
          name: z
            .string()
            .describe(
              'A short label for this attribute. Examples: "Price", "Materials", "Weight", "Warranty".',
            ),
          values: z
            .array(
              z.object({
                productId: z
                  .string()
                  .describe("The product this value belongs to."),
                value: z
                  .string()
                  .describe(
                    'A short, human-readable description of this product on this dimension. Format numbers the way a customer would expect: "$129", "3 days", "Leather + waxed cotton". Keep it under 10 words.',
                  ),
              }),
            )
            .min(1)
            .describe(
              "One entry per product being compared on this dimension.",
            ),
          edge: z
            .string()
            .nullable()
            .describe(
              "The productId that has the edge on this dimension. Set to null if the dimension is too close to call or does not have a clear winner.",
            ),
        }),
      )
      .min(2)
      .describe(
        "The attributes that actually differentiate these products for the stated `criteria`. Pick the dimensions a real customer would weigh — do not enumerate every spec on the box.",
      ),
    rankings: z
      .array(
        z.object({
          productId: z.string(),
          rank: z
            .number()
            .int()
            .min(1)
            .describe(
              "1 is the best fit for `criteria`. Each product gets a unique rank.",
            ),
          reason: z
            .string()
            .describe(
              "A short justification for this rank. Reference the dimensions that drove it. One or two sentences.",
            ),
        }),
      )
      .min(1)
      .describe(
        "One entry per product being compared. Sort the array ascending by `rank` so the best fit appears first.",
      ),
    summary: z
      .string()
      .describe(
        'A one or two sentence verdict in plain language. Imagine you are telling a friend "here is what I would pick and why". Do not enumerate the dimensions — the table already shows them.',
      ),
  }),
);

export type Comparison = z.infer<typeof ComparisonSchema>;

/**
 * A `DeepPartial<Comparison>` — every field (and every field of every
 * nested object/array element) is optional. This is the shape `useChat`
 * exposes as `partial` while the model is still writing: fields land one
 * at a time as their JSON tokens are parsed.
 *
 * The `<ComparisonTable />` accepts this shape so it can render skeleton
 * placeholders for fields that haven't streamed in yet, then fill them
 * in as tokens arrive.
 */
export type PartialComparison = {
  criteria?: string;
  dimensions?: Array<{
    name?: string;
    values?: Array<{
      productId?: string;
      value?: string;
    }>;
    edge?: string | null;
  }>;
  rankings?: Array<{
    productId?: string;
    rank?: number;
    reason?: string;
  }>;
  summary?: string;
};
