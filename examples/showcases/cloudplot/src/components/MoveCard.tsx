"use client";

import { ArrowRightLeft, Loader2, Check } from "lucide-react";

interface MoveCardProps {
  resourceId: string;
  vpcId: string | null;
  status: "inProgress" | "executing" | "complete";
}

export function MoveCard({ resourceId, vpcId, status }: MoveCardProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-white border border-gray-200 rounded-lg shadow-sm my-2">
      <div className="p-2 rounded-lg bg-amber-100">
        <ArrowRightLeft className="w-4 h-4 text-amber-600" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-900 truncate">
          {vpcId ? `Moving to VPC` : `Removing from VPC`}
        </div>
        <div className="text-xs text-gray-500 truncate">
          {resourceId} {vpcId ? `→ ${vpcId}` : "→ standalone"}
        </div>
      </div>

      <div className="flex-shrink-0">
        {status === "complete" ? (
          <div className="p-1 rounded-full bg-emerald-100">
            <Check className="w-4 h-4 text-emerald-600" />
          </div>
        ) : (
          <Loader2 className="w-4 h-4 text-amber-500 animate-spin" />
        )}
      </div>
    </div>
  );
}
