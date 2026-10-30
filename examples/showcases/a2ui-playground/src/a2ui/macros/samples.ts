/**
 * One sample call per macro, and its expansion as A2UI v1.0 operations. The
 * sample for `WeatherReport` comes with a fixed forecast, so it expands
 * anywhere, with no network.
 */
import { A2UI_VERSION } from "@copilotkit/shared";
import type { Weather } from "@/agent/apis";
import { flatten, type FlatNode } from "./macro";
import { macros, MACROS } from "./macros";

const ev = (name: string, context?: Record<string, unknown>) => ({
  event: { name, ...(context ? { context } : {}) },
});

export const MACRO_SAMPLES: Record<string, FlatNode> = {
  FlightCard: {
    id: "root",
    component: "FlightCard",
    airline: "Pacific Air",
    flightNumber: "PA 214",
    cabin: "Economy",
    from: "SFO",
    fromCity: "San Francisco",
    to: "JFK",
    toCity: "New York",
    depart: "07:15",
    arrive: "15:52",
    duration: "5h 37m",
    stops: 0,
    date: "Thu, Nov 13",
    price: "$289",
    badge: "Cheapest",
    onAction: ev("select_flight", { flight: "PA 214" }),
  },
  ProductCard: {
    id: "root",
    component: "ProductCard",
    name: "Studio Wireless Headphones",
    price: "$249",
    compareAt: "$329",
    image:
      "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&q=80&auto=format&fit=crop",
    rating: 4.6,
    reviews: 2184,
    badge: "Best seller",
    specs: [
      "Adaptive noise cancelling",
      "40 hour battery",
      "USB-C fast charge, 10 min for 5 hours",
    ],
    actionLabel: "Add to cart",
    onAction: ev("add_to_cart", { sku: "studio-wl" }),
  },
  WeatherReport: { id: "root", component: "WeatherReport", location: "Lisbon" },
};

const day = (
  label: string,
  min: number,
  max: number,
  precip: number,
  condition: string,
  icon: string,
) => ({ date: "", label, min, max, precip, condition, icon });

/** A fixed Lisbon forecast for previews. Live runs fetch Open-Meteo instead. */
export const SAMPLE_WEATHER: Weather = {
  place: { name: "Lisbon", country: "Portugal", lat: 38.72, lon: -9.14 },
  current: {
    temp: 19,
    feels: 18,
    humidity: 64,
    wind: 14,
    code: 2,
    condition: "Partly cloudy",
    icon: "cloud-sun",
    isDay: true,
    time: "2026-10-29T14:00",
  },
  hourly: [17, 18, 19, 19, 20, 19, 18, 17, 16, 16, 15, 15].map((temp, i) => ({
    time: "",
    label: `${String((14 + i) % 24).padStart(2, "0")}:00`,
    temp,
    precip: i > 7 ? 20 : 5,
    icon: "cloud-sun",
  })),
  daily: [
    day("Today", 15, 20, 10, "Partly cloudy", "cloud-sun"),
    day("Fri", 14, 21, 0, "Clear sky", "sun"),
    day("Sat", 15, 22, 0, "Clear sky", "sun"),
    day("Sun", 16, 19, 70, "Rain", "rain"),
    day("Mon", 14, 18, 40, "Drizzle", "drizzle"),
    day("Tue", 13, 19, 10, "Partly cloudy", "cloud-sun"),
    day("Wed", 14, 20, 0, "Mainly clear", "sun"),
  ],
};

/** The standard components a sample call expands into. */
export function expandSample(name: string): FlatNode[] {
  const call = MACRO_SAMPLES[name];
  const m = MACROS.find((x) => x.name === name)!;
  if (m.load) {
    const { id: _id, component: _c, ...args } = call;
    void _id;
    void _c;
    return flatten(call.id, m.expand(args, SAMPLE_WEATHER as never));
  }
  return macros.expandSync([call]).components;
}

export function macroSampleOps(name: string, catalogId: string) {
  return [
    {
      version: A2UI_VERSION,
      createSurface: {
        surfaceId: `macro-${name}`,
        catalogId,
        components: expandSample(name),
      },
    },
  ];
}
