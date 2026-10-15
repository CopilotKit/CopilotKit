"use client";
import { z } from "zod";
import {
  CopilotChat,
  CopilotKitProvider,
  GenerativeUISurface,
  useAgentContext,
  useFrontendTool,
  useGenerativeUIFunction,
  useGenerativeUIState,
} from "@copilotkit/react-core/v2";
import type { GenerativeUIConfig } from "@copilotkit/react-core/v2";
import { storeUI } from "./catalog";
import { useCart } from "./cart";
import type { Cart } from "./cart";
import { PRODUCTS } from "./products";

export const dynamic = "force-dynamic";

const generativeUI: GenerativeUIConfig = {
  ui: storeUI,
  errorBoundary: {
    onError: (info) =>
      console.warn(
        "[generative-ui demo]",
        info.kind,
        info.surfaceId,
        info.componentId,
        info.error.message,
      ),
  },
};

function CartBindings({ cart }: { cart: Cart }) {
  useGenerativeUIState(storeUI, "cart", {
    count: cart.count,
    total: cart.total,
    coupon: cart.coupon,
    items: cart.items.map(({ productId, quantity }) => ({
      productId,
      quantity,
    })),
  });
  useGenerativeUIFunction(storeUI, "addToCart", ({ productId, quantity }) => {
    cart.addItem(productId, quantity);
    return { added: productId, quantity };
  });
  useGenerativeUIFunction(storeUI, "applyCoupon", ({ code }) => {
    cart.applyCoupon(code);
    return `Coupon ${code} applied`;
  });
  // The model does not see the cart state. Give the agent the contents too,
  // so it can answer questions like "what's my total?".
  useAgentContext({
    description: "The user's current shopping cart",
    value: {
      items: cart.items.map(({ productId, name, price, quantity }) => ({
        productId,
        name,
        price,
        quantity,
      })),
      count: cart.count,
      subtotal: cart.subtotal,
      coupon: cart.coupon,
      total: cart.total,
    },
  });
  return null;
}

function CartTools({ cart }: { cart: Cart }) {
  // A tool for the agent only. It is not declared in createGenerativeUI, so
  // generated UI cannot call it.
  useFrontendTool({
    name: "removeFromCart",
    description: "Remove a product from the cart",
    parameters: z.object({ productId: z.string() }),
    handler: async ({ productId }) => {
      cart.removeItem(productId);
      return `Removed ${productId}`;
    },
  });
  return null;
}

function Storefront({ cart }: { cart: Cart }) {
  return (
    <div className="grid h-screen grid-cols-[1fr_420px]">
      <main className="overflow-auto p-6">
        <header className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-semibold">Acme Audio</h1>
          <span
            data-testid="cart-badge"
            className="rounded-full bg-black px-3 py-1 text-sm text-white"
          >
            Cart {cart.count} · ${cart.total}
            {cart.coupon ? ` (${cart.coupon})` : ""}
          </span>
        </header>
        <div className="grid grid-cols-[1fr_360px] gap-6">
          <section className="grid grid-cols-2 gap-3 self-start">
            {PRODUCTS.map((p) => (
              <article key={p.id} className="rounded-lg border p-3">
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-gray-500">{p.tagline}</div>
                <div className="mt-2 flex justify-between">
                  <span>${p.price}</span>
                  <button
                    className="text-xs underline"
                    onClick={() => cart.addItem(p.id, 1)}
                  >
                    Add
                  </button>
                </div>
              </article>
            ))}
          </section>
          <aside className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-600">
              Recommended for you
            </h2>
            <GenerativeUISurface
              id="recommendations"
              description="Next to the product list. Use it for product recommendations."
              fallback={
                <div className="rounded-lg border border-dashed p-4 text-sm text-gray-400">
                  Ask the assistant for recommendations.
                </div>
              }
            />
          </aside>
        </div>
      </main>
      <div className="border-l">
        <CopilotChat
          labels={{
            chatInputPlaceholder: "Try: recommend headphones under $200",
          }}
        />
      </div>
    </div>
  );
}

export default function GenerativeUIDemoPage() {
  const cart = useCart();
  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit-generative-ui"
      generativeUI={generativeUI}
    >
      <CartBindings cart={cart} />
      <CartTools cart={cart} />
      <Storefront cart={cart} />
    </CopilotKitProvider>
  );
}
