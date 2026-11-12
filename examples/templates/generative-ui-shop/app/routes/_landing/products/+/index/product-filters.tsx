import { Form, useLoaderData, useSearchParams } from "react-router";
import type { Route } from "../../+types/index";

interface ProductFiltersProps {
  isPageLoading: boolean;
}

export function ProductFilters({ isPageLoading }: ProductFiltersProps) {
  const loaderData = useLoaderData<Route.ComponentProps["loaderData"]>();
  const [searchParams] = useSearchParams();
  const priceMin = searchParams.get("priceMin") || "";
  const priceMax = searchParams.get("priceMax") || "";
  return (
    <Form className="sticky top-60">
      <div className="space-y-6 rounded-lg bg-white p-6 dark:bg-gray-800">
        <div>
          <h3 className="mb-4 text-lg font-medium text-gray-900 dark:text-white">
            Category
          </h3>
          <div className="space-y-2">
            {loaderData.categories.map((category) => (
              <div key={category.id} className="flex items-center">
                <input
                  className="peer hidden"
                  type="checkbox"
                  id={category.id}
                  disabled={isPageLoading}
                  defaultChecked={searchParams
                    .getAll("category")
                    .includes(category.name)}
                  name="category"
                  value={category.name}
                />
                <label
                  className={`block w-full rounded-lg px-2 py-1 text-left text-gray-700 transition-colors duration-200 peer-checked:bg-amber-100 peer-checked:text-amber-800 hover:bg-gray-100 dark:text-gray-300 dark:peer-checked:bg-amber-900/30 dark:peer-checked:text-amber-200 dark:hover:bg-gray-700`}
                  htmlFor={category.id}
                >
                  {category.name}
                </label>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="mb-4 text-lg font-medium text-gray-900 dark:text-white">
            Brand
          </h3>
          <div className="space-y-2">
            {loaderData.brands.map((brand) => (
              <div key={brand.id} className="flex items-center">
                <input
                  className="peer hidden"
                  type="checkbox"
                  id={brand.id}
                  defaultChecked={searchParams
                    .getAll("brand")
                    .includes(brand.name)}
                  disabled={isPageLoading}
                  name="brand"
                  value={brand.name}
                />
                <label
                  className={`block w-full rounded-lg px-2 py-1 text-left text-gray-700 transition-colors duration-200 peer-checked:bg-amber-100 peer-checked:text-amber-800 hover:bg-gray-100 dark:text-gray-300 dark:peer-checked:bg-amber-900/30 dark:peer-checked:text-amber-200 dark:hover:bg-gray-700`}
                  htmlFor={brand.id}
                >
                  {brand.name}
                </label>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="mb-4 text-lg font-medium text-gray-900 dark:text-white">
            Price Range
          </h3>
          <div className="flex items-center justify-center gap-2">
            <input
              type="number"
              name="priceMin"
              defaultValue={priceMin}
              placeholder="1"
              disabled={isPageLoading}
              className="w-1/2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:ring-2 focus:ring-amber-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            />

            <input
              type="number"
              name="priceMax"
              placeholder="999"
              defaultValue={priceMax}
              disabled={isPageLoading}
              className="w-1/2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:ring-2 focus:ring-amber-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            />
          </div>
        </div>

        <button
          disabled={isPageLoading}
          type="submit"
          className="w-full rounded-lg bg-amber-600 px-4 py-2 font-medium text-white transition-colors duration-300 hover:bg-amber-700 disabled:opacity-50"
        >
          Apply Filters
        </button>
      </div>
    </Form>
  );
}
