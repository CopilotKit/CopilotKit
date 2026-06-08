export type Stock = {
  ticker: string;
  company: string;
  price: number;
  changePct: number;
  /** 30 closing prices, oldest → newest. */
  sparkline: number[];
  marketCap: string;
  sector: string;
};

const seedSparkline = (
  seed: number,
  start: number,
  trend: number,
  volatility = 1,
): number[] => {
  const out: number[] = [];
  let v = start;
  let rng = seed;
  for (let i = 0; i < 30; i++) {
    rng = (rng * 9301 + 49297) % 233280;
    const noise = (rng / 233280 - 0.5) * volatility;
    v += trend / 30 + noise;
    out.push(Math.round(v * 100) / 100);
  }
  return out;
};

export const STOCKS: Stock[] = [
  {
    ticker: "AAPL",
    company: "Apple Inc.",
    price: 232.41,
    changePct: 1.84,
    sparkline: seedSparkline(11, 225, 7, 1.4),
    marketCap: "3.51T",
    sector: "Technology",
  },
  {
    ticker: "MSFT",
    company: "Microsoft Corp.",
    price: 428.96,
    changePct: 0.62,
    sparkline: seedSparkline(23, 420, 9, 2.1),
    marketCap: "3.19T",
    sector: "Technology",
  },
  {
    ticker: "GOOG",
    company: "Alphabet Inc.",
    price: 181.7,
    changePct: -0.43,
    sparkline: seedSparkline(47, 184, -2, 1.8),
    marketCap: "2.24T",
    sector: "Technology",
  },
  {
    ticker: "NVDA",
    company: "NVIDIA Corp.",
    price: 139.27,
    changePct: 3.21,
    sparkline: seedSparkline(101, 128, 11, 2.5),
    marketCap: "3.42T",
    sector: "Semiconductors",
  },
  {
    ticker: "TSLA",
    company: "Tesla Inc.",
    price: 346.18,
    changePct: -2.04,
    sparkline: seedSparkline(67, 360, -14, 3.2),
    marketCap: "1.10T",
    sector: "Automotive",
  },
  {
    ticker: "AMZN",
    company: "Amazon.com Inc.",
    price: 224.92,
    changePct: 0.94,
    sparkline: seedSparkline(89, 220, 5, 1.6),
    marketCap: "2.36T",
    sector: "Consumer",
  },
];

export function getStock(ticker: string): Stock | undefined {
  return STOCKS.find((s) => s.ticker.toLowerCase() === ticker.toLowerCase());
}
