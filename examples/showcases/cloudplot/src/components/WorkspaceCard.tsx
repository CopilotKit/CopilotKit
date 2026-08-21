import type { AWSNodeData } from "@/types";

interface WorkspaceCardProps {
  resource: AWSNodeData;
}

const ICONS: Record<string, string> = {
  s3: "🪣",
  ec2: "🖥️",
  rds: "🗄️",
  lambda: "⚡",
  vpc: "🌐",
  alb: "⚖️",
};

const STATUS_COLORS: Record<string, string> = {
  healthy: "border-emerald-400 bg-emerald-50",
  warning: "border-amber-400 bg-amber-50",
  error: "border-red-400 bg-red-50",
  stopped: "border-gray-300 bg-gray-50",
};

export function WorkspaceCard({ resource }: WorkspaceCardProps) {
  const name =
    (resource.config as { name?: string })?.name ||
    resource.label ||
    resource.id;
  const statusClass = STATUS_COLORS[resource.status] || STATUS_COLORS.healthy;

  return (
    <div
      className={`px-3 py-2 rounded-lg border-2 ${statusClass} flex items-center gap-2 min-w-[100px]`}
    >
      <span className="text-lg">{ICONS[resource.type] || "📦"}</span>
      <span className="text-sm font-medium text-gray-900 truncate">{name}</span>
    </div>
  );
}
