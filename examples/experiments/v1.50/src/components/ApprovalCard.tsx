"use client";

import { motion } from "framer-motion";
import { AlertTriangle, Check, X } from "lucide-react";
import type { RiskLevel } from "@/types";

interface ApprovalCardProps {
  action: string;
  resources: string[];
  cost_impact: string;
  risk_level: RiskLevel;
  onApprove: () => void;
  onReject: () => void;
}

const riskConfig: Record<RiskLevel, { colorClass: string; bgClass: string; borderClass: string }> = {
  low: {
    colorClass: "text-emerald-600",
    bgClass: "bg-emerald-100",
    borderClass: "border-emerald-300",
  },
  medium: {
    colorClass: "text-amber-600",
    bgClass: "bg-amber-100",
    borderClass: "border-amber-300",
  },
  high: {
    colorClass: "text-red-600",
    bgClass: "bg-red-100",
    borderClass: "border-red-300",
  },
};

export function ApprovalCard({
  action,
  resources,
  cost_impact,
  risk_level,
  onApprove,
  onReject,
}: ApprovalCardProps) {
  const { colorClass, bgClass, borderClass } = riskConfig[risk_level];

  return (
    <motion.div
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.9, opacity: 0 }}
      className={`bg-white rounded-xl p-6 max-w-md border-2 ${borderClass} shadow-lg`}
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className={`p-2 rounded-lg ${bgClass}`}>
          <AlertTriangle className={`w-5 h-5 ${colorClass}`} />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Approval Required</h3>
          <p className={`text-sm ${colorClass}`}>
            {risk_level.charAt(0).toUpperCase() + risk_level.slice(1)} Risk Action
          </p>
        </div>
      </div>

      {/* Action */}
      <div className="mb-4">
        <p className="text-sm text-gray-500 mb-1">Action</p>
        <p className="text-gray-900">{action}</p>
      </div>

      {/* Resources */}
      <div className="mb-4">
        <p className="text-sm text-gray-500 mb-1">Affected Resources</p>
        <div className="flex flex-wrap gap-1">
          {resources.map((resource, i) => (
            <span
              key={i}
              className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-700"
            >
              {resource}
            </span>
          ))}
        </div>
      </div>

      {/* Cost Impact */}
      <div className="mb-6">
        <p className="text-sm text-gray-500 mb-1">Cost Impact</p>
        <p className="text-lg font-mono text-emerald-600">{cost_impact}</p>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={onReject}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
        >
          <X className="w-4 h-4" />
          Reject
        </button>
        <button
          onClick={onApprove}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
        >
          <Check className="w-4 h-4" />
          Approve
        </button>
      </div>
    </motion.div>
  );
}
