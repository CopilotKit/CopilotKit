/**
 * Transactions — every transaction grouped by day, newest day first and
 * newest within each day. Each row shows the category emoji, merchant, the
 * account it hit, and a signed amount in the transaction's own currency.
 *
 * Reads the store directly and subscribes to the slices it needs so new
 * transactions (from the user or the assistant) appear automatically.
 */

import { useMemo } from "react";
import { SectionList, Text, View } from "react-native";
import { useFinanceStore } from "../store/financeStore";
import type { Transaction } from "../types";
import { TransactionRow } from "../components/TransactionRow";
import { EmptyState, ScreenContainer } from "../components/ScreenContainer";
import { cardSurface, colors, spacing } from "../components/theme";

interface DaySection {
  /** ISO yyyy-mm-dd key for the day. */
  date: string;
  title: string;
  data: Transaction[];
}

/** Group transactions into day sections, newest day + newest-within-day first. */
function groupByDay(transactions: Transaction[]): DaySection[] {
  const byDay = new Map<string, Transaction[]>();
  for (const txn of transactions) {
    const list = byDay.get(txn.date);
    if (list) list.push(txn);
    else byDay.set(txn.date, [txn]);
  }

  return [...byDay.keys()]
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)) // newest day first
    .map((date) => ({
      date,
      title: formatDayLabel(date),
      // Stable id-desc within the day approximates newest-first insertion.
      data: [...(byDay.get(date) ?? [])].sort((a, b) =>
        a.id < b.id ? 1 : a.id > b.id ? -1 : 0,
      ),
    }));
}

/** "Today" / "Yesterday" / e.g. "Mon, May 26". */
function formatDayLabel(iso: string): string {
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const yest = new Date(today);
  yest.setDate(today.getDate() - 1);
  const yestIso = yest.toISOString().slice(0, 10);

  if (iso === todayIso) return "Today";
  if (iso === yestIso) return "Yesterday";

  // Parse as local midnight to avoid TZ drift on the label.
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  try {
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export default function TransactionsScreen() {
  const transactions = useFinanceStore((s) => s.transactions);
  const accounts = useFinanceStore((s) => s.accounts);
  const categories = useFinanceStore((s) => s.categories);

  const sections = useMemo(() => groupByDay(transactions), [transactions]);

  const iconFor = (category: string): string =>
    categories.find((c) => c.name === category)?.icon ?? "💳";
  const accountNameFor = (accountId: string): string | undefined =>
    accounts.find((a) => a.id === accountId)?.name;

  return (
    <ScreenContainer
      title="Transactions"
      subtitle={`${transactions.length} total`}
      scroll={false}
    >
      <SectionList<Transaction, DaySection>
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{
          paddingHorizontal: spacing.screen,
          paddingBottom: spacing.xl,
        }}
        showsVerticalScrollIndicator={false}
        renderSectionHeader={({ section }) => (
          <DayHeader title={section.title} count={section.data.length} />
        )}
        renderItem={({ item, index, section }) => (
          <View
            style={[
              cardSurface,
              {
                paddingVertical: spacing.xs,
                paddingHorizontal: spacing.lg,
                // Collapse vertical gaps so a day's rows read as one card.
                borderTopLeftRadius: index === 0 ? 16 : 0,
                borderTopRightRadius: index === 0 ? 16 : 0,
                borderBottomLeftRadius:
                  index === section.data.length - 1 ? 16 : 0,
                borderBottomRightRadius:
                  index === section.data.length - 1 ? 16 : 0,
                borderTopWidth: index === 0 ? 1 : 0,
                marginBottom:
                  index === section.data.length - 1 ? spacing.md : 0,
              },
            ]}
          >
            <TransactionRow
              txn={item}
              categoryIcon={iconFor(item.category)}
              accountName={accountNameFor(item.accountId)}
              divider={index < section.data.length - 1}
            />
          </View>
        )}
        ListEmptyComponent={
          <EmptyState
            emoji="🧾"
            title="No transactions yet"
            hint="Add one manually or ask the assistant to log a purchase."
          />
        }
      />
    </ScreenContainer>
  );
}

function DayHeader({ title, count }: { title: string; count: number }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginTop: spacing.lg,
        marginBottom: spacing.sm,
      }}
    >
      <Text
        style={{ fontSize: 14, fontWeight: "700", color: colors.textSecondary }}
      >
        {title}
      </Text>
      <Text style={{ fontSize: 12, color: colors.textFaint }}>
        {count} {count === 1 ? "item" : "items"}
      </Text>
    </View>
  );
}
