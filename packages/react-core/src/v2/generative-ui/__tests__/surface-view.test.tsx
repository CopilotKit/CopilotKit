import React, { useEffect, useLayoutEffect, useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComponentModel } from "@a2ui/web_core/v0_9";
import { z } from "zod";
import type {
  A2UIOperation,
  GenerativeUISurfaceContent,
} from "@copilotkit/shared";
import { createGenerativeUICatalog } from "../catalog";
import { createGenerativeUIDispatcher } from "../dispatcher";
import type { GenerativeUIFunctionDefinition } from "../dispatcher";
import type { GenerativeUIEventHandler } from "../errors";
import { useGenerativeUIField } from "../hooks";
import { GenerativeUIRuntimeContext } from "../runtime-context";
import type { GenerativeUIRuntime } from "../runtime-context";
import { invokeBoundEvent } from "../events";
import { GenerativeUISurfaceManager } from "../surface-manager";
import { SurfaceView } from "../SurfaceView";

const mounts = new Map<string, number>();
let bombArmed = false;
/** Set by a test to run a write from inside `Racer`'s layout effect. */
let race: (() => void) | undefined;

function Grid({ children }: { children?: React.ReactNode }) {
  return <div data-testid="grid">{children}</div>;
}
function Card({
  productId: id,
  name,
  onAddToCart,
}: {
  productId: string;
  name: string;
  onAddToCart?: GenerativeUIEventHandler<typeof catalog, "onAddToCart">;
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
          await onAddToCart?.({ productId: id });
        }}
      >
        add {id}
      </button>
    </div>
  );
}
function Badge({ count }: { count: number }) {
  return <span data-testid="badge">{count}</span>;
}
function Email({ email }: { email: string }) {
  const [value, setValue, { dirty, reset }] = useGenerativeUIField(
    "email",
    email,
  );
  return (
    <div>
      <input
        aria-label="email"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      {dirty && <button onClick={reset}>reset</button>}
    </div>
  );
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

const catalog = createGenerativeUICatalog({
  id: "shop",
  components: {
    Grid: { component: Grid, slots: { children: "multiple" } },
    Card: {
      component: Card,
      props: z.object({ productId: z.string(), name: z.string() }),
      events: {
        onAddToCart: { parameters: z.object({ productId: z.string() }) },
      },
    },
    Badge: { component: Badge, props: z.object({ count: z.number() }) },
    Email: { component: Email, props: z.object({ email: z.string() }) },
    Racer: { component: Racer },
    Bomb: { component: Bomb, props: z.object({ label: z.string() }) },
  },
});

const S = "s1";
const create: A2UIOperation = {
  version: "v0.9",
  createSurface: { surfaceId: S, catalogId: "shop" },
};
const nodes = (...components: any[]): A2UIOperation => ({
  version: "v0.9",
  updateComponents: { surfaceId: S, components },
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
  functions: Record<string, GenerativeUIFunctionDefinition> = {},
  fallback?: GenerativeUIRuntime["errorFallback"],
) {
  const manager = new GenerativeUISurfaceManager(catalog);
  const reportError = vi.fn();
  const forwardEvent = vi.fn(async () => ({
    ok: true as const,
    result: undefined,
  }));
  const runtime: GenerativeUIRuntime = {
    manager,
    catalog,
    reportError,
    forwardEvent,
    errorFallback: fallback,
    dispatcher: createGenerativeUIDispatcher({
      getProviderFunctions: () => functions,
      getTool: () => undefined,
      listTools: () => [],
    }),
  };
  let ops: A2UIOperation[] = [create];
  const push = (...more: A2UIOperation[]) => {
    ops = [...ops, ...more];
    act(() => manager.ingest("t1", "default", content(ops)));
  };
  act(() => manager.ingest("t1", "default", content(ops)));
  const view = () => (
    <GenerativeUIRuntimeContext.Provider value={runtime}>
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
    rerender: () => utils.rerender(view()),
  };
}

describe("SurfaceView", () => {
  afterEach(() => {
    bombArmed = false;
    race = undefined;
  });

  it("streams cards into a grid without remounting earlier cards", () => {
    mounts.clear();
    const { push } = setup();
    push(nodes({ id: "root", component: "Grid", children: ["a", "b", "c"] }));
    expect(
      document.querySelectorAll("[data-generative-ui-placeholder]"),
    ).toHaveLength(3);
    push(nodes({ id: "a", component: "Card", productId: "a", name: "Alpha" }));
    fireEvent.click(screen.getByText("add a"));
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

  it("runs the bound function once with component args merged under agent args", async () => {
    const handler = vi.fn();
    const { push } = setup({
      addToCart: {
        parameters: z.object({ productId: z.string(), quantity: z.number() }),
        handler,
      },
    });
    push(
      nodes({
        id: "root",
        component: "Card",
        productId: "root",
        name: "A",
        onAddToCart: {
          functionCall: { call: "addToCart", args: { quantity: 2 } },
        },
      }),
    );
    await act(async () => fireEvent.click(screen.getByText("add root")));
    expect(handler).toHaveBeenCalledExactlyOnceWith({
      productId: "root",
      quantity: 2,
    });
  });

  it("forwards event bindings to the agent with resolved context", async () => {
    const { push, forwardEvent } = setup();
    push(
      {
        version: "v0.9",
        updateDataModel: { surfaceId: S, path: "/sel", value: "x" },
      },
      nodes({
        id: "root",
        component: "Card",
        productId: "root",
        name: "A",
        onAddToCart: {
          event: { name: "more", context: { selected: { path: "/sel" } } },
        },
      }),
    );
    await act(async () => fireEvent.click(screen.getByText("add root")));
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

  it("updates bound app state without an agent run", () => {
    const { push, manager } = setup();
    act(() => manager.setAppState("cart", { count: 1 }));
    push(
      nodes({
        id: "root",
        component: "Badge",
        count: { path: "/app/cart/count" },
      }),
    );
    expect(screen.getByTestId("badge").textContent).toBe("1");
    act(() => manager.setAppState("cart", { count: 5 }));
    expect(screen.getByTestId("badge").textContent).toBe("5");
  });

  it("keeps a dirty field when the agent updates the component", () => {
    const { push } = setup();
    push(nodes({ id: "root", component: "Email", email: "agent@x.io" }));
    const input = screen.getByLabelText("email") as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: "me@x.io" } });
    push(nodes({ id: "root", component: "Email", email: "other@x.io" }));
    expect((screen.getByLabelText("email") as HTMLInputElement).value).toBe(
      "me@x.io",
    );
    expect(document.activeElement).toBe(screen.getByLabelText("email"));
    fireEvent.click(screen.getByText("reset"));
    expect((screen.getByLabelText("email") as HTMLInputElement).value).toBe(
      "other@x.io",
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
    const { push, reportError } = setup({ addToCart: { handler } }, fallback);
    push(
      nodes(
        { id: "root", component: "Grid", children: ["bomb", "ok"] },
        { id: "bomb", component: "Bomb", label: "b1" },
        {
          id: "ok",
          component: "Card",
          productId: "ok",
          name: "Fine",
          onAddToCart: { functionCall: { call: "addToCart" } },
        },
      ),
    );
    expect(screen.getByText("retry: exploded b1")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByText("add ok")));
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
    expect(screen.getByRole("alert").textContent).toContain("exploded v1");
    bombArmed = false;
    push(nodes({ id: "root", component: "Bomb", label: "v2" }));
    expect(screen.getByText("survived v2")).toBeTruthy();
  });

  it("shows a local fallback when bound data has the wrong type", () => {
    const { push, reportError } = setup();
    push(
      {
        version: "v0.9",
        updateDataModel: { surfaceId: S, path: "/n", value: "many" },
      },
      nodes({ id: "root", component: "Badge", count: { path: "/n" } }),
    );
    expect(screen.getByRole("alert").textContent).toMatch(/count/);
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
    push({
      version: "v0.9",
      updateDataModel: { surfaceId: S, path: "/tick", value: 1 },
    });
    expect(screen.getByRole("alert").textContent).toContain(
      "cyclic reference to root",
    );
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
    expect(screen.getByRole("alert").textContent).toContain(
      "cyclic reference to a",
    );
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
    push(
      nodes({
        id: "root",
        component: "Card",
        productId: "root",
        name: "Before",
      }),
    );
    render(view());
    expect(screen.getAllByText("Before")).toHaveLength(2);
    push(
      nodes({
        id: "root",
        component: "Card",
        productId: "root",
        name: "After",
      }),
    );
    expect(screen.getAllByText("After")).toHaveLength(2);
    expect(screen.queryByText("Before")).toBeNull();
  });

  it("does not lose a data write that lands between commit and effect flush", () => {
    const { push, manager } = setup();
    race = () => manager.getSurface("t1", S)!.model.dataModel.set("/n", 9);
    push(
      {
        version: "v0.9",
        updateDataModel: { surfaceId: S, path: "/n", value: 1 },
      },
      nodes(
        { id: "root", component: "Grid", children: ["badge", "racer"] },
        { id: "badge", component: "Badge", count: { path: "/n" } },
        { id: "racer", component: "Racer" },
      ),
    );
    expect(race).toBeUndefined();
    expect(screen.getByTestId("badge").textContent).toBe("9");
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
        { id: "bad", component: "Badge", count: { path: "/missing" } },
      ),
    );
    expect(reportError).toHaveBeenCalled();
    expect(screen.getAllByRole("alert")).toHaveLength(2);
  });

  describe("invokeBoundEvent never rejects", () => {
    const parameters = z.object({ productId: z.string() });
    const surface = () => {
      const { manager, runtime } = setup();
      return { runtime, surface: manager.getSurface("t1", S)! };
    };

    it("resolves ok:false for invalid args even when reportError throws", async () => {
      const { runtime, surface: managed } = surface();
      (runtime.reportError as ReturnType<typeof vi.fn>).mockImplementation(
        () => {
          throw new Error("host onError exploded");
        },
      );
      const result = await invokeBoundEvent({
        runtime,
        surface: managed,
        componentId: "root",
        name: "onAddToCart",
        parameters,
        binding: { event: { name: "more" } },
        args: { productId: 1 },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("invalid_event_args");
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
      const { runtime, surface: managed } = surface();
      (runtime.forwardEvent as ReturnType<typeof vi.fn>).mockImplementation(
        impl,
      );
      const result = await invokeBoundEvent({
        runtime,
        surface: managed,
        componentId: "root",
        name: "onAddToCart",
        parameters,
        binding: { event: { name: "more" } },
        args: { productId: "p" },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("event_forward_failed");
        expect(result.error.message).toContain("network down");
      }
      expect(runtime.reportError).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "event", componentId: "root" }),
      );
    });
  });
});
