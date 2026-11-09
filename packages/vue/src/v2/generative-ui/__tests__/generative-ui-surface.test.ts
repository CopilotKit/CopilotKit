import { render, screen } from "@testing-library/vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSSRApp, defineComponent, h, nextTick, provide } from "vue";
import { renderToString } from "vue/server-renderer";
import { z } from "zod";
import type { GenerativeUISurfaceContent } from "@copilotkit/shared";
import type { AnyGenerativeUI } from "@copilotkit/shared/generative-ui";
import { CopilotKitCoreVue } from "../../lib/vue-core";
import { createGenerativeUI } from "../catalog";
import GenerativeUISurface from "../GenerativeUISurface.vue";
import { GenerativeUIRuntimeKey } from "../runtime-context";
import { useGenerativeUIRoot } from "../use-generative-ui-root";
import {
  createRuntimeProvider,
  createTestRuntime,
} from "./helpers/render-surface";

const Noop = defineComponent({ render: () => null });
const Row = defineComponent({
  props: { text: { type: String, required: true } },
  template: `<p data-testid="row">{{ text }}</p>`,
});
const ui = createGenerativeUI({
  id: "shop",
  components: {
    ProductRow: { component: Noop, slots: { children: "multiple" } },
    ProductCard: { component: Noop },
    Row: { component: Row, props: z.object({ text: z.string() }) },
  },
});

/**
 * Renders a surface whose `components` is a new array on every render.
 * `surfaceUI` is the ui prop, the provider's UI by default.
 */
function renderSurface(
  components: readonly string[],
  surfaceUI: AnyGenerativeUI = ui,
) {
  const { runtime } = createTestRuntime(ui);
  const Provider = createRuntimeProvider(runtime);
  const Host = defineComponent({
    components: { Provider, GenerativeUISurface },
    // `renders` is read in the slot, so each rerender renders the surface
    // again with a new `components` array.
    props: { renders: { type: Number, default: 0 } },
    setup: () => ({ surfaceUI, components }),
    template: `
      <Provider>
        <GenerativeUISurface
          id="products"
          :ui="surfaceUI"
          :components="[...components]"
          :data-renders="renders"
        />
      </Provider>
    `,
  });
  const utils = render(Host);
  let renders = 0;
  return {
    runtime,
    unmount: utils.unmount,
    rerender: () => utils.rerender({ renders: ++renders }),
  };
}

/** The content of surface `surfaceId` in `target`, with `status`. */
function surfaceContent(
  surfaceId: string,
  target: string,
  status: "streaming" | "ready",
): GenerativeUISurfaceContent {
  return {
    surfaceId,
    target,
    catalogId: "shop",
    operations: [
      { version: "1.0", createSurface: { surfaceId, catalogId: "shop" } },
      {
        version: "1.0",
        updateComponents: {
          surfaceId,
          components: [{ id: "root", component: "Row", text: "Hi" }],
        },
      },
    ],
    status,
    rejected: [],
  };
}

