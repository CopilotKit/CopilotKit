"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The `Blueprint` stand-in (registered in catalog.ts, never shown to the model).
 * The agent upserts the real component under the same id (A2UI 1.0
 * `updateComponents` upserts by id and a node may change its type), which
 * replaces the frame.
 *
 * Typical slot heights so a frame already sits where the real component will.
 */
const SLOT: Record<string, number> = {
  Heading: 64, Text: 22, Markdown: 72, Badge: 24, Kbd: 24, Divider: 12, Button: 36, Avatar: 44,
  Stat: 104, StatGroup: 96, Progress: 44, RadialProgress: 96, Rating: 36, TagList: 32,
  KeyValueList: 168, Timeline: 220, Agenda: 240, DataTable: 240, ComparisonTable: 240, List: 200,
  LineChart: 260, AreaChart: 260, BarChart: 260, PieChart: 240, ScatterChart: 260, Heatmap: 240, Sparkline: 72,
  RadarChart: 280, CandlestickChart: 280, Treemap: 260, SankeyChart: 300, Gauge: 160,
  MapView: 320, RouteMap: 360, LocationCard: 260, PlaceList: 420,
  TextField: 62, Textarea: 110, Select: 62, Combobox: 62, CheckBox: 24, Switch: 64, RadioGroup: 120, Slider: 56, DatePicker: 62, ButtonGroup: 62, ChipSelect: 62,
  Alert: 64, Callout: 72, EmptyState: 160, Skeleton: 80,
  WeatherCard: 420, FlightCard: 170, ProductCard: 200, ProfileCard: 320, ReceiptCard: 320, EventCard: 300, StockTicker: 220, RecipeCard: 420,
  Image: 220, ImageGallery: 260, VideoEmbed: 300, CodeBlock: 140, Quote: 96,
  Card: 120, Section: 120, Grid: 104, Row: 104, Column: 120, Tabs: 160, Accordion: 150, Carousel: 200,
};

export function slotHeight(of?: string) {
  return (of && SLOT[of]) || 72;
}

export function BlueprintFrame({ props }: { props: { of?: string; h?: number; state?: string } }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<[number, number] | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setSize([Math.round(e.contentRect.width), Math.round(e.contentRect.height)]));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const h = props.h ?? slotHeight(props.of);
  return (
    <div ref={ref} className="a2-blueprint" style={{ height: h }} data-state={props.state ?? "streaming"} aria-hidden>
      <span className="a2-bp-tick tl" />
      <span className="a2-bp-tick tr" />
      <span className="a2-bp-tick bl" />
      <span className="a2-bp-tick br" />
      <span className="a2-bp-label">
        {props.of ?? "component"}
        {size ? <span className="a2-bp-dim"> {size[0]}×{size[1]}</span> : null}
      </span>
    </div>
  );
}
