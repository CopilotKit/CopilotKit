import { Component, computed, input, model } from "@angular/core";
import { z } from "zod";
import {
  createGenerativeUI,
  injectGenerativeUIAccessibility,
  standardUI,
} from "@copilotkit/angular/generative-ui";
import type { GenerativeUIEventHandler } from "@copilotkit/angular/generative-ui";

/** A line of the cart. The cart lives in the app, not in the agent. */
export const cartItemSchema = z.object({
  productId: z.string(),
  name: z.string(),
  price: z.number(),
  quantity: z.number(),
  size: z.string().optional(),
  gift: z.boolean().optional(),
});
export type CartItem = z.output<typeof cartItemSchema>;

const cartSchema = z.object({ items: z.array(cartItemSchema) });

/**
 * One product with a quantity and an add-to-cart button. `size` and
 * `gift` come from the form of the surface, bound by the agent with
 * `{ "@path" }`. The button calls the `addToCart` function of the app.
 */
@Component({
  selector: "app-product-card",
  host: {
    "[attr.aria-label]": "aria()['aria-label']",
    style:
      "display:flex;flex-direction:column;gap:8px;flex:1 1 180px;min-width:0;padding:12px;border:1px solid rgba(0,0,0,.1);border-radius:12px;background:#fff",
  },
  template: `
    <img
      [src]="image()"
      alt=""
      style="width: 100%; aspect-ratio: 4/3; object-fit: cover; border-radius: 8px"
    />
    <strong>{{ name() }}</strong>
    <span style="color: #5d5d5d"
      >{{ "$" + price() }} · size {{ size() ?? "-" }}</span
    >
    <label style="display: flex; align-items: center; gap: 8px; font-size: 13px">
      Qty
      <input
        type="number"
        min="1"
        [value]="count()"
        (change)="setQuantity($any($event.target))"
        style="
          width: 56px;
          padding: 4px 6px;
          border: 1px solid rgba(0, 0, 0, 0.2);
          border-radius: 6px;
        "
      />
    </label>
    @if (onAddToCart(); as addToCart) {
      <button
        type="button"
        (click)="
          addToCart({
            productId: productId(),
            name: name(),
            price: price(),
            quantity: count(),
            size: size(),
            gift: gift() ?? false,
          })
        "
        style="
          padding: 8px 12px;
          border: 0;
          border-radius: 8px;
          background: #0d0d0d;
          color: #fff;
          cursor: pointer;
        "
      >
        Add to cart
      </button>
    }
  `,
})
export class ProductCard {
  readonly productId = input.required<string>();
  readonly name = input.required<string>();
  readonly price = input.required<number>();
  readonly image = input<string>();
  readonly size = input<string>();
  readonly gift = input<boolean>();
  /** A writable prop: local to the card unless the agent binds it. */
  readonly quantity = model<number>();
  readonly onAddToCart =
    input<GenerativeUIEventHandler<typeof shopUI, "onAddToCart">>();
  protected readonly aria = injectGenerativeUIAccessibility();
  /** The agent can set `quantity` too, so the button never sends less than 1. */
  protected readonly count = computed(() => toCount(this.quantity()));

  /** On commit, so typing is not interrupted. Shows the clamped value. */
  protected setQuantity(field: HTMLInputElement) {
    const count = toCount(field.valueAsNumber);
    field.value = String(count);
    this.quantity.set(count);
  }
}

/** A whole number of at least 1. An empty field is NaN and becomes 1. */
function toCount(value: number | undefined): number {
  return Math.max(1, Math.trunc(value ?? 1) || 1);
}

/**
 * The cart of the app, bound to the `cart` state: it changes as soon as
 * the app does, with no agent round trip. Checkout sends the lines to the
 * agent as an event.
 */
@Component({
  selector: "app-cart-summary",
  host: {
    style:
      "display:flex;flex-direction:column;gap:8px;padding:12px;border:1px solid rgba(0,0,0,.1);border-radius:12px;background:#f7f7f8",
  },
  template: `
    <strong>Cart</strong>
    @if (items().length === 0) {
      <span style="color: #5d5d5d">Nothing yet. Add a pair above.</span>
    } @else {
      <ul
        style="
          margin: 0;
          padding: 0;
          list-style: none;
          display: flex;
          flex-direction: column;
          gap: 4px;
        "
      >
        @for (item of items(); track $index) {
          <li style="display: flex; justify-content: space-between; gap: 8px">
            <span>
              {{ item.quantity }} × {{ item.name }}
              @if (item.size) {
                <span style="color: #5d5d5d"
                  >({{ item.size }}{{ item.gift ? ", gift wrap" : "" }})</span
                >
              }
            </span>
            <span>{{ "$" + item.quantity * item.price }}</span>
          </li>
        }
      </ul>
      <div
        style="
          display: flex;
          justify-content: space-between;
          border-top: 1px solid rgba(0, 0, 0, 0.1);
          padding-top: 8px;
        "
      >
        <strong>Total</strong>
        <strong>{{ "$" + total() }}</strong>
      </div>
      @if (onCheckout(); as checkout) {
        <button
          type="button"
          (click)="checkout({ order: order(), total: total() })"
          style="
            align-self: flex-end;
            padding: 8px 12px;
            border: 0;
            border-radius: 8px;
            background: #0d0d0d;
            color: #fff;
            cursor: pointer;
          "
        >
          Checkout
        </button>
      }
    }
  `,
})
export class CartSummary {
  readonly items = input.required<CartItem[]>();
  readonly onCheckout =
    input<GenerativeUIEventHandler<typeof shopUI, "onCheckout">>();
  protected readonly total = computed(() =>
    this.items().reduce((sum, item) => sum + item.quantity * item.price, 0),
  );
  /** The lines as one readable string: it becomes the context of the event. */
  protected readonly order = computed(() =>
    this.items()
      .map(
        (item) =>
          `${item.quantity} × ${item.name}` +
          (item.size ? ` (${item.size}${item.gift ? ", gift wrap" : ""})` : ""),
      )
      .join(", "),
  );
}

/**
 * The standard catalog plus the two shop components. `addToCart` is a
 * function of the app: the page registers its handler, so the cart
 * changes without the agent. `onCheckout` has no function and goes to the
 * agent as an event.
 */
export const shopUI = createGenerativeUI({
  id: "copilotkit/demo-shop@1",
  extends: [standardUI],
  state: { cart: cartSchema },
  functions: {
    addToCart: { parameters: cartItemSchema },
  },
  components: {
    ProductCard: {
      component: ProductCard,
      description:
        "One product with its price, a quantity and an add-to-cart button.",
      props: z.object({
        productId: z.string(),
        name: z.string(),
        price: z.number(),
        image: z.string().optional(),
        size: z.string().optional().describe("Bind it to the size field"),
        gift: z.boolean().optional().describe("Bind it to the gift checkbox"),
        quantity: z.number().optional(),
      }),
      writable: ["quantity"],
      events: { onAddToCart: { parameters: cartItemSchema } },
    },
    CartSummary: {
      component: CartSummary,
      description: "The cart of the user with a checkout button.",
      props: z.object({ items: z.array(cartItemSchema) }),
      bind: { items: (state) => state.cart.items },
      events: {
        onCheckout: {
          parameters: z.object({ order: z.string(), total: z.number() }),
        },
      },
    },
  },
});
