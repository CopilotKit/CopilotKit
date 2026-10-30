import { Minus, Plus, Star, Trash2 } from "lucide-react";
import { Link } from "react-router";
import { z } from "zod";
import {
  createGenerativeUI,
  standardUI,
} from "@copilotkit/react-core/generative-ui";
import type { GenerativeUIComponentProps } from "@copilotkit/react-core/generative-ui";
import { ProductCard } from "#app/components/product-card.tsx";
import { useCart } from "#app/contexts/cart.tsx";

function ProductGrid({
  title,
  children,
}: GenerativeUIComponentProps<typeof shopUI, "ProductGrid">) {
  // The columns follow the width of the grid, not of the window: the same
  // grid renders in a full-width page row and in the narrow chat popup.
  return (
    <section className="@container">
      {title ? (
        <h3 className="mb-6 text-xl font-light text-gray-900 dark:text-white">
          {title}
        </h3>
      ) : null}
      <div className="grid grid-cols-1 gap-8 @lg:grid-cols-2 @5xl:grid-cols-4">
        {children}
      </div>
    </section>
  );
}

function ProductList({
  title,
  children,
}: GenerativeUIComponentProps<typeof shopUI, "ProductList">) {
  return (
    <section>
      {title ? (
        <h3 className="mb-6 text-xl font-light text-gray-900 dark:text-white">
          {title}
        </h3>
      ) : null}
      <div className="space-y-6">{children}</div>
    </section>
  );
}

/** The store's product card, with the product data from the agent. */
function GeneratedProductCard({
  productId,
  name,
  brand,
  description,
  imageUrl,
  price,
  rating,
  reviewCount,
}: GenerativeUIComponentProps<typeof shopUI, "ProductCard">) {
  return (
    <ProductCard
      product={{
        id: productId,
        name,
        description,
        imageUrl,
        price,
        reviewScore: rating,
        brand: { name: brand },
        _count: { reviews: reviewCount },
      }}
    />
  );
}

/**
 * A detailed card of one cart item: the full description, the rating, and
 * live quantity controls. The quantity comes from the cart, not the agent.
 */
function CartItemCard({
  productId,
  name,
  brand,
  description,
  imageUrl,
  rating,
  reviewCount,
  size,
  color,
  note,
}: GenerativeUIComponentProps<typeof shopUI, "CartItemCard">) {
  const cart = useCart();
  const id = cart.getItemId({ productId, size, color });
  const item = cart.items.find((i) => cart.getItemId(i) === id);

  if (!item) {
    return (
      <div className="rounded-lg border border-dashed border-stone-300 p-6 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
        This item is no longer in your cart.
      </div>
    );
  }
  return (
    <article className="@container rounded-lg bg-white shadow-sm dark:bg-gray-800">
      <div className="flex flex-col @lg:flex-row">
        <Link to={`/products/${productId}`} className="flex-shrink-0 @lg:w-56">
          <img
            src={imageUrl}
            alt={name}
            className="h-48 w-full rounded-t-lg object-cover @lg:h-full @lg:rounded-l-lg @lg:rounded-tr-none"
          />
        </Link>
        <div className="flex flex-1 flex-col gap-3 p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-amber-600 dark:text-amber-500">
                {brand}
              </div>
              <Link
                to={`/products/${productId}`}
                className="text-lg font-medium text-gray-900 hover:text-amber-600 dark:text-white"
              >
                {name}
              </Link>
              <div className="mt-1 flex items-center gap-1 text-sm text-gray-600 dark:text-gray-300">
                <Star className="h-4 w-4 fill-current text-amber-500" />
                {rating.toFixed(1)} · {reviewCount} reviews
              </div>
            </div>
            <button
              type="button"
              onClick={() => cart.removeItem(id)}
              className="p-2 text-gray-400 transition-colors hover:text-red-500"
              aria-label={`Remove ${name}`}
            >
              <Trash2 className="h-5 w-5" />
            </button>
          </div>
          {note ? (
            <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">
              {note}
            </p>
          ) : null}
          <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">
            {description}
          </p>
          <div className="mt-auto flex flex-wrap items-center justify-between gap-4 border-t border-stone-100 pt-3 dark:border-gray-700">
            <div className="text-sm text-gray-600 dark:text-gray-300">
              Size {size} · {color}
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => cart.updateQuantity(id, item.quantity - 1)}
                className="rounded border border-gray-300 p-1 hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-700"
                aria-label="Decrease quantity"
              >
                <Minus className="h-4 w-4" />
              </button>
              <span className="w-6 text-center font-medium text-gray-900 dark:text-white">
                {item.quantity}
              </span>
              <button
                type="button"
                onClick={() => cart.updateQuantity(id, item.quantity + 1)}
                className="rounded border border-gray-300 p-1 hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-700"
                aria-label="Increase quantity"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold text-gray-900 dark:text-white">
                ${(item.price * item.quantity).toFixed(2)}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                ${item.price} each
              </div>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

const productFields = {
  productId: z.string().describe("The id from the tool result."),
  name: z.string(),
  brand: z.string().describe("The brand name."),
  description: z
    .string()
    .describe(
      "The description from the tool result. You can shorten it to two sentences.",
    ),
  imageUrl: z.string().describe("The imageUrl from the tool result."),
  rating: z.number().describe("The reviewScore from the tool result."),
  reviewCount: z.number().describe("_count.reviews from the tool result."),
};

export const shopUI = createGenerativeUI({
  id: "epicstore/shop@1",
  // The standard components (tables, charts, forms, and more) can render in
  // the chat. The page surfaces limit themselves to the shop components.
  extends: [standardUI],
  components: {
    ProductGrid: {
      component: ProductGrid,
      description:
        "A grid of products. Put the ids of ProductCard or CartItemCard components in children.",
      props: z.object({ title: z.string().optional() }),
      slots: { children: "multiple" },
    },
    ProductList: {
      component: ProductList,
      description:
        "A vertical list, one item per row. Put the ids of ProductCard or CartItemCard components in children.",
      props: z.object({ title: z.string().optional() }),
      slots: { children: "multiple" },
    },
    ProductCard: {
      component: GeneratedProductCard,
      description:
        "One product of the store. Copy every value from a product of a tool result. Never invent a product or a value.",
      props: z.object({ ...productFields, price: z.number() }),
    },
    CartItemCard: {
      component: CartItemCard,
      description:
        "A detailed card of one item in the customer's cart: image, description, rating, size and color, quantity controls, and line total. Set productId, size, and color exactly as in the cart in your context. Get the other values with the getProducts tool and copy them. The card reads the price and the quantity from the cart. Leave note out, unless the customer asked for advice about the items: then note is one short sentence about this product, for example what it is good for. Never describe the card or the layout in note.",
      props: z.object({
        ...productFields,
        size: z.string(),
        color: z.string(),
        note: z.string().optional(),
      }),
    },
  },
});
