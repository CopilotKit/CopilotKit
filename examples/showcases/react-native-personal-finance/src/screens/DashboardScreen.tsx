/**
 * Dashboard — the finance tracker's home screen.
 *
 * A net-worth headline (every account converted into the base currency), the
 * account cards, a budgets-at-a-glance horizontal strip, and the five most
 * recent transactions. Reads the store directly and subscribes to the slices
 * it renders so it re-renders when the assistant (or the user) mutates data.
 */

import { ScrollView, Text, View } from "react-native";
import {
  budgetSpent,
  netWorthInBase,
  recentTransactions,
  useFinanceStore,
} from "../store/financeStore";
import { formatCurrency } from "../lib/currency";
import { AccountCard } from "../components/AccountCard";
import { BudgetBar } from "../components/BudgetBar";
import { TransactionRow } from "../components/TransactionRow";
import {
  EmptyState,
  ScreenContainer,
  SectionHeader,
} from "../components/ScreenContainer";
import { cardSurface, colors, radius, spacing } from "../components/theme";

export default function DashboardScreen() {
  // Subscribe to the slices we render so helper recomputations stay reactive.
  const accounts = useFinanceStore((s) => s.accounts);
  const transactions = useFinanceStore((s) => s.transactions);
  const budgets = useFinanceStore((s) => s.budgets);
  const categories = useFinanceStore((s) => s.categories);
  const baseCurrency = useFinanceStore((s) => s.baseCurrency);

  const netWorth = netWorthInBase();
  const recent = recentTransactions(5);

  const iconFor = (category: string): string =>
    categories.find((c) => c.name === category)?.icon ?? "💳";
  const accountNameFor = (accountId: string): string | undefined =>
    accounts.find((a) => a.id === accountId)?.name;

  return (
    <ScreenContainer title="Overview" subtitle="Your money at a glance">
      {/* Net worth headline */}
      <View
        style={[
          cardSurface,
          { backgroundColor: colors.textPrimary, padding: spacing.lg },
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
          Net Worth
        </Text>
        <Text
          style={{
            fontSize: 36,
            fontWeight: "800",
            color: "#FFFFFF",
            marginTop: 6,
            letterSpacing: -0.5,
          }}
        >
          {formatCurrency(netWorth, baseCurrency)}
        </Text>
        <Text
          style={{
            fontSize: 13,
            color: "rgba(255,255,255,0.6)",
            marginTop: 4,
          }}
        >
          Across {accounts.length}{" "}
          {accounts.length === 1 ? "account" : "accounts"} · in {baseCurrency}
        </Text>
      </View>

      {/* Accounts */}
      <SectionHeader title="Accounts" />
      {accounts.length === 0 ? (
        <EmptyState
          emoji="🏦"
          title="No accounts yet"
          hint="Add an account to start tracking your balances."
        />
      ) : (
        accounts.map((account) => (
          <AccountCard key={account.id} account={account} compact />
        ))
      )}

      {/* Budgets at a glance */}
      {budgets.length > 0 ? (
        <>
          <SectionHeader title="Budgets" />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{
              paddingVertical: 2,
              paddingRight: spacing.md,
            }}
          >
            {budgets.map((budget) => (
              <BudgetBar
                key={budget.id}
                budget={budget}
                spent={budgetSpent(budget.category)}
                categoryIcon={iconFor(budget.category)}
                compact
              />
            ))}
          </ScrollView>
        </>
      ) : null}

      {/* Recent transactions */}
      <SectionHeader title="Recent activity" />
      {recent.length === 0 ? (
        <EmptyState
          emoji="🧾"
          title="No transactions yet"
          hint="Your latest spending will show up here."
        />
      ) : (
        <View style={[cardSurface, { paddingVertical: spacing.xs }]}>
          {recent.map((txn, i) => (
            <TransactionRow
              key={txn.id}
              txn={txn}
              categoryIcon={iconFor(txn.category)}
              accountName={accountNameFor(txn.accountId)}
              divider={i < recent.length - 1}
            />
          ))}
        </View>
      )}

      {/* Hint footer (no navigation here — screens are standalone). */}
      {transactions.length > recent.length ? (
        <View style={{ alignItems: "center", marginTop: spacing.md }}>
          <View
            style={{
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              borderRadius: radius.pill,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Text
              style={{
                fontSize: 13,
                fontWeight: "600",
                color: colors.textMuted,
              }}
            >
              +{transactions.length - recent.length} more in Transactions
            </Text>
          </View>
        </View>
      ) : null}
    </ScreenContainer>
  );
}
