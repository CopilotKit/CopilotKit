/**
 * Myelin's domain types. SERVER-SAFE and client-safe: plain types only, shared
 * by the in-memory store (`store.ts`), the REST routes under
 * `/api/myelin/v1/*`, the client ledger context, and — by shape, not by import —
 * the ADK agent in `agent-myelin/`, which reads the same JSON over HTTP.
 */

export const ITEM_KINDS = [
  "microlesson",
  "video",
  "quiz",
  "checklist",
  "observation",
  "certification",
] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

/** One step in a journey (a "program item"). */
export interface JourneyItem {
  id: string;
  title: string;
  kind: ItemKind;
  /** Seat time, in minutes. */
  minutes: number;
  /** Ids of items that must be completed before this one unlocks. */
  dependsOn: string[];
  /** Days to wait after the last prerequisite completes. 0 = unlock at once. */
  delayDays: number;
  required: boolean;
  /** Who last touched it — an admin id, or "agent". */
  updatedBy: string;
  updatedAt: string;
}

export type JourneyStatus = "draft" | "published";

export interface Journey {
  id: string;
  name: string;
  description: string;
  status: JourneyStatus;
  /** Groups the journey is assigned to (its audience). */
  audienceGroupIds: string[];
  items: JourneyItem[];
  /**
   * Audience rules applied at publish time. The only rule the platform knows
   * is `stagger` — learners already inside another active onboarding journey
   * start this one when that one completes. It is how a cross-group conflict is
   * cleared, and it is deliberately NOT advertised anywhere the agent can read
   * it (the teach-a-skill beat depends on the agent having to learn it).
   */
  audienceRules: AudienceRule[];
  /** Enrollment window in days, set on launch. */
  enrollmentWindowDays: number | null;
  publishedAt: string | null;
  updatedBy: string;
  updatedAt: string;
}

export interface AudienceRule {
  id: string;
  rule: string;
  appliedBy: string;
  appliedAt: string;
}

export interface Group {
  id: string;
  name: string;
  department: "Deli" | "Bakery" | "Produce" | "Seafood" | "Front End";
  store: string;
  learnerCount: number;
}

export type LearnerStatus =
  | "not-started"
  | "in-progress"
  | "overdue"
  | "complete";

export interface Learner {
  id: string;
  /** PII. Rendered client-side only; never summarized into agent context. */
  name: string;
  groupIds: string[];
  /** Journey id → progress. */
  progress: Record<
    string,
    { status: LearnerStatus; percent: number; daysOverdue: number }
  >;
}

export interface Admin {
  id: string;
  name: string;
  initials: string;
  title: string;
  /** Avatar colour (CSS colour). */
  color: string;
}

export interface Presence {
  adminId: string;
  page: string;
  journeyId: string | null;
  lastSeen: number;
}

export interface Activity {
  id: string;
  at: string;
  actor: string;
  journeyId: string | null;
  text: string;
}

export interface Notification {
  id: string;
  journeyId: string;
  audience: string;
  message: string;
  sentAt: string;
}

export interface Reminder {
  id: string;
  journeyId: string;
  afterDays: number;
  message: string;
  createdAt: string;
}

/** A learner-overlap problem found by the pre-publish audience check. */
export interface AudienceConflict {
  code: "AUDIENCE_OVERLAP";
  /** The other journey the overlapping learners are already enrolled in. */
  otherJourneyId: string;
  otherJourneyName: string;
  groupIds: string[];
  learnerIds: string[];
  /** Seat time per week if both journeys ran at once. Context, not the rule. */
  weeklyMinutesIfConcurrent: number;
  /** The rule being broken. */
  policy: string;
}

export interface MyelinState {
  journeys: Journey[];
  groups: Group[];
  learners: Learner[];
  admins: Admin[];
  presence: Presence[];
  activity: Activity[];
  notifications: Notification[];
  reminders: Reminder[];
  /** Bumped on every write, so pollers can skip unchanged snapshots. */
  version: number;
}
