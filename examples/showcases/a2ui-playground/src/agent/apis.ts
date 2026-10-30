/**
 * Keyless data sources. Every function returns real data or throws; nothing
 * here invents numbers. Nominatim calls wait their turn in `paced` (1 per
 * second, its usage policy); `signal` takes a stopped run's out of the queue.
 */
import { paced } from "./geo";

const UA = "a2ui-playground/0.1 (CopilotKit A2UI demo)";

/** Fetch JSON with a timeout (and the run's signal, when given). No cache, so every run shows a real lookup time. */
async function getJson<T>(
  url: string,
  timeoutMs = 8000,
  signal?: AbortSignal,
): Promise<T> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${new URL(url).host} responded ${res.status}`);
  return (await res.json()) as T;
}

/* ───────────────────────── geocoding (Open-Meteo) ───────────────────────── */

export type Place = {
  name: string;
  country: string;
  admin?: string;
  lat: number;
  lon: number;
  timezone?: string;
};

export async function geocode(
  query: string,
  signal?: AbortSignal,
): Promise<Place> {
  // "Ueno, Tokyo" or "Alfama, Lisbon": a neighbourhood with its city. Open-Meteo only matches the first
  // token (and found a village called Uwano), so ask Nominatim with the full string first.
  if (query.includes(",")) {
    try {
      const rows = await paced(
        () =>
          getJson<
            Array<{
              lat: string;
              lon: string;
              name?: string;
              display_name?: string;
              address?: { country?: string; city?: string; state?: string };
            }>
          >(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=jsonv2&limit=1&addressdetails=1&accept-language=en`,
            5000,
          ),
        signal,
      );
      const r = rows[0];
      if (r)
        return {
          name: r.name || query.split(",")[0].trim(),
          country: r.address?.country ?? "",
          admin: r.address?.city ?? r.address?.state,
          lat: Number(r.lat),
          lon: Number(r.lon),
        };
    } catch {
      /* fall back to Open-Meteo, unless the run was stopped */
      signal?.throwIfAborted();
    }
  }
  const q = query.split(",")[0].trim();
  const j = await getJson<{
    results?: Array<{
      name: string;
      country: string;
      admin1?: string;
      latitude: number;
      longitude: number;
      timezone?: string;
    }>;
  }>(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`,
  );
  const r = j.results?.[0];
  if (!r) throw new Error(`Could not find a place called "${query}"`);
  return {
    name: r.name,
    country: r.country,
    admin: r.admin1,
    lat: r.latitude,
    lon: r.longitude,
    timezone: r.timezone,
  };
}

/* ───────────────────────── weather (Open-Meteo) ───────────────────────── */

const WMO: Record<number, [string, string]> = {
  0: ["Clear sky", "sun"],
  1: ["Mainly clear", "sun"],
  2: ["Partly cloudy", "cloud-sun"],
  3: ["Overcast", "cloud"],
  45: ["Fog", "fog"],
  48: ["Rime fog", "fog"],
  51: ["Light drizzle", "drizzle"],
  53: ["Drizzle", "drizzle"],
  55: ["Heavy drizzle", "drizzle"],
  61: ["Light rain", "rain"],
  63: ["Rain", "rain"],
  65: ["Heavy rain", "rain"],
  66: ["Freezing rain", "rain"],
  67: ["Freezing rain", "rain"],
  71: ["Light snow", "snow"],
  73: ["Snow", "snow"],
  75: ["Heavy snow", "snow"],
  77: ["Snow grains", "snow"],
  80: ["Rain showers", "rain"],
  81: ["Rain showers", "rain"],
  82: ["Violent showers", "rain"],
  85: ["Snow showers", "snow"],
  86: ["Snow showers", "snow"],
  95: ["Thunderstorm", "storm"],
  96: ["Thunderstorm, hail", "storm"],
  99: ["Thunderstorm, hail", "storm"],
};
export const describeWmo = (code: number) => WMO[code] ?? ["Unknown", "cloud"];

export type Weather = {
  place: Place;
  current: {
    temp: number;
    feels: number;
    humidity: number;
    wind: number;
    code: number;
    condition: string;
    icon: string;
    isDay: boolean;
    time: string;
  };
  hourly: Array<{
    time: string;
    label: string;
    temp: number;
    precip: number;
    icon: string;
  }>;
  daily: Array<{
    date: string;
    label: string;
    min: number;
    max: number;
    precip: number;
    condition: string;
    icon: string;
  }>;
  sunrise?: string;
  sunset?: string;
};

export async function getWeather(
  location: string,
  signal?: AbortSignal,
): Promise<Weather> {
  const place = await geocode(location, signal);
  const j = await getJson<any>(
    `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}` +
      `&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day` +
      `&hourly=temperature_2m,precipitation_probability,weather_code` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset` +
      `&timezone=auto&forecast_days=7`,
  );
  const now = j.current.time as string;
  const startIdx = Math.max(
    0,
    (j.hourly.time as string[]).findIndex((t) => t >= now.slice(0, 13)),
  );
  const hourly = (j.hourly.time as string[])
    .slice(startIdx, startIdx + 24)
    .map((t, k) => {
      const i = startIdx + k;
      return {
        time: t,
        label: t.slice(11, 16),
        temp: Math.round(j.hourly.temperature_2m[i]),
        precip: j.hourly.precipitation_probability[i] ?? 0,
        icon: describeWmo(j.hourly.weather_code[i])[1],
      };
    });
  const daily = (j.daily.time as string[]).map((d, i) => ({
    date: d,
    label:
      i === 0
        ? "Today"
        : new Date(`${d}T12:00:00`).toLocaleDateString("en-US", {
            weekday: "short",
          }),
    min: Math.round(j.daily.temperature_2m_min[i]),
    max: Math.round(j.daily.temperature_2m_max[i]),
    precip: j.daily.precipitation_probability_max[i] ?? 0,
    condition: describeWmo(j.daily.weather_code[i])[0],
    icon: describeWmo(j.daily.weather_code[i])[1],
  }));
  const [condition, icon] = describeWmo(j.current.weather_code);
  return {
    place,
    current: {
      temp: Math.round(j.current.temperature_2m),
      feels: Math.round(j.current.apparent_temperature),
      humidity: Math.round(j.current.relative_humidity_2m),
      wind: Math.round(j.current.wind_speed_10m),
      code: j.current.weather_code,
      condition,
      icon,
      isDay: j.current.is_day === 1,
      time: now,
    },
    hourly,
    daily,
    sunrise: j.daily.sunrise?.[0]?.slice(11, 16),
    sunset: j.daily.sunset?.[0]?.slice(11, 16),
  };
}

