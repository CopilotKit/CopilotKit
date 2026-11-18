import type { WeatherToolResult } from "@/mastra/tools";

// Every glyph below is chosen from the tool's `conditions` string, so the
// picture never contradicts the reading printed beside it.
function ConditionIcon({ conditions }: { conditions: string }) {
  const c = conditions.toLowerCase();
  const wet = /rain|drizzle|snow|shower|thunder|hail/.test(c);
  const cloudy = /cloud|overcast|fog/.test(c);

  if (wet) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        className="w-14 h-14 text-white"
        aria-hidden="true"
      >
        <path d="M6.5 15a4 4 0 0 1 .3-7.99 5.5 5.5 0 0 1 10.6 1.6A3.5 3.5 0 0 1 17 15z" />
        <path d="M8 18.5 7 21M12 18.5 11 21M16 18.5 15 21" />
      </svg>
    );
  }

  if (cloudy) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        className="w-14 h-14 text-white"
        aria-hidden="true"
      >
        <path d="M6.5 18a4 4 0 0 1 .3-7.99 5.5 5.5 0 0 1 10.6 1.6A3.5 3.5 0 0 1 17 18z" />
      </svg>
    );
  }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="w-14 h-14 text-yellow-200"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="5" />
      <path
        d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
        strokeWidth="2"
        stroke="currentColor"
      />
    </svg>
  );
}

/**
 * The tool result arrives as a JSON string on the AG-UI tool-call result.
 * Parse it defensively: a card that renders a placeholder number when the
 * parse fails is exactly the bug this component used to have, so anything
 * that is not a well-formed reading renders as "no reading" instead.
 */
function parseWeather(result: string | undefined): WeatherToolResult | null {
  if (!result) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(result);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const r = parsed as Record<string, unknown>;
  const numeric = [
    "temperature",
    "feelsLike",
    "humidity",
    "windSpeed",
  ] as const;
  if (numeric.some((k) => typeof r[k] !== "number")) return null;
  if (typeof r.conditions !== "string" || typeof r.location !== "string") {
    return null;
  }
  return parsed as WeatherToolResult;
}

// Open-Meteo is queried without unit parameters, so it answers in its
// defaults: °C, km/h and percent. The labels below say so rather than
// implying °F/mph.
const round = (n: number) => Math.round(n);

// Weather card component. Every value it prints comes from the `weatherTool`
// tool result — the card must never invent a reading the agent did not fetch.
export function WeatherCard({
  location,
  themeColor,
  result,
}: {
  location?: string;
  themeColor: string;
  result?: string;
}) {
  const weather = parseWeather(result);

  return (
    <div
      style={{ backgroundColor: themeColor }}
      className="rounded-xl shadow-xl mt-6 mb-4 max-w-md w-full"
    >
      <div className="bg-white/20 p-4 w-full">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xl font-bold text-white capitalize">
              {weather?.location ?? location}
            </h3>
            <p className="text-white">Current Weather</p>
          </div>
          {weather ? <ConditionIcon conditions={weather.conditions} /> : null}
        </div>

        {weather ? (
          <>
            <div className="mt-4 flex items-end justify-between">
              <div className="text-3xl font-bold text-white">
                {round(weather.temperature)}°C
              </div>
              <div className="text-sm text-white">{weather.conditions}</div>
            </div>

            <div className="mt-4 pt-4 border-t border-white">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-white text-xs">Humidity</p>
                  <p className="text-white font-medium">
                    {round(weather.humidity)}%
                  </p>
                </div>
                <div>
                  <p className="text-white text-xs">Wind</p>
                  <p className="text-white font-medium">
                    {round(weather.windSpeed)} km/h
                  </p>
                </div>
                <div>
                  <p className="text-white text-xs">Feels Like</p>
                  <p className="text-white font-medium">
                    {round(weather.feelsLike)}°C
                  </p>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="mt-4 text-sm text-white">Fetching the forecast…</div>
        )}
      </div>
    </div>
  );
}
