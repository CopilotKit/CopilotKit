import React from "react";
import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGenerativeUI } from "../catalog";
import type { GenerativeUI } from "../catalog";
import { createGenerativeUIDispatcher } from "@copilotkit/core/generative-ui";
import { GenerativeUISurface } from "../GenerativeUISurface";
import { GenerativeUIRuntimeContext } from "../runtime-context";
import type { GenerativeUIRuntime } from "../runtime-context";
import { GenerativeUISurfaceManager } from "@copilotkit/core/generative-ui";

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

/**
 * Renders a surface whose `components` is a new array on every render.
 * `surfaceUI` is the ui prop, the provider's UI by default.
 */
function renderSurface(
  components: readonly string[],
  surfaceUI: GenerativeUI<any> = ui,
) {
  const runtime = createRuntime();
  const view = () => (
    <GenerativeUIRuntimeContext.Provider value={runtime}>
      <GenerativeUISurface
        id="products"
        ui={surfaceUI}
        components={[...components]}
      />
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

  it("warns once when the ui prop is not the UI of the provider", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const otherUI = createGenerativeUI({
      id: "other",
      components: { ProductCard: { component: Noop } },
    });
    const { runtime, rerender } = renderSurface(["ProductCard"], otherUI);
    rerender();
    expect(runtime.manager.getMountedTargets()).toEqual([
      { id: "products", components: ["ProductCard"] },
    ]);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      '[generativeUI] <GenerativeUISurface id="products">: the ui prop is not the UI of the provider (generativeUI.ui). The components are checked against the UI of the provider.',
    );
  });
});

describe("GenerativeUISurface autoScroll", () => {
  /** The content of surface s1 in the "products" target, with `status`. */
  const content = (status: "streaming" | "ready") => ({
    surfaceId: "s1",
    target: "products",
    catalogId: "shop",
    operations: [
      {
        version: "1.0" as const,
        createSurface: { surfaceId: "s1", catalogId: "shop" },
      },
    ],
    status,
    rejected: [],
  });

  function setup({
    autoScroll,
    top = 2000,
  }: { autoScroll?: boolean; top?: number } = {}) {
    // jsdom has no layout and no scrollIntoView.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      top,
      bottom: top + 100,
    } as DOMRect);
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    const runtime = createRuntime();
    runtime.manager.setActiveThread("t1");
    render(
      <GenerativeUIRuntimeContext.Provider value={runtime}>
        <GenerativeUISurface id="products" autoScroll={autoScroll} />
      </GenerativeUIRuntimeContext.Provider>,
    );
    const ingest = (status: "streaming" | "ready") =>
      act(() => runtime.manager.ingest("t1", "default", content(status)));
    return { scrollIntoView, ingest };
  }

  it("scrolls to the surface once each time a generation starts", () => {
    const { scrollIntoView, ingest } = setup();
    ingest("streaming");
    ingest("streaming");
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ block: "start" }),
    );
    // The next render_ui call on the same surface streams again.
    ingest("ready");
    ingest("streaming");
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it("does not scroll when the surface is already on screen", () => {
    const { scrollIntoView, ingest } = setup({ top: 100 });
    ingest("streaming");
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("does not scroll with autoScroll={false}", () => {
    const { scrollIntoView, ingest } = setup({ autoScroll: false });
    ingest("streaming");
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

function Broken(): React.ReactNode {
  throw new Error("card exploded");
}
const failing = createGenerativeUI({
  id: "failing",
  components: { Broken: { component: Broken } },
});
/** Surface `surfaceId` in the "panel" target, whose root always throws. */
const failingContent = (surfaceId: string, extra = 0) => ({
  surfaceId,
  target: "panel",
  catalogId: "failing",
  operations: [
    {
      version: "1.0" as const,
      createSurface: { surfaceId, catalogId: "failing" },
    },
    ...Array.from({ length: extra + 1 }, () => ({
      version: "1.0" as const,
      updateComponents: {
        surfaceId,
        components: [{ id: "root", component: "Broken" }],
      },
    })),
  ],
  status: "streaming" as const,
  rejected: [],
});

describe("GenerativeUISurface failure reports", () => {
  function setup() {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reportError = vi.fn();
    const runtime: GenerativeUIRuntime = {
      manager: new GenerativeUISurfaceManager(failing),
      ui: failing,
      transport: "tool",
      config: { ui: failing },
      reportError,
      forwardEvent: vi.fn(async () => ({
        ok: true as const,
        result: undefined,
      })),
      dispatcher: createGenerativeUIDispatcher({
        getDeclared: () => failing.functions,
      }),
    };
    runtime.manager.setActiveThread("t1");
    const { container } = render(
      <React.StrictMode>
        <GenerativeUIRuntimeContext.Provider value={runtime}>
          <GenerativeUISurface id="panel" />
        </GenerativeUIRuntimeContext.Provider>
      </React.StrictMode>,
    );
    const ingest = (surfaceId: string, extra?: number) =>
      act(() =>
        runtime.manager.ingest(
          "t1",
          "default",
          failingContent(surfaceId, extra),
        ),
      );
    const surfaceIds = () =>
      reportError.mock.calls.map(([info]) => info.surfaceId);
    return { container, ingest, surfaceIds };
  }

  it("reports the same failure of a new surface in the same target", () => {
    const { container, ingest, surfaceIds } = setup();
    ingest("s1");
    expect(surfaceIds()).toEqual(["s1"]);
    const target = container.querySelector(
      '[data-generative-ui-surface="panel"]',
    );
    ingest("s2");
    expect(surfaceIds()).toEqual(["s1", "s2"]);
    // The surface is replaced in place: the target element stays.
    expect(
      container.querySelector('[data-generative-ui-surface="panel"]'),
    ).toBe(target);
  });

  it("reports the same failure once across revisions of one surface", () => {
    const { ingest, surfaceIds } = setup();
    ingest("s1");
    ingest("s1", 1);
    ingest("s1", 2);
    expect(surfaceIds()).toEqual(["s1"]);
  });
});
