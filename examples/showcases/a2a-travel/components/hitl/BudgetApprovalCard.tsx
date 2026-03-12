/**
 * BudgetApprovalCard Component
 *
 * HITL component for budget approval. Displays budget breakdown and
 * pauses workflow until user approves or rejects.
 */

import React from "react";
import { BudgetData } from "../types";

interface BudgetApprovalCardProps {
  budgetData: BudgetData;
  isApproved: boolean;
  isRejected: boolean;
  onApprove: () => void;
  onReject: () => void;
}

export const BudgetApprovalCard: React.FC<BudgetApprovalCardProps> = ({
  budgetData,
  isApproved,
  isRejected,
  onApprove,
  onReject,
}) => {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: budgetData.currency || "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <div className="bg-[#E4D4F4]/30 backdrop-blur-md border-2 border-[#BEC2FF] rounded-lg p-4 my-3 shadow-elevation-md">
      <div className="flex items-center gap-2 mb-3">
        <div className="text-2xl">💰</div>
        <div>
          <h3 className="text-base font-semibold text-[#010507]">Budget Approval Required</h3>
          <p className="text-xs text-[#57575B]">Please review and approve the estimated budget</p>
        </div>
      </div>

      <div className="bg-white/80 backdrop-blur-sm rounded-lg p-3 mb-3 border border-[#DBDBE5] shadow-elevation-sm">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[#57575B] font-medium text-sm">Total Budget</span>
          <span className="text-2xl font-bold text-[#010507]">
            {formatCurrency(budgetData.totalBudget)}
          </span>
        </div>

        <div className="space-y-1.5">
          {budgetData.breakdown?.map((category, idx) => (
            <div key={idx} className="flex items-center justify-between text-xs">
              <span className="text-[#57575B]">{category.category}</span>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-[#010507]">
                  {formatCurrency(category.amount)}
                </span>
                <span className="text-[#838389]">({category.percentage.toFixed(0)}%)</span>
              </div>
            </div>
          ))}
        </div>

        {budgetData.notes && (
          <div className="mt-2 pt-2 border-t border-[#E9E9EF]">
            <p className="text-xs text-[#57575B]">{budgetData.notes}</p>
          </div>
        )}
      </div>

      {isRejected && (
        <div className="bg-[#FFAC4D]/20 border border-[#FFAC4D] rounded-lg p-2.5 mb-3">
          <div className="flex items-center gap-2 text-[#010507]">
            <span className="text-base">❌</span>
            <div>
              <p className="font-semibold text-xs">Budget Rejected</p>
              <p className="text-xs text-[#57575B]">
                The agent has been notified and may revise the budget.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={onApprove}
          disabled={isApproved || isRejected}
          className={`flex-1 text-xs font-semibold py-2.5 px-3 rounded-lg transition-all shadow-elevation-sm ${
            isApproved
              ? "bg-[#1B936F] text-white cursor-not-allowed"
              : isRejected
              ? "bg-[#838389] text-white cursor-not-allowed"
              : "bg-[#1B936F] hover:bg-[#189370] text-white"
          }`}
        >
          {isApproved ? "✓ Approved" : "Approve Budget"}
        </button>
        <button
          onClick={onReject}
          disabled={isApproved || isRejected}
          className={`flex-1 text-xs font-semibold py-2.5 px-3 rounded-lg transition-all shadow-elevation-sm ${
            isRejected
              ? "bg-[#FFAC4D] text-white cursor-not-allowed"
              : "bg-[#FFAC4D] hover:bg-[#FF9E3D] text-white disabled:opacity-50 disabled:cursor-not-allowed"
          }`}
        >
          {isRejected ? "✗ Rejected" : "Reject"}
        </button>
      </div>
    </div>
  );
};
