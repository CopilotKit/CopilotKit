/**
 * Presentational account card.
 *
 * Renders a single account's icon, name, type + currency badge and its
 * balance. Negative balances (e.g. a credit card) render in the negative
 * color. Prop-driven — pass an `Account`; it reads nothing from the store.
 */

import { Text, View } from "react-native";
import type { Account } from "../types";
import { formatCurrency } from "../lib/currency";
import {
  accountTypeLabel,
  cardSurface,
  colors,
  radius,
  spacing,
} from "./theme";

export interface AccountCardProps {
  account: Account;
  /** Tighter vertical padding for dense lists. Defaults to false. */
  compact?: boolean;
}

export function AccountCard({ account, compact = false }: AccountCardProps) {
  const negative = account.balance < 0;

  return (
    <View
      style={[
        cardSurface,
        {
          flexDirection: "row",
          alignItems: "center",
          padding: compact ? spacing.md : spacing.lg,
          marginBottom: spacing.md,
        },
      ]}
    >
      {/* Icon chip */}
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: radius.md,
          backgroundColor: colors.bg,
          alignItems: "center",
          justifyContent: "center",
          marginRight: spacing.md,
        }}
      >
        <Text style={{ fontSize: 22 }}>{account.icon}</Text>
      </View>

      {/* Name + type/currency */}
      <View style={{ flex: 1, flexShrink: 1 }}>
        <Text
          numberOfLines={1}
          style={{
            fontSize: 16,
            fontWeight: "700",
            color: colors.textPrimary,
          }}
        >
          {account.name}
        </Text>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            marginTop: 3,
          }}
        >
          <TypePill label={accountTypeLabel(account.type)} />
          <Text
            style={{
              fontSize: 13,
              color: colors.textMuted,
              marginLeft: spacing.sm,
            }}
          >
            {account.currency}
          </Text>
        </View>
      </View>

      {/* Balance */}
      <Text
        style={{
          fontSize: 17,
          fontWeight: "700",
          marginLeft: spacing.sm,
          color: negative ? colors.negative : colors.textPrimary,
        }}
      >
        {formatCurrency(account.balance, account.currency)}
      </Text>
    </View>
  );
}

function TypePill({ label }: { label: string }) {
  return (
    <View
      style={{
        paddingHorizontal: spacing.sm,
        paddingVertical: 2,
        borderRadius: radius.pill,
        backgroundColor: colors.bg,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <Text
        style={{
          fontSize: 11,
          fontWeight: "600",
          color: colors.textSecondary,
          textTransform: "uppercase",
          letterSpacing: 0.4,
        }}
      >
        {label}
      </Text>
    </View>
  );
}
