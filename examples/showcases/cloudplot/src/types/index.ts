// ==========================================
// Resource Types
// ==========================================

export type ResourceType = "s3" | "ec2" | "rds" | "lambda" | "vpc" | "alb";

export type NodeStatus = "healthy" | "warning" | "error" | "stopped";

// ==========================================
// Resource Configurations
// ==========================================

export interface S3Config {
  bucket_name: string;
  access_level: "public" | "private";
  versioning: boolean;
}

export interface EC2Config {
  instance_type: string;
  ami: string;
  security_group?: string;
}

export interface RDSConfig {
  engine: string;
  instance_class: string;
  multi_az: boolean;
  encryption: boolean;
}

export interface LambdaConfig {
  runtime: string;
  memory: number;
  timeout: number;
}

export interface VPCConfig {
  cidr_block: string;
  subnets: string[];
}

export interface ALBConfig {
  listeners: number[];
  target_groups: string[];
}

export interface ResourceConfigByType {
  s3: S3Config;
  ec2: EC2Config;
  rds: RDSConfig;
  lambda: LambdaConfig;
  vpc: VPCConfig;
  alb: ALBConfig;
}

export type ResourceConfig = ResourceConfigByType[ResourceType];

// ==========================================
// Node Data
// ==========================================

interface AWSNodeDataBase {
  id: string;
  label: string;
  status: NodeStatus;
  position?: { x: number; y: number };
  parentId?: string;
}

export type AWSNodeDataOf<T extends ResourceType> = AWSNodeDataBase & {
  type: T;
  config: ResourceConfigByType[T];
};

export type AWSNodeData = {
  [T in ResourceType]: AWSNodeDataOf<T>;
}[ResourceType];

// ==========================================
// Thought Log
// ==========================================

export type ThoughtLogType = "info" | "warning" | "success" | "error";

export interface ThoughtLogEntry {
  timestamp: number;
  node: string;
  message: string;
  type: ThoughtLogType;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
}

// ==========================================
// Validation
// ==========================================

export type ValidationLevel = "error" | "warning";

export interface ValidationResult {
  level: ValidationLevel;
  message: string;
  node_id: string;
}

// ==========================================
// Agent State (synced with LangGraph)
// ==========================================

export type AgentStatus = "idle" | "designing" | "validating";

export interface CloudPlotAgentState {
  nodes: AWSNodeData[];
  edges: Array<{
    id: string;
    source: string;
    target: string;
  }>;
  logs: ThoughtLogEntry[];
  cost: number;
  status: AgentStatus;
  validation_errors: ValidationResult[];
}

// ==========================================
// Approval Request (for HITL)
// ==========================================

export type RiskLevel = "low" | "medium" | "high";

export interface ApprovalRequest {
  action: string;
  resources: string[];
  cost_impact: string;
  risk_level: RiskLevel;
}

// ==========================================
// Branching (thread-based)
// ==========================================

export interface Branch {
  id: string;
  name: string;
  createdAt: number;
  threadId: string;
}

export interface BranchState {
  state: CloudPlotAgentState;
  messages: AgentMessage[];
}

export interface AgentMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: Array<unknown>;
  [key: string]: unknown;
}
