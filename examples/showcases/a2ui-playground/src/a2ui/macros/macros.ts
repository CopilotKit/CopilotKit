/**
 * The playground's macros. Each one used to be a hand-built React component;
 * now the model still writes one call, and the server expands it into Gen UI
 * 2.0 standard components only (Card, Row, Column, Title, Text, Caption,
 * Badge, Icon, Divider, Button, Image, List, Chart).
 */
import { z } from "zod";
import type { Weather } from "@/agent/apis";
import {
  defineMacro,
  derive,
  given,
  h,
  isDynamic,
  MacroExpander,
  type Value,
} from "./macro";

const onAction = (description: string) => ({
  onAction: { description, parameters: z.object({}).passthrough() },
});

/** Joins parts with a separator. Bound parts become a `formatString` over their paths. */
function join(sep: string, ...parts: unknown[]): unknown {
  const present = parts.filter(given);
  if (!present.length) return undefined;
  if (!present.some(isDynamic)) return present.join(sep);
  const paths = present.map((p) =>
    isDynamic(p)
      ? "@path" in p
        ? `\${${p["@path"]}}`
        : null
      : String(p).replace(/\$\{/g, "\\${"),
  );
  if (paths.some((p) => p === null)) return present[0];
  return { "@call": "formatString", args: { value: paths.join(sep) } };
}

export const FlightCard = defineMacro({
  name: "FlightCard",
  description:
    "Flight itinerary: airline, flight number, origin and destination codes with times, duration, stops, price and a select button. One per flight option. Macro: expands into standard components.",
  props: z.object({
    airline: z.string(),
    flightNumber: z.string().optional(),
    from: z.string(),
    to: z.string(),
    fromCity: z.string().optional(),
    toCity: z.string().optional(),
    depart: z.string(),
    arrive: z.string(),
    duration: z.string().optional(),
    stops: z.number().optional(),
    price: z.string().optional(),
    cabin: z.string().optional(),
    date: z.string().optional(),
    badge: z.string().optional(),
    actionLabel: z.string().optional(),
  }),
  events: onAction("Fires when the flight is selected."),
  expand: (p) => {
    const stops = derive(
      p.stops,
      (n: number) => (n === 0 ? "Nonstop" : n === 1 ? "1 stop" : `${n} stops`),
      "v == 0 ? 'Nonstop' : v == 1 ? '1 stop' : v + ' stops'",
    );
    const stopsColor = derive(
      p.stops,
      (n: number) => (n === 0 ? "success" : "warning"),
      "v == 0 ? 'success' : 'warning'",
    );
    const meta = join("  ·  ", p.flightNumber, p.cabin);
    const end = (
      code: unknown,
      time: unknown,
      city: unknown,
      align: "start" | "end",
    ) =>
      h(
        "Column",
        { gap: 0.5, align },
        h("Title", { text: code, size: "xl" }),
        h("Text", { text: time, fontWeight: "semibold", tabularNums: true }),
        given(city) && h("Caption", { text: city }),
      );
    return h(
      "Card",
      { gap: 3 },
      h(
        "Row",
        { justify: "spaceBetween", align: "center", gap: 3 },
        h(
          "Row",
          { align: "center", gap: 2.5 },
          h("Icon", { name: "plane", size: "lg", color: "primary" }),
          h(
            "Column",
            { gap: 0 },
            h("Title", { text: p.airline, size: "sm" }),
            given(meta) && h("Caption", { text: meta }),
          ),
        ),
        given(p.badge) &&
          h("Badge", { label: p.badge, color: "success", variant: "soft" }),
      ),
      h(
        "Row",
        { justify: "spaceBetween", align: "center", gap: 3 },
        end(p.from, p.depart, p.fromCity, "start"),
        h(
          "Column",
          { gap: 1, align: "center" },
          given(p.duration) && h("Caption", { text: p.duration }),
          h("Icon", { name: "arrow-right", color: "secondary" }),
          given(p.stops) &&
            h("Badge", {
              label: stops,
              color: stopsColor,
              variant: "soft",
              size: "sm",
            }),
        ),
        end(p.to, p.arrive, p.toCity, "end"),
      ),
      h("Divider", {}),
      h(
        "Row",
        { justify: "spaceBetween", align: "center", gap: 3 },
        h(
          "Column",
          { gap: 0 },
          given(p.date) && h("Caption", { text: p.date }),
          given(p.price) && h("Title", { text: p.price, size: "lg" }),
        ),
        given(p.onAction) &&
          h("Button", {
            label: p.actionLabel ?? "Select flight",
            variant: "primary",
            size: "sm",
            onClick: p.onAction,
          }),
      ),
    );
  },
});

export const ProductCard = defineMacro({
  name: "ProductCard",
  description:
    "Product tile: name, price (and compare-at), rating, short specs, badge, buy button. One per item when comparing products. Macro: expands into standard components.",
  props: z.object({
    name: z.string(),
    price: z.string(),
    compareAt: z.string().optional(),
    image: z.string().optional(),
    rating: z.number().optional(),
    reviews: z.number().optional(),
    badge: z.string().optional(),
    specs: z.array(z.string()).optional(),
    actionLabel: z.string().optional(),
  }),
  events: onAction("Fires when the buy button is clicked."),
  expand: (p) => {
    const rating = derive(
      p.rating,
      (n: number) => n.toFixed(1),
      "round(v * 10) / 10",
    );
    const reviews = derive(
      p.reviews,
      (n: number) => `(${n.toLocaleString("en-US")} reviews)`,
      "'(' + v + ' reviews)'",
    );
    return h(
      "Card",
      { gap: 3 },
      given(p.image) &&
        h("Image", {
          url: p.image,
          description: p.name,
          aspectRatio: "4/3",
          fit: "cover",
          radius: "lg",
        }),
      h(
        "Row",
        { justify: "spaceBetween", align: "start", gap: 2 },
        h("Title", { text: p.name, size: "md" }),
        given(p.badge) &&
          h("Badge", { label: p.badge, color: "discovery", variant: "soft" }),
      ),
      given(p.rating) &&
        h(
          "Row",
          { align: "center", gap: 1 },
          h("Icon", { name: "star", size: "sm", color: "warning" }),
          h("Text", { text: rating, size: "sm", fontWeight: "medium" }),
          given(p.reviews) && h("Caption", { text: reviews }),
        ),
      given(p.specs) && h("List", { items: p.specs, marker: "bullet" }),
      h(
        "Row",
        { justify: "spaceBetween", align: "center", gap: 3, wrap: "wrap" },
        h(
          "Row",
          { align: "baseline", gap: 2 },
          h("Title", { text: p.price, size: "lg" }),
          given(p.compareAt) &&
            h("Text", {
              text: p.compareAt,
              lineThrough: true,
              color: "secondary",
              size: "sm",
            }),
        ),
        given(p.onAction) &&
          h("Button", {
            label: p.actionLabel ?? "Add to cart",
            icon: "shopping-bag",
            variant: "primary",
            size: "sm",
            onClick: p.onAction,
          }),
      ),
    );
  },
});

const WEATHER_ICONS: Record<string, string> = {
  sun: "sun",
  "cloud-sun": "cloud-sun",
  cloud: "cloud",
  fog: "cloud-fog",
  drizzle: "cloud-drizzle",
  rain: "cloud-rain",
  snow: "cloud-snow",
  storm: "cloud-lightning",
};
const weatherIcon = (key: string) => WEATHER_ICONS[key] ?? "cloud";

export const WeatherReport = defineMacro({
  name: "WeatherReport",
  description:
    'Live weather for a place: current conditions, the next 12 hours as a chart and a 7-day forecast. Write only the place, for example WeatherReport("Lisbon"): the server fetches the forecast. Macro: expands into standard components.',
  props: z.object({
    location: z.string(),
    unit: z.enum(["C", "F"]).optional(),
  }),
  load: async (p) => {
    const { getWeather } = await import("@/agent/apis");
    return getWeather(String(p.location));
  },
  expand: (p, w: Weather) => {
    const f = p.unit === "F";
    const t = (c: number) => Math.round(f ? (c * 9) / 5 + 32 : c);
    const today = w.daily[0];
    const fact = (label: string, value: string) =>
      h(
        "Column",
        { gap: 0 },
        h("Caption", { text: label }),
        h("Text", { text: value, fontWeight: "semibold", tabularNums: true }),
      );
    return h(
      "Card",
      { gap: 4 },
      h(
        "Row",
        { justify: "spaceBetween", align: "start", gap: 3 },
        h(
          "Column",
          { gap: 1 },
          h(
            "Row",
            { align: "center", gap: 1 },
            h("Icon", { name: "map-pin", size: "sm", color: "secondary" }),
            h("Caption", { text: `${w.place.name}, ${w.place.country}` }),
          ),
          h("Title", {
            text: `${t(w.current.temp)}°${f ? "F" : "C"}`,
            size: "4xl",
          }),
          h("Text", { text: w.current.condition, fontWeight: "medium" }),
          today &&
            h("Caption", { text: `H ${t(today.max)}°  ·  L ${t(today.min)}°` }),
        ),
        h("Icon", {
          name: weatherIcon(w.current.icon),
          size: "xl",
          color: "warning",
        }),
      ),
      h(
        "Row",
        { justify: "spaceBetween", gap: 3 },
        fact("Feels like", `${t(w.current.feels)}°`),
        fact("Humidity", `${w.current.humidity}%`),
        fact("Wind", `${w.current.wind} km/h`),
      ),
      h("Chart", {
        chartType: "area",
        title: "Next 12 hours",
        data: w.hourly
          .slice(0, 12)
          .map((x) => ({ time: x.label, temp: t(x.temp) })),
        xKey: "time",
        series: [{ key: "temp", label: `Temperature (°${f ? "F" : "C"})` }],
        height: 150,
        showLegend: false,
      }),
      h("List", {
        marker: "none",
        items: w.daily.map((d) => ({
          label: d.label,
          value: `${t(d.min)}° / ${t(d.max)}°`,
          description: d.precip
            ? `${d.condition}, ${d.precip}% rain`
            : d.condition,
          icon: weatherIcon(d.icon),
        })),
      }),
      h("Caption", {
        text: `Live from Open-Meteo, updated ${w.current.time.slice(11, 16)} local time`,
      }),
    );
  },
});

export const MACROS = [FlightCard, ProductCard, WeatherReport];
export const macros = new MacroExpander(MACROS);
export type { Value };
