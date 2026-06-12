/**
 * Presentational transaction row.
 *
 * Shows the category emoji, merchant, the account it hit and the category,
 * plus a signed amount in the transaction's OWN currency (income positive and
 * green, expense negative). Prop-driven: the parent resolves `categoryIcon`
 * and `accountName` (via the store's categories / accountById) and passes them
 * in, so this row reads nothing from the store itself.
 */

import { Text, View } from "react-native";
import type { Transaction } from "../types";
import { formatCurrency } from "../lib/currency";
import { colors, radius, spacing } from "./theme";

export interface TransactionRowProps {
  txn: Transaction;
  /** Emoji for the txn's category (looked up by the parent). */
  categoryIcon?: string;
  /** Display name of the account the txn belongs to. */
  accountName?: string;
  /** Render a bottom hairline divider. Defaults to true. */
  divider?: boolean;
}

export function TransactionRow({
  txn,
  categoryIcon = "💳",
  accountName,
  divider = true,
}: TransactionRowProps) {
  const income = txn.kind === "income";
  const sign = income ? "+" : "-";
  const formatted = formatCurrency(Math.abs(txn.amount), txn.currency);

  // Secondary line: "Account · Category" (drop the dot if no account name).
  const subtitleParts = [accountName, txn.category].filter((p): p is string =>
    Boolean(p),
  );
  const subtitle = subtitleParts.join("  ·  ");

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: spacing.md,
        borderBottomWidth: divider ? 1 : 0,
        borderBottomColor: colors.hairline,
      }}
    >
      {/* Category emoji chip */}
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: radius.pill,
          backgroundColor: colors.bg,
          alignItems: "center",
          justifyContent: "center",
          marginRight: spacing.md,
        }}
      >
        <Text style={{ fontSize: 20 }}>{categoryIcon}</Text>
      </View>

      {/* Merchant + account/category */}
      <View style={{ flex: 1, flexShrink: 1 }}>
        <Text
          numberOfLines={1}
          style={{
            fontSize: 15,
            fontWeight: "600",
            color: colors.textPrimary,
          }}
        >
          {txn.merchant}
        </Text>
        {subtitle ? (
          <Text
            numberOfLines={1}
            style={{ fontSize: 13, color: colors.textMuted, marginTop: 2 }}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>

      {/* Signed amount in the txn's own currency */}
      <Text
        style={{
          fontSize: 15,
          fontWeight: "700",
          marginLeft: spacing.sm,
          color: income ? colors.accent : colors.textPrimary,
        }}
      >
        {sign}
        {formatted}
      </Text>
    </View>
  );
}
