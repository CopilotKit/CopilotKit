import React, { useEffect, useRef, useState } from "react";
import type { RendererProps } from "../../../../create-catalog";
import type { MapMarker } from "../definitions/data";
import {
  FONT_WEIGHT,
  backgroundColor,
  borderColor,
  radius,
  spacing,
  textColor,
  textFont,
} from "../tokens";
import { useThemeOptional } from "../../../../theme/ThemeContext";

/**
 * Default basemap: OpenFreeMap's Positron style, a keyless OpenStreetMap
 * vector style with streets and labels at city zoom. (MapLibre's demo tiles
 * only carry country outlines, so a city map rendered as a flat green box.)
 * Hosts override it per provider with `theme: { mapStyle: "<style url>" }`.
 */
export const DEFAULT_MAP_STYLE =
  "https://tiles.openfreemap.org/styles/positron";
const MAP_STYLE_ID = "a2ui-standard-map";

const ORDERING_OPS = new Set(["<", "<=", ">", ">="]);

/**
 * A filter expression with every numeric comparison on a feature property
 * guarded by `["has", property]`.
 *
 * MapLibre wraps `["get", key]` in a number assertion when it is compared
 * with a number, and the assertion logs "Expected value to be of type
 * number, but found null instead." for every feature that lacks the
 * property. OpenFreeMap's styles compare `ref_length` on roads that mostly
 * have none, which filled the console for nothing; the comparison is false
 * for a missing property either way.
 */
export function guardNumericFilter(filter: unknown): unknown {
  if (!Array.isArray(filter)) return filter;
  const [op, left, right] = filter;
  if (
    typeof op === "string" &&
    ORDERING_OPS.has(op) &&
    Array.isArray(left) &&
    left[0] === "get" &&
    typeof left[1] === "string" &&
    typeof right === "number"
  ) {
    return ["all", ["has", left[1]], filter];
  }
  return filter.map((part) => guardNumericFilter(part));
}

/** The style with `guardNumericFilter` applied to every layer filter. */
export function guardStyleFilters<
  T extends { layers?: Array<{ filter?: unknown }> },
>(style: T): T {
  if (!Array.isArray(style.layers)) return style;
  return {
    ...style,
    layers: style.layers.map((layer) =>
      layer.filter === undefined
        ? layer
        : { ...layer, filter: guardNumericFilter(layer.filter) },
    ),
  };
}
const ROUTE_SOURCE = "a2ui-route";

/**
 * The few maplibre-gl rules markers and popups need to position correctly,
 * so hosts do not have to import maplibre-gl.css.
 */
const MAP_CSS = [
  ".maplibregl-map{position:relative;overflow:hidden}",
  ".maplibregl-canvas{position:absolute;left:0;top:0}",
  ".maplibregl-canvas-container{width:100%;height:100%}",
  ".maplibregl-marker{position:absolute;top:0;left:0;will-change:transform;cursor:pointer}",
  ".maplibregl-popup{position:absolute;top:0;left:0;display:flex;will-change:transform;pointer-events:none}",
  ".maplibregl-popup-content{position:relative;background:#fff;border-radius:6px;padding:6px 10px;font:12px/1.4 system-ui,sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.2);pointer-events:auto}",
  ".maplibregl-popup-tip{display:none}",
  ".maplibregl-popup-close-button{display:none}",
  ".maplibregl-ctrl-attrib{font:10px system-ui,sans-serif;position:absolute;right:0;bottom:0;background:rgba(255,255,255,.7);padding:0 4px}",
  ".maplibregl-ctrl-attrib a{color:inherit}",
].join("");

function injectMapStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById(MAP_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = MAP_STYLE_ID;
  style.textContent = MAP_CSS;
  document.head.appendChild(style);
}

const VISUALLY_HIDDEN: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

const validMarker = (m: MapMarker) =>
  m &&
  typeof m.label === "string" &&
  Number.isFinite(m.lat) &&
  Number.isFinite(m.lng);

