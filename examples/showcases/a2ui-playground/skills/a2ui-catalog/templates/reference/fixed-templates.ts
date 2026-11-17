// Reference implementation copied from the a2ui-playground build (working, measured).
// Paths like @/a2ui/... are app-specific: adapt imports to your project.
/**
 * Fixed-schema surfaces. Each template is a static component tree (authored
 * once, never generated) plus a pure function that maps tool data into the
 * data model those components bind to with A2UI 1.0 `{ "@path" }` bindings.
 *
 * Layout and form primitives (Column, Row, Grid, Card, Title, Caption,
 * Button, TextField, RadioGroup, CheckBox, List) are Gen UI 2.0 standard
 * components; the rest are the playground's own.
 *
 * The agent only ever supplies DATA for these. That is why they paint as soon
 * as the data lands: there is no second model call writing UI.
 */
import type { Fx, Poi, Place, Route, Weather } from "../apis";
import type { Component, FixedSurface } from "./types";

const p = (path: string) => ({ "@path": path });
const source = (id = "source"): Component => ({
  id,
  component: "Caption",
  text: p("/source"),
});

/* ───────────── weather ───────────── */

export const WEATHER: Component[] = [
  {
    id: "root",
    component: "Column",
    gap: 2,
    children: ["card", "rain", "source"],
  },
  {
    id: "card",
    component: "WeatherCard",
    location: p("/location"),
    temp: p("/now/temp"),
    condition: p("/now/condition"),
    icon: p("/now/icon"),
    high: p("/today/max"),
    low: p("/today/min"),
    feels: p("/now/feels"),
    humidity: p("/now/humidity"),
    wind: p("/now/wind"),
    hourly: p("/hourly"),
    daily: p("/daily"),
  },
  {
    id: "rain",
    component: "BarChart",
    title: "Chance of rain",
    subtitle: "Next 24 hours",
    format: "percent",
    height: 150,
    data: p("/rain"),
  },
  source(),
];

export function weatherSurface(w: Weather): FixedSurface {
  return {
    template: "weather",
    title: `Weather in ${w.place.name}`,
    components: WEATHER,
    data: {
      location: `${w.place.name}, ${w.place.country}`,
      now: {
        temp: w.current.temp,
        feels: w.current.feels,
        humidity: w.current.humidity,
        wind: w.current.wind,
        condition: w.current.condition,
        icon: w.current.icon,
      },
      today: { min: w.daily[0]?.min, max: w.daily[0]?.max },
      hourly: w.hourly.slice(0, 12).map((h) => ({
        label: h.label,
        temp: h.temp,
        icon: h.icon,
        precip: h.precip,
      })),
      daily: w.daily.map((d) => ({
        label: d.label,
        min: d.min,
        max: d.max,
        icon: d.icon,
        precip: d.precip,
      })),
      rain: w.hourly.map((h) => ({ x: h.label, y: h.precip })),
      source: `Live from Open-Meteo, updated ${w.current.time.slice(11, 16)} local time`,
    },
    source: "Open-Meteo",
  };
}

/* ───────────── places ───────────── */

export const PLACES: Component[] = [
  {
    id: "root",
    component: "Column",
    gap: 3,
    children: ["head", "list", "source"],
  },
  {
    id: "head",
    component: "Heading",
    eyebrow: p("/eyebrow"),
    text: p("/title"),
    subtitle: p("/subtitle"),
  },
  { id: "list", component: "PlaceList", places: p("/places") },
  source(),
];

export function placesSurface(
  what: string,
  center: Place,
  places: Poi[],
  src: string,
): FixedSurface {
  return {
    template: "places",
    title: `${what} near ${center.name}`,
    components: PLACES,
    data: {
      eyebrow: "Places",
      title: `${what.replace(/^\w/, (c) => c.toUpperCase())} in ${center.name}`,
      subtitle: `${places.length} spots within 5 km, nearest first.`,
      places: places.map((pl) => ({
        id: pl.id,
        name: pl.name,
        lat: pl.lat,
        lon: pl.lon,
        address: pl.address || undefined,
        category: pl.category,
        distanceKm: pl.distanceKm,
      })),
      source: `Live from ${src}. Map data OpenStreetMap contributors.`,
    },
    source: src,
  };
}

