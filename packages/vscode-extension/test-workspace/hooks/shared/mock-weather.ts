/**
 * Deterministic-mock data for the playground's weather tools.
 *
 * Real apps wire their handlers up to a weather API; the test workspace
 * has no network so we fabricate plausible values keyed off the city
 * name's character codes. The same city always produces the same numbers,
 * which keeps screenshots stable across reloads.
 */

const CONDITIONS = [
  { key: "sunny", label: "Sunny", emoji: "☀️" },
  { key: "partly-cloudy", label: "Partly cloudy", emoji: "⛅" },
  { key: "cloudy", label: "Cloudy", emoji: "☁️" },
  { key: "rain", label: "Light rain", emoji: "🌧️" },
  { key: "thunderstorm", label: "Thunderstorm", emoji: "⛈️" },
  { key: "snow", label: "Snow", emoji: "🌨️" },
  { key: "windy", label: "Windy", emoji: "💨" },
] as const;

export type ConditionKey = (typeof CONDITIONS)[number]["key"];

export interface CurrentWeather {
  city: string;
  tempF: number;
  tempC: number;
  condition: ConditionKey;
  conditionLabel: string;
  conditionEmoji: string;
  feelsLikeF: number;
  humidity: number;
  windMph: number;
  uvIndex: number;
}

export interface SunTimes {
  city: string;
  sunriseISO: string;
  sunsetISO: string;
  daylightLabel: string;
}

export interface ForecastDay {
  day: string;
  high: number;
  low: number;
  icon: string;
  condition: ConditionKey;
}

export interface Forecast {
  city: string;
  days: ForecastDay[];
}

export interface AirQuality {
  city: string;
  aqi: number;
  level:
    | "good"
    | "moderate"
    | "unhealthy-sensitive"
    | "unhealthy"
    | "very-unhealthy"
    | "hazardous";
}

export interface PollenReport {
  city: string;
  tree: number;
  grass: number;
  weed: number;
}

export interface PrecipitationReading {
  city: string;
  inchesPerHour: number;
  rainType: "drizzle" | "rain" | "heavy" | "storm";
}

export interface RadarSnapshot {
  region: string;
  zoom: number;
  intensityGrid: number[];
}

export interface HistoricalTemps {
  city: string;
  range: "24h" | "7d" | "30d" | "1y";
  bars: number[];
}

/**
 * Fast deterministic hash from a string — used to seed mock numbers.
 *
 * Handles `null` / `undefined` defensively because the model occasionally
 * calls a tool with empty or malformed args (especially while it's still
 * streaming the arguments delta). A throw here would propagate up through
 * `tool.handler` and the chat surface would render an `{ error: … }` tool
 * result with all fields blank — much worse UX than seeding off "—".
 */
