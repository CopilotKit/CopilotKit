/**
 * Stock trading/investment simulator data layer for the UI Protocols Demo.
 * Contains mock stock data, portfolio management, and trade execution.
 */

export type Sector =
  | "technology"
  | "healthcare"
  | "finance"
  | "consumer"
  | "energy"
  | "industrial";
export type TradeType = "buy" | "sell";

export interface Stock {
  symbol: string;
  name: string;
  sector: Sector;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  marketCap: string;
}

export interface Holding {
  symbol: string;
  name: string;
  shares: number;
  avgCost: number;
  currentPrice: number;
  value: number;
  gain: number;
  gainPercent: number;
}

export interface Portfolio {
  id: string;
  name: string;
  cashBalance: number;
  holdings: Holding[];
  totalValue: number;
  totalGain: number;
  totalGainPercent: number;
  createdAt: string;
}

export interface Trade {
  id: string;
  portfolioId: string;
  type: TradeType;
  symbol: string;
  shares: number;
  price: number;
  total: number;
  timestamp: string;
}

export interface TradeResult {
  success: boolean;
  message: string;
  trade?: Trade;
  portfolio?: Portfolio;
}

// Mock stock database
const STOCKS: Stock[] = [
  {
    symbol: "AAPL",
    name: "Apple Inc.",
    sector: "technology",
    price: 178.5,
    change: 2.35,
    changePercent: 1.33,
    volume: 52400000,
    marketCap: "2.8T",
  },
  {
    symbol: "GOOGL",
    name: "Alphabet Inc.",
    sector: "technology",
    price: 141.25,
    change: -0.85,
    changePercent: -0.6,
    volume: 21300000,
    marketCap: "1.8T",
  },
  {
    symbol: "MSFT",
    name: "Microsoft Corp.",
    sector: "technology",
    price: 378.9,
    change: 4.2,
    changePercent: 1.12,
    volume: 18700000,
    marketCap: "2.8T",
  },
  {
    symbol: "AMZN",
    name: "Amazon.com Inc.",
    sector: "consumer",
    price: 178.25,
    change: 1.15,
    changePercent: 0.65,
    volume: 35200000,
    marketCap: "1.9T",
  },
  {
    symbol: "NVDA",
    name: "NVIDIA Corp.",
    sector: "technology",
    price: 875.5,
    change: 15.3,
    changePercent: 1.78,
    volume: 42100000,
    marketCap: "2.2T",
  },
  {
    symbol: "META",
    name: "Meta Platforms",
    sector: "technology",
    price: 505.75,
    change: -3.25,
    changePercent: -0.64,
    volume: 14800000,
    marketCap: "1.3T",
  },
  {
    symbol: "JPM",
    name: "JPMorgan Chase",
    sector: "finance",
    price: 195.4,
    change: 1.8,
    changePercent: 0.93,
    volume: 8900000,
    marketCap: "565B",
  },
  {
    symbol: "JNJ",
    name: "Johnson & Johnson",
    sector: "healthcare",
    price: 156.25,
    change: 0.45,
    changePercent: 0.29,
    volume: 6700000,
    marketCap: "376B",
  },
  {
    symbol: "XOM",
    name: "Exxon Mobil",
    sector: "energy",
    price: 104.8,
    change: -1.2,
    changePercent: -1.13,
    volume: 15400000,
    marketCap: "418B",
  },
  {
    symbol: "BA",
    name: "Boeing Co.",
    sector: "industrial",
    price: 178.9,
    change: 3.5,
    changePercent: 2.0,
    volume: 4200000,
    marketCap: "107B",
  },
  {
    symbol: "DIS",
    name: "Walt Disney Co.",
    sector: "consumer",
    price: 112.35,
    change: 0.9,
    changePercent: 0.81,
    volume: 9100000,
    marketCap: "205B",
  },
  {
    symbol: "V",
    name: "Visa Inc.",
    sector: "finance",
    price: 278.6,
    change: 2.1,
    changePercent: 0.76,
    volume: 5800000,
    marketCap: "570B",
  },
];

// In-memory storage
export const portfolios: Map<string, Portfolio> = new Map();
export const trades: Map<string, Trade[]> = new Map();

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Add some random price variation
function getStockWithVariation(stock: Stock): Stock {
  const variation = (Math.random() - 0.5) * 2; // -1 to 1 percent
  const newPrice = stock.price * (1 + variation / 100);
  const newChange = newPrice - (stock.price - stock.change);

  return {
    ...stock,
    price: Math.round(newPrice * 100) / 100,
    change: Math.round(newChange * 100) / 100,
    changePercent:
      Math.round((newChange / (stock.price - stock.change)) * 10000) / 100,
  };
}

export function getStocks(): Stock[] {
  return STOCKS.map((s) => getStockWithVariation(s));
}

export function getStock(symbol: string): Stock | undefined {
  const stock = STOCKS.find(
    (s) => s.symbol.toUpperCase() === symbol.toUpperCase(),
  );
  return stock ? getStockWithVariation(stock) : undefined;
}

