import { Award, Trophy } from "lucide-react";
import { Skeleton } from "#app/components/skeleton.tsx";
import type { PartialComparison } from "#app/schemas/comparison.ts";

type ProductSummary = {
  id: string;
  name: string;
  brand: { name: string };
  imageUrl: string;
  price: number;
};

export function ComparisonTable({
  comparison,
  products,
}: {
  comparison: PartialComparison;
  products: Array<ProductSummary>;
}) {
  const productById = new Map(products.map((p) => [p.id, p]));
  const dimensions = comparison.dimensions ?? [];
  const rankings = [...(comparison.rankings ?? [])].sort(
    (a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity),
  );

  return (
    <section className="space-y-8">
      <header className="rounded-lg border border-stone-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-2 text-xs font-medium tracking-wide text-amber-600 uppercase dark:text-amber-500">
          Comparing for:{" "}
          {comparison.criteria ?? <Skeleton className="w-32 align-middle" />}
        </div>
        <p className="text-base leading-relaxed text-gray-700 dark:text-gray-200">
          {comparison.summary ?? (
            <span className="flex flex-col gap-2">
              <Skeleton className="w-full" />
              <Skeleton className="w-3/4" />
            </span>
          )}
        </p>
      </header>

      <div>
        <h2 className="mb-4 text-lg font-medium text-gray-900 dark:text-white">
          Rankings
        </h2>
        {rankings.length === 0 ? (
          <div className="rounded-lg border border-stone-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <Skeleton className="w-1/2" />
          </div>
        ) : (
          <ol className="space-y-3">
            {rankings.map((r, idx) => {
              const product = r.productId
                ? productById.get(r.productId)
                : undefined;
              const isWinner = r.rank === 1;
              return (
                <li
                  key={r.productId ?? `ranking-${idx}`}
                  className={`flex items-start gap-4 rounded-lg border p-4 ${
                    isWinner
                      ? "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40"
                      : "border-stone-200 bg-white dark:border-gray-700 dark:bg-gray-800"
                  }`}
                >
                  <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-amber-600 text-sm font-bold text-white">
                    {isWinner ? (
                      <Trophy className="h-5 w-5" />
                    ) : r.rank !== undefined ? (
                      `#${r.rank}`
                    ) : (
                      "…"
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="text-base font-medium text-gray-900 dark:text-white">
                      {product?.name ?? r.productId ?? (
                        <Skeleton className="w-40" />
                      )}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {product?.brand.name}
                      {product ? ` · $${product.price}` : null}
                    </div>
                    <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
                      {r.reason ?? <Skeleton className="w-full" />}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <div>
        <h2 className="mb-4 text-lg font-medium text-gray-900 dark:text-white">
          Dimensions
        </h2>
        <div className="overflow-x-auto rounded-lg border border-stone-200 dark:border-gray-700">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-stone-100 dark:bg-gray-800">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-300">
                  Dimension
                </th>
                {products.map((p) => (
                  <th
                    key={p.id}
                    className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-300"
                  >
                    {p.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dimensions.length === 0 ? (
                <tr className="border-t border-stone-200 dark:border-gray-700">
                  <td
                    colSpan={products.length + 1}
                    className="px-4 py-3 text-gray-400"
                  >
                    <Skeleton className="w-1/3" />
                  </td>
                </tr>
              ) : (
                dimensions.map((d, dIdx) => (
                  <tr
                    key={d.name ?? `dim-${dIdx}`}
                    className="border-t border-stone-200 dark:border-gray-700"
                  >
                    <td className="bg-stone-50 px-4 py-3 font-medium text-gray-800 dark:bg-gray-900 dark:text-gray-100">
                      {d.name ?? <Skeleton className="w-20" />}
                    </td>
                    {products.map((p) => {
                      const cell = d.values?.find((v) => v.productId === p.id);
                      const hasEdge = d.edge === p.id;
                      const cellValue = cell?.value;
                      return (
                        <td
                          key={p.id}
                          className={`px-4 py-3 align-top text-gray-700 dark:text-gray-200 ${
                            hasEdge ? "bg-amber-50/60 dark:bg-amber-950/30" : ""
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            {hasEdge ? (
                              <Award className="mt-0.5 h-4 w-4 flex-none text-amber-600 dark:text-amber-500" />
                            ) : null}
                            <span>
                              {cellValue ?? <Skeleton className="w-16" />}
                            </span>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
