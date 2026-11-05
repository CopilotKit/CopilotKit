// Type-only assertions, read by `tsc --noEmit` (`check-types`), never executed.
// Same mechanism as `v2/__tests__/headless-type-exports.test-d.ts`.
//
// Components look up their event handler types in the generative UI that
// renders them, so these components reference `typeof ui` while the UI
// references the components.
import { expectTypeOf } from "vitest";
import { z } from "zod";
import { createGenerativeUI } from "../catalog";
import type {
  GenerativeUIEventHandler,
  GenerativeUIInvokeResult,
} from "@copilotkit/shared/generative-ui";

function CheckoutForm(_props: {
  onSubmit?: GenerativeUIEventHandler<typeof ui, "onSubmit">;
}) {
  return null;
}

function Card(_props: {
  onAddToCart?: GenerativeUIEventHandler<typeof ui, "onAddToCart">;
}) {
  return null;
}

function Badge() {
  return null;
}

const ui = createGenerativeUI({
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
      component: CheckoutForm,
      events: {
        onSubmit: {
          parameters: z.object({ email: z.string(), note: z.string() }),
        },
      },
    },
    // Matches `addToCart` and has no parameters of its own.
    Card: { component: Card, events: { onAddToCart: {} } },
    // The same matched event on a second component.
    MiniCard: { component: Badge, events: { onAddToCart: {} } },
  },
});

expectTypeOf<GenerativeUIEventHandler<typeof ui, "onSubmit">>().toEqualTypeOf<
  (args: { email: string; note: string }) => Promise<GenerativeUIInvokeResult>
>();

// A matched event without parameters takes the function input.
expectTypeOf<
  GenerativeUIEventHandler<typeof ui, "onAddToCart">
>().toEqualTypeOf<
  (args: {
    productId: string;
    quantity?: number | undefined;
  }) => Promise<GenerativeUIInvokeResult>
>();

// @ts-expect-error "onRemove" is not an event of any component of the UI.
export type UnknownEvent = GenerativeUIEventHandler<typeof ui, "onRemove">;

const conflicting = createGenerativeUI({
  id: "conflict@1",
  components: {
    A: {
      component: Badge,
      events: { onSubmit: { parameters: z.object({ email: z.string() }) } },
    },
    B: {
      component: Badge,
      events: { onSubmit: { parameters: z.object({ code: z.number() }) } },
    },
  },
});

// Different parameters for one event name: the handler is not callable.
expectTypeOf<
  GenerativeUIEventHandler<typeof conflicting, "onSubmit">
>().not.toBeFunction();
