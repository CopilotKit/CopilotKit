/**
 * Jev use cases: the app owns the candidates, the prepared layouts and every label.
 * Jev only answers typed questions about them (which layout fits, how well each
 * candidate fits). The A2UI tree is then built here, deterministically, from those answers.
 *
 * Cafés are real: the server looks them up in OpenStreetMap (searchPlaces, the same lookup the
 * playground uses) and only the facts OSM has are passed to Jev and shown. Laptops are sample specs.
 *
 * Safe to import on the client and the server (no Node APIs).
 */
import { A2UI_VERSION } from "@copilotkit/shared";
import { CATALOG_ID } from "@/a2ui/catalog/ids";
import type { FlatNode } from "@/a2ui/macros/macro";
import { macros } from "@/a2ui/macros/macros";

export const JEV_MODEL = "jev-latest";

export type A2UIOp = Record<string, unknown>;
type Component = { id: string; component: string } & Record<string, unknown>;
export type Question =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] };

/** The answers we read back (TypeSafe systemOne answer types we use). */
export type Answers = Record<
  string,
  | { type: "choice"; choice: string; probabilities?: Record<string, number> }
  | { type: "score"; score: number; probabilities?: Record<string, number> }
  | { type: "boolean"; probability: number }
>;

export type Scored = { id: string; name: string; score: number; fit: number };

export type UseCase = {
  id: "cafes" | "laptops" | "spending";
  prompt: string;
  /** One choice question (the layout) plus one score question per candidate. */
  questions: () => Record<string, Question>;
  state: (prompt: string) => Record<string, unknown>;
  candidates: Array<{ id: string; name: string }>;
  layouts: Record<string, string>;
  /** Prepared templates: layout id + ranked candidates -> components and data. */
  build: (
    layout: string,
    ranked: Scored[],
  ) => { components: Component[]; data: Record<string, unknown> };
};

const p = (path: string) => ({ "@path": path });
const FIT_LEVELS = ["Poor fit", "Weak fit", "Good fit", "Strong fit"];
const toFit = (score: number) =>
  Math.round((score / (FIT_LEVELS.length - 1)) * 100);

/* ───────────── cafés (real places from OpenStreetMap) ───────────── */

/** A café exactly as the lookup returned it. `tags` holds only the OSM tags that exist. */
export type CafePlace = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  address: string;
  distanceKm?: number;
  tags?: Record<string, string>;
};

const CITY_ALIASES: Array<[RegExp, string]> = [
  [/^(sf|s\.f\.|san fran|frisco)$/i, "San Francisco"],
  [/^(nyc|ny|new york city|manhattan)$/i, "New York"],
  [/^(la|l\.a\.)$/i, "Los Angeles"],
  [/^(dc|d\.c\.)$/i, "Washington, D.C."],
];

