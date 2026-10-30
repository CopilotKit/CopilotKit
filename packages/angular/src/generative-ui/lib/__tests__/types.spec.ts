// Type-only assertions. They do nothing at runtime; `tsc -p tsconfig.spec.json
// --noEmit` checks them.
import { Component, input, signal } from "@angular/core";
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import type {
  GenerativeUIEventHandler,
  GenerativeUIInvokeResult,
} from "@copilotkit/shared/generative-ui";
import { createGenerativeUI } from "../catalog";
import type {
  GenerativeUIComponentInputs,
  GenerativeUIFunctionArgs,
  GenerativeUIFunctionInput,
  GenerativeUIFunctionName,
  GenerativeUIStateOf,
} from "../catalog";
import type { GenerativeUIChildren } from "../children";
import type {
  GenerativeUIConfig,
  GenerativeUIMarkdownConfig,
  GenerativeUIToolConfig,
} from "../config";

/** Keeps the type-error cases out of the runtime without a call. */
const typeOnly = (cases: () => void) => expectTypeOf(cases).toBeFunction();

describe("GenerativeUIComponentInputs", () => {
  // Typed through the generative UI that renders it.
  @Component({ template: "" })
  class CheckoutForm {
    readonly email =
      input<GenerativeUIComponentInputs<typeof ui, "CheckoutForm">["email"]>();
    readonly onSubmit =
      input<
        GenerativeUIComponentInputs<typeof ui, "CheckoutForm">["onSubmit"]
      >();
  }

  @Component({ template: "" })
  class Grid {
    readonly title =
      input<GenerativeUIComponentInputs<typeof ui, "Grid">["title"]>();
  }

  @Component({ template: "" })
  class Badge {}

  // A component with a writable prop types its own setter from `typeof ui`.
  @Component({ template: "" })
  class TextField {
    readonly value =
      input<GenerativeUIComponentInputs<typeof ui, "TextField">["value"]>();
    readonly setValue =
      input<GenerativeUIComponentInputs<typeof ui, "TextField">["setValue"]>();
  }

  const ui = createGenerativeUI({
    id: "props@1",
    components: {
      CheckoutForm: {
        component: CheckoutForm,
        props: z.object({
          email: z.string().optional(),
          quantity: z.number().default(1),
        }),
        events: {
          onSubmit: {
            parameters: z.object({ email: z.string(), note: z.string() }),
          },
        },
      },
      Grid: {
        component: Grid,
        props: z.object({ title: z.string() }),
        slots: { children: "multiple", header: "single" },
      },
      Badge: { component: Badge },
      TextField: {
        component: TextField,
        props: z.object({
          label: z.string().optional(),
          value: z.string().default(""),
        }),
        writable: ["value"],
      },
    },
  });

  it("types the data props from the schema output and the events as handlers", () => {
    expectTypeOf<
      GenerativeUIComponentInputs<typeof ui, "CheckoutForm">
    >().toEqualTypeOf<{
      email?: string | undefined;
      quantity: number;
      onSubmit?: (args: {
        email: string;
        note: string;
      }) => Promise<GenerativeUIInvokeResult>;
    }>();
  });

  it("types the slots as children handles", () => {
    expectTypeOf<
      GenerativeUIComponentInputs<typeof ui, "Grid">
    >().toEqualTypeOf<{
      title: string;
      children?: GenerativeUIChildren;
      header?: GenerativeUIChildren;
    }>();
  });

  it("types a component with no props as empty", () => {
    expectTypeOf<
      GenerativeUIComponentInputs<typeof ui, "Badge">
    >().toEqualTypeOf<{}>();
  });

  it("gives a writable prop its setter, which takes the schema input", () => {
    // `value` is writable, so it gets `setValue`. `label` is not, so it gets
    // no setter.
    expectTypeOf<
      GenerativeUIComponentInputs<typeof ui, "TextField">
    >().toEqualTypeOf<{
      label?: string | undefined;
      value: string;
      setValue: (value: string | undefined) => void;
    }>();
  });

  it("rejects a writable key that is not a prop, or that is bound", () => {
    typeOnly(() => {
      createGenerativeUI({
        id: "writable@1",
        components: {
          Field: {
            component: Badge,
            props: z.object({ value: z.string() }),
            // @ts-expect-error "missing" is not a prop of the component.
            writable: ["missing"],
          },
        },
      });

      createGenerativeUI({
        id: "writable-state@1",
        state: { value: z.string() },
        components: {
          Field: {
            component: Badge,
            props: z.object({ value: z.string() }),
            // @ts-expect-error "value" is bound to the state key of the same name.
            writable: ["value"],
          },
        },
      });
    });
  });

  it("rejects a component name that the UI does not have", () => {
    // @ts-expect-error "Missing" is not a component of the UI.
    type Missing = GenerativeUIComponentInputs<typeof ui, "Missing">;
    const missing: Missing | undefined = undefined;
    expect(missing).toBeUndefined();
  });
});

