"use client";

export type Flight = {
  id: string;
  airline: string;
  flight_no: string;
  origin: string;
  destination: string;
  depart: string;
  arrive: string;
  duration: string;
  stops: number;
  cabin: string;
  price_usd: number;
  notes: string;
};

const _cache = new Map<string, Flight>();

export function rememberFlights(list: Flight[]): void {
  for (const f of list) {
    if (f && typeof f === "object" && typeof f.id === "string") {
      _cache.set(f.id, f);
    }
  }
}

export function getFlight(id: string): Flight | undefined {
  return _cache.get(id);
}

export function parseFlights(result: string): Flight[] {
  try {
    const parsed: unknown = JSON.parse(result);
    if (Array.isArray(parsed)) {
      const flights: Flight[] = parsed
        .filter(
          (el): el is Record<string, unknown> =>
            el != null &&
            typeof el === "object" &&
            typeof (el as Record<string, unknown>).id === "string",
        )
        .map((el) => ({
          ...(el as Flight),
          price_usd:
            typeof el.price_usd === "number"
              ? el.price_usd
              : Number(el.price_usd) || 0,
        }));
      rememberFlights(flights);
      return flights;
    }
    return [];
  } catch {
    return [];
  }
}

export function formatTime(iso: string): string {
  if (!iso || typeof iso !== "string") return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function stopsLabel(stops: number): string {
  if (stops === 0) return "Nonstop";
  if (stops === 1) return "1 stop";
  return `${stops} stops`;
}
