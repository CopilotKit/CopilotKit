"use client";

import { ArrowRight, Check, Loader2 } from "lucide-react";

type ToolCallStatus = "inProgress" | "executing" | "complete";

interface ConnectionCardProps {
  source: string;
  target: string;
  status: ToolCallStatus;
}

export function ConnectionCard({ source, target, status }: ConnectionCardProps) {
  return (
    <div className="flex items-center gap-3 p-3 bg-white rounded-lg border border-gray-200 shadow-sm">
      <div className="flex-1 flex items-center gap-2 min-w-0">
        <span className="text-sm text-cyan-700 font-medium truncate">{source}</span>
        <ArrowRight className="w-4 h-4 text-gray-400 shrink-0" />
        <span className="text-sm text-emerald-700 font-medium truncate">{target}</span>
      </div>

      {/* Status indicator */}
      <div className="shrink-0">
        {status === "complete" ? (
          <div className="p-1 rounded-full bg-emerald-100">
            <Check className="w-4 h-4 text-emerald-600" />
          </div>
        ) : (
          <Loader2 className={`w-4 h-4 animate-spin ${status === "executing" ? "text-amber-500" : "text-cyan-500"}`} />
        )}
      </div>
    </div>
  );
}
