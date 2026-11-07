import { toolDefinition } from "#app/tools/tool-definition.ts";
import { z } from "zod";
import { getProductById } from "#app/domain/products.server.ts";

const CareInstructionsInput = z.object({
  productId: z.string().describe("The product to fetch care instructions for."),
});

const CareInstructionsOutput = z.object({
  productName: z.string(),
  category: z.string(),
  instructions: z.string(),
});

// Hardcoded per-category care notes.
const CARE_BY_CATEGORY: Record<string, string> = {
  Athletic:
    "Wipe down the outer with a damp cloth after each wear. Air dry only — never tumble dry. If the laces need washing, remove them and hand-wash with mild soap.",
  Casual:
    "Spot-clean with a soft brush and mild detergent. Stuff with newspaper while drying to keep shape. Avoid direct sunlight.",
  Formal:
    "Use a leather conditioner every 2–3 months. Buff with a soft cloth. Store with shoe trees inside to retain shape.",
  Boots:
    "Apply waterproofing spray before first wear. Clean salt stains immediately with a damp cloth and white vinegar.",
};

const DEFAULT_CARE =
  "Wipe clean with a damp cloth as needed. Avoid the washing machine and tumble dryer — air-dry away from direct heat.";

const getCareInstructionsDef = toolDefinition({
  name: "getCareInstructions",
  description:
    'Get care and cleaning instructions for a specific product. Use this when the customer asks how to wash, clean, or care for their item, or "are these machine washable?".',
  inputSchema: CareInstructionsInput,
  outputSchema: CareInstructionsOutput,
  lazy: true,
});

export const getCareInstructions = getCareInstructionsDef.server(
  async ({ productId }) => {
    const product = await getProductById(productId);
    if (!product) {
      return {
        productName: "unknown",
        category: "unknown",
        instructions: DEFAULT_CARE,
      };
    }
    const category = product.category.name;
    return {
      productName: product.name,
      category,
      instructions: CARE_BY_CATEGORY[category] ?? DEFAULT_CARE,
    };
  },
);
