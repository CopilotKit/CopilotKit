"use client";

/**
 * Main page combining globe, chat, and progress tracking.
 * Flow: click country → add to journey → send to AI → agent calls renderCountry → display card
 */

import { useState, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import MyChat from "@/components/MyChat";
import StatsPanel from "@/components/StatsPanel";
import JourneyModal from "@/components/JourneyModal";
import { useCopilotChat, useCopilotAction } from "@copilotkit/react-core";
import { TextMessage, MessageRole } from "@copilotkit/runtime-client-gql";
import { useJourneyProgress } from "@/hooks/useJourneyProgress";
import { useCountryData } from "@/hooks/useCountryData";
import { normalizeName } from "@/utils/countryData";
import { geoCentroid } from "d3-geo";
import type { GlobeMethods } from "react-globe.gl";
import type { CountryFeature } from "@/utils/countryData";
import type { ClickedCountry } from "@/hooks/useGlobeInteraction";

// Client-side only to avoid SSR issues with Three.js
const CountryGlobe = dynamic(() => import("@/components/globe/CountryGlobe"), { ssr: false });

// Animation timing constants
const GLOBE_ANIMATION_DURATION_MS = 1200;
const JOURNEY_ADD_DELAY_MS = 1300;

export default function Home() {
  const { appendMessage } = useCopilotChat();
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const { polygons } = useCountryData();
  const {
    visitedCountries,
    totalCountries,
    currentLevel,
    progress,
    countriesToNextLevel,
    addCountry,
    resetProgress,
    isLoaded,
  } = useJourneyProgress();
  const [isJourneyModalOpen, setIsJourneyModalOpen] = useState(false);
  const [clickedCountry, setClickedCountry] = useState<ClickedCountry | null>(null);

  // Close tooltip
  const handleCloseTooltip = useCallback(() => {
    setClickedCountry(null);
  }, []);

  // Add to journey silently (for programmatic visits via AI)
  const addToJourneyOnly = useCallback((country: string, flagEmoji: string | null) => {
    addCountry(country, flagEmoji);
  }, [addCountry]);

  // Add to journey and notify agent (for manual clicks on globe)
  const handleVisit = useCallback(async (country: string, flagEmoji: string | null) => {
    addCountry(country, flagEmoji);
    const message = new TextMessage({
      role: MessageRole.User,
      content: `I want to visit ${country}`,
    });
    await appendMessage(message);
  }, [addCountry, appendMessage]);

  // Programmatic visit via natural language
  const visitCountryProgrammatically = useCallback(
    (countryName: string) => {
      if (polygons.length === 0) {
        return false;
      }

      const normalizedInput = normalizeName(countryName);
      const country = polygons.find(
        (p) => normalizeName(p.properties?.name ?? "") === normalizedInput
      );

      if (!country) {
        return false;
      }

      const name = country.properties?.name ?? "Unknown";
      const flagEmoji = country.properties?.flagEmoji ?? null;

      // Animate globe to country
      const [lngRaw, latRaw] = geoCentroid(country as CountryFeature);
      const lat = Number.isFinite(latRaw) ? latRaw : undefined;
      const lng = Number.isFinite(lngRaw) ? lngRaw : undefined;

      if (globeRef.current?.pointOfView && lat !== undefined && lng !== undefined) {
        // Stop auto-rotation
        const controls = globeRef.current.controls?.();
        if (controls) controls.autoRotate = false;

        // Animate to country
        globeRef.current.pointOfView({ lat, lng, altitude: 1.6 }, GLOBE_ANIMATION_DURATION_MS);

        // Add to journey after animation (no message - AI will respond to original message)
        setTimeout(() => {
          addToJourneyOnly(name, flagEmoji);
        }, JOURNEY_ADD_DELAY_MS);

        return true;
      }

      return false;
    },
    [polygons, addToJourneyOnly, globeRef]
  );

  // CopilotKit action for AI to call
  useCopilotAction(
    {
      name: "visitCountry",
      description: "Navigate the globe to a specific country and mark it as visited. Use this when the user expresses interest in visiting or learning about a country.",
      parameters: [
        {
          name: "countryName",
          type: "string",
          description: "The name of the country to visit (e.g., 'France', 'Japan', 'Brazil')",
          required: true,
        },
      ],
      handler: async ({ countryName }) => {
        handleCloseTooltip();
        const success = visitCountryProgrammatically(countryName);
        if (success) {
          return `Navigated to ${countryName} and added it to your journey!`;
        }
        return `Sorry, I couldn't find a country named "${countryName}". Please try another name.`;
      },
    },
    [visitCountryProgrammatically, handleCloseTooltip]
  );

  return (
    <>
      <div className="fixed inset-0 bg-slate-900">
        <CountryGlobe
          handleVisit={handleVisit}
          visitedCountries={visitedCountries}
          globeRef={globeRef}
          clickedCountry={clickedCountry}
          setClickedCountry={setClickedCountry}
          handleCloseTooltip={handleCloseTooltip}
        />
      </div>

      {/* Stats Panel */}
      {isLoaded && (
        <StatsPanel
          currentLevel={currentLevel}
          visitedCount={visitedCountries.length}
          progress={progress}
          onClick={() => setIsJourneyModalOpen(true)}
        />
      )}

      {/* Chat Panel */}
      <div className="w-1/3 h-screen fixed right-0 p-5">
        <MyChat />
      </div>

      {/* Journey Modal */}
      <JourneyModal
        isOpen={isJourneyModalOpen}
        onClose={() => setIsJourneyModalOpen(false)}
        visitedCountries={visitedCountries}
        totalCountries={totalCountries}
        currentLevel={currentLevel}
        countriesToNextLevel={countriesToNextLevel}
        onReset={resetProgress}
      />
    </>
  );
}
