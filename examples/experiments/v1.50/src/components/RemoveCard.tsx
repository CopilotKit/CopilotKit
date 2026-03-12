"use client";

import { Trash2, Loader2, Check } from "lucide-react";

interface RemoveCardProps {
  resourceId: string;
  status: "inProgress" | "executing" | "complete";
}

export function RemoveCard({ resourceId, status }: RemoveCardProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-white border border-gray-200 rounded-lg shadow-sm my-2">
      <div className="p-2 rounded-lg bg-red-100">
        <Trash2 className="w-4 h-4 text-red-600" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-900 truncate">
          Removing resource
        </div>
        <div className="text-xs text-gray-500 truncate">
          {resourceId}
        </div>
      </div>

      <div className="flex-shrink-0">
        {status === "complete" ? (
          <div className="p-1 rounded-full bg-emerald-100">
            <Check className="w-4 h-4 text-emerald-600" />
          </div>
        ) : (
          <Loader2 className="w-4 h-4 text-red-500 animate-spin" />
        )}
      </div>
    </div>
  );
}
