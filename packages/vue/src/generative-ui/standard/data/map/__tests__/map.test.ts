import { fireEvent, render, screen, waitFor } from "@testing-library/vue";
import { defineComponent, h, provide, toRef } from "vue";
import type { App, Plugin } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGenerativeUIDispatcher,
  GenerativeUISurfaceManager,
} from "@copilotkit/core/generative-ui";
import type {
  AnyGenerativeUI,
  GenerativeUITheme,
  MapMarker,
} from "@copilotkit/shared/generative-ui";
import { GenerativeUIMap } from "../../../../../generative-ui-map";
import { createGenerativeUI } from "../../../../catalog";
import { GenerativeUIRuntimeKey } from "../../../../runtime-context";
import type { GenerativeUIRuntime } from "../../../../runtime-context";
import { GENERATIVE_UI_MAP_LOADER } from "../../../loaders";
import CopilotGenerativeUIMap from "../Map.vue";

// maplibre-gl is the boundary: the `/map` plugin imports it, and this fake
// records what the component asks the library to draw. jsdom has no WebGL.
const maplibre = vi.hoisted(() => {
  const state = {
    maps: [] as FakeMap[],
    /** The next `new Map()` throws, as it does without WebGL. */
    isWebGLMissing: false,
  };

  class FakePopup {
    text = "";
    setText(text: string) {
      this.text = text;
      return this;
    }
  }

  class FakeMarker {
    position: [number, number] = [0, 0];
    popup = new FakePopup();
    element = document.createElement("div");
    setLngLat(position: [number, number]) {
      this.position = position;
      return this;
    }
    setPopup(popup: FakePopup) {
      this.popup = popup;
      return this;
    }
    addTo(map: FakeMap) {
      map.pins.push(this);
      return this;
    }
    getElement() {
      return this.element;
    }
  }

  class FakeMap {
    style = "";
    pins: FakeMarker[] = [];
    sources = new Map<string, Record<string, unknown>>();
    layers: Record<string, unknown>[] = [];
    isRemoved = false;
    handlers: { event: string; handler: () => void }[] = [];
    constructor(public options: Record<string, unknown>) {
      if (state.isWebGLMissing) throw new Error("WebGL is not supported");
      state.maps.push(this);
    }
    setStyle(style: string) {
      this.style = style;
    }
    on(event: string, handler: () => void) {
      this.handlers.push({ event, handler });
    }
    emit(event: string) {
      const handlers = this.handlers.filter((entry) => entry.event === event);
      for (const entry of handlers) entry.handler();
    }
    fitBounds() {}
    getSource(id: string) {
      return this.sources.get(id);
    }
    addSource(id: string, source: Record<string, unknown>) {
      this.sources.set(id, source);
    }
    addLayer(layer: Record<string, unknown>) {
      this.layers.push(layer);
    }
    remove() {
      this.isRemoved = true;
    }
  }

  class FakeBounds {
    extend() {}
  }

  return {
    state,
    module: {
      Map: FakeMap,
      Marker: FakeMarker,
      Popup: FakePopup,
      LngLatBounds: FakeBounds,
    },
  };
});

// maplibre-gl is a UMD bundle; bundlers put its exports on `default`.
vi.mock("maplibre-gl", () => ({ default: maplibre.module }));

const vienna: MapMarker = { label: "Vienna", lat: 48.2, lng: 16.37 };
const graz: MapMarker = {
  label: "Graz",
  lat: 47.07,
  lng: 15.44,
  category: "City",
};
const linz: MapMarker = { label: "Linz", lat: 48.31, lng: 14.29 };

const LIGHT_STYLE = "https://tiles.openfreemap.org/styles/positron";

beforeEach(() => {
  maplibre.state.maps = [];
  maplibre.state.isWebGLMissing = false;
});

afterEach(() => {
  document.documentElement.classList.remove("dark");
});

const mapElement = () => document.querySelector("[data-a2ui-map]");
const places = () =>
  document.querySelector<HTMLElement>('[aria-label="Map places"]');
const placeButtons = () => screen.getAllByRole("button");
const lastMap = () => maplibre.state.maps.at(-1);

/** Waits until the component shows `status` in `data-a2ui-map`. */
async function waitForStatus(status: "ready" | "fallback") {
  await waitFor(() =>
    expect(mapElement()?.getAttribute("data-a2ui-map")).toBe(status),
  );
}

/** Provides a map loader that rejects, as an import of a missing package. */
const failingMapLoader: Plugin = {
  install: (app: App) =>
    app.provide(GENERATIVE_UI_MAP_LOADER, () =>
      Promise.reject(new Error("Cannot find package 'maplibre-gl'")),
    ),
};

function renderMap(
  props: InstanceType<typeof CopilotGenerativeUIMap>["$props"],
  plugins: Plugin[] = [GenerativeUIMap],
) {
  return render(CopilotGenerativeUIMap, { props, global: { plugins } });
}

/** A runtime with only a theme, as the provider gives its children. */
function createRuntime(theme: GenerativeUITheme): GenerativeUIRuntime {
  const ui = createGenerativeUI({ id: "map", components: {} });
  // The engine's `ui` type takes function and class components only.
  const engineUI: AnyGenerativeUI = ui;
  return {
    manager: new GenerativeUISurfaceManager(engineUI),
    ui,
    transport: "tool",
    config: { ui, theme },
    theme,
    reportError: vi.fn(),
    forwardEvent: vi.fn(),
    dispatcher: createGenerativeUIDispatcher({
      getDeclared: () => ui.functions,
    }),
  };
}

