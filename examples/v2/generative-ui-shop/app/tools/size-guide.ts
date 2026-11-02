import { toolDefinition } from "#app/tools/tool-definition.ts";
import { z } from "zod";
import { getProductById } from "#app/domain/products.server.ts";

const SizeGuideInput = z.object({
  productId: z.string().describe("The product to fetch the size guide for."),
});

const SizeGuideOutput = z.object({
  brand: z.string(),
  productName: z.string(),
  guide: z.string(),
});

// Hardcoded per-brand sizing notes. In a real store these would come from a
// brands table or CMS — for the workshop we keep them inline.
const SIZE_GUIDES: Record<string, string> = {
  Nike: "Nike footwear generally runs about half a size small. If you usually wear a 10, consider a 10.5. Their size 10 is approximately 28cm / 11 in.",
  Adidas:
    "Adidas runs true to size. Their size 10 is approximately 28.5cm / 11.2 in.",
  Puma: "Puma footwear runs slightly large. Order a half size down if you have a narrow foot.",
  "New Balance":
    "New Balance offers wide and extra-wide variants. Their standard size 10 is 28cm / 11 in.",
};

const DEFAULT_GUIDE =
  "No specific size guide on file for this brand. As a general rule, our size 10 is approximately 28cm / 11 in. If you are between sizes, we recommend sizing up.";

const getSizeGuideDef = toolDefinition({
  name: "getSizeGuide",
  description:
    'Get the size guide for a specific product. Use this when the customer asks about sizing, fit, "what size should I get?", "does this run small?", or similar fit-related questions.',
  inputSchema: SizeGuideInput,
  outputSchema: SizeGuideOutput,
  lazy: true,
});

export const getSizeGuide = getSizeGuideDef.server(async ({ productId }) => {
  const product = await getProductById(productId);
  if (!product) {
    return { brand: "unknown", productName: "unknown", guide: DEFAULT_GUIDE };
  }
  const brand = product.brand.name;
  return {
    brand,
    productName: product.name,
    guide: SIZE_GUIDES[brand] ?? DEFAULT_GUIDE,
  };
});
