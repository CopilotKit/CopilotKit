import React, { useEffect, useLayoutEffect, useState } from "react";
import type { ReactNode } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComponentModel } from "@a2ui/web_core/v0_9";
import { z } from "zod";
import type {
  A2UIComponentNode,
  A2UIOperation,
  GenerativeUISurfaceContent,
} from "@copilotkit/shared";
import { createGenerativeUI } from "../catalog";
import type {
  GenerativeUIComponentProps,
  GenerativeUIFunctionArgs,
  GenerativeUIStateOf,
} from "../catalog";
import { createGenerativeUIDispatcher } from "../dispatcher";
import type {
  GenerativeUIErrorInfo,
  GenerativeUIEventHandler,
} from "../errors";
import { useGenerativeUIFunction, useGenerativeUIState } from "../hooks";
import { GenerativeUIRuntimeContext } from "../runtime-context";
import type { GenerativeUIRuntime } from "../runtime-context";
import { invokeBoundEvent } from "../events";
import { GenerativeUISurfaceManager } from "../surface-manager";
import { SurfaceView } from "../SurfaceView";

const mounts = new Map<string, number>();
let bombArmed = false;
/** Set by a test to run a write from inside `Racer`'s layout effect. */
let race: (() => void) | undefined;
/** The `addToCart` event prop that `QuickAdd` got on its last render. */
let quickAdd: GenerativeUIEventHandler<typeof ui, "addToCart"> | undefined;
let cartIdsRenders = 0;
let badgeRenders = 0;

function Grid({ children }: { children?: React.ReactNode }) {
  return <div data-testid="grid">{children}</div>;
}
function Card({
  productId: id,
  name,
  onPick,
}: {
  productId: string;
  name: string;
  onPick?: GenerativeUIEventHandler<typeof ui, "onPick">;
}) {
  const [clicks, setClicks] = useState(0);
  useEffect(() => {
    mounts.set(id, (mounts.get(id) ?? 0) + 1);
  }, []);
  return (
    <div data-testid={`card-${id}`}>
      <span>{name}</span>
      <span data-testid={`clicks-${id}`}>{clicks}</span>
      <button
        onClick={async () => {
          setClicks((c) => c + 1);
          await onPick?.({ productId: id });
        }}
      >
        pick {id}
      </button>
    </div>
  );
}
function ProductCard({
  productId,
  name,
  inCart,
  onAddToCart,
}: GenerativeUIComponentProps<typeof ui, "ProductCard">) {
  return (
    <div>
      <span>{name}</span>
      <span data-testid={`in-cart-${productId}`}>{inCart}</span>
      <button onClick={() => onAddToCart?.({ productId })}>
        buy {productId}
      </button>
    </div>
  );
}
function QuickAdd({
  addToCart,
}: {
  addToCart?: GenerativeUIEventHandler<typeof ui, "addToCart">;
}) {
  quickAdd = addToCart;
  return null;
}
function Badge({ count }: { count: number }) {
  badgeRenders++;
  return <span data-testid="badge">{count}</span>;
}
function Counter({ value }: { value: number }) {
  return <span data-testid="counter">{value}</span>;
}
function CartIds({ ids }: { ids: string[] }) {
  cartIdsRenders++;
  return <span data-testid="cart-ids">{ids.join(",")}</span>;
}
function Label({ label }: { label: string }) {
  return <span>{label}</span>;
}
function TextField({
  label,
  value,
  setValue,
}: GenerativeUIComponentProps<typeof ui, "TextField">) {
  return (
    <input
      aria-label={label ?? "field"}
      value={value}
      onChange={(e) => setValue(e.target.value)}
    />
  );
}
function Section({ title, children }: { title: string; children?: ReactNode }) {
  return <section data-testid={`section-${title}`}>{children}</section>;
}
function Racer() {
  // Layout effects run after commit but before any passive effect, which is
  // exactly the window in which a data write used to be lost.
  useLayoutEffect(() => {
    const fire = race;
    race = undefined;
    fire?.();
  }, []);
  return null;
}
function Bomb({ label }: { label: string }) {
  if (bombArmed) throw new Error(`exploded ${label}`);
  return <span>survived {label}</span>;
}

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
    // `value` is writable, so the component gets `setValue`.
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

function AddToCartHandler({
  handler,
}: {
  handler: (args: AddToCartArgs) => unknown;
}) {
  useGenerativeUIFunction(ui, "addToCart", handler);
  return null;
}
function CountState({ count }: { count: number }) {
  useGenerativeUIState(ui, "count", count);
  return null;
}
function CartState({ cart }: { cart: Cart }) {
  useGenerativeUIState(ui, "cart", cart);
  return null;
}

