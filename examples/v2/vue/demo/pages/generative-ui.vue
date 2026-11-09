<script setup lang="ts">
import { defineComponent } from "vue";
import { z } from "zod";
import {
  CopilotChat,
  CopilotKitProvider,
  useAgentContext,
  useConfigureSuggestions,
  useFrontendTool,
} from "@copilotkit/vue/v2";
import {
  GenerativeUISurface,
  useGenerativeUIFunction,
  useGenerativeUIState,
} from "@copilotkit/vue/v2/generative-ui";
import type { GenerativeUIConfig } from "@copilotkit/vue/v2/generative-ui";
import { useCart } from "~/generative-ui/cart";
import { storeUI } from "~/generative-ui/catalog";
import { PRODUCTS } from "~/generative-ui/products";

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

const cart = useCart();

// The composables below need the provider, so they run in children of
// `CopilotKitProvider`, like `CartBindings` and `CartTools` in React.
const CartBindings = defineComponent({
  name: "CartBindings",
  setup() {
    useGenerativeUIState(storeUI, "cart", () => ({
      count: cart.count.value,
      total: cart.total.value,
      coupon: cart.coupon.value,
      items: cart.items.value.map(({ productId, quantity }) => ({
        productId,
        quantity,
      })),
    }));
    useGenerativeUIFunction(storeUI, "addToCart", ({ productId, quantity }) => {
      cart.addItem(productId, quantity);
      return { added: productId, quantity };
    });
    useGenerativeUIFunction(storeUI, "applyCoupon", ({ code }) => {
      cart.applyCoupon(code);
      return `Coupon ${code} applied`;
    });
    // The model does not see the cart state. Give the agent the contents
    // too, so it can answer questions like "what's my total?".
    useAgentContext({
      description: "The user's current shopping cart",
      value: () => ({
        items: cart.items.value,
        count: cart.count.value,
        subtotal: cart.subtotal.value,
        coupon: cart.coupon.value,
        total: cart.total.value,
      }),
    });
    return () => null;
  },
});

const CartTools = defineComponent({
  name: "CartTools",
  setup() {
    // A tool for the agent only. It is not declared in createGenerativeUI,
    // so generated UI cannot call it.
    useFrontendTool({
      name: "removeFromCart",
      description: "Remove a product from the cart",
      parameters: z.object({ productId: z.string() }),
      handler: async ({ productId }) => {
        cart.removeItem(productId);
        return `Removed ${productId}`;
      },
    });
    // Try the "products" surface: the first message swaps the product
    // list, the second one brings the featured products back.
    // Temporary divergence from React: a config without `consumerAgentId`
    // loads only for agents that exist when it is added, and the runtime
    // agents are not loaded yet at setup. Naming the agent loads it at once.
    useConfigureSuggestions({
      available: "always",
      consumerAgentId: "default",
      suggestions: [
        { title: "Buy headphones", message: "I want to buy headphones" },
        {
          title: "Featured products",
          message: "Show the featured products again",
        },
      ],
    });
    return () => null;
  },
});

const productsDescription =
  "The main product list of the store. When the user asks for a kind of product (for example headphones), show the matching products here: a ProductGrid root with one ProductCard for each product. When the user asks for the featured products again, delete this surface, and the featured products come back.";
</script>

<template>
  <CopilotKitProvider
    runtime-url="/api/copilotkit-generative-ui"
    :generativeUI="generativeUI"
  >
    <CartBindings />
    <CartTools />
    <div class="grid h-screen grid-cols-[1fr_420px]">
      <main class="overflow-auto p-6">
        <header class="mb-6 flex items-center justify-between">
          <h1 class="text-xl font-semibold">Acme Audio</h1>
          <span
            data-testid="cart-badge"
            class="rounded-full bg-black px-3 py-1 text-sm text-white"
          >
            Cart {{ cart.count.value }}, ${{ cart.total.value }}
            {{ cart.coupon.value ? `(${cart.coupon.value})` : "" }}
          </span>
        </header>
        <div class="grid grid-cols-[1fr_360px] gap-6">
          <GenerativeUISurface
            id="products"
            :ui="storeUI"
            :description="productsDescription"
            :components="['ProductGrid', 'ProductCard']"
            class="self-start"
          >
            <!-- The product list that shows until the agent replaces it. -->
            <section class="grid grid-cols-2 gap-3 self-start">
              <article
                v-for="product in PRODUCTS"
                :key="product.id"
                class="rounded-lg border p-3"
              >
                <div class="font-medium">{{ product.name }}</div>
                <div class="text-xs text-gray-500">{{ product.tagline }}</div>
                <div class="mt-2 flex justify-between">
                  <span>${{ product.price }}</span>
                  <button
                    type="button"
                    class="text-xs underline"
                    @click="cart.addItem(product.id, 1)"
                  >
                    Add
                  </button>
                </div>
              </article>
            </section>
          </GenerativeUISurface>
          <aside class="space-y-2">
            <h2 class="text-sm font-semibold text-gray-600">
              Recommended for you
            </h2>
            <GenerativeUISurface
              id="recommendations"
              description="Next to the product list. Use it for product recommendations."
            >
              <div
                class="rounded-lg border border-dashed p-4 text-sm text-gray-400"
              >
                Ask the assistant for recommendations.
              </div>
            </GenerativeUISurface>
          </aside>
        </div>
      </main>
      <div class="min-h-0 border-l">
        <CopilotChat />
      </div>
    </div>
  </CopilotKitProvider>
</template>
