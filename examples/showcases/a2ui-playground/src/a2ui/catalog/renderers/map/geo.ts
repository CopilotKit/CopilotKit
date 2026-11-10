/** Pure geo helpers shared by the map renderers. No React, no window. */

export const BASEMAP_STYLE =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
/** Light street map (CARTO Voyager, keyless): blue water, coloured roads and parks. */
export const STREETS_STYLE =
  "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json";
/** Light street map with 3D-ready buildings (OpenFreeMap Liberty, keyless). */
export const LIBERTY_STYLE = "https://tiles.openfreemap.org/styles/liberty";

export type LngLat = [number, number];

export type MapPoint = {
  id?: string;
  name: string;
  lat: number;
  lon: number;
  description?: string;
  category?: string;
};

const finite = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n);

export function isLngLat(lon: unknown, lat: unknown): boolean {
  return (
    finite(lon) &&
    finite(lat) &&
    lon >= -180 &&
    lon <= 180 &&
    lat >= -90 &&
    lat <= 90
  );
}

/** Keep only points that can be drawn; tolerates partial objects while streaming. */
export function validPoints<T extends Partial<MapPoint>>(
  raw: unknown,
): (T & MapPoint)[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (p): p is T & MapPoint =>
        !!p &&
        typeof p === "object" &&
        isLngLat((p as MapPoint).lon, (p as MapPoint).lat),
    )
    .map((p) => ({ ...p, name: typeof p.name === "string" ? p.name : "" }));
}

/** Route coordinates arrive as [[lon, lat], ...]; drop anything incomplete. */
export function validPath(raw: unknown): LngLat[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (c): c is LngLat =>
        Array.isArray(c) && c.length >= 2 && isLngLat(c[0], c[1]),
    )
    .map((c) => [c[0], c[1]]);
}

export function boundsOf(coords: LngLat[]): [LngLat, LngLat] | null {
  if (!coords.length) return null;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of coords) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [
    [minX, minY],
    [maxX, maxY],
  ];
}

/** True when every coordinate is (nearly) the same spot, so fitBounds would zoom to infinity. */
export function isDegenerate(b: [LngLat, LngLat]): boolean {
  return (
    Math.abs(b[1][0] - b[0][0]) < 1e-4 && Math.abs(b[1][1] - b[0][1]) < 1e-4
  );
}

export function directionsUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
}