/* ───────────── route ───────────── */

export const ROUTE: Component[] = [
  {
    id: "root",
    component: "Column",
    gap: 2,
    children: ["map", "stats", "source"],
  },
  {
    id: "map",
    component: "RouteMap",
    from: "Start",
    to: "End",
    coordinates: p("/coordinates"),
    distance: undefined,
    duration: undefined,
  },
  {
    id: "stats",
    component: "Grid",
    columns: 3,
    children: ["s-dist", "s-time", "s-speed"],
  },
  { id: "s-dist", component: "Stat", label: "Distance", value: p("/distance") },
  {
    id: "s-time",
    component: "Stat",
    label: "Drive time",
    value: p("/duration"),
    caption: p("/eta"),
  },
  {
    id: "s-speed",
    component: "Stat",
    label: "Average speed",
    value: p("/speed"),
  },
  source(),
].map(
  (c) =>
    Object.fromEntries(
      Object.entries(c).filter(([, v]) => v !== undefined),
    ) as Component,
);

function hm(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} h ${m} min` : `${m} min`;
}

export function routeSurface(r: Route): FixedSurface {
  // RouteMap's from/to/distance/duration are literals in the tree; patch them per request (still no generated UI).
  const components = ROUTE.map((c) =>
    c.id === "map"
      ? {
          ...c,
          from: r.from.name,
          to: r.to.name,
          title: `${r.from.name} to ${r.to.name}`,
          distance: `${r.distanceKm} km`,
          duration: hm(r.durationMin),
        }
      : c,
  );
  const eta = new Date(Date.now() + r.durationMin * 60000).toLocaleTimeString(
    "en-US",
    { hour: "numeric", minute: "2-digit" },
  );
  return {
    template: "route",
    title: `${r.from.name} to ${r.to.name}`,
    components,
    data: {
      coordinates: r.coordinates,
      distance: `${r.distanceKm} km`,
      duration: hm(r.durationMin),
      eta: `Arrive around ${eta} if you leave now`,
      speed: `${Math.round(r.distanceKm / (r.durationMin / 60))} km/h`,
      source:
        "Live route from the OSRM public demo server (driving profile). Map data OpenStreetMap contributors.",
    },
    source: "OSRM",
  };
}

/* ───────────── FX ───────────── */

export const FX: Component[] = [
  {
    id: "root",
    component: "Column",
    gap: 3,
    children: ["head", "rates", "trend", "table", "source"],
  },
  {
    id: "head",
    component: "Heading",
    eyebrow: "Currency",
    text: p("/title"),
    subtitle: p("/subtitle"),
  },
  { id: "rates", component: "StatGroup", items: p("/rates") },
  // Series with different magnitudes (JPY ~150 vs EUR ~0.9) cannot share an axis: plot % change since day one.
  {
    id: "trend",
    component: "LineChart",
    title: "Change over 30 days",
    subtitle:
      "Percent change since the first day, so every currency shares one scale",
    format: "percent",
    data: p("/history"),
    height: 200,
  },
  {
    id: "table",
    component: "DataTable",
    title: "Quick conversions",
    columns: [],
    rows: p("/conversions"),
  },
  source(),
];

export function fxSurface(fx: Fx): FixedSurface {
  const codes = fx.rates.map((r) => r.code);
  const components = FX.map((c) =>
    c.id === "table"
      ? {
          ...c,
          columns: [
            { key: "amount", label: fx.base, format: "number", align: "right" },
            ...codes.map((code) => ({
              key: code,
              label: code,
              format: "number",
              align: "right",
            })),
          ],
        }
      : c,
  ).filter((c) => c.id !== "trend" || fx.history.length > 0);
  if (!fx.history.length)
    components[0] = {
      ...components[0],
      children: ["head", "rates", "table", "source"],
    };
  const delta = (code: string) => {
    const h = fx.history.filter((x) => x.code === code);
    if (h.length < 2) return undefined;
    const pct = ((h[h.length - 1].rate - h[0].rate) / h[0].rate) * 100;
    return {
      delta: `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}% 30d`,
      trend: pct > 0.05 ? "up" : pct < -0.05 ? "down" : "flat",
    };
  };
  return {
    template: "fx",
    title: `${fx.base} exchange rates`,
    components,
    data: {
      title: `1 ${fx.base} today`,
      subtitle: `Reference rates for ${fx.date}.`,
      rates: fx.rates.map((r) => ({
        label: `${fx.base} to ${r.code}`,
        value: r.rate.toFixed(r.rate > 50 ? 2 : 4),
        ...delta(r.code),
      })),
      history: fx.history.map((h) => {
        const first = fx.history.find((x) => x.code === h.code)?.rate ?? h.rate;
        return {
          x: h.date.slice(5),
          y: Math.round(((h.rate - first) / first) * 10000) / 100,
          series: h.code,
        };
      }),
      conversions: [1, 10, 100, 1000, 10000].map((a) => ({
        amount: a,
        ...Object.fromEntries(
          fx.rates.map((r) => [r.code, Math.round(a * r.rate * 100) / 100]),
        ),
      })),
      source: `Live from ${fx.source}.`,
    },
    source: fx.source,
  };
}

/* ───────────── stock (sample data, clearly labelled) ───────────── */

function seeded(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

export const STOCK: Component[] = [
  {
    id: "root",
    component: "Column",
    gap: 2,
    children: ["ticker", "candles", "kv", "note"],
  },
  {
    id: "ticker",
    component: "StockTicker",
    symbol: p("/symbol"),
    name: p("/name"),
    price: p("/price"),
    change: p("/change"),
    changePct: p("/changePct"),
    series: p("/series"),
    stats: p("/stats"),
    sample: true,
  },
  {
    id: "candles",
    component: "CandlestickChart",
    title: "Daily candles",
    subtitle: "Last 30 sessions",
    format: "currency",
    data: p("/candles"),
  },
  {
    id: "kv",
    component: "KeyValueList",
    title: "Key stats",
    items: p("/kv"),
    columns: 2,
  },
  {
    id: "note",
    component: "Alert",
    tone: "info",
    title: "Sample data",
    message:
      "No keyless market data API exists, so this quote is generated for the demo. The layout is the real fixed-schema surface.",
  },
];

export function stockSurface(symbol: string, name?: string): FixedSurface {
  const sym = symbol.toUpperCase().slice(0, 6);
  const rnd = seeded(sym);
  let price = 40 + rnd() * 360;
  const candles = Array.from({ length: 30 }, (_, i) => {
    const open = price;
    const close = Math.max(5, open * (1 + (rnd() - 0.48) * 0.04));
    const high = Math.max(open, close) * (1 + rnd() * 0.012);
    const low = Math.min(open, close) * (1 - rnd() * 0.012);
    price = close;
    const d = new Date(Date.now() - (29 - i) * 86400000);
    return {
      date: d.toISOString().slice(5, 10),
      open: +open.toFixed(2),
      high: +high.toFixed(2),
      low: +low.toFixed(2),
      close: +close.toFixed(2),
    };
  });
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const change = +(last.close - prev.close).toFixed(2);
  const cap = (last.close * (2 + rnd() * 30)).toFixed(0);
  return {
    template: "stock",
    title: `${sym} quote`,
    components: STOCK,
    data: {
      symbol: sym,
      name: name ?? `${sym} Inc.`,
      price: last.close,
      change,
      changePct: +((change / prev.close) * 100).toFixed(2),
      series: candles.map((c) => c.close),
      stats: [
        { label: "Open", value: `$${last.open}` },
        { label: "Day range", value: `$${last.low} to $${last.high}` },
        { label: "Mkt cap", value: `$${cap}B` },
        { label: "P/E", value: (12 + rnd() * 30).toFixed(1) },
      ],
      candles,
      kv: [
        {
          label: "30d high",
          value: `$${Math.max(...candles.map((c) => c.high)).toFixed(2)}`,
        },
        {
          label: "30d low",
          value: `$${Math.min(...candles.map((c) => c.low)).toFixed(2)}`,
        },
        { label: "Avg volume", value: `${(5 + rnd() * 60).toFixed(1)}M` },
        { label: "Dividend yield", value: `${(rnd() * 2.5).toFixed(2)}%` },
      ],
    },
    source: "Sample data",
  };
}

/* ───────────── flights (sample data, rendered through a List template) ───────────── */

export const FLIGHTS: Component[] = [
  {
    id: "root",
    component: "Column",
    gap: 3,
    children: ["head", "refine", "list", "note"],
  },
  {
    id: "head",
    component: "Heading",
    eyebrow: "Flights",
    text: p("/title"),
    subtitle: p("/subtitle"),
  },
  // Refinements: the agent answers these by updating THIS surface in place.
  {
    id: "refine",
    component: "Row",
    gap: 1,
    wrap: "wrap",
    justify: "start",
    children: ["f-nonstop", "f-early"],
  },
  {
    id: "f-nonstop",
    component: "Button",
    label: "Nonstop only",
    size: "sm",
    icon: "filter",
    onClick: {
      event: { name: "filter_nonstop", context: { route: p("/title") } },
    },
  },
  {
    id: "f-early",
    component: "Button",
    label: "Earliest first",
    size: "sm",
    icon: "clock",
    onClick: {
      event: { name: "sort_by_departure", context: { route: p("/title") } },
    },
  },
  {
    id: "list",
    component: "List",
    children: { componentId: "flight", path: "/flights" },
  },
  {
    id: "flight",
    component: "FlightCard",
    airline: p("airline"),
    flightNumber: p("flightNumber"),
    from: p("from"),
    to: p("to"),
    depart: p("depart"),
    arrive: p("arrive"),
    duration: p("duration"),
    stops: p("stops"),
    price: p("price"),
    cabin: p("cabin"),
    date: p("date"),
    actionLabel: "Select",
    onAction: {
      event: {
        name: "select_flight",
        context: { flightNumber: p("flightNumber"), price: p("price") },
      },
    },
  },
  {
    id: "note",
    component: "Caption",
    text: "Sample fares generated for the demo (no keyless flight API exists).",
  },
];

const AIRLINES = [
  ["Lumen Air", "LM"],
  ["Northwind", "NW"],
  ["Atlas Pacific", "AP"],
  ["Skyline", "SK"],
];

export function flightsSurface(
  from: string,
  to: string,
  date?: string,
): FixedSurface {
  const F = from.toUpperCase().slice(0, 3);
  const T = to.toUpperCase().slice(0, 3);
  const rnd = seeded(`${F}${T}${date ?? ""}`);
  const base = 180 + rnd() * 500;
  const flights = Array.from({ length: 4 }, (_, i) => {
    const [airline, code] = AIRLINES[i];
    const dep = 6 * 60 + Math.floor(rnd() * 14 * 60);
    const dur = 95 + Math.floor(rnd() * 420);
    const arr = (dep + dur) % (24 * 60);
    const t = (m: number) =>
      `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    const stops = rnd() > 0.65 ? 1 : 0;
    return {
      airline,
      flightNumber: `${code} ${100 + Math.floor(rnd() * 899)}`,
      from: F,
      to: T,
      depart: t(dep),
      arrive: t(arr),
      duration: `${Math.floor(dur / 60)}h ${dur % 60}m`,
      stops,
      price: `$${Math.round(base * (0.8 + rnd() * 0.6) + stops * -40)}`,
      cabin: "Economy",
      date: date ?? "Flexible",
    };
  }).sort((a, b) => Number(a.price.slice(1)) - Number(b.price.slice(1)));
  return {
    template: "flights",
    title: `${F} to ${T}`,
    components: FLIGHTS,
    data: {
      title: `${F} to ${T}`,
      subtitle: `${flights.length} options${date ? ` on ${date}` : ""}, cheapest first.`,
      flights,
    },
    source: "Sample data",
  };
}

