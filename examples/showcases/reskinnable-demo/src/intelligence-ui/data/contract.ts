/**
 * Shapes of the Automatic Learning demo API (`/api/learning/v1`), as fixed by
 * the shared contract the Ledgerline skin serves. Field names match the JSON.
 */

export type TrajectoryOutcome =
  | "agent_failed_user_completed"
  | "agent_succeeded"
  | "in_progress";
export type Surface = "in_app" | "chatgpt" | "manual";

export interface TrajectorySummary {
  readonly trajectoryId: string;
  readonly projectId: string;
  readonly title: string;
  readonly user: { readonly id: string; readonly name: string };
  readonly createdAt: number;
  readonly firstEventAt: number;
  readonly lastEventAt: number;
  readonly outcome: TrajectoryOutcome;
  readonly surfaces: readonly Surface[];
  readonly threadIds: readonly string[];
  readonly eventCount: number;
}

export interface ThreadMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly at: number;
}

export interface TraceStep {
  readonly id: string;
  readonly kind: "tool.call" | "thinking";
  readonly name?: string;
  readonly args?: Record<string, unknown>;
  readonly result?: unknown;
  readonly status?: "ok" | "error";
  readonly durationMs?: number;
  readonly text?: string;
  readonly at: number;
  /** The refusal code a failed call came back with, e.g. UNRESOLVED. */
  readonly code?: string;
  /**
   * The generative UI this call drew: the app's own component and the props it
   * was drawn from. The trajectory view renders the real component.
   */
  readonly ui?: GenUiRecord;
}

export interface GenUiRecord {
  readonly component: string;
  readonly props: Record<string, unknown>;
}

export interface TrajectoryThread {
  readonly threadId: string;
  readonly surface: "in_app" | "chatgpt";
  readonly linkStrength: "strong" | "weak";
  readonly messages: readonly ThreadMessage[];
  readonly agentTrace: readonly TraceStep[];
  readonly outcome: string;
}

export interface TrajectoryEvent {
  readonly eventId: string;
  readonly trajectoryId: string;
  readonly position: number;
  readonly persistedAt: number;
  readonly event: {
    readonly type: "CUSTOM";
    readonly name: string;
    readonly timestamp: number;
    readonly value: Record<string, unknown>;
  };
}

export interface MissingContext {
  readonly eventId: string;
  readonly label: string;
  readonly why: string;
}

export interface TrajectoryDetail {
  readonly trajectory: TrajectorySummary;
  readonly threads: readonly TrajectoryThread[];
  readonly events: readonly TrajectoryEvent[];
  readonly missingContext: readonly MissingContext[];
}

export interface EvalSuite {
  readonly suite: string;
  readonly lastRunAt: number;
  readonly passRate: number;
  readonly cases: readonly {
    readonly id: string;
    readonly query: string;
    readonly expected: string;
    readonly runs: readonly boolean[];
    readonly passRate: number;
    readonly lastResult: "pass" | "fail";
    readonly lastNote?: string;
  }[];
}

export interface EvalCandidate {
  readonly id: string;
  readonly query: string;
  readonly checks: readonly string[];
  readonly sourceTrajectoryIds: readonly string[];
  readonly sourceEventIds: readonly string[];
  readonly status: "pending" | "accepted" | "rejected";
}

export interface DemoInsight {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly evidence: readonly {
    readonly trajectoryId: string;
    readonly eventIds: readonly string[];
    readonly quote: string;
  }[];
  readonly threadCount: number;
  readonly createdAt: number;
}

export interface DemoSkill {
  readonly name: string;
  readonly status: "candidate" | "published" | "disabled";
  readonly description: string;
  readonly skillMd: string;
  readonly supportingInsightIds: readonly string[];
  readonly revision: number;
}

export interface LearnResult {
  readonly insights: readonly DemoInsight[];
  readonly skills: readonly DemoSkill[];
  readonly evalCandidates: readonly EvalCandidate[];
}

export type FineTuneTarget = "thinking-machines" | "sagemaker";

export interface FineTunePreview {
  readonly target: FineTuneTarget;
  readonly format: "jsonl";
  readonly examples: number;
  readonly sample: readonly {
    readonly system?: string;
    readonly messages: readonly Record<string, unknown>[];
  }[];
  /** The last dataset export (seeded history). */
  readonly lastExport?: {
    readonly at: number;
    readonly target: FineTuneTarget;
    readonly examples: number;
    readonly file: string;
  };
}
