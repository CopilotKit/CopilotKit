import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { invokeBoundEvent } from "@copilotkit/core/generative-ui";
import { SURFACE_ID, THREAD_ID, renderSurface } from "./render";
import {
  alertText,
  alerts,
  byText,
  cartWith,
  probes,
  text,
  ui,
} from "./surface-view.helpers";

// Bound props, matched events and invokeBoundEvent of the surface view. The
// rest is in surface-view.spec.ts.

describe("CopilotGenerativeUISurfaceView", () => {
  afterEach(() => {
    probes.bombArmed = false;
    probes.race = undefined;
    probes.quickAdd = undefined;
  });

  describe("bound props", () => {
    it("updates a name-bound prop when the state changes, and drops it on unmount", () => {
      const view = renderSurface(ui, [{ id: "root", component: "Badge" }]);
      view.act(() => view.runtime.manager.setState("count", 1));
      expect(text(view.container, "[data-badge]")).toBe("1");
      view.act(() => view.runtime.manager.setState("count", 5));
      expect(text(view.container, "[data-badge]")).toBe("5");
      view.act(() => view.runtime.manager.removeState("count"));
      expect(alertText(view.container)).toMatch(/count/);
    });

    it("shows the fallback for a required bound prop until its state is set", () => {
      const view = renderSurface(ui, [{ id: "root", component: "Badge" }]);
      expect(alertText(view.container)).toMatch(/count/);
      expect(view.reportError).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "props", componentId: "root" }),
      );
      view.act(() => view.runtime.manager.setState("count", 3));
      expect(alerts(view.container)).toHaveLength(0);
      expect(text(view.container, "[data-badge]")).toBe("3");
    });

    it("ignores model values for bound props and bindings for matched events", async () => {
      const handler = vi.fn();
      const view = renderSurface(ui, [
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
      ]);
      view.runtime.dispatcher.register("addToCart", { current: handler });
      view.act(() => {
        view.runtime.manager.setState("count", 2);
        view.runtime.manager.setState(
          "cart",
          cartWith({ productId: "p1", quantity: 4 }),
        );
      });
      expect(
        view.runtime.manager.getSurface(THREAD_ID, SURFACE_ID)!.clientRejected,
      ).toEqual([]);
      expect(text(view.container, "[data-badge]")).toBe("2");
      expect(text(view.container, '[data-in-cart="p1"]')).toBe("4");
      byText(view.container, "buy p1")[0]!.click();
      await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
      expect(view.forwardEvent).not.toHaveBeenCalled();
    });

    it("passes the model's props to a (state, props) selector", () => {
      const view = renderSurface(ui, [
        { id: "root", component: "Grid", children: ["p1", "p2"] },
        { id: "p1", component: "ProductCard", productId: "p1", name: "A" },
        { id: "p2", component: "ProductCard", productId: "p2", name: "B" },
      ]);
      view.act(() =>
        view.runtime.manager.setState(
          "cart",
          cartWith({ productId: "p1", quantity: 2 }),
        ),
      );
      expect(text(view.container, '[data-in-cart="p1"]')).toBe("2");
      expect(text(view.container, '[data-in-cart="p2"]')).toBe("0");
    });

    it("shows the fallback and reports a props error when a selector throws", () => {
      const view = renderSurface(ui, [{ id: "root", component: "Broken" }]);
      expect(alertText(view.container)).toContain("selector exploded");
      expect(view.reportError).toHaveBeenCalledWith(
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
      const view = renderSurface(ui, [{ id: "root", component: "Badge" }]);
      view.act(() => {
        view.runtime.manager.setState("count", 2);
        view.runtime.manager.setState("cart", cartWith());
      });
      expect(text(view.container, "[data-badge]")).toBe("2");
      const before = probes.badgeRenders;

      view.act(() =>
        view.runtime.manager.setState(
          "cart",
          cartWith({ productId: "a", quantity: 1 }),
        ),
      );

      expect(probes.badgeRenders).toBe(before);
      expect(text(view.container, "[data-badge]")).toBe("2");
    });

    it("does not loop on a selector that returns a new array, and re-renders only on state changes", () => {
      const errors = vi.spyOn(console, "error");
      try {
        const view = renderSurface(ui, [{ id: "root", component: "CartIds" }]);
        const { manager } = view.runtime;
        view.act(() =>
          manager.setState("cart", cartWith({ productId: "a", quantity: 1 })),
        );
        expect(text(view.container, "[data-cart-ids]")).toBe("a");
        const before = probes.cartIdsRenders;

        // A manager change that is not a state change.
        view.act(() => manager.registerTarget("elsewhere"));
        expect(probes.cartIdsRenders).toBe(before);

        view.act(() =>
          manager.setState(
            "cart",
            cartWith(
              { productId: "a", quantity: 1 },
              { productId: "b", quantity: 1 },
            ),
          ),
        );
        expect(text(view.container, "[data-cart-ids]")).toBe("a,b");
        expect(probes.cartIdsRenders).toBe(before + 1);
        expect(errors).not.toHaveBeenCalled();
      } finally {
        errors.mockRestore();
      }
    });
  });

  describe("matched events", () => {
    it("calls the function with its defaults when the event has no parameters", async () => {
      const handler = vi.fn();
      const view = renderSurface(ui, [
        { id: "root", component: "ProductCard", productId: "p1", name: "Mug" },
      ]);
      view.runtime.dispatcher.register("addToCart", { current: handler });
      view.act(() => view.runtime.manager.setState("cart", cartWith()));
      byText(view.container, "buy p1")[0]!.click();
      await vi.waitFor(() => expect(handler).toHaveBeenCalled());
      expect(handler).toHaveBeenCalledExactlyOnceWith({
        productId: "p1",
        quantity: 1,
      });
    });

    it("checks the args with the event parameters, then with the function parameters", async () => {
      const handler = vi.fn(() => "added");
      const view = renderSurface(ui, [{ id: "root", component: "QuickAdd" }]);
      view.runtime.dispatcher.register("addToCart", { current: handler });

      const tooShort = await probes.quickAdd!({ productId: "p", quantity: 1 });
      expect(!tooShort.ok && tooShort.error.code).toBe("invalid_event_args");

      const tooMany = await probes.quickAdd!({
        productId: "p123",
        quantity: 50,
      });
      expect(!tooMany.ok && tooMany.error.code).toBe("invalid_arguments");

      const valid = await probes.quickAdd!({ productId: "p123", quantity: 2 });
      expect(valid).toEqual({ ok: true, result: "added" });
      expect(handler).toHaveBeenCalledExactlyOnceWith({
        productId: "p123",
        quantity: 2,
      });
    });
  });

  describe("invokeBoundEvent never rejects", () => {
    const parameters = z.object({ productId: z.string() });
    const surface = () => {
      const view = renderSurface(ui, [
        { id: "root", component: "Text", label: "x" },
      ]);
      return {
        runtime: view.runtime,
        reportError: view.reportError,
        forwardEvent: view.forwardEvent,
        surface: view.runtime.manager.getSurface(THREAD_ID, SURFACE_ID)!,
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
