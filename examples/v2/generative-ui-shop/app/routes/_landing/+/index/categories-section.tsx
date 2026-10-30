import { Link } from "react-router";
import type { Category } from "#app/domain/category.server.ts";

export const CategoriesSection = ({
  categories,
}: {
  categories: Category[];
}) => {
  return (
    <div className="bg-stone-50 py-32 dark:bg-gray-800">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-20 text-center">
          <h2 className="mb-6 text-4xl font-extralight tracking-tight text-gray-900 dark:text-white">
            Shop by Category
          </h2>
          <p className="text-xl leading-relaxed font-light text-gray-600 dark:text-gray-300">
            Find the perfect shoes for every occasion and lifestyle
          </p>
        </div>

        <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-4">
          {categories.map((category, index) => (
            <Link
              key={index}
              to={`/products?category=${category.name}`}
              className="group relative overflow-hidden rounded-lg bg-white shadow-lg transition-all duration-300 hover:scale-105 hover:transform hover:shadow-xl dark:bg-gray-900"
            >
              <div className="aspect-w-1 aspect-h-1">
                <img
                  src={category.imageUrl}
                  alt={category.name}
                  className="h-64 w-full object-cover transition-transform duration-500 group-hover:scale-110"
                />
              </div>
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
              <div className="absolute bottom-6 left-6 text-white">
                <h3 className="mb-1 text-2xl font-light">{category.name}</h3>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
};
