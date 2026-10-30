import { toolDefinition } from "#app/tools/tool-definition.ts";
import { z } from "zod";
import {
  getProductById,
  getProducts,
  getProductsByIds,
  getRelatedProducts,
} from "#app/domain/products.server.ts";

const ProductInfo = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  imageUrl: z.string(),
  price: z.number(),
  reviewScore: z.number(),
  brand: z.object({ id: z.string(), name: z.string() }),
  _count: z.object({ reviews: z.number() }),
});

const ProductList = z.object({
  products: z.array(ProductInfo),
});

const SearchProductsInput = z.object({
  query: z
    .string()
    .optional()
    .describe(
      'Optional free-text search across product names and descriptions. Leave it out to search by the filters only. Words like "shoes" match nothing, because every product is a shoe.',
    ),
  brand: z
    .string()
    .optional()
    .describe('Optional brand name to filter by, e.g. "Nike".'),
  category: z
    .string()
    .optional()
    .describe(
      "Optional category to filter by. One of: Running, Casual, Athletic, Lifestyle, Hiking, Comfort, Formal.",
    ),
  priceMax: z
    .number()
    .optional()
    .describe(
      "Optional maximum price. Returns only products at or below this price.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe("How many products to return. Defaults to 5."),
});

const findSimilarProductsDef = toolDefinition({
  name: "findSimilarProducts",
  description:
    "Find products similar to a given product (same category and brand). Use this when the customer wants alternatives — for example when their preferred size is out of stock, or when they want to compare a few options.",
  inputSchema: z.object({
    productId: z
      .string()
      .describe("The id of the product to find similar items for."),
  }),
  outputSchema: ProductList,
});

export const findSimilarProducts = findSimilarProductsDef.server(
  async ({ productId }) => {
    const product = await getProductById(productId);
    if (!product) return { products: [] };
    const products = await getRelatedProducts(
      productId,
      product.category.id,
      product.brand.id,
    );
    return { products };
  },
);

const recommendProductsDef = toolDefinition({
  name: "recommendProducts",
  description:
    "Recommend top-rated products from the catalog. Use this when the customer is browsing and asks for suggestions or popular picks.",
  inputSchema: z.object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe("How many products to recommend. Defaults to 5."),
  }),
  outputSchema: ProductList,
});

export const recommendProducts = recommendProductsDef.server(
  async ({ limit = 5 }) => {
    const { products } = await getProducts({ sortBy: "rating", limit });
    return { products };
  },
);

const searchProductsDef = toolDefinition({
  name: "searchProducts",
  description:
    "Search the EpicStore catalog by free-text query and optional filters. Use this whenever the customer asks about products that are not the one they are currently looking at.",
  inputSchema: SearchProductsInput,
  outputSchema: ProductList,
});

export const searchProducts = searchProductsDef.server(
  async ({ query, brand, category, priceMax, limit = 5 }) => {
    const { products } = await getProducts({
      search: query,
      brand: brand ? [brand] : undefined,
      category: category ? [category] : undefined,
      priceMax,
      limit,
    });
    return { products };
  },
);

const getProductsDef = toolDefinition({
  name: "getProducts",
  description:
    "Get the products of the given ids, with their name, brand, description, image, price, and rating. Use this when you know the ids but not the product data, for example for the items in the customer's cart.",
  inputSchema: z.object({
    productIds: z
      .array(z.string())
      .min(1)
      .max(20)
      .describe("The ids of the products to get."),
  }),
  outputSchema: ProductList,
});

export const getProductsTool = getProductsDef.server(
  async ({ productIds }) => ({
    products: await getProductsByIds(productIds),
  }),
);
