"use client";

/**
 * Hook for tracking visited countries with level-based progression.
 * Persists to localStorage. 10 levels from "Wanderer" to "Master Explorer".
 */

import { useState, useEffect, useCallback } from "react";

export interface VisitedCountry {
  name: string;
  flagEmoji: string | null;
  visitedAt: number;
}

export interface LevelInfo {
  level: number;
  name: string;
  minCountries: number;
  maxCountries: number;
  color: string;
}

const LEVELS: LevelInfo[] = [
  {
    level: 1,
    name: "Wanderer",
    minCountries: 0,
    maxCountries: 4,
    color: "bg-gray-500",
  },
  {
    level: 2,
    name: "Explorer",
    minCountries: 5,
    maxCountries: 9,
    color: "bg-purple-500",
  },
  {
    level: 3,
    name: "Adventurer",
    minCountries: 10,
    maxCountries: 19,
    color: "bg-blue-500",
  },
  {
    level: 4,
    name: "Voyager",
    minCountries: 20,
    maxCountries: 29,
    color: "bg-cyan-500",
  },
  {
    level: 5,
    name: "Traveler",
    minCountries: 30,
    maxCountries: 44,
    color: "bg-green-500",
  },
  {
    level: 6,
    name: "Navigator",
    minCountries: 45,
    maxCountries: 59,
    color: "bg-lime-500",
  },
  {
    level: 7,
    name: "Pioneer",
    minCountries: 60,
    maxCountries: 79,
    color: "bg-yellow-500",
  },
  {
    level: 8,
    name: "Pathfinder",
    minCountries: 80,
    maxCountries: 99,
    color: "bg-orange-500",
  },
  {
    level: 9,
    name: "Globetrotter",
    minCountries: 100,
    maxCountries: 134,
    color: "bg-red-500",
  },
  {
    level: 10,
    name: "Master Explorer",
    minCountries: 135,
    maxCountries: 175,
    color: "bg-pink-500",
  },
];

const TOTAL_COUNTRIES = 175;
const STORAGE_KEY = "journey_progress";

export function useJourneyProgress() {
  const [visitedCountries, setVisitedCountries] = useState<VisitedCountry[]>(
    [],
  );
  const [isLoaded, setIsLoaded] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as VisitedCountry[];
        setVisitedCountries(parsed);
      }
    } catch (error) {
      console.error("Failed to load journey progress:", error);
    } finally {
      setIsLoaded(true);
    }
  }, []);

  // Persist to localStorage whenever visited countries change
  useEffect(() => {
    if (isLoaded) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(visitedCountries));
      } catch (error) {
        console.error("Failed to save journey progress:", error);
      }
    }
  }, [visitedCountries, isLoaded]);

  const getCurrentLevel = useCallback((): LevelInfo => {
    const count = visitedCountries.length;
    return (
      LEVELS.find(
        (level) => count >= level.minCountries && count <= level.maxCountries,
      ) || LEVELS[0]
    );
  }, [visitedCountries.length]);

  const getProgress = useCallback((): number => {
    const percentage = (visitedCountries.length / TOTAL_COUNTRIES) * 100;
    return Math.round(percentage);
  }, [visitedCountries.length]);

  const getPoints = useCallback((): number => {
    return visitedCountries.length;
  }, [visitedCountries.length]);

  const getCountriesToNextLevel = useCallback((): number => {
    const currentLevel = getCurrentLevel();
    if (currentLevel.level === LEVELS.length) return 0;
    const nextLevel = LEVELS.find(
      (level) => level.level === currentLevel.level + 1,
    );
    if (!nextLevel) return 0;
    return nextLevel.minCountries - visitedCountries.length;
  }, [visitedCountries.length, getCurrentLevel]);

  const addCountry = useCallback((name: string, flagEmoji: string | null) => {
    setVisitedCountries((prev) => {
      if (prev.some((country) => country.name === name)) return prev;
      return [...prev, { name, flagEmoji, visitedAt: Date.now() }];
    });
  }, []);

  const removeCountry = useCallback((name: string) => {
    setVisitedCountries((prev) =>
      prev.filter((country) => country.name !== name),
    );
  }, []);

  const resetProgress = useCallback(() => {
    setVisitedCountries([]);
  }, []);

  return {
    visitedCountries,
    totalCountries: TOTAL_COUNTRIES,
    currentLevel: getCurrentLevel(),
    progress: getProgress(),
    points: getPoints(),
    countriesToNextLevel: getCountriesToNextLevel(),
    addCountry,
    removeCountry,
    resetProgress,
    isLoaded,
  };
}
