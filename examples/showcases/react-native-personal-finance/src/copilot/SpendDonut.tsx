/**
 * SpendDonut — an in-chat SVG donut chart of spending by category.
 *
 * This is the headline "controlled graph inside chat" surface: when the agent
 * commissions `getSpendByCategory`, the tool's render function mounts this
 * component with the aggregated data. Pure SVG (react-native-svg), no chart
 * library — segments are computed as arc paths with cartesian math.
 *
 * Each slice gets a stable color from a 7-color palette; categories beyond
 * the 6th are bucketed into "Other" so the chart stays readable. The center
 * shows the total spend; a legend below lists categories with emoji,
 * formatted amount, and percentage.
 */

import { Text, View } from "react-native";
import Svg, { Circle, G, Path } from "react-native-svg";
import { colors, radius, spacing } from "../components/theme";
import { formatCurrency } from "../lib/currency";
import type { CurrencyCode } from "../types";

export interface SpendDonutSlice {
  category: string;
  icon: string;
  total: number;
}

export interface SpendDonutProps {
  /** Pre-aggregated, base-currency totals per category (descending). */
  slices: SpendDonutSlice[];
  /** Currency code to format amounts with (the store's base currency). */
  currency: CurrencyCode;
  /** Title above the chart (e.g. "This month"). */
  title?: string;
}

/**
 * Slice colors. Tuned to the brand accent green + a complementary palette
 * that stays distinguishable on iOS/Android default backgrounds.
 */
const SLICE_COLORS = [
  "#16A34A", // accent green
  "#2563EB", // blue
  "#D97706", // amber
  "#DC2626", // red
  "#8B5CF6", // violet
  "#14B8A6", // teal
  "#9CA3AF", // gray ("Other")
] as const;

const SIZE = 220;
const CENTER = SIZE / 2;
const OUTER_R = 100;
const INNER_R = 60;
const MAX_SLICES_BEFORE_OTHER = 6;

/**
 * Convert a (centered, top-zero, clockwise) polar angle in radians to SVG
 * cartesian coordinates around the chart center.
 */
function polar(angleRad: number, r: number): { x: number; y: number } {
  return {
    x: CENTER + r * Math.sin(angleRad),
    y: CENTER - r * Math.cos(angleRad),
  };
}

/**
 * Build an SVG path string for a single donut slice from `startAngle` to
 * `endAngle` (both radians, 0 at the top, increasing clockwise). The outer
 * arc sweeps clockwise; the inner arc sweeps counter-clockwise so the path
 * closes correctly.
 */
function arcPath(startAngle: number, endAngle: number): string {
  const so = polar(startAngle, OUTER_R);
  const eo = polar(endAngle, OUTER_R);
  const si = polar(startAngle, INNER_R);
  const ei = polar(endAngle, INNER_R);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return [
    `M ${so.x} ${so.y}`,
    `A ${OUTER_R} ${OUTER_R} 0 ${largeArc} 1 ${eo.x} ${eo.y}`,
    `L ${ei.x} ${ei.y}`,
    `A ${INNER_R} ${INNER_R} 0 ${largeArc} 0 ${si.x} ${si.y}`,
    "Z",
  ].join(" ");
}

type RenderedSlice = SpendDonutSlice & { color: string; pct: number };

/** Collapse a long tail of small categories into a single "Other" slice. */
function compress(slices: SpendDonutSlice[]): SpendDonutSlice[] {
  if (slices.length <= MAX_SLICES_BEFORE_OTHER) return slices;
  const head = slices.slice(0, MAX_SLICES_BEFORE_OTHER - 1);
  const tail = slices.slice(MAX_SLICES_BEFORE_OTHER - 1);
  const otherTotal = tail.reduce((s, x) => s + x.total, 0);
  return [...head, { category: "Other", icon: "•", total: otherTotal }];
}