/* ───────────── model-supplied data: profile, receipt, event, recipe, signup ───────────── */

export const PROFILE: Component[] = [
  { id: "root", component: "Column", gap: 2, children: ["card"] },
  {
    id: "card",
    component: "ProfileCard",
    name: p("/name"),
    role: p("/role"),
    company: p("/company"),
    avatar: p("/avatar"),
    location: p("/location"),
    bio: p("/bio"),
    email: p("/email"),
    phone: p("/phone"),
    website: p("/website"),
  },
];
export function profileSurface(a: Record<string, unknown>): FixedSurface {
  const components = PROFILE.map((c) =>
    c.id === "card"
      ? {
          ...c,
          ...(Array.isArray(a.tags) ? { tags: a.tags } : {}),
          ...(Array.isArray(a.stats) ? { stats: a.stats } : {}),
        }
      : c,
  );
  return {
    template: "profile",
    title: String(a.name ?? "Profile"),
    components,
    data: { ...a },
    source: "Agent supplied",
  };
}

export const RECEIPT: Component[] = [
  { id: "root", component: "Column", gap: 2, children: ["receipt"] },
  {
    id: "receipt",
    component: "ReceiptCard",
    merchant: p("/merchant"),
    orderId: p("/orderId"),
    date: p("/date"),
    items: p("/items"),
  },
];
export function receiptSurface(a: Record<string, unknown>): FixedSurface {
  const statics = Object.fromEntries(
    ["status", "currency", "tax", "shipping", "discount", "payment"]
      .filter((k) => a[k] !== undefined)
      .map((k) => [k, a[k]]),
  );
  const components = RECEIPT.map((c) =>
    c.id === "receipt" ? { ...c, ...statics } : c,
  );
  return {
    template: "receipt",
    title: `Receipt from ${a.merchant}`,
    components,
    data: {
      merchant: a.merchant,
      orderId: a.orderId,
      date: a.date,
      items: a.items ?? [],
    },
    source: "Agent supplied",
  };
}

