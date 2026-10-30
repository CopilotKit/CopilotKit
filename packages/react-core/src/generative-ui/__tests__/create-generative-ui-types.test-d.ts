// Type-only assertions, read by `tsc --noEmit` (`check-types`), never executed.
// Same mechanism as `v2/__tests__/headless-type-exports.test-d.ts`.
//
// The components type their props from `typeof storeUI`, while `storeUI`
// references the components. This must not be a circular type error.
import { expectTypeOf } from "vitest";
import type { ReactNode } from "react";
import { z } from "zod";
import { createGenerativeUI } from "../catalog";
import type {
  GenerativeUIComponentProps,
  GenerativeUIFunctionArgs,
  GenerativeUIFunctionInput,
  GenerativeUIFunctionName,
  GenerativeUIStateOf,
} from "../catalog";
import type {
  GenerativeUIEventHandler,
  GenerativeUIInvokeResult,
} from "../errors";

const cartSchema = z.object({
  count: z.number(),
  total: z.number(),
  items: z.array(z.object({ productId: z.string(), quantity: z.number() })),
});

const addToCartParameters = z.object({
  productId: z.string(),
  quantity: z.number().int().default(1),
});

interface Cart {
  count: number;
  total: number;
  items: { productId: string; quantity: number }[];
}

function CartSummary(
  props: GenerativeUIComponentProps<typeof storeUI, "CartSummary">,
) {
  void props;
  return null;
}

function ProductCard({
  name,
  onAddToCart,
}: GenerativeUIComponentProps<typeof storeUI, "ProductCard">) {
  void name;
  void onAddToCart;
  return null;
}

function CheckoutForm(
  props: GenerativeUIComponentProps<typeof storeUI, "CheckoutForm">,
) {
  void props;
  return null;
}

const storeUI = createGenerativeUI({
  id: "store@1",
  state: { cart: cartSchema, currency: z.string() },
  functions: {
    addToCart: { description: "Add", parameters: addToCartParameters },
    applyCoupon: { parameters: z.object({ code: z.string() }) },
  },
  components: {
    CartSummary: {
      component: CartSummary,
      // `currency` has the name of a state key, so it is bound by name.
      props: z.object({
        count: z.number(),
        total: z.number(),
        currency: z.string(),
      }),
      bind: {
        count: (state) => {
          expectTypeOf(state).toEqualTypeOf<{
            cart: Cart;
            currency: string;
          }>();
          return state.cart.count;
        },
        total: (state) => state.cart.total,
      },
    },
    ProductCard: {
      component: ProductCard,
      description: "A product the user can buy.",
      props: z.object({
        productId: z.string(),
        name: z.string(),
        inCart: z.number(),
      }),
      bind: {
        inCart: (state, props) => {
          expectTypeOf(props).toEqualTypeOf<{
            productId: string;
            name: string;
          }>();
          return (
            state.cart.items.find((item) => item.productId === props.productId)
              ?.quantity ?? 0
          );
        },
      },
      // Matches `addToCart` without the `on` prefix.
      events: { onAddToCart: {} },
    },
    CheckoutForm: {
      component: CheckoutForm,
      props: z.object({ email: z.string().optional() }),
      events: {
        // Matches `applyCoupon`. Its own parameters fit the function input.
        onApplyCoupon: {
          description: "Apply",
          parameters: z.object({ code: z.string() }),
        },
        // Matches no function, so the model binds it.
        onSubmit: {
          description: "Submit",
          parameters: z.object({ email: z.string() }),
        },
      },
      slots: { footer: "single" },
    },
  },
});

// ---- Component props ----

expectTypeOf<
  GenerativeUIComponentProps<typeof storeUI, "CartSummary">
>().toEqualTypeOf<{ count: number; total: number; currency: string }>();

expectTypeOf<
  GenerativeUIComponentProps<typeof storeUI, "ProductCard">
>().toEqualTypeOf<{
  productId: string;
  name: string;
  inCart: number;
  // A matched event without parameters takes the function input.
  onAddToCart?: (args: {
    productId: string;
    quantity?: number | undefined;
  }) => Promise<GenerativeUIInvokeResult>;
}>();

expectTypeOf<
  GenerativeUIComponentProps<typeof storeUI, "CheckoutForm">
>().toEqualTypeOf<{
  email?: string | undefined;
  onApplyCoupon?: (args: { code: string }) => Promise<GenerativeUIInvokeResult>;
  onSubmit?: (args: { email: string }) => Promise<GenerativeUIInvokeResult>;
  footer?: ReactNode;
}>();

// ---- State and functions, for the hooks ----

expectTypeOf<GenerativeUIStateOf<typeof storeUI>>().toEqualTypeOf<{
  cart: Cart;
  currency: string;
}>();

expectTypeOf<GenerativeUIFunctionName<typeof storeUI>>().toEqualTypeOf<
  "addToCart" | "applyCoupon"
>();

expectTypeOf<
  GenerativeUIFunctionInput<typeof storeUI, "addToCart">
