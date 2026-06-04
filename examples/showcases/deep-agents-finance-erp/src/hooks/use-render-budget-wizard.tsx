"use client";

import { useRenderTool, useCopilotKit, useAgent } from "@copilotkit/react-core/v2";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";

const ALL_DEPARTMENTS = [
  "Finance",
  "Engineering",
  "Product",
  "Marketing",
  "Sales",
  "Human Resources",
  "Operations",
  "Infrastructure",
  "R&D",
];

// Default budget suggestions based on historical data
const DEFAULT_BUDGETS: Record<string, number> = {
  Finance: 95000,
  Engineering: 185000,
  Product: 112000,
  Marketing: 120000,
  Sales: 165000,
  "Human Resources": 80000,
  Operations: 160000,
  Infrastructure: 100000,
  "R&D": 85000,
};

type WizardStep = "select" | "targets" | "review";

function BudgetWizardComponent({
  quarter,
  year,
}: {
  quarter: string;
  year: number;
}) {
  const { agent } = useAgent({ agentId: "finance_erp_agent" });
  const { copilotkit } = useCopilotKit();

  const [step, setStep] = useState<WizardStep>("select");
  const [selectedDepts, setSelectedDepts] = useState<string[]>([]);
  const [budgets, setBudgets] = useState<Record<string, number>>({});
  const [submitted, setSubmitted] = useState(false);

  const toggleDept = (dept: string) => {
    setSelectedDepts((prev) =>
      prev.includes(dept) ? prev.filter((d) => d !== dept) : [...prev, dept],
    );
  };

  const goToTargets = () => {
    if (selectedDepts.length === 0) return;
    // Pre-fill with defaults
    const initial: Record<string, number> = {};
    selectedDepts.forEach((d) => {
      initial[d] = DEFAULT_BUDGETS[d] || 100000;
    });
    setBudgets(initial);
    setStep("targets");
  };

  const goToReview = () => {
    setStep("review");
  };

  const totalBudget = Object.values(budgets).reduce((s, v) => s + v, 0);

  const handleApprove = async () => {
    setSubmitted(true);
    try {
      if (agent.isRunning) {
        copilotkit.stopAgent({ agent });
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
      const breakdown = Object.entries(budgets)
        .map(([dept, amount]) => `  - ${dept}: ${formatCurrency(amount)}`)
        .join("\n");

      agent.addMessage({
        id: crypto.randomUUID(),
        role: "user",
        content: `I've approved the ${quarter} ${year} budget plan:\n\n${breakdown}\n\nTotal: ${formatCurrency(totalBudget)}\n\nPlease finalize this budget allocation.`,
      });
      void copilotkit.runAgent({ agent });
    } catch (err) {
      console.error("BudgetWizard: failed to submit:", err);
    }
  };

  if (submitted) {
    return (
      <Card className="w-full border-emerald-500/30 bg-emerald-500/5">
        <CardContent className="pt-4 text-center">
          <span className="text-3xl">✅</span>
          <p className="text-sm font-medium mt-2">Budget Plan Approved</p>
          <p className="text-xs text-muted-foreground mt-1">
            {quarter} {year} — {formatCurrency(totalBudget)} across {selectedDepts.length} departments
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full border-primary/20 bg-primary/5">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            📋 Budget Wizard — {quarter} {year}
          </CardTitle>
          {/* Step indicator */}
          <div className="flex gap-1">
            {(["select", "targets", "review"] as WizardStep[]).map((s, i) => (
              <div
                key={s}
                className={`w-2 h-2 rounded-full transition-colors ${
                  step === s ? "bg-primary" : i < ["select", "targets", "review"].indexOf(step) ? "bg-primary/50" : "bg-muted-foreground/20"
                }`}
              />
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Step 1: Select Departments */}
        {step === "select" && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Select departments to include in the budget plan:
            </p>
            <div className="grid grid-cols-3 gap-2">
              {ALL_DEPARTMENTS.map((dept) => {
                const isSelected = selectedDepts.includes(dept);
                return (
                  <button
                    key={dept}
                    onClick={() => toggleDept(dept)}
                    className={`px-2 py-1.5 text-xs rounded-md border transition-all ${
                      isSelected
                        ? "border-primary bg-primary/10 text-primary font-medium"
                        : "border-border bg-background text-muted-foreground hover:border-primary/50"
                    }`}
                  >
                    {isSelected ? "✓ " : ""}{dept}
                  </button>
                );
              })}
            </div>
            <button
              onClick={goToTargets}
              disabled={selectedDepts.length === 0}
              className="w-full py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Next: Set Targets →
            </button>
          </div>
        )}

        {/* Step 2: Set Budget Targets */}
        {step === "targets" && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Set budget targets for each department:
            </p>
            <div className="space-y-2">
              {selectedDepts.map((dept) => (
                <div key={dept} className="flex items-center gap-3">
                  <span className="text-xs font-medium w-28 truncate">{dept}</span>
                  <input
                    type="number"
                    value={budgets[dept] || ""}
                    onChange={(e) =>
                      setBudgets({ ...budgets, [dept]: Number(e.target.value) || 0 })
                    }
                    className="flex-1 px-2 py-1.5 text-xs rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 text-right"
                    placeholder="Amount"
                  />
                  <span className="text-xs text-muted-foreground w-10 text-right">
                    {DEFAULT_BUDGETS[dept]
                      ? `${(((budgets[dept] || 0) / DEFAULT_BUDGETS[dept] - 1) * 100).toFixed(0)}%`
                      : ""}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex justify-between items-center pt-2 border-t">
              <span className="text-sm font-bold">Total: {formatCurrency(totalBudget)}</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setStep("select")}
                  className="px-3 py-1.5 text-xs rounded-md border border-border hover:bg-muted transition-colors"
                >
                  ← Back
                </button>
                <button
                  onClick={goToReview}
                  className="px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  Review →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Review & Approve */}
        {step === "review" && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Review your budget allocation:
            </p>
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left p-2 font-medium text-muted-foreground">Department</th>
                    <th className="text-right p-2 font-medium text-muted-foreground">Previous</th>
                    <th className="text-right p-2 font-medium text-muted-foreground">Proposed</th>
                    <th className="text-right p-2 font-medium text-muted-foreground">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedDepts.map((dept) => {
                    const prev = DEFAULT_BUDGETS[dept] || 0;
                    const proposed = budgets[dept] || 0;
                    const change = proposed - prev;
                    const changePct = prev ? ((change / prev) * 100).toFixed(1) : "N/A";
                    const changeColor = change >= 0 ? "text-emerald-600" : "text-red-500";
                    return (
                      <tr key={dept} className="border-t border-border/50">
                        <td className="p-2 font-medium">{dept}</td>
                        <td className="text-right p-2 text-muted-foreground">{formatCurrency(prev)}</td>
                        <td className="text-right p-2 font-semibold">{formatCurrency(proposed)}</td>
                        <td className={`text-right p-2 font-bold ${changeColor}`}>
                          {change >= 0 ? "+" : ""}{changePct}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 bg-muted/30">
                    <td className="p-2 font-bold">Total</td>
                    <td className="text-right p-2 text-muted-foreground font-medium">
                      {formatCurrency(selectedDepts.reduce((s, d) => s + (DEFAULT_BUDGETS[d] || 0), 0))}
                    </td>
                    <td className="text-right p-2 font-bold">{formatCurrency(totalBudget)}</td>
                    <td className="text-right p-2"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setStep("targets")}
                className="flex-1 py-2 text-sm rounded-md border border-border hover:bg-muted transition-colors"
              >
                ← Modify
              </button>
              <button
                onClick={handleApprove}
                className="flex-1 py-2 text-sm font-medium rounded-md bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
              >
                ✓ Approve Budget
              </button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function useRenderBudgetWizard() {
  useRenderTool(
    {
      name: "render_budget_wizard",
      render: ({ args }: any) => {
        if (!args) {
          return (
            <div className="p-4 rounded-xl border border-primary/20 bg-primary/5 animate-pulse text-sm text-muted-foreground">
              Preparing budget wizard...
            </div>
          );
        }

        return (
          <BudgetWizardComponent
            quarter={args.quarter || "Q2"}
            year={args.year || 2026}
          />
        );
      },
    } as any,
    [],
  );
}
