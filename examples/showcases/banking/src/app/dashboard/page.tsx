'use client'
import useCreditCards from "@/app/actions";
import { useMemo } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CreditCard, DollarSign } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { TransactionsList } from "@/components/transactions-list";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  const { cards, policies, transactions } = useCreditCards()

  const { balance, limit } = useMemo(() => {
    const { balance, limit } = policies.reduce((stats, policy) => {
      return {
        balance: stats.balance + policy.spent,
        limit: {
          used: stats.limit.used + policy.spent,
          total: stats.limit.total + policy.limit
        },
      }
    }, { balance: 0, limit: { used: 0, total: 0 } })
    const limitUsagePercentage = ((limit.used / limit.total) * 100)

    return {
      balance,
      limit: {
        total: limit.total,
        usagePercentage: limitUsagePercentage,
      }
    }
  }, [policies])

  return (
      <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
        <div className="flex items-center justify-between space-y-2">
          <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
        </div>
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
            <TabsTrigger value="reports">Reports</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Balance</CardTitle>
                  <DollarSign className="h-4 w-4 text-neutral-500 dark:text-neutral-400" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">${balance}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Credit Limit</CardTitle>
                  <CreditCard className="h-4 w-4 text-neutral-500 dark:text-neutral-400" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">${limit.total}</div>
                  <Progress value={limit.usagePercentage} className="mt-2" />
                  <p className="text-xs text-neutral-500 mt-2 dark:text-neutral-400">{limit.usagePercentage.toFixed(2)}% used</p>
                </CardContent>
              </Card>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
              <Card className="col-span-4">
                <CardHeader>
                  <CardTitle>Recent Transactions</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-8">
                    <TransactionsList transactions={transactions} />
                  </div>
                </CardContent>
              </Card>
              <Card className="col-span-3">
                <CardHeader>
                  <CardTitle>Credit Cards</CardTitle>
                  <CardDescription>You have 2 active credit cards.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-8">
                    {cards.map((card, index) => (
                        <div key={index} className="flex items-center">
                          <div className={`${card.color} rounded-lg p-2 mr-4`}>
                            <CreditCard className="h-6 w-6 text-white" />
                          </div>
                          <div className="flex-1 space-y-1">
                            <p className="text-sm font-medium leading-none">{card.type} ending in {card.last4}</p>
                            <p className="text-sm text-neutral-500 dark:text-neutral-400">Expires {card.expiry}</p>
                          </div>
                          <Button variant="outline" asChild>
                            <a href="/">Manage</a>
                          </Button>
                        </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
  )
}
