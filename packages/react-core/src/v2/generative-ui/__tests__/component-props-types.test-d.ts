// Type-only assertions, read by `tsc --noEmit` (`check-types`), never executed.
// Same mechanism as `v2/__tests__/headless-type-exports.test-d.ts`.
import { expectTypeOf } from "vitest";
import type { ReactNode } from "react";
import { z } from "zod";
import { createGenerativeUI } from "../catalog";
import type { GenerativeUIComponentProps } from "../catalog";
import type { GenerativeUIInvokeResult } from "../errors";

// Destructured, and typed through the generative UI that renders it.
function CheckoutForm({
  email,
  onSubmit,
}: GenerativeUIComponentProps<typeof ui, "CheckoutForm">) {
  void email;
  void onSubmit;
  return null;
}

function Grid(props: GenerativeUIComponentProps<typeof ui, "Grid">) {
  void props;
  return null;
}

function Badge() {
  return null;
}

// A component with a writable prop types its own setter from `typeof ui`.
function TextField({
  value,
  setValue,
}: GenerativeUIComponentProps<typeof ui, "TextField">) {
  void value;
  void setValue;
  return null;
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

expectTypeOf<GenerativeUIComponentProps<typeof ui, "Grid">>().toEqualTypeOf<{
  title: string;
  children?: ReactNode;
  header?: ReactNode;
}>();

expectTypeOf<
  GenerativeUIComponentProps<typeof ui, "Badge">
>().toEqualTypeOf<{}>();

// `value` is writable, so it gets `setValue`. `label` is not, so it gets no
// setter. The setter takes the schema input.
expectTypeOf<
  GenerativeUIComponentProps<typeof ui, "TextField">
>().toEqualTypeOf<{
  label?: string | undefined;
  value: string;
  setValue: (value: string | undefined) => void;
}>();

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

// @ts-expect-error "Missing" is not a component of the UI.
export type Missing = GenerativeUIComponentProps<typeof ui, "Missing">;
