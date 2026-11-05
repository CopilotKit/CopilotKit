import { getAllCategories } from "#app/domain/category.server.ts";
import { getProducts } from "#app/domain/products.server.ts";
import { getMetaFromMatches, getMetaTitle } from "#app/utils/metadata.js";
import { CategoriesSection } from "./+/index/categories-section";
import { FeaturedProductsSection } from "./+/index/featured-products.section";
import { FeaturesSection } from "./+/index/features-section";
import { HeroSection } from "./+/index/hero-section";
import { NewsletterSection } from "./+/index/newsletter-section";
import type { Route } from "./+types/index";

export const meta: Route.MetaFunction = ({ matches }) => {
  const rootMeta = getMetaFromMatches(matches, "root");
  const title = getMetaTitle(rootMeta);
  return [{ title }];
};

export const loader = async () => {
  const [{ products }, { categories }] = await Promise.all([
    getProducts(),
    getAllCategories({ perPage: 4 }),
  ]);

  return { products, categories };
};

export default function HomePage({ loaderData }: Route.ComponentProps) {
  return (
    <div className="bg-stone-50 dark:bg-gray-900">
      <HeroSection />
      <FeaturesSection />
      <CategoriesSection categories={loaderData.categories} />
      <FeaturedProductsSection products={loaderData.products} />
      <NewsletterSection />
    </div>
  );
}
