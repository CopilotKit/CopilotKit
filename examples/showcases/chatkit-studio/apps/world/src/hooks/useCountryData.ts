import { useState, useEffect } from "react";
import type { FeatureCollection, Geometry } from "geojson";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import {
  type CountryFeature,
  MANUAL_FLAG_MAP,
  normalizeName,
  codeToFlagEmoji,
  fetchJson,
} from "@/utils/countryData";

/**
 * Hook to load and enrich country data from TopoJSON files.
 */
export function useCountryData() {
  const [polygons, setPolygons] = useState<CountryFeature[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [worldData, flagCodes] = await Promise.all([
          fetchJson<Topology<{ countries: GeometryCollection<Geometry> }>>(
            "/data/countries-110m.json"
          ),
          fetchJson<Record<string, string>>("/data/flag-codes.json"),
        ]);

        const flagLookup = new Map(
          Object.entries(flagCodes).map(([code, label]) => [
            normalizeName(label),
            code.toUpperCase(),
          ])
        );

        const topoFeatures = feature(worldData, worldData.objects.countries) as FeatureCollection<
          Geometry,
          { name?: string }
        >;

        const enrichedFeatures: CountryFeature[] = topoFeatures.features.map((country) => {
          const countryName = country.properties?.name;
          const normalizedName = countryName !== undefined ? normalizeName(countryName) : "";
          const iso2 = flagLookup.get(normalizedName) ?? MANUAL_FLAG_MAP[normalizedName] ?? null;

          return {
            ...country,
            id: country.id?.toString() ?? country.id ?? countryName ?? "",
            properties: {
              ...country.properties,
              iso2,
              flagEmoji: codeToFlagEmoji(iso2),
            },
          };
        });

        setPolygons(enrichedFeatures);
      } catch (error) {
        console.error(error);
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, []);

  return { polygons, isLoading };
}
