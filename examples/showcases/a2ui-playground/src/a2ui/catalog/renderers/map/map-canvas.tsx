"use client";

/**
 * The only module that touches MapLibre. It is loaded through next/dynamic
 * with ssr:false (see ./index.tsx), so window/WebGL are never touched on the server.
 */
import "maplibre-gl/dist/maplibre-gl.css";
import "./map.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { getWorkerUrl, setWorkerUrl } from "maplibre-gl";
import {
  AttributionControl,
  Layer,
  Map,
  Marker,
  NavigationControl,
  Source,
  type MapRef,
} from "react-map-gl/maplibre";
import { cn } from "@/lib/utils";
import {
  BASEMAP_STYLE,
  LIBERTY_STYLE,
  STREETS_STYLE,
  boundsOf,
  isDegenerate,
  type LngLat,
  type MapPoint,
} from "./geo";

export type MapCanvasProps = {
  points?: MapPoint[];
  route?: LngLat[];
  /** Index into `points` that is highlighted. */
  active?: number | null;
  onActivate?: (i: number | null) => void;
  /** Pan to the active point when it changes. */
  followActive?: boolean;
  /** Index to fly (and zoom) to; takes precedence over `active` for camera moves. */
  focus?: number | null;
  interactive?: boolean;
  zoom?: number;
  padding?: number;
  /** Plain dot pins instead of numbered ones (single-place cards). */
  plainPins?: boolean;
  /** "dark" (default, CARTO dark matter), "streets" (CARTO Voyager) or "liberty" (OpenFreeMap Liberty). */
  basemap?: "dark" | "streets" | "liberty";
  className?: string;
};

// MapLibre 6 resolves its worker relative to its own module URL, which breaks
// once bundled. Point it at the worker file emitted by the bundler instead.
if (
  typeof window !== "undefined" &&
  !getWorkerUrl()?.includes("maplibre-gl-worker")
) {
  setWorkerUrl(
    new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href,
  );
}

const ACCENT = "#a78bfa";
const ACCENT_DEEP = "#8b5cf6";

