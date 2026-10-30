import { TestBed } from "@angular/core/testing";
import { ComponentModel } from "@a2ui/web_core/v0_9";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopilotGenerativeUISurfaceView } from "../surface-view";
import {
  SURFACE_ID,
  THREAD_ID,
  renderSurface,
  updateComponents,
  updateDataModel,
} from "./render";
import { textOf } from "./dom";
import {
  RetryFallback,
  alertText,
  allByText,
  alerts,
  grid,
  inputs,
  probes,
  texts,
  type,
  ui,
} from "./surface-view.helpers";

// Streaming, children, errors, cycles and template slots. Bound props, matched
// events and invokeBoundEvent are in surface-view-bindings.spec.ts.

describe("CopilotGenerativeUISurfaceView", () => {
  afterEach(() => {
    probes.bombArmed = false;
    probes.race = undefined;
    probes.quickAdd = undefined;
  });

  it("streams cards into a grid without remounting earlier cards", () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Grid", children: ["a", "b", "c"] },
    ]);
    // A child that has not streamed yet renders nothing, not a placeholder.
    expect(grid(view.container).childElementCount).toBe(0);
    view.update(
      updateComponents({
        id: "a",
        component: "Card",
        productId: "a",
        name: "Alpha",
      }),
    );
    const first = view.container.querySelector("[data-card]");
    view.act(() => allByText(view.container, "pick a")[0]!.click());
    view.update(
      updateComponents({
        id: "b",
        component: "Card",
        productId: "b",
        name: "Beta",
      }),
    );
    view.update(
      updateComponents({
        id: "c",
        component: "Card",
        productId: "c",
        name: "Gamma",
      }),
      updateComponents({
        id: "a",
        component: "Card",
        productId: "a",
        name: "Alpha 2",
      }),
    );
    expect(allByText(view.container, "Alpha 2")).toHaveLength(1);
    expect(textOf(view.container, '[data-clicks="a"]')).toBe("1");
    expect(view.container.querySelector("[data-card]")).toBe(first);
    expect(
      view.container.querySelectorAll("[data-generative-ui-placeholder]"),
    ).toHaveLength(0);
  });

  it("calls a declared function from an unmatched event bound with functionCall, binding args winning", async () => {
    const handler = vi.fn();
    const view = renderSurface(ui, [
      {
        id: "root",
        component: "Card",
        productId: "root",
        name: "A",
        onPick: {
          functionCall: { "@call": "addToCart", args: { quantity: 2 } },
        },
      },
    ]);
    view.runtime.dispatcher.register("addToCart", { current: handler });
    allByText(view.container, "pick root")[0]!.click();
    await vi.waitFor(() => expect(handler).toHaveBeenCalled());
    expect(handler).toHaveBeenCalledExactlyOnceWith({
      productId: "root",
      quantity: 2,
    });
  });

  it("forwards event bindings to the agent with resolved context", async () => {
    const view = renderSurface(
      ui,
      [
        {
          id: "root",
          component: "Card",
          productId: "root",
          name: "A",
          onPick: {
            event: { name: "more", context: { selected: { "@path": "/sel" } } },
          },
        },
      ],
      { sel: "x" },
    );
    allByText(view.container, "pick root")[0]!.click();
    await vi.waitFor(() => expect(view.forwardEvent).toHaveBeenCalled());
    expect(view.forwardEvent).toHaveBeenCalledExactlyOnceWith(
      {
        name: "more",
        surfaceId: SURFACE_ID,
        componentId: "root",
        timestamp: expect.any(String),
        context: { productId: "root", selected: "x" },
      },
      "default",
    );
  });

  it("isolates a throwing component, keeps siblings usable, and retries", async () => {
    const handler = vi.fn();
    probes.bombArmed = true;
    const view = renderSurface(ui, [
      { id: "root", component: "Grid", children: ["bomb", "ok"] },
    ]);
    // The fallback is read when a node fails, so the stub runtime takes it now.
    Object.assign(view.runtime, { errorFallback: RetryFallback });
    view.runtime.dispatcher.register("addToCart", { current: handler });
    view.update(
      updateComponents(
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
    expect(allByText(view.container, "retry: exploded")).toHaveLength(1);
    allByText(view.container, "pick ok")[0]!.click();
    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
    expect(view.reportError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "render", componentId: "bomb" }),
    );
    probes.bombArmed = false;
    view.act(() => allByText(view.container, "retry: exploded")[0]!.click());
    expect(allByText(view.container, "survived b1")).toHaveLength(1);
  });

  it("resets a failed component when the agent sends a new revision of it", () => {
    probes.bombArmed = true;
    const view = renderSurface(ui, [
      { id: "root", component: "Bomb", label: "v1" },
    ]);
    expect(alertText(view.container)).toContain("exploded");
    probes.bombArmed = false;
    view.update(
      updateComponents({ id: "root", component: "Bomb", label: "v2" }),
    );
    expect(allByText(view.container, "survived v2")).toHaveLength(1);
  });

  it("gives an @index prop outside of a template no value, without an error", () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Position", index: { "@call": "@index" } },
    ]);
    expect(textOf(view.container, "[data-position]")).toBe("none");
    expect(view.reportError).not.toHaveBeenCalled();
  });

  it("shows a local fallback when bound data has the wrong type", () => {
    const view = renderSurface(
      ui,
      [{ id: "root", component: "Counter", value: { "@path": "/n" } }],
      { n: "many" },
    );
    expect(alertText(view.container)).toMatch(/value/);
    expect(view.reportError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "props", componentId: "root" }),
    );
  });

  it("shows a local fallback instead of recursing on a self-referencing slot", () => {
    // The manager rejects self-references at ingest, so inject the node
    // directly to exercise the renderer's own defence.
    const view = renderSurface(ui, [
      { id: "root", component: "Grid", children: ["loop"] },
    ]);
    view.runtime.manager
      .getSurface(THREAD_ID, SURFACE_ID)!
      .model.componentsModel.addComponent(
        new ComponentModel("loop", "Grid", { children: ["loop"] }),
      );
    view.update(updateDataModel("/tick", 1));
    expect(alertText(view.container)).toContain("cyclic reference to loop");
  });

  it("shows the fallback for a component that the UI does not have", () => {
    // The manager rejects unknown components at ingest; inject one directly.
    const view = renderSurface(ui, [
      { id: "root", component: "Grid", children: ["odd"] },
    ]);
    view.runtime.manager
      .getSurface(THREAD_ID, SURFACE_ID)!
      .model.componentsModel.addComponent(
        new ComponentModel("odd", "Nope", {}),
      );
    view.update(updateDataModel("/tick", 1));
    expect(alertText(view.container)).toContain('unknown component "Nope"');
  });

  it("cuts an A -> B -> A cycle without freezing and keeps the rest of the tree", () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Grid", children: ["a", "ok"] },
      { id: "a", component: "Grid", children: ["b"] },
      { id: "b", component: "Grid", children: ["a"] },
      { id: "ok", component: "Card", productId: "ok", name: "Fine" },
    ]);
    expect(alertText(view.container)).toContain("cyclic reference to a");
    expect(allByText(view.container, "Fine")).toHaveLength(1);
  });

  it("renders a repeated child id once without duplicate-key warnings", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const view = renderSurface(ui, [
        { id: "root", component: "Grid", children: ["x", "x"] },
        { id: "x", component: "Card", productId: "x", name: "Once" },
      ]);
      expect(allByText(view.container, "Once")).toHaveLength(1);
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });

  it("updates every mount of the same surface synchronously", () => {
    const card = (name: string) =>
      updateComponents({
        id: "root",
        component: "Card",
        productId: "root",
        name,
      });
    const view = renderSurface(ui, [
      { id: "root", component: "Card", productId: "root", name: "Before" },
    ]);
    const second = TestBed.createComponent(CopilotGenerativeUISurfaceView);
    second.componentRef.setInput(
      "surface",
      view.runtime.manager.getSurface(THREAD_ID, SURFACE_ID)!,
    );
    second.detectChanges();
    second.detectChanges();
    const names = () =>
      [view.container, second.nativeElement as HTMLElement].map((container) =>
        textOf(container, "[data-card] span"),
      );
    expect(names()).toEqual(["Before", "Before"]);
    view.update(card("After"));
    second.detectChanges();
    second.detectChanges();
    expect(names()).toEqual(["After", "After"]);
  });

  it("does not lose a data write that lands between commit and effect flush", () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Grid", children: ["counter", "racer"] },
    ]);
    const surface = view.runtime.manager.getSurface(THREAD_ID, SURFACE_ID)!;
    probes.race = () => surface.model.dataModel.set("/n", 9);
    view.update(
      updateDataModel("/n", 1),
      updateComponents(
        { id: "counter", component: "Counter", value: { "@path": "/n" } },
        { id: "racer", component: "Racer" },
      ),
    );
    expect(probes.race).toBeUndefined();
    expect(textOf(view.container, "[data-counter]")).toBe("9");
  });

  it("keeps rendering when the host error reporter throws", () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Grid", children: ["bomb", "bad"] },
    ]);
    view.reportError.mockImplementation(() => {
      throw new Error("host onError exploded");
    });
    probes.bombArmed = true;
    view.update(
      updateComponents(
        { id: "bomb", component: "Bomb", label: "b1" },
        { id: "bad", component: "Counter", value: { "@path": "/missing" } },
      ),
    );
    expect(view.reportError).toHaveBeenCalled();
    expect(alerts(view.container)).toHaveLength(2);
  });

  describe("template slots", () => {
    const gridOf = (template: { componentId: string; path: string }) => ({
      id: "root",
      component: "Grid",
      children: template,
    });
    const label = (id: string, path: string) => ({
      id,
      component: "Text",
      label: { "@path": path },
    });

    it("renders the component once per item, with relative bindings", () => {
      const view = renderSurface(
        ui,
        [gridOf({ componentId: "row", path: "/items" }), label("row", "name")],
        { items: [{ name: "A" }, { name: "B" }, { name: "C" }] },
      );
      expect(texts(grid(view.container))).toEqual(["A", "B", "C"]);

      view.update(updateDataModel("/items", [{ name: "A" }]));
      expect(texts(grid(view.container))).toEqual(["A"]);
    });

    it("resolves a nested template path against the outer item", () => {
      const view = renderSurface(
        ui,
        [
          gridOf({ componentId: "group", path: "/groups" }),
          {
            id: "group",
            component: "Section",
            title: { "@path": "title" },
            children: { componentId: "row", path: "rows" },
          },
          label("row", "name"),
        ],
        {
          groups: [
            { title: "G1", rows: [{ name: "a" }, { name: "b" }] },
            { title: "G2", rows: [{ name: "c" }] },
          ],
        },
      );
      const section = (title: string) =>
        view.container.querySelector<HTMLElement>(`[data-section="${title}"]`)!;
      expect(texts(section("G1"))).toEqual(["a", "b"]);
      expect(texts(section("G2"))).toEqual(["c"]);
    });

    it("writes a writable prop of a template item to the item path", () => {
      const view = renderSurface(
        ui,
        [
          gridOf({ componentId: "field", path: "/items" }),
          { id: "field", component: "TextField", value: { "@path": "name" } },
        ],
        { items: [{ name: "A" }, { name: "B" }] },
      );
      view.act(() => type(inputs(view.container)[1]!, "B2"));
      expect(view.dataAt("/items")).toEqual([{ name: "A" }, { name: "B2" }]);
      expect(inputs(view.container).map((input) => input.value)).toEqual([
        "A",
        "B2",
      ]);
    });

    it("gives an @index prop the item index plus the offset", () => {
      const view = renderSurface(
        ui,
        [
          gridOf({ componentId: "pos", path: "/items" }),
          {
            id: "pos",
            component: "Position",
            index: { "@call": "@index", args: { offset: 1 } },
          },
        ],
        { items: [{ name: "A" }, { name: "B" }] },
      );
      expect(texts(grid(view.container))).toEqual(["1", "2"]);
    });

    it("forwards the userMessage of an item, read from a relative @path", async () => {
      const view = renderSurface(
        ui,
        [
          gridOf({ componentId: "card", path: "/items" }),
          {
            id: "card",
            component: "Card",
            productId: "p1",
            name: "Plan",
            onPick: {
              event: { name: "pick", userMessage: { "@path": "note" } },
            },
          },
        ],
        { items: [{ note: "I pick A" }, { note: "I pick B" }] },
      );
      allByText(view.container, "pick p1")[1]!.click();
      await vi.waitFor(() => expect(view.forwardEvent).toHaveBeenCalled());
      expect(view.forwardEvent).toHaveBeenCalledExactlyOnceWith(
        {
          name: "pick",
          surfaceId: SURFACE_ID,
          componentId: "card",
          timestamp: expect.any(String),
          userMessage: "I pick B",
          context: { productId: "p1" },
        },
        "default",
      );
    });

    it.each([
      ["missing", undefined],
      ["empty", { items: [] }],
    ])("renders nothing for a %s list", (_label, data) => {
      const view = renderSurface(
        ui,
        [gridOf({ componentId: "row", path: "/items" }), label("row", "name")],
        data,
      );
      expect(grid(view.container).childElementCount).toBe(0);
    });

    it("cuts a cycle between two templates and keeps the other items", () => {
      const view = renderSurface(
        ui,
        [
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
          label("ok", "/items/0/name"),
        ],
        { items: [{ name: "A" }] },
      );
      // a, then b and a for item 0, then b again for item 0: the cycle.
      expect(alertText(view.container)).toContain("cyclic reference to b");
      expect(allByText(grid(view.container), "A")).toHaveLength(1);
    });
  });
});
