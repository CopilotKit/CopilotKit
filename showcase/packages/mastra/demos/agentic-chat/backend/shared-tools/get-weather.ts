/**
 * Mock weather data tool implementation — vendored from
 * showcase/shared/typescript/tools/get-weather.ts so this cell has no
 * dependency on the showcase-level shared package.
 */

import { WeatherResult } from "./types";

const CONDITIONS = [
  "Sunny",
  "Partly Cloudy",
  "Cloudy",
  "Overcast",
  "Light Rain",
  "Heavy Rain",
  "Thunderstorm",
  "Snow",
  "Foggy",
  "Windy",
];

function seededRandom(seed: number): () => number {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let v = Math.imul(t ^ (t >>> 15), 1 | t);
    v = (v + Math.imul(v ^ (v >>> 7), 61 | v)) ^ v;
    return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (Math.imul(31, hash) + s.charCodeAt(i)) | 0;
  }
  return hash;
}

function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function randChoice<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

export function getWeatherImpl(city: string): WeatherResult {
  const rng = seededRandom(hashString(city.toLowerCase()));
  const temperature = randInt(rng, 20, 95);

  return {
    city,
    temperature,
    humidity: randInt(rng, 30, 90),
    wind_speed: randInt(rng, 2, 30),
    feels_like: temperature + randInt(rng, -5, 5),
    conditions: randChoice(rng, CONDITIONS),
  };
}
