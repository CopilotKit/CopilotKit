"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Clock, Map as MapIcon, MapPin, Navigation, Route, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { directionsUrl, isLngLat, validPath, validPoints, type MapPoint } from "./map/geo";
import type { MapCanvasProps } from "./map/map-canvas";
import type { RendererMap } from "./types";

/** Skeleton map frame: shown during SSR, while MapLibre loads, and while points are still streaming. */
function MapSkeleton({ label = "Loading map", className }: { label?: string; className?: string }) {
  return (
    <div
      className={cn("relative h-full w-full overflow-hidden bg-[#0e0e11]", className)}
      style={{
        backgroundImage:
          "linear-gradient(oklch(1 0 0 / 3.5%) 1px, transparent 1px), linear-gradient(90deg, oklch(1 0 0 / 3.5%) 1px, transparent 1px)",
        backgroundSize: "28px 28px",
      }}
    >
      <div className="a2-shimmer absolute inset-0" />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
        <span className="flex size-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.04]">
          <MapPin className="size-4 animate-pulse text-violet-300" />
        </span>
        <span className="text-[11px]">{label}</span>
      </div>
    </div>
  );
}

const MapCanvas = dynamic<MapCanvasProps>(() => import("./map/map-canvas"), {
  ssr: false,
  loading: () => <MapSkeleton />,
});

function Frame({ height, children, className }: { height: number; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("relative w-full min-w-0 overflow-hidden", className)} style={{ height }}>
      {children}
    </div>
  );
}

const clampHeight = (h: unknown, fallback: number) => (typeof h === "number" && Number.isFinite(h) ? Math.min(Math.max(h, 160), 640) : fallback);

function Header({ icon: Icon, title, meta }: { icon: typeof MapIcon; title?: string; meta?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 px-4 pb-3 pt-3.5">
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-violet-500/15 text-violet-300">
          <Icon className="size-3.5" />
        </span>
        <span className="truncate text-[14px] font-semibold tracking-tight">{title}</span>
      </div>
      {meta ? <div className="shrink-0 text-[11.5px] text-muted-foreground tabular-nums">{meta}</div> : null}
    </div>
  );
}

function Rating({ value }: { value?: number }) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return (
    <span className="inline-flex items-center gap-0.5 text-[11.5px] font-medium tabular-nums text-amber-300">
      <Star className="size-3 fill-current" />
      {value.toFixed(1)}
    </span>
  );
}

function NumberDot({ n, active }: { n: number; active?: boolean }) {
  return (
    <span
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full text-[10.5px] font-semibold tabular-nums transition-colors",
        active ? "bg-violet-400 text-white shadow-[0_0_0_3px_rgba(167,139,250,0.22)]" : "bg-white/[0.07] text-muted-foreground",
      )}
    >
      {n}
    </span>
  );
}