/* ───────────────────────── places (Nominatim, Photon fallback) ───────────────────────── */

export type Poi = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  address: string;
  category: string;
  distanceKm?: number;
  tags?: Record<string, string>;
  city?: string;
  state?: string;
};

/** OSM tags worth passing on when present (Nominatim extratags). Never filled in when missing. */
const POI_TAGS = [
  "internet_access",
  "internet_access:fee",
  "opening_hours",
  "outdoor_seating",
  "indoor_seating",
  "wheelchair",
  "cuisine",
];

function haversineKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const CATEGORY: Array<[RegExp, string]> = [
  [/coffee|caf[eé]|espresso/i, "cafe"],
  [/ramen|sushi|pizza|burger|taco|noodle|dumpling|bbq|steak/i, "restaurant"],
  [/restaurant|food|eat|dinner|lunch/i, "restaurant"],
  [/bar|pub|cocktail|beer/i, "bar"],
  [/museum|gallery/i, "museum"],
  [/park|garden/i, "park"],
  [/book/i, "bookshop"],
  [/bakery|bread|pastry/i, "bakery"],
  [/hotel|stay/i, "hotel"],
];

function normalizeQuery(what: string) {
  const w =
    what
      .trim()
      .replace(/\b(shops?|spots?|places?|near me|best|good)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim() || what;
  const cat = CATEGORY.find(([re]) => re.test(what))?.[1];
  return { text: w, category: cat };
}

async function nominatim(
  q: string,
  box: { w: number; e: number; n: number; s: number },
  limit: number,
  signal?: AbortSignal,
): Promise<Poi[]> {
  const rows = await paced(
    () =>
      getJson<any[]>(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&addressdetails=1&extratags=1&accept-language=en&limit=${limit + 4}` +
          `&viewbox=${box.w},${box.n},${box.e},${box.s}&bounded=1`,
        4500,
      ),
    signal,
  );
  return rows
    .filter((r) => r.name)
    .map((r) => ({
      id: String(r.osm_id),
      name: r.name as string,
      lat: Number(r.lat),
      lon: Number(r.lon),
      category: String(r.type ?? r.category ?? "place").replace(/_/g, " "),
      address: [
        r.address?.road &&
          `${r.address.road}${r.address.house_number ? ` ${r.address.house_number}` : ""}`,
        r.address?.suburb ?? r.address?.neighbourhood,
      ]
        .filter(Boolean)
        .join(", "),
      tags: pickTags(r.extratags),
      city: r.address?.city ?? r.address?.town ?? r.address?.village,
      state: r.address?.state,
    }));
}

function pickTags(extra: Record<string, string> | null | undefined) {
  if (!extra) return undefined;
  const out: Record<string, string> = {};
  for (const k of POI_TAGS)
    if (typeof extra[k] === "string" && extra[k]) out[k] = extra[k];
  return Object.keys(out).length ? out : undefined;
}

async function photon(
  q: string,
  box: { w: number; e: number; n: number; s: number },
  limit: number,
  signal?: AbortSignal,
): Promise<Poi[]> {
  const j = await getJson<any>(
    `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&bbox=${box.w},${box.s},${box.e},${box.n}&limit=${limit + 4}&lang=en`,
    6000,
    signal,
  );
  return (j.features as any[])
    .filter((f) => f.properties?.name)
    .map((f) => ({
      id: String(f.properties.osm_id),
      name: f.properties.name as string,
      lon: f.geometry.coordinates[0] as number,
      lat: f.geometry.coordinates[1] as number,
      category: String(f.properties.osm_value ?? "place").replace(/_/g, " "),
      address: [
        f.properties.street &&
          `${f.properties.street}${f.properties.housenumber ? ` ${f.properties.housenumber}` : ""}`,
        f.properties.district ?? f.properties.locality,
      ]
        .filter(Boolean)
        .join(", "),
      city: f.properties.city,
      state: f.properties.state,
    }));
}

export async function searchPlaces(
  what: string,
  near: string,
  limit = 8,
  signal?: AbortSignal,
): Promise<{ center: Place; places: Poi[]; source: string }> {
  const center = await geocode(near, signal);
  const d = 0.045; // ~5km box
  const box = {
    w: center.lon - d,
    e: center.lon + d,
    n: center.lat + d * 0.8,
    s: center.lat - d * 0.8,
  };
  const { text, category } = normalizeQuery(what);
  // Specific terms (e.g. "ramen") first, the OSM category as a fallback; Photon runs in parallel as a safety net.
  const queries = Array.from(
    new Set([text, category].filter(Boolean) as string[]),
  );
  const photonP = photon(category ?? text, box, limit, signal).catch(
    () => [] as Poi[],
  );
  let places: Poi[] = [];
  let source = "OpenStreetMap Nominatim";
  // Places are kept one per name (below), so lists are compared by how many names they hold.
  const distinct = (list: Poi[]) => new Set(list.map((p) => p.name)).size;
  // Each fallback replaces the result only when it found more, so an empty answer never discards places.
  for (const q of queries) {
    const found = await nominatim(q, box, limit, signal).catch(
      () => [] as Poi[],
    );
    if (distinct(found) > distinct(places)) places = found;
    if (distinct(places) >= 3) break;
  }
  if (distinct(places) < 3) {
    const fallback = await photonP;
    signal?.throwIfAborted();
    if (distinct(fallback) > distinct(places)) {
      source = "Photon (OpenStreetMap)";
      places = fallback;
    }
  }
  const seen = new Set<string>();
  places = places
    .filter((p) => (seen.has(p.name) ? false : (seen.add(p.name), true)))
    .map((p) => ({
      ...p,
      distanceKm: Math.round(haversineKm(center, p) * 10) / 10,
    }))
    .sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0))
    .slice(0, limit);
  if (!places.length) throw new Error(`No "${what}" found near ${center.name}`);
  return { center, places, source };
}

/* ───────────────────────── routes (OSRM public demo) ───────────────────────── */

export type Route = {
  from: Place;
  to: Place;
  distanceKm: number;
  durationMin: number;
  coordinates: Array<[number, number]>;
  profile: string;
};

export async function getRoute(
  from: string,
  to: string,
  profile: "driving" | "walking" | "cycling" = "driving",
  signal?: AbortSignal,
): Promise<Route> {
  const [a, b] = await Promise.all([
    geocode(from, signal),
    geocode(to, signal),
  ]);
  // The public demo server only ships the car profile; walking/cycling are estimated from distance.
  const j = await getJson<any>(
    `https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=simplified&geometries=geojson`,
    9000,
  );
  const r = j.routes?.[0];
  if (!r) throw new Error(`No route between ${a.name} and ${b.name}`);
  const km = r.distance / 1000;
  const speed = profile === "walking" ? 4.8 : profile === "cycling" ? 16 : 0;
  return {
    from: a,
    to: b,
    distanceKm: Math.round(km * 10) / 10,
    durationMin: Math.round(speed ? (km / speed) * 60 : r.duration / 60),
    coordinates: r.geometry.coordinates,
    profile,
  };
}

/* ───────────────────────── FX (Frankfurter / ECB, open.er-api fallback) ───────────────────────── */

export type Fx = {
  base: string;
  date: string;
  rates: Array<{ code: string; rate: number }>;
  history: Array<{ date: string; code: string; rate: number }>;
  source: string;
};

export async function getFx(
  base: string,
  symbols: string[],
  days = 30,
): Promise<Fx> {
  const B = base.toUpperCase();
  const S = symbols
    .map((s) => s.toUpperCase())
    .filter((s) => s !== B)
    .slice(0, 4);
  try {
    const end = new Date();
    const start = new Date(end.getTime() - days * 86400000);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const j = await getJson<any>(
      `https://api.frankfurter.dev/v1/${iso(start)}..${iso(end)}?base=${B}&symbols=${S.join(",")}`,
      3500,
    );
    const dates = Object.keys(j.rates).sort();
    const last = dates[dates.length - 1];
    return {
      base: B,
      date: last,
      rates: S.map((code) => ({ code, rate: j.rates[last][code] })),
      history: dates.flatMap((d) =>
        S.map((code) => ({ date: d, code, rate: j.rates[d][code] })),
      ),
      source: "Frankfurter (European Central Bank)",
    };
  } catch {
    const j = await getJson<any>(
      `https://open.er-api.com/v6/latest/${B}`,
      6000,
    );
    return {
      base: B,
      date: new Date(j.time_last_update_unix * 1000).toISOString().slice(0, 10),
      rates: S.map((code) => ({ code, rate: j.rates[code] })).filter(
        (r) => typeof r.rate === "number",
      ),
      history: [],
      source: "open.er-api.com (daily reference rates)",
    };
  }
}
