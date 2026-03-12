import type { AWSNodeData } from "@/types";
import { WorkspaceCard } from "./WorkspaceCard";

interface VPCContainerProps {
  vpc: AWSNodeData;
  vpcChildren: AWSNodeData[];
}

const TIER_ORDER = ["alb", "ec2", "lambda", "rds", "s3"];
const TIER_LABELS: Record<string, string> = {
  alb: "Frontend",
  ec2: "Compute",
  lambda: "Compute",
  rds: "Data",
  s3: "Storage",
};

export function VPCContainer({ vpc, vpcChildren }: VPCContainerProps) {
  // Group children by tier
  const tiers = TIER_ORDER.reduce(
    (acc, type) => {
      const resources = vpcChildren.filter((c) => c.type === type);
      if (resources.length > 0) {
        const label = TIER_LABELS[type];
        if (!acc[label]) acc[label] = [];
        acc[label].push(...resources);
      }
      return acc;
    },
    {} as Record<string, AWSNodeData[]>
  );

  const tierEntries = Object.entries(tiers);

  return (
    <div className="border-2 border-dashed border-cyan-300 rounded-xl p-4 bg-cyan-50/30">
      {/* VPC Header */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg">🌐</span>
        <span className="font-semibold text-gray-900">
          {(vpc.config as { name?: string })?.name || vpc.label || vpc.id}
        </span>
        {(vpc.config as { cidr_block?: string })?.cidr_block && (
          <span className="text-xs text-gray-500 font-mono">
            {(vpc.config as { cidr_block?: string }).cidr_block}
          </span>
        )}
      </div>

      {/* Tier Lanes */}
      <div className="flex gap-6 items-start">
        {tierEntries.map(([tierName, resources], idx) => (
          <div key={tierName} className="flex items-center gap-4">
            {/* Tier column */}
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                {tierName}
              </span>
              {resources.map((r) => (
                <WorkspaceCard key={r.id} resource={r} />
              ))}
            </div>

            {/* Arrow to next tier */}
            {idx < tierEntries.length - 1 && (
              <span className="text-gray-400 text-xl">→</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
