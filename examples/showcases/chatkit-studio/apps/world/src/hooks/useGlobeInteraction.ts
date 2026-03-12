import { useState, useCallback } from "react";
import type { GlobeMethods } from "react-globe.gl";
import { geoCentroid } from "d3-geo";
import type { CountryFeature } from "@/utils/countryData";
import type { VisitedCountry } from "@/hooks/useJourneyProgress";

// Animation timing constant
const GLOBE_ANIMATION_DURATION_MS = 1200;

export interface ClickedCountry {
  name: string;
  flagEmoji: string | null;
  position: { x: number; y: number };
  isVisited: boolean;
}

/**
 * Hook to manage globe interaction (click, hover, tooltip).
 */
export function useGlobeInteraction(
  globeRef: React.MutableRefObject<GlobeMethods | undefined>,
  visitedCountries: VisitedCountry[],
  clickedCountry: ClickedCountry | null,
  setClickedCountry: (country: ClickedCountry | null) => void,
) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  const handlePolygonClick = useCallback(
    (polygon: unknown) => {
      const feature = polygon as CountryFeature;
      const id = feature.id?.toString() ?? "";
      setSelectedId(id);
      setClickedCountry(null);

      const controls = globeRef.current?.controls?.();
      if (controls) controls.autoRotate = false;

      const countryName = feature.properties?.name ?? "Unknown";
      const flagEmoji = feature.properties?.flagEmoji ?? null;
      const isVisited = visitedCountries.some(
        (country) => country.name === countryName,
      );

      const [lngRaw, latRaw] = geoCentroid(feature);
      const lat = Number.isFinite(latRaw) ? latRaw : undefined;
      const lng = Number.isFinite(lngRaw) ? lngRaw : undefined;

      if (
        globeRef.current?.pointOfView &&
        lat !== undefined &&
        lng !== undefined
      ) {
        globeRef.current.pointOfView(
          { lat, lng, altitude: 1.6 },
          GLOBE_ANIMATION_DURATION_MS,
        );

        setTimeout(() => {
          if (globeRef.current) {
            const coords = globeRef.current.getScreenCoords(lat, lng);
            if (coords) {
              setClickedCountry({
                name: countryName,
                flagEmoji,
                position: { x: coords.x, y: coords.y },
                isVisited,
              });
            }
          }
        }, GLOBE_ANIMATION_DURATION_MS);
      }
    },
    [globeRef, visitedCountries, setClickedCountry],
  );

  const handlePolygonHover = useCallback((polygon: unknown | null) => {
    const feature = (polygon ?? undefined) as CountryFeature | undefined;
    setHoverId(feature?.id?.toString() ?? null);
  }, []);

  const polygonLabel = useCallback(
    (polygon: unknown) => {
      const feature = polygon as CountryFeature;
      const name = feature.properties?.name ?? "Unknown";
      const iso = feature.properties?.iso2 ?? "N/A";
      return hoverId === feature.id?.toString()
        ? `<div style="padding: 6px 8px;">
            <strong style="font-size: 13px;">${name}</strong><br />
            <span style="font-size: 11px; opacity: 0.7;">ISO: ${iso}</span>
          </div>`
        : "";
    },
    [hoverId],
  );

  return {
    selectedId,
    hoverId,
    handlePolygonClick,
    handlePolygonHover,
    polygonLabel,
  };
}
