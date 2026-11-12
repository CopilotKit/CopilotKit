import { Filter, Grid, List } from "lucide-react";
import { useState, useRef } from "react";
import { useSearchParams, useNavigation } from "react-router";
import { ProductCard } from "#app/components/product-card.js";
import { getAllBrands } from "#app/domain/brand.server.js";
import { getAllCategories } from "#app/domain/category.server.js";
import {
  extractProductFiltersFromSearchParams,
  getProducts,
} from "#app/domain/products.server.js";
import { useIntersectionObserver } from "#app/hooks/use-intersection-observer.js";
import {
  getMetaFromMatches,
  getMetaTitle,
  constructPrefixedTitle,
} from "#app/utils/metadata.js";
import { ProductFilters } from "./+/index/product-filters";
import { useInfiniteProductFetcher } from "./+/index/use-infinite-product-fetcher";
import type { Route } from "./+types/index";

export const meta: Route.MetaFunction = ({ matches }) => {
  const rootMeta = getMetaFromMatches(matches, "root");
  const prefix = getMetaTitle(rootMeta);
  return [
    {
      title: constructPrefixedTitle("All Products", prefix),
    },
  ];
};

export const loader = async ({ request }: Route.LoaderArgs) => {
  const url = new URL(request.url);
  const searchParams = url.searchParams;
  const filters = extractProductFiltersFromSearchParams(searchParams);

  const [{ products, pagination }, { categories }, { brands }] =
    await Promise.all([
      getProducts(filters),
      getAllCategories(),
      getAllBrands(),
    ]);

  return {
    products,
    pagination,
    categories,
    brands,
  };
};

export default function ProductsPage({ loaderData }: Route.ComponentProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const { loadMoreProducts, allProducts, hasMore, isLoadingMore } =
    useInfiniteProductFetcher(loaderData);
  const isPageLoading = navigation.state !== "idle";
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [showFilters, setShowFilters] = useState(false);
  const observerRef = useRef<HTMLDivElement>(null);
  useIntersectionObserver(observerRef, loadMoreProducts);

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-gray-900">
      {/* Header */}
      <div className="sticky top-20 z-40 border-b border-stone-200 bg-white opacity-90 dark:border-gray-700 dark:bg-gray-900">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-3xl font-light tracking-tight text-gray-900 dark:text-white">
                All Products
              </h1>
              <p className="mt-2 text-gray-600 dark:text-gray-300">
                {loaderData.pagination.totalCount} products total (
                {allProducts.length} shown)
              </p>
            </div>
            <div className="mt-4 flex items-center space-x-4 md:mt-0">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="flex items-center space-x-2 rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50 md:hidden dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <Filter className="h-4 w-4" />
                <span>Filters</span>
              </button>
              <select
                name="perPage"
                onChange={(e) =>
                  setSearchParams((prev) => {
                    const newParams = new URLSearchParams(prev);
                    newParams.set("perPage", e.target.value);
                    newParams.delete("page"); // Reset page when changing limit
                    return newParams;
                  })
                }
                defaultValue={searchParams.get("perPage") || "9"}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-900 focus:ring-2 focus:ring-amber-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              >
                <option value="9">Show 9</option>
                <option value="12">Show 12</option>
                <option value="24">Show 24</option>
                <option value="48">Show 48</option>
                <option value="96">Show 96</option>
              </select>
              <select
                name="sortBy"
                onChange={(e) =>
                  setSearchParams((prev) => {
                    const newParams = new URLSearchParams(prev);
                    newParams.set("sortBy", e.target.value);
                    newParams.delete("page"); // Reset page when changing sort
                    return newParams;
                  })
                }
                defaultValue={searchParams.get("sortBy") || "name"}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-900 focus:ring-2 focus:ring-amber-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              >
                <option value="name">Sort by Name</option>
                <option value="price-low">Price: Low to High</option>
                <option value="price-high">Price: High to Low</option>
                <option value="rating">Highest Rated</option>
              </select>
              <div className="flex overflow-hidden rounded-lg border border-gray-300 dark:border-gray-600">
                <button
                  onClick={() => setViewMode("grid")}
                  className={`p-2 ${viewMode === "grid" ? "bg-amber-600 text-white" : "bg-white text-gray-700 dark:bg-gray-800 dark:text-gray-300"}`}
                >
                  <Grid className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setViewMode("list")}
                  className={`p-2 ${viewMode === "list" ? "bg-amber-600 text-white" : "bg-white text-gray-700 dark:bg-gray-800 dark:text-gray-300"}`}
                >
                  <List className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-8 lg:flex-row">
          {/* Filters Sidebar */}
          <div
            className={`relative lg:w-64 ${showFilters ? "block" : "hidden lg:block"}`}
          >
            <ProductFilters isPageLoading={isPageLoading} />
          </div>

          {/* Products Grid/List */}
          <div className="flex-1">
            {isPageLoading ? (
              <div className="mb-4 text-center text-gray-500 dark:text-gray-400">
                Loading...
              </div>
            ) : (
              <>
                <div
                  className={
                    viewMode === "grid"
                      ? "grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3"
                      : "space-y-6"
                  }
                >
                  {allProducts.map((product) => (
                    <ProductCard key={product.id} product={product} />
                  ))}
                </div>

                {/* Intersection observer target */}
                {hasMore && (
                  <div ref={observerRef} className="mt-8 flex justify-center">
                    {isLoadingMore ? (
                      <div className="text-center text-gray-500 dark:text-gray-400">
                        <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-amber-600 border-t-transparent" />
                        <p className="mt-2">Loading more products...</p>
                      </div>
                    ) : (
                      <div className="h-4 w-full" />
                    )}
                  </div>
                )}

                {/* End of results message */}
                {!hasMore && allProducts.length > 0 && (
                  <div className="mt-8 text-center text-gray-500 dark:text-gray-400">
                    <p>You've reached the end of the product list!</p>
                  </div>
                )}
              </>
            )}

            {allProducts.length === 0 && (
              <div className="py-16 text-center">
                <div className="mb-4 text-gray-400 dark:text-gray-600">
                  <Filter className="mx-auto h-16 w-16" />
                </div>
                <h3 className="mb-2 text-xl font-medium text-gray-900 dark:text-white">
                  No products found
                </h3>
                <p className="text-gray-600 dark:text-gray-400">
                  Try adjusting your filters to see more results.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
