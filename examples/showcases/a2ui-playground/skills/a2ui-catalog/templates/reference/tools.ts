// Reference implementation copied from the a2ui-playground build (working, measured).
// Paths like @/a2ui/... are app-specific: adapt imports to your project.
/**
 * Router tools.
 *
 *  - FIXED_TOOLS (show_*): fetch or receive data, drop it into a pre-authored
 *    surface template. No model writes UI, so they paint as soon as data lands.
 *  - DATA_TOOLS (get_*): fetch real data for the dynamic composer.
 */
import { getFx, getRoute, getWeather, searchPlaces } from "./apis";
import type { FixedSurface } from "./surfaces/types";
import { eventSurface, flightsSurface, fxSurface, placesSurface, profileSurface, receiptSurface, recipeSurface, routeSurface, signupSurface, stockSurface, weatherSurface } from "./surfaces/templates";

export type ToolSpec = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run?: (args: Record<string, unknown>) => Promise<FixedSurface>;
  fetch?: (args: Record<string, unknown>) => Promise<unknown>;
};

const obj = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", properties, required, additionalProperties: false });
const str = (description: string) => ({ type: "string", description });

const num = (description: string) => ({ type: "number", description });
const arr = (items: Record<string, unknown>, description: string) => ({ type: "array", items, description });

export const FIXED_TOOLS: ToolSpec[] = [
  {
    name: "show_weather",
    description: "Weather now + hourly + 7-day forecast for a city (live).",
    parameters: obj({ location: str("City, e.g. 'Lisbon'") }, ["location"]),
    run: async (a) => weatherSurface(await getWeather(String(a.location))),
  },
  {
    name: "show_places",
    description: "Map + ranked list of real places of a kind near a city (live OpenStreetMap).",
    parameters: obj({ what: str("e.g. 'coffee', 'museum', 'park'"), near: str("City or area") }, ["what", "near"]),
    run: async (a) => {
      const r = await searchPlaces(String(a.what), String(a.near));
      return placesSurface(String(a.what), r.center, r.places, r.source);
    },
  },
  {
    name: "show_route",
    description: "Driving route on a map between two places with distance and time (live OSRM).",
    parameters: obj({ from: str("Start place"), to: str("Destination") }, ["from", "to"]),
    run: async (a) => routeSurface(await getRoute(String(a.from), String(a.to))),
  },
  {
    name: "show_fx",
    description: "Currency exchange rates with 30-day trend and conversion table (live).",
    parameters: obj({ base: str("Base currency code"), symbols: arr({ type: "string" }, "Quote currency codes, max 4") }, ["base", "symbols"]),
    run: async (a) => fxSurface(await getFx(String(a.base), (a.symbols as string[]) ?? ["EUR"])),
  },
  {
    name: "show_stock",
    description: "Stock quote dashboard for one ticker (sample data, labelled as such).",
    parameters: obj({ symbol: str("Ticker"), name: str("Company name") }, ["symbol", "name"]),
    run: async (a) => stockSurface(String(a.symbol), String(a.name ?? "")),
  },
  {
    name: "show_flights",
    description: "Flight options between two airports (sample fares, labelled).",
    parameters: obj({ from: str("Origin IATA code"), to: str("Destination IATA code"), date: str("Date, e.g. 'Fri 24 Oct'") }, ["from", "to", "date"]),
    run: async (a) => flightsSurface(String(a.from), String(a.to), a.date ? String(a.date) : undefined),
  },
  {
    name: "show_signup_form",
    description: "Account signup form (name, email, plan, updates, terms) with two-way bound inputs.",
    parameters: obj({ title: str("Form title"), subtitle: str("One line under the title") }, ["title", "subtitle"]),
    run: async (a) => signupSurface(a),
  },
  {
    name: "show_profile",
    description: "Person/contact card. You supply the details.",
    parameters: obj(
      { name: str("Name"), role: str("Role"), company: str("Company"), location: str("City"), bio: str("1-2 sentences"), email: str("Email"), tags: arr({ type: "string" }, "Skills"), stats: arr(obj({ label: str(""), value: str("") }, ["label", "value"]), "2-3 stats") },
      ["name", "role", "company", "location", "bio", "email", "tags", "stats"],
    ),
    run: async (a) => profileSurface(a),
  },
  {
    name: "show_receipt",
    description: "Order receipt. You supply merchant and line items.",
    parameters: obj(
      { merchant: str("Merchant"), orderId: str("Order id"), date: str("Date"), status: str("e.g. Paid"), items: arr(obj({ name: str(""), qty: num(""), price: num("unit price") }, ["name", "qty", "price"]), "Line items"), tax: num("Tax amount"), shipping: num("Shipping"), payment: str("e.g. Visa 4242") },
      ["merchant", "orderId", "date", "status", "items", "tax", "shipping", "payment"],
    ),
    run: async (a) => receiptSurface(a),
  },
  {
    name: "show_event",
    description: "Event card with RSVP and agenda timeline. You supply the details.",
    parameters: obj(
      { title: str("Title"), date: str("e.g. Thu 30 Oct"), time: str("e.g. 18:30"), venue: str("Venue"), host: str("Host"), description: str("1-2 sentences"), attendees: num("Count"), agenda: arr(obj({ time: str(""), title: str("") }, ["time", "title"]), "3-6 agenda items") },
      ["title", "date", "time", "venue", "host", "description", "attendees", "agenda"],
    ),
    run: async (a) => eventSurface(a),
  },
  {
    name: "show_recipe",
    description: "Recipe card with ingredients checklist and steps. You supply it.",
    parameters: obj(
      { title: str("Dish"), time: str("e.g. 35 min"), servings: num("Servings"), difficulty: str("Easy|Medium|Hard"), ingredients: arr({ type: "string" }, "With quantities"), steps: arr({ type: "string" }, "Steps") },
      ["title", "time", "servings", "difficulty", "ingredients", "steps"],
    ),
    run: async (a) => recipeSurface(a),
  },
];

export const DATA_TOOLS: ToolSpec[] = [
  {
    name: "get_weather",
    description: "Fetch live weather + forecast for a city, for a custom UI.",
    parameters: obj({ location: str("City") }, ["location"]),
    fetch: async (a) => {
      const w = await getWeather(String(a.location));
      return { ...w, hourly: w.hourly.filter((_, i) => i % 3 === 0), source: "Open-Meteo" };
    },
  },
  {
    name: "get_places",
    description: "Search real places of ONE kind near a city (e.g. cafes, ramen, museums). Not for itineraries or trip plans: those name their own stops.",
    parameters: obj({ what: str("What to search, e.g. 'coffee'"), near: str("City or area") }, ["what", "near"]),
    fetch: async (a) => searchPlaces(String(a.what), String(a.near)),
  },
  {
    name: "get_route",
    description: "Driving route (distance, duration, polyline) between two places.",
    parameters: obj({ from: str("Start"), to: str("Destination") }, ["from", "to"]),
    fetch: async (a) => {
      const r = await getRoute(String(a.from), String(a.to));
      const step = Math.max(1, Math.floor(r.coordinates.length / 40));
      return { ...r, coordinates: r.coordinates.filter((_, i) => i % step === 0), source: "OSRM" };
    },
  },
  {
    name: "get_fx",
    description: "Currency exchange rates (latest + 30 day history).",
    parameters: obj({ base: str("Base currency, e.g. USD"), symbols: { type: "array", items: { type: "string" }, description: "Quote currencies" } }, ["base", "symbols"]),
    fetch: async (a) => getFx(String(a.base), (a.symbols as string[]) ?? ["EUR"]),
  },
];
