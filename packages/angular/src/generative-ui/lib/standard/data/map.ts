import {
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  input,
  model,
  signal,
  untracked,
  viewChild,
} from "@angular/core";
import { isPlatformBrowser } from "@angular/common";
import {
  FONT_WEIGHT,
  backgroundColor,
  borderColor,
  radius,
  spacing,
  textColor,
  textFont,
} from "@copilotkit/shared/generative-ui";
import type { MapMarker, mapSchema } from "@copilotkit/shared/generative-ui";
import type { z } from "zod";
import { GENERATIVE_UI_RUNTIME } from "../../runtime";
import { GenerativeUIStyles } from "../../styles";
import { GENERATIVE_UI_MAP_LOADER } from "../loaders";
import { jsonEqual } from "../style";
import type { StyleMap } from "../style";

/**
 * The default basemap: the Positron style of OpenFreeMap. It is a keyless
 * OpenStreetMap vector style with streets and labels at city zoom. A host
 * sets another style with `theme: { mapStyle: "<style url>" }`, and a
 * dark one with `theme: { dark: { mapStyle: "<style url>" } }`.
 */
const DEFAULT_MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";
/** The default basemap in dark mode: the Dark style of OpenFreeMap. */
const DEFAULT_DARK_MAP_STYLE = "https://tiles.openfreemap.org/styles/dark";

const ORDERING_OPS = new Set(["<", "<=", ">", ">="]);

/**
 * A filter expression with every numeric comparison of a feature property
 * guarded by `["has", property]`.
 *
 * MapLibre adds a number assertion to `["get", key]` in a comparison with a
 * number. The assertion logs a warning for each feature without the
 * property. OpenFreeMap styles compare `ref_length` on roads that mostly do
 * not have it. The comparison is false for a missing property in both
 * cases, so the guard changes no result.
 */
export function guardNumericFilter(filter: unknown): unknown {
  if (!Array.isArray(filter)) return filter;
  const [op, left, right] = filter;
  const isPropertyComparison =
    typeof op === "string" &&
    ORDERING_OPS.has(op) &&
    Array.isArray(left) &&
    left[0] === "get" &&
    typeof left[1] === "string" &&
    typeof right === "number";
  if (isPropertyComparison) return ["all", ["has", left[1]], filter];
  return filter.map((part) => guardNumericFilter(part));
}

/** The style with `guardNumericFilter` applied to each layer filter. */
export function guardStyleFilters<Style extends { layers?: readonly object[] }>(
  style: Style,
) {
  const layers = style.layers;
  if (layers === undefined) return style;
  const guarded = layers.map((layer) =>
    "filter" in layer
      ? { ...layer, filter: guardNumericFilter(layer.filter) }
      : layer,
  );
  // The guard only wraps a comparison in ["all", ["has", key], comparison],
  // which is a valid filter, so each layer keeps its type.
  return { ...style, layers: guarded } as Style;
}

const MAP_STYLE_ID = "a2ui-standard-map";
const ROUTE_SOURCE = "a2ui-route";

/**
 * The few maplibre-gl rules that markers and popups need, so a host does not
 * have to import maplibre-gl.css. The list of places is hidden while the map
 * shows. It shows when a keyboard user moves focus into it.
 */
