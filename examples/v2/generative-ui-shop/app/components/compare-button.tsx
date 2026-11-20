import { GitCompare } from "lucide-react";
import { Link } from "react-router";
import { useCompare } from "#app/contexts/compare.tsx";

export function CompareButton() {
  const { count, isHydrated } = useCompare();
  const displayCount = isHydrated ? count : 0;
  return (
    <Link
      to="/compare"
      aria-label={`Compare list with ${displayCount} ${displayCount === 1 ? "product" : "products"}`}
      className="relative inline-flex items-center p-2 text-gray-700 transition-colors duration-300 hover:text-amber-600 dark:text-gray-300 dark:hover:text-amber-500"
    >
      <GitCompare className="h-5 w-5" />
      {displayCount > 0 ? (
        <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-600 px-1 text-[10px] font-semibold text-white">
          {displayCount > 99 ? "99+" : displayCount}
        </span>
      ) : null}
    </Link>
  );
}
