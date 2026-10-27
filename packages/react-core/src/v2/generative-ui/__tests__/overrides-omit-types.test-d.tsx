// Type-only assertions, read by `tsc --noEmit` (`check-types`), never executed.
import React from "react";
import { expectTypeOf } from "vitest";
import { createGenerativeUI } from "../catalog";
import type {
  GenerativeUIComponentName,
  GenerativeUIComponentProps,
} from "../catalog";
import { standardUI } from "../standard";

type CardProps = GenerativeUIComponentProps<typeof standardUI, "Card">;

function MyCard(props: CardProps) {
  return <section>{props.children}</section>;
}

// An override takes a component with the props of the component it replaces.
export const withOverride = createGenerativeUI({
  id: "app@1",
  extends: [standardUI],
  overrides: { Card: { component: MyCard } },
  components: {},
});

export const wrongProps = createGenerativeUI({
  id: "app@1",
  extends: [standardUI],
  overrides: {
    // @ts-expect-error the component needs a prop that a Card never gets
    Card: { component: (_props: { price: number }) => null },
  },
  components: {},
});

export const unknownOverride = createGenerativeUI({
  id: "app@1",
  extends: [standardUI],
  overrides: {
    // @ts-expect-error "Crad" is not a component of the bases
    Crad: { component: MyCard },
  },
  components: {},
});

// An override does not change the component names.
expectTypeOf<GenerativeUIComponentName<typeof withOverride>>().toEqualTypeOf<
  GenerativeUIComponentName<typeof standardUI>
>();

// omit removes the names from the types.
const slim = standardUI.omit(["Map", "Chart"]);
type SlimNames = GenerativeUIComponentName<typeof slim>;
expectTypeOf<"Card">().toMatchTypeOf<SlimNames>();
expectTypeOf<"Map">().not.toMatchTypeOf<SlimNames>();
expectTypeOf<"Chart">().not.toMatchTypeOf<SlimNames>();

// @ts-expect-error "Banner" is not a component of standardUI
standardUI.omit(["Banner"]);

// An app that extends an omitted UI has its names, without the omitted ones.
const app = createGenerativeUI({
  id: "app@1",
  extends: [slim],
  overrides: { Card: { component: MyCard } },
  components: {},
});
expectTypeOf<
  GenerativeUIComponentName<typeof app>
>().toEqualTypeOf<SlimNames>();

export const cannotOverrideOmitted = createGenerativeUI({
  id: "app@1",
  extends: [slim],
  overrides: {
    // @ts-expect-error Map was omitted from the base
    Map: { component: () => null },
  },
  components: {},
});