export function MapView({ props }: RendererProps<any>) {
  const markers: MapMarker[] = (
    Array.isArray(props.markers) ? props.markers : []
  ).filter(validMarker);
  const height: number = props.height ?? 240;
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "fallback">(
    "loading",
  );
  const setSelected: ((v: string) => void) | undefined = props.setSelected;
  const setSelectedRef = useRef(setSelected);
  setSelectedRef.current = setSelected;

  const markersKey = JSON.stringify(markers);
  const centerKey = JSON.stringify(props.center ?? null);
  const theme = useThemeOptional();
  const styleUrl =
    typeof theme?.mapStyle === "string" && theme.mapStyle
      ? theme.mapStyle
      : DEFAULT_MAP_STYLE;

  useEffect(() => {
    let cancelled = false;
    let map: { remove(): void } | undefined;

    (async () => {
      try {
        const mod: any = await import("maplibre-gl");
        const maplibregl = mod.default ?? mod;
        if (cancelled || !containerRef.current) return;
        injectMapStyles();
        const first = markers[0];
        const instance = new maplibregl.Map({
          container: containerRef.current,
          center: props.center
            ? [props.center.lng, props.center.lat]
            : first
              ? [first.lng, first.lat]
              : [0, 20],
          zoom: props.zoom ?? (markers.length === 1 ? 10 : 1),
          attributionControl: { compact: true },
          // The map sits inside a scrolling chat: a plain wheel must scroll
          // the page, not zoom the map. Ctrl/⌘ + wheel (two fingers on touch)
          // zooms, and MapLibre shows the hint itself.
          cooperativeGestures: true,
        });
        map = instance;
        // `transformStyle` is a setStyle option, not a constructor one.
        instance.setStyle(styleUrl, {
          transformStyle: (_previous: unknown, next: unknown) =>
            guardStyleFilters(next as { layers?: Array<{ filter?: unknown }> }),
        });
        // Test and debugging handle (the map instance is otherwise private).
        (
          containerRef.current as HTMLDivElement & { __a2uiMap?: unknown }
        ).__a2uiMap = instance;

        for (const m of markers) {
          const marker = new maplibregl.Marker()
            .setLngLat([m.lng, m.lat])
            .setPopup(new maplibregl.Popup({ offset: 24 }).setText(m.label))
            .addTo(instance);
          marker
            .getElement()
            .addEventListener("click", () => setSelectedRef.current?.(m.label));
        }

        // Several markers: always show all of them. A model-chosen center and
        // zoom cannot know the map's pixel size, and in practice left three of
        // four city markers outside a 320px box; its zoom only caps the fit.
        // The fit needs the container's real size: a streaming surface mounts
        // hidden (zero-sized) and is revealed later, so fit again on the first
        // resize that gives the map a real box.
        let fitted = false;
        const fitMarkers = () => {
          if (markers.length < 2 || fitted) return;
          const el = containerRef.current;
          if (!el || el.clientWidth < 10 || el.clientHeight < 10) return;
          const bounds = new maplibregl.LngLatBounds();
          for (const m of markers) bounds.extend([m.lng, m.lat]);
          instance.fitBounds(bounds, {
            padding: 48,
            maxZoom: props.zoom ?? 14,
            duration: 0,
          });
          fitted = true;
        };
        fitMarkers();
        instance.on("load", fitMarkers);
        instance.on("resize", fitMarkers);

        if (props.route && markers.length > 1) {
          instance.on("load", () => {
            if (instance.getSource(ROUTE_SOURCE)) return;
            instance.addSource(ROUTE_SOURCE, {
              type: "geojson",
              data: {
                type: "Feature",
                properties: {},
                geometry: {
                  type: "LineString",
                  coordinates: markers.map((m) => [m.lng, m.lat]),
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

        if (!cancelled) setStatus("ready");
      } catch {
        // maplibre-gl not installed, or no WebGL: show the marker list.
        map?.remove();
        map = undefined;
        if (!cancelled) setStatus("fallback");
      }
    })();

    return () => {
      cancelled = true;
      try {
        map?.remove();
      } catch {
        /* already torn down */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markersKey, centerKey, props.zoom, props.route, styleUrl]);

  const showFallback = status === "fallback";

  return (
    <div
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
        aria-hidden
        style={{
          height,
          width: "100%",
          display: showFallback ? "none" : "block",
        }}
      />
      {/* Labels are always in the DOM for tests and screen readers; visible only in fallback mode. */}
      <ul
        className="a2ui-std-list"
        aria-label="Map locations"
        style={
          showFallback
            ? {
                listStyle: "none",
                margin: 0,
                padding: spacing(3),
                display: "flex",
                flexDirection: "column",
                gap: spacing(2),
                maxHeight: height,
                overflowY: "auto",
                boxSizing: "border-box",
              }
            : VISUALLY_HIDDEN
        }
      >
        {markers.map((m, i) => {
          const selected = props.selected === m.label;
          return (
            <li key={`${m.label}-${i}`}>
              <button
                type="button"
                onClick={() => setSelected?.(m.label)}
                aria-pressed={selected}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: spacing(2),
                  width: "100%",
                  textAlign: "start",
                  border: 0,
                  padding: `${spacing(1)} ${spacing(2)}`,
                  borderRadius: radius("md"),
                  background: selected
                    ? backgroundColor("info")
                    : "transparent",
                  cursor: setSelected ? "pointer" : "default",
                  font: "inherit",
                  color: textColor("default"),
                }}
              >
                <span style={{ fontWeight: FONT_WEIGHT.medium }}>
                  {m.label}
                </span>
                <span
                  style={{ ...textFont("xs"), color: textColor("secondary") }}
                >
                  {m.lat.toFixed(4)}, {m.lng.toFixed(4)}
                  {m.category ? ` · ${m.category}` : ""}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
