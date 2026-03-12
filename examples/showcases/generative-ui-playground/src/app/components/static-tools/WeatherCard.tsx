"use client";

/**
 * WeatherCard - Static GenUI component for displaying weather data
 *
 * Renders weather information returned by the backend get_weather tool.
 * Uses glassmorphism styling consistent with the mcp-apps design system.
 */

interface WeatherCardProps {
  location: string;
  temperature: number;
  conditions: string;
  humidity?: number;
  windSpeed?: number;
  icon?: string;
}

// Weather icon mapping based on condition keywords
function getWeatherIcon(conditions: string, icon?: string): string {
  if (icon) return icon;

  const lower = conditions.toLowerCase();
  if (lower.includes("sun") || lower.includes("clear")) return "☀️";
  if (lower.includes("cloud") && lower.includes("part")) return "⛅";
  if (lower.includes("cloud")) return "☁️";
  if (lower.includes("rain") || lower.includes("shower")) return "🌧️";
  if (lower.includes("thunder") || lower.includes("storm")) return "⛈️";
  if (lower.includes("snow")) return "❄️";
  if (lower.includes("fog") || lower.includes("mist")) return "🌫️";
  if (lower.includes("wind")) return "💨";
  return "🌤️";
}

export function WeatherCard({
  location,
  temperature,
  conditions,
  humidity,
  windSpeed,
  icon,
}: WeatherCardProps) {
  const weatherIcon = getWeatherIcon(conditions, icon);

  return (
    <div className="glass-card p-5 max-w-sm">
      {/* Header with location */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">
            {location}
          </h3>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Current Weather
          </p>
        </div>
        <div className="text-4xl">{weatherIcon}</div>
      </div>

      {/* Temperature display */}
      <div className="mb-4">
        <span className="text-5xl font-bold text-gradient">
          {Math.round(temperature)}°
        </span>
        <span className="text-xl text-[var(--color-text-secondary)] ml-1">F</span>
      </div>

      {/* Conditions */}
      <p className="text-[var(--color-text-primary)] font-medium mb-4">
        {conditions}
      </p>

      {/* Additional details */}
      <div className="flex gap-6 pt-4 border-t border-[var(--color-border-glass)]">
        {humidity !== undefined && (
          <div className="flex items-center gap-2">
            <span className="text-lg">💧</span>
            <div>
              <p className="text-xs text-[var(--color-text-tertiary)]">Humidity</p>
              <p className="text-sm font-medium text-[var(--color-text-primary)]">
                {humidity}%
              </p>
            </div>
          </div>
        )}
        {windSpeed !== undefined && (
          <div className="flex items-center gap-2">
            <span className="text-lg">💨</span>
            <div>
              <p className="text-xs text-[var(--color-text-tertiary)]">Wind</p>
              <p className="text-sm font-medium text-[var(--color-text-primary)]">
                {windSpeed} mph
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Loading state for the weather card while data is being fetched
 */
export function WeatherLoadingState({ location }: { location?: string }) {
  return (
    <div className="glass-card p-5 max-w-sm animate-pulse">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="h-5 w-32 bg-[var(--color-surface)] rounded mb-2" />
          <div className="h-4 w-24 bg-[var(--color-surface)] rounded" />
        </div>
        <div className="h-10 w-10 bg-[var(--color-surface)] rounded-full" />
      </div>

      <div className="mb-4">
        <div className="h-12 w-24 bg-[var(--color-surface)] rounded" />
      </div>

      <div className="h-5 w-36 bg-[var(--color-surface)] rounded mb-4" />

      <div className="flex gap-6 pt-4 border-t border-[var(--color-border-glass)]">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 bg-[var(--color-surface)] rounded" />
          <div>
            <div className="h-3 w-12 bg-[var(--color-surface)] rounded mb-1" />
            <div className="h-4 w-8 bg-[var(--color-surface)] rounded" />
          </div>
        </div>
      </div>

      {location && (
        <p className="text-xs text-[var(--color-text-tertiary)] mt-3">
          Loading weather for {location}...
        </p>
      )}
    </div>
  );
}
