"use client";

import { Database, Server, HardDrive, Zap, Network, Globe, Check, Loader2 } from "lucide-react";
import type { ResourceType } from "@/types";

type ToolCallStatus = "inProgress" | "executing" | "complete";

interface ResourceCardProps {
  resourceType: string;
  name: string;
  status: ToolCallStatus;
}

const resourceIcons: Record<ResourceType, typeof Database> = {
  s3: HardDrive,
  ec2: Server,
  rds: Database,
  lambda: Zap,
  vpc: Network,
  alb: Globe,
};

const resourceColors: Record<ResourceType, string> = {
  s3: "text-emerald-600",
  ec2: "text-orange-600",
  rds: "text-blue-600",
  lambda: "text-amber-600",
  vpc: "text-cyan-600",
  alb: "text-purple-600",
};

export function ResourceCard({ resourceType, name, status }: ResourceCardProps) {
  const Icon = resourceIcons[resourceType as ResourceType] ?? Server;
  const colorClass = resourceColors[resourceType as ResourceType] ?? "text-gray-600";

  return (
    <div className="flex items-center gap-3 p-3 bg-white rounded-lg border border-gray-200 shadow-sm">
      <div className={`p-2 rounded-lg bg-gray-100 ${colorClass}`}>
        <Icon className="w-5 h-5" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-500 uppercase">
            {resourceType}
          </span>
        </div>
        <p className="text-sm text-gray-900 font-medium truncate">{name || "Unnamed"}</p>
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