>().toEqualTypeOf<{ productId: string; quantity?: number | undefined }>();

expectTypeOf<
  GenerativeUIFunctionArgs<typeof storeUI, "addToCart">
>().toEqualTypeOf<{ productId: string; quantity: number }>();

// ---- bind errors ----

createGenerativeUI({
  id: "bind-unknown-key@1",
  state: { cart: cartSchema },
  components: {
    Card: {
      component: CartSummary,
      props: z.object({ count: z.number() }),
      bind: {
        // @ts-expect-error "missing" is not a prop of the component.
        missing: (state) => state.cart.count,
      },
    },
  },
});

createGenerativeUI({
  id: "bind-wrong-return@1",
  state: { cart: cartSchema, currency: z.string() },
  components: {
    Card: {
      component: CartSummary,
      props: z.object({ count: z.number() }),
      bind: {
        // @ts-expect-error a string does not fit the `count` schema input.
        count: (state) => state.currency,
      },
    },
  },
});

createGenerativeUI({
  id: "bind-without-props@1",
  state: { cart: cartSchema },
  components: {
    Card: {
      component: CartSummary,
      bind: {
        // @ts-expect-error the component has no props to bind.
        count: (state) => state.cart.count,
      },
    },
  },
});

// ---- Name rule ----

createGenerativeUI({
  id: "name-mismatch@1",
  state: { total: z.string() },
  components: {
    // @ts-expect-error state "total" is a string, but the prop is a number.
    Card: {
      component: CartSummary,
      props: z.object({ total: z.number() }),
    },
  },
});

// A `bind` entry wins over the name rule, so the state type does not matter.
createGenerativeUI({
  id: "name-mismatch-bound@1",
  state: { total: z.string() },
  components: {
    Card: {
      component: CartSummary,
      props: z.object({ total: z.number() }),
      bind: { total: (state) => Number(state.total) },
    },
  },
});

// ---- Event rules ----

createGenerativeUI({
  id: "unmatched-event@1",
  components: {
    Form: {
      component: CheckoutForm,
      events: {
        // @ts-expect-error an unmatched event needs `parameters`.
        onSubmit: {},
      },
    },
  },
});

createGenerativeUI({
  id: "event-params-mismatch@1",
  functions: { addToCart: { parameters: addToCartParameters } },
  components: {
    Card: {
      component: ProductCard,
      events: {
        onAddToCart: {
          description: "Add",
          // @ts-expect-error the output has no `productId`, the function input needs it.
          parameters: z.object({ quantity: z.number() }),
        },
      },
    },
  },
});

// An exact function name matches too.
createGenerativeUI({
  id: "exact-event@1",
  functions: { addToCart: { parameters: addToCartParameters } },
  components: {
    Card: { component: ProductCard, events: { addToCart: {} } },
  },
});

// ---- Other errors ----

createGenerativeUI({
  id: "not-a-component@1",
  // @ts-expect-error a number is not a component.
  components: { Broken: { component: 42 } },
});

// ---- extends ----

function WidgetCard(
  props: GenerativeUIComponentProps<typeof appUI, "WidgetCard">,
) {
  void props;
  return null;
}

const widgets = createGenerativeUI({
  id: "widgets@1",
  state: { theme: z.enum(["light", "dark"]) },
  components: {
    WidgetCard: {
      component: WidgetCard,
      props: z.object({ productId: z.string(), cart: cartSchema }),
      // The base declares parameters, because it has no `addToCart` itself.
      events: {
        onAddToCart: { parameters: z.object({ productId: z.string() }) },
      },
    },
  },
});

const appUI = createGenerativeUI({
  id: "app@1",
  extends: [widgets],
  state: { cart: cartSchema },
  functions: { addToCart: { parameters: addToCartParameters } },
  components: {
    Badge: {
      component: CartSummary,
      props: z.object({ label: z.string() }),
      bind: {
        label: (state) => {
          // The selector sees the base state too.
          expectTypeOf(state).toEqualTypeOf<{
            theme: "light" | "dark";
            cart: Cart;
          }>();
          return state.theme;
        },
      },
    },
  },
});

expectTypeOf<GenerativeUIStateOf<typeof appUI>>().toEqualTypeOf<{
  theme: "light" | "dark";
  cart: Cart;
}>();

expectTypeOf<
  GenerativeUIFunctionName<typeof appUI>
>().toEqualTypeOf<"addToCart">();

expectTypeOf<
  GenerativeUIComponentProps<typeof appUI, "WidgetCard">
>().toEqualTypeOf<{
  productId: string;
  cart: Cart;
  onAddToCart?: (args: {
    productId: string;
  }) => Promise<GenerativeUIInvokeResult>;
}>();

expectTypeOf<
  GenerativeUIEventHandler<typeof appUI, "onAddToCart">
>().toEqualTypeOf<
  (args: { productId: string }) => Promise<GenerativeUIInvokeResult>
>();
