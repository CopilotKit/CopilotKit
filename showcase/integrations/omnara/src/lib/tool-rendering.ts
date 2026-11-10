import { weatherTool } from "./weather-tool";

/** Handlers for the Omnara tool-rendering demo. */
export const toolRenderingHandlers = {
  get_weather: weatherTool.handler,
  search_flights: async ({
    origin,
    destination,
  }: {
    origin: string;
    destination: string;
  }) => ({
    origin,
    destination,
    flights: [
      {
        airline: "United",
        flight: "UA231",
        depart: "08:15",
        arrive: "16:45",
        price_usd: 348,
      },
      {
        airline: "Delta",
        flight: "DL412",
        depart: "11:20",
        arrive: "19:55",
        price_usd: 312,
      },
      {
        airline: "JetBlue",
        flight: "B6722",
        depart: "17:05",
        arrive: "01:30",
        price_usd: 289,
      },
    ],
  }),
  get_stock_price: async ({
    ticker,
    price_usd,
    change_pct,
  }: {
    ticker: string;
    price_usd?: number;
    change_pct?: number;
  }) => {
    const randInt = (lo: number, hi: number) =>
      Math.floor(Math.random() * (hi - lo + 1)) + lo;
    const sign = Math.random() < 0.5 ? -1 : 1;
    return {
      ticker: ticker.toUpperCase(),
      price_usd:
        price_usd != null
          ? Math.round(price_usd * 100) / 100
          : Math.round((100 + randInt(0, 400) + randInt(0, 99) / 100) * 100) /
            100,
      change_pct:
        change_pct != null
          ? Math.round(change_pct * 100) / 100
          : Math.round(sign * (randInt(0, 300) / 100) * 100) / 100,
    };
  },
  roll_d20: async ({ value }: { value?: number }) => {
    const rolled =
      typeof value === "number" && value >= 1 && value <= 20
        ? value
        : Math.floor(Math.random() * 20) + 1;
    return { sides: 20, value: rolled, result: rolled };
  },
};