const MAP_CSS = [
  ".maplibregl-map{position:relative;overflow:hidden}",
  ".maplibregl-canvas{position:absolute;left:0;top:0}",
  ".maplibregl-canvas-container{width:100%;height:100%}",
  ".maplibregl-marker{position:absolute;top:0;left:0;will-change:transform;cursor:pointer}",
  ".maplibregl-popup{position:absolute;top:0;left:0;display:flex;will-change:transform;pointer-events:none}",
  ".maplibregl-popup-content{position:relative;background:var(--a2ui-color-surface-elevated, #fff);color:var(--a2ui-color-text-default, #0d0d0d);border-radius:6px;padding:6px 10px;font:12px/1.4 system-ui,sans-serif;box-shadow:var(--a2ui-shadow-sm, 0 1px 4px rgba(0,0,0,.2));pointer-events:auto}",
  ".maplibregl-popup-tip{display:none}",
  ".maplibregl-popup-close-button{display:none}",
  ".maplibregl-ctrl-attrib{font:10px system-ui,sans-serif;position:absolute;right:0;bottom:0;background:color-mix(in srgb, var(--a2ui-color-surface, #fff) 70%, transparent);color:var(--a2ui-color-text-secondary, #5d5d5d);padding:0 4px}",
  ".maplibregl-ctrl-attrib a{color:inherit}",
  // The cooperative-gesture hint is hidden until MapLibre adds `maplibregl-show`.
  ".maplibregl-cooperative-gesture-screen{align-items:center;background:rgba(0,0,0,.4);color:#fff;display:flex;font:14px/1.3 system-ui,sans-serif;inset:0;justify-content:center;opacity:0;padding:1rem;pointer-events:none;position:absolute;text-align:center;transition:opacity 1s ease 1s;z-index:2}",
  ".maplibregl-cooperative-gesture-screen.maplibregl-show{opacity:1;transition:opacity .05s}",
  ".maplibregl-cooperative-gesture-screen .maplibregl-mobile-message{display:none}",
  "@media (hover:none){.maplibregl-cooperative-gesture-screen .maplibregl-desktop-message{display:none}.maplibregl-cooperative-gesture-screen .maplibregl-mobile-message{display:block}}",
  ".a2ui-std-map-places[data-collapsed]:not(:focus-within){position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}",
].join("\n");

/** The part of maplibre-gl that the map uses, as the loader gives it. */
interface MapLibreMap {
  setStyle(
    style: string,
    options: {
      transformStyle: (
        previous: unknown,
        next: { layers?: readonly object[] },
      ) => unknown;
    },
  ): void;
  on(
    event: string,
    handler: (event: { originalEvent?: unknown }) => void,
  ): void;
  fitBounds(bounds: unknown, options: Record<string, unknown>): void;
  getSource(id: string): unknown;
  addSource(id: string, source: Record<string, unknown>): void;
  addLayer(layer: Record<string, unknown>): void;
  remove(): void;
}
interface MapLibreMarker {
  setLngLat(position: [number, number]): MapLibreMarker;
  setPopup(popup: unknown): MapLibreMarker;
  addTo(map: MapLibreMap): MapLibreMarker;
  getElement(): HTMLElement;
}
interface MapLibre {
  Map: new (options: Record<string, unknown>) => MapLibreMap;
  Marker: new () => MapLibreMarker;
  Popup: new (options: Record<string, unknown>) => {
    setText(text: string): unknown;
  };
  LngLatBounds: new () => { extend(position: [number, number]): void };
}

function isMapLibre(value: unknown): value is MapLibre {
  return (
    typeof value === "object" &&
    value !== null &&
    "Map" in value &&
    typeof value.Map === "function"
  );
}

const isValidMarker = (marker: MapMarker) =>
  Number.isFinite(marker.lat) && Number.isFinite(marker.lng);

type MapProps = z.output<typeof mapSchema>;

/**
 * A MapLibre map with markers, loaded through `provideGenerativeUIMap()`.
 * Without it, or without WebGL, the component shows a list of the places.
 * A click on a place or a marker sets `selected`.
 */
