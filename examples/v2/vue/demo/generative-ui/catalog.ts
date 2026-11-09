import { z } from "zod";
import { createGenerativeUI } from "@copilotkit/vue/v2/generative-ui";
import CartSummary from "./CartSummary.vue";
import CheckoutForm from "./CheckoutForm.vue";
import DiagnosticWidget from "./DiagnosticWidget.vue";
import ProductCard from "./ProductCard.vue";
import ProductGrid from "./ProductGrid.vue";

const cartSchema = z.object({
  count: z.number(),
  total: z.number(),
  coupon: z.string().nullable(),
  items: z.array(z.object({ productId: z.string(), quantity: z.number() })),
});

/**
 * The components the agent can render on the store page, the cart state
 * they read, and the functions they call. Mirrors `storeUI` of the React
 * demo (`examples/v2/react/demo/src/app/generative-ui/catalog.tsx`).
 */
export const storeUI = createGenerativeUI({
  id: "acme/storefront@1",
  state: { cart: cartSchema },
  functions: {
    addToCart: {
      description: "Add a product to the cart",
      parameters: z.object({
        productId: z.string(),
        quantity: z.number().int().min(1).max(10).default(1),
      }),
    },
    applyCoupon: {
      description: "Apply a coupon code to the cart",
      parameters: z.object({ code: z.string() }),
    },
  },
  components: {
    ProductGrid: {
      component: ProductGrid,
      description:
        "Grid of product cards. Put ProductCard (or DiagnosticWidget) ids in children.",
      props: z.object({ title: z.string().optional() }),
      slots: { children: "multiple" },
    },
    ProductCard: {
      component: ProductCard,
      description:
        "A product the user can buy. Set productId to the product's id.",
      props: z.object({
        productId: z.string(),
        name: z.string(),
        price: z.number(),
        tagline: z.string().optional(),
        inCart: z.number(),
      }),
      bind: {
        inCart: (state, { productId }) =>
          state.cart.items.find((item) => item.productId === productId)
            ?.quantity ?? 0,
      },
      events: { onAddToCart: {} },
    },
    CartSummary: {
      component: CartSummary,
      description: "Live cart summary.",
      props: z.object({ count: z.number(), total: z.number() }),
      bind: {
        count: (state) => state.cart.count,
        total: (state) => state.cart.total,
      },
    },
    CheckoutForm: {
      component: CheckoutForm,
      description:
        'Checkout form. Optionally prefill email and note. Bind onSubmit to exactly {"event":{"name":"place_order","userMessage":"Place my order"}}.',
      props: z.object({
        email: z.string().optional(),
        note: z.string().optional(),
      }),
      // The user's input wins over later agent updates of these props.
      writable: ["email", "note"],
      events: {
        onApplyCoupon: {},
        onSubmit: {
          description: "User placed the order",
          parameters: z.object({ email: z.string(), note: z.string() }),
        },
      },
    },
    DiagnosticWidget: {
      component: DiagnosticWidget,
      description:
        "Debug-only. Shows a label; throws during render when crash is true (demonstrates error isolation).",
      props: z.object({ label: z.string(), crash: z.boolean().optional() }),
    },
  },
});
