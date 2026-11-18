import { fireEvent, render, screen } from "@testing-library/vue";
import { defineComponent, h, ref } from "vue";
import type { App, PropType } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GenerativeUIAriaAttributes } from "@copilotkit/core/generative-ui";
import Lightbox from "../Lightbox.vue";
import type { LightboxImage } from "../Lightbox.vue";
import type { GenerativeUIEventProp } from "../context";
import { GENERATIVE_UI_CHART_LOADER, useGenerativeUILibrary } from "../loaders";
import type { GenerativeUILibraryLoader } from "../loaders";
import { useOverlayEscape } from "../overlay-stack";
import { useVisibleOnce } from "../visible-once";

// The shared pieces of the standard catalog. The component suites (Image,
// ImageGrid, Modal, containers, Chart) cover them again through the
// components; this file pins each piece on its own.

const lightbox = () => document.querySelector("[data-a2ui-lightbox]");
const shownSrc = () => lightbox()?.querySelector("img")?.getAttribute("src");

const pressEscape = () => fireEvent.keyDown(document, { key: "Escape" });

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---- useGenerativeUILibrary ----

const chartModule = { Chart: "chart.js" };

/** Shows the status of the chart library, and whether the module arrived. */
const ChartProbe = defineComponent({
  setup() {
    const { library, status } = useGenerativeUILibrary(
      GENERATIVE_UI_CHART_LOADER,
    );
    return () =>
      h(
        "p",
        `${status.value}, ${library.value === chartModule ? "module" : "no module"}`,
      );
  },
});

const TwoChartProbes = defineComponent({
  setup: () => () => [h(ChartProbe), h(ChartProbe)],
});

/** Provides `loader` the way the `/chart` plugin does. */
function withChartLoader(loader: GenerativeUILibraryLoader) {
  return {
    global: {
      plugins: [
        {
          install: (app: App) =>
            app.provide(GENERATIVE_UI_CHART_LOADER, loader),
        },
      ],
    },
  };
}

function deferred() {
  let resolve: (value: unknown) => void = () => {};
  const promise = new Promise<unknown>((done) => (resolve = done));
  return { promise, resolve };
}