@Component({
  selector: "div[copilotGenerativeUIMap]",
  template: `
    <div #container aria-hidden="true" [style]="containerStyle()"></div>
    <ul
      class="a2ui-std-list a2ui-std-map-places"
      role="list"
      aria-label="Map places"
      [attr.data-collapsed]="status() === 'fallback' ? null : ''"
      [style]="placesStyle()"
    >
      @for (marker of validMarkers(); track $index) {
        <li>
          <button
            type="button"
            data-a2ui-input
            [attr.aria-pressed]="selected() === marker.label"
            (click)="selected.set(marker.label)"
            [style]="placeStyle(selected() === marker.label)"
          >
            <span [style]="labelStyle">{{ marker.label }}</span>
            <span [style]="coordinatesStyle">
              {{ marker.lat.toFixed(4) }}, {{ marker.lng.toFixed(4)
              }}{{ marker.category ? " · " + marker.category : "" }}
            </span>
          </button>
        </li>
      }
    </ul>
  `,
  host: {
    "data-a2ui-std": "",
    "[attr.data-a2ui-map]": "status()",
    "[style]": "style",
  },
})
export class CopilotGenerativeUIMap {
  readonly markers = input<MapProps["markers"]>();
  readonly route = input<boolean>();
  readonly selected = model<string>();
  readonly height = input<number>();
  readonly zoom = input<number>();
  readonly center = input<MapProps["center"]>();

  readonly #element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  readonly #loader = inject(GENERATIVE_UI_MAP_LOADER);
  readonly #isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly #runtime = inject(GENERATIVE_UI_RUNTIME, { optional: true });
  protected readonly container =
    viewChild<ElementRef<HTMLDivElement>>("container");
  protected readonly status = signal<"loading" | "ready" | "fallback">(
    "loading",
  );
  readonly #isDark = signal(false);

