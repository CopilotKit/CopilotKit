"use client";

import type { LevelInfo } from "@/hooks/useJourneyProgress";

interface StatsPanelProps {
  currentLevel: LevelInfo;
  visitedCount: number;
  progress: number;
  onClick: () => void;
}

export default function StatsPanel({
  currentLevel,
  visitedCount,
  progress,
  onClick,
}: StatsPanelProps) {
  return (
    <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 z-40">
      <button
        onClick={onClick}
        className="bg-white/90 backdrop-blur-md shadow-lg rounded-full px-10 py-2 flex items-center gap-4 hover:bg-white hover:shadow-xl transition-all duration-200"
      >
        {/* Level Badge */}
        <div className="bg-green-500 text-white w-12 h-12 rounded-full flex items-center justify-center text-xl font-bold flex-shrink-0">
          {currentLevel.level}
        </div>

        {/* Level Info */}
        <div className="text-left">
          <h3 className="text-lg font-bold text-gray-900">
            {currentLevel.name}
          </h3>
          <p className="text-sm text-gray-500">
            {visitedCount} {visitedCount === 1 ? "country" : "countries"}{" "}
            visited
          </p>
        </div>

        {/* Progress Badge */}
        <div className="bg-gray-100 text-gray-700 w-12 h-12 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0 ml-2">
          {progress}%
        </div>
      </button>
    </div>
  );
}
