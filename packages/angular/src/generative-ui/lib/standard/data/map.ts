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
  DEFAULT_DARK_MAP_STYLE,
  DEFAULT_MAP_STYLE,
  FONT_WEIGHT,
  MAP_CSS,
  MAP_STYLE_ID,
  ROUTE_SOURCE,
  backgroundColor,
  borderColor,
  guardStyleFilters,
  isMapLibre,
  isValidMarker,
  jsonEqual,
  radius,
  spacing,
  textColor,
  textFont,
} from "@copilotkit/shared/generative-ui";
import type {
  MapLibreMap,
  StyleMap,
  mapSchema,
} from "@copilotkit/shared/generative-ui";
import type { z } from "zod";
import { GENERATIVE_UI_RUNTIME } from "../../runtime";
import { GenerativeUIStyles } from "../../styles";
import { GENERATIVE_UI_MAP_LOADER } from "../loaders";

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
