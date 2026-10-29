import { Component, effect, input, model, signal } from "@angular/core";
import { z } from "zod";
import type { GenerativeUIInvokeResult } from "@copilotkit/shared/generative-ui";
import { createGenerativeUI } from "../catalog";
import type { GenerativeUIStateOf } from "../catalog";
import type { GenerativeUIChildren } from "../children";
import { CopilotGenerativeUIChildren } from "../children.directive";

// The shared setup of surface-view.spec.ts and surface-view-bindings.spec.ts:
// test components, the shop UI that names them, and DOM queries.

type Handler = (args?: unknown) => Promise<GenerativeUIInvokeResult>;

/** What the test components report, and what a test sets for them. */
export const probes = {
  bombArmed: false,
  /** Set by a test to run a write from inside `Racer`'s constructor. */
  race: undefined as (() => void) | undefined,
  /** The `addToCart` event input that `QuickAdd` got last. */
  quickAdd: undefined as Handler | undefined,
  // A signal component updates its view when an input changes, so the number
  // of input changes is the number of renders.
  cartIdsRenders: 0,
  badgeRenders: 0,
};

@Component({
  selector: "test-grid",
  imports: [CopilotGenerativeUIChildren],
  template: `
    <div data-grid><ng-container *copilotGenerativeUIChildren="children()" /></div>
  `,
})
class Grid {
  readonly children = input<GenerativeUIChildren>();
}

@Component({
  selector: "test-card",
  template: `
    <div [attr.data-card]="productId()">
      <span>{{ name() }}</span>
      <span [attr.data-clicks]="productId()">{{ clicks() }}</span>
      <button (click)="pick()">pick {{ productId() }}</button>
    </div>
  `,
})
class Card {
  readonly productId = input<string>();
  readonly name = input<string>();
  readonly onPick = input<Handler>();
  readonly clicks = signal(0);
  async pick() {
    this.clicks.update((c) => c + 1);
    await this.onPick()?.({ productId: this.productId() });
  }
}

@Component({
  selector: "test-product-card",
  template: `
    <div>
      <span>{{ name() }}</span>
      <span [attr.data-in-cart]="productId()">{{ inCart() }}</span>
      <button (click)="onAddToCart()?.({ productId: productId() })">
        buy {{ productId() }}
      </button>
    </div>
  `,
})
class ProductCard {
  readonly productId = input<string>();
  readonly name = input<string>();
  readonly inCart = input<number>();
  readonly onAddToCart = input<Handler>();
}

@Component({ selector: "test-quick-add", template: "" })
class QuickAdd {
  readonly addToCart = input<Handler>();
  constructor() {
    effect(() => {
      probes.quickAdd = this.addToCart();
    });
  }
}

@Component({
  selector: "test-badge",
  template: `
    <span data-badge>{{ count() }}</span>
  `,
})
class Badge {
  readonly count = input<number>();
  constructor() {
    effect(() => {
      this.count();
      probes.badgeRenders++;
    });
  }
}

@Component({
  selector: "test-counter",
  template: `
    <span data-counter>{{ value() }}</span>
  `,
})
class Counter {
  readonly value = input<number>();
}

@Component({
  selector: "test-position",
  template: `
    <span data-position>{{ index() ?? "none" }}</span>
  `,
})
class Position {
  readonly index = input<number>();
}

@Component({
  selector: "test-cart-ids",
  template: `
    <span data-cart-ids>{{ ids()?.join(",") }}</span>
  `,
})
class CartIds {
  readonly ids = input<string[]>();
  constructor() {
    effect(() => {
      this.ids();
      probes.cartIdsRenders++;
    });
  }
}

@Component({
  selector: "test-label",
  template: `
    <span>{{ label() }}</span>
  `,
})
class Label {
  readonly label = input<string>();
}

@Component({
  selector: "test-text-field",
  template: `
    <input
      [attr.aria-label]="label() ?? 'field'"
      [value]="value() ?? ''"
      (input)="value.set($any($event.target).value)"
    />
  `,
})
class TextField {
  readonly label = input<string>();
  readonly value = model<string>();
}

@Component({
  selector: "test-section",
  imports: [CopilotGenerativeUIChildren],
  template: `
    <section [attr.data-section]="title()">
      <ng-container *copilotGenerativeUIChildren="children()" />
    </section>
  `,
})
class Section {
  readonly title = input<string>();
  readonly children = input<GenerativeUIChildren>();
}

@Component({ selector: "test-racer", template: "" })
class Racer {
  constructor() {
    // The constructor runs while the renderer creates the node: a data write
    // here lands before the node subscribes to the paths it read.
    const fire = probes.race;
    probes.race = undefined;
    fire?.();
  }
}

