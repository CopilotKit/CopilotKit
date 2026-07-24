/**
 * Presentational budget progress bar.
 *
 * Given a `Budget`, the amount `spent` (already summed in the budget's
 * currency by the parent via budgetSpent()), and the category emoji, it draws
 * a labelled progress bar with the % used. Over-budget bars turn red; bars
 * near the limit turn amber. Prop-driven — no store reads here.
 *
 * A `compact` variant (icon + slim bar + %) is used in the dashboard's
 * budgets-at-a-glance strip.
 */

import { Text, View } from "react-native";
import type { Budget } from "../types";
import { formatCurrency } from "../lib/currency";
import { colors, radius, spacing } from "./theme";

export interface BudgetBarProps {
  budget: Budget;
  /** Amount spent this period, in the budget's currency. */
  spent: number;
  categoryIcon?: string;
  /** Slim, label-light variant for horizontal strips. Defaults to false. */
  compact?: boolean;
}

/** Warn (amber) once a budget passes this fraction of its limit. */
const WARN_THRESHOLD = 0.85;

function progressColor(ratio: number): string {
  if (ratio >= 1) return colors.negative;
  if (ratio >= WARN_THRESHOLD) return colors.warning;
  return colors.accent;
}

export function BudgetBar({
  budget,
  spent,
  categoryIcon = "💰",
  compact = false,
}: BudgetBarProps) {
  // Guard against a zero/negative limit so we never divide by zero.
  const ratio = budget.limit > 0 ? spent / budget.limit : 0;
  const pct = Math.round(ratio * 100);
  const fillWidth = `${Math.min(Math.max(ratio, 0), 1) * 100}%` as const;
  const over = ratio > 1;
  const barColor = progressColor(ratio);
  const remaining = budget.limit - spent;

  if (compact) {
    return (
      <View style={{ width: 132, marginRight: spacing.md }}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={{ fontSize: 15, marginRight: 6 }}>{categoryIcon}</Text>
          <Text
            numberOfLines={1}
            style={{
              flex: 1,
              fontSize: 12,
              fontWeight: "600",
              color: colors.textSecondary,
            }}
          >
            {budget.category}
          </Text>
        </View>
        <Track fillWidth={fillWidth} color={barColor} height={6} />
        <Text
          style={{
            fontSize: 12,
            fontWeight: "700",
            color: over ? colors.negative : colors.textMuted,
            marginTop: 4,
          }}
        >
          {pct}%
        </Text>
      </View>
    );
  }

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.lg,
        backgroundColor: colors.card,
        padding: spacing.lg,
        marginBottom: spacing.md,
      }}
    >
      {/* Header: icon + category, % used */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          marginBottom: spacing.sm,
        }}
      >
        <Text style={{ fontSize: 20, marginRight: spacing.sm }}>
          {categoryIcon}
        </Text>
        <Text
          style={{
            flex: 1,
            fontSize: 16,
            fontWeight: "700",
            color: colors.textPrimary,
          }}
          numberOfLines={1}
        >
          {budget.category}
        </Text>
        <View
          style={{
            paddingHorizontal: spacing.sm,
            paddingVertical: 2,
            borderRadius: radius.pill,
            backgroundColor: over
              ? colors.negativeSoft
              : ratio >= WARN_THRESHOLD
                ? colors.warningSoft
                : colors.accentSoft,
          }}
        >
          <Text style={{ fontSize: 12, fontWeight: "700", color: barColor }}>
            {pct}%
          </Text>
        </View>
      </View>

      <Track fillWidth={fillWidth} color={barColor} height={10} />

      {/* Footer: spent / limit and remaining-or-over */}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: spacing.sm,
        }}
      >
        <Text style={{ fontSize: 13, color: colors.textMuted }}>
          {formatCurrency(spent, budget.currency)}
          <Text style={{ color: colors.textFaint }}>
            {"  of  "}
            {formatCurrency(budget.limit, budget.currency)}
          </Text>
        </Text>
        <Text
          style={{
            fontSize: 13,
            fontWeight: "600",
            color: over ? colors.negative : colors.accent,
          }}
        >
          {over
            ? `${formatCurrency(Math.abs(remaining), budget.currency)} over`
            : `${formatCurrency(remaining, budget.currency)} left`}
        </Text>
      </View>
    </View>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * BudgetRow — slim, full-width variant for the in-chat budgets card.
 *
 * One budget per line: category icon + name, a right-aligned
 * "% · spent / limit" readout, and a slim full-width bar beneath. Distinct
 * from the `compact` variant above (the dashboard's fixed-width 132px
 * horizontal strip), so the two never disturb each other.
 * ────────────────────────────────────────────────────────────────────────── */

export interface BudgetRowProps {
  budget: Budget;
  /** Amount spent this period, in the budget's currency. */
  spent: number;
  categoryIcon?: string;
}

export function BudgetRow({
  budget,
  spent,
  categoryIcon = "💰",
}: BudgetRowProps) {
  const ratio = budget.limit > 0 ? spent / budget.limit : 0;
  const pct = Math.round(ratio * 100);
  const fillWidth = `${Math.min(Math.max(ratio, 0), 1) * 100}%` as const;
  const over = ratio > 1;
  const barColor = progressColor(ratio);
  // Whole-dollar amounts keep the single-line readout tight in a chat bubble.
  const money = (n: number) =>
    formatCurrency(n, budget.currency, { maximumFractionDigits: 0 });

  return (
    <View>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          marginBottom: 5,
        }}
      >
        <Text style={{ fontSize: 15, marginRight: 7 }}>{categoryIcon}</Text>
        <Text
          numberOfLines={1}
          style={{
            flex: 1,
            fontSize: 14,
            fontWeight: "600",
            color: colors.textPrimary,
          }}
        >
          {budget.category}
        </Text>
        <Text
          numberOfLines={1}
          style={{
            fontSize: 12,
            fontWeight: "700",
            color: over ? colors.negative : colors.textMuted,
            marginLeft: spacing.sm,
          }}
        >
          {pct}% · {money(spent)} / {money(budget.limit)}
        </Text>
      </View>
      <Track fillWidth={fillWidth} color={barColor} height={6} />
    </View>
  );
}

/** The neutral track with a colored fill. */
function Track({
  fillWidth,
  color,
  height,
}: {
  fillWidth: `${number}%`;
  color: string;
  height: number;
}) {
  return (
    <View
      style={{
        height,
        borderRadius: radius.pill,
        backgroundColor: colors.track,
        overflow: "hidden",
        marginTop: 2,
      }}
    >
      <View
        style={{
          width: fillWidth,
          height: "100%",
          borderRadius: radius.pill,
          backgroundColor: color,
        }}
      />
    </View>
  );
}