function hash(s: string | null | undefined): number {
  const str = typeof s === "string" && s.length > 0 ? s : "—";
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function pick<T>(arr: readonly T[], seed: number): T {
  return arr[seed % arr.length];
}

/**
 * Returns mock current-weather data for the given city. Same city → same
 * numbers, so successive tool calls are stable.
 */
export function mockCurrentWeather(city: string): CurrentWeather {
  const seed = hash(city);
  const tempF = 30 + (seed % 70);
  const tempC = Math.round(((tempF - 32) * 5) / 9);
  const cond = pick(CONDITIONS, seed >> 3);
  return {
    city,
    tempF,
    tempC,
    condition: cond.key,
    conditionLabel: cond.label,
    conditionEmoji: cond.emoji,
    feelsLikeF: tempF + ((seed % 7) - 3),
    humidity: 30 + (seed % 60),
    windMph: 2 + ((seed >> 2) % 18),
    uvIndex: 1 + (seed % 10),
  };
}

export function mockSunTimes(city: string): SunTimes {
  const seed = hash(city);
  // Map seed → reasonable sunrise (5:30–7:30 AM) and sunset (5:00–8:00 PM).
  const sunriseHour = 5 + ((seed >> 1) % 3);
  const sunriseMin = (seed * 7) % 60;
  const sunsetHour = 17 + ((seed >> 4) % 4);
  const sunsetMin = (seed * 11) % 60;
  const today = new Date();
  const sunrise = new Date(today);
  sunrise.setHours(sunriseHour, sunriseMin, 0, 0);
  const sunset = new Date(today);
  sunset.setHours(sunsetHour, sunsetMin, 0, 0);
  const daylightMs = sunset.getTime() - sunrise.getTime();
  const dh = Math.floor(daylightMs / 3_600_000);
  const dm = Math.floor((daylightMs % 3_600_000) / 60_000);
  return {
    city,
    sunriseISO: sunrise.toISOString(),
    sunsetISO: sunset.toISOString(),
    daylightLabel: `Daylight ~${dh}h ${dm}m`,
  };
}

const FORECAST_DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function mockForecast(city: string, days = 5): Forecast {
  const seed = hash(city);
  const start = (seed >> 2) % FORECAST_DAY_LABELS.length;
  const out: ForecastDay[] = [];
  for (let i = 0; i < days; i++) {
    const daySeed = seed + i * 17;
    const cond = pick(CONDITIONS, daySeed);
    const high = 50 + (daySeed % 40);
    out.push({
      day: FORECAST_DAY_LABELS[(start + i) % FORECAST_DAY_LABELS.length],
      high,
      low: high - 8 - ((daySeed >> 3) % 10),
      icon: cond.emoji,
      condition: cond.key,
    });
  }
  return { city, days: out };
}

export function mockAirQuality(city: string): AirQuality {
  const seed = hash(city);
  const aqi = 10 + (seed % 290);
  let level: AirQuality["level"];
  if (aqi <= 50) level = "good";
  else if (aqi <= 100) level = "moderate";
  else if (aqi <= 150) level = "unhealthy-sensitive";
  else if (aqi <= 200) level = "unhealthy";
  else if (aqi <= 300) level = "very-unhealthy";
  else level = "hazardous";
  return { city, aqi, level };
}

export function mockPollen(city: string): PollenReport {
  const seed = hash(city);
  return {
    city,
    tree: seed % 11,
    grass: (seed >> 3) % 11,
    weed: (seed >> 6) % 11,
  };
}

export function mockPrecipitation(city: string): PrecipitationReading {
  const seed = hash(city);
  const intensity = (seed % 50) / 10; // 0.0 – 5.0 inches/hour
  let rainType: PrecipitationReading["rainType"];
  if (intensity < 0.5) rainType = "drizzle";
  else if (intensity < 1.5) rainType = "rain";
  else if (intensity < 3) rainType = "heavy";
  else rainType = "storm";
  return { city, inchesPerHour: intensity, rainType };
}

export function mockRadar(region: string, zoom: number): RadarSnapshot {
  const seed = hash(region);
  const grid: number[] = [];
  for (let i = 0; i < 72; i++) {
    grid.push(((seed + i * 13) % 100) / 100);
  }
  return { region, zoom, intensityGrid: grid };
}

export function mockHistoricalTemps(
  city: string,
  range: HistoricalTemps["range"],
): HistoricalTemps {
  const seed = hash(city + range);
  const bars: number[] = [];
  const length =
    range === "24h" ? 14 : range === "7d" ? 14 : range === "30d" ? 14 : 14;
  for (let i = 0; i < length; i++) {
    bars.push(20 + ((seed + i * 7) % 70));
  }
  return { city, range, bars };
}

/**
 * Tool-result messages on the wire are JSON strings (the runtime stringifies
 * the handler's return value before shipping it back through the AG-UI
 * protocol). Renders consume them via `result?: string`. This helper
 * un-strings the payload back into a typed object — falling back to
 * `null` on parse error so the render can decide whether to show a
 * placeholder or use args.
 */
export function parseToolResult<T>(result: string | undefined): T | null {
  if (!result) return null;
  try {
    return JSON.parse(result) as T;
  } catch {
    return null;
  }
}
