/**
 * Accounts — every account with its balance, type and currency, plus the
 * total net worth (all balances converted into the base currency).
 *
 * Reads the store directly and subscribes to the accounts/baseCurrency slices
 * so it re-renders when balances change.
 */

import { FlatList, Text, View } from "react-native";
import { netWorthInBase, useFinanceStore } from "../store/financeStore";
import type { Account } from "../types";
import { formatCurrency } from "../lib/currency";
import { AccountCard } from "../components/AccountCard";
import { EmptyState, ScreenContainer } from "../components/ScreenContainer";
import { cardSurface, colors, spacing } from "../components/theme";

export default function AccountsScreen() {
  const accounts = useFinanceStore((s) => s.accounts);
  const baseCurrency = useFinanceStore((s) => s.baseCurrency);

  const netWorth = netWorthInBase();

  return (
    <ScreenContainer
      title="Accounts"
      subtitle={`${accounts.length} ${
        accounts.length === 1 ? "account" : "accounts"
      }`}
      scroll={false}
    >
      <FlatList<Account>
        data={accounts}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{
          paddingHorizontal: spacing.screen,
          paddingBottom: spacing.xl,
        }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <NetWorthSummary
            total={netWorth}
            baseCurrency={baseCurrency}
            count={accounts.length}
          />
        }
        renderItem={({ item }) => <AccountCard account={item} />}
        ListEmptyComponent={
          <EmptyState
            emoji="🏦"
            title="No accounts yet"
            hint="Add a cash, bank, card or savings account to get started."
          />
        }
      />
    </ScreenContainer>
  );
}

function NetWorthSummary({
  total,
  baseCurrency,
  count,
}: {
  total: number;
  baseCurrency: Account["currency"];
  count: number;
}) {
  if (count === 0) return null;
  return (
    <View
      style={[
        cardSurface,
        { backgroundColor: colors.textPrimary, marginBottom: spacing.lg },
      ]}
    >
      <Text
        style={{
          fontSize: 13,
          fontWeight: "600",
          color: "rgba(255,255,255,0.7)",
          textTransform: "uppercase",
          letterSpacing: 0.6,
        }}
      >
        Total Net Worth
      </Text>
      <Text
        style={{
          fontSize: 32,
          fontWeight: "800",
          color: "#FFFFFF",
          marginTop: 6,
          letterSpacing: -0.5,
        }}
      >
        {formatCurrency(total, baseCurrency)}
      </Text>
      <Text
        style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", marginTop: 4 }}
      >
        Converted to {baseCurrency}
      </Text>
    </View>
  );
}
