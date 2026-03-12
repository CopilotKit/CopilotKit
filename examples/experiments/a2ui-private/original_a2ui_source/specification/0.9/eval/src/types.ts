
import { TestPrompt } from "./prompts";

export interface GeneratedResult {
  modelName: string;
  prompt: TestPrompt;
  runNumber: number;
  rawText?: string;
  components?: any[];
  latency: number;
  error?: any;
}

export interface ValidatedResult extends GeneratedResult {
  validationErrors: string[];
}

export type IssueSeverity =
  | "minor"
  | "significant"
  | "critical"
  | "criticalSchema";

export interface EvaluatedResult extends ValidatedResult {
  evaluationResult?: {
    pass: boolean;
    reason: string;
    issues?: { issue: string; severity: IssueSeverity }[];
    overallSeverity?: IssueSeverity;
    evalPrompt?: string;
  };
}
