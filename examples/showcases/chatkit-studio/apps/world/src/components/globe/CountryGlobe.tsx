"use client";

import { useEffect, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import CountryTooltip from "./CountryTooltip";
import type { VisitedCountry } from "@/hooks/useJourneyProgress";
import { useCountryData } from "@/hooks/useCountryData";
import { useGlobeInteraction, type ClickedCountry } from "@/hooks/useGlobeInteraction";
import { type CountryFeature, getPolygonColor } from "@/utils/countryData";

/**
 * Interactive 3D globe with country selection.
 */

const CountryGlobe = ({
  handleVisit,
  visitedCountries,
  globeRef,
  clickedCountry,
  setClickedCountry,
  handleCloseTooltip
}: {
  handleVisit: (country: string, flagEmoji: string | null) => void;
  visitedCountries: VisitedCountry[];
  globeRef: React.MutableRefObject<GlobeMethods | undefined>;
  clickedCountry: ClickedCountry | null;
  setClickedCountry: (country: ClickedCountry | null) => void;
  handleCloseTooltip: () => void;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  const { polygons } = useCountryData();
  const {
    selectedId,
    hoverId,
    handlePolygonClick,
    handlePolygonHover,
    polygonLabel,
  } = useGlobeInteraction(globeRef, visitedCountries, clickedCountry, setClickedCountry);

  // Responsive sizing
  useEffect(() => {
    if (!containerRef.current || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      setDimensions({
        width: Math.round(entry.contentRect.width),
        height: Math.round(entry.contentRect.height),
      });
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Configure auto-rotation and zoom limits
  useEffect(() => {
    if (!globeRef.current) return;

    const controls = globeRef.current.controls?.();
    if (controls) {
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.35;
      controls.enablePan = true;
      controls.enableZoom = true;
      controls.minDistance = 120;
      controls.maxDistance = 500;
    }
  }, [polygons.length]);

  // Update cursor on hover
  useEffect(() => {
    if (!containerRef.current) return;
    const canvas = containerRef.current.querySelector("canvas");
    if (canvas) {
      canvas.style.cursor = hoverId ? "pointer" : "grab";
    }
  }, [hoverId]);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full"
      onClick={(e) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === "CANVAS") {
          if (!hoverId && clickedCountry) handleCloseTooltip();
        }
      }}
    >
      {dimensions.width > 0 && dimensions.height > 0 && (
        <Globe
          ref={globeRef}
          width={dimensions.width}
          height={dimensions.height}
          backgroundColor="rgba(0,0,0,0)"
          globeImageUrl="/textures/earth-blue-marble.jpg"
          bumpImageUrl="/textures/earth-topology.png"
          backgroundImageUrl="/textures/night-sky.png"
          polygonsData={polygons}
          polygonCapColor={(polygon: unknown) =>
            getPolygonColor(polygon as CountryFeature, selectedId, hoverId, visitedCountries)
          }
          polygonSideColor={() => "rgba(30, 41, 59, 0.6)"}
          polygonStrokeColor={() => "rgba(15, 23, 42, 0.8)"}
          polygonAltitude={(polygon: unknown) =>
            (polygon as CountryFeature).id?.toString() === selectedId ? 0.02 : 0.005
          }
          polygonsTransitionDuration={400}
          onPolygonClick={handlePolygonClick}
          onPolygonHover={handlePolygonHover}
          polygonLabel={polygonLabel}
          rendererConfig={{ alpha: true, antialias: true }}
        />
      )}

      {clickedCountry && (
        <CountryTooltip
          countryName={clickedCountry.name}
          flagEmoji={clickedCountry.flagEmoji}
          position={clickedCountry.position}
          isVisited={clickedCountry.isVisited}
          onVisit={handleVisit}
        />
      )}
    </div>
  );
};

export default CountryGlobe;