export function getStocksBySector(sector: Sector): Stock[] {
  return STOCKS.filter((s) => s.sector === sector).map((s) =>
    getStockWithVariation(s),
  );
}

export function createPortfolio(params: {
  name?: string;
  initialBalance: number;
  riskTolerance?: "conservative" | "moderate" | "aggressive";
  focus?: Sector;
}): Portfolio {
  const {
    name = "My Portfolio",
    initialBalance,
    riskTolerance = "moderate",
    focus,
  } = params;

  const id = generateId("portfolio");

  const portfolio: Portfolio = {
    id,
    name,
    cashBalance: initialBalance,
    holdings: [],
    totalValue: initialBalance,
    totalGain: 0,
    totalGainPercent: 0,
    createdAt: new Date().toISOString(),
  };

  portfolios.set(id, portfolio);
  trades.set(id, []);

  return portfolio;
}

export function getPortfolio(portfolioId: string): Portfolio | undefined {
  const portfolio = portfolios.get(portfolioId);
  if (!portfolio) return undefined;

  // Recalculate values with current prices
  let holdingsValue = 0;
  let totalCost = 0;

  portfolio.holdings = portfolio.holdings.map((h) => {
    const currentStock = getStock(h.symbol);
    const currentPrice = currentStock?.price || h.currentPrice;
    const value = h.shares * currentPrice;
    const cost = h.shares * h.avgCost;
    const gain = value - cost;

    holdingsValue += value;
    totalCost += cost;

    return {
      ...h,
      currentPrice,
      value,
      gain,
      gainPercent: cost > 0 ? (gain / cost) * 100 : 0,
    };
  });

  portfolio.totalValue = portfolio.cashBalance + holdingsValue;
  portfolio.totalGain = holdingsValue - totalCost;
  portfolio.totalGainPercent =
    totalCost > 0 ? (portfolio.totalGain / totalCost) * 100 : 0;

  return portfolio;
}

export function executeTrade(
  portfolioId: string,
  type: TradeType,
  symbol: string,
  shares: number,
): TradeResult {
  const portfolio = portfolios.get(portfolioId);
  if (!portfolio) return { success: false, message: "Portfolio not found" };

  const stock = getStock(symbol);
  if (!stock) return { success: false, message: `Stock ${symbol} not found` };

  const total = stock.price * shares;

  if (type === "buy") {
    if (portfolio.cashBalance < total) {
      return {
        success: false,
        message: `Insufficient funds. Need $${total.toFixed(2)}, have $${portfolio.cashBalance.toFixed(2)}`,
      };
    }

    portfolio.cashBalance -= total;

    // Update or create holding
    const existingHolding = portfolio.holdings.find((h) => h.symbol === symbol);
    if (existingHolding) {
      const totalShares = existingHolding.shares + shares;
      const totalCost =
        existingHolding.shares * existingHolding.avgCost + total;
      existingHolding.shares = totalShares;
      existingHolding.avgCost = totalCost / totalShares;
      existingHolding.currentPrice = stock.price;
      existingHolding.value = totalShares * stock.price;
    } else {
      portfolio.holdings.push({
        symbol: stock.symbol,
        name: stock.name,
        shares,
        avgCost: stock.price,
        currentPrice: stock.price,
        value: shares * stock.price,
        gain: 0,
        gainPercent: 0,
      });
    }
  } else {
    // Sell
    const existingHolding = portfolio.holdings.find((h) => h.symbol === symbol);
    if (!existingHolding)
      return { success: false, message: `No ${symbol} shares to sell` };
    if (existingHolding.shares < shares) {
      return {
        success: false,
        message: `Not enough shares. Have ${existingHolding.shares}, trying to sell ${shares}`,
      };
    }

    portfolio.cashBalance += total;
    existingHolding.shares -= shares;

    if (existingHolding.shares === 0) {
      portfolio.holdings = portfolio.holdings.filter(
        (h) => h.symbol !== symbol,
      );
    } else {
      existingHolding.value = existingHolding.shares * stock.price;
    }
  }

  // Record trade
  const trade: Trade = {
    id: generateId("trade"),
    portfolioId,
    type,
    symbol,
    shares,
    price: stock.price,
    total,
    timestamp: new Date().toISOString(),
  };

  const portfolioTrades = trades.get(portfolioId) || [];
  portfolioTrades.push(trade);
  trades.set(portfolioId, portfolioTrades);

  return {
    success: true,
    message: `${type === "buy" ? "Bought" : "Sold"} ${shares} shares of ${symbol} at $${stock.price.toFixed(2)}`,
    trade,
    portfolio: getPortfolio(portfolioId),
  };
}

export function getTradeHistory(portfolioId: string): Trade[] {
  return trades.get(portfolioId) || [];
}

export function refreshPrices(portfolioId: string): Portfolio | undefined {
  return getPortfolio(portfolioId);
}
