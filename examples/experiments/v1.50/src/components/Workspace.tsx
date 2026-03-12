import type { AWSNodeData } from "@/types";
import { QuickStartPills } from "./QuickStartPills";
import { VPCContainer } from "./VPCContainer";
import { WorkspaceCard } from "./WorkspaceCard";

interface WorkspaceProps {
  resources: AWSNodeData[];
  edges: Array<{ id: string; source: string; target: string }>;
  cost: number;
  onSelectPill?: (content: string) => void;
}

export function Workspace({
  resources,
  cost,
  onSelectPill,
}: WorkspaceProps) {
  // Separate VPCs from standalone resources
  const vpcs = resources.filter((r) => r.type === "vpc");
  const standalone = resources.filter((r) => !r.parentId && r.type !== "vpc");

  const getVPCChildren = (vpcId: string) =>
    resources.filter((r) => r.parentId === vpcId);

  const isEmpty = resources.length === 0;

  return (
    <div className="flex-1 flex flex-col p-6 overflow-auto">
      {/* Empty State */}
      {isEmpty && (
        <div className="flex-1 flex flex-col items-center justify-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            Hello, I am CloudPlot!
          </h1>
          <p className="text-gray-600 mb-6">
            I design AWS architectures—describe what you need.
          </p>
          {onSelectPill && <QuickStartPills onSelect={onSelectPill} />}
        </div>
      )}

      {/* Resources */}
      {!isEmpty && (
        <div className="space-y-6">
          {/* VPCs with children */}
          {vpcs.map((vpc) => (
            <VPCContainer
              key={vpc.id}
              vpc={vpc}
              vpcChildren={getVPCChildren(vpc.id)}
            />
          ))}

          {/* Standalone resources (outside VPC) */}
          {standalone.length > 0 && (
            <div className="flex flex-wrap gap-3">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide w-full">
                Standalone
              </span>
              {standalone.map((r) => (
                <WorkspaceCard key={r.id} resource={r} />
              ))}
            </div>
          )}

          {/* Cost */}
          <div className="pt-4 border-t border-gray-200">
            <span className="text-sm text-gray-500">
              Estimated cost:{" "}
              <strong className="text-gray-900">${cost.toFixed(0)}/mo</strong>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