  protected readonly style: StyleMap = {
    position: "relative",
    width: "100%",
    border: `1px solid ${borderColor("default")}`,
    borderRadius: radius("lg"),
    overflow: "hidden",
    background: backgroundColor("surface-secondary"),
  };
  protected readonly labelStyle: StyleMap = { fontWeight: FONT_WEIGHT.medium };
  protected readonly coordinatesStyle: StyleMap = {
    ...textFont("xs"),
    color: textColor("secondary"),
  };
  protected readonly validMarkers = computed(
    () => (this.markers() ?? []).filter(isValidMarker),
    { equal: jsonEqual },
  );
  readonly #center = computed(() => this.center(), { equal: jsonEqual });
  protected readonly heightPx = computed(() => `${this.height() ?? 240}px`);
  protected readonly containerStyle = computed<StyleMap>(() => ({
    height: this.heightPx(),
    width: "100%",
    display: this.status() === "fallback" ? "none" : "block",
  }));
  protected readonly placesStyle = computed<StyleMap>(() => ({
    listStyle: "none",
    margin: 0,
    padding: spacing(3),
    display: "flex",
    flexDirection: "column",
    gap: spacing(2),
    maxHeight: this.heightPx(),
    overflowY: "auto",
    boxSizing: "border-box",
  }));
  /** A top-level style applies in both modes. `dark.mapStyle` wins in dark mode. */
  readonly #styleUrl = computed(() => {
    const theme = this.#runtime?.theme();
    return this.#isDark()
      ? theme?.dark?.mapStyle || theme?.mapStyle || DEFAULT_DARK_MAP_STYLE
      : theme?.mapStyle || DEFAULT_MAP_STYLE;
  });

  constructor() {
    const styles = inject(GenerativeUIStyles);
    styles.ensureStandard();
    styles.ensure(MAP_STYLE_ID, MAP_CSS);
    const loader = this.#loader;
    if (!loader || !this.#isBrowser) {
      this.status.set("fallback");
      return;
    }
    // Dark mode: the host, or an ancestor, has the `dark` class. One
    // observer for each map, on every class change in the document.
    const check = () =>
      this.#isDark.set(Boolean(this.#element.closest(".dark")));
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
      subtree: true,
    });
    inject(DestroyRef).onDestroy(() => observer.disconnect());

    effect((onCleanup) => {
      const container = this.container()?.nativeElement;
      const markers = this.validMarkers();
      const center = this.#center();
      const zoom = this.zoom();
      const route = this.route();
      const styleUrl = this.#styleUrl();
      if (!container) return;
      let isCancelled = false;
      let map: MapLibreMap | undefined;
      const setSelected = (label: string) => this.selected.set(label);

      const mount = async () => {
        const module: unknown = await loader();
        const fromDefault: unknown =
          typeof module === "object" && module !== null && "default" in module
            ? module.default
            : undefined;
        const maplibregl = isMapLibre(fromDefault) ? fromDefault : module;
        if (!isMapLibre(maplibregl)) throw new Error("not maplibre-gl");
        if (isCancelled) return;
        const first = markers[0];
        const start = center ?? first;
        const instance = new maplibregl.Map({
          container,
          center: start ? [start.lng, start.lat] : [0, 20],
          zoom: zoom ?? (markers.length === 1 ? 10 : 1),
          attributionControl: { compact: true },
          // The map is in a chat that scrolls. A plain wheel scrolls the
          // page. Ctrl or Cmd + wheel (two fingers on touch) zooms the map.
          cooperativeGestures: true,
        });
        map = instance;
        // `transformStyle` is an option of setStyle, not of the constructor.
        instance.setStyle(styleUrl, {
          transformStyle: (_previous, next) => guardStyleFilters(next),
        });
        for (const marker of markers) {
          const pin = new maplibregl.Marker()
            .setLngLat([marker.lng, marker.lat])
            .setPopup(
              new maplibregl.Popup({ offset: 24 }).setText(marker.label),
            )
            .addTo(instance);
          pin
            .getElement()
            .addEventListener("click", () => setSelected(marker.label));
        }
        // With two or more markers, the map always shows all of them. The
        // fit needs the size of the container, which settles after the map
        // mounts, so it runs again on each resize, until the user moves it.
        let hasUserMoved = false;
        instance.on("dragstart", () => {
          hasUserMoved = true;
        });
        instance.on("zoomstart", (event) => {
          if (event.originalEvent) hasUserMoved = true;
        });
        const fitMarkers = () => {
          const isTooSmall =
            container.clientWidth < 10 || container.clientHeight < 10;
          if (markers.length < 2 || hasUserMoved || isTooSmall) return;
          const bounds = new maplibregl.LngLatBounds();
          for (const marker of markers) bounds.extend([marker.lng, marker.lat]);
          instance.fitBounds(bounds, {
            padding: 48,
            maxZoom: zoom ?? 14,
            duration: 0,
          });
        };
        fitMarkers();
        instance.on("load", fitMarkers);
        instance.on("resize", fitMarkers);
        if (route && markers.length > 1) {
          instance.on("load", () => {
            if (instance.getSource(ROUTE_SOURCE)) return;
            instance.addSource(ROUTE_SOURCE, {
              type: "geojson",
              data: {
                type: "Feature",
                properties: {},
                geometry: {
                  type: "LineString",
                  coordinates: markers.map((marker) => [
                    marker.lng,
                    marker.lat,
                  ]),
                },
              },
            });
            instance.addLayer({
              id: ROUTE_SOURCE,
              type: "line",
              source: ROUTE_SOURCE,
              paint: { "line-color": "#0285ff", "line-width": 3 },
            });
          });
        }
        this.status.set("ready");
      };
      untracked(() => {
        mount().catch(() => {
          // maplibre-gl is not installed, or there is no WebGL.
          map?.remove();
          map = undefined;
          if (!isCancelled) this.status.set("fallback");
        });
      });
      onCleanup(() => {
        isCancelled = true;
        try {
          map?.remove();
        } catch {
          // The map is already removed.
        }
      });
    });
  }

  protected placeStyle(isSelected: boolean): StyleMap {
    return {
      display: "flex",
      alignItems: "baseline",
      gap: spacing(2),
      width: "100%",
      minHeight: "24px",
      textAlign: "start",
      border: 0,
      padding: `${spacing(1)} ${spacing(2)}`,
      borderRadius: radius("md"),
      background: isSelected ? backgroundColor("info") : "transparent",
      cursor: "pointer",
      color: textColor("default"),
    };
  }
}