describe("useGenerativeUILibrary", () => {
  it("reports none and loads nothing when the app provides no loader", () => {
    render(ChartProbe);
    expect(screen.getByText("none, no module")).toBeTruthy();
  });

  it("is loading until the loader resolves, then ready with the module", async () => {
    const pending = deferred();
    render(
      ChartProbe,
      withChartLoader(() => pending.promise),
    );
    expect(screen.getByText("loading, no module")).toBeTruthy();
    pending.resolve(chartModule);
    expect(await screen.findByText("ready, module")).toBeTruthy();
  });

  it("fails when the loader rejects", async () => {
    render(
      ChartProbe,
      withChartLoader(() => Promise.reject(new Error("offline"))),
    );
    expect(await screen.findByText("failed, no module")).toBeTruthy();
  });

  it("shares one import between the components that use the same loader", async () => {
    const loader = vi.fn(() => Promise.resolve(chartModule));
    render(TwoChartProbes, withChartLoader(loader));
    expect(await screen.findAllByText("ready, module")).toHaveLength(2);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("tries again in a component mounted after a failed import", async () => {
    const loader = vi
      .fn<GenerativeUILibraryLoader>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(chartModule);
    const first = render(ChartProbe, withChartLoader(loader));
    expect(await screen.findByText("failed, no module")).toBeTruthy();
    first.unmount();
    render(ChartProbe, withChartLoader(loader));
    expect(await screen.findByText("ready, module")).toBeTruthy();
  });
});

// ---- useOverlayEscape ----

/** An overlay that shows its name while open and closes itself on Escape. */
const Overlay = defineComponent({
  props: {
    name: { type: String, required: true },
    open: { type: Boolean, default: true },
  },
  setup(props) {
    const isClosed = ref(false);
    const isOpen = () => props.open && !isClosed.value;
    useOverlayEscape(isOpen, () => (isClosed.value = true));
    return () => (isOpen() ? h("p", props.name) : null);
  },
});

const renderOverlay = (name: string) => render(Overlay, { props: { name } });

const images: LightboxImage[] = [
  { src: "https://example.com/1.png", alt: "one" },
  { src: "https://example.com/2.png", alt: "two" },
  { src: "https://example.com/3.png", alt: "three" },
];

/** Shows a Lightbox the way Image does: `v-if`, until it emits `close`. */
function renderLightbox(props: {
  images: LightboxImage[];
  index?: number;
  aria?: GenerativeUIAriaAttributes;
}) {
  const Host = defineComponent({
    setup() {
      const isOpen = ref(true);
      return () =>
        isOpen.value
          ? h(Lightbox, { ...props, onClose: () => (isOpen.value = false) })
          : null;
    },
  });
  return render(Host);
}

describe("useOverlayEscape", () => {
  it("closes only the newest overlay on Escape", async () => {
    renderOverlay("first");
    renderOverlay("second");
    await pressEscape();
    expect(screen.queryByText("second")).toBeNull();
    expect(screen.getByText("first")).toBeTruthy();
    await pressEscape();
    expect(screen.queryByText("first")).toBeNull();
  });

  it("closes a lightbox above an open overlay first, then the overlay", async () => {
    renderOverlay("dialog");
    renderLightbox({ images: images.slice(0, 1) });
    expect(lightbox()).not.toBeNull();
    await pressEscape();
    expect(lightbox()).toBeNull();
    expect(screen.getByText("dialog")).toBeTruthy();
    await pressEscape();
    expect(screen.queryByText("dialog")).toBeNull();
  });

  it("leaves the stack when it is no longer open", async () => {
    renderOverlay("first");
    const second = renderOverlay("second");
    await second.rerender({ name: "second", open: false });
    await pressEscape();
    expect(screen.queryByText("first")).toBeNull();
  });

  it("leaves the stack when it unmounts", async () => {
    renderOverlay("first");
    renderOverlay("second").unmount();
    await pressEscape();
    expect(screen.queryByText("first")).toBeNull();
  });

  it("keeps the Escape that closes an overlay from reaching the window", async () => {
    const onWindowKey = vi.fn();
    window.addEventListener("keydown", onWindowKey);
    renderOverlay("first");
    await pressEscape();
    window.removeEventListener("keydown", onWindowKey);
    expect(onWindowKey).not.toHaveBeenCalled();
  });
});

// ---- useVisibleOnce ----

const Visible = defineComponent({
  props: {
    onVisible: { type: Function as PropType<GenerativeUIEventProp> },
  },
  setup(props) {
    const root = ref<HTMLElement | null>(null);
    useVisibleOnce(root, () => props.onVisible);
    return () => h("div", { ref: root }, "Hi");
  },
});

/** Replaces IntersectionObserver with one the test drives by hand. */
function stubIntersectionObserver() {
  const observer = {
    callback: null as
      | ((entries: Array<{ isIntersecting: boolean }>) => void)
      | null,
    observed: [] as Element[],
    disconnects: 0,
  };
  class FakeObserver {
    constructor(callback: typeof observer.callback) {
      observer.callback = callback;
    }
    observe(element: Element) {
      observer.observed.push(element);
    }
    disconnect() {
      observer.disconnects += 1;
    }
  }
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  return observer;
}

const seen = () =>
  vi.fn<GenerativeUIEventProp>(async () => ({ ok: true, result: null }));

describe("useVisibleOnce", () => {
  it("onVisible dispatches once when the container becomes visible", async () => {
    const observer = stubIntersectionObserver();
    const onVisible = seen();
    render(Visible, { props: { onVisible } });
    expect(observer.observed).toEqual([screen.getByText("Hi")]);
    observer.callback!([{ isIntersecting: true }]);
    observer.callback!([{ isIntersecting: true }]);
    expect(onVisible).toHaveBeenCalledTimes(1);
    expect(onVisible).toHaveBeenCalledWith({});
    expect(observer.disconnects).toBe(1);
  });

  it("waits while the element is out of view", () => {
    const observer = stubIntersectionObserver();
    const onVisible = seen();
    render(Visible, { props: { onVisible } });
    observer.callback!([{ isIntersecting: false }]);
    expect(onVisible).not.toHaveBeenCalled();
  });

  it("makes no observer while the event is not bound", () => {
    const observer = stubIntersectionObserver();
    render(Visible);
    expect(observer.callback).toBeNull();
  });

  it("does not send the event without IntersectionObserver", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const onVisible = seen();
    render(Visible, { props: { onVisible } });
    expect(screen.getByText("Hi")).toBeTruthy();
    expect(onVisible).not.toHaveBeenCalled();
  });

  it("stops observing when the component unmounts", () => {
    const observer = stubIntersectionObserver();
    render(Visible, { props: { onVisible: seen() } }).unmount();
    expect(observer.disconnects).toBe(1);
  });
});

// ---- Lightbox ----

describe("Lightbox", () => {
  it("shows the image full-screen as a modal dialog named by its alt text", () => {
    renderLightbox({ images: images.slice(0, 1) });
    const dialog = screen.getByRole("dialog", { name: "one" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(shownSrc()).toBe("https://example.com/1.png");
    expect(screen.queryByRole("button", { name: "Next image" })).toBeNull();
    expect(dialog.querySelector("[data-a2ui-lightbox-counter]")).toBeNull();
  });

  it("walks through all images with the arrows and keys", async () => {
    renderLightbox({ images, index: 1 });
    expect(shownSrc()).toBe("https://example.com/2.png");
    expect(lightbox()!.textContent).toContain("2 / 3");
    await fireEvent.click(
      lightbox()!.querySelector("[data-a2ui-lightbox-arrow=next]")!,
    );
    expect(shownSrc()).toBe("https://example.com/3.png");
    await fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(shownSrc()).toBe("https://example.com/1.png");
    await fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(shownSrc()).toBe("https://example.com/3.png");
    await pressEscape();
    expect(lightbox()).toBeNull();
  });

  it("closes on the close button, and not on an arrow", async () => {
    renderLightbox({ images });
    await fireEvent.click(screen.getByRole("button", { name: "Next image" }));
    expect(lightbox()).not.toBeNull();
    await fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(lightbox()).toBeNull();
  });

  it("closes on a click on the backdrop", async () => {
    renderLightbox({ images });
    await fireEvent.click(lightbox()!);
    expect(lightbox()).toBeNull();
  });

  it("moves the focus to the close button, and back to the trigger on close", async () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    renderLightbox({ images });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Close" }),
    );
    await pressEscape();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it("takes the hidden state and the live region of the envelope that opened it", () => {
    renderLightbox({
      images: images.slice(0, 1),
      aria: {
        "aria-label": "Photos",
        "aria-hidden": true,
        "aria-live": "polite",
      },
    });
    const dialog = lightbox()!;
    expect(dialog.getAttribute("aria-hidden")).toBe("true");
    expect(dialog.getAttribute("aria-live")).toBe("polite");
    expect(dialog.getAttribute("aria-label")).toBe("one");
  });
});