describe("GenerativeUIConfig", () => {
  const ui = createGenerativeUI({ id: "types", components: {} });

  it("is the tool config without `transport`", () => {
    expectTypeOf({ ui }).toMatchTypeOf<GenerativeUIToolConfig>();
    expectTypeOf({ ui }).not.toMatchTypeOf<GenerativeUIMarkdownConfig>();
  });

  it("takes the markdown options only with the markdown transport", () => {
    const markdown: GenerativeUIConfig = {
      ui,
      transport: "markdown",
      sendContext: false,
      includeCatalog: false,
    };
    expectTypeOf(markdown).toMatchTypeOf<GenerativeUIConfig>();

    typeOnly(() => {
      // tsc reports these two on the declaration line, not on the property.
      // @ts-expect-error sendContext exists only on the markdown transport
      const tool: GenerativeUIConfig = {
        ui,
        transport: "tool",
        sendContext: false,
      };
      // @ts-expect-error includeCatalog exists only on the markdown transport
      const toolWithoutTransport: GenerativeUIConfig = {
        ui,
        includeCatalog: false,
      };
      void tool;
      void toolWithoutTransport;
    });
  });

  it("takes a theme of `--a2ui-*` variables and mapStyle, as a value or a signal", () => {
    const themed: GenerativeUIConfig = {
      ui,
      theme: {
        "--a2ui-color-accent": "#4f46e5",
        mapStyle: "https://x/style",
        dark: { "--a2ui-color-panel": "#1f2937", mapStyle: "https://x/dark" },
      },
    };
    const reactive: GenerativeUIConfig = {
      ui,
      theme: signal({ "--a2ui-color-accent": "#4f46e5" }),
    };
    expectTypeOf(themed).toMatchTypeOf<GenerativeUIConfig>();
    expectTypeOf(reactive).toMatchTypeOf<GenerativeUIConfig>();

    typeOnly(() => {
      const unknownVariable: GenerativeUIConfig = {
        ui,
        theme: {
          // @ts-expect-error not a variable that the standard components read
          "--a2ui-color-acent": "#4f46e5",
        },
      };
      const unknownDarkVariable: GenerativeUIConfig = {
        ui,
        theme: {
          dark: {
            // @ts-expect-error not a variable that the standard components read
            "--a2ui-color-primary": "#000",
          },
        },
      };
      const badThemeKey: GenerativeUIConfig = {
        ui,
        // @ts-expect-error theme keys are `--a2ui-*` variables or mapStyle
        theme: { color: "red" },
      };
      void unknownVariable;
      void unknownDarkVariable;
      void badThemeKey;
    });
  });
});

// The components type their inputs from `typeof storeUI`, while `storeUI`
// references the components. This must not be a circular type error.

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

@Component({ template: "" })
class CartSummary {
  readonly count =
    input<
      GenerativeUIComponentInputs<typeof storeUI, "CartSummary">["count"]
    >();
}

@Component({ template: "" })
class ProductCard {
  readonly name =
    input<GenerativeUIComponentInputs<typeof storeUI, "ProductCard">["name"]>();
  readonly onAddToCart =
    input<
      GenerativeUIComponentInputs<typeof storeUI, "ProductCard">["onAddToCart"]
    >();
}

