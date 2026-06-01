import React from "react";

export function getWeatherGradient(conditions: string): string {
  const c = conditions.toLowerCase();
  if (c.includes("clear") || c.includes("sunny"))
    return "linear-gradient(135deg, #667eea 0%, #764ba2 100%)";
  if (c.includes("rain") || c.includes("storm"))
    return "linear-gradient(135deg, #4A5568 0%, #2D3748 100%)";
  if (c.includes("cloud") || c.includes("overcast"))
    return "linear-gradient(135deg, #718096 0%, #4A5568 100%)";
  if (c.includes("snow"))
    return "linear-gradient(135deg, #63B3ED 0%, #4299E1 100%)";
  return "linear-gradient(135deg, #667eea 0%, #764ba2 100%)";
}

export function getWeatherIcon(conditions: string): string {
  const c = conditions.toLowerCase();
  if (c.includes("clear") || c.includes("sunny")) return "\u2600\uFE0F";
  if (c.includes("rain") || c.includes("drizzle")) return "\uD83C\uDF27\uFE0F";
  if (c.includes("snow")) return "\u2744\uFE0F";
  if (c.includes("thunderstorm")) return "\u26C8\uFE0F";
  if (c.includes("cloud") || c.includes("overcast")) return "\u2601\uFE0F";
  if (c.includes("fog")) return "\uD83C\uDF2B\uFE0F";
  return "\uD83C\uDF24\uFE0F";
}

export interface WeatherCardProps {
  location: string;
  temperature?: number;
  conditions?: string;
  humidity?: number;
  windSpeed?: number;
  feelsLike?: number;
  city?: string;
  loading?: boolean;
}

export function WeatherCard({
  location,
  temperature = 22,
  conditions = "Clear",
  humidity = 55,
  windSpeed = 12,
  feelsLike,
  city,
  loading = false,
}: WeatherCardProps) {
  if (loading) {
    return (
      <div
        className="flex items-center gap-3 px-5 py-4 rounded-2xl max-w-sm"
        style={{
          background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
        }}
      >
        <div className="animate-pulse text-2xl">{"\uD83C\uDF24\uFE0F"}</div>
        <div>
          <p className="text-white font-medium text-sm">Checking weather...</p>
          <p className="text-white/60 text-xs">{location}</p>
        </div>
      </div>
    );
  }

  const temp = temperature;
  const cond = conditions;
  const hum = humidity;
  const wind = windSpeed;
  const feels = feelsLike ?? temp;

  return (
    <div
      data-testid="weather-card"
      className="rounded-2xl overflow-hidden shadow-xl my-3"
      style={{ background: getWeatherGradient(cond), width: "320px" }}
    >
      <div className="px-5 pt-4 pb-3">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-base font-bold text-white capitalize tracking-tight">
              {city || location}
            </h3>
            <p className="text-white/50 text-[10px] font-medium uppercase tracking-wider">
              Current Weather
            </p>
          </div>
          <span className="text-4xl leading-none">{getWeatherIcon(cond)}</span>
        </div>
        <div className="mt-3 flex items-baseline gap-1.5">
          <span className="text-4xl font-extralight text-white tracking-tighter">
            {temp}&deg;
          </span>
          <span className="text-white/40 text-xs">
            {((temp * 9) / 5 + 32).toFixed(0)}&deg;F
          </span>
        </div>
        <p className="text-white/70 text-xs font-medium capitalize mt-0.5">
          {cond}
        </p>
      </div>
      <div
        className="grid grid-cols-3 text-center py-2.5 px-5"
        style={{ background: "rgba(0,0,0,0.15)" }}
      >
        <div>
          <p className="text-white/40 text-[9px] font-medium uppercase tracking-wider">
            Humidity
          </p>
          <p className="text-white text-xs font-semibold mt-0.5">{hum}%</p>
        </div>
        <div className="border-x border-white/10">
          <p className="text-white/40 text-[9px] font-medium uppercase tracking-wider">
            Wind
          </p>
          <p className="text-white text-xs font-semibold mt-0.5">{wind} mph</p>
        </div>
        <div>
          <p className="text-white/40 text-[9px] font-medium uppercase tracking-wider">
            Feels Like
          </p>
          <p className="text-white text-xs font-semibold mt-0.5">
            {feels}&deg;
          </p>
        </div>
      </div>
    </div>
  );
}
