import { GenerativeUISurface } from "@copilotkit/react-core/generative-ui";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router";
import { ProductCard } from "#app/components/product-card.js";
import type { ProductCardInfo } from "#app/domain/products.server.js";
import { shopUI } from "#app/generative-ui/catalog.tsx";

interface FeaturedProductsSectionProps {
  products: ProductCardInfo[];
}

export const FeaturedProductsSection = ({
  products,
}: FeaturedProductsSectionProps) => {
  return (
    <div className="bg-white py-32 dark:bg-gray-900">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-20 text-center">
          <h2 className="mb-6 text-4xl font-extralight tracking-tight text-gray-900 dark:text-white">
            Featured Products
          </h2>
          <p className="text-xl leading-relaxed font-light text-gray-600 dark:text-gray-300">
            Handpicked favorites from our premium collection
          </p>
        </div>

        {/* The assistant can swap these products. Until it does, and after
            it deletes its surface, the featured products show. */}
        <GenerativeUISurface
          ui={shopUI}
          id="featured"
          description="The Featured Products section of the home page. When the customer asks to see products on the home page, show them here: a ProductGrid root with one ProductCard for each product, and a short ProductGrid title that names what you show. When the customer asks for the featured products again, delete this surface."
          components={["ProductGrid", "ProductCard"]}
          fallback={
            <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-4">
              {products.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          }
        />

        <div className="mt-12 text-center">
          <Link
            to="/products"
            className="group inline-flex items-center bg-amber-600 px-8 py-3 text-lg font-medium tracking-wide text-white transition-all duration-300 hover:bg-amber-700 hover:shadow-lg hover:shadow-amber-600/25"
          >
            View All Products
            <ArrowRight className="ml-3 h-5 w-5 transition-transform duration-300 group-hover:translate-x-1" />
          </Link>
        </div>
      </div>
    </div>
  );
};
