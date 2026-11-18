/**
 * Geo-repair for composed map components.
 *
 * The composer knows WHICH places belong on a trip map (Senso-ji, Ueno Park,
 * Shibuya Crossing) but its coordinates are guesses: in one run every Tokyo pin
 * landed in Nakano and one stop was "Tokyo" itself. Here every marker is
 * geocoded by name with OpenStreetMap Nominatim, bounded to a box around the
 * model's own pins, so pins match the plan:
 *   - the found coordinates replace the guessed ones
 *   - stops that resolve to a whole city/region/country are dropped
 *   - markers that cannot be found keep their coordinates but are marked unverified
 *
 * Nominatim allows 1 request per second, so lookups go through one paced queue
 * and are cached.
 */
const UA = "a2ui-playground/0.1 (CopilotKit A2UI demo)";
const AREA_TYPES = new Set([
  "city",
  "state",
  "country",
  "province",
  "region",
  "county",
  "state_district",
  "municipality",
  "town",
  "administrative",
]);

type Hit = {
  lat: number;
  lon: number;
  area: boolean;
  label: string;
  bbox?: [number, number, number, number];
} | null;
const cache = new Map<string, Hit>();
let chain: Promise<unknown> = Promise.resolve();
let lastAt = 0;

/** Serializes Nominatim calls at >= 1.05 s apart (usage policy). */
function paced<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = Math.max(0, lastAt + 1050 - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
    return fn();
  });
  chain = run.catch(() => undefined);
  return run;
}

type Box = { w: number; s: number; e: number; n: number };

const PHOTON_AREA = new Set([
  "city",
  "state",
  "country",
  "county",
  "district",
  "region",
]);

async function photon(name: string, box: Box | null): Promise<Hit> {
  try {
    const url =
      `https://photon.komoot.io/api/?q=${encodeURIComponent(name)}&limit=1&lang=en` +
      (box ? `&bbox=${box.w},${box.s},${box.e},${box.n}` : "");
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return null;
    const f = (
      (await res.json()) as {
        features?: Array<{
          geometry: { coordinates: [number, number] };
          properties: {
            type?: string;
            name?: string;
            extent?: [number, number, number, number];
          };
        }>;
      }
    ).features?.[0];
    if (!f) return null;
    const ext = f.properties.extent; // [west, north, east, south]
    return {
      lat: f.geometry.coordinates[1],
      lon: f.geometry.coordinates[0],
      area: PHOTON_AREA.has(f.properties.type ?? ""),
      label: f.properties.name ?? name,
      bbox: ext ? [ext[3], ext[1], ext[0], ext[2]] : undefined,
    };
  } catch {
    return null;
  }
}

async function nominatim(
  name: string,
  box: Box | null,
  settled: { done: boolean },
): Promise<Hit> {
  return paced(async () => {
    if (settled.done) return null; // Photon already answered: do not spend a rate-limited request
    try {
      const url =
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(name)}&format=jsonv2&limit=1&accept-language=en` +
        (box ? `&viewbox=${box.w},${box.n},${box.e},${box.s}&bounded=1` : "");
      const res = await fetch(url, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return null;
      const rows = (await res.json()) as Array<{
        lat: string;
        lon: string;
        addresstype?: string;
        type?: string;
        category?: string;
        display_name?: string;
        boundingbox?: string[];
      }>;
      const r = rows[0];
      if (!r) return null;
      const area =
        AREA_TYPES.has(r.addresstype ?? "") ||
        (r.category === "boundary" &&
          r.type === "administrative" &&
          /^(city|state|country)/.test(r.addresstype ?? ""));
      const bb = r.boundingbox?.map(Number) as
        | [number, number, number, number]
        | undefined; // [south, north, west, east]
      return {
        lat: Number(r.lat),
        lon: Number(r.lon),
        area,
        label: r.display_name ?? name,
        bbox: bb,
      };
    } catch {
      return null;
    }
  });
}

/** First non-empty answer from Nominatim (paced, 1 req/s) or Photon (parallel). Cached. */
async function lookup(name: string, box: Box | null): Promise<Hit> {
  const key = `${name.toLowerCase()}|${box ? [box.w, box.s, box.e, box.n].map((v) => v.toFixed(1)).join(",") : "-"}`;
  if (cache.has(key)) return cache.get(key)!;
  const settled = { done: false };
  const first = <T>(p: Promise<T | null>) =>
    p.then((v) => (v ? v : Promise.reject(new Error("empty"))));
  const hit = await Promise.any([
    first(nominatim(name, box, settled)),
    first(photon(name, box)),
  ]).catch(() => null);
  settled.done = true;
  cache.set(key, hit);
  return hit;
}

function median(xs: number[]) {
  const a = [...xs].sort((x, y) => x - y);
  return a.length ? a[Math.floor(a.length / 2)] : 0;
}

type Marker = {
  name?: string;
  lat?: number;
  lon?: number;
  [k: string]: unknown;
};
export type GeoNote = {
  geocoded: number;
  dropped: string[];
  unverified: string[];
};

/** Re-geocodes the marker list of one map component. Returns null when there is nothing to fix. */
export async function repairMarkers(
  markers: Marker[],
  hint?: string,
): Promise<{ markers: Marker[]; note: GeoNote } | null> {
  const named = markers.filter(
    (m) => typeof m?.name === "string" && m.name.trim(),
  );
  if (!named.length) return null;
  const lats = named.map((m) => Number(m.lat)).filter(Number.isFinite);
  const lons = named.map((m) => Number(m.lon)).filter(Number.isFinite);
  // A generous box around the model's own pins (~45 km): enough to recover a mis-placed cluster in the right city.
  const box: Box | null = lats.length
    ? {
        w: median(lons) - 0.45,
        e: median(lons) + 0.45,
        s: median(lats) - 0.4,
        n: median(lats) + 0.4,
      }
    : null;
  const note: GeoNote = { geocoded: 0, dropped: [], unverified: [] };
  const hits: Hit[] = await Promise.all(
    named.map(async (m) => {
      const name = String(m.name).trim();
      const hit = await lookup(name, box);
      return hit ?? (hint ? lookup(`${name}, ${hint}`, null) : null);
    }),
  );
  const points = hits.filter((h): h is NonNullable<Hit> => !!h && !h.area);
  const out: Marker[] = [];
  named.forEach((m, i) => {
    const name = String(m.name).trim();
    const hit = hits[i];
    // An area (city, ward, region) is a stop only when it is not the area that contains the trip:
    // "Tokyo" encloses Senso-ji and Shibuya Crossing, so it is dropped; "Shibuya" does not enclose the others, so it stays.
    if (hit?.area && hit.bbox) {
      const [s, n, w, e] = hit.bbox;
      const inside = points.filter(
        (p) => p.lat >= s && p.lat <= n && p.lon >= w && p.lon <= e,
      ).length;
      if (
        (points.length >= 2 && inside / points.length >= 0.6) ||
        n - s > 1.5
      ) {
        note.dropped.push(name);
        return;
      }
    }
    if (hit) {
      note.geocoded++;
      out.push({
        ...m,
        lat: Math.round(hit.lat * 1e6) / 1e6,
        lon: Math.round(hit.lon * 1e6) / 1e6,
      });
    } else {
      note.unverified.push(name);
      out.push(m);
    }
  });
  return { markers: out, note };
}

/** Map components and the prop that holds their points. */
export const MAP_POINT_PROPS: Record<string, string> = {
  MapView: "markers",
  PlaceList: "places",
};