export const EVENT: Component[] = [
  { id: "root", component: "Column", gap: 3, children: ["event", "agenda"] },
  {
    id: "event",
    component: "EventCard",
    title: p("/title"),
    date: p("/date"),
    time: p("/time"),
    venue: p("/venue"),
    host: p("/host"),
    description: p("/description"),
    actionLabel: "RSVP",
    onAction: { event: { name: "rsvp", context: { event: p("/title") } } },
  },
  { id: "agenda", component: "Timeline", items: p("/agenda") },
];
export function eventSurface(a: Record<string, unknown>): FixedSurface {
  const agenda = Array.isArray(a.agenda) ? a.agenda : [];
  const components = EVENT.map((c) =>
    c.id === "event"
      ? {
          ...c,
          ...(Array.isArray(a.tags) ? { tags: a.tags } : {}),
          ...(typeof a.attendees === "number"
            ? { attendees: a.attendees }
            : {}),
        }
      : c,
  ).map((c) =>
    c.id === "root" && !agenda.length ? { ...c, children: ["event"] } : c,
  );
  return {
    template: "event",
    title: String(a.title ?? "Event"),
    components,
    data: { ...a, agenda },
    source: "Agent supplied",
  };
}

export const RECIPE_TEMPLATE = (a: Record<string, unknown>): Component[] => [
  { id: "root", component: "Column", gap: 2, children: ["recipe"] },
  {
    id: "recipe",
    component: "RecipeCard",
    title: p("/title"),
    ...Object.fromEntries(
      [
        "image",
        "time",
        "servings",
        "difficulty",
        "ingredients",
        "steps",
        "tags",
      ]
        .filter((k) => a[k] !== undefined)
        .map((k) => [k, a[k]]),
    ),
    ingredients: Array.isArray(a.ingredients) ? a.ingredients : [],
    steps: Array.isArray(a.steps) ? a.steps : [],
  },
];
export function recipeSurface(a: Record<string, unknown>): FixedSurface {
  return {
    template: "recipe",
    title: String(a.title ?? "Recipe"),
    components: RECIPE_TEMPLATE(a),
    data: { title: a.title },
    source: "Agent supplied",
  };
}