@Component({ template: "" })
class CheckoutForm {
  readonly email =
    input<
      GenerativeUIComponentInputs<typeof storeUI, "CheckoutForm">["email"]
    >();
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

describe("createGenerativeUI types", () => {
  it("types the component inputs, bound props included", () => {
    expectTypeOf<
      GenerativeUIComponentInputs<typeof storeUI, "CartSummary">
    >().toEqualTypeOf<{ count: number; total: number; currency: string }>();

    expectTypeOf<
      GenerativeUIComponentInputs<typeof storeUI, "ProductCard">
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
      GenerativeUIComponentInputs<typeof storeUI, "CheckoutForm">
    >().toEqualTypeOf<{
      email?: string | undefined;
      onApplyCoupon?: (args: {
        code: string;
      }) => Promise<GenerativeUIInvokeResult>;
      onSubmit?: (args: { email: string }) => Promise<GenerativeUIInvokeResult>;
      footer?: GenerativeUIChildren;
    }>();
  });

  it("types the state and the functions, for the helpers", () => {
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
  });

  it("rejects a bind that names no prop, returns the wrong type, or has no props", () => {
    typeOnly(() => {
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
    });
  });

  it("checks the name rule against the state type, unless `bind` wins", () => {
    typeOnly(() => {
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
    });
  });

  it("checks the event rules", () => {
    typeOnly(() => {
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
    });
  });

  it("rejects a component that is not a class", () => {
    typeOnly(() => {
      createGenerativeUI({
        id: "not-a-component@1",
        // @ts-expect-error a number is not a component.
        components: { Broken: { component: 42 } },
      });
    });
  });
});

@Component({ template: "" })
class WidgetCard {
  readonly productId =
    input<
      GenerativeUIComponentInputs<typeof appUI, "WidgetCard">["productId"]
    >();
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

describe("createGenerativeUI types with extends", () => {
  it("merges the state and the functions of the bases into the types", () => {
    expectTypeOf<GenerativeUIStateOf<typeof appUI>>().toEqualTypeOf<{
      theme: "light" | "dark";
      cart: Cart;
    }>();

    expectTypeOf<
      GenerativeUIFunctionName<typeof appUI>
    >().toEqualTypeOf<"addToCart">();

    expectTypeOf<
      GenerativeUIComponentInputs<typeof appUI, "WidgetCard">
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
  });
});

// Components look up their event handler types in the generative UI that
// renders them, so these components reference `typeof eventsUI` while the UI
// references the components.

@Component({ template: "" })
class EventsCheckoutForm {
  readonly onSubmit =
    input<GenerativeUIEventHandler<typeof eventsUI, "onSubmit">>();
}

@Component({ template: "" })
class EventsCard {
  readonly onAddToCart =
    input<GenerativeUIEventHandler<typeof eventsUI, "onAddToCart">>();
}

@Component({ template: "" })
class EventsBadge {}

const eventsUI = createGenerativeUI({
  id: "types@1",
  functions: {
    addToCart: {
      parameters: z.object({
        productId: z.string(),
        quantity: z.number().default(1),
      }),
    },
  },
  components: {
    CheckoutForm: {
      component: EventsCheckoutForm,
      events: {
        onSubmit: {
          parameters: z.object({ email: z.string(), note: z.string() }),
        },
      },
    },
    // Matches `addToCart` and has no parameters of its own.
    Card: { component: EventsCard, events: { onAddToCart: {} } },
    // The same matched event on a second component.
    MiniCard: { component: EventsBadge, events: { onAddToCart: {} } },
  },
});

describe("GenerativeUIEventHandler", () => {
  it("types a handler from the event parameters, or from the matched function input", () => {
    expectTypeOf<
      GenerativeUIEventHandler<typeof eventsUI, "onSubmit">
    >().toEqualTypeOf<
      (args: {
        email: string;
        note: string;
      }) => Promise<GenerativeUIInvokeResult>
    >();

    // A matched event without parameters takes the function input.
    expectTypeOf<
      GenerativeUIEventHandler<typeof eventsUI, "onAddToCart">
    >().toEqualTypeOf<
      (args: {
        productId: string;
        quantity?: number | undefined;
      }) => Promise<GenerativeUIInvokeResult>
    >();
  });

  it("rejects an event that no component of the UI has", () => {
    // @ts-expect-error "onRemove" is not an event of any component of the UI.
    type UnknownEvent = GenerativeUIEventHandler<typeof eventsUI, "onRemove">;
    const unknownEvent: UnknownEvent | undefined = undefined;
    expect(unknownEvent).toBeUndefined();
  });

  it("is not callable when components declare the event with different parameters", () => {
    const conflicting = createGenerativeUI({
      id: "conflict@1",
      components: {
        A: {
          component: EventsBadge,
          events: { onSubmit: { parameters: z.object({ email: z.string() }) } },
        },
        B: {
          component: EventsBadge,
          events: { onSubmit: { parameters: z.object({ code: z.number() }) } },
        },
      },
    });
    expect(conflicting.id).toBe("conflict@1");
    expectTypeOf<
      GenerativeUIEventHandler<typeof conflicting, "onSubmit">
    >().not.toBeFunction();
  });
});
