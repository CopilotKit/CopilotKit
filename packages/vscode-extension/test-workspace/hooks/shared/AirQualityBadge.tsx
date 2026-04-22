// Shared render component used by `ImportedAirQuality.tsx`. Kept in a
// sibling file so the fixture exercises the path where `render` is
// imported rather than written inline in the hook config.
export interface AirQualityProps {
  args?: { city?: string; aqi?: number };
  status?: string;
}

const LEVEL = (aqi: number) => {
  if (aqi <= 50)
    return { label: "Good", from: "from-emerald-500", to: "to-green-600" };
  if (aqi <= 100)
    return { label: "Moderate", from: "from-yellow-500", to: "to-amber-600" };
  if (aqi <= 150)
    return {
      label: "Unhealthy for sensitive",
      from: "from-orange-500",
      to: "to-orange-700",
    };
  if (aqi <= 200)
    return { label: "Unhealthy", from: "from-rose-500", to: "to-red-700" };
  if (aqi <= 300)
    return {
      label: "Very unhealthy",
      from: "from-purple-600",
      to: "to-fuchsia-800",
    };
  return { label: "Hazardous", from: "from-red-700", to: "to-black" };
};

export function AirQualityBadge({ args, status }: AirQualityProps) {
  const city = args?.city ?? "—";
  const aqi = args?.aqi ?? 42;
  const level = LEVEL(aqi);
  const pct = Math.min(100, (aqi / 500) * 100);
  return (
    <div
      className={
        "relative overflow-hidden rounded-2xl bg-gradient-to-br p-6 text-white shadow-xl " +
        level.from +
        " " +
        level.to
      }
    >
      <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/20 blur-2xl" />
      <div className="relative flex items-start justify-between gap-6">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/80">
            Air Quality Index
          </div>
          <div className="mt-1 text-2xl font-semibold">{city}</div>
          <div className="mt-4 flex items-end gap-2">
            <span className="text-6xl font-bold leading-none">{aqi}</span>
            <span className="pb-1 text-xl font-light text-white/80">AQI</span>
          </div>
          <div className="mt-1 text-sm text-white/90">{level.label}</div>
        </div>
        <div className="flex flex-col items-end gap-2 text-5xl">
          🌫️
          <span className="rounded-full bg-black/25 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white">
            {status ?? "complete"}
          </span>
        </div>
      </div>
      <div className="relative mt-6">
        <div className="h-1.5 rounded-full bg-black/25">
          <div
            className="h-full rounded-full bg-white/80"
            style={{ width: pct + "%" }}
          />
        </div>
        <div className="mt-1 flex justify-between text-[10px] font-medium uppercase tracking-wider text-white/70">
          <span>0</span>
          <span>100</span>
          <span>200</span>
          <span>300</span>
          <span>500</span>
        </div>
      </div>
    </div>
  );
}
