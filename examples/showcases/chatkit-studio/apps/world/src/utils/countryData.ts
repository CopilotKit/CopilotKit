import type { Feature, Geometry } from "geojson";
import type { VisitedCountry } from "@/hooks/useJourneyProgress";

export type CountryFeature = Feature<
  Geometry,
  {
    name?: string;
    iso2?: string | null;
    flagEmoji?: string | null;
  }
> & { id?: string | number };

// Manual ISO code mappings for countries with name mismatches
export const MANUAL_FLAG_MAP: Record<string, string> = {
  bosniaandherz: "BA",
  centralafricanrep: "CF",
  congo: "CG",
  demrepcongo: "CD",
  demrepofcongo: "CD",
  dominicanrep: "DO",
  equatorialguinea: "GQ",
  eqguinea: "GQ",
  falklandis: "FK",
  frsantarcticlands: "TF",
  macedonia: "MK",
  ncyprus: "CY",
  southsudan: "SS",
  ssudan: "SS",
  solomonis: "SB",
  somaliland: "SO",
  unitedstatesofamerica: "US",
  wsahara: "EH",
  eswatini: "SZ",
  cotedivoire: "CI",
};

// Normalize country names: remove accents, spaces, special chars
export const normalizeName = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^a-z]/g, "");

// Convert ISO-2 code to flag emoji (e.g., "US" -> "🇺🇸")
export const codeToFlagEmoji = (code?: string | null) => {
  if (!code) return null;
  return code
    .toUpperCase()
    .split("")
    .map((char) => String.fromCodePoint(127397 + char.charCodeAt(0)))
    .join("");
};

// Generic JSON fetcher
export const fetchJson = async <T>(path: string): Promise<T> => {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Failed to load ${path}`);
  return (await response.json()) as T;
};

// Determine polygon color: selected (blue) > hovered (gray) > visited (green) > default
export const getPolygonColor = (
  polygon: CountryFeature,
  selectedId: string | null,
  hoverId: string | null,
  visitedCountries: VisitedCountry[],
) => {
  const countryName = polygon.properties?.name;
  const isVisited = visitedCountries.some((country) => country.name === countryName);

  if (selectedId && polygon.id?.toString() === selectedId) {
    return "rgba(96, 165, 250, 0.85)"; // blue - selected
  }
  if (hoverId && polygon.id?.toString() === hoverId) {
    return "rgba(148, 163, 184, 0.6)"; // gray - hovered
  }
  if (isVisited) {
    return "rgba(34, 197, 94, 0.5)"; // green - visited
  }
  return "rgba(148, 163, 184, 0.2)"; // gray - default
};
