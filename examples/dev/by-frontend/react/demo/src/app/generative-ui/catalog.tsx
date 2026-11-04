"use client";
import { useState } from "react";
import { z } from "zod";
import { COUPON_CODE } from "./cart";
import { createGenerativeUI } from "@copilotkit/react-core/generative-ui";
import type { GenerativeUIComponentProps } from "@copilotkit/react-core/generative-ui";

function ProductGrid({
  title,
  children,
}: GenerativeUIComponentProps<typeof storeUI, "ProductGrid">) {
  return (
    <section className="space-y-3">
      {title && (
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function ProductCard({
  productId,
  name,
  price,
  tagline,
  inCart,
  onAddToCart,
}: GenerativeUIComponentProps<typeof storeUI, "ProductCard">) {
  const [status, setStatus] = useState<"idle" | "pending" | "added" | "error">(
    "idle",
  );
  const [error, setError] = useState<string>();
  const add = async () => {
    if (!onAddToCart) return;
    setStatus("pending");
    const result = await onAddToCart({ productId });
    if (result.ok) {
      setStatus("added");
    } else {
      setStatus("error");
      setError(result.error.message);
    }
  };
  return (
    <article className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
      <div className="font-medium">{name}</div>
      {tagline && <div className="text-xs text-gray-500">{tagline}</div>}
      <div className="mt-2 flex items-center justify-between">
        <span className="font-semibold">${price}</span>
        <button
          type="button"
          disabled={!onAddToCart || status === "pending"}
          onClick={add}
          className="rounded bg-black px-2 py-1 text-xs text-white disabled:opacity-40"
        >
          {status === "pending"
            ? "Adding…"
            : status === "added"
              ? "Added ✓"
              : "Add to cart"}
        </button>
      </div>
      {inCart > 0 && (
        <div className="mt-1 text-xs text-gray-600">In cart: {inCart}</div>
      )}
      {status === "error" && (
        <div role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </div>
      )}
    </article>
  );
}

function CartSummary({
  count,
  total,
}: GenerativeUIComponentProps<typeof storeUI, "CartSummary">) {
  return (
    <div className="rounded-lg bg-gray-50 p-3 text-sm">
      Cart: <strong>{count}</strong> item(s) · <strong>${total}</strong>
    </div>
  );
}

function CheckoutForm({
  email,
  note,
  setEmail,
  setNote,
  onApplyCoupon,
  onSubmit,
}: GenerativeUIComponentProps<typeof storeUI, "CheckoutForm">) {
  const emailValue = email ?? "";
  const noteValue = note ?? "";
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string>();
  return (
    <form
      className="space-y-2 rounded-lg border border-gray-200 bg-white p-3 text-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        const result = await onSubmit?.({ email: emailValue, note: noteValue });
        if (result && !result.ok) setMessage(result.error.message);
      }}
    >
      <label className="block">
        Email
        <input
          className="mt-1 w-full rounded border px-2 py-1"
          value={emailValue}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label className="block">
        Note
        <textarea
          className="mt-1 w-full rounded border px-2 py-1"
          value={noteValue}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <div className="flex gap-2">
        <input
          className="flex-1 rounded border px-2 py-1"
          placeholder="Coupon"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <button
          type="button"
          className="rounded border px-2"
          disabled={!onApplyCoupon}
          onClick={async () => {
            const result = await onApplyCoupon?.({ code });
            setMessage(
              result
                ? result.ok
                  ? "Coupon applied"
                  : result.error.message
                : undefined,
            );
          }}
        >
          Apply
        </button>
      </div>
      <div className="text-xs text-gray-500">
        Demo coupon: <code>{COUPON_CODE}</code> (10% off)
      </div>
      <button
        type="submit"
        disabled={!onSubmit}
        className="rounded bg-black px-3 py-1 text-white disabled:opacity-40"
      >
        Place order
      </button>
      {message && <div className="text-xs text-gray-600">{message}</div>}
    </form>
  );
}

function DiagnosticWidget({
  label,
  crash,
}: GenerativeUIComponentProps<typeof storeUI, "DiagnosticWidget">) {
  if (crash) throw new Error(`DiagnosticWidget "${label}" crashed on purpose`);
  return (
    <div className="rounded border border-dashed p-2 text-xs text-gray-500">
      Diagnostic: {label}
    </div>
  );
}

const cartSchema = z.object({
  count: z.number(),
  total: z.number(),
  coupon: z.string().nullable(),
  items: z.array(z.object({ productId: z.string(), quantity: z.number() })),
});

export const storeUI = createGenerativeUI({
  id: "acme/storefront@1",
  state: { cart: cartSchema },
  functions: {
    addToCart: {
      description: "Add a product to the cart",
      parameters: z.object({
        productId: z.string(),
        quantity: z.number().int().min(1).max(10).default(1),
      }),
    },
    applyCoupon: {
      description: "Apply a coupon code to the cart",
      parameters: z.object({ code: z.string() }),
    },
  },
  components: {
    ProductGrid: {
      component: ProductGrid,
      description:
        "Grid of product cards. Put ProductCard (or DiagnosticWidget) ids in children.",
      props: z.object({ title: z.string().optional() }),
      slots: { children: "multiple" },
    },
    ProductCard: {
      component: ProductCard,
      description:
        "A product the user can buy. Set productId to the product's id.",
      props: z.object({
        productId: z.string(),
        name: z.string(),
        price: z.number(),
        tagline: z.string().optional(),
        inCart: z.number(),
      }),
      bind: {
        inCart: (state, { productId }) =>
          state.cart.items.find((item) => item.productId === productId)
            ?.quantity ?? 0,
      },
      events: { onAddToCart: {} },
    },
    CartSummary: {
      component: CartSummary,
      description: "Live cart summary.",
      props: z.object({ count: z.number(), total: z.number() }),
      bind: {
        count: (state) => state.cart.count,
        total: (state) => state.cart.total,
      },
    },
    CheckoutForm: {
      component: CheckoutForm,
      description:
        'Checkout form. Optionally prefill email and note. Bind onSubmit to exactly {"event":{"name":"place_order","userMessage":"Place my order"}}.',
      props: z.object({
        email: z.string().optional(),
        note: z.string().optional(),
      }),
      // The user's input wins over later agent updates of these props.
      writable: ["email", "note"],
      events: {
        onApplyCoupon: {},
        onSubmit: {
          description: "User placed the order",
          parameters: z.object({ email: z.string(), note: z.string() }),
        },
      },
    },
    DiagnosticWidget: {
      component: DiagnosticWidget,
      description:
        "Debug-only. Shows a label; throws during render when crash is true (demonstrates error isolation).",
      props: z.object({ label: z.string(), crash: z.boolean().optional() }),
    },
  },
});
