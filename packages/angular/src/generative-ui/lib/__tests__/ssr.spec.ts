// The specs run under jsdom; a server PLATFORM_ID puts the components on
// their server paths, where nothing may reach the browser APIs.
import { Component, PLATFORM_ID, model } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { provideCopilotKit } from "@copilotkit/angular";
import { createGenerativeUI } from "../catalog";
import { provideGenerativeUI } from "../provide";
import { standardUI } from "../standard";
import {
  GENERATIVE_UI_CHART_LOADER,
  GENERATIVE_UI_MAP_LOADER,
} from "../standard/loaders";
import { CopilotGenerativeUISurface } from "../surface";
import { renderSurface } from "./render";

@Component({
  selector: "test-email",
  template: `
    <span data-email>email:{{ email() }}</span>
  `,
})
class Email {
  readonly email = model<string>();
}

const ui = createGenerativeUI({
  id: "shop",
  extends: [standardUI],
  components: {
    Email: {
      component: Email,
      props: z.object({ email: z.string() }),
      writable: ["email"],
    },
  },
});

@Component({
  imports: [CopilotGenerativeUISurface],
  template: `
    <copilot-generative-ui-surface id="x"
      ><span>fb</span></copilot-generative-ui-surface
    >
  `,
})
class Host {}

/** A browser observer that the server render must not construct. */
const forbidden = (name: string) =>
  class {
    constructor() {
      throw new Error(`${name} must not run on the server`);
    }
  };

describe("generative UI server rendering", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  it("renders the fallback of a GenerativeUISurface inside the provider", () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: "server" },
        provideCopilotKit({ runtimeUrl: "https://example.com" }),
        provideGenerativeUI({ ui }),
      ],
    });
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain("fb");
  });

  it("renders an existing surface (component model, properties and writable props) without throwing", () => {
    vi.stubGlobal("MutationObserver", forbidden("MutationObserver"));
    vi.stubGlobal("ResizeObserver", forbidden("ResizeObserver"));
    vi.stubGlobal("IntersectionObserver", forbidden("IntersectionObserver"));
    const chartLoader = vi.fn(() => Promise.reject(new Error("no chart")));
    const mapLoader = vi.fn(() => Promise.reject(new Error("no map")));
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: "server" },
        { provide: GENERATIVE_UI_CHART_LOADER, useValue: chartLoader },
        { provide: GENERATIVE_UI_MAP_LOADER, useValue: mapLoader },
      ],
    });
    const view = renderSurface(ui, [
      { id: "root", component: "Column", children: ["email", "chart", "map"] },
      { id: "email", component: "Email", email: "a@x.io" },
      {
        id: "chart",
        component: "Chart",
        xKey: "month",
        data: [{ month: "Jan", cost: 290 }],
        series: [{ key: "cost", label: "Cost" }],
      },
      {
        id: "map",
        component: "Map",
        markers: [{ label: "Vienna", lat: 48.2, lng: 16.37 }],
      },
    ]);
    expect(view.container.querySelector("[data-email]")?.textContent).toBe(
      "email:a@x.io",
    );
    // Chart and Map do not load their libraries on the server: the chart is
    // its table, the map its list of places.
    expect(chartLoader).not.toHaveBeenCalled();
    expect(mapLoader).not.toHaveBeenCalled();
    expect(view.container.querySelector("table:not([hidden])")).not.toBeNull();
    const places = view.container.querySelector(".a2ui-std-map-places")!;
    expect(places.hasAttribute("data-collapsed")).toBe(false);
    expect(places.textContent).toContain("Vienna");
    expect(view.reportError).not.toHaveBeenCalled();
  });
});