export function SpendDonut({ slices, currency, title }: SpendDonutProps) {
  const compressed = compress(slices.filter((s) => s.total > 0));
  const total = compressed.reduce((s, x) => s + x.total, 0);

  // Empty state — no expenses this month.
  if (total <= 0 || compressed.length === 0) {
    return (
      <View
        style={{
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.lg,
          backgroundColor: colors.card,
          padding: spacing.lg,
          marginVertical: spacing.sm,
        }}
      >
        {title ? (
          <Text
            style={{
              fontSize: 14,
              fontWeight: "600",
              color: colors.textMuted,
              marginBottom: spacing.sm,
            }}
          >
            {title}
          </Text>
        ) : null}
        <Text style={{ color: colors.textMuted, fontSize: 14 }}>
          No expenses recorded yet for this period.
        </Text>
      </View>
    );
  }

  // Build per-slice cumulative angles + colors + percentages.
  const TAU = Math.PI * 2;
  let angle = 0;
  const rendered: RenderedSlice[] = compressed.map((s, i) => {
    const startAngle = angle;
    const sweep = (s.total / total) * TAU;
    angle += sweep;
    return {
      ...s,
      color: SLICE_COLORS[i] ?? SLICE_COLORS[SLICE_COLORS.length - 1],
      pct: s.total / total,
    };
  });

  const isSingleSlice = rendered.length === 1;

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.lg,
        backgroundColor: colors.card,
        padding: spacing.lg,
        marginVertical: spacing.sm,
        shadowColor: "#000000",
        shadowOpacity: 0.05,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
        elevation: 2,
      }}
    >
      {title ? (
        <Text
          style={{
            fontSize: 14,
            fontWeight: "600",
            color: colors.textMuted,
            marginBottom: spacing.sm,
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          {title}
        </Text>
      ) : null}

      <View style={{ alignItems: "center", marginBottom: spacing.md }}>
        <Svg width={SIZE} height={SIZE}>
          <G>
            {/* Track ring under the slices so a single-slice chart still
                reads as a donut and so any rounding gaps stay invisible. */}
            <Circle
              cx={CENTER}
              cy={CENTER}
              r={(OUTER_R + INNER_R) / 2}
              stroke={colors.track}
              strokeWidth={OUTER_R - INNER_R}
              fill="none"
            />
            {isSingleSlice ? (
              // Special-case: a 360° arc would render as a zero-length path,
              // so just draw a filled ring for the single-slice case.
              <Circle
                cx={CENTER}
                cy={CENTER}
                r={(OUTER_R + INNER_R) / 2}
                stroke={rendered[0].color}
                strokeWidth={OUTER_R - INNER_R}
                fill="none"
              />
            ) : (
              rendered.map((slice, i) => {
                const startAngle =
                  rendered.slice(0, i).reduce((s, x) => s + x.pct, 0) * TAU;
                const endAngle = startAngle + slice.pct * TAU;
                return (
                  <Path
                    key={slice.category}
                    d={arcPath(startAngle, endAngle)}
                    fill={slice.color}
                  />
                );
              })
            )}
          </G>
        </Svg>

        {/* Center label sits above the SVG via absolute positioning. */}
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text
            style={{
              fontSize: 11,
              color: colors.textMuted,
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            Total
          </Text>
          <Text
            style={{
              fontSize: 22,
              fontWeight: "800",
              color: colors.textPrimary,
              marginTop: 2,
            }}
          >
            {formatCurrency(total, currency)}
          </Text>
        </View>
      </View>

      {/* Legend */}
      <View style={{ marginTop: spacing.xs }}>
        {rendered.map((slice) => (
          <View
            key={slice.category}
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingVertical: 6,
            }}
          >
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                backgroundColor: slice.color,
                marginRight: spacing.sm,
              }}
            />
            <Text style={{ fontSize: 16, marginRight: 6 }}>{slice.icon}</Text>
            <Text
              numberOfLines={1}
              style={{
                flex: 1,
                fontSize: 14,
                fontWeight: "600",
                color: colors.textPrimary,
              }}
            >
              {slice.category}
            </Text>
            <Text
              style={{
                fontSize: 13,
                color: colors.textMuted,
                marginRight: spacing.sm,
              }}
            >
              {Math.round(slice.pct * 100)}%
            </Text>
            <Text
              style={{
                fontSize: 14,
                fontWeight: "700",
                color: colors.textPrimary,
              }}
            >
              {formatCurrency(slice.total, currency)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
