/**
 * Shared visual tokens for the finance-tracker UI.
 *
 * A tiny, dependency-free design system so every screen and card pulls from
 * one palette/scale instead of scattering hex codes and magic numbers. Matches
 * the look already established by src/copilot/ApprovalCard.tsx (white rounded
 * cards, subtle borders, a green accent).
 */

import type { TextStyle, ViewStyle } from "react-native";

export const colors = {
  /** Screen background — a hair off pure white so white cards lift. */
  bg: "#F5F6F8",
  card: "#FFFFFF",
  border: "#E2E5EA",
  /** Faint hairline used inside cards between rows. */
  hairline: "#F0F2F5",

  textPrimary: "#1A1D21",
  textSecondary: "#374151",
  textMuted: "#6B7280",
  textFaint: "#9CA3AF",

  /** Primary accent (also used for income / positive amounts). */
  accent: "#16A34A",
  accentSoft: "#ECFDF5",

  /** Negative amounts, over-budget, debt. */
  negative: "#DC2626",
  negativeSoft: "#FEF2F2",

  /** Near-limit budget warning. */
  warning: "#D97706",
  warningSoft: "#FFFBEB",

  /** Neutral track for progress bars. */
  track: "#EEF0F3",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 20,
  xl: 32,
  /** Standard horizontal screen gutter. */
  screen: 16,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

/** A reusable rounded-card surface with the standard border + soft shadow. */
export const cardSurface: ViewStyle = {
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: radius.lg,
  backgroundColor: colors.card,
  padding: spacing.lg,
  shadowColor: "#000000",
  shadowOpacity: 0.05,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 2 },
  elevation: 2,
};

export const typography: Record<string, TextStyle> = {
  screenTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: colors.textPrimary,
    letterSpacing: -0.5,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textMuted,
  },
};

/**
 * Pick a display color for a signed monetary amount: income/credits in the
 * accent green, expenses/debits in the neutral primary text color.
 */
export function amountColor(kind: "income" | "expense"): string {
  return kind === "income" ? colors.accent : colors.textPrimary;
}

/** Pretty, human label for an account type. */
export function accountTypeLabel(
  type: "cash" | "bank" | "card" | "savings",
): string {
  switch (type) {
    case "cash":
      return "Cash";
    case "bank":
      return "Bank";
    case "card":
      return "Card";
    case "savings":
      return "Savings";
    default:
      return type;
  }
}
