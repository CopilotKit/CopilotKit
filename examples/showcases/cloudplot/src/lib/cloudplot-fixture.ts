import type { CloudPlotAgentState, ResourceType } from "@/types";

export type CloudplotOperation = "add" | "connect" | "update" | "remove" | "VPC-move";

export type CloudplotValidationCode =
  | "s3-public-access"
  | "rds-encryption-disabled"
  | "rds-orphaned"
  | "compute-orphaned"
  | "lambda-memory-too-high"
  | "invalid-vpc-parent";

export interface CloudplotValidationFinding {
  code: CloudplotValidationCode;
  level: "error" | "warning";
  nodeId: string;
  message: string;
}

export interface CloudplotBranchSnapshot {
  branchId: string;
  threadId: string;
  nodes: CloudplotNodeData[];
  edges: CloudplotEdgeData[];
}

export interface CloudplotNodeData {
  id: string;
  type: ResourceType;
  config?: Record<string, unknown>;
  parentId?: string;
}

export type CloudplotEdgeData = CloudPlotAgentState["edges"][number];

export const CLOUDPLOT_QUICK_START_PROMPTS = [
  "Build a 3-tier web application with VPC, ALB, EC2 instances, and RDS database",
  "Create a serverless backend with Lambda functions and S3 for storage",
  "Set up an S3 bucket configured for static website hosting",
  "Design a VPC with multiple EC2 instances and an RDS database for high availability",
] as const;

export const CLOUDPLOT_RESOURCE_TYPES = ["vpc", "alb", "ec2", "lambda", "rds", "s3"] as const;

export const CLOUDPLOT_OPERATION_MATRIX: Record<ResourceType, Record<CloudplotOperation, boolean>> = {
  vpc: { add: true, connect: true, update: true, remove: true, "VPC-move": false },
  alb: { add: true, connect: true, update: true, remove: true, "VPC-move": true },
  ec2: { add: true, connect: true, update: true, remove: true, "VPC-move": true },
  lambda: { add: true, connect: true, update: true, remove: true, "VPC-move": true },
  rds: { add: true, connect: true, update: true, remove: true, "VPC-move": true },
  s3: { add: true, connect: true, update: true, remove: true, "VPC-move": false },
};

export const CLOUDPLOT_VALID_CONNECTIONS: Array<readonly [ResourceType, ResourceType]> = [
  ["alb", "ec2"],
  ["ec2", "rds"],
  ["lambda", "s3"],
];

const RESOURCE_PRICING = {
  s3: 2.3,
  ec2: {
    "t3.micro": 7.59,
    "t3.small": 15.18,
    "t3.medium": 30.37,
    "t3.large": 60.74,
    default: 30.37,
  },
  rds: {
    "db.t3.micro": 12.41,
    "db.t3.small": 24.82,
    "db.t3.medium": 49.64,
    default: 24.82,
  },
  lambda: 0.2,
  vpc: 0,
  alb: 16.43,
} as const;

export function calculateResourceCost(node: CloudplotNodeData): number {
  if (node.type === "ec2") {
    const instanceType = String(node.config?.instance_type ?? "default");
    return RESOURCE_PRICING.ec2[instanceType as keyof typeof RESOURCE_PRICING.ec2] ?? RESOURCE_PRICING.ec2.default;
  }

  if (node.type === "rds") {
    const instanceClass = String(node.config?.instance_class ?? "default");
    return RESOURCE_PRICING.rds[instanceClass as keyof typeof RESOURCE_PRICING.rds] ?? RESOURCE_PRICING.rds.default;
  }

  return RESOURCE_PRICING[node.type];
}

export function calculateArchitectureCost(nodes: CloudplotNodeData[]): number {
  const total = nodes.reduce((sum, node) => sum + calculateResourceCost(node), 0);
  return Number(total.toFixed(2));
}

export function validateArchitecture(nodes: CloudplotNodeData[]): CloudplotValidationFinding[] {
  const findings: CloudplotValidationFinding[] = [];
  const parentFindings: CloudplotValidationFinding[] = [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const connectedTargets = new Set<string>();

  for (const node of nodes) {
    if (node.type === "s3" && node.config?.access_level === "public") {
      findings.push({
        code: "s3-public-access",
        level: "warning",
        nodeId: node.id,
        message: "S3 bucket has public access enabled.",
      });
    }

    if (node.type === "rds" && node.config?.encryption === false) {
      findings.push({
        code: "rds-encryption-disabled",
        level: "warning",
        nodeId: node.id,
        message: "RDS database encryption is disabled.",
      });
    }

    if ((node.type === "ec2" || node.type === "lambda" || node.type === "rds" || node.type === "alb") && node.parentId) {
      if (!nodeIds.has(node.parentId)) {
        parentFindings.push({
          code: "invalid-vpc-parent",
          level: "error",
          nodeId: node.id,
          message: "Resource references a missing VPC parent.",
        });
      }
      connectedTargets.add(node.id);
    }
  }

  for (const node of nodes) {
    if (node.type === "rds" && !node.parentId && !connectedTargets.has(node.id)) {
      findings.push({
        code: "rds-orphaned",
        level: "warning",
        nodeId: node.id,
        message: "RDS database is not connected to compute or placed in a VPC.",
      });
    }

    if ((node.type === "ec2" || node.type === "lambda") && !node.parentId) {
      findings.push({
        code: "compute-orphaned",
        level: "warning",
        nodeId: node.id,
        message: "Compute resource is not placed in a VPC.",
      });
    }

    if (node.type === "lambda" && Number(node.config?.memory ?? 0) > 3008) {
      findings.push({
        code: "lambda-memory-too-high",
        level: "warning",
        nodeId: node.id,
        message: "Lambda memory is above the retained 3008 MB warning threshold.",
      });
    }
  }

  findings.push(...parentFindings);

  return findings;
}

export function removeResource(
  nodes: CloudplotNodeData[],
  edges: CloudplotEdgeData[],
  resourceId: string,
): { nodes: CloudplotNodeData[]; edges: CloudplotEdgeData[] } {
  return {
    nodes: nodes.filter((node) => node.id !== resourceId),
    edges: edges.filter((edge) => edge.source !== resourceId && edge.target !== resourceId),
  };
}

export function createBranchSnapshot(
  branchId: string,
  threadId: string,
  nodes: CloudplotNodeData[],
  edges: CloudplotEdgeData[] = [],
): CloudplotBranchSnapshot {
  return {
    branchId,
    threadId,
    nodes,
    edges,
  };
}
