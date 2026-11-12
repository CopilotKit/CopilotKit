"use client";

/**
 * Typical slot heights so a frame already sits where the real component will.
 * The frame is replaced (cross-faded) as soon as the component's props validate.
 */
const SLOT: Record<string, number> = {
  Heading: 64,
  Text: 22,
  Markdown: 72,
  Badge: 24,
  Kbd: 24,
  Divider: 12,
  Button: 36,
  Avatar: 44,
  Stat: 104,
  StatGroup: 96,
  Progress: 44,
  RadialProgress: 96,
  Rating: 36,
  TagList: 32,
  KeyValueList: 168,
  Timeline: 220,
  Agenda: 240,
  DataTable: 240,
  ComparisonTable: 240,
  List: 200,
  LineChart: 260,
  AreaChart: 260,
  BarChart: 260,
  PieChart: 240,
  ScatterChart: 260,
  Heatmap: 240,
  Sparkline: 72,
  RadarChart: 280,
  CandlestickChart: 280,
  Treemap: 260,
  SankeyChart: 300,
  Gauge: 160,
  MapView: 320,
  RouteMap: 360,
  LocationCard: 260,
  PlaceList: 420,
  TextField: 62,
  Textarea: 110,
  Select: 62,
  Combobox: 62,
  CheckBox: 24,
  Switch: 64,
  RadioGroup: 120,
  Slider: 56,
  DatePicker: 62,
  ButtonGroup: 62,
  ChipSelect: 62,
  Alert: 64,
  Callout: 72,
  EmptyState: 160,
  Skeleton: 80,
  WeatherCard: 420,
  FlightCard: 170,
  ProductCard: 200,
  ProfileCard: 320,
  ReceiptCard: 320,
  EventCard: 300,
  StockTicker: 220,
  RecipeCard: 420,
  Image: 220,
  ImageGallery: 260,
  VideoEmbed: 300,
  CodeBlock: 140,
  Quote: 96,
  Card: 120,
  Section: 120,
  Grid: 104,
  Row: 104,
  Column: 120,
  Tabs: 160,
  Accordion: 150,
  Carousel: 200,
};

export function slotHeight(of?: string) {
  return (of && SLOT[of]) || 72;
}

/**
 * The outline the transitions.dev runtime traces (src/vendor/transitions/ui-generation.js), drawn the
 * same way: the box's edge as a stroke of round dots, `--gen-dot` wide and 4.8px apart, in `--gen-line`.
 * `r` is the corner radius of the box it sits in, less the 1px it is inset by. Decoration only; the
 * runtime skips it when it measures a surface (`data-t-generate-skip`), since it traces the box itself.
 */
export function DotOutline({ r }: { r: number }) {
  return (
    <svg
      className="gen-outline"
      aria-hidden
      focusable="false"
      data-t-generate-skip
    >
      <rect width="100%" height="100%" rx={r} />
    </svg>
  );
}

/**
 * A slot whose props are still streaming. In the conversation (`.wb-floor`, src/app/globals.css) it is a
 * transitions.dev frame: the dotted outline over a faint dot field, captioned with what the model has
 * named so far (its type, or its id while only the id is known). Elsewhere it is a plain skeleton pulse.
 */
export function BlueprintFrame({
  props,
}: {
  props: { of?: string; h?: number; state?: string };
}) {
  return (
    <div
      className="a2-blueprint"
      style={{ height: props.h ?? slotHeight(props.of) }}
      data-state={props.state ?? "streaming"}
      data-of={(props.of ?? "").replace(/^#/, "") || undefined}
      aria-hidden
    >
      <DotOutline r={11} />
    </div>
  );
}