/** "... café in new york where I can work ..." -> "New York". No place named -> San Francisco. */
export function parseWhere(prompt: string): { query: string; slug: string } {
  const m = prompt.match(
    /\b(?:in|near|around|at)\s+([A-Za-z.' -]+?)(?=\s+(?:where|for|to|that|with|so|and|today|tonight|this|which)\b|[,.!?]|$)/i,
  );
  let raw = (m?.[1] ?? "").trim();
  if (!raw || /^(a|the|my|work)$/i.test(raw)) raw = "San Francisco";
  const alias = CITY_ALIASES.find(([re]) => re.test(raw))?.[1];
  const query = alias ?? raw.replace(/\b\w/g, (c) => c.toUpperCase());
  return {
    query,
    slug: query
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, ""),
  };
}

const hasWifi = (c: CafePlace) => {
  const v = c.tags?.internet_access;
  return v == null ? null : !/^(no|none)$/i.test(v);
};

/** "Van Ness Avenue 401, Civic Center" (OSM order) -> "401 Van Ness Avenue, Civic Center". */
const usAddress = (a: string) =>
  a.replace(/^([^,\d]+?) (\d+[A-Za-z]?)(?=,|$)/, "$2 $1");

/** One line of facts for a list row. Only what OSM has; nothing filled in. */
function factLine(c: CafePlace) {
  const wifi = hasWifi(c);
  const parts = [
    c.distanceKm != null
      ? c.distanceKm < 1
        ? `${Math.round(c.distanceKm * 1000)} m`
        : `${c.distanceKm.toFixed(1)} km`
      : null,
    c.address ? usAddress(c.address).split(",")[0] : null,
    wifi === true ? "wifi listed" : wifi === false ? "no wifi listed" : null,
    c.tags?.outdoor_seating === "yes" ? "outdoor seating" : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

const CAFE_LAYOUTS = {
  map_list:
    "A ranked shortlist of several cafés beside a map, so the user can weigh nearby options and pick one.",
  compare:
    "A feature table of the top few cafés. Best when the user asks to compare cafés they named.",
  single:
    "Details for one specific café. Only when the user names a café or asks about a single place.",
};

/** The cafés use case for one lookup result. */
export function cafesFor(city: string, places: CafePlace[]): UseCase {
  return {
    id: "cafes",
    prompt: USE_CASES.cafes.prompt,
    candidates: places.map(({ id, name }) => ({ id, name })),
    layouts: CAFE_LAYOUTS,
    state: (prompt) => ({
      request: prompt,
      city,
      cafes: places.map((c) => ({
        id: c.id,
        name: c.name,
        address: c.address || undefined,
        distanceKmFromCenter: c.distanceKm,
        osmTags: c.tags ?? {},
      })),
      note: "Facts come from OpenStreetMap. A missing tag means unknown, not absent.",
    }),
    questions() {
      const q: Record<string, Question> = {
        layout: {
          type: "choice",
          instructions: `The user wants a café recommendation and there are ${places.length} candidate cafés. Which prepared layout should present the answer?`,
          criteria: CAFE_LAYOUTS,
        },
      };
      for (const c of places) {
        q[`fit_${c.id}`] = {
          type: "score",
          instructions: `How well does the café "${c.name}" (id ${c.id}) fit the request? Use only the facts given for it (distance, address, OpenStreetMap tags such as internet access, opening hours, seating). Treat a missing fact as unknown.`,
          criteria: FIT_LEVELS,
        };
      }
      return q;
    },
    build(layout, ranked) {
      const byId = new Map(places.map((c) => [c.id, c]));
      const rows = ranked.map((r) => ({ ...byId.get(r.id)!, fit: r.fit }));
      const top = rows[0];
      if (layout === "compare") {
        const four = rows.slice(0, 4);
        const wifi = (c: CafePlace) =>
          hasWifi(c) === null ? "not listed" : hasWifi(c) ? "listed" : "no";
        return {
          components: [
            {
              id: "root",
              component: "ComparisonTable",
              title: `Cafés in ${city}, side by side`,
              options: four.map((c) => c.name),
              highlight: 0,
              rows: [
                { feature: "Fit", values: four.map((c) => `${c.fit}%`) },
                {
                  feature: "Distance",
                  values: four.map((c) =>
                    c.distanceKm != null ? `${c.distanceKm} km` : "not listed",
                  ),
                },
                { feature: "Wifi", values: four.map(wifi) },
                {
                  feature: "Address",
                  values: four.map((c) =>
                    c.address ? usAddress(c.address) : "not listed",
                  ),
                },
              ],
            },
          ],
          data: {},
        };
      }
      if (layout === "single") {
        return {
          components: [
            {
              id: "root",
              component: "LocationCard",
              name: top.name,
              address: top.address ? usAddress(top.address) : undefined,
              lat: top.lat,
              lon: top.lon,
              category: `${top.fit}% fit`,
              hours: top.tags?.opening_hours,
            },
          ],
          data: {},
        };
      }
      // map_list (default): the catalog's list + map, best fit first and selected, on the street basemap.
      return {
        components: [
          {
            id: "root",
            component: "PlaceList",
            title: `Cafés in ${city}, best fit first`,
            places: p("/places"),
            selected: 0,
            height: 452,
            basemap: "streets",
          },
        ],
        data: {
          places: rows.map((c) => ({
            id: c.id,
            name: c.name,
            lat: c.lat,
            lon: c.lon,
            address: factLine(c),
            category: `${c.fit}% fit`,
          })),
        },
      };
    },
  };
}

const cafes = {
  id: "cafes" as const,
  prompt: "Find a quiet café in SF where I can work on my laptop for 2 hours",
  layouts: CAFE_LAYOUTS,
};

/* ───────────── laptops ───────────── */

type Laptop = {
  id: string;
  name: string;
  price: number;
  kg: number;
  battery: number;
  screen: string;
  memory: string;
  chip: string;
};

export const LAPTOPS: Laptop[] = [
  {
    id: "air13",
    name: "MacBook Air 13",
    price: 999,
    kg: 1.24,
    battery: 18,
    screen: '13.6"',
    memory: "16 GB",
    chip: "Apple M4",
  },
  {
    id: "zen14",
    name: "Zenbook 14 OLED",
    price: 1099,
    kg: 1.2,
    battery: 15,
    screen: '14" OLED',
    memory: "16 GB",
    chip: "Core Ultra 7",
  },
  {
    id: "xps13",
    name: "Dell XPS 13",
    price: 1299,
    kg: 1.19,
    battery: 14,
    screen: '13.4"',
    memory: "16 GB",
    chip: "Snapdragon X Elite",
  },
  {
    id: "fw13",
    name: "Framework Laptop 13",
    price: 1049,
    kg: 1.3,
    battery: 10,
    screen: '13.5"',
    memory: "16 GB",
    chip: "Ryzen AI 5",
  },
  {
    id: "surface",
    name: "Surface Laptop 13.8",
    price: 999,
    kg: 1.34,
    battery: 20,
    screen: '13.8"',
    memory: "16 GB",
    chip: "Snapdragon X Plus",
  },
  {
    id: "x1",
    name: "ThinkPad X1 Carbon",
    price: 1749,
    kg: 1.09,
    battery: 15,
    screen: '14"',
    memory: "32 GB",
    chip: "Core Ultra 7",
  },
  {
    id: "blade14",
    name: "Razer Blade 14",
    price: 2299,
    kg: 1.84,
    battery: 8,
    screen: '14" 120 Hz',
    memory: "32 GB",
    chip: "Ryzen 9",
  },
];

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

const laptops: UseCase = {
  id: "laptops",
  prompt: "A light laptop for travel and coding, under $1,600",
  candidates: LAPTOPS.map(({ id, name }) => ({ id, name })),
  layouts: {
    compare_table:
      "Feature matrix of the top options side by side. Best when the user weighs a few options on specs and price.",
    cards: "Product cards in a grid, one per laptop. Best for browsing.",
    table:
      "Sortable table of every option. Best when the user wants the full list.",
  },
  state: (prompt) => ({
    request: prompt,
    laptops: LAPTOPS.map((l) => ({
      ...l,
      price: usd(l.price),
      weight: `${l.kg} kg`,
      battery: `${l.battery} h`,
    })),
  }),
  questions() {
    const q: Record<string, Question> = {
      layout: {
        type: "choice",
        instructions:
          "Choose the prepared layout that best presents laptop options for this request.",
        criteria: this.layouts,
      },
    };
    for (const l of LAPTOPS) {
      q[`fit_${l.id}`] = {
        type: "score",
        instructions: `How well does the laptop "${l.name}" (id ${l.id}) fit the request? Weigh price against the budget, weight and battery for travel, and memory for coding.`,
        criteria: FIT_LEVELS,
      };
    }
    return q;
  },
  build(layout, ranked) {
    const byId = new Map(LAPTOPS.map((l) => [l.id, l]));
    const rows = ranked.map((r) => ({ ...byId.get(r.id)!, fit: r.fit }));
    if (layout === "cards") {
      const six = rows.slice(0, 6);
      return {
        components: [
          {
            id: "root",
            component: "Grid",
            columns: 3,
            children: six.map((l) => `card-${l.id}`),
          },
          ...six.map((l, i) => ({
            id: `card-${l.id}`,
            component: "ProductCard",
            name: l.name,
            price: usd(l.price),
            badge: i === 0 ? "Best fit" : `${l.fit}% fit`,
            specs: [`${l.kg} kg`, `${l.battery} h battery`, l.memory],
          })),
        ],
        data: {},
      };
    }
    if (layout === "table") {
      return {
        components: [
          {
            id: "root",
            component: "DataTable",
            title: "Laptops by fit",
            columns: [
              { key: "name", label: "Laptop" },
              { key: "fit", label: "Fit", format: "percent", align: "right" },
              {
                key: "price",
                label: "Price",
                format: "currency",
                align: "right",
              },
              {
                key: "kg",
                label: "Weight (kg)",
                format: "number",
                align: "right",
              },
              {
                key: "battery",
                label: "Battery (h)",
                format: "number",
                align: "right",
              },
            ],
            rows: p("/rows"),
          },
        ],
        data: {
          rows: rows.map((l) => ({
            name: l.name,
            fit: l.fit / 100,
            price: l.price,
            kg: l.kg,
            battery: l.battery,
          })),
        },
      };
    }
    // compare_table (default)
    const four = rows.slice(0, 4);
    return {
      components: [
        {
          id: "root",
          component: "ComparisonTable",
          title: "Light laptops, side by side",
          options: four.map((l) => l.name),
          highlight: 0,
          rows: [
            { feature: "Fit", values: four.map((l) => `${l.fit}%`) },
            { feature: "Price", values: four.map((l) => usd(l.price)) },
            { feature: "Weight", values: four.map((l) => `${l.kg} kg`) },
            { feature: "Battery", values: four.map((l) => `${l.battery} h`) },
            { feature: "Memory", values: four.map((l) => l.memory) },
            {
              feature: "Under $1,600",
              values: four.map((l) => l.price <= 1600),
            },
          ],
        },
      ],
      data: {},
    };
  },
};

/* ───────────── spending (sample household data) ───────────── */

const MONTHS = ["May", "Jun", "Jul", "Aug", "Sep", "Oct"];
/** Sample monthly spending in USD, rent excluded. Labelled as sample data in the chart subtitle. */
export const SPENDING: Array<{ id: string; name: string; values: number[] }> = [
  {
    id: "groceries",
    name: "Groceries",
    values: [520, 540, 510, 560, 545, 590],
  },
  { id: "dining", name: "Dining out", values: [310, 360, 420, 480, 540, 610] },
  { id: "shopping", name: "Shopping", values: [240, 410, 220, 260, 300, 280] },
  {
    id: "transport",
    name: "Transport",
    values: [180, 175, 190, 210, 185, 200],
  },
  { id: "travel", name: "Travel", values: [0, 120, 860, 90, 0, 150] },
  {
    id: "subscriptions",
    name: "Subscriptions",
    values: [96, 96, 112, 112, 128, 128],
  },
];

const SPEND_LAYOUTS = {
  month_bar:
    "Bars by category for the latest month only. Best when the user asks where the money went this month.",
  trend_area:
    "Stacked area of all categories over six months. Best when the user asks how spending is changing over time.",
  focus_line:
    "One line per category over six months. Best when the user asks about one category that is changing fast.",
};

const usd0 = (n: number) => `$${n.toLocaleString("en-US")}`;
const pct = (a: number, b: number) =>
  a > 0 ? Math.round(((b - a) / a) * 100) : null;

/** The deterministic one-liner for the category Jev scored highest: numbers from the data, no prose from a model. */
function spendLine(c: (typeof SPENDING)[number]) {
  const last = c.values[c.values.length - 1];
  const change = pct(c.values[0], last);
  return change == null
    ? `${usd0(last)} in ${MONTHS[MONTHS.length - 1]}.`
    : `${usd0(last)} in ${MONTHS[MONTHS.length - 1]}, ${change >= 0 ? "up" : "down"} ${Math.abs(change)}% since ${MONTHS[0]}.`;
}

const spending: UseCase = {
  id: "spending",
  prompt: "Where is my money going this month?",
  candidates: SPENDING.map(({ id, name }) => ({ id, name })),
  layouts: SPEND_LAYOUTS,
  state: (prompt) => ({
    request: prompt,
    currency: "USD",
    months: MONTHS,
    note: "Monthly spending by category, rent excluded.",
    categories: SPENDING.map((c) => ({
      id: c.id,
      name: c.name,
      monthly: Object.fromEntries(MONTHS.map((m, i) => [m, c.values[i]])),
    })),
  }),
  questions() {
    const q: Record<string, Question> = {
      layout: {
        type: "choice",
        instructions: "Which prepared chart view best answers the request?",
        criteria: SPEND_LAYOUTS,
      },
    };
    for (const c of SPENDING) {
      q[`fit_${c.id}`] = {
        type: "score",
        instructions: `How much should the user look at "${c.name}" (id ${c.id}) to answer the request? Weigh its size this month and how fast it is changing.`,
        criteria: [
          "Ignore",
          "Glance at it",
          "Worth a look",
          "Look at it first",
        ],
      };
    }
    return q;
  },
  build(layout, ranked) {
    const top = SPENDING.find((c) => c.id === ranked[0].id)!;
    const subtitle = "Sample household data, USD, rent excluded";
    const callout = {
      id: "callout",
      component: "Callout",
      title: `Look first: ${top.name}`,
      text: spendLine(top),
    };
    const all = SPENDING.flatMap((c) =>
      c.values.map((y, i) => ({ x: MONTHS[i], y, series: c.name })),
    );
    if (layout === "trend_area") {
      return {
        components: [
          {
            id: "root",
            component: "Column",
            gap: 3,
            children: ["chart", "callout"],
          },
          {
            id: "chart",
            component: "AreaChart",
            title: "Spending by category, last 6 months",
            subtitle,
            format: "currency",
            stacked: true,
            height: 300,
            highlight: top.name,
            data: p("/series"),
          },
          callout,
        ],
        data: { series: all },
      };
    }
    if (layout === "focus_line") {
      return {
        components: [
          {
            id: "root",
            component: "Column",
            gap: 3,
            children: ["chart", "callout"],
          },
          {
            id: "chart",
            component: "LineChart",
            title: "Each category, last 6 months",
            subtitle,
            format: "currency",
            height: 300,
            highlight: top.name,
            data: p("/series"),
          },
          callout,
        ],
        data: { series: all },
      };
    }
    // month_bar (default): this month, largest first, Jev's top category in the accent.
    const order = [...SPENDING].sort((a, b) => b.values[5] - a.values[5]);
    return {
      components: [
        {
          id: "root",
          component: "Column",
          gap: 3,
          children: ["chart", "callout"],
        },
        {
          id: "chart",
          component: "BarChart",
          title: `${MONTHS[5]} spending by category`,
          subtitle,
          format: "currency",
          height: 300,
          stacked: true,
          horizontal: true,
          highlight: "Look first",
          data: p("/bars"),
        },
        callout,
      ],
      data: {
        bars: order.map((c) => ({
          x: c.name,
          y: c.values[5],
          series: c.id === top.id ? "Look first" : "Other categories",
        })),
      },
    };
  },
};

export const USE_CASES = { cafes, laptops, spending } as const;
export type UseCaseId = keyof typeof USE_CASES;

/** Reads Jev's answers: the chosen layout and every candidate's fit, best first. Fails loudly on a missing answer. */
export function readAnswers(uc: UseCase, answers: Answers) {
  const layout = answers.layout;
  if (layout?.type !== "choice" || !(layout.choice in uc.layouts))
    throw new Error("Jev returned no usable layout choice");
  const ranked: Scored[] = uc.candidates
    .map((c) => {
      const a = answers[`fit_${c.id}`];
      if (a?.type !== "score" || !Number.isFinite(a.score))
        throw new Error(`Jev returned no score for ${c.id}`);
      return { id: c.id, name: c.name, score: a.score, fit: toFit(a.score) };
    })
    .sort((a, b) => b.score - a.score);
  return {
    layout: layout.choice,
    layoutProbabilities: layout.probabilities ?? {},
    ranked,
  };
}

/** The surface as one A2UI v1.0 operation: createSurface with its components and data model inline. */
export function toOps(
  surfaceId: string,
  built: { components: Component[]; data: Record<string, unknown> },
): A2UIOp[] {
  // ProductCard is a macro: it expands into standard components before it leaves.
  const components = macros.expandSync(
    built.components as FlatNode[],
  ).components;
  return [
    {
      version: A2UI_VERSION,
      createSurface: {
        surfaceId,
        catalogId: CATALOG_ID,
        components,
        dataModel: built.data,
      },
    },
  ];
}
