/**
 * Curated chart palette — warm, harmonious tones that complement
 * the Fredoka / neutral-grayscale design system.
 */
export const CHART_COLORS = [
  "#6366f1", // indigo
  "#f472b6", // pink
  "#34d399", // emerald
  "#fbbf24", // amber
  "#60a5fa", // sky
  "#a78bfa", // violet
  "#fb923c", // orange
] as const;

export const CHART_CONFIG = {
  tooltipStyle: {
    backgroundColor: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: "10px",
    padding: "10px 14px",
    color: "var(--foreground)",
    fontSize: "13px",
    fontFamily: "var(--font-body)",
    boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
  },
};
