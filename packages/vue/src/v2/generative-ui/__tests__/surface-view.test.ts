import { fireEvent, render, screen, within } from "@testing-library/vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, onMounted, ref } from "vue";
import type { Component, PropType } from "vue";
import { ComponentModel } from "@a2ui/web_core/v0_9";
import { z } from "zod";
import type {
  A2UIComponentNode,
  A2UIOperation,
  GenerativeUISurfaceContent,
} from "@copilotkit/shared";
import { invokeBoundEvent } from "@copilotkit/core/generative-ui";
import type { GenerativeUISurfaceManager } from "@copilotkit/core/generative-ui";
import type {
  AnyGenerativeUI,
  GenerativeUIEventHandler,
} from "@copilotkit/shared/generative-ui";
import { createGenerativeUI } from "../catalog";
import type { GenerativeUIFunctionArgs, GenerativeUIStateOf } from "../catalog";
import { useGenerativeUIFunction, useGenerativeUIState } from "../hooks";
import { SurfaceView } from "../SurfaceView";
import ModelField from "./fixtures/ModelField.vue";
import {
  createRuntimeProvider,
  createTestRuntime,
  renderSurface,
  SURFACE_ID,
} from "./helpers/render-surface";

const mounts = new Map<string, number>();
let bombArmed = false;
/** Set by a test to run a write from inside `Racer`'s mounted hook. */
let race: (() => void) | undefined;
/** The `addToCart` event prop that `QuickAdd` got on its last render. */
let quickAdd: GenerativeUIEventHandler<typeof ui, "addToCart"> | undefined;
let cartIdsRenders = 0;
let badgeRenders = 0;

const Grid = defineComponent({
  template: `<div data-testid="grid"><slot name="children" /></div>`,
});
const Card = defineComponent({
  props: {
    productId: { type: String, required: true },
    name: { type: String, required: true },
    onPick: Function as PropType<GenerativeUIEventHandler<typeof ui, "onPick">>,
  },
  setup(props) {
    const clicks = ref(0);
    onMounted(() => {
      mounts.set(props.productId, (mounts.get(props.productId) ?? 0) + 1);
    });
    const pick = async () => {
      clicks.value++;
      await props.onPick?.({ productId: props.productId });
    };
    return { clicks, pick };
  },
  template: `
    <div :data-testid="'card-' + productId">
      <span>{{ name }}</span>
      <span :data-testid="'clicks-' + productId">{{ clicks }}</span>
      <button @click="pick">pick {{ productId }}</button>
    </div>
  `,
});
const ProductCard = defineComponent({
  props: {
    productId: { type: String, required: true },
    name: { type: String, required: true },
    inCart: { type: Number, required: true },
    onAddToCart: Function as PropType<
      GenerativeUIEventHandler<typeof ui, "onAddToCart">
    >,
  },
  template: `
    <div>
      <span>{{ name }}</span>
      <span :data-testid="'in-cart-' + productId">{{ inCart }}</span>
      <button @click="onAddToCart?.({ productId })">buy {{ productId }}</button>
    </div>
  `,
});
const QuickAdd = defineComponent({
  props: {
    addToCart: Function as PropType<
      GenerativeUIEventHandler<typeof ui, "addToCart">
    >,
  },
  setup(props) {
    return () => {
      quickAdd = props.addToCart;
      return null;
    };
  },
});
const Badge = defineComponent({
  props: { count: { type: Number, required: true } },
  setup(props) {
    return () => {
      badgeRenders++;
      return h("span", { "data-testid": "badge" }, String(props.count));
    };
  },
});
const Counter = defineComponent({
  props: { value: { type: Number, required: true } },
  template: `<span data-testid="counter">{{ value }}</span>`,
});
const Position = defineComponent({
  props: { index: { type: Number, default: undefined } },
  template: `<span data-testid="position">{{ index ?? "none" }}</span>`,
});
const CartIds = defineComponent({
  props: { ids: { type: Array as PropType<string[]>, required: true } },
  setup(props) {
    return () => {
      cartIdsRenders++;
      return h("span", { "data-testid": "cart-ids" }, props.ids.join(","));
    };
  },
});
const Label = defineComponent({
  props: { label: { type: String, required: true } },
  template: `<span>{{ label }}</span>`,
});
// `value` is writable: a `v-model:value` that the renderer binds.
const TextField = defineComponent({
  props: {
    label: { type: String, default: undefined },
    value: { type: String, required: true },
  },
  emits: ["update:value"],
  template: `
    <input
      :aria-label="label ?? 'field'"
      :value="value"
      @input="$emit('update:value', $event.target.value)"
    />
  `,
});
const Section = defineComponent({
  props: { title: { type: String, required: true } },
  template: `<section :data-testid="'section-' + title"><slot name="children" /></section>`,
});
const Racer = defineComponent({
  setup() {
    // A mounted hook runs after the nodes before it subscribed, which is
    // the window in which a data write used to be lost.
    onMounted(() => {
      const fire = race;
      race = undefined;
      fire?.();
    });
    return () => null;
  },
});
const Bomb = defineComponent({
  props: { label: { type: String, required: true } },
  setup(props) {
    return () => {
      if (bombArmed) throw new Error(`exploded ${props.label}`);
      return h("span", `survived ${props.label}`);
    };
  },
});

