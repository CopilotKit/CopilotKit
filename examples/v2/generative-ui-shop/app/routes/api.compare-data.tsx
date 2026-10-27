import {
  getProductById,
  getProducts,
  getRelatedProducts,
} from "#app/domain/products.server.ts";
import type { Route } from "./+types/api.compare-data";

/**
 * Server-side data for the compare page. Takes a comma-separated `ids`
 * query string and returns:
 *
 *   - `products`: the products being compared, in the order requested
 *     (with unknown ids filtered out)
 *   - `suggestions`: related products the customer might also want to
 *     compare, anchored on the first product in the list. Falls back to
 *     top-rated products from the catalog if no `ids` are provided.
 *
 * The compare page reads its product IDs from `useCompare()` (localStorage),
 * so it can't be server-loaded by the route — it fetches this endpoint
 * on the client whenever the compare list changes.
 */
export const loader = async ({ request }: Route.LoaderArgs) => {
  const url = new URL(request.url);
  const ids = (url.searchParams.get("ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  const loadedRaw = await Promise.all(ids.map((id) => getProductById(id)));
  const loaded = loadedRaw.filter(
    (p): p is NonNullable<typeof p> => p !== null,
  );
  const products = loaded.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    imageUrl: p.imageUrl,
    price: p.price,
    reviewScore: p.reviewScore,
    brand: { id: p.brand.id, name: p.brand.name },
    _count: { reviews: p.reviews.length },
  }));

  const selectedIds = new Set(products.map((p) => p.id));

  let suggestions: Array<(typeof products)[number]> = [];
  const anchor = loaded[0];
  if (anchor) {
    const related = await getRelatedProducts(
      anchor.id,
      anchor.category.id,
      anchor.brand.id,
    );
    suggestions = related.filter((p) => !selectedIds.has(p.id));
  } else {
    const { products: top } = await getProducts({ sortBy: "rating", limit: 8 });
    suggestions = top.filter((p) => !selectedIds.has(p.id));
  }

  return Response.json({ products, suggestions });
};