describe("Map", () => {
  it("shows a list of places when maplibre-gl is not provided, and a pick writes the bound path", async () => {
    const view = renderMap({ markers: [vienna, graz], selected: "Vienna" }, []);
    expect(document.querySelector('[data-a2ui-map="fallback"]')).not.toBeNull();
    expect(places()!.hasAttribute("data-collapsed")).toBe(false);
    const [viennaButton, grazButton] = placeButtons();
    expect(viennaButton!.getAttribute("aria-pressed")).toBe("true");
    expect(grazButton!.textContent?.replace(/\s+/g, " ").trim()).toBe(
      "Graz 47.0700, 15.4400 · City",
    );
    await fireEvent.click(grazButton!);
    expect(view.emitted("update:selected")).toEqual([["Graz"]]);
    expect(grazButton!.getAttribute("aria-pressed")).toBe("true");
    expect(viennaButton!.getAttribute("aria-pressed")).toBe("false");
  });

  it("gives the map and its list of places the height in pixels", () => {
    renderMap({ markers: [vienna], height: 300 }, []);
    const canvasHost =
      mapElement()!.querySelector<HTMLElement>("[aria-hidden]")!;
    expect(canvasHost.style.height).toBe("300px");
    expect(places()!.style.maxHeight).toBe("300px");
  });
});

describe("Map (Vue-specific semantics)", () => {
  it("draws a MapLibre map with the default style and a pin for each place, and collapses the list", async () => {
    renderMap({ markers: [vienna, graz] });
    await waitForStatus("ready");
    expect(maplibre.state.maps).toHaveLength(1);
    const map = lastMap()!;
    expect(map.style).toBe(LIGHT_STYLE);
    expect(map.options).toMatchObject({ center: [16.37, 48.2], zoom: 1 });
    expect(map.pins.map((pin) => [pin.position, pin.popup.text])).toEqual([
      [[16.37, 48.2], "Vienna"],
      [[15.44, 47.07], "Graz"],
    ]);
    expect(places()!.hasAttribute("data-collapsed")).toBe(true);
  });

  it("starts at the center and zoom of the props", async () => {
    renderMap({ markers: [vienna], center: { lat: 47, lng: 13 }, zoom: 6 });
    await waitForStatus("ready");
    expect(lastMap()!.options).toMatchObject({ center: [13, 47], zoom: 6 });
  });

  it("sets selected when the user clicks a pin", async () => {
    const view = renderMap({ markers: [vienna, graz] });
    await waitForStatus("ready");
    await fireEvent.click(lastMap()!.pins[1]!.element);
    expect(view.emitted("update:selected")).toEqual([["Graz"]]);
  });

  it("draws a line through the markers when the map loads, with route set", async () => {
    renderMap({ markers: [vienna, graz, linz], route: true });
    await waitForStatus("ready");
    const map = lastMap()!;
    map.emit("load");
    expect(map.sources.get("a2ui-route")).toMatchObject({
      type: "geojson",
      data: {
        geometry: {
          type: "LineString",
          coordinates: [
            [16.37, 48.2],
            [15.44, 47.07],
            [14.29, 48.31],
          ],
        },
      },
    });
    expect(map.layers).toEqual([
      {
        id: "a2ui-route",
        type: "line",
        source: "a2ui-route",
        paint: { "line-color": "#0285ff", "line-width": 3 },
      },
    ]);
  });

  it("uses the theme map style, and the dark one when a dark class is added", async () => {
    const runtime = createRuntime({
      mapStyle: "https://example.com/light.json",
      dark: { mapStyle: "https://example.com/dark.json" },
    });
    const Host = defineComponent({
      setup() {
        provide(GenerativeUIRuntimeKey, toRef(runtime));
        return () => h(CopilotGenerativeUIMap, { markers: [vienna] });
      },
    });
    render(Host, { global: { plugins: [GenerativeUIMap] } });
    await waitForStatus("ready");
    const lightMap = lastMap()!;
    expect(lightMap.style).toBe("https://example.com/light.json");

    document.documentElement.classList.add("dark");
    await waitFor(() =>
      expect(lastMap()!.style).toBe("https://example.com/dark.json"),
    );
    expect(lightMap.isRemoved).toBe(true);
  });

  it("draws a new map when the markers change, and keeps it when the same markers arrive again", async () => {
    const view = renderMap({ markers: [vienna] });
    await waitForStatus("ready");
    const first = lastMap()!;

    await view.rerender({ markers: [{ ...vienna }] });
    expect(maplibre.state.maps).toHaveLength(1);

    await view.rerender({ markers: [vienna, linz] });
    expect(maplibre.state.maps).toHaveLength(2);
    expect(first.isRemoved).toBe(true);
    expect(lastMap()!.pins.map((pin) => pin.popup.text)).toEqual([
      "Vienna",
      "Linz",
    ]);
  });

  it("removes the map on unmount", async () => {
    const view = renderMap({ markers: [vienna] });
    await waitForStatus("ready");
    const map = lastMap()!;
    view.unmount();
    expect(map.isRemoved).toBe(true);
  });

  it("shows the list of places when maplibre-gl fails to load", async () => {
    renderMap({ markers: [vienna] }, [failingMapLoader]);
    await waitForStatus("fallback");
    expect(places()!.hasAttribute("data-collapsed")).toBe(false);
    expect(screen.getByRole("button", { name: /Vienna/ })).toBeTruthy();
  });

  it("shows the list of places when the map cannot be created", async () => {
    maplibre.state.isWebGLMissing = true;
    renderMap({ markers: [vienna] });
    await waitForStatus("fallback");
    expect(places()!.hasAttribute("data-collapsed")).toBe(false);
  });

  it("adds the map stylesheet once for all maps", () => {
    renderMap({ markers: [vienna] }, []);
    renderMap({ markers: [graz] }, []);
    expect(document.querySelectorAll("style#a2ui-standard-map")).toHaveLength(
      1,
    );
  });
});
