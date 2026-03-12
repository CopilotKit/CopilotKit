/**
 * BudgetBreakdown Component
 *
 * Displays a beautiful budget breakdown with visual bars showing
 * the percentage breakdown of travel costs by category.
 */

import React from "react";

// Type definitions matching the backend structure
interface BudgetCategory {
  category: string;
  amount: number;
  percentage: number;
}

export interface BudgetData {
  totalBudget: number;
  currency: string;
  breakdown: BudgetCategory[];
  notes: string;
}

interface BudgetBreakdownProps {
  data: BudgetData;
}

export const BudgetBreakdown: React.FC<BudgetBreakdownProps> = ({ data }) => {
  // Format currency
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: data.currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // Color mapping for categories using CopilotCloud Palette
  const getCategoryColor = (index: number) => {
    const colors = [
      { bg: "#BEC2FF", light: "rgba(190, 194, 255, 0.1)", text: "#010507" }, // Lilac
      { bg: "#85E0CE", light: "rgba(133, 224, 206, 0.1)", text: "#010507" }, // Mint
      { bg: "#FFF388", light: "rgba(255, 243, 136, 0.1)", text: "#010507" }, // Yellow
      { bg: "#FFAC4D", light: "rgba(255, 172, 77, 0.1)", text: "#010507" }, // Orange
      { bg: "#C9C9DA", light: "rgba(201, 201, 218, 0.1)", text: "#010507" }, // Grey
      { bg: "#F3F3FC", light: "rgba(243, 243, 252, 0.1)", text: "#010507" }, // Light Purple
    ];
    return colors[index % colors.length];
  };

  return (
    <div className="bg-white/60 backdrop-blur-md rounded-xl p-4 my-3 border-2 border-[#DBDBE5] shadow-elevation-md animate-fade-in-up">
      {/* Header */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xl">💰</span>
            <h2 className="text-xl font-semibold text-[#010507]">Budget Estimate</h2>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-[#010507]">
              {formatCurrency(data.totalBudget)}
            </div>
            <div className="text-xs text-[#57575B]">{data.currency}</div>
          </div>
        </div>
        {data.notes && (
          <p className="text-xs text-[#57575B] bg-[#F7F7F9] rounded p-2 border border-[#DBDBE5]">
            ℹ️ {data.notes}
          </p>
        )}
      </div>

      {/* Breakdown */}
      <div className="space-y-2">
        {data.breakdown.map((category, index) => {
          const colors = getCategoryColor(index);
          return (
            <div key={index} className="bg-white/80 backdrop-blur-sm rounded-lg p-2 shadow-elevation-sm border border-[#E9E9EF]">
              {/* Category Header */}
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: colors.bg }}
                  ></div>
                  <span className="text-sm font-semibold text-[#010507]">
                    {category.category}
                  </span>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold text-[#010507]">
                    {formatCurrency(category.amount)}
                  </div>
                  <div className="text-xs text-[#838389]">
                    {category.percentage.toFixed(1)}%
                  </div>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-[#E9E9EF] rounded-full h-2 overflow-hidden">
                <div
                  className="h-full transition-all duration-1000 ease-out rounded-full"
                  style={{ width: `${category.percentage}%`, backgroundColor: colors.bg }}
                ></div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
