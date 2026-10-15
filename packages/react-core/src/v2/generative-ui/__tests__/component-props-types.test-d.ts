// Type-only assertions, read by `tsc --noEmit` (`check-types`), never executed.
// Same mechanism as `v2/__tests__/headless-type-exports.test-d.ts`.
import { expectTypeOf } from "vitest";
import type { ReactNode } from "react";
import { z } from "zod";
import { createGenerativeUICatalog } from "../catalog";
import type { GenerativeUIComponentProps } from "../catalog";
import type { GenerativeUIInvokeResult } from "../errors";

// Destructured, and typed through the catalog that renders it.
function CheckoutForm({
  email,
  onSubmit,
}: GenerativeUIComponentProps<typeof catalog, "CheckoutForm">) {
  void email;
  void onSubmit;
  return null;
}

function Grid(props: GenerativeUIComponentProps<typeof catalog, "Grid">) {
  void props;
  return null;
}

function Badge() {
  return null;
}

const catalog = createGenerativeUICatalog({
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
  },
});

expectTypeOf<
  GenerativeUIComponentProps<typeof catalog, "CheckoutForm">
>().toEqualTypeOf<{
  email?: string | undefined;
  quantity: number;
  onSubmit?: (args: {
    email: string;
    note: string;
  }) => Promise<GenerativeUIInvokeResult>;
}>();

expectTypeOf<
  GenerativeUIComponentProps<typeof catalog, "Grid">
>().toEqualTypeOf<{
  title: string;
  children?: ReactNode;
  header?: ReactNode;
}>();

expectTypeOf<
  GenerativeUIComponentProps<typeof catalog, "Badge">
>().toEqualTypeOf<{}>();

// @ts-expect-error "Missing" is not a component of the catalog.
export type UnknownComponent = GenerativeUIComponentProps<
  typeof catalog,
  "Missing"
>;

createGenerativeUICatalog({
  id: "invalid@1",
  // @ts-expect-error a number is not a component.
  components: { Broken: { component: 42 } },
});
