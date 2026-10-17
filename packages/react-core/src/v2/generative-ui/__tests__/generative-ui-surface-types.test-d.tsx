// Type-only assertions, read by `tsc --noEmit` (`check-types`), never executed.
// Same mechanism as `create-generative-ui-types.test-d.ts`.
import React from "react";
import { expectTypeOf } from "vitest";
import { createGenerativeUI } from "../catalog";
import type { GenerativeUIComponentName } from "../catalog";
import { GenerativeUISurface } from "../GenerativeUISurface";

const Noop = () => null;
const baseUI = createGenerativeUI({
  id: "base",
  components: { Row: { component: Noop, slots: { children: "multiple" } } },
});
const storeUI = createGenerativeUI({
  id: "store",
  extends: [baseUI],
  components: { ProductCard: { component: Noop } },
});

// The component names include the components of the bases.
expectTypeOf<GenerativeUIComponentName<typeof storeUI>>().toEqualTypeOf<
  "Row" | "ProductCard"
>();

// With the type of the UI, the names are checked.
export const typed = (
  <GenerativeUISurface<typeof storeUI>
    id="products"
    components={["Row", "ProductCard"]}
  />
);

export const unknownName = (
  <GenerativeUISurface<typeof storeUI>
    id="products"
    // @ts-expect-error "Banner" is not a component of storeUI.
    components={["Row", "Banner"]}
  />
);

// Without the type of the UI, any string compiles.
export const untyped = (
  <GenerativeUISurface id="products" components={["Row", "Banner"]} />
);
