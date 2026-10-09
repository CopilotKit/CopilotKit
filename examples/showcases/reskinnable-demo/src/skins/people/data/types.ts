/**
 * Rowan's domain model. Server-safe (plain types + string unions, no React) so
 * `store.ts`, the REST routes and the agent-side modules can all import it.
 */

export type Level = "L3" | "L4" | "L5" | "L6" | "L7";

export const LEVELS: readonly Level[] = ["L3", "L4", "L5", "L6", "L7"];

export type Team =
  | "Engineering"
  | "Design"
  | "Go-to-Market"
  | "Finance"
  | "People Ops";

export type EmployeeStatus = "active" | "onboarding" | "on-leave";

/**
 * A compensation band. `min`/`max` are the hard edges the OUT_OF_BAND gate is
 * enforced against (see store.canApproveCompRequest); `mid` is the target and
 * is what the ladder renders its midpoint tick at.
 */
export interface Band {
  level: Level;
  /** The band's canonical title, e.g. "Senior". Not an employee's job title. */
  label: string;
  min: number;
  mid: number;
  max: number;
}

export interface EmployeeNote {
  id: string;
  text: string;
  author: string;
  createdAt: string;
}

export interface Employee {
  id: string;
  name: string;
  title: string;
  level: Level;
  team: Team;
  email: string;
  location: string;
  managerId: string | null;
  /** ISO date, materialized from the seed's relative offset at store init. */
  startDate: string;
  status: EmployeeStatus;
  baseSalary: number;
  /** ISO date or null — drives the "due for review" signal on the roster. */
  lastRaiseDate: string | null;
  /** Beat 5, step 2: the onboarding buddy the stored procedure assigns. */
  buddyId: string | null;
  notes: EmployeeNote[];
}

export type RequestKind =
  | "time-off"
  | "equipment"
  | "role-change"
  | "referral-bonus"
  | "training";

export type RequestStatus = "pending" | "approved" | "declined";

/**
 * The Requests queue — beat 3c's lever surface. `submittedAt` is materialized
 * relative to now at store init, so "oldest pending" stays a sensible number of
 * days no matter how long after authoring the demo is run.
 */
export interface PeopleRequest {
  id: string;
  employeeId: string;
  kind: RequestKind;
  summary: string;
  detail: string;
  submittedAt: string;
  status: RequestStatus;
  /** Present for time-off. */
  days?: number;
  /** Present for equipment / referral-bonus / training. */
  amount?: number;
}

/**
 * BEAT 6 — the gated object. Approving one of these writes the requested salary
 * onto the employee, and the write is refused with 422 OUT_OF_BAND when
 * `requestedSalary` sits outside the band for `proposedLevel` and no APPROVED,
 * JUSTIFYING band exception is linked.
 */
export interface CompRequest {
  id: string;
  employeeId: string;
  reason: string;
  currentSalary: number;
  requestedSalary: number;
  proposedLevel: Level;
  submittedBy: string;
  submittedAt: string;
  status: RequestStatus;
  /** Set by linking a finalized exception; null until the unlock is performed. */
  bandExceptionId: string | null;
}

export type BandExceptionStatus = "draft" | "approved";

/**
 * BEAT 6 — the unlock artifact. Filed under a code from the catalogue in
 * `band-exception-codes.ts`; only a JUSTIFYING code lifts the gate once the
 * exception is finalized.
 */
export interface BandException {
  id: string;
  compRequestId: string;
  code: string;
  justification: string;
  status: BandExceptionStatus;
  openedAt: string;
  finalizedAt: string | null;
}

/**
 * BEAT 5 — one of the three visible writes the stored procedure fires.
 */
export interface OnboardingTask {
  id: string;
  employeeId: string;
  label: string;
  owner: string;
  /** Days relative to the employee's start date. Negative = before day one. */
  dueOffsetDays: number;
  done: boolean;
}

/**
 * BEAT 3d — the durable artifact. Written to the STORE, not to the thread, so
 * deleting the conversation leaves it standing on the Onboarding page.
 */
export interface OnboardingPacket {
  id: string;
  employeeId: string;
  employeeName: string;
  role: string;
  startDate: string;
  summary: string;
  /** At most three; the tool truncates. */
  highlights: string[];
  /** Week-one schedule, typically lifted from an uploaded offer letter. */
  schedule: { day: string; item: string }[];
  filedAt: string;
  filedBy: string;
}

/** The signed-in operator. Rowan scopes durable memory per person id. */
export interface Operator {
  id: string;
  name: string;
  role: "people-ops-lead" | "recruiter" | "manager";
  team: Team;
}

/** Everything the store holds. Cloned wholesale on reset. */
export interface PeopleStoreState {
  employees: Employee[];
  bands: Band[];
  requests: PeopleRequest[];
  compRequests: CompRequest[];
  bandExceptions: BandException[];
  onboardingTasks: OnboardingTask[];
  packets: OnboardingPacket[];
  operators: Operator[];
}

/** Where a salary sits inside its band — the ladder's core derived value. */
export interface BandPosition {
  level: Level;
  min: number;
  mid: number;
  max: number;
  /** 0 at band min, 1 at band max. Clamped for rendering, NOT for the gate. */
  ratio: number;
  /** True when the salary is genuinely outside [min, max]. */
  outOfBand: boolean;
  /** "below" | "above" | null — which edge it fell outside. */
  side: "below" | "above" | null;
}
