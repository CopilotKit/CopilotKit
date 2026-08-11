/**
 * Generative-UI result cards for the read tools and the receipt parser.
 *
 * Each component is mounted via a tool's `render` function so the user sees
 * a rich card in the chat (instead of the agent flatly describing the data).
 * Cards are presentational and read nothing from the store — the parent tool
 * resolves the data once and passes it as props.
 */

import { Image, Text, View } from "react-native";
import { TransactionRow } from "../components/TransactionRow";
import { BudgetRow } from "../components/BudgetBar";
import { colors, radius, spacing } from "../components/theme";
import { formatCurrency } from "../lib/currency";
import type { Account, Budget, CurrencyCode, Transaction } from "../types";
import type { ReceiptDraft } from "./contracts";

/* ──────────────────────────────────────────────────────────────────────────
 * Shared card surface
 * ────────────────────────────────────────────────────────────────────────── */

interface CardProps {
  title?: string;
  children: React.ReactNode;
}

function ChatCard({ title, children }: CardProps) {
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
            fontSize: 12,
            fontWeight: "700",
            color: colors.textMuted,
            marginBottom: spacing.md,
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          {title}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Accounts — balance pills, one per account, in its own currency
 * ────────────────────────────────────────────────────────────────────────── */

export interface AccountsResultCardProps {
  accounts: Pick<
    Account,
    "id" | "name" | "type" | "currency" | "balance" | "icon"
  >[];
}

export function AccountsResultCard({ accounts }: AccountsResultCardProps) {
  if (!accounts || accounts.length === 0) {
    return (
      <ChatCard title="Accounts">
        <Text style={{ color: colors.textMuted }}>No accounts yet.</Text>
      </ChatCard>
    );
  }
  return (
    <ChatCard title={`Accounts · ${accounts.length}`}>
      {accounts.map((acc, i) => {
        const isNegative = acc.balance < 0;
        return (
          <View
            key={acc.id}
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingVertical: spacing.md,
              borderBottomWidth: i < accounts.length - 1 ? 1 : 0,
              borderBottomColor: colors.hairline,
            }}
          >
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: radius.pill,
                backgroundColor: colors.bg,
                alignItems: "center",
                justifyContent: "center",
                marginRight: spacing.md,
              }}
            >
              <Text style={{ fontSize: 18 }}>{acc.icon || "🏦"}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontSize: 15,
                  fontWeight: "600",
                  color: colors.textPrimary,
                }}
              >
                {acc.name}
              </Text>
              <Text
                style={{
                  fontSize: 12,
                  color: colors.textMuted,
                  marginTop: 2,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}
              >
                {acc.type} · {acc.currency}
              </Text>
            </View>
            <Text
              style={{
                fontSize: 15,
                fontWeight: "700",
                color: isNegative ? colors.negative : colors.textPrimary,
              }}
            >
              {formatCurrency(acc.balance, acc.currency)}
            </Text>
          </View>
        );
      })}
    </ChatCard>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Transactions — list of TransactionRow (reuses the screens' component)
 * ────────────────────────────────────────────────────────────────────────── */

export interface TransactionsResultCardProps {
  transactions: Transaction[];
  /** Map of categoryName → emoji icon (from the store's categories). */
  iconByCategory?: Record<string, string>;
  /** Map of accountId → display name (from the store's accounts). */
  nameByAccountId?: Record<string, string>;
}

export function TransactionsResultCard({
  transactions,
  iconByCategory = {},
  nameByAccountId = {},
}: TransactionsResultCardProps) {
  if (!transactions || transactions.length === 0) {
    return (
      <ChatCard title="Recent transactions">
        <Text style={{ color: colors.textMuted }}>
          Nothing tracked yet — add a transaction in chat to get started.
        </Text>
      </ChatCard>
    );
  }
  return (
    <ChatCard title={`Recent · ${transactions.length}`}>
      {transactions.map((txn, i) => (
        <TransactionRow
          key={txn.id}
          txn={txn}
          categoryIcon={iconByCategory[txn.category]}
          accountName={nameByAccountId[txn.accountId]}
          divider={i < transactions.length - 1}
        />
      ))}
    </ChatCard>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Top expenses — a ranked table (#, expense, amount), biggest first
 * ────────────────────────────────────────────────────────────────────────── */

export interface TopExpensesResultCardProps {
  /** Expenses pre-sorted largest first by the `topExpenses` selector. */
  expenses: Transaction[];
  /** Map of categoryName → emoji icon (from the store's categories). */
  iconByCategory?: Record<string, string>;
}

const headerCellStyle = {
  fontSize: 11,
  fontWeight: "700" as const,
  color: colors.textMuted,
  textTransform: "uppercase" as const,
  letterSpacing: 0.5,
};

export function TopExpensesResultCard({
  expenses,
  iconByCategory = {},
}: TopExpensesResultCardProps) {
  if (!expenses || expenses.length === 0) {
    return (
      <ChatCard title="Top expenses">
        <Text style={{ color: colors.textMuted }}>
          No expenses tracked yet — add one in chat to get started.
        </Text>
      </ChatCard>
    );
  }
  return (
    <ChatCard title="Top expenses">
      {/* Header row */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingBottom: spacing.sm,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        <Text style={[headerCellStyle, { width: 24 }]}>#</Text>
        <Text style={[headerCellStyle, { flex: 1 }]}>Expense</Text>
        <Text style={[headerCellStyle, { textAlign: "right" }]}>Amount</Text>
      </View>

      {/* Data rows */}
      {expenses.map((txn, i) => (
        <View
          key={txn.id}
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingVertical: spacing.md,
            borderBottomWidth: i < expenses.length - 1 ? 1 : 0,
            borderBottomColor: colors.hairline,
          }}
        >
          <Text
            style={{
              width: 24,
              fontSize: 13,
              fontWeight: "700",
              color: colors.textMuted,
            }}
          >
            {i + 1}
          </Text>
          <View
            style={{
              flex: 1,
              flexShrink: 1,
              flexDirection: "row",
              alignItems: "center",
            }}
          >
            <Text style={{ fontSize: 18, marginRight: spacing.sm }}>
              {iconByCategory[txn.category] ?? "💳"}
            </Text>
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
              <Text
                numberOfLines={1}
                style={{
                  fontSize: 12,
                  color: colors.textMuted,
                  marginTop: 2,
                }}
              >
                {txn.category}
              </Text>
            </View>
          </View>
          <Text
            style={{
              fontSize: 15,
              fontWeight: "700",
              color: colors.textPrimary,
              marginLeft: spacing.sm,
            }}
          >
            -{formatCurrency(Math.abs(txn.amount), txn.currency)}
          </Text>
        </View>
      ))}
    </ChatCard>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Budgets — compact progress bars (reuses BudgetBar)
 * ────────────────────────────────────────────────────────────────────────── */

export interface BudgetsResultCardProps {
  budgets: Budget[];
  /** Computed spent-this-month per budget category, in the budget's currency. */
  spentByCategory: Record<string, number>;
  /** Map of categoryName → emoji icon (from the store's categories). */
  iconByCategory?: Record<string, string>;
}

export function BudgetsResultCard({
  budgets,
  spentByCategory,
  iconByCategory = {},
}: BudgetsResultCardProps) {
  if (!budgets || budgets.length === 0) {
    return (
      <ChatCard title="Budgets">
        <Text style={{ color: colors.textMuted }}>
          No budgets set — say "cap dining at $300/month" to make one.
        </Text>
      </ChatCard>
    );
  }
  return (
    <ChatCard title={`Budgets · ${budgets.length}`}>
      {budgets.map((b, i) => (
        <View
          key={b.id}
          style={{
            marginBottom: i < budgets.length - 1 ? spacing.md : 0,
          }}
        >
          <BudgetRow
            budget={b}
            spent={spentByCategory[b.category] ?? 0}
            categoryIcon={iconByCategory[b.category]}
          />
        </View>
      ))}
    </ChatCard>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * ReceiptPreview — the extracted draft from a receipt photo
 * (read-only; the actual write goes through `addTransaction` afterwards)
 * ────────────────────────────────────────────────────────────────────────── */

export interface ReceiptPreviewCardProps {
  draft: ReceiptDraft;
  /** Optional local image URI of the receipt — shows a thumbnail if present. */
  imageUri?: string;
}

export function ReceiptPreviewCard({
  draft,
  imageUri,
}: ReceiptPreviewCardProps) {
  const rows: { label: string; value: string }[] = [
    { label: "Merchant", value: draft.merchant },
    {
      label: "Amount",
      value: formatCurrency(draft.amount, draft.currency as CurrencyCode),
    },
    { label: "Date", value: draft.date },
    { label: "Category", value: draft.suggestedCategory },
  ];
  return (
    <ChatCard title="📷 Receipt parsed">
      <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
        {imageUri ? (
          <Image
            source={{ uri: imageUri }}
            style={{
              width: 64,
              height: 84,
              borderRadius: radius.sm,
              backgroundColor: colors.bg,
              marginRight: spacing.md,
            }}
            resizeMode="cover"
          />
        ) : null}
        <View style={{ flex: 1 }}>
          {rows.map((row, i) => (
            <View
              key={row.label}
              style={{
                flexDirection: "row",
                paddingVertical: 6,
                borderBottomWidth: i < rows.length - 1 ? 1 : 0,
                borderBottomColor: colors.hairline,
              }}
            >
              <Text
                style={{
                  fontSize: 13,
                  color: colors.textMuted,
                  width: 80,
                }}
              >
                {row.label}
              </Text>
              <Text
                style={{
                  flex: 1,
                  fontSize: 14,
                  fontWeight: "600",
                  color: colors.textPrimary,
                }}
              >
                {row.value}
              </Text>
            </View>
          ))}
        </View>
      </View>
      <Text
        style={{
          marginTop: spacing.md,
          fontSize: 12,
          color: colors.textMuted,
          fontStyle: "italic",
        }}
      >
        I'll propose a transaction next — approve to log it.
      </Text>
    </ChatCard>
  );
}
