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

// The ui prop types the names.
export const typed = (
  <GenerativeUISurface
    id="products"
    ui={storeUI}
    components={["Row", "ProductCard"]}
  />
);

export const unknownName = (
  <GenerativeUISurface
    id="products"
    ui={storeUI}
    // @ts-expect-error "Banner" is not a component of storeUI.
    components={["Row", "Banner"]}
  />
);

// components needs the ui prop.
export const untyped = (
  // @ts-expect-error components without ui.
  <GenerativeUISurface id="products" components={["Row"]} />
);

// A surface without a component limit needs no ui.
export const unlimited = <GenerativeUISurface id="products" />;
