/**
 * Budgets — each monthly budget as a progress bar (spent via budgetSpent()
 * vs its limit), % used, over-budget styling and amounts via formatCurrency.
 *
 * Reads the store directly and subscribes to the budgets/transactions slices
 * so bars update live as spending changes. A summary header rolls the budgets
 * up into a single total-spent-vs-budgeted bar in the base currency.
 */

import { FlatList, Text, View } from "react-native";
import { budgetSpent, useFinanceStore } from "../store/financeStore";
import type { Budget } from "../types";
import { convert, formatCurrency } from "../lib/currency";
import { BudgetBar } from "../components/BudgetBar";
import { EmptyState, ScreenContainer } from "../components/ScreenContainer";
import { cardSurface, colors, radius, spacing } from "../components/theme";

export default function BudgetsScreen() {
  const budgets = useFinanceStore((s) => s.budgets);
  const categories = useFinanceStore((s) => s.categories);
  const baseCurrency = useFinanceStore((s) => s.baseCurrency);
  // Subscribe to transactions so budgetSpent() recomputes reactively.
  useFinanceStore((s) => s.transactions);

  const iconFor = (category: string): string =>
    categories.find((c) => c.name === category)?.icon ?? "💰";

  // Roll up every budget into the base currency for the summary bar.
  let totalLimit = 0;
  let totalSpent = 0;
  for (const b of budgets) {
    totalLimit += convert(b.limit, b.currency, baseCurrency);
    totalSpent += convert(budgetSpent(b.category), b.currency, baseCurrency);
  }
  const overCount = budgets.filter(
    (b) => budgetSpent(b.category) > b.limit,
  ).length;

  return (
    <ScreenContainer title="Budgets" subtitle="This month" scroll={false}>
      <FlatList<Budget>
        data={budgets}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{
          paddingHorizontal: spacing.screen,
          paddingBottom: spacing.xl,
        }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          budgets.length > 0 ? (
            <BudgetSummary
              totalSpent={totalSpent}
              totalLimit={totalLimit}
              baseCurrency={baseCurrency}
              overCount={overCount}
            />
          ) : null
        }
        renderItem={({ item }) => (
          <BudgetBar
            budget={item}
            spent={budgetSpent(item.category)}
            categoryIcon={iconFor(item.category)}
          />
        )}
        ListEmptyComponent={
          <EmptyState
            emoji="🎯"
            title="No budgets set"
            hint="Set a monthly limit for a category to track your spending."
          />
        }
      />
    </ScreenContainer>
  );
}

function BudgetSummary({
  totalSpent,
  totalLimit,
  baseCurrency,
  overCount,
}: {
  totalSpent: number;
  totalLimit: number;
  baseCurrency: Budget["currency"];
  overCount: number;
}) {
  const ratio = totalLimit > 0 ? totalSpent / totalLimit : 0;
  const pct = Math.round(ratio * 100);
  const over = ratio > 1;
  const fillWidth = `${Math.min(Math.max(ratio, 0), 1) * 100}%` as const;
  const barColor = over ? colors.negative : colors.accent;

  return (
    <View style={[cardSurface, { marginBottom: spacing.lg }]}>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <Text
          style={{
            fontSize: 13,
            fontWeight: "600",
            color: colors.textMuted,
            textTransform: "uppercase",
            letterSpacing: 0.6,
          }}
        >
          Spent this month
        </Text>
        <Text style={{ fontSize: 13, fontWeight: "700", color: barColor }}>
          {pct}%
        </Text>
      </View>

      <Text
        style={{
          fontSize: 28,
          fontWeight: "800",
          color: colors.textPrimary,
          marginTop: 4,
          letterSpacing: -0.5,
        }}
      >
        {formatCurrency(totalSpent, baseCurrency)}
        <Text
          style={{ fontSize: 16, fontWeight: "600", color: colors.textFaint }}
        >
          {"  /  "}
          {formatCurrency(totalLimit, baseCurrency)}
        </Text>
      </Text>

      {/* Roll-up track */}
      <View
        style={{
          height: 10,
          borderRadius: radius.pill,
          backgroundColor: colors.track,
          overflow: "hidden",
          marginTop: spacing.md,
        }}
      >
        <View
          style={{
            width: fillWidth,
            height: "100%",
            borderRadius: radius.pill,
            backgroundColor: barColor,
          }}
        />
      </View>

      {overCount > 0 ? (
        <Text
          style={{
            fontSize: 13,
            fontWeight: "600",
            color: colors.negative,
            marginTop: spacing.sm,
          }}
        >
          {overCount} {overCount === 1 ? "budget" : "budgets"} over limit
        </Text>
      ) : (
        <Text
          style={{
            fontSize: 13,
            color: colors.textMuted,
            marginTop: spacing.sm,
          }}
        >
          All budgets on track
        </Text>
      )}
    </View>
  );
}
