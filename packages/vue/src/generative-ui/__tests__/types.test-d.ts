// Type-only assertions, never executed. Mirrors React's
// `component-props-types.test-d.ts` and `overrides-omit-types.test-d.tsx`,
// with the Vue prop mapping: a writable prop is a `v-model` (a prop plus an
// `update:<key>` emit, no setter) and slots are Vue slots, not props.
//
// A component that types its props from the UI it is in must be a function
// declaration, as in React. A `defineComponent` or SFC export typed from that
// same UI is a circular type. It can type itself from another UI, such as the
// base UI of an override (see "overrides and omit types").
import { describe, expectTypeOf, it } from "vitest";
import { defineComponent, h } from "vue";
import type { SetupContext, SlotsType, VNode } from "vue";
import { z } from "zod";
import type { GenerativeUIInvokeResult } from "@copilotkit/shared/generative-ui";
import { createGenerativeUI } from "../catalog";
import type {
  GenerativeUIComponentEmits,
  GenerativeUIComponentName,
  GenerativeUIComponentProps,
  GenerativeUIComponentSlots,
} from "../catalog";
import { child } from "../refs";

type TextFieldProps = GenerativeUIComponentProps<typeof ui, "TextField">;
type TextFieldEmits = GenerativeUIComponentEmits<typeof ui, "TextField">;
type GridEmits = GenerativeUIComponentEmits<typeof ui, "Grid">;
type GridSlots = GenerativeUIComponentSlots<typeof ui, "Grid">;

// Function components that type their props, emits and slots from `typeof
// ui`, the UI that renders them.
function TextField(
  props: TextFieldProps,
  { emit }: SetupContext<TextFieldEmits>,
) {
  emit("update:value", "next");
  // @ts-expect-error the value is the schema input, a string.
  emit("update:value", 1);
  // @ts-expect-error `label` is not writable.
  emit("update:label", "next");
  return h("input", { value: props.value });
}
TextField.props = ["label", "value"];
TextField.emits = ["update:value"];

function Grid(
  props: GenerativeUIComponentProps<typeof ui, "Grid">,
  { slots }: SetupContext<GridEmits, SlotsType<GridSlots>>,
) {
  expectTypeOf(slots.children).toEqualTypeOf<(() => VNode[]) | undefined>();
  return h("section", [props.title, slots.header?.(), slots.children?.()]);
}
Grid.props = ["title"];

// An SFC compiles to a `defineComponent` with runtime props.
const Badge = defineComponent({
  props: { label: { type: String, required: false } },
  setup: (props) => () => h("span", props.label),
});

const ui = createGenerativeUI({
  id: "props@1",
  components: {
    CheckoutForm: {
      component: Badge,
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
    Tabs: {
      component: Badge,
      props: z.object({
        tabs: z.array(z.object({ title: z.string(), child: child() })),
      }),
    },
  },
});

describe("GenerativeUIComponentProps", () => {
  it("types the data props from the schema output and the events as optional handlers", () => {
    expectTypeOf<
      GenerativeUIComponentProps<typeof ui, "CheckoutForm">
    >().toEqualTypeOf<{
      email?: string | undefined;
      quantity: number;
      onSubmit?: (args: {
        email: string;
        note: string;
      }) => Promise<GenerativeUIInvokeResult>;
    }>();
  });

  it("leaves the slots out of the props", () => {
    expectTypeOf<
      GenerativeUIComponentProps<typeof ui, "Grid">
    >().toEqualTypeOf<{ title: string }>();
  });

  it("types a component with no props as empty", () => {
    expectTypeOf<
      GenerativeUIComponentProps<typeof ui, "Badge">
    >().toEqualTypeOf<Record<never, never>>();
    expectTypeOf<
      GenerativeUIComponentEmits<typeof ui, "Badge">
    >().toEqualTypeOf<Record<never, never>>();
    expectTypeOf<
      GenerativeUIComponentSlots<typeof ui, "Badge">
    >().toEqualTypeOf<Record<never, never>>();
  });

  it("gives a writable prop a plain prop and no setter", () => {
    expectTypeOf<TextFieldProps>().toEqualTypeOf<{
      label?: string | undefined;
      value: string;
    }>();
  });

  it("types a child() inside a data prop as a VNode", () => {
    type TabsProps = GenerativeUIComponentProps<typeof ui, "Tabs">;
    expectTypeOf<TabsProps["tabs"][number]["child"]>().toEqualTypeOf<VNode>();
  });

  it("rejects a component name that the UI does not have", () => {
    // @ts-expect-error "Missing" is not a component of the UI.
    expectTypeOf<GenerativeUIComponentProps<typeof ui, "Missing">>();
  });
});

describe("GenerativeUIComponentEmits", () => {
  it("gives a writable prop an update emit that takes the schema input", () => {
    expectTypeOf<TextFieldEmits>().toEqualTypeOf<{
      "update:value": [value: string | undefined];
    }>();
  });
});

describe("GenerativeUIComponentSlots", () => {
  it("gives each slot an optional function that returns VNodes", () => {
    expectTypeOf<GridSlots>().toEqualTypeOf<{
      children?: () => VNode[];
      header?: () => VNode[];
    }>();
  });
});

describe("createGenerativeUI types", () => {
  it("takes function and defineComponent components", () => {
    expectTypeOf<GenerativeUIComponentName<typeof ui>>().toEqualTypeOf<
      "CheckoutForm" | "Grid" | "Badge" | "TextField" | "Tabs"
    >();
  });

  it("rejects a writable key that is not a prop, or that is bound", () => {
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

describe("overrides and omit types", () => {
  type BaseGridProps = GenerativeUIComponentProps<typeof ui, "Grid">;

  // A defineComponent override types itself from the base UI.
  const MyGrid = defineComponent(
    (
      props: BaseGridProps,
      { slots }: SetupContext<GridEmits, SlotsType<GridSlots>>,
    ) =>
      () =>
        h("div", [props.title, slots.children?.()]),
    { props: ["title"] },
  );

  it("takes a Vue component for a component of the bases", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- read only through `typeof app`.
    const app = createGenerativeUI({
      id: "app@1",
      extends: [ui],
      overrides: { Grid: { component: MyGrid } },
      components: {},
    });
    // An override does not change the component names.
    expectTypeOf<GenerativeUIComponentName<typeof app>>().toEqualTypeOf<
      GenerativeUIComponentName<typeof ui>
    >();
  });

  it("rejects an override that names no component of the bases", () => {
    createGenerativeUI({
      id: "app@1",
      extends: [ui],
      overrides: {
        // @ts-expect-error "Gird" is not a component of the bases.
        Gird: { component: MyGrid },
      },
      components: {},
    });
  });

  it("removes omitted names from the types", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- read only through `typeof slim`.
    const slim = ui.omit(["Tabs"]);
    type SlimNames = GenerativeUIComponentName<typeof slim>;
    expectTypeOf<SlimNames>().toEqualTypeOf<
      "CheckoutForm" | "Grid" | "Badge" | "TextField"
    >();
    // @ts-expect-error "Banner" is not a component of the UI.
    ui.omit(["Banner"]);
  });
});
