/**
 * The Automatic Learning data contract (CONTRACT.md, shared with the
 * Intelligence-screens prototype). Shapes here are the wire shapes of
 * `/api/learning/v1/*`; change them only together with CONTRACT.md.
 *
 * Captured events are AG-UI CUSTOM events, shaped like the draft product
 * trajectory contract (CopilotKit draft PR #7556): `page`, `navigation`,
 * `click`, `network`, `screen.context`, `thread.linked`, plus semantic
 * `expense.*` events.
 */

export type Surface = "in_app" | "chatgpt" | "manual";

export interface CustomEvent {
  type: "CUSTOM";
  name: string;
  timestamp: number;
  value: Record<string, unknown>;
}

export interface CapturedEvent {
  eventId: string;
  trajectoryId: string;
  position: number;
  persistedAt: number;
  event: CustomEvent;
}

export type TrajectoryOutcome =
  | "agent_failed_user_completed"
  | "agent_succeeded"
  | "in_progress";

export interface TrajectorySummary {
  trajectoryId: string;
  projectId: string;
  title: string;
  user: { id: string; name: string };
  createdAt: number;
  firstEventAt: number;
  lastEventAt: number;
  outcome: TrajectoryOutcome;
  surfaces: Surface[];
  threadIds: string[];
  eventCount: number;
}

export interface ThreadMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: number;
}

export interface TraceEntry {
  id: string;
  kind: "tool.call" | "thinking";
  name?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  status?: "ok" | "error" | "pending";
  durationMs?: number;
  text?: string;
  at: number;
}

export interface ThreadRecord {
  threadId: string;
  surface: "in_app" | "chatgpt";
  linkStrength: "strong" | "weak";
  messages: ThreadMessage[];
  agentTrace: TraceEntry[];
  outcome: "failed" | "succeeded" | "in_progress";
  /** Optional: why `messages` is empty (ChatGPT keeps the conversation). */
  note?: string;
}

export interface MissingContext {
  eventId: string;
  label: string;
  why: string;
}

export interface TrajectoryDetail {
  trajectory: TrajectorySummary;
  threads: ThreadRecord[];
  events: CapturedEvent[];
  missingContext: MissingContext[];
}

export interface Insight {
  id: string;
  title: string;
  summary: string;
  evidence: { trajectoryId: string; eventIds: string[]; quote: string }[];
  threadCount: number;
  createdAt: number;
  /** Additive: "llm" or "fallback", so the reviewer can see how it was made. */
  derivedBy?: "llm" | "fallback";
}

export interface Skill {
  name: string;
  status: "candidate" | "published" | "disabled";
  description: string;
  skillMd: string;
  supportingInsightIds: string[];
  revision: number;
  /** Additive: when the status last changed. */
  updatedAt?: number;
}

export interface EvalCandidate {
  id: string;
  query: string;
  checks: string[];
  sourceTrajectoryIds: string[];
  sourceEventIds: string[];
  status: "pending" | "accepted" | "rejected";
}

export interface EvalCase {
  id: string;
  query: string;
  expected: string;
  runs: boolean[];
  passRate: number;
  lastResult: "pass" | "fail";
  lastNote: string;
}

export interface EvalSuite {
  suite: string;
  lastRunAt: number;
  passRate: number;
  cases: EvalCase[];
}

export const PROJECT_ID = "ledgerline-demo";
export const SKILL_NAME = "approve-team-event-expense";
export const DEMO_USER = { id: "u_maya", name: "Maya Chen" };