const cartSchema = z.object({
  items: z.array(z.object({ productId: z.string(), quantity: z.number() })),
});

const ui = createGenerativeUI({
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
    // `value` is writable, so the component gets `update:value`.
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

type AddToCartArgs = GenerativeUIFunctionArgs<typeof ui, "addToCart">;
type Cart = GenerativeUIStateOf<typeof ui>["cart"];

const AddToCartHandler = defineComponent({
  props: {
    handler: {
      type: Function as PropType<(args: AddToCartArgs) => unknown>,
      required: true,
    },
  },
  setup(props) {
    useGenerativeUIFunction(ui, "addToCart", (args) => props.handler(args));
    return () => null;
  },
});
const CountState = defineComponent({
  props: { count: { type: Number, required: true } },
  setup(props) {
    useGenerativeUIState(ui, "count", () => props.count);
    return () => null;
  },
});
const CartState = defineComponent({
  props: { cart: { type: Object as PropType<Cart>, required: true } },
  setup(props) {
    useGenerativeUIState(ui, "cart", () => props.cart);
    return () => null;
  },
});

const S = "s1";
const create: A2UIOperation = {
  version: "1.0",
  createSurface: { surfaceId: S, catalogId: "shop" },
};
const nodes = (...components: A2UIComponentNode[]): A2UIOperation => ({
  version: "1.0",
  updateComponents: { surfaceId: S, components },
});
const data = (path: string, value: unknown): A2UIOperation => ({
  version: "1.0",
  updateDataModel: { surfaceId: S, path, value },
});
const content = (operations: A2UIOperation[]): GenerativeUISurfaceContent => ({
  surfaceId: S,
  target: "inline",
  catalogId: "shop",
  operations,
  status: "streaming",
  rejected: [],
});

/** The state components that mount next to the surface. */
interface Extra {
  count?: number;
  cart?: Cart;
}

function setup(
  options: {
    addToCart?: (args: AddToCartArgs) => unknown;
    fallback?: Component;
  } = {},
) {
  const { runtime, reportError, forwardEvent } = createTestRuntime(
    ui,
    options.fallback,
  );
  const { manager } = runtime;
  let ops: A2UIOperation[] = [create];
  const push = (...more: A2UIOperation[]) => {
    ops = [...ops, ...more];
    manager.ingest("t1", "default", content(ops));
    return nextTick();
  };
  manager.ingest("t1", "default", content(ops));
  const Provider = createRuntimeProvider(runtime);
  const surface = manager.getSurface("t1", S);
  /** Renders the surface, with the state components of `count` and `cart`. */
  const View = defineComponent({
    components: {
      Provider,
      AddToCartHandler,
      CountState,
      CartState,
      SurfaceView,
    },
    props: {
      count: { type: Number, default: undefined },
      cart: { type: Object as PropType<Cart>, default: undefined },
    },
    setup: () => ({ surface, addToCart: options.addToCart }),
    template: `
      <Provider>
        <AddToCartHandler v-if="addToCart" :handler="addToCart" />
        <CountState v-if="count !== undefined" :count="count" />
        <CartState v-if="cart" :cart="cart" />
        <SurfaceView :surface="surface" />
      </Provider>
    `,
  });
  const utils = render(View);
  return {
    manager,
    runtime,
    push,
    reportError,
    forwardEvent,
    view: () => render(View),
    /** `extra` mounts next to the surface; leaving a key out unmounts it. */
    rerender: (extra: Extra = {}) =>
      utils.rerender({ count: undefined, cart: undefined, ...extra }),
  };
}

const cartWith = (...items: Cart["items"]): Cart => ({ items });
const alertText = () => screen.getByRole("alert").textContent;
const inputs = () => screen.getAllByLabelText<HTMLInputElement>("field");
/** The text of every `span` inside `element`, in order. */
const texts = (element: HTMLElement) =>
  [...element.querySelectorAll("span")].map((span) => span.textContent);
const type = (input: HTMLInputElement, value: string) =>
  fireEvent.update(input, value);

describe("SurfaceView", () => {
  afterEach(() => {
    bombArmed = false;
    race = undefined;
    quickAdd = undefined;
  });

  it("streams cards into a grid without remounting earlier cards", async () => {
    mounts.clear();
    const { push } = setup();
    await push(
      nodes({ id: "root", component: "Grid", children: ["a", "b", "c"] }),
    );
    // A child that has not streamed yet renders nothing, not a placeholder.
    expect(
      document.querySelectorAll("[data-generative-ui-placeholder]"),
    ).toHaveLength(0);
    expect(screen.queryByText("Alpha")).toBeNull();
    await push(
      nodes({ id: "a", component: "Card", productId: "a", name: "Alpha" }),
    );
    await fireEvent.click(screen.getByText("pick a"));
    await push(
      nodes({ id: "b", component: "Card", productId: "b", name: "Beta" }),
    );
    await push(
      nodes({ id: "c", component: "Card", productId: "c", name: "Gamma" }),
      nodes({ id: "a", component: "Card", productId: "a", name: "Alpha 2" }),
    );
    expect(screen.getByText("Alpha 2")).toBeTruthy();
    expect(screen.getByTestId("clicks-a").textContent).toBe("1");
    expect(mounts.get("a")).toBe(1);
    expect(
      document.querySelectorAll("[data-generative-ui-placeholder]"),
    ).toHaveLength(0);
  });

  it("calls a declared function from an unmatched event bound with functionCall, binding args winning", async () => {
    const handler = vi.fn();
    const { push } = setup({ addToCart: handler });
    await push(
      nodes({
        id: "root",
        component: "Card",
        productId: "root",
        name: "A",
        onPick: {
          functionCall: { "@call": "addToCart", args: { quantity: 2 } },
        },
      }),
    );
    await fireEvent.click(screen.getByText("pick root"));
    await vi.waitFor(() =>
      expect(handler).toHaveBeenCalledExactlyOnceWith({
        productId: "root",
        quantity: 2,
      }),
    );
  });

  it("forwards event bindings to the agent with resolved context", async () => {
    const { push, forwardEvent } = setup();
    await push(
      data("/sel", "x"),
      nodes({
        id: "root",
        component: "Card",
        productId: "root",
        name: "A",
        onPick: {
          event: { name: "more", context: { selected: { "@path": "/sel" } } },
        },
      }),
    );
    await fireEvent.click(screen.getByText("pick root"));
    await vi.waitFor(() =>
      expect(forwardEvent).toHaveBeenCalledExactlyOnceWith(
        {
          name: "more",
          surfaceId: S,
          componentId: "root",
          timestamp: expect.any(String),
          context: { productId: "root", selected: "x" },
        },
        "default",
      ),
    );
  });

  it("isolates a throwing component, keeps siblings usable, and retries", async () => {
    const handler = vi.fn();
    const fallback = defineComponent({
      props: {
        error: { type: Error, required: true },
        retry: { type: Function as PropType<() => void>, required: true },
      },
      template: `<button @click="retry()">retry: {{ error.message }}</button>`,
    });
    bombArmed = true;
    const { push, reportError } = setup({ addToCart: handler, fallback });
    await push(
      nodes(
        { id: "root", component: "Grid", children: ["bomb", "ok"] },
        { id: "bomb", component: "Bomb", label: "b1" },
        {
          id: "ok",
          component: "Card",
          productId: "ok",
          name: "Fine",
          onPick: { functionCall: { "@call": "addToCart" } },
        },
      ),
    );
    expect(screen.getByText("retry: exploded b1")).toBeTruthy();
    await fireEvent.click(screen.getByText("pick ok"));
    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "render", componentId: "bomb" }),
    );
    bombArmed = false;
    await fireEvent.click(screen.getByText("retry: exploded b1"));
    expect(screen.getByText("survived b1")).toBeTruthy();
  });

  it("resets a failed component when the agent sends a new revision of it", async () => {
    bombArmed = true;
    const { push } = setup();
    await push(nodes({ id: "root", component: "Bomb", label: "v1" }));
    expect(alertText()).toContain("exploded v1");
    bombArmed = false;
    await push(nodes({ id: "root", component: "Bomb", label: "v2" }));
    expect(screen.getByText("survived v2")).toBeTruthy();
  });

  it("gives an @index prop outside of a template no value, without an error", async () => {
    const { push, reportError } = setup();
    await push(
      nodes({
        id: "root",
        component: "Position",
        index: { "@call": "@index" },
      }),
    );
    expect(screen.getByTestId("position").textContent).toBe("none");
    expect(reportError).not.toHaveBeenCalled();
  });

  it("shows a local fallback when bound data has the wrong type", async () => {
    const { push, reportError } = setup();
    await push(
      data("/n", "many"),
      nodes({ id: "root", component: "Counter", value: { "@path": "/n" } }),
    );
    expect(alertText()).toMatch(/value/);
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "props", componentId: "root" }),
    );
  });

  it("shows a local fallback instead of recursing on a self-referencing slot", async () => {
    // The manager rejects self-references at ingest, so inject the node directly
    // to exercise the renderer's own defence.
    const { push, manager } = setup();
    manager
      .getSurface("t1", S)!
      .model.componentsModel.addComponent(
        new ComponentModel("root", "Grid", { children: ["root"] }),
      );
    await push(data("/tick", 1));
    expect(alertText()).toContain("cyclic reference to root");
  });

  it("cuts an A -> B -> A cycle without freezing and keeps the rest of the tree", async () => {
    const { push } = setup();
    await push(
      nodes(
        { id: "root", component: "Grid", children: ["a", "ok"] },
        { id: "a", component: "Grid", children: ["b"] },
        { id: "b", component: "Grid", children: ["a"] },
        { id: "ok", component: "Card", productId: "ok", name: "Fine" },
      ),
    );
    expect(alertText()).toContain("cyclic reference to a");
    expect(screen.getByText("Fine")).toBeTruthy();
  });

  it("renders a repeated child id once without duplicate-key warnings", async () => {
    // Vue reports a duplicate key with console.warn, React with console.error.
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { push } = setup();
      await push(
        nodes(
          { id: "root", component: "Grid", children: ["x", "x"] },
          { id: "x", component: "Card", productId: "x", name: "Once" },
        ),
      );
      expect(screen.getAllByText("Once")).toHaveLength(1);
      expect(errors).not.toHaveBeenCalled();
      expect(warnings).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
      warnings.mockRestore();
    }
  });

  it("updates every mount of the same surface synchronously", async () => {
    const { push, view } = setup();
    const card = (name: string) =>
      nodes({ id: "root", component: "Card", productId: "root", name });
    await push(card("Before"));
    view();
    expect(screen.getAllByText("Before")).toHaveLength(2);
    await push(card("After"));
    expect(screen.getAllByText("After")).toHaveLength(2);
    expect(screen.queryByText("Before")).toBeNull();
  });

  it("does not lose a data write that lands between commit and effect flush", async () => {
    const { push, manager } = setup();
    race = () => manager.getSurface("t1", S)!.model.dataModel.set("/n", 9);
    await push(
      data("/n", 1),
      nodes(
        { id: "root", component: "Grid", children: ["counter", "racer"] },
        { id: "counter", component: "Counter", value: { "@path": "/n" } },
        { id: "racer", component: "Racer" },
      ),
    );
    await nextTick();
    expect(race).toBeUndefined();
    expect(screen.getByTestId("counter").textContent).toBe("9");
  });

  it("keeps rendering when the host error reporter throws", async () => {
    const { push, reportError } = setup();
    reportError.mockImplementation(() => {
      throw new Error("host onError exploded");
    });
    bombArmed = true;
    await push(
      nodes(
        { id: "root", component: "Grid", children: ["bomb", "bad"] },
        { id: "bomb", component: "Bomb", label: "b1" },
        { id: "bad", component: "Counter", value: { "@path": "/missing" } },
      ),
    );
    expect(reportError).toHaveBeenCalled();
    expect(screen.getAllByRole("alert")).toHaveLength(2);
  });

  describe("bound props", () => {
    it("updates a name-bound prop when the state changes, and drops it on unmount", async () => {
      const { push, rerender } = setup();
      await rerender({ count: 1 });
      await push(nodes({ id: "root", component: "Badge" }));
      expect(screen.getByTestId("badge").textContent).toBe("1");
      await rerender({ count: 5 });
      expect(screen.getByTestId("badge").textContent).toBe("5");
      await rerender();
      expect(alertText()).toMatch(/count/);
    });

    it("shows the fallback for a required bound prop until its state is set", async () => {
      const { push, rerender, reportError } = setup();
      await push(nodes({ id: "root", component: "Badge" }));
      expect(alertText()).toMatch(/count/);
      expect(reportError).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "props", componentId: "root" }),
      );
      await rerender({ count: 3 });
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByTestId("badge").textContent).toBe("3");
    });

    it("ignores model values for bound props and bindings for matched events", async () => {
      const handler = vi.fn();
      const { push, rerender, manager, forwardEvent } = setup({
        addToCart: handler,
      });
      await rerender({
        count: 2,
        cart: cartWith({ productId: "p1", quantity: 4 }),
      });
      await push(
        nodes(
          { id: "root", component: "Grid", children: ["badge", "p1"] },
          { id: "badge", component: "Badge", count: 99 },
          {
            id: "p1",
            component: "ProductCard",
            productId: "p1",
            name: "Mug",
            inCart: 99,
            onAddToCart: { event: { name: "hijack" } },
          },
        ),
      );
      expect(manager.getSurface("t1", S)!.clientRejected).toEqual([]);
      expect(screen.getByTestId("badge").textContent).toBe("2");
      expect(screen.getByTestId("in-cart-p1").textContent).toBe("4");
      await fireEvent.click(screen.getByText("buy p1"));
      await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
      expect(forwardEvent).not.toHaveBeenCalled();
    });

    it("passes the model's props to a (state, props) selector", async () => {
      const { push, rerender } = setup();
      await rerender({ cart: cartWith({ productId: "p1", quantity: 2 }) });
      await push(
        nodes(
          { id: "root", component: "Grid", children: ["p1", "p2"] },
          { id: "p1", component: "ProductCard", productId: "p1", name: "A" },
          { id: "p2", component: "ProductCard", productId: "p2", name: "B" },
        ),
      );
      expect(screen.getByTestId("in-cart-p1").textContent).toBe("2");
      expect(screen.getByTestId("in-cart-p2").textContent).toBe("0");
    });

    it("shows the fallback and reports a props error when a selector throws", async () => {
      const { push, reportError } = setup();
      await push(nodes({ id: "root", component: "Broken" }));
      expect(alertText()).toContain("selector exploded");
      expect(reportError).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "props",
          componentId: "root",
          error: expect.objectContaining({
            message: expect.stringContaining("selector exploded"),
          }),
        }),
      );
    });

    it("does not re-render a node when only state it does not select changes", async () => {
      const { push, rerender } = setup();
      await rerender({ count: 2, cart: cartWith() });
      await push(nodes({ id: "root", component: "Badge" }));
      const before = badgeRenders;

      await rerender({
        count: 2,
        cart: cartWith({ productId: "a", quantity: 1 }),
      });

      expect(badgeRenders).toBe(before);
      expect(screen.getByTestId("badge").textContent).toBe("2");
    });

    it("does not loop on a selector that returns a new array, and re-renders only on state changes", async () => {
      const errors = vi.spyOn(console, "error");
      try {
        const { push, rerender, manager } = setup();
        await rerender({ cart: cartWith({ productId: "a", quantity: 1 }) });
        await push(nodes({ id: "root", component: "CartIds" }));
        expect(screen.getByTestId("cart-ids").textContent).toBe("a");
        const before = cartIdsRenders;

        // A manager change that is not a state change.
        manager.registerTarget("elsewhere");
        await nextTick();
        expect(cartIdsRenders).toBe(before);

        await rerender({
          cart: cartWith(
            { productId: "a", quantity: 1 },
            { productId: "b", quantity: 1 },
          ),
        });
        expect(screen.getByTestId("cart-ids").textContent).toBe("a,b");
        expect(cartIdsRenders).toBe(before + 1);
        expect(errors).not.toHaveBeenCalled();
      } finally {
        errors.mockRestore();
      }
    });
  });

  describe("matched events", () => {
    it("calls the function with its defaults when the event has no parameters", async () => {
      const handler = vi.fn();
      const { push, rerender } = setup({ addToCart: handler });
      await rerender({ cart: cartWith() });
      await push(
        nodes({
          id: "root",
          component: "ProductCard",
          productId: "p1",
          name: "Mug",
        }),
      );
      await fireEvent.click(screen.getByText("buy p1"));
      await vi.waitFor(() =>
        expect(handler).toHaveBeenCalledExactlyOnceWith({
          productId: "p1",
          quantity: 1,
        }),
      );
    });

    it("checks the args with the event parameters, then with the function parameters", async () => {
      const handler = vi.fn(() => "added");
      const { push } = setup({ addToCart: handler });
      await push(nodes({ id: "root", component: "QuickAdd" }));

      const tooShort = await quickAdd!({ productId: "p", quantity: 1 });
      expect(!tooShort.ok && tooShort.error.code).toBe("invalid_event_args");

      const tooMany = await quickAdd!({ productId: "p123", quantity: 50 });
      expect(!tooMany.ok && tooMany.error.code).toBe("invalid_arguments");

      const valid = await quickAdd!({ productId: "p123", quantity: 2 });
      expect(valid).toEqual({ ok: true, result: "added" });
      expect(handler).toHaveBeenCalledExactlyOnceWith({
        productId: "p123",
        quantity: 2,
      });
    });
  });

  describe("writable props", () => {
    const dataAt = (manager: GenerativeUISurfaceManager, path: string) =>
      manager.getSurface("t1", S)!.model.dataModel.get(path);

    it("writes a path-bound prop to the data model, and keeps it over an agent write", async () => {
      const { push, manager } = setup();
      await push(
        data("/form", { email: "agent@x.io" }),
        nodes({
          id: "root",
          component: "TextField",
          value: { "@path": "/form/email" },
        }),
      );
      await type(inputs()[0]!, "me@x.io");
      expect(dataAt(manager, "/form/email")).toBe("me@x.io");

      await push(data("/form/email", "other@x.io"));
      expect(inputs()[0]!.value).toBe("me@x.io");
      expect(dataAt(manager, "/form/email")).toBe("me@x.io");
    });

    it("keeps a literal prop's value local to the node", async () => {
      const { push, manager } = setup();
      await push(nodes({ id: "root", component: "TextField", value: "agent" }));
      await type(inputs()[0]!, "me");
      expect(inputs()[0]!.value).toBe("me");
      expect(manager.describeSurfaces("t1")).toEqual({
        [S]: { target: "inline" },
      });
    });
  });

  describe("template slots", () => {
    const grid = (template: { componentId: string; path: string }) =>
      nodes({ id: "root", component: "Grid", children: template });
    const label = (id: string, path: string) =>
      nodes({ id, component: "Text", label: { "@path": path } });

    it("renders the component once per item, with relative bindings", async () => {
      const { push } = setup();
      await push(
        data("/items", [{ name: "A" }, { name: "B" }, { name: "C" }]),
        grid({ componentId: "row", path: "/items" }),
        label("row", "name"),
      );
      expect(texts(screen.getByTestId("grid"))).toEqual(["A", "B", "C"]);

      await push(data("/items", [{ name: "A" }]));
      expect(texts(screen.getByTestId("grid"))).toEqual(["A"]);
    });

    it("resolves a nested template path against the outer item", async () => {
      const { push } = setup();
      await push(
        data("/groups", [
          { title: "G1", rows: [{ name: "a" }, { name: "b" }] },
          { title: "G2", rows: [{ name: "c" }] },
        ]),
        grid({ componentId: "group", path: "/groups" }),
        nodes({
          id: "group",
          component: "Section",
          title: { "@path": "title" },
          children: { componentId: "row", path: "rows" },
        }),
        label("row", "name"),
      );
      expect(texts(screen.getByTestId("section-G1"))).toEqual(["a", "b"]);
      expect(texts(screen.getByTestId("section-G2"))).toEqual(["c"]);
    });

    it("writes a writable prop of a template item to the item path", async () => {
      const { push, manager } = setup();
      await push(
        data("/items", [{ name: "A" }, { name: "B" }]),
        grid({ componentId: "field", path: "/items" }),
        nodes({
          id: "field",
          component: "TextField",
          value: { "@path": "name" },
        }),
      );
      await type(inputs()[1]!, "B2");
      expect(
        manager.getSurface("t1", S)!.model.dataModel.get("/items"),
      ).toEqual([{ name: "A" }, { name: "B2" }]);
      expect(inputs().map((input) => input.value)).toEqual(["A", "B2"]);
    });

    it("gives an @index prop the item index plus the offset", async () => {
      const { push } = setup();
      await push(
        data("/items", [{ name: "A" }, { name: "B" }]),
        grid({ componentId: "pos", path: "/items" }),
        nodes({
          id: "pos",
          component: "Position",
          index: { "@call": "@index", args: { offset: 1 } },
        }),
      );
      expect(texts(screen.getByTestId("grid"))).toEqual(["1", "2"]);
    });

    it("forwards the userMessage of an item, read from a relative @path", async () => {
      const { push, forwardEvent } = setup();
      await push(
        data("/items", [{ note: "I pick A" }, { note: "I pick B" }]),
        grid({ componentId: "card", path: "/items" }),
        nodes({
          id: "card",
          component: "Card",
          productId: "p1",
          name: "Plan",
          onPick: {
            event: { name: "pick", userMessage: { "@path": "note" } },
          },
        }),
      );
      const buttons = screen.getAllByText("pick p1");
      await fireEvent.click(buttons[1]!);
      await vi.waitFor(() =>
        expect(forwardEvent).toHaveBeenCalledExactlyOnceWith(
          {
            name: "pick",
            surfaceId: S,
            componentId: "card",
            timestamp: expect.any(String),
            userMessage: "I pick B",
            context: { productId: "p1" },
          },
          "default",
        ),
      );
    });

    it.each([
      ["missing", []],
      ["empty", [data("/items", [])]],
    ])("renders nothing for a %s list", async (_label, before) => {
      const { push } = setup();
      await push(
        ...before,
        grid({ componentId: "row", path: "/items" }),
        label("row", "name"),
      );
      expect(screen.getByTestId("grid").childElementCount).toBe(0);
    });

    it("cuts a cycle between two templates and keeps the other items", async () => {
      const { push } = setup();
      await push(
        data("/items", [{ name: "A" }]),
        nodes(
          { id: "root", component: "Grid", children: ["a", "ok"] },
          {
            id: "a",
            component: "Section",
            title: "a",
            children: { componentId: "b", path: "/items" },
          },
          {
            id: "b",
            component: "Section",
            title: "b",
            children: { componentId: "a", path: "/items" },
          },
        ),
        label("ok", "/items/0/name"),
      );
      // a, then b and a for item 0, then b again for item 0: the cycle.
      expect(alertText()).toContain("cyclic reference to b");
      expect(within(screen.getByTestId("grid")).getByText("A")).toBeTruthy();
    });
  });

  describe("invokeBoundEvent never rejects", () => {
    const parameters = z.object({ productId: z.string() });
    const surface = () => {
      const { manager, runtime, reportError, forwardEvent } = setup();
      // The engine's `ui` type takes function and class components only.
      const engineUI: AnyGenerativeUI = runtime.ui;
      return {
        runtime: { ...runtime, ui: engineUI },
        reportError,
        forwardEvent,
        surface: manager.getSurface("t1", S)!,
      };
    };

    it("resolves ok:false for invalid args even when reportError throws", async () => {
      const { runtime, reportError, surface: managed } = surface();
      reportError.mockImplementation(() => {
        throw new Error("host onError exploded");
      });
      const result = await invokeBoundEvent({
        runtime,
        surface: managed,
        componentId: "root",
        name: "onPick",
        parameters,
        basePath: undefined,
        binding: { event: { name: "more" } },
        args: { productId: 1 },
      });
      expect(!result.ok && result.error.code).toBe("invalid_event_args");
    });

    it.each([
      ["rejects", () => Promise.reject(new Error("network down"))],
      [
        "throws synchronously",
        () => {
          throw new Error("network down");
        },
      ],
    ])("resolves ok:false when forwardEvent %s", async (_label, impl) => {
      const {
        runtime,
        reportError,
        forwardEvent,
        surface: managed,
      } = surface();
      forwardEvent.mockImplementation(impl);
      const result = await invokeBoundEvent({
        runtime,
        surface: managed,
        componentId: "root",
        name: "onPick",
        parameters,
        basePath: undefined,
        binding: { event: { name: "more" } },
        args: { productId: "p" },
      });
      expect(!result.ok && result.error.code).toBe("event_forward_failed");
      expect(!result.ok && result.error.message).toContain("network down");
      expect(reportError).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "event", componentId: "root" }),
      );
    });
  });
});

