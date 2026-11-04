import { toolDefinition } from "#app/tools/tool-definition.ts";
import { z } from "zod";

const ShippingEstimateInput = z.object({
  zipCode: z
    .string()
    .regex(/^\d{5}(-\d{4})?$/, "US ZIP code (5 digits or ZIP+4).")
    .describe("US ZIP code where the order would be shipped."),
});

const ShippingEstimateOutput = z.object({
  cost: z.number(),
  days: z.number(),
  region: z.string(),
});

function estimate(zipCode: string) {
  const prefix = zipCode[0];
  if (prefix === "9") return { cost: 5, days: 2, region: "West Coast" };
  if (prefix === "0" || prefix === "1")
    return { cost: 5, days: 3, region: "East Coast" };
  return { cost: 8, days: 5, region: "Other US" };
}

const getShippingEstimateDef = toolDefinition({
  name: "getShippingEstimate",
  description:
    'Estimate shipping cost and delivery time for an order to a given US ZIP code. Use this when the customer asks "how long does shipping take?", "how much for shipping to X?", or similar.',
  inputSchema: ShippingEstimateInput,
  outputSchema: ShippingEstimateOutput,
  lazy: true,
});

export const getShippingEstimate = getShippingEstimateDef.server(
  ({ zipCode }) => estimate(zipCode),
);
