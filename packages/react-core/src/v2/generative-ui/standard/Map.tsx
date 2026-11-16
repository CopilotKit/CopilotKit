import React, { useEffect, useInsertionEffect, useRef, useState } from "react";
import type { z } from "zod";
import { useRequiredGenerativeUIRuntime } from "../runtime-context";
import { useStableValue } from "./Chart";
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
import { useStandardStyles } from "./styles";

type MapProps = z.output<typeof mapSchema> & {
  /** From the engine: `selected` is writable. */
  setSelected: (value: string) => void;
};

// ---- Map style ----

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

// ---- Styles ----

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

// There is no document on the server, so nothing is added there.
const noEffect: typeof useInsertionEffect = () => {};
const useInjectEffect =
  typeof document === "undefined" ? noEffect : useInsertionEffect;

function useMapStyles() {
  useInjectEffect(() => {
    if (document.getElementById(MAP_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = MAP_STYLE_ID;
    style.textContent = MAP_CSS;
    document.head.appendChild(style);
  }, []);
}

// ---- MapLibre ----

type MapLibre = typeof import("maplibre-gl");

function isMapLibre(value: unknown): value is MapLibre {
  return (
    typeof value === "object" &&
    value !== null &&
    "Map" in value &&
    typeof value.Map === "function"
  );
}

/**
 * Imports maplibre-gl on the client. The package is an optional peer
 * dependency. The import rejects when it is not installed.
 */
async function loadMapLibre() {
  const module = await import("maplibre-gl");
  // maplibre-gl is a UMD bundle. Some bundlers put its exports on `default`.
  const fromDefault: unknown = "default" in module ? module.default : undefined;
  return isMapLibre(fromDefault) ? fromDefault : module;
}

const isValidMarker = (marker: MapMarker) =>
  Number.isFinite(marker.lat) && Number.isFinite(marker.lng);

type MapStatus = "loading" | "ready" | "fallback";

/**
 * True when the element is in dark mode: it, or an ancestor, has the `dark`
 * class. It follows class changes anywhere in the document.
 */
function useIsDark(ref: React.RefObject<HTMLElement | null>) {
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const check = () => setIsDark(Boolean(ref.current?.closest(".dark")));
    check();
    // ponytail: one observer for each map, on every class change in the document. Fine for a few maps; a shared observer when a page has many.
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
      subtree: true,
    });
    return () => observer.disconnect();
  }, [ref]);
  return isDark;
}

/**
 * A MapLibre map with markers. maplibre-gl loads only in the browser. When
 * it is not installed, or WebGL is not there, the component shows a list of
 * the places. A click on a place or a marker sets `selected`.
 */
export function MapView(props: MapProps) {
  useStandardStyles();
  useMapStyles();
  const markers = useStableValue((props.markers ?? []).filter(isValidMarker));
  const center = useStableValue(props.center);
  const { zoom, route } = props;
  const height = props.height ?? 240;
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<MapStatus>("loading");
  const setSelectedRef = useRef(props.setSelected);
  setSelectedRef.current = props.setSelected;
  const { theme } = useRequiredGenerativeUIRuntime();
  const isDark = useIsDark(containerRef);
  // A top-level style applies in both modes. `dark.mapStyle` wins in dark mode.
  const styleUrl = isDark
    ? theme?.dark?.mapStyle || theme?.mapStyle || DEFAULT_DARK_MAP_STYLE
    : theme?.mapStyle || DEFAULT_MAP_STYLE;

  useEffect(() => {
    let isCancelled = false;
    let map: InstanceType<MapLibre["Map"]> | undefined;

    async function mount() {
      const maplibregl = await loadMapLibre();
      const container = containerRef.current;
      if (isCancelled || !container) return;
      const first = markers[0];
      const start = center ?? first;
      const instance = new maplibregl.Map({
        container,
        center: start ? [start.lng, start.lat] : [0, 20],
        zoom: zoom ?? (markers.length === 1 ? 10 : 1),
        attributionControl: { compact: true },
        // The map is in a chat that scrolls. A plain wheel scrolls the page.
        // Ctrl or Cmd + wheel (two fingers on touch) zooms the map, and
        // MapLibre shows the hint.
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
          .setPopup(new maplibregl.Popup({ offset: 24 }).setText(marker.label))
          .addTo(instance);
        pin
          .getElement()
          .addEventListener("click", () =>
            setSelectedRef.current(marker.label),
          );
      }

      // With two or more markers, the map always shows all of them. A center
      // and zoom from the model cannot know the pixel size of the map. The
      // fit needs the size of the container, and that size settles after the
      // map mounts (a streaming surface mounts hidden, the chat column
      // reflows). So the fit runs again on each resize, until the user moves
      // the map.
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
                coordinates: markers.map((marker) => [marker.lng, marker.lat]),
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
      setStatus("ready");
    }

    mount().catch(() => {
      // maplibre-gl is not installed, or there is no WebGL.
      map?.remove();
      map = undefined;
      if (!isCancelled) setStatus("fallback");
    });

    return () => {
      isCancelled = true;
      try {
        map?.remove();
      } catch {
        // The map is already removed.
      }
    };
  }, [markers, center, zoom, route, styleUrl]);

  const isFallback = status === "fallback";
  return (
    <div
      data-a2ui-std=""
      data-a2ui-map={status}
      style={{
        position: "relative",
        width: "100%",
        border: `1px solid ${borderColor("default")}`,
        borderRadius: radius("lg"),
        overflow: "hidden",
        background: backgroundColor("surface-secondary"),
      }}
    >
      <div
        ref={containerRef}
        aria-hidden="true"
        style={{
          height,
          width: "100%",
          display: isFallback ? "none" : "block",
        }}
      />
      <ul
        className="a2ui-std-list a2ui-std-map-places"
        role="list"
        aria-label="Map places"
        data-collapsed={isFallback ? undefined : ""}
        style={{
          listStyle: "none",
          margin: 0,
          padding: spacing(3),
          display: "flex",
          flexDirection: "column",
          gap: spacing(2),
          maxHeight: height,
          overflowY: "auto",
          boxSizing: "border-box",
        }}
      >
        {markers.map((marker, index) => {
          const isSelected = props.selected === marker.label;
          return (
            <li key={`${marker.label}-${index}`}>
              <button
                type="button"
                data-a2ui-input=""
                aria-pressed={isSelected}
                onClick={() => props.setSelected(marker.label)}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: spacing(2),
                  width: "100%",
                  minHeight: 24,
                  textAlign: "start",
                  border: 0,
                  padding: `${spacing(1)} ${spacing(2)}`,
                  borderRadius: radius("md"),
                  background: isSelected
                    ? backgroundColor("info")
                    : "transparent",
                  cursor: "pointer",
                  color: textColor("default"),
                }}
              >
                <span style={{ fontWeight: FONT_WEIGHT.medium }}>
                  {marker.label}
                </span>
                <span
                  style={{ ...textFont("xs"), color: textColor("secondary") }}
                >
                  {marker.lat.toFixed(4)}, {marker.lng.toFixed(4)}
                  {marker.category ? ` · ${marker.category}` : ""}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