describe("Vue-specific semantics", () => {
  const Strip = defineComponent({
    template: `
      <ul>
        <li v-for="(item, index) in $slots.items?.() ?? []" :key="index">
          <component :is="item" />
        </li>
      </ul>
    `,
  });
  const Frame = defineComponent({
    template: `
      <article>
        <header><slot name="header" /></header>
        <footer><slot name="footer">no footer</slot></footer>
      </article>
    `,
  });
  const vueUI = createGenerativeUI({
    id: "vue",
    components: {
      ModelField: {
        component: ModelField,
        props: z.object({
          label: z.string().optional(),
          value: z.string().default(""),
        }),
        writable: ["value"],
      },
      Strip: { component: Strip, slots: { items: "multiple" } },
      Frame: {
        component: Frame,
        slots: { header: "single", footer: "single" },
      },
      Text: { component: Label, props: z.object({ label: z.string() }) },
    },
  });
  const items = () =>
    screen.getAllByRole("listitem").map((item) => item.textContent);
  /** A data write to the surface of `renderSurface`. */
  const surfaceData = (path: string, value: unknown): A2UIOperation => ({
    version: "1.0",
    updateDataModel: { surfaceId: SURFACE_ID, path, value },
  });

  it("writes a writable prop through defineModel, to the data model when it is bound", async () => {
    const v = renderSurface(
      vueUI,
      [
        {
          id: "root",
          component: "ModelField",
          value: { "@path": "/email" },
        },
      ],
      { email: "agent@x.io" },
    );
    const input = await v.findByLabelText<HTMLInputElement>("model");
    expect(input.value).toBe("agent@x.io");
    await fireEvent.update(input, "me@x.io");
    expect(v.dataAt("/email")).toBe("me@x.io");
    await v.update(surfaceData("/email", "other@x.io"));
    expect(input.value).toBe("me@x.io");
    expect(v.dataAt("/email")).toBe("me@x.io");
  });

  it("keeps a literal writable prop that defineModel set local to the node", async () => {
    const v = renderSurface(vueUI, [
      { id: "root", component: "ModelField", value: "agent" },
    ]);
    const input = await v.findByLabelText<HTMLInputElement>("model");
    await fireEvent.update(input, "me");
    await nextTick();
    expect(v.getByLabelText<HTMLInputElement>("model").value).toBe("me");
    expect(v.reportError).not.toHaveBeenCalled();
  });

  it("gives a multiple slot one VNode per child, for ids and for a template", async () => {
    const ids = renderSurface(vueUI, [
      { id: "root", component: "Strip", items: ["a", "b", "c"] },
      { id: "a", component: "Text", label: "A" },
      { id: "b", component: "Text", label: "B" },
      { id: "c", component: "Text", label: "C" },
    ]);
    await nextTick();
    expect(items()).toEqual(["A", "B", "C"]);
    ids.unmount();

    const template = renderSurface(
      vueUI,
      [
        {
          id: "root",
          component: "Strip",
          items: { componentId: "row", path: "/rows" },
        },
        { id: "row", component: "Text", label: { "@path": "name" } },
      ],
      { rows: [{ name: "Ada" }, { name: "Linus" }] },
    );
    await nextTick();
    expect(items()).toEqual(["Ada", "Linus"]);
    await template.update(
      surfaceData("/rows", [
        { name: "Ada" },
        { name: "Linus" },
        { name: "Grace" },
      ]),
    );
    expect(items()).toEqual(["Ada", "Linus", "Grace"]);
  });

  it("renders a single slot as a named slot, and leaves an unfilled slot out", async () => {
    const v = renderSurface(vueUI, [
      { id: "root", component: "Frame", header: "title" },
      { id: "title", component: "Text", label: "Hello" },
    ]);
    await nextTick();
    const article = v.container.querySelector("article")!;
    expect(article.querySelector("header")!.textContent).toBe("Hello");
    expect(article.querySelector("footer")!.textContent).toBe("no footer");
  });

  it("sets the theme of the runtime on the surface root as a stylesheet", async () => {
    const { runtime } = createTestRuntime(vueUI);
    runtime.theme = { "--a2ui-color-accent": "#111111" };
    runtime.manager.ingest("t1", "default", {
      surfaceId: "themed",
      target: "inline",
      catalogId: "vue",
      operations: [
        {
          version: "1.0",
          createSurface: { surfaceId: "themed", catalogId: "vue" },
        },
        {
          version: "1.0",
          updateComponents: {
            surfaceId: "themed",
            components: [{ id: "root", component: "Text", label: "Hi" }],
          },
        },
      ],
      status: "ready",
      rejected: [],
    });
    const Provider = createRuntimeProvider(runtime);
    const surface = runtime.manager.getSurface("t1", "themed");
    const { container } = render(
      defineComponent({
        components: { Provider, SurfaceView },
        setup: () => ({ surface }),
        template: `<Provider><SurfaceView :surface="surface" /></Provider>`,
      }),
    );
    const root = container.querySelector<HTMLElement>(
      '[data-generative-ui-root="themed"]',
    )!;
    const id = root.getAttribute("data-a2ui-theme");
    expect(root.classList.contains("a2ui-surface")).toBe(true);
    expect(root.style.display).toBe("contents");
    expect(root.querySelector("style")!.textContent).toBe(
      `.a2ui-surface[data-a2ui-theme="${id}"]{--a2ui-color-accent:#111111}`,
    );
    expect(root.textContent).toContain("Hi");
  });
});