export default function MapCanvas({
  points = [],
  route = [],
  active = null,
  onActivate,
  followActive = false,
  focus = null,
  interactive = true,
  zoom,
  padding = 56,
  plainPins = false,
  basemap = "dark",
  className,
}: MapCanvasProps) {
  const ref = useRef<MapRef>(null);
  const box = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);

  // Containers settle after mount (grids, chat bubbles, streaming): keep the
  // canvas matched to its box and re-fit so markers never sit off-frame.
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const map = ref.current;
        if (!map) return;
        map.resize();
        const b = boundsRef.current;
        if (!b || activeRef.current != null) return;
        if (isDegenerate(b))
          map.jumpTo({
            center: [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2],
          });
        else map.fitBounds(b, { padding: pad, maxZoom: 15, duration: 0 });
      });
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pad = useMemo(
    () => ({
      top: padding + (points.length ? 30 : 0),
      bottom: padding,
      left: padding,
      right: padding,
    }),
    [padding, points.length],
  );
  const coords = useMemo<LngLat[]>(
    () => [...points.map((p) => [p.lon, p.lat] as LngLat), ...route],
    [points, route],
  );
  const bounds = useMemo(() => boundsOf(coords), [coords]);
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const activeRef = useRef(focus ?? active);
  activeRef.current = focus ?? active;
  const sig = bounds
    ? bounds
        .flat()
        .map((n) => n.toFixed(5))
        .join(",")
    : "";

  const initialViewState = useMemo(() => {
    if (!bounds) return { longitude: 0, latitude: 20, zoom: 1 };
    if (isDegenerate(bounds)) {
      const [[x0, y0], [x1, y1]] = bounds;
      return {
        longitude: (x0 + x1) / 2,
        latitude: (y0 + y1) / 2,
        zoom: zoom ?? 14,
      };
    }
    return {
      bounds: bounds as [LngLat, LngLat],
      fitBoundsOptions: { padding: pad, maxZoom: 15 },
    };
    // Only the first render matters; later changes go through fitBounds below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refit whenever the set of coordinates changes (streaming adds points).
  useEffect(() => {
    const map = ref.current;
    if (!map || !loaded || !bounds) return;
    if (isDegenerate(bounds)) {
      const [[x0, y0], [x1, y1]] = bounds;
      map.easeTo({
        center: [(x0 + x1) / 2, (y0 + y1) / 2],
        zoom: zoom ?? 14,
        duration: 500,
      });
    } else {
      map.fitBounds(bounds, { padding: pad, maxZoom: 15, duration: 600 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, loaded]);

  // Follow the active point: hover pans to it, a click (`focus`) flies in.
  useEffect(() => {
    const map = ref.current;
    if (!map || !loaded || !followActive) return;
    const idx = focus ?? active;
    if (idx == null) {
      if (bounds && !isDegenerate(bounds))
        map.fitBounds(bounds, { padding: pad, maxZoom: 15, duration: 700 });
      return;
    }
    const p = points[idx];
    if (!p) return;
    if (focus != null)
      map.flyTo({
        center: [p.lon, p.lat],
        zoom: Math.max(map.getZoom(), 14.5),
        duration: 900,
        essential: true,
      });
    else map.easeTo({ center: [p.lon, p.lat], duration: 450 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, focus, followActive, loaded]);

  const routeGeo = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features:
        route.length >= 2
          ? [
              {
                type: "Feature" as const,
                properties: {},
                geometry: { type: "LineString" as const, coordinates: route },
              },
            ]
          : [],
    }),
    [route],
  );

  return (
    <div
      ref={box}
      data-basemap={basemap === "dark" ? "dark" : "streets"}
      className={cn(
        "a2-map relative h-full w-full overflow-hidden",
        basemap === "dark" ? "bg-[#0e0e11]" : "bg-[#f2efe9]",
        className,
      )}
    >
      <Map
        ref={ref}
        mapStyle={
          basemap === "liberty"
            ? LIBERTY_STYLE
            : basemap === "streets"
              ? STREETS_STYLE
              : BASEMAP_STYLE
        }
        initialViewState={initialViewState}
        attributionControl={false}
        interactive={interactive}
        dragRotate={false}
        pitchWithRotate={false}
        touchPitch={false}
        cooperativeGestures={false}
        scrollZoom={interactive ? { around: "center" } : false}
        onLoad={(e) => {
          // Start with the attribution collapsed to its (i) button.
          e.target
            .getContainer()
            .querySelector(".maplibregl-ctrl-attrib")
            ?.classList.remove("maplibregl-compact-show");
          e.target.resize();
          setLoaded(true);
        }}
        onClick={() => onActivate?.(null)}
        style={{ width: "100%", height: "100%" }}
      >
        <AttributionControl compact position="bottom-right" />
        {interactive ? (
          <NavigationControl position="top-right" showCompass={false} />
        ) : null}

        {route.length >= 2 ? (
          <Source id="a2-route" type="geojson" data={routeGeo} lineMetrics>
            <Layer
              id="a2-route-glow"
              type="line"
              layout={{ "line-cap": "round", "line-join": "round" }}
              paint={{
                "line-color": ACCENT_DEEP,
                "line-width": 14,
                "line-blur": 10,
                "line-opacity": 0.55,
              }}
            />
            <Layer
              id="a2-route-casing"
              type="line"
              layout={{ "line-cap": "round", "line-join": "round" }}
              paint={{
                "line-color": "#1c1530",
                "line-width": 6.5,
                "line-opacity": 0.9,
              }}
            />
            <Layer
              id="a2-route-line"
              type="line"
              layout={{ "line-cap": "round", "line-join": "round" }}
              paint={{
                "line-width": 3.5,
                "line-gradient": [
                  "interpolate",
                  ["linear"],
                  ["line-progress"],
                  0,
                  "#6ee7b7",
                  0.18,
                  ACCENT,
                  1,
                  "#c4b5fd",
                ],
              }}
            />
          </Source>
        ) : null}

        {route.length >= 2 ? (
          <>
            <Marker
              longitude={route[0][0]}
              latitude={route[0][1]}
              anchor="center"
            >
              <EndPin kind="start" />
            </Marker>
            <Marker
              longitude={route[route.length - 1][0]}
              latitude={route[route.length - 1][1]}
              anchor="center"
            >
              <EndPin kind="end" />
            </Marker>
          </>
        ) : null}

        {points.map((p, i) => (
          <Marker
            key={`${p.id ?? p.name}-${i}`}
            longitude={p.lon}
            latitude={p.lat}
            anchor="bottom"
            style={{ zIndex: active === i ? 20 : 10 - Math.min(i, 9) }}
            onClick={(e) => {
              e.originalEvent.stopPropagation();
              onActivate?.(active === i ? null : i);
            }}
          >
            <Pin
              n={i + 1}
              active={active === i}
              plain={plainPins}
              label={p.name}
              interactive={interactive}
            />
          </Marker>
        ))}
      </Map>
      {!loaded ? (
        <div className="a2-shimmer pointer-events-none absolute inset-0" />
      ) : null}
    </div>
  );
}

function Pin({
  n,
  active,
  plain,
  label,
  interactive,
}: {
  n: number;
  active: boolean;
  plain: boolean;
  label: string;
  interactive: boolean;
}) {
  return (
    <div
      className={cn(
        "a2-pin-drop group/pin relative flex flex-col items-center",
        interactive && "cursor-pointer",
      )}
      style={{ "--i": Math.min(n - 1, 8) } as React.CSSProperties}
      title={label || undefined}
    >
      {active ? (
        <span className="a2-pin-pulse pointer-events-none absolute bottom-0 left-1/2 size-5 rounded-full bg-violet-400/50" />
      ) : null}
      <div
        className={cn(
          "relative flex size-[26px] items-center justify-center rounded-full rounded-br-[4px] border-[1.5px] transition-all duration-200 ease-out",
          "rotate-45 shadow-[0_6px_14px_-4px_rgba(0,0,0,0.7)]",
          active
            ? "scale-[1.18] border-white bg-violet-400 shadow-[0_0_0_4px_rgba(167,139,250,0.28),0_8px_18px_-4px_rgba(0,0,0,0.8)]"
            : "border-white/85 bg-violet-500 group-hover/pin:scale-110 group-hover/pin:bg-violet-400",
        )}
      >
        <span className="-rotate-45 text-[11px] font-semibold leading-none text-white tabular-nums">
          {plain ? <span className="block size-2 rounded-full bg-white" /> : n}
        </span>
      </div>
      <span className="mt-[3px] block h-[3px] w-2.5 rounded-full bg-black/50 blur-[1px]" />
    </div>
  );
}

function EndPin({ kind }: { kind: "start" | "end" }) {
  const start = kind === "start";
  return (
    <div className="a2-pin-drop relative flex items-center justify-center">
      <span
        className={cn(
          "absolute size-6 rounded-full",
          start ? "bg-emerald-300/20" : "bg-violet-300/25",
        )}
      />
      <span
        className={cn(
          "relative flex size-[15px] items-center justify-center rounded-full border-2 border-white shadow-[0_2px_8px_rgba(0,0,0,0.6)]",
          start ? "bg-emerald-400" : "bg-violet-500",
        )}
      >
        {start ? null : <span className="size-[5px] rounded-full bg-white" />}
      </span>
    </div>
  );
}
