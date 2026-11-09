// Framework-free map helpers of the standard Map component. The maplibre-gl
// parts are typed structurally, so maplibre-gl stays an optional peer of
// each framework package.
import type { MapMarker } from "./map";

/**
 * The default basemap: the Positron style of OpenFreeMap. It is a keyless
 * OpenStreetMap vector style with streets and labels at city zoom. A host
 * sets another style with `theme: { mapStyle: "<style url>" }`, and a
 * dark one with `theme: { dark: { mapStyle: "<style url>" } }`.
 */
export const DEFAULT_MAP_STYLE =
  "https://tiles.openfreemap.org/styles/positron";

/** The default basemap in dark mode: the Dark style of OpenFreeMap. */
export const DEFAULT_DARK_MAP_STYLE =
  "https://tiles.openfreemap.org/styles/dark";

const ORDERING_OPS = new Set(["<", "<=", ">", ">="]);

// guardNumericFilter keeps its return type: the function calls itself, so
// TypeScript cannot infer it.
/**
 * A filter expression with every numeric comparison of a feature property
 * guarded by `["has", property]`.
 *
 * MapLibre adds a number assertion to `["get", key]` in a comparison with a
 * number. The assertion logs a warning for each feature without the
 * property. OpenFreeMap styles compare `ref_length` on roads that mostly do
 * not have it. The comparison is false for a missing property in both
 * cases, so the guard changes no result.
 *
 * @param filter - A MapLibre filter expression, at any depth.
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

/**
 * The style with `guardNumericFilter` applied to the filter of each layer.
 * Pass it as the `transformStyle` of MapLibre's `setStyle`.
 *
 * @param style - A MapLibre style object.
 */
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

/** The id of the map stylesheet (`MAP_CSS`) in the document. */
export const MAP_STYLE_ID = "a2ui-standard-map";

/** The source and layer id of the route line between the markers. */
export const ROUTE_SOURCE = "a2ui-route";

/**
 * The few maplibre-gl rules that markers and popups need, so a host does not
 * have to import maplibre-gl.css. The list of places is hidden while the map
 * shows. It shows when a keyboard user moves focus into it.
 */
export const MAP_CSS = [
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

/** The part of a maplibre-gl `Map` that the standard Map component uses. */
export interface MapLibreMap {
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

/** The part of a maplibre-gl `Marker` that the standard Map component uses. */
export interface MapLibreMarker {
  setLngLat(position: [number, number]): MapLibreMarker;
  setPopup(popup: unknown): MapLibreMarker;
  addTo(map: MapLibreMap): MapLibreMarker;
  getElement(): HTMLElement;
}

/** The part of the maplibre-gl module that the standard Map component uses. */
export interface MapLibre {
  Map: new (options: Record<string, unknown>) => MapLibreMap;
  Marker: new () => MapLibreMarker;
  Popup: new (options: Record<string, unknown>) => {
    setText(text: string): unknown;
  };
  LngLatBounds: new () => { extend(position: [number, number]): void };
}

/**
 * True when `value` looks like the maplibre-gl module: it has a `Map`
 * constructor. Use it on the module that a map loader resolves.
 */
export function isMapLibre(value: unknown): value is MapLibre {
  return (
    typeof value === "object" &&
    value !== null &&
    "Map" in value &&
    typeof value.Map === "function"
  );
}

/** True when the marker has finite coordinates, so the map can place it. */
export const isValidMarker = (marker: MapMarker) =>
  Number.isFinite(marker.lat) && Number.isFinite(marker.lng);
