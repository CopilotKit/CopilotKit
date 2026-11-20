import { db } from "#app/db.server.js";
import type {
  ProductWhereInput,
  ProductSelect,
  ProductOrderByWithRelationInput,
} from "#app/generated/prisma/models.ts";

interface ProductFilters {
  category?: string[];
  brand?: string[];
  priceMin?: number;
  priceMax?: number;
  sortBy?: "name" | "price-low" | "price-high" | "rating";
  page?: number;
  limit?: number;
  search?: string;
}

// Define select object without strict typing for _count support
const productShortInfoSelect = {
  id: true,
  name: true,
  description: true,
  imageUrl: true,
  price: true,
  brand: {
    select: {
      id: true,
      name: true,
    },
  },
  reviewScore: true,
  _count: {
    select: {
      reviews: true,
    },
  },
} as const satisfies ProductSelect;

export const extractProductFiltersFromSearchParams = (
  searchParams: URLSearchParams,
): ProductFilters => {
  const search = searchParams.get("q") || undefined;
  const category = searchParams.getAll("category") || [];
  const brand = searchParams.getAll("brand") || [];
  const priceMin = searchParams.get("priceMin")
    ? parseFloat(searchParams.get("priceMin")!)
    : undefined;
  const priceMax = searchParams.get("priceMax")
    ? parseFloat(searchParams.get("priceMax")!)
    : undefined;
  const sortBy = (searchParams.get("sortBy") || "name") as
    | "name"
    | "price-low"
    | "price-high"
    | "rating";
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("perPage") || "9");
  return { search, category, brand, priceMin, priceMax, sortBy, page, limit };
};

function createProductOrderBy(
  sortBy: ProductFilters["sortBy"],
): ProductOrderByWithRelationInput | undefined {
  switch (sortBy) {
    case "name":
      return { name: "asc" };
    case "price-low":
      return { price: "asc" };
    case "price-high":
      return { price: "desc" };
    case "rating":
      return { reviewScore: "desc" };
    default:
      return { name: "asc" };
  }
}

function createProductWhereClause(filters?: ProductFilters): ProductWhereInput {
  return {
    OR: filters?.search
      ? [
          { name: filters.search ? { contains: filters.search } : undefined },
          {
            description: filters.search
              ? { contains: filters.search }
              : undefined,
          },
        ]
      : undefined,
    category:
      filters?.category && filters.category.length > 0
        ? { name: { in: filters.category } }
        : undefined,
    brand:
      filters?.brand && filters.brand.length > 0
        ? { name: { in: filters.brand } }
        : undefined,

    price: {
      gte: filters?.priceMin ?? 0,
      lte: filters?.priceMax ?? 300,
    },
  };
}

export async function getProducts(filters?: ProductFilters) {
  const page = filters?.page ?? 1;
  const limit = filters?.limit ?? 4;
  const skip = (page - 1) * limit;

  const whereClause = createProductWhereClause(filters);

  const orderByClause = createProductOrderBy(filters?.sortBy);

  // Get products with pagination
  const products = await db.product.findMany({
    where: whereClause,
    orderBy: orderByClause,
    select: productShortInfoSelect,
    skip,
    take: limit,
  });

  // Get total count for pagination metadata
  const totalCount = await db.product.count({
    where: whereClause,
  });

  const hasMore = skip + products.length < totalCount;

  return {
    products,
    pagination: {
      page,
      limit,
      totalCount,
      hasMore,
      totalPages: Math.ceil(totalCount / limit),
    },
  };
}

export async function getProductById(id: string) {
  const product = await db.product.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      description: true,
      imageUrl: true,
      price: true,
      reviewScore: true,
      category: {
        select: {
          id: true,
          name: true,
        },
      },
      brand: {
        select: {
          id: true,
          name: true,
        },
      },
      reviews: {
        select: {
          id: true,
          rating: true,
          comment: true,
        },
      },
      variations: {
        select: {
          color: true,
          size: true,
          id: true,
          quantity: true,
        },
      },
    },
  });
  return product;
}

/** The products of the ids, in the order of the ids. Unknown ids are left out. */
export async function getProductsByIds(ids: string[]) {
  const products = await db.product.findMany({
    where: { id: { in: ids } },
    select: productShortInfoSelect,
  });
  return ids.flatMap((id) => products.filter((p) => p.id === id));
}

export async function getRelatedProducts(
  productId: string | undefined,
  categoryId: string | undefined,
  brandId: string | undefined,
) {
  if (!productId) {
    return [];
  }
  const products = await db.product.findMany({
    where: {
      id: { not: productId },
      OR: [{ categoryId: categoryId }, { brandId: brandId }],
    },
    select: productShortInfoSelect,
    take: 4,
  });
  return products;
}

export type ProductCardInfo = Awaited<
  ReturnType<typeof getProducts>
>["products"][number];
