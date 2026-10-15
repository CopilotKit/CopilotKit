// Type-only assertions, read by `tsc --noEmit` (`check-types`), never executed.
// Same mechanism as `v2/__tests__/headless-type-exports.test-d.ts`.
//
// Components look up their event handler types in the catalog that renders
// them, so these components reference `typeof catalog` while the catalog
// references the components.
import { expectTypeOf } from "vitest";
import { z } from "zod";
import { createGenerativeUICatalog } from "../catalog";
import type {
  GenerativeUIEventHandler,
  GenerativeUIInvokeResult,
} from "../errors";

function CheckoutForm(_props: {
  onSubmit?: GenerativeUIEventHandler<typeof catalog, "onSubmit">;
}) {
  return null;
}

function Card(_props: {
  onAddToCart?: GenerativeUIEventHandler<typeof catalog, "onAddToCart">;
}) {
  return null;
}

function Badge() {
  return null;
}

const catalog = createGenerativeUICatalog({
  id: "types@1",
  components: {
    CheckoutForm: {
      component: CheckoutForm,
      events: {
        onSubmit: {
          parameters: z.object({ email: z.string(), note: z.string() }),
        },
      },
    },
    Card: {
      component: Card,
      events: {
        onAddToCart: { parameters: z.object({ productId: z.string() }) },
      },
    },
    // The same event with the same parameters on a second component.
    MiniCard: {
      component: Badge,
      events: {
        onAddToCart: { parameters: z.object({ productId: z.string() }) },
      },
    },
  },
});

expectTypeOf<
  GenerativeUIEventHandler<typeof catalog, "onSubmit">
>().toEqualTypeOf<
  (args: { email: string; note: string }) => Promise<GenerativeUIInvokeResult>
>();

expectTypeOf<
  GenerativeUIEventHandler<typeof catalog, "onAddToCart">
>().toEqualTypeOf<
  (args: { productId: string }) => Promise<GenerativeUIInvokeResult>
>();

// @ts-expect-error "onRemove" is not an event of any component in the catalog.
export type UnknownEvent = GenerativeUIEventHandler<typeof catalog, "onRemove">;

const conflicting = createGenerativeUICatalog({
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
