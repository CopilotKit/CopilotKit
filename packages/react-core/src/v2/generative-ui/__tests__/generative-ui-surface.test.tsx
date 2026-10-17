import React from "react";
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGenerativeUI } from "../catalog";
import { createGenerativeUIDispatcher } from "../dispatcher";
import { GenerativeUISurface } from "../GenerativeUISurface";
import { GenerativeUIRuntimeContext } from "../runtime-context";
import type { GenerativeUIRuntime } from "../runtime-context";
import { GenerativeUISurfaceManager } from "../surface-manager";

const Noop = () => null;
const ui = createGenerativeUI({
  id: "shop",
  components: {
    ProductRow: { component: Noop, slots: { children: "multiple" } },
    ProductCard: { component: Noop },
  },
});

function createRuntime() {
  const runtime: GenerativeUIRuntime = {
    manager: new GenerativeUISurfaceManager(ui),
    ui,
    transport: "tool",
    config: { ui },
    reportError: vi.fn(),
    forwardEvent: vi.fn(async () => ({ ok: true as const, result: undefined })),
    dispatcher: createGenerativeUIDispatcher({
      getDeclared: () => ui.functions,
    }),
  };
  return runtime;
}

/** Renders a surface whose `components` is a new array on every render. */
function renderSurface(components: readonly string[]) {
  const runtime = createRuntime();
  const view = () => (
    <GenerativeUIRuntimeContext.Provider value={runtime}>
      <GenerativeUISurface id="products" components={[...components]} />
    </GenerativeUIRuntimeContext.Provider>
  );
  const utils = render(view());
  return { runtime, rerender: () => utils.rerender(view()) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GenerativeUISurface components", () => {
  it("registers the target with its list of components", () => {
    const { runtime } = renderSurface(["ProductRow", "ProductCard"]);
    expect(runtime.manager.getMountedTargets()).toEqual([
      { id: "products", components: ["ProductRow", "ProductCard"] },
    ]);
  });

  it("ignores a name that is not in the UI and warns about it once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { runtime, rerender } = renderSurface(["ProductRow", "Banner"]);
    rerender();
    rerender();
    expect(runtime.manager.getMountedTargets()).toEqual([
      { id: "products", components: ["ProductRow"] },
    ]);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      '[generativeUI] <GenerativeUISurface id="products">: these components are not in the UI and are ignored: Banner.',
    );
  });
});
