import { Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ComparisonChat } from "#app/components/comparison-chat.tsx";
import { ProductCard } from "#app/components/product-card.tsx";
import { useCompare } from "#app/contexts/compare.tsx";
import type { ProductCardInfo } from "#app/domain/products.server.js";
import {
  constructPrefixedTitle,
  getMetaFromMatches,
  getMetaTitle,
} from "#app/utils/metadata.js";
import type { Route } from "./+types/compare";

type CompareData = {
  products: Array<ProductCardInfo>;
  suggestions: Array<ProductCardInfo>;
};

export const meta: Route.MetaFunction = ({ matches }) => {
  const rootMeta = getMetaFromMatches(matches, "root");
  const prefix = getMetaTitle(rootMeta);
  return [
    {
      title: constructPrefixedTitle("Compare products", prefix),
    },
  ];
};

export default function ComparePage() {
  const compare = useCompare();
  const [data, setData] = useState<CompareData | null>(null);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (!compare.isHydrated) return;
    const controller = new AbortController();
    setFetching(true);
    fetch(`/api/compare-data?ids=${compare.ids.join(",")}`, {
      signal: controller.signal,
    })
      .then((r) => r.json() as Promise<CompareData>)
      .then(setData)
      .catch((error) => {
        if (error.name !== "AbortError") throw error;
      })
      .finally(() => setFetching(false));
    return () => controller.abort();
  }, [compare.isHydrated, compare.ids]);

  if (!compare.isHydrated || (data === null && fetching)) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-stone-50 dark:bg-gray-900">
        <Loader2 className="h-8 w-8 animate-spin text-amber-600" />
      </div>
    );
  }

  const products = data?.products ?? [];
  const suggestions = data?.suggestions ?? [];
  const hasEnoughToCompare = products.length >= 2;

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-gray-900">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-3xl font-light text-gray-900 dark:text-white">
            Compare products
          </h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {products.length} in comparison
            </span>
            {products.length > 0 ? (
              <button
                onClick={() => compare.clear()}
                className="text-xs text-gray-500 underline hover:text-amber-600 dark:text-gray-400"
              >
                Clear all
              </button>
            ) : null}
          </div>
        </div>

        {products.length === 0 ? (
          <div className="rounded-lg border border-dashed border-stone-300 bg-white p-12 text-center dark:border-gray-700 dark:bg-gray-800">
            <p className="mb-2 text-base text-gray-700 dark:text-gray-200">
              Your comparison is empty.
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Click <strong>Add to compare</strong> on any product to start.
            </p>
            <Link
              to="/products"
              className="mt-6 inline-block rounded-full bg-amber-600 px-6 py-2 text-sm font-medium text-white hover:bg-amber-700"
            >
              Browse products
            </Link>
          </div>
        ) : (
          <>
            <section className="mb-12">
              <h2 className="mb-4 text-sm font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400">
                In your comparison
              </h2>
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {products.map((p) => (
                  <div key={p.id} className="relative">
                    <button
                      onClick={() => compare.remove(p.id)}
                      aria-label={`Remove ${p.name} from comparison`}
                      className="absolute top-2 right-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-white/95 text-gray-500 shadow-sm transition-colors hover:bg-red-50 hover:text-red-600 dark:bg-gray-800 dark:text-gray-300"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                    <ProductCard product={p} />
                  </div>
                ))}
              </div>
            </section>

            {hasEnoughToCompare ? (
              <section className="mb-12">
                <h2 className="mb-4 text-sm font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400">
                  Side-by-side
                </h2>
                <ComparisonChat products={products} />
              </section>
            ) : (
              <section className="mb-12 rounded-lg border border-dashed border-stone-300 bg-white p-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
                Add at least one more product to start comparing.
              </section>
            )}
          </>
        )}

        {suggestions.length > 0 ? (
          <section>
            <h2 className="mb-4 text-sm font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400">
              Similar products to compare against
            </h2>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {suggestions.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
