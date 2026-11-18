import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGenerativeUIDispatcher,
  GenerativeUISurfaceManager,
} from "@copilotkit/core/generative-ui";
import type { MapMarker } from "@copilotkit/shared/generative-ui";
import { loadMapLibre } from "../../map";
import { GenerativeUIRuntimeContext } from "../../runtime-context";
import type {
  GenerativeUILibraryLoader,
  GenerativeUIRuntime,
} from "../../runtime-context";
import { standardUI } from "../index";
import { MapView } from "../Map";
import { renderSurface } from "./render";

// maplibre-gl is the boundary: the `/map` entry imports it, and this fake
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
    isRemoved = false;
    constructor(public options: { center: [number, number]; zoom: number }) {
      if (state.isWebGLMissing) throw new Error("WebGL is not supported");
      state.maps.push(this);
    }
    setStyle(style: string) {
      this.style = style;
    }
    on() {}
    fitBounds() {}
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
const graz: MapMarker = { label: "Graz", lat: 47.07, lng: 15.44 };

beforeEach(() => {
  maplibre.state.maps = [];
  maplibre.state.isWebGLMissing = false;
});

/** Renders a Map of Vienna and Graz, bound to `/city`, with the `map` loader. */
function renderMap(map?: GenerativeUILibraryLoader) {
  return renderSurface(
    standardUI,
    [
      {
        id: "root",
        component: "Map",
        markers: [vienna, graz],
        selected: { "@path": "/city" },
      },
    ],
    { city: "Vienna" },
    { map },
  );
}

type MapRender = ReturnType<typeof renderMap>;

const statusOf = (view: MapRender) =>
  view.container
    .querySelector("[data-a2ui-map]")
    ?.getAttribute("data-a2ui-map");

async function waitForStatus(view: MapRender, status: "ready" | "fallback") {
  await waitFor(() => expect(statusOf(view)).toBe(status));
}

const places = (view: MapRender) =>
  view.getByRole("list", { name: "Map places" });

/** A runtime whose config has the `map` loader, for a bare MapView. */
function createRuntime(map?: GenerativeUILibraryLoader): GenerativeUIRuntime {
  return {
    manager: new GenerativeUISurfaceManager(standardUI),
    ui: standardUI,
    transport: "tool",
    config: { ui: standardUI, map },
    reportError: vi.fn(),
    forwardEvent: vi.fn(),
    dispatcher: createGenerativeUIDispatcher({
      getDeclared: () => standardUI.functions,
    }),
  };
}

function mapElement(runtime: GenerativeUIRuntime) {
  return (
    <GenerativeUIRuntimeContext.Provider value={runtime}>
      <MapView markers={[vienna]} setSelected={() => {}} />
    </GenerativeUIRuntimeContext.Provider>
  );
}

describe("Map without the map loader", () => {
  it("renders the list of places on the server, so the client render matches", () => {
    const html = renderToString(mapElement(createRuntime()));
    expect(html).toContain('data-a2ui-map="fallback"');
    expect(html).toContain("Vienna");
  });
});

describe("Map with loadMapLibre from /generative-ui/map", () => {
  it("draws a map with the default style and a pin for each place, and collapses the list", async () => {
    const view = renderMap(loadMapLibre);
    await waitForStatus(view, "ready");
    expect(maplibre.state.maps).toHaveLength(1);
    const map = maplibre.state.maps[0]!;
    expect(map.style).toBe("https://tiles.openfreemap.org/styles/positron");
    expect(map.options.center).toEqual([16.37, 48.2]);
    expect(map.pins.map((pin) => [pin.position, pin.popup.text])).toEqual([
      [[16.37, 48.2], "Vienna"],
      [[15.44, 47.07], "Graz"],
    ]);
    expect(places(view).hasAttribute("data-collapsed")).toBe(true);
  });

  it("writes the bound path when the user clicks a pin", async () => {
    const view = renderMap(loadMapLibre);
    await waitForStatus(view, "ready");
    const grazPin = maplibre.state.maps[0]!.pins[1]!;
    await act(async () => {
      fireEvent.click(grazPin.element);
    });
    expect(view.dataAt("/city")).toBe("Graz");
  });

  it("removes the map when it unmounts", async () => {
    const view = renderMap(loadMapLibre);
    await waitForStatus(view, "ready");
    view.unmount();
    expect(maplibre.state.maps[0]!.isRemoved).toBe(true);
  });

  it("shows the list of places when there is no WebGL", async () => {
    maplibre.state.isWebGLMissing = true;
    const view = renderMap(loadMapLibre);
    await waitForStatus(view, "fallback");
    expect(places(view).hasAttribute("data-collapsed")).toBe(false);
  });
});

describe("Map with a custom map loader", () => {
  it("draws with a module that has its exports at the top level", async () => {
    const view = renderMap(async () => maplibre.module);
    await waitForStatus(view, "ready");
    expect(maplibre.state.maps).toHaveLength(1);
  });

  it("shows the list of places when the loader rejects", async () => {
    const view = renderMap(() =>
      Promise.reject(new Error("Cannot find package 'maplibre-gl'")),
    );
    await waitForStatus(view, "fallback");
    expect(view.getByRole("button", { name: /Graz/ })).toBeTruthy();
  });

  it("shows the list of places when the loader gives another module", async () => {
    const view = renderMap(async () => ({ default: {} }));
    await waitForStatus(view, "fallback");
    expect(maplibre.state.maps).toHaveLength(0);
  });

  it("does not draw the map again when the provider passes a new inline loader", async () => {
    const view = render(mapElement(createRuntime(async () => maplibre.module)));
    await waitFor(() => expect(maplibre.state.maps).toHaveLength(1));
    view.rerender(mapElement(createRuntime(async () => maplibre.module)));
    // The rerender settles any effect it starts before this check.
    await act(async () => {});
    expect(maplibre.state.maps).toHaveLength(1);
    expect(maplibre.state.maps[0]!.isRemoved).toBe(false);
  });
});