export const SIGNUP: Component[] = [
  {
    id: "root",
    component: "Card",
    children: ["head", "grid", "plan", "updates", "terms", "submit"],
  },
  { id: "head", component: "Column", gap: 1, children: ["title", "subtitle"] },
  { id: "title", component: "Title", size: "lg", text: p("/title") },
  { id: "subtitle", component: "Caption", text: p("/subtitle") },
  { id: "grid", component: "Grid", columns: 2, children: ["name", "email"] },
  {
    id: "name",
    component: "TextField",
    label: "Full name",
    placeholder: "Ada Lovelace",
    value: p("/form/name"),
  },
  {
    id: "email",
    component: "TextField",
    label: "Work email",
    placeholder: "ada@company.com",
    variant: "email",
    value: p("/form/email"),
  },
  {
    id: "plan",
    component: "RadioGroup",
    label: "Plan",
    variant: "cards",
    value: p("/form/plan"),
    options: [
      { value: "free", label: "Free", description: "For side projects" },
      { value: "pro", label: "Pro", description: "$24 per month" },
      { value: "team", label: "Team", description: "SSO and roles" },
    ],
  },
  {
    id: "updates",
    component: "Switch",
    label: "Product updates",
    description: "One email a month, no spam.",
    value: p("/form/updates"),
  },
  {
    id: "terms",
    component: "CheckBox",
    label: "I agree to the terms of service",
    value: p("/form/terms"),
  },
  {
    id: "submit",
    component: "Button",
    label: "Create account",
    variant: "primary",
    block: true,
    onClick: {
      event: {
        name: "signup_submit",
        context: {
          name: p("/form/name"),
          email: p("/form/email"),
          plan: p("/form/plan"),
          updates: p("/form/updates"),
          terms: p("/form/terms"),
        },
      },
    },
  },
];
export function signupSurface(a: Record<string, unknown>): FixedSurface {
  return {
    template: "signup",
    title: String(a.title ?? "Create your account"),
    components: SIGNUP,
    data: {
      title: a.title ?? "Create your account",
      subtitle: a.subtitle ?? "Takes less than a minute.",
      form: { name: "", email: "", plan: "pro", updates: true, terms: false },
    },
    source: "Template",
  };
}