@Component({
  selector: "test-bomb",
  template: `
    <span>survived {{ label() }}</span>
  `,
})
class Bomb {
  readonly label = input<string>();
  constructor() {
    // The inputs are not set yet in the constructor, so no label here.
    if (probes.bombArmed) throw new Error("exploded");
  }
}

@Component({
  selector: "test-retry-fallback",
  template: `
    <button data-retry (click)="retry()?.()">retry: {{ message() }}</button>
  `,
})
export class RetryFallback {
  readonly message = input<string>();
  readonly componentId = input<string>();
  readonly retry = input<() => void>();
}

const cartSchema = z.object({
  items: z.array(z.object({ productId: z.string(), quantity: z.number() })),
});

export const ui = createGenerativeUI({
  id: "shop",
  state: { count: z.number(), cart: cartSchema },
  functions: {
    addToCart: {
      parameters: z.object({
        productId: z.string(),
        quantity: z.number().int().min(1).max(10).default(1),
      }),
    },
  },
  components: {
    Grid: { component: Grid, slots: { children: "multiple" } },
    // `onPick` matches no function, so the model binds it.
    Card: {
      component: Card,
      props: z.object({ productId: z.string(), name: z.string() }),
      events: {
        onPick: { parameters: z.object({ productId: z.string() }) },
      },
    },
    // `inCart` reads the state with the model's `productId`. `onAddToCart`
    // calls `addToCart`.
    ProductCard: {
      component: ProductCard,
      props: z.object({
        productId: z.string(),
        name: z.string(),
        inCart: z.number(),
      }),
      bind: {
        inCart: (state, { productId }) =>
          state.cart.items.find((item) => item.productId === productId)
            ?.quantity ?? 0,
      },
      events: { onAddToCart: {} },
    },
    // The event has the function's name and its own, stricter `parameters`.
    QuickAdd: {
      component: QuickAdd,
      events: {
        addToCart: {
          parameters: z.object({
            productId: z.string().min(3),
            quantity: z.number(),
          }),
        },
      },
    },
    // `count` is bound by name to the `count` state key.
    Badge: { component: Badge, props: z.object({ count: z.number() }) },
    Counter: { component: Counter, props: z.object({ value: z.number() }) },
    Position: {
      component: Position,
      props: z.object({ index: z.number().optional() }),
    },
    // The selector returns a new array on each call.
    CartIds: {
      component: CartIds,
      props: z.object({ ids: z.array(z.string()) }),
      bind: {
        ids: (state) => state.cart.items.map((item) => item.productId),
      },
    },
    Broken: {
      component: Label,
      props: z.object({ label: z.string() }),
      bind: {
        label: () => {
          throw new Error("selector exploded");
        },
      },
    },
    // `value` is writable, so the component's `value` model is bound two-way.
    TextField: {
      component: TextField,
      props: z.object({
        label: z.string().optional(),
        value: z.string().default(""),
      }),
      writable: ["value"],
    },
    Text: { component: Label, props: z.object({ label: z.string() }) },
    Section: {
      component: Section,
      props: z.object({ title: z.string() }),
      slots: { children: "multiple" },
    },
    Racer: { component: Racer },
    Bomb: { component: Bomb, props: z.object({ label: z.string() }) },
  },
});

export type Cart = GenerativeUIStateOf<typeof ui>["cart"];
export const cartWith = (...items: Cart["items"]): Cart => ({ items });

export const alertText = (container: HTMLElement) =>
  container.querySelector('[role="alert"]')?.textContent;
export const alerts = (container: HTMLElement) =>
  container.querySelectorAll('[role="alert"]');
export const grid = (container: HTMLElement) =>
  container.querySelector<HTMLElement>("[data-grid]")!;
export const inputs = (container: HTMLElement) => [
  ...container.querySelectorAll<HTMLInputElement>('input[aria-label="field"]'),
];
/** The text of every `span` inside `element`, in order. */
export const texts = (element: HTMLElement) =>
  [...element.querySelectorAll("span")].map((span) => span.textContent?.trim());
export const text = (container: HTMLElement, selector: string) =>
  container.querySelector(selector)?.textContent?.trim();
/** The `span`s and `button`s whose text is `value`. */
export const byText = (container: HTMLElement, value: string) =>
  [...container.querySelectorAll<HTMLElement>("span, button")].filter(
    (el) => el.textContent?.trim() === value,
  );
export const type = (input: HTMLInputElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event("input"));
};
