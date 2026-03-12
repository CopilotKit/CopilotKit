"use client";

/**
 * StockCard - Static GenUI component for displaying stock price data
 *
 * Renders stock information with a mini sparkline chart showing price history.
 * Uses glassmorphism styling consistent with the mcp-apps design system.
 */

interface StockCardProps {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  priceHistory?: number[];
  companyName?: string;
}

/**
 * Mini sparkline chart using SVG path
 * Renders price history as a simple line chart
 */
function Sparkline({
  data,
  positive,
}: {
  data: number[];
  positive: boolean;
}) {
  if (!data || data.length < 2) return null;

  const width = 120;
  const height = 40;
  const padding = 2;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  // Generate SVG path points
  const points = data.map((value, index) => {
    const x = padding + (index / (data.length - 1)) * (width - padding * 2);
    const y = height - padding - ((value - min) / range) * (height - padding * 2);
    return `${x},${y}`;
  });

  const pathD = `M ${points.join(" L ")}`;

  // Create area fill path (connects to bottom corners)
  const areaD = `${pathD} L ${width - padding},${height - padding} L ${padding},${height - padding} Z`;

  const strokeColor = positive ? "var(--color-mint-dark)" : "#ef4444";
  const fillColor = positive ? "rgba(27, 147, 111, 0.1)" : "rgba(239, 68, 68, 0.1)";

  return (
    <svg width={width} height={height} className="overflow-visible">
      {/* Area fill */}
      <path d={areaD} fill={fillColor} />
      {/* Line */}
      <path
        d={pathD}
        fill="none"
        stroke={strokeColor}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* End dot */}
      <circle
        cx={width - padding}
        cy={height - padding - ((data[data.length - 1] - min) / range) * (height - padding * 2)}
        r={3}
        fill={strokeColor}
      />
    </svg>
  );
}

export function StockCard({
  symbol,
  price,
  change,
  changePercent,
  priceHistory,
  companyName,
}: StockCardProps) {
  const isPositive = change >= 0;
  const changeColor = isPositive ? "text-[var(--color-mint-dark)]" : "text-red-500";
  const changeArrow = isPositive ? "↑" : "↓";

  // Format price with 2 decimal places
  const formattedPrice = price.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  // Format change with sign
  const formattedChange = `${isPositive ? "+" : ""}${change.toFixed(2)}`;
  const formattedPercent = `${isPositive ? "+" : ""}${changePercent.toFixed(2)}%`;

  return (
    <div className="glass-card p-5 max-w-sm">
      {/* Header with symbol and company name */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-xl font-bold text-[var(--color-text-primary)]">
            {symbol}
          </h3>
          {companyName && (
            <p className="text-sm text-[var(--color-text-secondary)] truncate max-w-[180px]">
              {companyName}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-[var(--color-glass-subtle)]">
          <span className="text-xs text-[var(--color-text-tertiary)]">STOCK</span>
        </div>
      </div>

      {/* Price and change */}
      <div className="flex items-baseline gap-3 mb-4">
        <span className="text-3xl font-bold text-[var(--color-text-primary)]">
          ${formattedPrice}
        </span>
        <div className={`flex items-center gap-1 ${changeColor}`}>
          <span className="text-sm font-medium">
            {changeArrow} {formattedChange}
          </span>
          <span className="text-sm">({formattedPercent})</span>
        </div>
      </div>

      {/* Sparkline chart */}
      {priceHistory && priceHistory.length > 1 && (
        <div className="pt-3 border-t border-[var(--color-border-glass)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[var(--color-text-tertiary)]">
              Price History
            </span>
            <span className="text-xs text-[var(--color-text-tertiary)]">
              {priceHistory.length} points
            </span>
          </div>
          <Sparkline data={priceHistory} positive={isPositive} />
        </div>
      )}

      {/* Market status indicator */}
      <div className="flex items-center gap-2 mt-4 pt-3 border-t border-[var(--color-border-glass)]">
        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
        <span className="text-xs text-[var(--color-text-tertiary)]">
          Market Open
        </span>
      </div>
    </div>
  );
}

/**
 * Loading state for the stock card while data is being fetched
 */
export function StockLoadingState({ symbol }: { symbol?: string }) {
  return (
    <div className="glass-card p-5 max-w-sm animate-pulse">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="h-6 w-16 bg-[var(--color-surface)] rounded mb-2" />
          <div className="h-4 w-32 bg-[var(--color-surface)] rounded" />
        </div>
        <div className="h-6 w-14 bg-[var(--color-surface)] rounded-full" />
      </div>

      <div className="flex items-baseline gap-3 mb-4">
        <div className="h-8 w-28 bg-[var(--color-surface)] rounded" />
        <div className="h-5 w-20 bg-[var(--color-surface)] rounded" />
      </div>

      <div className="pt-3 border-t border-[var(--color-border-glass)]">
        <div className="flex items-center justify-between mb-2">
          <div className="h-3 w-20 bg-[var(--color-surface)] rounded" />
          <div className="h-3 w-16 bg-[var(--color-surface)] rounded" />
        </div>
        <div className="h-10 w-full bg-[var(--color-surface)] rounded" />
      </div>

      {symbol && (
        <p className="text-xs text-[var(--color-text-tertiary)] mt-3">
          Loading data for {symbol}...
        </p>
      )}
    </div>
  );
}