/* ───────────── skeletons: the tree is known the moment the tool is picked ───────────── */

const LAYOUT = new Set(["Column", "Row", "Grid", "Card", "Section", "List"]);

/** Containers stay real (so the layout is exact); every leaf becomes a Blueprint frame until data lands. */
export function blueprintOf(components: Component[]): Component[] {
  return components.map((c) =>
    LAYOUT.has(c.component)
      ? c
      : { id: c.id, component: "Blueprint", of: c.component },
  );
}

/** Tool name -> template key + static tree, for the skeleton painted at tool pick. */
export const TEMPLATE_TREES: Record<
  string,
  { template: string; components: Component[] }
> = {
  show_weather: { template: "weather", components: WEATHER },
  show_places: { template: "places", components: PLACES },
  show_route: { template: "route", components: ROUTE },
  show_fx: { template: "fx", components: FX },
  show_stock: { template: "stock", components: STOCK },
  show_flights: { template: "flights", components: FLIGHTS },
  show_signup_form: { template: "signup", components: SIGNUP },
  show_profile: { template: "profile", components: PROFILE },
  show_receipt: { template: "receipt", components: RECEIPT },
  show_event: { template: "event", components: EVENT },
  show_recipe: { template: "recipe", components: RECIPE_TEMPLATE({}) },
};