/** Renders `<GenerativeUISurface id="products">` with a fallback, in thread t1. */
function renderTarget(attrs: Record<string, unknown> = {}) {
  const { runtime } = createTestRuntime(ui);
  runtime.manager.setActiveThread("t1");
  const Provider = createRuntimeProvider(runtime);
  const Host = defineComponent({
    components: { Provider, GenerativeUISurface },
    setup: () => ({ attrs }),
    template: `
      <Provider>
        <GenerativeUISurface id="products" v-bind="attrs">
          <span>No products yet</span>
        </GenerativeUISurface>
      </Provider>
    `,
  });
  const utils = render(Host);
  /** Ingests the content of surface s1 for "products", then lets Vue flush. */
  const ingest = (status: "streaming" | "ready") => {
    runtime.manager.ingest(
      "t1",
      "default",
      surfaceContent("s1", "products", status),
    );
    return nextTick();
  };
  return { runtime, ingest, unmount: utils.unmount };
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

  it("ignores a name that is not in the UI and warns about it once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { runtime, rerender } = renderSurface(["ProductRow", "Banner"]);
    await rerender();
    await rerender();
    expect(runtime.manager.getMountedTargets()).toEqual([
      { id: "products", components: ["ProductRow"] },
    ]);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      '[generativeUI] <GenerativeUISurface id="products">: these components are not in the UI and are ignored: Banner.',
    );
  });

  it("warns once when the ui prop is not the UI of the provider", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const otherUI = createGenerativeUI({
      id: "other",
      components: { ProductCard: { component: Noop } },
    });
    const { runtime, rerender } = renderSurface(["ProductCard"], otherUI);
    await rerender();
    expect(runtime.manager.getMountedTargets()).toEqual([
      { id: "products", components: ["ProductCard"] },
    ]);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      '[generativeUI] <GenerativeUISurface id="products">: the ui prop is not the UI of the provider (generativeUI.ui). The components are checked against the UI of the provider.',
    );
  });
});

describe("GenerativeUISurface autoScroll", () => {
  function setup({
    autoScroll,
    top = 2000,
  }: { autoScroll?: boolean; top?: number } = {}) {
    // jsdom has no layout and no scrollIntoView.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ y: top, height: 100 }),
    );
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    const { ingest } = renderTarget(
      autoScroll === undefined ? {} : { autoScroll },
    );
    return { scrollIntoView, ingest };
  }

  it("scrolls to the surface once each time a generation starts", async () => {
    const { scrollIntoView, ingest } = setup();
    await ingest("streaming");
    await ingest("streaming");
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ block: "start" }),
    );
    // The next render_ui call on the same surface streams again.
    await ingest("ready");
    await ingest("streaming");
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it("does not scroll when the surface is already on screen", async () => {
    const { scrollIntoView, ingest } = setup({ top: 100 });
    await ingest("streaming");
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("does not scroll with autoScroll={false}", async () => {
    const { scrollIntoView, ingest } = setup({ autoScroll: false });
    await ingest("streaming");
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

// Ported from React's ssr.test.tsx. The Vue provider gets its
// `generativeUI` prop in a later change, so the root composable that the
// provider runs stands in for `<CopilotKitProvider :generative-ui>` here.
describe("generative UI server rendering", () => {
  it("renders the fallback of a GenerativeUISurface inside the provider", async () => {
    const copilotkit = new CopilotKitCoreVue({});
    const app = createSSRApp(
      defineComponent({
        setup() {
          provide(
            GenerativeUIRuntimeKey,
            useGenerativeUIRoot(copilotkit, () => ({ ui })),
          );
          return () =>
            h(GenerativeUISurface, { id: "x" }, () => h("span", "fb"));
        },
      }),
    );
    const html = await renderToString(app);
    expect(html).toContain("fb");
  });
});

describe("GenerativeUISurface (Vue-specific semantics)", () => {
  it("shows the fallback slot until a surface targets it, then the surface", async () => {
    const { ingest } = renderTarget();
    expect(screen.getByText("No products yet")).toBeTruthy();

    await ingest("ready");

    expect(screen.queryByText("No products yet")).toBeNull();
    expect(screen.getByTestId("row").textContent).toBe("Hi");
  });

  it("puts its attributes on the element around the surface", async () => {
    const { ingest } = renderTarget({ class: "products-surface" });

    await ingest("ready");

    const element = document.querySelector<HTMLElement>(
      '[data-generative-ui-surface="products"]',
    );
    expect(element?.className).toBe("products-surface");
  });

  it("registers the target with its description, and unregisters it on unmount", () => {
    const { runtime, unmount } = renderTarget({
      description: "The product list.",
    });
    expect(runtime.manager.getMountedTargets()).toEqual([
      { id: "products", description: "The product list." },
    ]);

    unmount();

    expect(runtime.manager.getMountedTargets()).toEqual([]);
  });
});
