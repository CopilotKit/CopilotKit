import type { ComponentName } from "@/a2ui/catalog/definitions";
import type { Category } from "@/a2ui/catalog/definitions/shared";

/**
 * Hand-assigned bento sizes for the /components overview (4-column grid,
 * fixed row height). Each category's list is in display order and its areas
 * add up to whole rows, so every section closes flush with no ragged gaps.
 *
 *   s = 1 col x 1 row   (compact: Kbd, Avatar, Rating...)
 *   w = 2 cols x 1 row  (wide: charts, tables, forms)
 *   t = 1 col x 2 rows  (tall: cards that read top to bottom)
 *   l = 2 cols x 2 rows (large: maps, data tables, hero cards)
 */
export type TileSize = "s" | "w" | "t" | "l";

export const TILE_LAYOUT: Record<Category, Array<[ComponentName, TileSize]>> = {
  // 1 row: 2+2 (Column, Row, Grid, Card, Tabs, Divider and Carousel are standard components)
  Layout: [
    ["Section", "w"],
    ["Accordion", "w"],
  ],
  // 3 rows: 2+2 | 2+2 | 2+2 (Text, Markdown and Image are standard components)
  Content: [
    ["ImageGallery", "w"],
    ["CodeBlock", "w"],
    ["Heading", "w"],
    ["Quote", "w"],
    ["VideoEmbed", "w"],
    ["Kbd", "w"],
  ],
  // 6 rows: [l t t] x2 | 2+2 | 2+2 | 2+2 | 1x4 (Badge and List are standard components)
  "Data display": [
    ["DataTable", "l"],
    ["Agenda", "t"],
    ["Timeline", "t"],
    ["ComparisonTable", "w"],
    ["StatGroup", "w"],
    ["KeyValueList", "w"],
    ["TagList", "w"],
    ["AvatarGroup", "w"],
    ["Progress", "w"],
    ["Stat", "s"],
    ["Avatar", "s"],
    ["RadialProgress", "s"],
    ["Rating", "s"],
  ],
  // 5 rows: [l w / w] | 2+2 | 2+1+1 | 1x4
  Charts: [
    ["CandlestickChart", "l"],
    ["Heatmap", "w"],
    ["SankeyChart", "w"],
    ["LineChart", "w"],
    ["AreaChart", "w"],
    ["Treemap", "w"],
    ["BarChart", "s"],
    ["PieChart", "s"],
    ["ScatterChart", "s"],
    ["RadarChart", "s"],
    ["Sparkline", "s"],
    ["Gauge", "s"],
  ],
  // 2 rows: [l w / s s]
  Maps: [
    ["PlaceList", "l"],
    ["MapView", "w"],
    ["RouteMap", "s"],
    ["LocationCard", "s"],
  ],
  // 2 rows: 2+2 | 1+1+2 (TextField, TextArea, Select, CheckBox, RadioGroup, Slider and Button are standard components)
  Inputs: [
    ["ChipSelect", "w"],
    ["ButtonGroup", "w"],
    ["Combobox", "s"],
    ["DatePicker", "s"],
    ["Switch", "w"],
  ],
  // 2 rows: 2+2 | 2+2
  Feedback: [
    ["Alert", "w"],
    ["Callout", "w"],
    ["EmptyState", "w"],
    ["Skeleton", "w"],
  ],
  // 4 rows: [l l] x2 | 2 + t + t | 2 (FlightCard and ProductCard are macros now, expanded into standard components)
  Domain: [
    ["WeatherCard", "l"],
    ["RecipeCard", "l"],
    ["StockTicker", "w"],
    ["ProfileCard", "t"],
    ["ReceiptCard", "t"],
    ["EventCard", "w"],
  ],
};

/** Preview render scale per tile size: the component lays out at tileWidth / scale, then shrinks. */
export const TILE_SCALE: Record<TileSize, number> = {
  s: 0.8,
  w: 0.86,
  t: 0.8,
  l: 0.9,
};

/** Per-component starting scale where the size default leaves the tile looking empty. */
export const SCALE_OVERRIDE: Partial<Record<ComponentName, number>> = {
  CandlestickChart: 1.08,
  Kbd: 1,
};

/** Smallest scale a tile may shrink to while trying to fit its whole component. */
export const TILE_FLOOR: Record<TileSize, number> = {
  s: 0.5,
  w: 0.62,
  t: 0.6,
  l: 0.7,
};

/** Per-component floor where clipping would hide part of the component (a treemap's bottom row of cells). */
export const FLOOR_OVERRIDE: Partial<Record<ComponentName, number>> = {
  Treemap: 0.5,
};

/** Row height (px) of one bento row, per category. Charts are taller by nature. */
export const ROW_HEIGHT: Partial<Record<Category, number>> = { Charts: 280 };
export const DEFAULT_ROW_HEIGHT = 232;

/** Components that keep their intrinsic width on the detail stage instead of stretching (the playground's, then standard ones). */
export const INTRINSIC = new Set<string>([
  "Kbd",
  "Avatar",
  "AvatarGroup",
  "Rating",
  "ButtonGroup",
  "TagList",
  "RadialProgress",
  "Gauge",
  "Switch",
  "Badge",
  "Bold",
  "Italic",
  "Underline",
  "Strikethrough",
  "Label",
  "Caption",
  "Link",
  "ShimmerText",
  "Icon",
  "Svg",
  "Button",
  "PulseIndicator",
  "Tooltip",
  "Popover",
  "PopoverTrigger",
  "PopoverContent",
  "Modal",
]);