export const mapRenderers: RendererMap<"MapView" | "RouteMap" | "LocationCard" | "PlaceList"> = {
  MapView: ({ props }) => {
    const points = useMemo(() => validPoints<MapPoint>(props.markers), [props.markers]);
    const [active, setActive] = useState<number | null>(null);
    const height = clampHeight(props.height, 340);
    return (
      <div className="a2-card a2-enter w-full min-w-0 overflow-hidden">
        {props.title || points.length ? (
          <Header icon={MapIcon} title={props.title ?? "Map"} meta={points.length ? `${points.length} ${points.length === 1 ? "place" : "places"}` : null} />
        ) : null}
        <Frame height={height} className="border-y border-[var(--a2-line)]">
          {points.length ? (
            <MapCanvas points={points} active={active} onActivate={setActive} zoom={props.zoom} />
          ) : (
            <MapSkeleton label="Waiting for locations" />
          )}
        </Frame>
        {points.length ? (
          <div className="flex gap-1.5 overflow-x-auto px-3 py-2.5 [scrollbar-width:none]">
            {points.map((p, i) => (
              <button
                key={`${p.name}-${i}`}
                type="button"
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onClick={() => setActive(active === i ? null : i)}
                className={cn(
                  "flex max-w-[220px] shrink-0 items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-left text-[12px] transition-colors",
                  active === i ? "border-violet-400/40 bg-violet-500/10 text-foreground" : "border-[var(--a2-line)] bg-white/[0.02] text-muted-foreground hover:text-foreground",
                )}
              >
                <NumberDot n={i + 1} active={active === i} />
                <span className="truncate">{p.name}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  },

  RouteMap: ({ props }) => {
    const path = useMemo(() => validPath(props.coordinates), [props.coordinates]);
    const height = clampHeight(props.height, 320);
    const stats = [
      props.distance ? { icon: Route, label: "Distance", value: props.distance } : null,
      props.duration ? { icon: Clock, label: "Duration", value: props.duration } : null,
    ].filter(Boolean) as { icon: typeof Route; label: string; value: string }[];
    return (
      <div className="a2-card a2-enter w-full min-w-0 overflow-hidden">
        <div className="flex min-w-0 flex-col gap-2.5 px-4 pb-3 pt-3.5">
          {props.title ? <span className="a2-label truncate">{props.title}</span> : null}
          <div className="flex min-w-0 items-center gap-2.5">
            <Endpoint tone="start" label={props.from} />
            <span className="flex min-w-6 flex-1 items-center gap-1 text-muted-foreground/60">
              <span className="h-px flex-1 border-t border-dashed border-white/15" />
              <ArrowRight className="size-3.5 shrink-0" />
            </span>
            <Endpoint tone="end" label={props.to} />
          </div>
        </div>
        <Frame height={height} className="border-y border-[var(--a2-line)]">
          {path.length >= 2 ? <MapCanvas route={path} padding={48} /> : <MapSkeleton label="Plotting route" />}
          {stats.length ? (
            <div className="pointer-events-none absolute left-3 top-3 z-10 flex gap-1.5">
              {stats.map((s) => (
                <span
                  key={s.label}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-[oklch(0.16_0.006_285/82%)] px-2.5 py-1 text-[12px] font-medium tabular-nums shadow-lg backdrop-blur-md"
                >
                  <s.icon className="size-3.5 text-violet-300" />
                  {s.value}
                </span>
              ))}
            </div>
          ) : null}
        </Frame>
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-[11.5px] text-muted-foreground">
          <span className="inline-flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-emerald-400" /> Start
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-violet-500 ring-2 ring-violet-300/30" /> Destination
            </span>
          </span>
          <span className="tabular-nums">{path.length ? `${path.length} waypoints` : ""}</span>
        </div>
      </div>
    );
  },

  LocationCard: ({ props }) => {
    const ok = isLngLat(props.lon, props.lat);
    const point = useMemo<MapPoint[]>(() => (ok ? [{ name: props.name ?? "", lat: props.lat, lon: props.lon }] : []), [ok, props.name, props.lat, props.lon]);
    return (
      <div className="a2-card a2-enter w-full min-w-0 overflow-hidden">
        <Frame height={150} className="border-b border-[var(--a2-line)]">
          {ok ? <MapCanvas points={point} interactive={false} plainPins zoom={14.5} /> : <MapSkeleton label="Locating" />}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[var(--a2-surface)] to-transparent" />
        </Frame>
        <div className="flex min-w-0 flex-col gap-2 px-4 pb-4 pt-3">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-[15px] font-semibold tracking-tight">{props.name}</span>
              {props.address ? (
                <span className="flex min-w-0 items-start gap-1 text-[12.5px] text-muted-foreground">
                  <MapPin className="mt-[3px] size-3 shrink-0" />
                  <span className="line-clamp-2">{props.address}</span>
                </span>
              ) : null}
            </div>
            {props.category ? (
              <Badge variant="secondary" className="shrink-0 border-[var(--a2-line)] bg-white/[0.05] text-[11px] text-muted-foreground">
                {props.category}
              </Badge>
            ) : null}
          </div>
          {props.rating != null || props.hours ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
              <Rating value={props.rating} />
              {props.hours ? (
                <span className="inline-flex items-center gap-1">
                  <Clock className="size-3" />
                  {props.hours}
                </span>
              ) : null}
            </div>
          ) : null}
          {ok ? (
            <div className="mt-1 flex gap-2">
              <Button asChild size="sm" className="h-8 flex-1 text-[12.5px]">
                <a href={directionsUrl(props.lat, props.lon)} target="_blank" rel="noreferrer">
                  <Navigation /> Directions
                </a>
              </Button>
              <Button asChild size="sm" variant="outline" className="h-8 flex-1 text-[12.5px]">
                <a href={`https://www.openstreetmap.org/?mlat=${props.lat}&mlon=${props.lon}#map=17/${props.lat}/${props.lon}`} target="_blank" rel="noreferrer">
                  <MapIcon /> Open map
                </a>
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    );
  },

  PlaceList: ({ props }) => {
    type Place = MapPoint & { address?: string; distanceKm?: number; rating?: number };
    const places = useMemo(() => validPoints<Place>(props.places), [props.places]);
    const [hover, setHover] = useState<number | null>(null);
    const [selected, setSelectedState] = useState<number | null>(typeof props.selected === "number" ? props.selected : null);
    // A preselected row is only highlighted; the map keeps every place in view until the user picks one.
    const [touched, setTouched] = useState(false);
    const setSelected = (i: number | null) => {
      setTouched(true);
      setSelectedState(i);
    };
    const active = hover ?? selected;
    const rows = useRef<(HTMLButtonElement | null)[]>([]);

    // Marker click selects a row: keep it in view.
    useEffect(() => {
      if (touched && selected != null) rows.current[selected]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, [selected, touched]);

    return (
      <div className="a2-card a2-enter @container w-full min-w-0 overflow-hidden" style={{ "--pl-h": `${typeof props.height === "number" ? props.height : 340}px` } as React.CSSProperties}>
        <Header
          icon={MapPin}
          title={props.title ?? "Places"}
          meta={places.length ? `${places.length} results` : null}
        />
        <div className="grid min-w-0 grid-cols-1 border-t border-[var(--a2-line)] @[540px]:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <div className="order-2 min-w-0 @[540px]:order-1 @[540px]:border-r @[540px]:border-[var(--a2-line)]">
            <div className="flex max-h-[var(--pl-h)] flex-col gap-0.5 overflow-y-auto p-1.5 [scrollbar-width:thin]" onMouseLeave={() => setHover(null)}>
              {places.length === 0
                ? [0, 1, 2].map((i) => <div key={i} className="a2-shimmer m-1 h-[44px] rounded-[10px]" />)
                : places.map((p, i) => (
                    <button
                      key={`${p.id ?? p.name}-${i}`}
                      ref={(el) => {
                        rows.current[i] = el;
                      }}
                      type="button"
                      onMouseEnter={() => setHover(i)}
                      onClick={() => setSelected(selected === i ? null : i)}
                      className={cn(
                        "group flex w-full min-w-0 items-start gap-2.5 rounded-[10px] border px-2.5 py-1.5 text-left transition-colors",
                        active === i ? "border-violet-400/30 bg-violet-500/[0.09]" : "border-transparent hover:bg-white/[0.03]",
                      )}
                    >
                      <span className="pt-px">
                        <NumberDot n={i + 1} active={active === i} />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="flex min-w-0 items-center justify-between gap-2">
                          <span className="truncate text-[13px] font-medium">{p.name}</span>
                          <Rating value={p.rating} />
                        </span>
                        <span className="flex min-w-0 items-center justify-between gap-2 text-[12px] text-muted-foreground">
                          <span className="truncate">{p.address ?? p.description ?? p.category}</span>
                          <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground/80">
                            {p.category && (p.address || p.description) ? <span className="hidden @[420px]:inline">{p.category}</span> : null}
                            {p.distanceKm != null ? <span className="tabular-nums">{p.distanceKm < 1 ? `${Math.round(p.distanceKm * 1000)} m` : `${p.distanceKm.toFixed(1)} km`}</span> : null}
                          </span>
                        </span>
                      </span>
                    </button>
                  ))}
            </div>
          </div>
          <div className="relative order-1 h-[240px] min-w-0 border-b border-[var(--a2-line)] @[540px]:order-2 @[540px]:h-auto @[540px]:min-h-[var(--pl-h)] @[540px]:border-b-0">
            <div className="absolute inset-0">
              {places.length ? (
                <MapCanvas points={places} active={active} onActivate={setSelected} followActive={touched || hover != null} focus={touched ? selected : null} padding={44} basemap={props.basemap === "streets" || props.basemap === "liberty" ? props.basemap : "dark"} />
              ) : (
                <MapSkeleton label="Finding places" />
              )}
            </div>
          </div>
        </div>
        {props.source ? (
          <div className="border-t border-[var(--a2-line)] px-4 py-2 text-[11px] text-muted-foreground/80">Source: {props.source}</div>
        ) : null}
      </div>
    );
  },
};

function Endpoint({ tone, label }: { tone: "start" | "end"; label?: string }) {
  return (
    <span className="flex min-w-0 shrink items-center gap-2">
      <span
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full border",
          tone === "start" ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : "border-violet-400/30 bg-violet-500/15 text-violet-300",
        )}
      >
        {tone === "start" ? <span className="size-2 rounded-full bg-current" /> : <MapPin className="size-3" />}
      </span>
      <span className="truncate text-[13.5px] font-semibold tracking-tight">{label || "..."}</span>
    </span>
  );
}