const S = "s1";
const create: A2UIOperation = {
  version: "v0.9",
  createSurface: { surfaceId: S, catalogId: "shop" },
};
const nodes = (...components: A2UIComponentNode[]): A2UIOperation => ({
  version: "v0.9",
  updateComponents: { surfaceId: S, components },
});
const data = (path: string, value: unknown): A2UIOperation => ({
  version: "v0.9",
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

function setup(
  options: {
    addToCart?: (args: AddToCartArgs) => unknown;
    fallback?: GenerativeUIRuntime["errorFallback"];
  } = {},
) {
  const manager = new GenerativeUISurfaceManager(ui);
  const reportError = vi.fn<(info: GenerativeUIErrorInfo) => void>();
  const forwardEvent = vi.fn<GenerativeUIRuntime["forwardEvent"]>(async () => ({
    ok: true,
    result: undefined,
  }));
  const runtime: GenerativeUIRuntime = {
    manager,
    ui,
    transport: "tool",
    config: { ui },
    reportError,
    forwardEvent,
    errorFallback: options.fallback,
    dispatcher: createGenerativeUIDispatcher({
      getDeclared: () => ui.functions,
    }),
  };
  let ops: A2UIOperation[] = [create];
  const push = (...more: A2UIOperation[]) => {
    ops = [...ops, ...more];
    act(() => manager.ingest("t1", "default", content(ops)));
  };
  act(() => manager.ingest("t1", "default", content(ops)));
  /** `extra` mounts next to the surface, for example state hooks. */
  const view = (extra?: ReactNode) => (
    <GenerativeUIRuntimeContext.Provider value={runtime}>
      {options.addToCart && <AddToCartHandler handler={options.addToCart} />}
      {extra}
      <SurfaceView surface={manager.getSurface("t1", S)!} />
    </GenerativeUIRuntimeContext.Provider>
  );
  const utils = render(view());
  return {
    manager,
    runtime,
    push,
    reportError,
    forwardEvent,
    view,
    rerender: (extra?: ReactNode) => utils.rerender(view(extra)),
  };
}

const cartWith = (...items: Cart["items"]): Cart => ({ items });
const alertText = () => screen.getByRole("alert").textContent;
const inputs = () => screen.getAllByLabelText<HTMLInputElement>("field");
/** The text of every `span` inside `element`, in order. */
const texts = (element: HTMLElement) =>
  [...element.querySelectorAll("span")].map((span) => span.textContent);
const type = (input: HTMLInputElement, value: string) =>
  fireEvent.change(input, { target: { value } });

describe("SurfaceView", () => {
  afterEach(() => {
    bombArmed = false;
    race = undefined;
    quickAdd = undefined;
  });

  it("streams cards into a grid without remounting earlier cards", () => {
    mounts.clear();
    const { push } = setup();
    push(nodes({ id: "root", component: "Grid", children: ["a", "b", "c"] }));
    // A child that has not streamed yet renders nothing, not a placeholder.
    expect(
      document.querySelectorAll("[data-generative-ui-placeholder]"),
    ).toHaveLength(0);
    expect(screen.queryByText("Alpha")).toBeNull();
    push(nodes({ id: "a", component: "Card", productId: "a", name: "Alpha" }));
    fireEvent.click(screen.getByText("pick a"));
    push(nodes({ id: "b", component: "Card", productId: "b", name: "Beta" }));
    push(
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
    push(
      nodes({
        id: "root",
        component: "Card",
        productId: "root",
        name: "A",
        onPick: { functionCall: { call: "addToCart", args: { quantity: 2 } } },
      }),
    );
    await act(async () => fireEvent.click(screen.getByText("pick root")));
    expect(handler).toHaveBeenCalledExactlyOnceWith({
      productId: "root",
      quantity: 2,
    });
  });

  it("forwards event bindings to the agent with resolved context", async () => {
    const { push, forwardEvent } = setup();
    push(
      data("/sel", "x"),
      nodes({
        id: "root",
        component: "Card",
        productId: "root",
        name: "A",
        onPick: {
          event: { name: "more", context: { selected: { path: "/sel" } } },
        },
      }),
    );
    await act(async () => fireEvent.click(screen.getByText("pick root")));
    expect(forwardEvent).toHaveBeenCalledExactlyOnceWith(
      {
        name: "more",
        surfaceId: S,
        componentId: "root",
        context: { productId: "root", selected: "x" },
      },
      "default",
    );
  });

  it("isolates a throwing component, keeps siblings usable, and retries", async () => {
    const handler = vi.fn();
    const fallback = vi.fn(
      ({ error, retry }: { error: Error; retry: () => void }) => (
        <button onClick={retry}>retry: {error.message}</button>
      ),
    );
    bombArmed = true;
    const { push, reportError } = setup({ addToCart: handler, fallback });
    push(
      nodes(
        { id: "root", component: "Grid", children: ["bomb", "ok"] },
        { id: "bomb", component: "Bomb", label: "b1" },
        {
          id: "ok",
          component: "Card",
          productId: "ok",
          name: "Fine",
          onPick: { functionCall: { call: "addToCart" } },
        },
      ),
    );
    expect(screen.getByText("retry: exploded b1")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByText("pick ok")));
    expect(handler).toHaveBeenCalledOnce();
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "render", componentId: "bomb" }),
    );
    bombArmed = false;
    fireEvent.click(screen.getByText("retry: exploded b1"));
    expect(screen.getByText("survived b1")).toBeTruthy();
  });

  it("resets a failed component when the agent sends a new revision of it", () => {
    bombArmed = true;
    const { push } = setup();
    push(nodes({ id: "root", component: "Bomb", label: "v1" }));
    expect(alertText()).toContain("exploded v1");
    bombArmed = false;
    push(nodes({ id: "root", component: "Bomb", label: "v2" }));
    expect(screen.getByText("survived v2")).toBeTruthy();
  });

  it("shows a local fallback when bound data has the wrong type", () => {
    const { push, reportError } = setup();
    push(
      data("/n", "many"),
      nodes({ id: "root", component: "Counter", value: { path: "/n" } }),
    );
    expect(alertText()).toMatch(/value/);
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "props", componentId: "root" }),
    );
  });

  it("shows a local fallback instead of recursing on a self-referencing slot", () => {
    // The manager rejects self-references at ingest, so inject the node directly
    // to exercise the renderer's own defence.
    const { push, manager } = setup();
    manager
      .getSurface("t1", S)!
      .model.componentsModel.addComponent(
        new ComponentModel("root", "Grid", { children: ["root"] }),
      );
    push(data("/tick", 1));
    expect(alertText()).toContain("cyclic reference to root");
  });

  it("cuts an A -> B -> A cycle without freezing and keeps the rest of the tree", () => {
    const { push } = setup();
    push(
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

  it("renders a repeated child id once without duplicate-key warnings", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { push } = setup();
      push(
        nodes(
          { id: "root", component: "Grid", children: ["x", "x"] },
          { id: "x", component: "Card", productId: "x", name: "Once" },
        ),
      );
      expect(screen.getAllByText("Once")).toHaveLength(1);
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });

  it("updates every mount of the same surface synchronously", () => {
    const { push, view } = setup();
    const card = (name: string) =>
      nodes({ id: "root", component: "Card", productId: "root", name });
    push(card("Before"));
    render(view());
    expect(screen.getAllByText("Before")).toHaveLength(2);
    push(card("After"));
    expect(screen.getAllByText("After")).toHaveLength(2);
    expect(screen.queryByText("Before")).toBeNull();
  });

  it("does not lose a data write that lands between commit and effect flush", () => {
    const { push, manager } = setup();
    race = () => manager.getSurface("t1", S)!.model.dataModel.set("/n", 9);
    push(
      data("/n", 1),
      nodes(
        { id: "root", component: "Grid", children: ["counter", "racer"] },
        { id: "counter", component: "Counter", value: { path: "/n" } },
        { id: "racer", component: "Racer" },
      ),
    );
    expect(race).toBeUndefined();
    expect(screen.getByTestId("counter").textContent).toBe("9");
  });

  it("keeps rendering when the host error reporter throws", () => {
    const { push, reportError } = setup();
    reportError.mockImplementation(() => {
      throw new Error("host onError exploded");
    });
    bombArmed = true;
    push(
      nodes(
        { id: "root", component: "Grid", children: ["bomb", "bad"] },
        { id: "bomb", component: "Bomb", label: "b1" },
        { id: "bad", component: "Counter", value: { path: "/missing" } },
      ),
    );
    expect(reportError).toHaveBeenCalled();
    expect(screen.getAllByRole("alert")).toHaveLength(2);
  });

  describe("bound props", () => {
    it("updates a name-bound prop when the state changes, and drops it on unmount", () => {
      const { push, rerender } = setup();
      rerender(<CountState count={1} />);
      push(nodes({ id: "root", component: "Badge" }));
      expect(screen.getByTestId("badge").textContent).toBe("1");
      rerender(<CountState count={5} />);
      expect(screen.getByTestId("badge").textContent).toBe("5");
      rerender();
      expect(alertText()).toMatch(/count/);
    });

    it("shows the fallback for a required bound prop until its state is set", () => {
      const { push, rerender, reportError } = setup();
      push(nodes({ id: "root", component: "Badge" }));
      expect(alertText()).toMatch(/count/);
      expect(reportError).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "props", componentId: "root" }),
      );
      rerender(<CountState count={3} />);
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByTestId("badge").textContent).toBe("3");
    });

    it("ignores model values for bound props and bindings for matched events", async () => {
      const handler = vi.fn();
      const { push, rerender, manager, forwardEvent } = setup({
        addToCart: handler,
      });
      rerender(
        <>
          <CountState count={2} />
          <CartState cart={cartWith({ productId: "p1", quantity: 4 })} />
        </>,
      );
      push(
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
      await act(async () => fireEvent.click(screen.getByText("buy p1")));
      expect(handler).toHaveBeenCalledOnce();
      expect(forwardEvent).not.toHaveBeenCalled();
    });

    it("passes the model's props to a (state, props) selector", () => {
      const { push, rerender } = setup();
      rerender(<CartState cart={cartWith({ productId: "p1", quantity: 2 })} />);
      push(
        nodes(
          { id: "root", component: "Grid", children: ["p1", "p2"] },
          { id: "p1", component: "ProductCard", productId: "p1", name: "A" },
          { id: "p2", component: "ProductCard", productId: "p2", name: "B" },
        ),
      );
      expect(screen.getByTestId("in-cart-p1").textContent).toBe("2");
      expect(screen.getByTestId("in-cart-p2").textContent).toBe("0");
    });

    it("shows the fallback and reports a props error when a selector throws", () => {
      const { push, reportError } = setup();
      push(nodes({ id: "root", component: "Broken" }));
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

    it("does not re-render a node when only state it does not select changes", () => {
      const { push, rerender } = setup();
      const state = (cart: Cart) => (
        <>
          <CountState count={2} />
          <CartState cart={cart} />
        </>
      );
      rerender(state(cartWith()));
      push(nodes({ id: "root", component: "Badge" }));
      const before = badgeRenders;

      rerender(state(cartWith({ productId: "a", quantity: 1 })));

      expect(badgeRenders).toBe(before);
      expect(screen.getByTestId("badge").textContent).toBe("2");
    });

    it("does not loop on a selector that returns a new array, and re-renders only on state changes", () => {
      const errors = vi.spyOn(console, "error");
      try {
        const { push, rerender, manager } = setup();
        rerender(
          <CartState cart={cartWith({ productId: "a", quantity: 1 })} />,
        );
        push(nodes({ id: "root", component: "CartIds" }));
        expect(screen.getByTestId("cart-ids").textContent).toBe("a");
        const before = cartIdsRenders;

        // A manager change that is not a state change.
        act(() => {
          manager.registerTarget("elsewhere");
        });
        expect(cartIdsRenders).toBe(before);

        rerender(
          <CartState
            cart={cartWith(
              { productId: "a", quantity: 1 },
              { productId: "b", quantity: 1 },
            )}
          />,
        );
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
      rerender(<CartState cart={cartWith()} />);
      push(
        nodes({
          id: "root",
          component: "ProductCard",
          productId: "p1",
          name: "Mug",
        }),
      );
      await act(async () => fireEvent.click(screen.getByText("buy p1")));
      expect(handler).toHaveBeenCalledExactlyOnceWith({
        productId: "p1",
        quantity: 1,
      });
    });

    it("checks the args with the event parameters, then with the function parameters", async () => {
      const handler = vi.fn(() => "added");
      const { push } = setup({ addToCart: handler });
      push(nodes({ id: "root", component: "QuickAdd" }));

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

    it("writes a path-bound prop to the data model, and keeps it over an agent write", () => {
      const { push, manager } = setup();
      push(
        data("/form", { email: "agent@x.io" }),
        nodes({
          id: "root",
          component: "TextField",
          value: { path: "/form/email" },
        }),
      );
      type(inputs()[0]!, "me@x.io");
      expect(dataAt(manager, "/form/email")).toBe("me@x.io");

      push(data("/form/email", "other@x.io"));
      expect(inputs()[0]!.value).toBe("me@x.io");
      expect(dataAt(manager, "/form/email")).toBe("me@x.io");
    });

    it("keeps a literal prop's value local to the node", () => {
      const { push, manager } = setup();
      push(nodes({ id: "root", component: "TextField", value: "agent" }));
      type(inputs()[0]!, "me");
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
      nodes({ id, component: "Text", label: { path } });

    it("renders the component once per item, with relative bindings", () => {
      const { push } = setup();
      push(
        data("/items", [{ name: "A" }, { name: "B" }, { name: "C" }]),
        grid({ componentId: "row", path: "/items" }),
        label("row", "name"),
      );
      expect(texts(screen.getByTestId("grid"))).toEqual(["A", "B", "C"]);

      push(data("/items", [{ name: "A" }]));
      expect(texts(screen.getByTestId("grid"))).toEqual(["A"]);
    });

    it("resolves a nested template path against the outer item", () => {
      const { push } = setup();
      push(
        data("/groups", [
          { title: "G1", rows: [{ name: "a" }, { name: "b" }] },
          { title: "G2", rows: [{ name: "c" }] },
        ]),
        grid({ componentId: "group", path: "/groups" }),
        nodes({
          id: "group",
          component: "Section",
          title: { path: "title" },
          children: { componentId: "row", path: "rows" },
        }),
        label("row", "name"),
      );
      expect(texts(screen.getByTestId("section-G1"))).toEqual(["a", "b"]);
      expect(texts(screen.getByTestId("section-G2"))).toEqual(["c"]);
    });

    it("writes a writable prop of a template item to the item path", () => {
      const { push, manager } = setup();
      push(
        data("/items", [{ name: "A" }, { name: "B" }]),
        grid({ componentId: "field", path: "/items" }),
        nodes({ id: "field", component: "TextField", value: { path: "name" } }),
      );
      type(inputs()[1]!, "B2");
      expect(
        manager.getSurface("t1", S)!.model.dataModel.get("/items"),
      ).toEqual([{ name: "A" }, { name: "B2" }]);
      expect(inputs().map((input) => input.value)).toEqual(["A", "B2"]);
    });

    it.each([
      ["missing", []],
      ["empty", [data("/items", [])]],
    ])("renders nothing for a %s list", (_label, before) => {
      const { push } = setup();
      push(
        ...before,
        grid({ componentId: "row", path: "/items" }),
        label("row", "name"),
      );
      expect(screen.getByTestId("grid").childElementCount).toBe(0);
    });

    it("cuts a cycle between two templates and keeps the other items", () => {
      const { push } = setup();
      push(
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
      return {
        runtime,
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

describe("useGenerativeUIState", () => {
  const prefsUI = createGenerativeUI({
    id: "prefs",
    state: {
      prefs: z.object({
        theme: z.string().default("light"),
        size: z.number().int(),
      }),
    },
    components: {},
  });
  type PrefsInput = z.input<
    (typeof prefsUI.definitions & {})["state"]["prefs"]
  >;

  function Prefs({ value }: { value: PrefsInput }) {
    useGenerativeUIState(prefsUI, "prefs", value);
    return null;
  }

  function mount(value: PrefsInput) {
    const manager = new GenerativeUISurfaceManager(prefsUI);
    const runtime: GenerativeUIRuntime = {
      manager,
      ui: prefsUI,
      transport: "tool",
      config: { ui: prefsUI },
      reportError: vi.fn(),
      forwardEvent: vi.fn(),
      dispatcher: createGenerativeUIDispatcher({
        getDeclared: () => prefsUI.functions,
      }),
    };
    const tree = (next: PrefsInput) => (
      <GenerativeUIRuntimeContext.Provider value={runtime}>
        <Prefs value={next} />
      </GenerativeUIRuntimeContext.Provider>
    );
    const utils = render(tree(value));
    return {
      manager,
      rerender: (next: PrefsInput) => utils.rerender(tree(next)),
    };
  }

  it("stores the value parsed with the state schema, so defaults apply", () => {
    const { manager } = mount({ size: 2 });
    expect(manager.getState()).toEqual({ prefs: { theme: "light", size: 2 } });
  });

  it("does not store an invalid value and removes the earlier one", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { manager, rerender } = mount({ size: 2 });
    rerender({ size: 2.5 });
    expect(manager.getState()).toEqual({});
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('invalid value for "prefs"'),
    );
    error.mockRestore();
  });
});
