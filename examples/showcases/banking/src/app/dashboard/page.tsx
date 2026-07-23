"use client";
import useCreditCards from "@/app/actions";
import { useMemo, useState } from "react";
import type { Transaction } from "@/app/api/v1/data";
import { ArrowDownRight, ArrowUpRight, Plus, ArrowRight } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TransactionsList } from "@/components/transactions-list";
import { GradientCreditCard } from "@/components/card-visual";
import { StatisticsChart } from "@/components/statistics-chart";
import { AnalyticsView } from "@/components/wow/analytics-view";
import { ReportsView } from "@/components/wow/reports-view";
import { useAuthContext } from "@/components/auth-context";
import { useRecording } from "@/components/recording-context";
import { formatCurrency } from "@/lib/utils";
import Link from "next/link";

export default function HomePage() {
  const {
    cards,
    policies,
    transactions,
    changeTransactionStatus,
    openPolicyException,
    finalizePolicyException,
  } = useCreditCards();
  const { currentUser } = useAuthContext();
  const { logStep } = useRecording();
  // Top-level dashboard tab; the "View All" link jumps straight to Transactions.
  const [tab, setTab] = useState("overview");

  // Switch the top-level tab and narrate it into the recorder HUD (only while a
  // workflow is being recorded). Used by both the tab strip and the "View All"
  // shortcut so either path records the same "Opened Transactions" step.
  const selectTab = (value: string) => {
    setTab(value);
    if (value === "transactions") logStep("Opened Transactions");
  };

  // Charges awaiting approval. Over-limit ones surface the "File policy
  // exception" affordance inside TransactionsList; the approve only takes
  // effect once a justifying exception is finalized (the gate in store.ts).
  const pendingTransactions = transactions.filter(
    (t) => t.status === "pending",
  );

  // Run the REST mutation and report whether it actually took effect, so
  // TransactionsList only records the human action when the server accepted it
  // (a blocked over-limit approval must not be recorded as an approval).
  const handleChangeTransactionStatus = async ({
    id,
    status,
  }: {
    id: string;
    status: Transaction["status"];
  }): Promise<boolean> => {
    const { ok } = await changeTransactionStatus({ id, status });
    return ok;
  };

  const { balance, income, expenses, limit, lastPayment, stats, statLabels } =
    useMemo(() => {
      const { balance, limit } = policies.reduce(
        (acc, policy) => ({
          balance: acc.balance + policy.spent,
          limit: {
            used: acc.limit.used + policy.spent,
            total: acc.limit.total + policy.limit,
          },
        }),
        { balance: 0, limit: { used: 0, total: 0 } },
      );

      const income = transactions
        .filter((t) => t.amount > 0)
        .reduce((sum, t) => sum + t.amount, 0);
      const expenses = transactions
        .filter((t) => t.amount < 0)
        .reduce((sum, t) => sum + Math.abs(t.amount), 0);

      // Most recent transaction by date = "last payment".
      const lastPayment = [...transactions].sort(
        (a, b) => +new Date(b.date) - +new Date(a.date),
      )[0];

      // Statistics: bucket expense magnitude by calendar month (oldest→newest).
      // Falls back to representative seeded points when there isn't enough data.
      const byMonth = new Map<string, number>();
      for (const t of transactions) {
        if (t.amount >= 0) continue;
        const d = new Date(t.date);
        if (Number.isNaN(d.getTime())) continue;
        const key = `${d.getFullYear()}-${d.getMonth()}`;
        byMonth.set(key, (byMonth.get(key) ?? 0) + Math.abs(t.amount));
      }
      const monthFmt = new Intl.DateTimeFormat("en-US", { month: "short" });
      const sortedMonths = [...byMonth.entries()].sort(([a], [b]) => {
        const [ay, am] = a.split("-").map(Number);
        const [by, bm] = b.split("-").map(Number);
        return ay - by || am - bm;
      });

      let stats: number[];
      let statLabels: string[];
      if (sortedMonths.length >= 3) {
        stats = sortedMonths.map(([, v]) => v);
        statLabels = sortedMonths.map(([k]) => {
          const [y, m] = k.split("-").map(Number);
          return monthFmt.format(new Date(y, m, 1));
        });
      } else {
        stats = [3200, 4100, 3600, 5200, 4800, 6400];
        statLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
      }

      return {
        balance,
        income,
        expenses,
        limit: {
          total: limit.total,
          usagePercentage: limit.total ? (limit.used / limit.total) * 100 : 0,
        },
        lastPayment,
        stats,
        statLabels,
      };
    }, [policies, transactions]);

  const holderName = currentUser?.name?.toUpperCase() ?? "CARD HOLDER";
  const primaryCard = cards[0];
  const secondaryCard = cards[1];

  return (
    <div className="space-y-6 px-2 pb-4 md:px-4">
      <Tabs value={tab} onValueChange={selectTab} className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold tracking-tight text-ink">
            Dashboard
          </h2>
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="transactions">Transactions</TabsTrigger>
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
            <TabsTrigger value="reports">Reports</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value="overview"
          className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]"
        >
          {/* ── LEFT column ──────────────────────────────────────────── */}
          <div className="space-y-6">
            {/* My Cards */}
            <section>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="section-heading text-base">My Cards</h3>
                <Link
                  href="/"
                  className="text-sm font-medium text-brand-indigo hover:underline dark:text-brand-violet"
                >
                  View all
                </Link>
              </div>
              <div className="flex gap-5 overflow-x-auto pb-2">
                {primaryCard && (
                  <div className="relative w-[300px] flex-shrink-0">
                    {/* A second card peeking behind */}
                    {secondaryCard && (
                      <div className="absolute -right-3 top-3 w-full scale-[0.96] opacity-60 blur-[1px]">
                        <GradientCreditCard
                          card={secondaryCard}
                          holder={holderName}
                          subtle
                        />
                      </div>
                    )}
                    <div className="relative">
                      <GradientCreditCard
                        card={primaryCard}
                        holder={holderName}
                      />
                    </div>
                  </div>
                )}

                {/* Add-card tile (rendered last) */}
                <Link
                  href="/"
                  aria-label="Add a new card"
                  className="flex aspect-[1.586/1] w-[300px] flex-shrink-0 flex-col items-center justify-center gap-2 rounded-[22px] border-2 border-dashed border-brand/40 text-ink-muted transition-colors hover:border-brand hover:bg-brand-soft/50 hover:text-brand-indigo"
                >
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand-indigo">
                    <Plus className="h-6 w-6" />
                  </span>
                  <span className="text-sm font-medium">Add new card</span>
                </Link>
              </div>
            </section>

            {/* Recent Transactions */}
            <section className="rounded-2xl border border-hairline bg-surface p-5 shadow-soft">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="section-heading text-base">
                  Recent Transactions
                </h3>
                <button
                  type="button"
                  onClick={() => selectTab("transactions")}
                  className="text-sm font-medium text-brand-indigo hover:underline dark:text-brand-violet"
                >
                  View All
                </button>
              </div>

              <Tabs defaultValue="all">
                <TabsList variant="underline" className="mb-2">
                  <TabsTrigger value="all">All</TabsTrigger>
                  <TabsTrigger value="income">Income</TabsTrigger>
                  <TabsTrigger value="expenses">Expenses</TabsTrigger>
                </TabsList>

                <div className="mt-4 mb-1">
                  <span className="inline-flex items-center rounded-full bg-brand-soft px-3 py-1 text-[0.7rem] font-semibold uppercase tracking-wide text-brand-indigo dark:text-brand-violet">
                    Today
                  </span>
                </div>

                <TabsContent value="all">
                  <TransactionsList transactions={transactions} />
                </TabsContent>
                <TabsContent value="income">
                  <TransactionsList
                    transactions={transactions.filter((t) => t.amount > 0)}
                  />
                </TabsContent>
                <TabsContent value="expenses">
                  <TransactionsList
                    transactions={transactions.filter((t) => t.amount < 0)}
                  />
                </TabsContent>
              </Tabs>
            </section>
          </div>

          {/* ── RIGHT rail ──────────────────────────────────────────── */}
          <aside className="flex flex-col gap-5 rounded-[26px] border border-hairline bg-surface p-6 shadow-soft">
            <div>
              <p className="text-sm text-ink-muted">Balance</p>
              <p className="mt-1 text-4xl font-bold tracking-tight text-ink">
                {formatCurrency(balance)}
              </p>
              {primaryCard && (
                <p className="mt-2 font-mono text-xs tracking-widest text-ink-muted">
                  •••• •••• •••• {primaryCard.last4}
                </p>
              )}
            </div>

            {/* Income / Expenses split */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-positive-soft/60 p-3">
                <div className="flex items-center gap-1.5 text-positive">
                  <ArrowUpRight className="h-4 w-4" />
                  <span className="text-xs font-medium">Income</span>
                </div>
                <p className="mt-1 text-lg font-bold text-ink">
                  {formatCurrency(income)}
                </p>
              </div>
              <div className="rounded-2xl bg-negative-soft/60 p-3">
                <div className="flex items-center gap-1.5 text-negative">
                  <ArrowDownRight className="h-4 w-4" />
                  <span className="text-xs font-medium">Expenses</span>
                </div>
                <p className="mt-1 text-lg font-bold text-ink">
                  {formatCurrency(expenses)}
                </p>
              </div>
            </div>

            <div className="h-px w-full bg-hairline" />

            {/* Last payment */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Last Payment Details
              </p>
              {lastPayment ? (
                <div className="mt-2 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-ink">
                      {lastPayment.title}
                    </p>
                    <p className="text-xs text-ink-muted">{lastPayment.date}</p>
                  </div>
                  <p
                    className={
                      lastPayment.amount > 0
                        ? "font-semibold text-positive"
                        : "font-semibold text-negative"
                    }
                  >
                    {lastPayment.amount > 0 ? "+" : ""}
                    {formatCurrency(lastPayment.amount)}
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-sm text-ink-muted">No payments yet</p>
              )}
            </div>

            {/* Statistics */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Statistics
                </p>
                <span className="text-[0.7rem] text-ink-muted">
                  {formatCurrency(limit.total)} limit ·{" "}
                  {limit.usagePercentage.toFixed(0)}% used
                </span>
              </div>
              <StatisticsChart data={stats} labels={statLabels} />
            </div>

            {/* CTA */}
            <Link
              href="/"
              className="brand-gradient mt-1 flex items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-semibold text-white shadow-[0_10px_24px_hsl(252_83%_60%/0.35)] transition-all hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              New Transaction
              <ArrowRight className="h-4 w-4" />
            </Link>
          </aside>
        </TabsContent>

        <TabsContent value="transactions">
          <section className="rounded-2xl border border-hairline bg-surface p-5 shadow-soft">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="section-heading text-base">All Transactions</h3>
            </div>

            <Tabs
              defaultValue="all"
              onValueChange={(value) => {
                if (value === "pending") logStep("Opened Pending approval");
              }}
            >
              <TabsList variant="underline" className="mb-2">
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="pending">Pending approval</TabsTrigger>
                <TabsTrigger value="income">Income</TabsTrigger>
                <TabsTrigger value="expenses">Expenses</TabsTrigger>
              </TabsList>

              <TabsContent value="all">
                <TransactionsList transactions={transactions} />
              </TabsContent>
              <TabsContent value="pending">
                {pendingTransactions.length ? (
                  <TransactionsList
                    transactions={pendingTransactions}
                    policies={policies}
                    openPolicyException={openPolicyException}
                    finalizePolicyException={finalizePolicyException}
                    showApprovalInterface
                    approvalInterfaceProps={{
                      onApprove: (id) =>
                        handleChangeTransactionStatus({
                          id,
                          status: "approved",
                        }),
                      onDeny: (id) =>
                        handleChangeTransactionStatus({ id, status: "denied" }),
                    }}
                  />
                ) : (
                  <p className="px-3 py-8 text-center text-sm text-ink-muted">
                    No transactions are pending approval.
                  </p>
                )}
              </TabsContent>
              <TabsContent value="income">
                <TransactionsList
                  transactions={transactions.filter((t) => t.amount > 0)}
                />
              </TabsContent>
              <TabsContent value="expenses">
                <TransactionsList
                  transactions={transactions.filter((t) => t.amount < 0)}
                />
              </TabsContent>
            </Tabs>
          </section>
        </TabsContent>

        <TabsContent value="analytics">
          <AnalyticsView />
        </TabsContent>
        <TabsContent value="reports">
          <ReportsView />
        </TabsContent>
      </Tabs>
    </div>
  );
}
